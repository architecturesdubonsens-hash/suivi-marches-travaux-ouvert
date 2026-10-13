// js/ui/ecran-depot.js
//
// ÉCRAN 2 — DÉPÔT des devis et des pièces administratives.
//  - glisser-déposer (fichiers .pdf) + bouton « dossier complet » ;
//  - couche texte via js/import-pdf.js (pdf.js vendored) -> pré-remplissage
//    (montant, numéro de devis, date) par js/devis.js ;
//  - pages sans texte (scans, ~42 % du corpus réel) -> proposition de « saisie
//    assistée » manuelle, ou OCR tesseract.js à la demande (CDN ; hors ligne,
//    bouton désactivé avec message clair) ;
//  - classification des pièces par nom (décennale, RC, URSSAF, fiscale, Kbis,
//    RIB, Qualibat...) ;
//  - affectation de chaque fichier à une entreprise (création à la volée).
//
// Dépendances contractuelles utilisées avec garde-fous :
//  - js/assurances.js : analyserAttestation — si absent, la pièce
//    est enregistrée avec ses champs connus et l'analyse pourra être relancée
//    depuis l'écran 3 quand le module sera livré.

import { el, toast } from "./helpers.js";
import { titreAide } from "./bulle.js";
import { messageIndisponible } from "./etat-modules.js";
import { classerPiece, sembleEtreUnDevis, parseMontantFrancais, parseDateLibreFr, extraireDevis, fabriqueEntreprise, fabriqueAttestation, suggererEntrepriseDepuisChemin, LIBELLES_TYPES } from "../devis.js";
import { analyserFichier, ocriserPage } from "../import-pdf.js";

/** Dépôts en cours dans cette page (état d'interface, hors modèle de données). */
const depots = [];

/** Id interne de carte (préfixe stable pour retrouver les noeuds). */
let compteurDepot = 0;

/* ------------------------------------------------------------------ */
/* Dépôt de fichiers                                                   */
/* ------------------------------------------------------------------ */

/** True si le fichier est un PDF (nom ou type MIME). */
function estPdf(fichier) {
  return /\.pdf$/i.test(fichier.name) || fichier.type === "application/pdf";
}

/**
 * Traite une liste de fichiers déposés dans une zone (devis ou pièces).
 * @param {FileList|File[]} fichiers
 * @param {"devis"|"piece"} categorie
 * @param {object} ctx contexte applicatif
 */
async function ajouterFichiers(fichiers, categorie, ctx) {
  for (const fichier of Array.from(fichiers)) {
    if (!estPdf(fichier)) {
      toast("Fichier ignoré (seuls les PDF sont traités) : " + fichier.name, "erreur");
      continue;
    }
    const depot = {
      id: "dep-" + (++compteurDepot),
      categorie,
      fichier,
      chemin: fichier.webkitRelativePath || fichier.name,
      analyse: null,
      statut: "lecture",
      message: "",
      // État de saisie de la carte (survit au re-rendu) :
      entrepriseId: "",
      nouvelleEntreprise: "",
      numero: "", date: "", ht: "",
      type: categorie === "piece" ? classerPiece(fichier.name).type : "RCD",
      assureur: "", numeroContrat: "", valideDu: "", valideAu: "", activites: "",
    };
    // Classification immédiate par nom (avant même la lecture du PDF).
    if (categorie === "piece") {
      const classification = classerPiece(fichier.name);
      depot.type = classification.type;
      depot.confianceClassification = classification.confiance;
      if (sembleEtreUnDevis(fichier.name)) {
        depot.message = "Ce fichier semble être un DEVIS déposé dans les pièces administratives.";
      }
    }
    depots.push(depot);
    ctx.reRendre();
    // Lecture de la couche texte en arrière-plan.
    try {
      depot.analyse = await analyserFichier(fichier);
      depot.statut = "pret";
      if (categorie === "devis") {
        const extraits = extraireDevis(depot.analyse.texteComplet);
        depot.numero = extraits.numero || "";
        depot.date = extraits.date || "";
        depot.ht = extraits.ht !== null ? String(extraits.ht) : "";
        if (!depot.ht && extraits.ttcDetecte !== null) {
          depot.message = "Montant non identifié comme HT (proposition TTC " + extraits.ttcDetecte + " €) : à vérifier.";
        }
      }
      ctx.dossier.textesParSource.set(depot.chemin, depot.analyse.texteComplet);
    } catch (erreur) {
      depot.statut = "erreur";
      depot.message = "Lecture impossible : " + (erreur && erreur.message ? erreur.message : erreur);
    }
    ctx.reRendre();
  }
}

/* ------------------------------------------------------------------ */
/* Entreprises : sélection existante ou création à la volée            */
/* ------------------------------------------------------------------ */

/** Options du sélecteur d'entreprises + suggestion depuis le chemin. */
function construireSelectionEntreprise(depot, ctx) {
  const entreprises = ctx.projet.entreprises || [];
  const select = el("select", { class: "", title: "Entreprise concernée" },
    el("option", { value: "", texte: "— choisir une entreprise —" }));
  for (const entreprise of entreprises) {
    const option = el("option", { value: entreprise.id, texte: entreprise.raisonSociale });
    select.append(option);
  }
  const suggestion = suggererEntrepriseDepuisChemin(depot.chemin);
  if (suggestion && !entreprises.some((e) => e.raisonSociale.toUpperCase() === suggestion.toUpperCase())) {
    const option = el("option", { value: "nouvelle:" + suggestion, texte: "+ nouvelle : " + suggestion });
    select.append(option);
  }
  select.append(el("option", { value: "nouvelle", texte: "+ autre (saisir le nom)" }));
  if (depot.entrepriseId) select.value = depot.entrepriseId;
  select.addEventListener("change", () => {
    depot.entrepriseId = select.value;
    ctx.reRendre();
  });
  return select;
}

/**
 * Résout l'entreprise d'un dépôt : existante, suggérée par le chemin, ou
 * créée à partir du nom saisi. Renvoie {erreur} si impossible.
 */
function resoudreEntreprise(depot, ctx) {
  let valeur = depot.entrepriseId;
  if (valeur && valeur.startsWith("nouvelle:")) {
    const nom = valeur.slice("nouvelle:".length);
    depot.entrepriseId = "nouvelle";
    depot.nouvelleEntreprise = nom;
  }
  if (depot.entrepriseId === "nouvelle" || !depot.entrepriseId) {
    const nom = (depot.nouvelleEntreprise || "").trim();
    if (!nom) return { erreur: "Indiquez à quelle entreprise rattacher ce fichier." };
    const entreprise = fabriqueEntreprise(nom);
    ctx.majProjet((p) => { p.entreprises.push(entreprise); });
    depot.entrepriseId = entreprise.id;
  }
  return { entrepriseId: depot.entrepriseId };
}

/* ------------------------------------------------------------------ */
/* Intégration d'un devis                                              */
/* ------------------------------------------------------------------ */

function integrerDevis(depot, ctx) {
  const resolu = resoudreEntreprise(depot, ctx);
  if (resolu.erreur) { toast(resolu.erreur, "erreur"); return; }
  const ht = parseMontantFrancais(depot.ht);
  const nouveau = {
    id: "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    entrepriseId: depot.entrepriseId,
    numero: (depot.numero || "").trim(),
    date: parseDateLibreFr(depot.date) || "",
    htBase: ht !== null ? ht : 0,
    variantes: [],
    prorata: { mode: "inclus", taux: null },
    nomFichier: depot.fichier ? depot.fichier.name : null,
    statut: "actif",
  };

  // SPEC § 6 quater — la frontière métier : un devis remplacé AVANT la signature donne un
  // nouveau devis actif ; APRÈS la signature, la modification ne passe pas par un devis mais
  // par un AVENANT. L'outil ne tranche JAMAIS à la place de l'architecte : il détecte la
  // situation et lui demande lequel des deux cas s'applique. Un avenant modifie un contrat
  // signé : il se négocie et se signe.
  const etat = ctx.services.etat;
  const devisExistant = etat && typeof etat.devisActif === "function"
    ? etat.devisActif(ctx.projet, depot.entrepriseId) : null;
  const signe = Boolean(etat && typeof etat.marcheSigne === "function"
    && etat.marcheSigne(ctx.projet, depot.entrepriseId));

  if (devisExistant && signe) {
    depot.choixRemplacement = { devisExistant, nouveau };
    ctx.reRendre();
    return;
  }
  pousserDevis(depot, ctx, nouveau, "Devis ajouté à la validation (étape 3).");
}

/** Ajoute un devis au projet puis retire le dépôt de la liste (chemin normal). */
function pousserDevis(depot, ctx, nouveau, message) {
  ctx.majProjet((p) => {
    if (!Array.isArray(p.devis)) p.devis = [];
    p.devis.push(nouveau);
  });
  depots.splice(depots.indexOf(depot), 1);
  toast(message, "succes");
  ctx.reRendre();
}

/** Écart entre deux devis, calculé par la source unique (js/etat.js, ecartDevis). */
function ecartCalcule(ctx, choix) {
  const etat = ctx.services.etat;
  if (!etat || typeof etat.ecartDevis !== "function" || !choix) return null;
  try {
    return etat.ecartDevis(choix.devisExistant, choix.nouveau);
  } catch (erreur) {
    return null;
  }
}

/**
 * Décision « erreur de saisie » : le devis est remplacé, AUCUN avenant n'est créé — mais
 * l'écart avec le marché signé est signalé, car le document papier porte toujours l'ancien
 * montant. La trace du remplacement reste (SPEC § 6 quater).
 */
function remplacerSansAvenant(depot, ctx) {
  const etat = ctx.services.etat;
  const choix = depot.choixRemplacement;
  if (!etat || typeof etat.remplacerDevis !== "function" || !choix) {
    toast(messageIndisponible("js/etat.js"), "erreur");
    return;
  }
  const remplacant = { ...choix.nouveau };
  delete remplacant.id;
  ctx.majProjet((p) => {
    const misAJour = etat.remplacerDevis(p, choix.devisExistant.id, remplacant,
      { motif: "Erreur de saisie dans l'outil (aucun avenant)" });
    p.devis = misAJour.devis;
  });
  depots.splice(depots.indexOf(depot), 1);
  toast("Devis corrigé. ATTENTION : le marché signé porte le montant précédent — vérifiez qu'aucune pièce contractuelle ne doit être reprise.", "info", 9000);
  ctx.reRendre();
}

/**
 * Décision « travaux modificatifs » : le devis de remplacement devient actif et un avenant
 * est PRÉ-REMPLI avec l'écart. Il n'est ni validé ni signé : l'architecte le complète à
 * l'étape 4. L'outil prépare, il ne décide pas.
 */
function remplacerAvecAvenant(depot, ctx) {
  const etat = ctx.services.etat;
  const choix = depot.choixRemplacement;
  if (!etat || typeof etat.remplacerDevis !== "function" || !choix) {
    toast(messageIndisponible("js/etat.js"), "erreur");
    return;
  }
  const ecart = ecartCalcule(ctx, choix);
  let numeroAvenant = 1;
  const remplacant = { ...choix.nouveau };
  delete remplacant.id;
  ctx.majProjet((p) => {
    const misAJour = etat.remplacerDevis(p, choix.devisExistant.id, remplacant,
      { motif: "Travaux modificatifs (avenant à valider)" });
    p.devis = misAJour.devis;
    if (!Array.isArray(p.avenants)) p.avenants = [];
    numeroAvenant = p.avenants.filter((a) => a.entrepriseId === depot.entrepriseId).length + 1;
    p.avenants.push({
      numero: numeroAvenant,
      objet: "Travaux modificatifs — " + (remplacant.numero ? "devis " + remplacant.numero : "nouveau devis"),
      entrepriseId: depot.entrepriseId,
      lignes: ecart ? [{ libelle: "Écart entre l'ancien et le nouveau devis", sens: ecart.sens, montant: ecart.ht }] : [],
      modificationDelais: null,
      statut: "a_valider",
    });
  });
  depots.splice(depots.indexOf(depot), 1);
  toast("Devis remplacé et avenant n°" + numeroAvenant + " pré-rempli (à valider à l'étape 4)."
    + (ecart ? " Écart : " + (ecart.sens === "moins" ? "moins-value" : "plus-value") + " de " + ecart.ht.toFixed(2) + " € HT." : ""), "succes", 9000);
  ctx.reRendre();
}

/* ------------------------------------------------------------------ */
/* Intégration d'une pièce administrative                              */
/* ------------------------------------------------------------------ */

/** Analyse la pièce avec le module assurances si disponible. */
function analyserAvecAssurances(depot, texte) {
  const assurances = ctx_assurances(depot);
  return assurances ? assurances.analyserAttestation(texte) : null;
}
// Les services sont passés via ctx à chaque appel ; ce helper lit une closure
// mise à jour par rendreCarte pour éviter un paramètre de trop.
let servicesCourants = null;
function ctx_assurances() { return servicesCourants && servicesCourants.services ? servicesCourants.services.assurances : null; }

function integrerPiece(depot, ctx) {
  const resolu = resoudreEntreprise(depot, ctx);
  if (resolu.erreur) { toast(resolu.erreur, "erreur"); return; }
  const attestation = fabriqueAttestation(depot.entrepriseId, {
    type: depot.type,
    sourcePdf: depot.chemin,
    extraction: depot.extractionFaite === "ocr" ? "ocr" : depot.extractionFaite === "manuelle" ? "manuelle" : "texte",
  });
  // Compléter depuis l'analyse du module assurances si elle a abouti.
  if (depot.analyseAttestation) {
    const a = depot.analyseAttestation;
    attestation.assureur = a.assureur || depot.assureur || "";
    attestation.numeroContrat = a.numeroContrat || depot.numeroContrat || "";
    attestation.valideDu = a.valideDu || depot.valideDu || "";
    attestation.valideAu = a.valideAu || depot.valideAu || "";
    attestation.activites = Array.isArray(a.activites) ? a.activites : parseActivitesSaisies(depot.activites);
    attestation.exclusions = Array.isArray(a.exclusions) ? a.exclusions : [];
    attestation.extraction = depot.extractionFaite === "ocr" ? "ocr" : "texte";
  } else {
    attestation.assureur = depot.assureur || "";
    attestation.numeroContrat = depot.numeroContrat || "";
    attestation.valideDu = depot.valideDu || "";
    attestation.valideAu = depot.valideAu || "";
    attestation.activites = parseActivitesSaisies(depot.activites);
  }
  ctx.majProjet((p) => { p.attestations.push(attestation); });
  depots.splice(depots.indexOf(depot), 1);
  toast("Pièce administrative enregistrée (" + (LIBELLES_TYPES[attestation.type] || attestation.type) + ").", "succes");
  ctx.reRendre();
}

/** Textarea activités -> [{libelle}] (une activité par ligne). */
function parseActivitesSaisies(brut) {
  return String(brut || "").split(/\n+/).map((s) => s.trim()).filter(Boolean).map((libelle) => ({ libelle }));
}

/* ------------------------------------------------------------------ */
/* OCR à la demande                                                    */
/* ------------------------------------------------------------------ */

async function ocriserDepot(depot, ctx) {
  if (!depot.analyse) { toast("Lisez d'abord le PDF.", "erreur"); return; }
  depot.statut = "ocr";
  depot.message = "OCR en cours…";
  ctx.reRendre();
  try {
    // Un document scanné est OCR-isé page par page (l'aperçu de l'attestation
    // se trouve presque toujours dès la première page, mais on ne prend pas
    // le risque de manquer une suite d'annexes).
    let texte = "";
    const nbPages = depot.analyse.nbPages;
    for (let i = 1; i <= nbPages; i++) {
      const t = await ocriserPage(depot.fichier, i, (avancement) => {
        depot.message = "OCR page " + i + "/" + nbPages + " : " + Math.round(avancement * 100) + " %";
        ctx.reRendre();
      });
      texte += (i > 1 ? "\n\n" : "") + t;
    }
    depot.extractionFaite = "ocr";
    depot.analyse.texteComplet = texte;
    depot.analyse.pagesSansTexte = 0;
    ctx.dossier.textesParSource.set(depot.chemin, texte);
    depot.statut = "pret";
    depot.message = "OCR terminé.";
    // Relancer immédiatement l'analyse d'assurance si possible.
    if (depot.categorie === "piece") {
      const analyse = analyserAvecAssurances(depot, texte);
      depot.analyseAttestation = analyse;
      if (!analyse) depot.message += " " + messageIndisponible("js/assurances.js");
      else if (depot.type === "RCD" || depot.type === "RC") preRemplirChampsAttestation(depot, analyse);
    }
  } catch (erreur) {
    depot.statut = "pret";
    depot.message = "OCR indisponible : " + (erreur && erreur.message ? erreur.message : erreur)
      + " — utilisez la saisie assistée.";
  }
  ctx.reRendre();
}

/** Reporte le résultat d'analyserAttestation dans les champs de la carte. */
function preRemplirChampsAttestation(depot, analyse) {
  depot.assureur = analyse.assureur || depot.assureur;
  depot.numeroContrat = analyse.numeroContrat || depot.numeroContrat;
  depot.valideDu = analyse.valideDu || depot.valideDu;
  depot.valideAu = analyse.valideAu || depot.valideAu;
}

/* ------------------------------------------------------------------ */
/* Rendu des cartes                                                    */
/* ------------------------------------------------------------------ */

function rendreCarte(depot, ctx) {
  const carte = el("div", { classe: "fichier-depose" });
  const tete = el("div", { classe: "tete" },
    el("span", { classe: "nom", texte: depot.fichier.name }),
    el("span", { classe: "badge type", texte: depot.categorie === "devis" ? "DEVIS" : (LIBELLES_TYPES[depot.type] || depot.type) }));
  if (depot.analyse) {
    const sansTexte = depot.analyse.pagesSansTexte;
    tete.append(el("span", {
      classe: "badge " + (sansTexte === 0 ? "texte" : "scan"),
      texte: sansTexte === 0
        ? depot.analyse.nbPages + " page(s), texte lu"
        : sansTexte + "/" + depot.analyse.nbPages + " page(s) SANS texte (scan)",
    }));
  } else if (depot.statut === "lecture") {
    tete.append(el("span", { classe: "badge attente", texte: "lecture du PDF…" }));
  } else if (depot.statut === "erreur") {
    tete.append(el("span", { classe: "badge erreur", texte: "erreur" }));
  }
  carte.append(tete);
  if (depot.message) carte.append(el("p", { classe: "entre-deux", texte: depot.message }));
  if (depot.analyse && depot.analyse.texteComplet) {
    carte.append(el("div", { classe: "extrait", texte: depot.analyse.texteComplet.slice(0, 600) + (depot.analyse.texteComplet.length > 600 ? "…" : "") }));
  }

  // Affectation d'entreprise
  carte.append(el("div", { classe: "champs-ligne" },
    construireSelectionEntreprise(depot, ctx),
    depot.entrepriseId === "nouvelle"
      ? el("input", {
          type: "text", placeholder: "Raison sociale de la nouvelle entreprise",
          value: depot.nouvelleEntreprise,
          onInput: (e) => { depot.nouvelleEntreprise = e.target.value; },
        })
      : null));

  if (depot.statut !== "pret") return carte;

  if (depot.categorie === "devis") {
    const iNumero = el("input", { type: "text", value: depot.numero, placeholder: "N° de devis", onInput: (e) => { depot.numero = e.target.value; } });
    const iDate = el("input", { type: "text", value: depot.date, placeholder: "JJ/MM/AAAA", onInput: (e) => { depot.date = e.target.value; } });
    const iHt = el("input", { type: "text", value: depot.ht, placeholder: "Montant HT", onInput: (e) => { depot.ht = e.target.value; } });
    carte.append(el("div", { classe: "champs-ligne" }, iNumero, iDate, iHt));
    if (depot.choixRemplacement) {
      // Décision demandée à l'architecte (SPEC § 6 quater) : l'outil prépare, il ne tranche pas.
      const choix = depot.choixRemplacement;
      carte.append(el("div", { classe: "message-info", texte:
        "Cette entreprise a un MARCHÉ SIGNÉ (ou un ordre de service émis). Un nouveau devis ne remplace pas un "
        + "marché signé : il donne lieu à un avenant. De quel cas s'agit-il ?" }));
      carte.append(el("div", { classe: "ligne-actions" },
        el("button", { classe: "bouton", texte: "Erreur de saisie dans l'outil — corriger sans avenant",
          onClick: () => remplacerSansAvenant(depot, ctx) }),
        el("button", { classe: "bouton primaire", texte: "Travaux modificatifs — préparer un avenant",
          onClick: () => { choix.versAvenant = true; choix.ecart = ecartCalcule(ctx, choix); ctx.reRendre(); } }),
        el("button", { classe: "bouton discret", texte: "Ne rien changer",
          onClick: () => { delete depot.choixRemplacement; ctx.reRendre(); } })));
      if (choix.versAvenant) {
        carte.append(el("p", { classe: "message-info", texte: choix.ecart
          ? "Écart à porter à l'avenant : " + (choix.ecart.sens === "moins" ? "moins-value" : "plus-value")
            + " de " + choix.ecart.ht.toFixed(2) + " € HT (" + choix.ecart.ttc.toFixed(2) + " € TTC)."
          : "Écart incalculable : complétez les montants des deux devis avant de préparer l'avenant." }));
        carte.append(el("p", { classe: "aide", texte: "L'avenant sera PRÉ-REMPLI, jamais créé d'office : il reste à le valider, le compléter et le faire signer (étape 4)." }));
        carte.append(el("div", { classe: "ligne-actions" },
          el("button", { classe: "bouton primaire", texte: "Enregistrer le devis et préparer l'avenant",
            onClick: () => remplacerAvecAvenant(depot, ctx) })));
      }
    } else {
      carte.append(el("div", { classe: "ligne-actions" },
        el("button", { classe: "bouton primaire", texte: "Ajouter ce devis", onClick: () => integrerDevis(depot, ctx) })));
    }
  } else {
    // Pièce administrative : analyse attestation ou saisie assistée.
    const estAssurance = depot.type === "RCD" || depot.type === "RC";
    const scannee = depot.analyse.pagesSansTexte > 0;
    if (estAssurance && scannee && depot.extractionFaite !== "ocr") {
      const message = el("div", { classe: "message-attente",
        texte: "Page sans couche texte (document scanné). Choisissez : OCR à la demande, ou saisie assistée ci-dessous." });
      carte.append(message);
    }
    if (depot.analyseAttestation) {
      const a = depot.analyseAttestation;
      carte.append(el("p", { classe: "message-info", texte:
        "Analyse d'assurance : assureur " + (a.assureur || "?") + ", période " + (a.valideDu || "?") + " → " + (a.valideAu || "?")
        + (Array.isArray(a.activites) && a.activites.length ? ", activités : " + a.activites.map((x) => x.libelle || x).join(" ; ") : "")
        + (Array.isArray(a.exclusions) && a.exclusions.length ? ", exclusions : " + a.exclusions.join(" ; ") : "") }));
    }
    const iAssureur = el("input", { type: "text", value: depot.assureur, placeholder: "Assureur", onInput: (e) => { depot.assureur = e.target.value; } });
    const iContrat = el("input", { type: "text", value: depot.numeroContrat, placeholder: "N° de contrat", onInput: (e) => { depot.numeroContrat = e.target.value; } });
    const iDu = el("input", { type: "date", value: depot.valideDu, onInput: (e) => { depot.valideDu = e.target.value; } });
    const iAu = el("input", { type: "date", value: depot.valideAu, onInput: (e) => { depot.valideAu = e.target.value; } });
    const iActivites = el("textarea", { placeholder: "Activités garanties (une par ligne)", rows: "2", onInput: (e) => { depot.activites = e.target.value; } });
    carte.append(el("div", { classe: "champs-ligne" }, iAssureur, iContrat, iDu, iAu));
    carte.append(iActivites);

    const horsLigne = navigator.onLine === false;
    const boutonOcr = el("button", {
      classe: "bouton", texte: "Reconnaître par OCR",
      onClick: () => ocriserDepot(depot, ctx),
    });
    if (horsLigne) {
      boutonOcr.disabled = true;
      boutonOcr.title = "Hors ligne : l'OCR (CDN tesseract.js) est indisponible. Utilisez la saisie assistée.";
      carte.append(el("div", { classe: "ligne-actions" }, boutonOcr,
        el("span", { classe: "entre-deux", texte: "Hors ligne — OCR indisponible, saisie assistée possible ci-dessus." })));
    } else {
      carte.append(el("div", { classe: "ligne-actions" }, boutonOcr));
    }
    carte.append(el("div", { classe: "ligne-actions" },
      el("button", { classe: "bouton primaire", texte: "Ajouter cette pièce", onClick: () => integrerPiece(depot, ctx) })));
  }
  return carte;
}

/* ------------------------------------------------------------------ */
/* Écran principal                                                     */
/* ------------------------------------------------------------------ */

/**
 * Écrit l'écran 2 dans le conteneur.
 * @param {HTMLElement} conteneur
 * @param {object} ctx contexte applicatif fourni par app.js
 */
export function afficher(conteneur, ctx) {
  servicesCourants = ctx;

  function zoneDepot(titre, categorie, acceptDossier) {
    const zone = el("div", { classe: "zone-depot" });
    zone.append(el("div", { classe: "titre-depot", texte: titre }));
    zone.append(el("div", { classe: "mini", texte: "Glissez ici un ou plusieurs PDF, ou cliquez pour choisir." }));
    const input = el("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, style: "display:none" });
    input.addEventListener("change", () => { ajouterFichiers(input.files, categorie, ctx); input.value = ""; });
    zone.addEventListener("click", () => input.click());
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("survol"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("survol"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); zone.classList.remove("survol");
      ajouterFichiers(e.dataTransfer.files, categorie, ctx);
    });
    const boutons = el("div", { classe: "rangee-boutons" },
      el("button", { classe: "bouton", type: "button", texte: "Choisir des fichiers…", onClick: (e) => { e.stopPropagation(); input.click(); } }));
    if (acceptDossier) {
      const inputDossier = el("input", { type: "file", webkitdirectory: "", multiple: true, style: "display:none" });
      inputDossier.addEventListener("change", () => { ajouterFichiers(inputDossier.files, categorie, ctx); inputDossier.value = ""; });
      boutons.append(el("button", { classe: "bouton", type: "button", texte: "Choisir un dossier complet…", onClick: (e) => { e.stopPropagation(); inputDossier.click(); } }));
    }
    zone.append(input, boutons);
    return zone;
  }

  const zoneCartes = el("div");
  if (!depots.length) {
    zoneCartes.append(el("p", { classe: "entre-deux", texte: "Aucun fichier déposé pour l'instant." }));
  } else {
    for (const depot of depots) zoneCartes.append(rendreCarte(depot, ctx));
  }

  conteneur.replaceChildren(
    el("section", { classe: "carte" },
      titreAide("h2", "Dépôt des devis", "depot-devis"),
      el("p", { classe: "aide", texte: "Les devis des entreprises retenues. La couche texte est lue pour pré-remplir numéro, date et montant HT — tout reste modifiable." }),
      zoneDepot("Devis (.pdf)", "devis", false),
    ),
    el("section", { classe: "carte" },
      titreAide("h2", "Dépôt des pièces administratives", "depot-pieces"),
      el("p", { classe: "aide", texte: "Attestations d'assurance (décennale, RC), URSSAF, fiscale, Kbis, RIB, Qualibat… classées automatiquement d'après le nom du fichier." }),
      zoneDepot("Pièces administratives (.pdf)", "piece", true),
    ),
    el("section", { classe: "carte" },
      el("h2", { texte: "Fichiers déposés" }),
      zoneCartes,
      el("div", { classe: "rangee-boutons" },
        el("button", { classe: "bouton primaire", texte: "Étape suivante : validation →", onClick: () => ctx.aller(2) })),
    ),
  );
}
