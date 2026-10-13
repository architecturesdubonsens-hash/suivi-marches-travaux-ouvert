// js/devis.js
//
// Fonctions PURES (aucun accès au document) : classification des pièces
// administratives d'après leur nom de fichier, extraction des repères d'un
// devis (numéro, date, montant HT) depuis la couche texte produite par pdf.js,
// et fabrique d'objets conformes au modèle de données (SPEC §2).
//
// Rôle : PRÉ-REMPLIR l'interface pour éviter la ressaisie. Toute valeur
// extraite est une proposition : l'architecte la relit à l'écran 3.
// Aucune dépendance partenaire -> module directement testable en Node.

/**
 * Types de pièces du contrat (SPEC §2, Attestation.type).
 * La classification se fait sur le NOM du fichier (sans accent, comme dans le
 * corpus réel : "Attestation d'assurance responsabilite decennale 2025.pdf").
 * L'ordre compte : les règles les plus spécifiques d'abord (RCD avant RC).
 */
export const REGLES_PIECES = [
  { type: "RCD",           libelle: "Attestation décennale (RCD)", modele: /responsabilit\w*\s*decennale|assur\w+\s+decennale|decennale|\brcd\b/i },
  { type: "RC",            libelle: "Responsabilité civile (RC)", modele: /responsabilit\w*\s*civile|rceic|\brc\b/i },
  { type: "URSSAF",        libelle: "Attestation URSSAF / vigilance", modele: /urssaf|vigilance/i },
  { type: "FISCALE",       libelle: "Attestation de régularité fiscale", modele: /fiscale/i },
  { type: "TRAVAIL_CACHE", libelle: "Attestation CIBTP / travail dissimulé", modele: /cibtp|travails?\s*cach/i },
  { type: "KBIS",          libelle: "Extrait Kbis / immatriculation", modele: /k[\s_-]*bis|immatriculation/i },
  { type: "QUALIBAT",      libelle: "Qualification Qualibat / Qualifelec", modele: /qualibat|qualifelec/i },
  { type: "AUTRE",         libelle: "Relevé d'identité bancaire (RIB)", modele: /\brib\b|relev\w*\s*d.?identit/i },
  { type: "AUTRE",         libelle: "Attestation de non-condamnation", modele: /condamnation/i },
  { type: "AUTRE",         libelle: "Attestation retraite / prévoyance", modele: /pro\s*btp|retraite|prevoyance/i },
  { type: "AUTRE",         libelle: "Attestation de fédération professionnelle", modele: /federation|f\u00e9d\u00e9ration/i },
  { type: "AUTRE",         libelle: "Liste des travailleurs étrangers", modele: /travailleurs?\s*etrangers?/i },
];

/** Étiquettes de présentation par type de pièce (contrat §2). */
export const LIBELLES_TYPES = {
  RCD: "Décennale",
  RC: "Responsabilité civile",
  URSSAF: "URSSAF",
  FISCALE: "Fiscale",
  TRAVAIL_CACHE: "Travail caché (CIBTP)",
  KBIS: "Kbis",
  QUALIBAT: "Qualibat / Qualifelec",
  AUTRE: "Autre pièce",
};

/**
 * Classe un fichier d'après son nom.
 * @param {string} nomFichier
 * @returns {{type: string, libelle: string, confiance: "nom"|"inconnu"}}
 */
export function classerPiece(nomFichier) {
  const nom = String(nomFichier || "").toLowerCase();
  const regle = REGLES_PIECES.find((r) => r.modele.test(nom));
  if (regle) return { type: regle.type, libelle: regle.libelle, confiance: "nom" };
  return { type: "AUTRE", libelle: LIBELLES_TYPES.AUTRE, confiance: "inconnu" };
}

/** Le nom évoque-t-il un devis plutôt qu'une pièce administrative ? */
export function sembleEtreUnDevis(nomFichier) {
  return /devis|proposition|offre/i.test(String(nomFichier || ""));
}

/**
 * Analyse un montant écrit "à la française" : "97 133,57", "560 000,00 €",
 * "116560.284", "1 234 567". Renvoie null si rien d'exploitable.
 * @param {string} s
 * @returns {number|null}
 */
export function parseMontantFrancais(s) {
  if (typeof s !== "string") return null;
  let t = s.replace(/[\u00a0\u202f\u20ac]/g, " ").trim(); // espaces insécables + €
  if (!t) return null;
  if (t.includes(",")) {
    // Une virgule = séparateur décimal ; les espaces sont des milliers.
    t = t.replace(/\s+/g, "").replace(",", ".");
  } else if (t.includes(".")) {
    const morceaux = t.replace(/\s+/g, "").split(".");
    if (morceaux.length === 2 && morceaux[1].length <= 3) {
      t = morceaux.join("."); // point décimal : 116560.284
    } else {
      t = morceaux.join(""); // points de milliers : 1.234.567
    }
  } else {
    t = t.replace(/\s+/g, "");
  }
  const n = Number(t);
  return isFinite(n) && t !== "" ? n : null;
}

/** "5/3/25" ou "16/01/2025" -> "2025-03-05" (ISO) ; null si illisible. */
export function parseDateLibreFr(s) {
  if (!s) return null;
  const t = String(s).trim();
  // Format ISO d'abord : sans ambiguïté (sinon « 2025-03-05 » serait relu
  // comme JJ/MM/AA décalé -> 25/03/2005).
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return m[0];
  // Formats français : JJ/MM/AAAA, JJ/MM/AA, JJ-MM-AAAA.
  m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(t);
  if (m) {
    let annee = Number(m[3]);
    if (annee < 100) annee += annee < 70 ? 2000 : 1900;
    const date = new Date(Date.UTC(annee, Number(m[2]) - 1, Number(m[1])));
    return isNaN(date) ? null : date.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Extrait d'un texte (couche texte pdf.js d'un devis) les repères de
 * pré-remplissage. Renvoie {numero, date, ht, ttcDetecte, origine}.
 * Toutes les clés peuvent être null : c'est une proposition, pas une vérité.
 * @param {string} texte
 */
export function extraireDevis(texte) {
  const resultat = { numero: null, date: null, ht: null, ttcDetecte: null, origine: {} };
  if (!texte || typeof texte !== "string") return resultat;
  // Normalisation : une seule espace par série (pdf.js découpe parfois au
  // milieu des mots, on garde le texte linéarisé pour les regex).
  const texteAplat = texte.replace(/\s+/g, " ");

  // --- Numéro de devis : "devis numéro 22041 v2 du 5/3/25", "devis n° DEV00000693 du 16/01/2025"
  const mNumero = /devis\s*(?:n\u00b0|n(o|\u00b0)|num\u00e9ro|numero|num)\s*[:.]?\s*(.+?)\s+du\s+/i.exec(texteAplat);
  if (mNumero) {
    resultat.numero = mNumero[2].trim();
    resultat.origine.numero = "ligne devis";
    resultat.date = parseDateLibreFr(texteAplat.slice(mNumero.index).slice(0, 120));
  }
  if (!resultat.numero) {
    const mNo = /\bn\u00b0\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\-\/_]{2,})/.exec(texteAplat);
    if (mNo) { resultat.numero = mNo[1]; resultat.origine.numero = "n° isolé"; }
  }

  // --- Montants étiquetés : on cherche d'abord le HT, sinon le TTC.
  const etiquettes = [
    { cle: "ht", regex: /(?:total|montant)\s*(?:g\u00e9n\u00e9ral\s*)?(?:hors\s*taxes|ht)\b[^\d]{0,40}([\d][\d\s.,]*\d)(?:\s*\u20ac|\s|$|\b)/i },
    { cle: "ht", regex: /\bht\s*(?:r\u00e9vis\u00e9|global)?\s*[:=]\s*([\d][\d\s.,]*\d)(?:\s*\u20ac|\s|$)/i },
    { cle: "ttc", regex: /(?:total|montant)\s*(?:toutes\s*taxes\s*comprises|ttc)\b[^\d]{0,40}([\d][\d\s.,]*\d)(?:\s*\u20ac|\s|$|\b)/i },
  ];
  for (const etiquette of etiquettes) {
    const m = etiquette.regex.exec(texteAplat);
    if (!m) continue;
    const montant = parseMontantFrancais(m[1]);
    if (montant === null || montant <= 0) continue;
    if (etiquette.cle === "ht" && resultat.ht === null) {
      resultat.ht = montant;
      resultat.origine.ht = "ligne " + (m[0].trim().slice(0, 40));
    } else if (etiquette.cle === "ttc" && resultat.ttcDetecte === null) {
      resultat.ttcDetecte = montant;
      resultat.origine.ttc = "ligne TTC";
    }
  }

  // --- Filet : plus grand montant suivi d'un € dans le texte (souvent le
  //     total du devis). On le signale, l'architecte tranche HT/TTC.
  if (resultat.ht === null && resultat.ttcDetecte === null) {
    const montants = [];
    const re = /(?<![\d.,])([\d][\d\s.,]*\d|\d)\s*\u20ac/g;
    let m;
    while ((m = re.exec(texteAplat)) !== null) {
      const v = parseMontantFrancais(m[1]);
      if (v !== null) montants.push(v);
    }
    if (montants.length) {
      resultat.ttcDetecte = Math.max(...montants);
      resultat.origine.ttc = "plus grand montant en € (deviné)";
    }
  }
  return resultat;
}

/**
 * Fabrique une Entreprise conforme au contrat (SPEC §2) avec un id stable.
 * @param {string} raisonSociale
 * @param {Partial<Entreprise>=} complements
 */
export function fabriqueEntreprise(raisonSociale, complements = {}) {
  return {
    id: "ent-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    raisonSociale: String(raisonSociale || "").trim(),
    forme: complements.forme || "",
    representant: complements.representant || "",
    qualiteRepresentant: complements.qualiteRepresentant || "",
    siren: complements.siren || "",
    siret: complements.siret || "",
    adresse: complements.adresse || "",
    cp: complements.cp || "",
    ville: complements.ville || "",
    lotNom: complements.lotNom || "",
    lotNumero: complements.lotNumero || "",
  };
}

/**
 * Fabrique une Attestation vide mais conforme au contrat (SPEC §2), prête à
 * être complétée par l'analyse du module assurances ou la saisie.
 * @param {string} entrepriseId
 * @param {{type?: string, sourcePdf?: string, extraction?: "texte"|"ocr"|"manuelle"}} options
 */
export function fabriqueAttestation(entrepriseId, options = {}) {
  return {
    entrepriseId,
    type: options.type || "RCD",
    assureur: "",
    numeroContrat: "",
    valideDu: "",
    valideAu: "",
    activites: [],
    exclusions: [],
    sourcePdf: options.sourcePdf || "",
    extraction: options.extraction || "manuelle",
  };
}

/**
 * Propose un nom d'entreprise d'après le chemin de dépôt (les pièces réelles
 * arrivent rangées par dossiers du type "OP-2026-01 ELEVAL PA\\Kbis ELEVAL.pdf").
 * @param {string} cheminRelatif
 * @returns {string|null}
 */
export function suggererEntrepriseDepuisChemin(cheminRelatif) {
  if (!cheminRelatif) return null;
  const morceaux = String(cheminRelatif).split(/[\\/]/);
  const motsVides = /^(vb\d+|pa|pieces?|admin(?:istratives?)?|ch|chp|os|mt|av|devis)$/i;
  for (let i = morceaux.length - 2; i >= 0; i--) {
    const segment = morceaux[i].trim();
    const mots = segment.split(/\s+/).filter((mot) => mot.length >= 3 && !motsVides.test(mot) && !/\d/.test(mot));
    if (mots.length) return mots.join(" ");
  }
  return null;
}
