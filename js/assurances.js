// assurances.js — contrôle des assurances de chantier.
//
// Trois fonctions, contrat SPEC §4/§8 :
//  - analyserAttestation(texte) : extraction structurée d'une attestation
//    d'assurance (texte issu du PDF par pdf.js, éventuellement corrigé à la main) ;
//  - adequationActivite(lot, activites) : score de rapprochement entre le lot
//    de l'entreprise et les activités garanties, via SYNONYMES_LOTS ;
//  - controler(projet, entrepriseId) : voyant vert / orange / rouge du dossier
//    entreprise, fondé sur art. L. 241-1 du Code des assurances.
//
// Cas d’essai : une attestation reconstituée (Abeille IARD & Santé,
// contrat EDIFICE n° 10000042, période 01/01/2025-31/12/2025, activités S839 +
// S899, clause « travaux accessoires »).

import { SYNONYMES_LOTS } from './referentiels.js';

// --------------------------------------------------------------------------
// Utilitaires internes

// Normalisation pour comparaison : minuscules, sans accents, œ->oe, tout
// séparateur ramené à un espace. Permet de rapprocher « Étanchéité » et
// « etancheite », « gros œuvre » et « gros oeuvre », etc.
function normaliser(s) {
  return String(s)
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Convertit « JJ/MM/AAAA » ou « AAAA-MM-JJ » en « AAAA-MM-JJ » (canon du dépôt,
// cf. MODELE-DONNEES.md) ; renvoie null si non reconnaissable. Parser local et
// volontairement minuscule : js/etat.js n'expose pas de convertisseur (contrat
// SPEC §8) et cette logique de trois lignes ne justifie pas d'en élargir la
// surface d'export.
function versDateIso(v) {
  if (typeof v !== 'string') return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return v;
  const fr = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) {
    const jj = fr[1].padStart(2, '0');
    const mm = fr[2].padStart(2, '0');
    return fr[3] + '-' + mm + '-' + jj;
  }
  return null;
}

// « AAAA-MM-JJ » -> Date (UTC) ou null.
function versDate(v) {
  const iso = versDateIso(v);
  if (!iso) return null;
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Date (UTC) -> « AAAA-MM-JJ ».
function iso(d) {
  return d.toISOString().slice(0, 10);
}

// Ajoute n mois (arrondi calendaire JavaScript : 31/01 + 1 mois -> 03/03 ;
// approximation assumée, cf. MODELE-DONNEES.md).
function ajouterMois(d, n) {
  if (!d) return null;
  if (!n) return d;
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

// --------------------------------------------------------------------------
// Mots-clés du dictionnaire rattachés à un lot (toutes les entrées dont un
// synonyme figure dans le nom du lot) — sert à confronter les exclusions
// nommées au poste : « Sauf verrières ... » doit alerter un lot COUVERTURE
// même si le mot « verrières » n'apparaît ni dans le nom du lot ni dans les
// activités garanties. Duplication volontaire de la logique de rattachement
// d'adequationActivite : le contrat SPEC §8 ne permet pas d'exposer plus de
// symboles depuis ce module.
function motsClesDuLot(lotN) {
  const mots = [];
  for (const entree of Object.values(SYNONYMES_LOTS)) {
    if (entree.synonymes.some((s) => lotN.includes(normaliser(s)))) {
      for (const motCle of entree.motsCles) mots.push(normaliser(motCle));
    }
  }
  return mots;
}

// --------------------------------------------------------------------------
// SEUILS DE COÛT ET PLAFONDS (gabarit SMABTP CAP 2000, pages 2 à 5 transcrites
// dans les documents d’origine) :
//  - seuils de coût opposables : 26 000 000 € HT (ouvrages soumis à l'obligation),
//    6 000 000 € HT (ouvrages NON soumis — au-delà, garantie annulée faute
//    d'avenant d'adaptation) ;
//  - plafonds de garantie à restituer : bon fonctionnement 2,5 M€ (2 ans),
//    RC 8 / 2 / 1 M€, erreur d'implantation 200 k€, amiante et environnement
//    1 M€ par sinistre et par an.
// Extraction par FENÊTRES CONTEXTUELLES : tous les montants du gabarit se
// ressemblent (26 M€, 15 M€, 10 M€, 6 M€, 3 M€...), seul le contexte fait la
// différence (« coût total de construction ... n'est pas supérieur à » = seuil
// des ouvrages soumis, formulation commune aux deux gabarits ; « n'excède pas »
// = seuil des ouvrages non soumis ; « franchise » et « par sinistre » écartent
// les franchises CCRD). Chaque fenêtre consommée est retirée du texte pour
// empêcher un motif générique de rattraper un montant déjà attribué.
const SEUIL_SOUMIS_DEFAUT = 26000000;   // gabarit SMABTP, page 2 (ouvrages soumis)
const SEUIL_NON_SOUMIS_DEFAUT = 6000000; // gabarit SMABTP, page 4 (ouvrages non soumis)

// Montant « X € » ou « X EUR » -> nombre (espaces de milliers tolérés).
function montantEUR(fenetre, motifContexte) {
  const m = fenetre.match(new RegExp(motifContexte + '(\\d[\\d\\s]*?)\\s*(?:€|EUR)', 'i'));
  return m ? Number(m[1].replace(/\s/g, '')) : null;
}

// Nombre -> chaîne avec espaces de milliers (« 15000000 » -> « 15 000 000 »),
// pour la lisibilité des messages d'alerte destinés à l'architecte.
function formaterMontant(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Seuils de coût portés par la police : chaque occurrence de « coût total de
// construction » ouvre une fenêtre de 320 caractères ; « n'est pas supérieur à »
// identifie le seuil des ouvrages soumis (Abeille 15 M€, SMABTP 26 M€),
// « n'excède pas » celui des ouvrages non soumis (SMABTP 6 M€).
function detecterSeuilsDeCout(uni) {
  const seuils = {};
  for (const m of uni.matchAll(/co[uû]t total de construction/gi)) {
    const fenetre = uni.slice(m.index, m.index + 320);
    const aExcede = /n'exc[èe]de pas/i.test(fenetre);
    const aSuperieur = /n'est pas supérieur à/i.test(fenetre);
    if (aSuperieur && seuils.soumisHT === undefined) {
      const v = montantEUR(fenetre, "n'est pas supérieur à(?:\\s+la\\s+somme\\s+de)?\\s*");
      if (v !== null) { seuils.soumisHT = v; continue; }
    }
    if (aExcede && !aSuperieur && seuils.nonSoumisHT === undefined) {
      const v = montantEUR(fenetre, "n'exc[èe]de pas\\s*");
      if (v !== null) seuils.nonSoumisHT = v;
    }
  }
  return seuils;
}

// Plafonds de garantie restitués dans Attestation.plafonds (champs optionnels
// de SPEC §2). Chaque nature n'est cherchée qu'une fois ; la fenêtre consommée
// est retirée pour que « dommages matériels » de la garantie de bon
// fonctionnement (2 500 000 €) ne soit pas rattrapé par le plafond RC
// matériels (2 000 000 €).
function detecterPlafonds(uni) {
  const plafonds = {};
  const ref = { t: uni };
  const extraire = (motif, longueur) => {
    const m = ref.t.match(new RegExp(motif + '[^.]{0,' + longueur + '}?(\\d[\\d\\s]*?)\\s*(?:€|EUR)', 'i'));
    if (!m) return undefined;
    ref.t = ref.t.slice(0, m.index) + ref.t.slice(m.index + m[0].length);
    return Number(m[1].replace(/\s/g, ''));
  };
  const bonFonctionnement = extraire('bon\\s+fonctionnement', 220);
  if (bonFonctionnement !== undefined) plafonds.bonFonctionnementHT = bonFonctionnement;
  const corporels = extraire('dommages?\\s+corporels', 160);
  if (corporels !== undefined) plafonds.rcCorporels = corporels;
  const materiels = extraire('dommages?\\s+mat[ée]riels', 160);
  if (materiels !== undefined) plafonds.rcMateriels = materiels;
  const immateriels = extraire('dommages?\\s+immat[ée]riels', 160);
  if (immateriels !== undefined) plafonds.rcImmatériels = immateriels;
  const implantation = extraire('implantation', 160);
  if (implantation !== undefined) plafonds.implantation = implantation;
  const amiante = extraire('amiante', 200);
  if (amiante !== undefined) plafonds.amiante = amiante;
  const environnement = extraire('environnement', 200);
  if (environnement !== undefined) plafonds.environnement = environnement;
  // Les seuils de coût de la police (soumisHT / nonSoumisHT) sont extraits à
  // part, sur fenêtres « coût total de construction » (detecterSeuilsDeCout).
  Object.assign(plafonds, detecterSeuilsDeCout(uni));
  // Plafond de la RCD des ouvrages NON soumis (« Plafond : 3 000 000 € par
  // sinistre », gabarit SMABTP page 4) : champ rcdNonSoumisHT du contrat §2 —
  // un PLAFOND de garantie, à ne pas confondre avec nonSoumisHT qui est un
  // SEUIL DE COÛT de chantier (6 M€). Le deux-points immédiat écarte la
  // franchise CCRD (« franchise absolue au maximum de ... 3 000 000 € ») et la
  // section sous-traitance (« plafonds en cas de CCRD »).
  const rcdNonSoumis = ref.t.match(/plafond\s*:\s*(\d[\d\s]*?)\s*(?:€|EUR)/i);
  if (rcdNonSoumis) plafonds.rcdNonSoumisHT = Number(rcdNonSoumis[1].replace(/\s/g, ''));
  return plafonds;
}

// --------------------------------------------------------------------------
// analyserAttestation(texte) -> Attestation (modèle SPEC §2 + extensions
// diagnostiques `assure`, `programme`, `numeroAssure`,
// `sousTraitanceHorsPerimetre` et `plafonds`, cf. MODELE-DONNEES.md).
export function analyserAttestation(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') {
    throw new TypeError('analyserAttestation : texte non vide attendu (extraction PDF ou saisie manuelle)');
  }
  // Copie à espaces uniques pour les expressions régulières ; les apostrophes
  // typographiques (’ ‘) sont ramenées à l'apostrophe droite : l'OCR des scans
  // mélange les deux et les gabarits ne font pas la différence.
  const uni = texte.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').replace(/[’‘]/g, "'");
  const lignes = texte.split(/\r?\n/);

  // Type de pièce : la décennale prime (c'est elle qui porte le voyant).
  let type = 'AUTRE';
  if (/responsabilit[eé]s?\s+d[eé]cennale/i.test(uni)) type = 'RCD';
  else if (/responsabilit[eé]s?\s+civile/i.test(uni)) type = 'RC';
  else if (/urssaf/i.test(uni)) type = 'URSSAF';
  else if (/r[eé]gularit[eé]\s+fiscal/i.test(uni)) type = 'FISCALE';
  else if (/kbis/i.test(uni)) type = 'KBIS';
  else if (/qualibat|qualifelec/i.test(uni)) type = 'QUALIBAT';

  // Assureur : première ligne utile de l'en-tête (les lignes techniques
  // « page », « PSTOCK », « R.C.S. », « Standard »... sont écartées).
  let assureur = null;
  for (const brut of lignes) {
    const ligne = brut.trim();
    if (ligne === '') continue;
    if (/^(page|standard|intermédiaire|intermediaire|\^\{|attn|tél|fax)/i.test(ligne)) continue;
    // En-têtes d'extraction du corpus (PAGES: 5 | PDF version..., --- page 1 | ...)
    if (/^(pages?\s*:|---\s*page|page\s+\d)/i.test(ligne)) continue;
    if (/^\d+([\s\d]*)\s*R\.?C\.?S\.?/i.test(ligne)) continue;
    if (/^\d+\s*\/\s*\d+$/.test(ligne)) continue;
    if (/attestation/i.test(ligne) && ligne.length < 60) continue;
    assureur = ligne;
    break;
  }

  // Assuré et immatriculation : « certifie que SA ELEVAL, immatriculé(e) sous le n°100000058 »
  let assure = null;
  let sirenAssure = null;
  const mAssure = uni.match(/certifie que\s+(.{2,80}?)\s*,\s*immatricul[eé]\(e\)\s+sous le n°\s*([\d\s]{9,14})/i);
  if (mAssure) {
    assure = mAssure[1].replace(/\s+/g, ' ').trim();
    sirenAssure = mAssure[2].replace(/\s/g, '');
  }

  // Contrat — deux gabarits réels :
  //  - Abeille EDIFICE : « titulaire d'un contrat EDIFICE en vigueur n° 10000042 » ;
  //  - SMABTP CAP 2000 : « contrat CAP 2000 n° 9990001 / 001 999999/143 »
  //    (numéro composite, barres obliques comprises).
  let numeroContrat = null;
  let programme = null;
  // Préfixe « contrat » en minuscule (Abeille) ou « Contrat : » (SMABTP) : la casse
  // du préfixe est neutralisée par [Cc] SANS flag /i — le flag global affaiblirait
  // le filtre majuscule du nom de programme et ferait rattraper des phrases comme
  // « contrat de louage ».
  const mContratEdifice = uni.match(/(?:[Cc]ontrat)\s*:?\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9' -]{0,24}?)\s+en vigueur n°\s*([\d\s]{6,20})/);
  const mContratProgramme = mContratEdifice ? null
    : uni.match(/(?:[Cc]ontrat)\s*:?\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9' -]{0,24}?)\s+n°\s*([\d][\d\/ ]{5,40})/);
  const mContratNu = (mContratEdifice || mContratProgramme) ? null
    : uni.match(/(?:contrat|police)\s*:?\s*n°\s*([\d][\d\s\/]{5,30})/i);
  if (mContratEdifice) {
    programme = mContratEdifice[1].replace(/\s+/g, ' ').trim();
    numeroContrat = mContratEdifice[2].replace(/\s/g, '');
  } else if (mContratProgramme) {
    programme = mContratProgramme[1].replace(/\s+/g, ' ').trim();
    numeroContrat = mContratProgramme[2].replace(/\s+/g, ' ').trim();
  } else if (mContratNu) {
    numeroContrat = mContratNu[1].replace(/\s+/g, ' ').trim();
  }
  // N° d'assuré (gabarit SMABTP : « n° assuré 999999B ») — absent chez Abeille.
  const mAssureNumero = uni.match(/n°\s*assur[ée]\s*:?\s*([A-Z0-9]{4,15})/i);
  const numeroAssure = mAssureNumero ? mAssureNumero[1] : null;

  // Période de validité — DEUX gabarits réels coexistent (cf.
  // les documents d’origine) :
  //  - Abeille EDIFICE : « Valable pour la période du 01/01/2025 au 31/12/2025 » ;
  //  - SMABTP CAP 2000 : « Période de validité : du 01/01/2025 au 31/12/2025 ».
  // Repli générique « du ... au ... » en dernier ressort.
  let valideDu = null;
  let valideAu = null;
  const mPeriode = uni.match(/valable pour la p[eé]riode du\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*au\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    || uni.match(/p[eé]riode de validité\s*:?\s*du\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*au\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    || uni.match(/\bdu\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+au\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  if (mPeriode) {
    valideDu = versDateIso(mPeriode[1]);
    valideAu = versDateIso(mPeriode[2]);
  }

  // Activités garanties : lignes « S839 – ... » ou code seul suivi du libellé.
  const activites = [];
  const vus = new Set();
  for (let i = 0; i < lignes.length; i++) {
    const m = lignes[i].match(/^\s*([SG]\d{3})\b\s*[–—:-]?\s*(.*)$/);
    if (!m) continue;
    const code = m[1];
    if (vus.has(code)) continue;
    vus.add(code);
    // Libellé : fin de la ligne du code, puis paragraphes descriptifs qui
    // suivent (arrêté par un nouveau code, une ligne vide ou la section suivante).
    let libelle = m[2].trim();
    for (let j = i + 1; j < lignes.length && libelle.length < 400; j++) {
      const suiv = lignes[j].trim();
      if (suiv === '') break;
      if (/^[SG]\d{3}\b/.test(suiv)) break;
      if (/^Pour des ouvrages/i.test(suiv)) break;
      libelle += ' ' + suiv;
    }
    activites.push({ code, libelle: libelle.trim() });
  }

  // Second gabarit (SMABTP CAP 2000, cf. les documents d’origine) :
  // activités en LISTE À PUCES sans aucun code, après un titre de section du type
  // « Périmètre des activités professionnelles garanties ». Collecte : les lignes
  // commençant par un marqueur de puce ouvrent un item, les lignes en minuscule
  // ou chiffre le continuent (retour à la ligne de l'OCR) ; une majuscule sans
  // puce (nouvelle phrase ou nouvelle section) referme la liste. Les items sont
  // fusionnés avec les activités à codes, dédupliqués par libellé normalisé. Un
  // item sans code est stocké SANS clé `code` (modèle SPEC §2 : activites:
  // [{code?, libelle}]).
  for (let t = 0; t < lignes.length; t++) {
    const titre = lignes[t].trim();
    if (titre === '' || titre.length > 120) continue;
    if (!/^[A-ZÀ-Ÿ0-9]/.test(titre)) continue; // un titre, pas une phrase courante
    if (!/p[eé]rim[eè]tre.*garanti|activit[ée]s.*garanti/i.test(titre)) continue;
    const items = [];
    let courant = null;
    for (let j = t + 1; j < lignes.length; j++) {
      const brut = lignes[j].trim();
      if (brut === '') break; // fin de section (ligne vide après le bloc d'items)
      if (/^[SG]\d{3}\b/.test(brut)) break; // retour au gabarit à codes
      if (/^(exclusion|sauf|garantie|franchise|plafond|montant des|article|art\.)/i.test(brut)) break;
      const puce = /^[-•▪●*·‣–]\s*/.test(brut);
      if (!puce && /^[A-ZÀ-Ÿ]/.test(brut)) break; // phrase ou section suivante
      const contenu = brut.replace(/^[-•▪●*·‣–]\s*/, '').trim();
      if (contenu === '') continue;
      if (puce) {
        if (courant) items.push(courant);
        courant = contenu;
      } else if (/^[a-zà-ÿ0-9(]/.test(contenu)) {
        courant = courant ? courant + ' ' + contenu : contenu; // continuation d'item
      } else {
        break; // sécurité : forme inattendue
      }
    }
    if (courant) items.push(courant);
    for (const item of items) {
      for (const morceau of item.split(';')) {
        const libelle = morceau.trim().replace(/,\s*$/, '');
        if (libelle.length < 3) continue;
        const cle = normaliser(libelle);
        if (activites.some((a) => normaliser(a.libelle) === cle)) continue;
        activites.push({ libelle });
      }
    }
    break; // une seule section de périmètre est traitée
  }

  // Exclusions et limites détectées.
  const exclusions = [];
  const pousser = (t) => { if (!exclusions.includes(t)) exclusions.push(t); };
  if (/à l'exclusion de toute autre/i.test(uni)) {
    pousser("À l'exclusion de toute autre activité que celles expressément visées ci-avant");
  }
  if (/travaux accessoires/i.test(uni) && /march[eé]\s+(?:de\s+)?travaux\s+[àa]\s+part\s+enti[eè]re/i.test(uni)) {
    pousser("Clause « travaux accessoires » : les travaux accessoires ou complémentaires ne peuvent faire l'objet d'un marché de travaux à part entière ; à défaut de reproduction précise de l'activité dans l'attestation, ils sont réputés non garantis");
  }
  for (const m of uni.matchAll(/\b[Ss]auf\s+([^.;]{3,80})/g)) {
    pousser('Sauf ' + m[1].replace(/\s+/g, ' ').trim());
  }
  for (const m of uni.matchAll(/à l'exclusion de\s+(?!toute autre)([^.;]{3,80})/gi)) {
    pousser("À l'exclusion de " + m[1].replace(/\s+/g, ' ').trim());
  }
  const mCout = uni.match(/supérieur à la somme de\s*(\d[\d\s]*?)\s*EUR/i);
  if (mCout) {
    pousser('Limite : chantiers dont le coût total de construction HT déclaré dépasse ' + mCout[1].trim() + ' EUR (règle proportionnelle, art. L. 121-5 du Code des assurances)');
  }
  if (/sous-[oœ]uvre/i.test(uni)) {
    pousser('Travaux en sous-œuvre exclus');
  }

  // Clause de sous-traitance — deux gabarits OPPOSÉS (cf. fiche CAP 2000) :
  //  - SMABTP : « la garantie lui reste acquise même s'ils ne correspondent pas
  //    aux activités déclarées ci-dessus » -> garantie acquise HORS périmètre ;
  //  - Abeille : « exercées par l'Assuré lui-même ou par ses sous traitants » ->
  //    sous-traitants couverts DANS le cadre des activités visées seulement.
  let sousTraitanceHorsPerimetre = null;
  if (/garantie lui\s+reste acquise\s+même s'ils ne correspondent pas/i.test(uni)) {
    sousTraitanceHorsPerimetre = true;
  } else if (/exercées par\s+l'Assuré lui-même ou par ses sous[- ]traitants/i.test(uni)) {
    sousTraitanceHorsPerimetre = false;
  }

  return {
    entrepriseId: null, // rattaché par l'interface après import du PDF
    type,
    assureur,
    numeroContrat,
    valideDu,
    valideAu,
    activites,
    exclusions,
    sourcePdf: null,
    extraction: 'texte',
    // Extensions diagnostiques (hors modèle SPEC §2, documentées) : identité de
    // l'assuré, nom du programme contractuel (EDIFICE, CAP 2000...), n° d'assuré
    // et clause de sous-traitance — utiles pour rapprocher pièce/entreprise et
    // pour afficher la portée réelle de la garantie.
    assure,
    programme,
    numeroAssure,
    sousTraitanceHorsPerimetre,
    // Extension : l'attestation couvre-t-elle des ouvrages SOUMIS à l'obligation
    // (référence explicite à l'article L. 241-1 du Code des assurances) ? Les
    // deux gabarits réels la citent. Nécessaire à la règle de seuil de coût :
    // « ROUGE seulement si l'attestation ne couvre que des ouvrages NON soumis ».
    // false = aucune référence détectée dans le texte fourni.
    couvreOuvragesSoumis: /l\.?\s*241-1/i.test(uni),
    // Plafonds et seuils de coût de la police (SPEC §2) : extraits du texte
    // quand le gabarit les porte (SMABTP pages 2-5, Abeille limite soumis) ;
    // clés absentes quand non détectées — aucune valeur inventée.
    plafonds: detecterPlafonds(uni),
  };
}

// --------------------------------------------------------------------------
// adequationActivite(lot, activites) -> { score, matches[] }
// score : proportion de mots-clés du lot retrouvés dans les activités garanties
// (0 à 1) ; matches : liste { motCle, code, libelle }.
// CHEMIN PRINCIPAL = rapprochement TEXTUEL mot-clé ↔ libellé : les motsCles de
// SYNONYMES_LOTS sont cherchés dans le texte (code + libellé) des activités,
// sans accents ni casse. Les codes Sxxx ne sont qu'un INDICE supplémentaire :
// aucun gabarit réel ne les exige (l'attestation SMABTP CAP 2000 n'en porte
// aucun) et un libellé de lot peut suffire à lui seul au rapprochement.
export function adequationActivite(lot, activites) {
  if (lot != null && typeof lot !== 'string') {
    throw new TypeError('adequationActivite : lot chaîne attendue, reçu ' + String(lot));
  }
  if (!Array.isArray(activites)) {
    throw new TypeError('adequationActivite : activites tableau attendu');
  }
  const lotN = normaliser(lot ?? '');
  if (lotN === '') return { score: 0, matches: [] };

  // Chaque activité est réduite à « code + libellé » normalisés pour la recherche.
  const activitesN = activites.map((a) => {
    if (typeof a === 'string') return { code: null, texte: normaliser(a), brut: a };
    const code = a && a.code ? String(a.code) : null;
    const libelle = a && a.libelle ? String(a.libelle) : '';
    return { code, texte: normaliser((code ? code + ' ' : '') + libelle), brut: libelle };
  });

  // 1) Rattachement du lot aux entrées du dictionnaire (par synonymes du nom).
  let motsCles = [];
  for (const entree of Object.values(SYNONYMES_LOTS)) {
    const rattache = entree.synonymes.some((s) => lotN.includes(normaliser(s)));
    if (rattache) motsCles = motsCles.concat(entree.motsCles);
  }
  // 2) Repli : mots significatifs du lot lui-même (lot hors dictionnaire).
  if (motsCles.length === 0) {
    const stop = new Set(['pour', 'avec', 'dans', 'cette', 'travaux', 'chantier', 'fourniture', 'pose']);
    motsCles = lotN.split(' ').filter((w) => w.length >= 4 && !stop.has(w)).slice(0, 10);
  }
  if (motsCles.length === 0) return { score: 0, matches: [] };

  // 3) Recherche de chaque mot-clé dans les activités garanties.
  const matches = [];
  const vusMotCle = new Set();
  for (const motCle of motsCles) {
    const cible = normaliser(motCle);
    for (const a of activitesN) {
      const touche = a.texte.includes(cible) || (a.code && normaliser(a.code) === cible);
      if (!touche) continue;
      const cle = motCle + '|' + (a.code ?? '');
      if (!vusMotCle.has(cle)) {
        vusMotCle.add(cle);
        matches.push({ motCle, code: a.code, libelle: a.brut.slice(0, 200) });
      }
    }
  }
  const distincts = new Set(matches.map((m) => m.motCle)).size;
  const score = Math.round((distincts / motsCles.length) * 100) / 100;
  return { score, matches };
}

// --------------------------------------------------------------------------
// controler(projet, entrepriseId) -> { voyant:'vert'|'orange'|'rouge', raisons[] }
// Règles SPEC §4 à jour (gabarit SMABTP pages 2-5) :
//  rouge  : RCD absente, OUVERTURE DE CHANTIER hors période de validité,
//           aucun match d'activité, exclusion touchant le poste, coût du
//           chantier au-delà du seuil opposable de la police ;
//  orange : expiration avant la fin prévisionnelle, adéquation faible,
//           coût entre le seuil des ouvrages non soumis et celui des soumis ;
//  raisons : les alertes (rouge/orange) ET des raisons informatives préfixées
//           « [info] » (approximation ouverture de chantier/DROC, seuil de coût
//           non vérifié) — les « [info] » ne dégradent pas le voyant.
export function controler(projet, entrepriseId) {
  if (!projet || typeof projet !== 'object') {
    throw new TypeError('controler : projet objet attendu');
  }
  const entreprise = (projet.entreprises ?? []).find((e) => e && e.id === entrepriseId);
  if (!entreprise) {
    throw new Error('controler : entreprise « ' + String(entrepriseId) + ' » introuvable dans le projet');
  }
  const rouge = [];
  const orange = [];
  const info = []; // raisons « [info] » : ne dégradent pas le voyant
  const lotNom = entreprise.lotNom ?? '';
  const lotN = normaliser(lotNom);

  const attestations = (projet.attestations ?? []).filter((a) => a && a.entrepriseId === entrepriseId);
  const rcds = attestations.filter((a) => a.type === 'RCD');

  if (rcds.length === 0) {
    rouge.push("Aucune attestation de responsabilité décennale (RCD) au dossier de l'entreprise " +
      '(art. L. 241-1 du Code des assurances)');
  } else {
    // La plus favorable (validité la plus lointaine) fait foi ; les autres
    // attestations RCD du dossier restent consultables dans l'interface.
    const retenue = rcds.slice().sort((a, b) => {
      const da = versDate(a.valideAu) ?? 0;
      const db = versDate(b.valideAu) ?? 0;
      return da - db;
    }).pop();

    const du = versDate(retenue.valideDu);
    const au = versDate(retenue.valideAu);
    const droc = versDate(projet.operation?.droc);

    // DÉCLENCHEUR LÉGAL (gabarit SMABTP, annexe I de l'article A. 243-1 du code
    // des assurances) : c'est l'OUVERTURE DE CHANTIER qui doit tomber dans la
    // période de validité, et non la seule DROC. Base de comparaison :
    //  - operation.ouvertureChantier quand elle est saisie (OC réelle) ;
    //  - sinon la DROC en PRÉSUMÉE, signalée à l'architecte (raison [info] qui
    //    ne dégrade pas le voyant). Sans ni l'une ni l'autre : orange.
    const ouvertureReelle = versDate(projet.operation?.ouvertureChantier);
    const ocBase = ouvertureReelle ?? droc;
    if (ouvertureReelle) {
      // OC réelle saisie : le contrôle est exact, rien à signaler — un vert sans
      // aucune raison est le signe d'un dossier complet.
    } else if (droc) {
      info.push("[info] Ouverture de chantier présumée égale à la DROC (date non saisie) — DROC retenue pour la comparaison : " + projet.operation.droc);
    } else {
      orange.push("Ouverture de chantier inconnue : ni ouverture de chantier saisie, ni DROC — couverture temporelle non vérifiable (annexe I de l'article A. 243-1 du Code des assurances)");
    }

    // Fin prévisionnelle : ouverture de chantier + durée prévisionnelle, à défaut premier OS.
    let fin = null;
    if (ocBase) fin = ajouterMois(ocBase, projet.operation?.dureePrevisionnelleMois ?? 0);
    else {
      const osEntreprise = (projet.OS ?? [])
        .filter((o) => o && o.entrepriseId === entrepriseId && versDate(o.dateDebut))
        .map((o) => versDate(o.dateDebut))
        .sort((a, b) => a - b);
      if (osEntreprise.length > 0) fin = ajouterMois(osEntreprise[0], projet.operation?.dureePrevisionnelleMois ?? 0);
    }

    if (du == null && au == null) {
      orange.push('Période de garantie illisible sur l\'attestation RCD retenue — vérifier la pièce');
    }
    const libelleOC = ouvertureReelle
      ? "L'ouverture de chantier saisie (" + projet.operation.ouvertureChantier + ")"
      : "L'ouverture de chantier présumée égale à la DROC (" + projet.operation.droc + ")";
    if (du && ocBase && du > ocBase) {
      rouge.push(libelleOC + " n'est pas couverte par la garantie : elle ne commence que le " + retenue.valideDu);
    }
    if (au && ocBase && au < ocBase) {
      rouge.push('La garantie est échue le ' + retenue.valideAu + ', avant ' + libelleOC.toLowerCase());
    }
    if (au && fin && au < fin) {
      orange.push('La garantie expire le ' + retenue.valideAu + ', avant la fin prévisionnelle des travaux (' + iso(fin) + ')');
    }
    if (au && !fin && au < new Date()) {
      orange.push('La garantie est expirée depuis le ' + retenue.valideAu);
    }

    // Adéquation lot <-> activités garanties.
    const { score } = adequationActivite(lotNom, retenue.activites ?? []);
    if (score === 0) {
      rouge.push('Aucune activité garantie ne correspond au lot « ' + lotNom + ' »');
    } else if (score < 0.5) {
      orange.push('Adéquation activités/lot faible (score ' + score + ' sur le lot « ' + lotNom + ' »)');
    }

    // Exclusions formelles touchant le poste : seules les exclusions nommées
    // (« Sauf ... », « À l'exclusion de ... ») sont confrontées au lot ; les
    // clauses structurelles (travaux accessoires, limites de coût) s'appliquent
    // à toute police et restent informatives. Le rapprochement porte sur le
    // libellé du lot ET sur tous les mots-clés du dictionnaire rattachés à ce
    // lot (cf. motsClesDuLot).
    const reperes = [lotN].concat(motsClesDuLot(lotN)).filter(Boolean);
    for (const exclusion of retenue.exclusions ?? []) {
      if (!/^(Sauf|À l'exclusion de)/.test(exclusion)) continue;
      const mots = normaliser(exclusion).split(' ').filter((w) => w.length >= 4);
      const touche = mots.some((w) => reperes.some((r) => r.includes(w) || w.includes(r)));
      if (touche) {
        rouge.push('Exclusion susceptible de toucher le lot : « ' + exclusion + ' »');
      }
    }

    // SEUILS DE COÛT OPPOSABLES (gabarit SMABTP pages 2 et 4) : ouvrages soumis
    // <= 26 000 000 € HT ; ouvrages NON soumis <= 6 000 000 € HT — au-delà du
    // second, la garantie ne s'applique pas faute d'avenant d'adaptation de
    // garantie. operation.ouvrageSoumis choisit le seuil applicable
    // (26 M€ si true, 6 M€ si false, vigilance orange entre les deux si null) ;
    // la police peut porter ses propres limites
    // (plafonds.soumisHT / nonSoumisHT, extraits de son texte) : elles priment.
    const seuilSoumis = retenue.plafonds?.soumisHT ?? SEUIL_SOUMIS_DEFAUT;
    const seuilNonSoumis = retenue.plafonds?.nonSoumisHT ?? SEUIL_NON_SOUMIS_DEFAUT;
    const coutChantier = projet.operation?.coutTravauxHT;
    const ouvrageSoumis = projet.operation?.ouvrageSoumis;
    if (coutChantier == null) {
      // « Un faux rouge est pire qu'une incertitude déclarée » (SPEC §4) :
      // sans coût du chantier, on ne conclut rien, on signale.
      info.push('[info] Seuil de coût non vérifié : coût du chantier non renseigné (seuils opposables : ' + formaterMontant(seuilSoumis) + ' € HT ouvrages soumis / ' + formaterMontant(seuilNonSoumis) + ' € HT ouvrages non soumis)');
    } else {
      if (typeof coutChantier !== 'number' || !Number.isFinite(coutChantier) || coutChantier < 0) {
        throw new TypeError('controler : operation.coutTravauxHT doit être un nombre positif ou null, reçu ' + String(coutChantier));
      }
      // « attestation ne couvrant que des ouvrages NON soumis » (SPEC §4) :
      // aucune référence à l'article L. 241-1 dans son texte, ou seul
      // plafonds.nonSoumisHT renseigné. Une attestation saisie à la main sans
      // ces indices reste en incertitude (vigilance orange), jamais en rouge.
      const couvreSoumis = retenue.couvreOuvragesSoumis === true || retenue.plafonds?.soumisHT != null;
      const nonSoumiseSeule = (retenue.couvreOuvragesSoumis === false) ||
        (retenue.plafonds?.nonSoumisHT != null && retenue.plafonds?.soumisHT == null);
      if (coutChantier > seuilSoumis) {
        rouge.push('Coût du chantier supérieur au seuil de garantie (' + formaterMontant(coutChantier) + ' € > ' + formaterMontant(seuilSoumis) + ' €) : garantie non acquise sans avenant d\'adaptation');
      } else if (coutChantier > seuilNonSoumis && (ouvrageSoumis === false || nonSoumiseSeule)) {
        rouge.push('Coût du chantier (' + formaterMontant(coutChantier) + ' € HT) au-delà du seuil des ouvrages NON soumis (' + formaterMontant(seuilNonSoumis) + ' € HT) : ' + (ouvrageSoumis === false ? "l'ouvrage est déclaré non soumis à l'obligation d'assurance (art. L. 243-1-1)" : "l'attestation ne couvre que des ouvrages NON soumis (aucune activité au titre de l'article L. 241-1)") + ' et la garantie ne s\'applique pas faute d\'avenant d\'adaptation de garantie');
      } else if (coutChantier > seuilNonSoumis && ouvrageSoumis == null) {
        orange.push('Coût du chantier (' + formaterMontant(coutChantier) + ' € HT) entre le seuil des ouvrages NON soumis (' + formaterMontant(seuilNonSoumis) + ' € HT) et celui des ouvrages soumis (' + formaterMontant(seuilSoumis) + ' € HT) : la garantie dépend de la nature soumise/non soumise de l\'ouvrage (art. L. 241-1 ou L. 243-1-1) et d\'un éventuel avenant d\'adaptation — nature non déclarée (operation.ouvrageSoumis)');
      }
      // ouvrageSoumis === true et coutChantier <= seuilSoumis : couvert, rien.
    }

    // Honnêteté de la provenance : une attestation saisie à la main (scan
    // retranscrit, cf. gabarit SMABTP CAP 2000) n'a pas la confiance d'une
    // extraction automatique — le voyant le signale même si tout est vert.
    if (retenue.extraction === 'manuelle') {
      orange.push("Attestation saisie manuellement : fiabilité moindre qu'une extraction automatique, vérifier l'original avant de valider le voyant");
    }
  }

  const voyant = rouge.length > 0 ? 'rouge' : (orange.length > 0 ? 'orange' : 'vert');
  return { voyant, raisons: rouge.concat(orange).concat(info) };
}
