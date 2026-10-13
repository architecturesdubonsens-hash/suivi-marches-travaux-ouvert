// etat.js — modèle de données, cycle de vie des pièces et persistance
//.
//
// Le modèle Projet est le contrat SPEC §2 (champs observés dans le corpus) :
// ce fichier en est l'implémentation de référence, en JSDoc, sans TypeScript.
//
// Convention de dates (choix documenté dans MODELE-DONNEES.md) : TOUTES les
// dates du modèle sont des CHAÎNES au format canonique « AAAA-MM-JJ » (ISO 8601).
// importerJSON() accepte en plus « JJ/MM/AAAA » et le convertit — jamais de
// Date JavaScript dans l'état persisté (stabilité de la sérialisation).
//
// ── Cycle de vie des pièces (SPEC §6 quater) ────────────────────────────────
// Un devis et une attestation sont des PIÈCES. Chaque pièce porte :
//   id                 identifiant stable — la clé par laquelle on l'édite ou
//                      la remplace (jamais par sa position dans une liste) ;
//   nomFichier, sha256 identité du fichier déposé : remplacer une pièce sans
//                      confondre deux versions, dédupliquer plus tard en base ;
//   statut             'actif' | 'remplace' ;
//   remplacePar        identifiant de la pièce qui l'a remplacée ;
//   remplaceLe         date du remplacement (« AAAA-MM-JJ ») ;
//   motifRemplacement  motif libre, si l'architecte le saisit.
// UNE PIÈCE REMPLACÉE N'EST JAMAIS EFFACÉE : l'historique reste lisible, un
// chiffre figurant dans un document déjà émis doit pouvoir être expliqué six
// mois plus tard. L'ABSENCE de statut (dossiers créés avant ce champ) vaut
// 'actif' — importerJSON() la complète à la lecture.
//
// ── Port de stockage (SPEC §6 quater) ──────────────────────────────────────
// La persistance passe par une interface de QUATRE méthodes asynchrones :
//   charger(id) -> Promise<Projet>      sauvegarder(projet) -> Promise<void>
//   lister() -> Promise<Projet[]>       supprimer(id) -> Promise<void>
// Deux adaptateurs l'implémentent dans ce module :
//   creerStockageIndexedDB() — l'implémentation actuelle (navigateur), défaut
//     de sauvegarderProjet()/chargerProjet(), dont la signature ne bouge pas ;
//   creerStockageMemoire() — Map en mémoire, adaptateur des tests Node.
// COMMENT S'ÉCRIRA LE SECOND ADAPTATEUR (base de données de l'agence,
// Supabase/Postgres) sans toucher aux générateurs ni à l'interface :
//   1. écrire creerStockageAgence() qui renvoie les MÊMES quatre méthodes
//      (mêmes promesses, mêmes erreurs explicites en français) ;
//   2. brancher UNE FOIS au démarrage :
//      definirStockageParDefaut(creerStockageAgence()).
// Générateurs et interface continuent d'appeler sauvegarderProjet() /
// chargerProjet() : ils ne savent jamais quel adaptateur est branché, et
// l'interface ne change pas. Le format d'export JSON (exporterJSON) reste la
// représentation d'échange : c'est le futur schéma de la base et le chemin de
// migration (exporter d'IndexedDB, importer en base).
//
// Hors navigateur (tests Node), l'adaptateur IndexedDB rejette avec le message
// explicite « IndexedDB indisponible hors navigateur » — l'échange multi-postes
// passe alors par exporterJSON() et importerJSON() (fichier PROJET.json dans
// l'arborescence de livraison), ou par creerStockageMemoire() pour les tests.

import { AGENCE_PAR_DEFAUT } from './referentiels.js';
// montantAvecVariantes (js/calculs.js) est la SOURCE UNIQUE du montant retraité
// des variantes retenues : etatEntreprise vérifie « un devis actif avec ses
// montants » avec, et ecartDevis calcule l'écart sur le HT retenu avec. La règle
// n'est jamais réimplémentée ici (règle anti-duplication du dépôt) ; le module
// calculs est pur et sans dépendance, aucun cycle n'est créé.
import { montantAvecVariantes } from './calculs.js';

// Taux et pénalités par défaut : retenue de garantie 5 % (cf. cahier des
// charges, « 5% de retenue de garantie »), pénalités 1/3000e par jour plafonnées
// à 5 % du marché — valeurs paramétrables dans le Projet.
const RG_DEFAUT = 0.05;
const PENALITES_DEFAUT = { tauxJournalier: 1 / 3000, montantMaxPct: 5 };

// Statuts admissibles d'une PIÈCE (devis, attestation — SPEC §6 quater) :
// 'actif' par défaut (dossiers existants), 'remplace' quand une nouvelle pièce
// prend le relais. Une pièce remplacée n'est jamais effacée ni réécrite.
const STATUTS_PIECE = ['actif', 'remplace'];

// Canevas CRC n°01 vide — extension optionnelle du modèle (SPEC §2, arbitrage du
// 25/09/2026) consommée par le générateur CRC. contacts est un OBJET
// INDEXÉ par identifiant d'entreprise ({ [entrepriseId]: { tel, email } }), PAS un
// tableau : le générateur ne doit pas réindexer lui-même (règle anti-duplication).
const CRC_VIDE = () => ({
  dateReunion: null,
  intervenants: [],
  generalites: [],
  sections: [],
  contacts: {},
});

// Intervenants du CCAP (extension optionnelle, consommée par le générateur de
// marché). null tant qu'aucun intervenant n'est saisi ; chaque intervenant saisi
// est un objet libre (nom, adresse, tel, email, note) documenté dans
// MODELE-DONNEES.md — la forme exacte des sous-champs reste à l'interface.
const MARCHE_VIDE = () => ({
  controleTechnique: null,
  sps: null,
  geotechnicien: null,
  opc: null,
});

// Champs du modèle dont la valeur est une date (utilisés par la normalisation).
// 'remplaceLe' (cycle de vie des pièces, SPEC §6 quater) y figure : il suit le
// même canon « AAAA-MM-JJ », conversion « JJ/MM/AAAA » incluse à l'import.
const CHAMPS_DATES = ['date', 'dateDebut', 'dateReunion', 'valideDu', 'valideAu', 'droc', 'faitLe', 'remplaceLe'];

/**
 * Identifiant de projet (chaîne). crypto.randomUUID() quand disponible
 * (navigateur et Node >= 19), repli déterministe sinon.
 * @returns {string}
 */
function genererId() {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Normalise une valeur de date vers « AAAA-MM-JJ ».
 * Accepte « AAAA-MM-JJ » (déjà canonique) et « JJ/MM/AAAA » (saisie utilisateur).
 * Lève une erreur explicite pour toute autre forme : l'état persisté doit rester
 * homogène (aucune date ambiguë du type 03/04 qui dépendrait d'une locale).
 * @param {string} valeur
 * @param {string} chemin  désignation du champ pour le message d'erreur
 * @returns {string|null}
 */
function normaliserDate(valeur, chemin) {
  if (valeur == null || valeur === '') return null;
  if (typeof valeur !== 'string') {
    throw new TypeError(chemin + ' : date en chaîne attendue, reçu ' + String(valeur));
  }
  const iso = valeur.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, a, m, j] = iso;
    if (Number(m) < 1 || Number(m) > 12 || Number(j) < 1 || Number(j) > 31) {
      throw new RangeError(chemin + ' : date calendaire invalide (« ' + valeur + ' »)');
    }
    return valeur;
  }
  const fr = valeur.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) {
    const jj = fr[1].padStart(2, '0');
    const mm = fr[2].padStart(2, '0');
    if (Number(mm) < 1 || Number(mm) > 12 || Number(jj) < 1 || Number(jj) > 31) {
      throw new RangeError(chemin + ' : date calendaire invalide (« ' + valeur + ' »)');
    }
    return fr[3] + '-' + mm + '-' + jj;
  }
  throw new Error(chemin + ' : date non reconnue (« ' + valeur + ' ») — formats acceptés AAAA-MM-JJ ou JJ/MM/AAAA');
}

/**
 * Parcourt récursivement une valeur et normalise les champs de dates ; convertit
 * toute Date échappée au modèle en chaîne « AAAA-MM-JJ » ; renvoie une copie
 * fraîche (l'entrée n'est jamais mutée).
 * @param {*} v
 * @param {string} chemin
 */
function normaliserArbre(v, chemin) {
  if (v instanceof Date) {
    // Sécurité : une Date échappée au modèle devient une chaîne locale canonique.
    const a = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const j = String(v.getDate()).padStart(2, '0');
    return a + '-' + m + '-' + j;
  }
  if (Array.isArray(v)) return v.map((x, i) => normaliserArbre(x, chemin + '[' + i + ']'));
  if (v && typeof v === 'object') {
    const sortie = {};
    for (const [cle, valeur] of Object.entries(v)) {
      sortie[cle] = CHAMPS_DATES.includes(cle)
        ? normaliserDate(valeur, chemin + '.' + cle)
        : normaliserArbre(valeur, chemin + '.' + cle);
    }
    return sortie;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new TypeError(chemin + ' : nombre non fini (NaN/Infinity) interdit dans l\'état persisté');
  }
  return v;
}

// Statut EFFECTIF d'une pièce (devis, attestation) : l'ABSENCE de statut
// dossiers créés avant le champ, SPEC §6 quater — vaut 'actif'. Jamais une
// erreur ni une valeur inventée : une pièce sans statut est une pièce vivante.
function statutDe(piece) {
  return piece && piece.statut === 'remplace' ? 'remplace' : 'actif';
}

// Date du jour au canon « AAAA-MM-JJ » (heure locale). Valeur par défaut de
// remplaceLe quand l'appelant ne fournit pas de date : le remplacement SE PASSE
// ce jour-là, c'est un fait d'opération horodaté au moment où il survient, pas
// une donnée devinée sur le dossier.
function dateCanoniqueDuJour() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Texte non vide ou chaîne vide — pour décider « champ connu / champ manquant »
// sans jamais deviner de valeur (les nombres sont convertis en texte lisible).
function texteOuVide(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Crée un projet vide conforme au modèle SPEC §2, pré-rempli avec les
 * référentiels de l'agence (aucune ressaisie des données constantes).
 * L'identifiant `id` (extension documentée : nécessaire comme clé IndexedDB)
 * est généré ici ; operation.lieuFait reprend le « FAIT À » de l'agence.
 * Les PIÈCES déposées ensuite dans devis[] et attestations[] portent les
 * champs de cycle de vie documentés en tête de module (SPEC §6 quater) :
 * id, nomFichier, sha256, statut, remplacePar, remplaceLe, motifRemplacement.
 * @returns {object} Projet
 */
export function creerProjetVide() {
  return {
    id: genererId(),
    operation: {
      reference: '',
      intitule: '',
      adresse: '',
      cp: '',
      ville: '',
      droc: null,
      dureePrevisionnelleMois: null,
      coutTravauxHT: null, // coût total de construction HT déclaré par le MO (seuils d'assurance 26 M€ / 6 M€, SPEC §4)
      ouvertureChantier: null, // date réelle d'ouverture de chantier (annexe I art. A. 243-1) ; à défaut controler() présume la DROC et le signale
      ouvrageSoumis: null, // true (art. L. 241-1) | false (art. L. 243-1-1) | null : choisit le seuil de coût applicable
      pc: null,
      faitLe: null,
      lieuFait: AGENCE_PAR_DEFAUT.lieuFait,
    },
    maitreOuvrage: {
      raisonSociale: '',
      representant: '',
      qualiteRepresentant: '',
      siren: '',
      adresse: '',
      cp: '',
      ville: '',
    },
    agence: { ...AGENCE_PAR_DEFAUT },
    entreprises: [],
    devis: [],
    attestations: [],
    equipe: {
      architecteSignataire: '',
      conducteursTravaux: [],
    },
    retenueGarantieTaux: RG_DEFAUT,
    penalites: { ...PENALITES_DEFAUT },
    // Extensions optionnelles des générateurs DOCX (SPEC §2, tolérées absentes) :
    // créées vides ici pour que l'interface puisse les remplir sans les deviner.
    marche: MARCHE_VIDE(),
    crc: CRC_VIDE(),
    OS: [],
    avenants: [],
  };
}

/**
 * Sérialise le projet en JSON stable (clés triées, dates canoniques, aucun
 * objet Date, aucun NaN/Infinity) — indenté pour être diffable entre postes.
 * Les champs de cycle de vie des pièces (statut, remplacePar, remplaceLe,
 * motifRemplacement…) sont transportés TELS QUELS : l'export JSON est la
 * représentation d'échange du port de stockage (SPEC §6 quater).
 * @param {object} projet
 * @returns {string}
 */
export function exporterJSON(projet) {
  if (!projet || typeof projet !== 'object' || Array.isArray(projet)) {
    throw new TypeError('exporterJSON : projet objet attendu');
  }
  const propre = trierCles(normaliserArbre(projet, 'projet'));
  return JSON.stringify(propre, null, 2) + '\n';
}

// Réordonne récursivement les clés d'un objet (stabilité du JSON exporté).
function trierCles(v) {
  if (Array.isArray(v)) return v.map(trierCles);
  if (v && typeof v === 'object') {
    const sortie = {};
    for (const cle of Object.keys(v).sort()) sortie[cle] = trierCles(v[cle]);
    return sortie;
  }
  return v;
}

/**
 * Complète l'identité et le statut d'une PIÈCE (devis ou attestation, SPEC
 * §6 quater) à l'import. Une pièce sans identifiant (dossier créé avant le
 * champ) en reçoit un : sans identité, une pièce ne peut être ni éditée ni
 * remplacée. L'ABSENCE de statut vaut 'actif'. Les autres champs de cycle de
 * vie (nomFichier, sha256, remplacePar, remplaceLe, motifRemplacement) passent
 * TELS QUELS : une donnée absente reste absente, jamais inventée, et l'histoire
 * d'une pièce remplacée n'est jamais effacée ni réécrite.
 * @param {*} piece
 * @param {string} liste  nom de la liste, pour les messages d'erreur
 * @param {number} index  position dans la liste, pour les messages d'erreur
 * @returns {object}
 */
function normaliserPiece(piece, liste, index) {
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
    throw new Error('importerJSON : ' + liste + '[' + index + '] doit être un objet pièce');
  }
  const complete = { ...piece };
  if (!complete.id) complete.id = genererId();
  if (complete.statut === undefined || complete.statut === null || complete.statut === '') {
    complete.statut = 'actif';
  } else if (!STATUTS_PIECE.includes(complete.statut)) {
    throw new Error('importerJSON : ' + liste + '[' + index + '].statut inconnu « ' + complete.statut + ' » — valeurs admises : actif, remplace');
  }
  return complete;
}

/**
 * Relit une chaîne JSON (exporterJSON ou saisie externe) et renvoie un Projet
 * normalisé : dates converties en « AAAA-MM-JJ », sections obligatoires
 * vérifiées, listes et paramètres par défaut complétés, pièces (devis,
 * attestations) recevant identité et statut si elles en manquent.
 * @param {string} texte
 * @returns {object} Projet
 */
export function importerJSON(texte) {
  if (typeof texte !== 'string') {
    throw new TypeError('importerJSON : chaîne JSON attendue');
  }
  let brut;
  try {
    brut = JSON.parse(texte);
  } catch (e) {
    throw new Error('importerJSON : JSON invalide (' + e.message + ')');
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    throw new Error('importerJSON : le JSON doit être un objet Projet');
  }
  for (const section of ['operation', 'maitreOuvrage', 'agence']) {
    if (!brut[section] || typeof brut[section] !== 'object') {
      throw new Error('importerJSON : section obligataire absente « ' + section + ' »');
    }
  }
  const listeDefaut = ['entreprises', 'devis', 'attestations', 'OS', 'avenants'];
  for (const liste of listeDefaut) {
    if (brut[liste] === undefined) brut[liste] = [];
    if (!Array.isArray(brut[liste])) {
      throw new Error('importerJSON : « ' + liste + ' » doit être un tableau');
    }
  }
  // Pièces (devis, attestations — SPEC §6 quater) : identité et statut
  // complétés pour les dossiers créés avant ces champs ; l'ABSENCE de statut
  // vaut 'actif', l'historique d'une pièce remplacée passe TEL QUEL.
  brut.devis = brut.devis.map((piece, i) => normaliserPiece(piece, 'devis', i));
  brut.attestations = brut.attestations.map((piece, i) => normaliserPiece(piece, 'attestations', i));
  if (brut.retenueGarantieTaux === undefined) brut.retenueGarantieTaux = RG_DEFAUT;
  if (brut.penalites === undefined) brut.penalites = { ...PENALITES_DEFAUT };
  if (brut.equipe === undefined) brut.equipe = { architecteSignataire: '', conducteursTravaux: [] };
  // Extensions optionnelles (SPEC §2) : un projet antérieur à leur création, ou
  // dont la section est partielle, reçoit les clés manquantes — les données
  // présentes ne sont jamais écrasées ; les générateurs DOCX n'ont pas à garder.
  brut.crc = brut.crc && typeof brut.crc === 'object' ? { ...CRC_VIDE(), ...brut.crc } : CRC_VIDE();
  brut.marche = brut.marche && typeof brut.marche === 'object' ? { ...MARCHE_VIDE(), ...brut.marche } : MARCHE_VIDE();
  return normaliserArbre(brut, 'projet');
}

// --------------------------------------------------------------------------
// Complétude d'un dossier entreprise (SPEC §6 ter) et cycle de vie des
// pièces (SPEC §6 quater).
//
// Ces fonctions sont PURES : elles ne mutent jamais le projet reçu. RÈGLE
// CENTRALE (SPEC §6 ter) : la complétude est une INFORMATION, jamais une
// condition d'accès — etatEntreprise ne lève JAMAIS pour signaler un manque,
// elle le décrit dans `manquants` en libellés lisibles par un architecte.
// Une erreur levée ne peut viser qu'un mauvais usage (arguments non
// conformes), jamais l'état du dossier.
// --------------------------------------------------------------------------

/**
 * État de complétude du dossier d'une entreprise (SPEC §6 ter).
 *
 * osPret  exige : raison sociale, lot, un devis ACTIF avec ses montants et une
 *         date d'ordre de service (OS[].date) ou de démarrage (OS[].dateDebut).
 *         Le reste — SIREN, adresse, représentant — peut manquer : l'OS sort
 *         avec les lignes vides du gabarit, jamais avec une valeur inventée.
 * crcPret exige seulement : raison sociale et lot — le CRC liste les
 *         entreprises connues, cellules vides comprises (on sait qui fait
 *         quoi, même quand le marché n'est pas signé).
 * manquants : ce qui manque à l'OS, le plus exigeant des deux — en libellés
 *         français, pas en noms de champs techniques. L'interface affiche
 *         « en attente » AVEC cette liste au lieu de refuser en silence.
 *
 * @param {object} projet
 * @param {string} entrepriseId
 * @returns {{osPret: boolean, crcPret: boolean, manquants: string[]}}
 */
export function etatEntreprise(projet, entrepriseId) {
  if (!projet || typeof projet !== 'object') {
    throw new TypeError('etatEntreprise : projet objet attendu');
  }
  if (typeof entrepriseId !== 'string' || entrepriseId === '') {
    throw new TypeError('etatEntreprise : entrepriseId (chaîne non vide) attendu');
  }
  const entreprise = Array.isArray(projet.entreprises)
    ? projet.entreprises.find((e) => e && e.id === entrepriseId)
    : null;
  if (!entreprise) {
    // Entreprise inconnue : on DÉCRIT, on ne lève pas (complétude = information).
    return {
      osPret: false,
      crcPret: false,
      manquants: ['entreprise « ' + entrepriseId + ' » introuvable dans le dossier'],
    };
  }
  const raisonSociale = texteOuVide(entreprise.raisonSociale);
  const lotConnu = Boolean(texteOuVide(entreprise.lotNom) || texteOuVide(entreprise.lotNumero));
  // Le devis ACTIF — source unique devisActif() ; l'interface et les
  // générateurs voient exactement la même pièce.
  const devis = devisActif(projet, entrepriseId);
  let montantsLisibles = false;
  if (devis) {
    try {
      // Le HT retraité des variantes retenues, calculé par la source unique.
      // Si un montant est illisible (htBase manquant, variante incohérente),
      // c'est un MANQUE à décrire, pas une erreur à lever.
      const m = montantAvecVariantes(devis, { tvaTaux: 0.2 });
      montantsLisibles = Number.isFinite(m.ht);
    } catch {
      montantsLisibles = false;
    }
  }
  // Date d'ordre de service : signature (OS[].date) ou démarrage
  // (OS[].dateDebut) — l'une des deux suffit, ce sont les deux cellules de
  // date du gabarit OS (SPEC §5).
  const ordres = Array.isArray(projet.OS) ? projet.OS : [];
  const dateOsConnue = ordres.some((o) => o && o.entrepriseId === entrepriseId
    && (texteOuVide(o.date) || texteOuVide(o.dateDebut)));
  // manquants décrit EXACTEMENT ce qu'exige un OS — osPret n'est donc rien de
  // plus que « la liste est vide » : les deux ne peuvent pas diverger.
  const manquants = [];
  if (!raisonSociale) manquants.push('raison sociale de l\'entreprise');
  if (!lotConnu) manquants.push('nom du lot');
  if (!devis) manquants.push('devis retenu');
  else if (!montantsLisibles) manquants.push('montants du devis retenu');
  if (!dateOsConnue) manquants.push('date de l\'ordre de service');
  const osPret = manquants.length === 0;
  const crcPret = Boolean(raisonSociale && lotConnu);
  return { osPret, crcPret, manquants };
}

/**
 * Le devis ACTIF d'une entreprise (SPEC §6 quater) : celui que les documents
 * générés utilisent, TOUJOURS. SOURCE UNIQUE — les générateurs appellent cette
 * fonction et ne refiltrent jamais projet.devis à la main (un filtre
 * réimplémenté est une règle qui finit par diverger).
 *
 * L'ABSENCE de statut (dossiers créés avant le champ) vaut 'actif'. S'il
 * reste plusieurs devis actifs, le dernier déposé (fin de liste, ordre de
 * saisie) gagne : déterministe, et cohérent avec remplacerDevis() qui ajoute
 * le nouveau en fin de liste.
 *
 * @param {object} projet
 * @param {string} entrepriseId
 * @returns {object|null} le devis actif, ou null — aucun devis actif est un
 *   manque à décrire (etatEntreprise), jamais une erreur à lever
 */
export function devisActif(projet, entrepriseId) {
  if (!projet || typeof projet !== 'object') {
    throw new TypeError('devisActif : projet objet attendu');
  }
  if (typeof entrepriseId !== 'string' || entrepriseId === '') {
    throw new TypeError('devisActif : entrepriseId (chaîne non vide) attendu');
  }
  if (!Array.isArray(projet.devis)) return null;
  const actifs = projet.devis.filter((d) => d && d.entrepriseId === entrepriseId && statutDe(d) === 'actif');
  return actifs.length > 0 ? actifs[actifs.length - 1] : null;
}

/**
 * Remplace un devis par un nouveau (SPEC §6 quater). L'ancien passe à
 * 'remplace' avec remplaceLe (date du remplacement), motifRemplacement (si
 * l'architecte le saisit) et remplacePar (identifiant du nouveau) ; le nouveau
 * entre en 'actif'. RIEN n'est jamais supprimé : les deux coexistent dans
 * projet.devis, l'historique reste lisible. Une pièce remplacée déjà marquée
 * 'remplace' n'est jamais réécrite (le premier remplacement perdrait sa
 * trace) : la fonction refuse avec un message explicite.
 *
 * PURE : le projet reçu n'est jamais muté — un NOUVEAU projet est rendu, les
 * tests et l'interface peuvent comparer. Le nouveauDevis reçu n'est pas muté
 * non plus : identité (id) et entreprise (entrepriseId) lui sont données DANS
 * LA COPIE s'il en manque, et il entre en statut 'actif' quel que soit
 * l'objet fourni.
 *
 * Cette fonction ORGANISE un remplacement de devis AVANT signature. APRÈS la
 * signature, la modification ne passe pas par un devis mais par un AVENANT —
 * l'interface détecte la situation avec marcheSigne() et propose les deux
 * chemins ; l'outil PRÉPARE, l'architecte décide, aucun avenant n'est jamais
 * créé automatiquement.
 *
 * @param {object} projet
 * @param {string} ancienId  identifiant du devis remplacé (le devis ACTIF)
 * @param {object} nouveauDevis
 * @param {{motif?: string, date?: string}} [options]
 *        motif : motif libre du remplacement ; date : « AAAA-MM-JJ » ou
 *        « JJ/MM/AAAA » — défaut : le jour même (fait d'opération horodaté)
 * @returns {object} projet mis à jour
 */
export function remplacerDevis(projet, ancienId, nouveauDevis, options = {}) {
  const { motif, date } = options ?? {};
  if (!projet || typeof projet !== 'object' || Array.isArray(projet)) {
    throw new TypeError('remplacerDevis : projet objet attendu');
  }
  if (typeof ancienId !== 'string' || ancienId === '') {
    throw new TypeError('remplacerDevis : ancienId (chaîne non vide) attendu');
  }
  if (!nouveauDevis || typeof nouveauDevis !== 'object' || Array.isArray(nouveauDevis)) {
    throw new TypeError('remplacerDevis : nouveauDevis objet attendu');
  }
  if (!Array.isArray(projet.devis)) {
    throw new TypeError('remplacerDevis : projet.devis doit être un tableau');
  }
  const index = projet.devis.findIndex((d) => d && d.id === ancienId);
  if (index === -1) {
    throw new Error('remplacerDevis : devis introuvable (id « ' + ancienId + ' ») — aucune pièce remplacée');
  }
  const ancien = projet.devis[index];
  if (statutDe(ancien) === 'remplace') {
    // L'historique d'un remplacement antérieur ne se réécrit jamais : on
    // remplace le devis ACTIF (devisActif() le désigne sans ambiguïté).
    throw new Error('remplacerDevis : le devis « ' + ancienId + ' » est déjà remplacé — remplacer le devis actif de l\'entreprise');
  }
  // Le nouveau : copie d'abord (l'appelant n'est jamais muté), identité et
  // entreprise héritées au besoin, statut 'actif' IMPOSÉ (c'est lui que
  // devisActif() rendra).
  const nouveau = { ...nouveauDevis };
  if (!nouveau.id) nouveau.id = genererId();
  if (!nouveau.entrepriseId && ancien.entrepriseId) nouveau.entrepriseId = ancien.entrepriseId;
  nouveau.statut = 'actif';
  const ancienRemplace = {
    ...ancien,
    statut: 'remplace',
    remplaceLe: date ? normaliserDate(date, 'remplacerDevis : date') : dateCanoniqueDuJour(),
    remplacePar: nouveau.id,
    motifRemplacement: motif === undefined ? null : motif,
  };
  const devis = projet.devis.slice();
  devis[index] = ancienRemplace;
  devis.push(nouveau);
  return { ...projet, devis };
}

/**
 * Le marché de cette entreprise est-il signé ? (SPEC §6 quater) — vrai si
 * l'entreprise porte etat === 'marche_arrete' OU si un ordre de service
 * existe pour elle (un OS suit la signature : on n'émet jamais d'OS pour un
 * marché non signé). C'est la frontière entre les DEUX gestes : un devis
 * remplacé AVANT la signature donne un nouveau devis actif ; APRÈS, l'écart
 * entre l'ancien et le nouveau PRÉPARE un avenant — pré-rempli, jamais créé
 * automatiquement : un avenant modifie un contrat signé, il se négocie.
 * Une entreprise inconnue n'est pas signée : un booléen, jamais une erreur.
 * @param {object} projet
 * @param {string} entrepriseId
 * @returns {boolean}
 */
export function marcheSigne(projet, entrepriseId) {
  if (!projet || typeof projet !== 'object') {
    throw new TypeError('marcheSigne : projet objet attendu');
  }
  if (typeof entrepriseId !== 'string' || entrepriseId === '') {
    throw new TypeError('marcheSigne : entrepriseId (chaîne non vide) attendu');
  }
  const entreprise = Array.isArray(projet.entreprises)
    ? projet.entreprises.find((e) => e && e.id === entrepriseId)
    : null;
  if (entreprise && entreprise.etat === 'marche_arrete') return true;
  const osExiste = Array.isArray(projet.OS)
    ? projet.OS.some((o) => o && o.entrepriseId === entrepriseId)
    : false;
  return osExiste;
}

/**
 * Écart HT / TVA / TTC entre deux devis (SPEC §3 : une moins-value est
 * POSITIVE dans la fiche d'avenant — c'est `sens` qui porte la direction,
 * les montants sont TOUJOURS positifs). Cette fonction CALCULE un écart :
 * elle ne crée JAMAIS d'avenant, ne touche à aucun état — l'interface s'en
 * sert pour pré-remplir la fiche AV quand l'architecte choisit le chemin
 * « travaux modificatifs » après un remplacement post-signature.
 *
 * Chaque argument est soit une PIÈCE Devis (le HT retenu est calculé par
 * montantAvecVariantes — source unique, les variantes retenues comptent),
 * soit un montant HT déjà calculé (nombre). tvaTaux : 20 % par défaut —
 * le taux est un PARAMÈTRE, jamais une constante (SPEC §8).
 *
 * Convention d'écart nul : sens 'plus' avec des montants nuls (un écart nul
 * ne descend pas le marché). Précision : arrondi d'écriture à 4 décimales
 * (convention du dépôt, MODELE-DONNEES.md §1).
 *
 * @param {object|number} ancien   Devis ou montant HT
 * @param {object|number} nouveau  Devis ou montant HT
 * @param {{tvaTaux?: number}} [options]
 * @returns {{ht: number, tva: number, ttc: number, sens: 'plus'|'moins'}}
 */
export function ecartDevis(ancien, nouveau, options = {}) {
  const { tvaTaux = 0.2 } = options ?? {};
  if (typeof tvaTaux !== 'number' || !Number.isFinite(tvaTaux) || tvaTaux < 0 || tvaTaux > 1) {
    throw new RangeError('ecartDevis : tvaTaux entre 0 et 1 attendu, reçu ' + String(tvaTaux));
  }
  const htAncien = htRetenuDe(ancien, 'ecartDevis : ancien');
  const htNouveau = htRetenuDe(nouveau, 'ecartDevis : nouveau');
  const brut = arrondiMontant(htNouveau - htAncien);
  const ht = Math.abs(brut);
  const tva = arrondiMontant(ht * tvaTaux);
  const ttc = arrondiMontant(ht + tva);
  return { ht, tva, ttc, sens: brut >= 0 ? 'plus' : 'moins' };
}

// HT retenu d'un argument d'ecartDevis : une pièce Devis (via
// montantAvecVariantes, source unique du retraité des variantes retenues) ou
// un montant HT déjà calculé (nombre fini positif).
function htRetenuDe(piece, nom) {
  if (typeof piece === 'number') {
    if (!Number.isFinite(piece) || piece < 0) {
      throw new TypeError(nom + ' : montant HT (nombre fini positif) attendu, reçu ' + String(piece));
    }
    return piece;
  }
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
    throw new TypeError(nom + ' : Devis objet ou montant HT (nombre) attendu');
  }
  if (typeof piece.htBase !== 'number' || !Number.isFinite(piece.htBase) || piece.htBase < 0) {
    throw new TypeError(nom + ' : devis.htBase (nombre fini positif) attendu — montants illisibles');
  }
  const m = montantAvecVariantes(piece, { tvaTaux: 0.2 });
  return m.ht;
}

// Arrondi d'écriture à 4 décimales (convention du dépôt, MODELE-DONNEES.md §1) :
// supprime le bruit flottant sans toucher à la 3e décimale des gabarits réels.
function arrondiMontant(x) {
  return Math.round(x * 1e4) / 1e4;
}

// --------------------------------------------------------------------------
// Port de stockage (SPEC §6 quater).
//
// Interface du port — QUATRE méthodes asynchrones :
//   charger(id) -> Promise<Projet>      sauvegarder(projet) -> Promise<void>
//   lister() -> Promise<Projet[]>       supprimer(id) -> Promise<void>
// Deux adaptateurs l'implémentent dans ce module : IndexedDB (navigateur,
// défaut de sauvegarderProjet()/chargerProjet()) et mémoire (tests Node).
// Le SECOND adaptateur (base de données de l'agence) s'écrira sans toucher
// aux générateurs ni à l'interface — recette complète en tête de module.
// --------------------------------------------------------------------------

// Exige l'API IndexedDB ; message explicite hors navigateur (tests Node, CLI).
function exigerIndexedDB() {
  if (typeof globalThis.indexedDB === 'undefined') {
    throw new Error('etat : IndexedDB indisponible hors navigateur — utiliser exporterJSON/importerJSON pour l\'échange de projet');
  }
}

// Ouvre (et crée au besoin) la base locale. Promesse -> IDBDatabase.
function ouvrirBase() {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open('smt-projets', 1);
    demande.onupgradeneeded = () => {
      if (!demande.result.objectStoreNames.contains('projets')) {
        demande.result.createObjectStore('projets', { keyPath: 'id' });
      }
    };
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(new Error('etat : ouverture d\'IndexedDB impossible (' + demande.error + ')'));
  });
}

/**
 * Adaptateur IndexedDB du port de stockage : base « smt-projets », magasin
 * « projets », clé projet.id. Hors navigateur (tests Node), chaque méthode
 * rejette avec le message contractuel « IndexedDB indisponible hors
 * navigateur » — l'échange passe alors par exporterJSON/importerJSON.
 * Les messages d'erreur reprennent VERBATIM ceux de sauvegarderProjet() /
 * chargerProjet() d'avant le refactor : aucune rupture pour les appelants.
 * @returns {{charger: Function, sauvegarder: Function, lister: Function, supprimer: Function}}
 */
export function creerStockageIndexedDB() {
  return {
    /**
     * Lit un projet par son identifiant. Rejet explicite si absent.
     * @param {string} id
     * @returns {Promise<object>} Projet
     */
    async charger(id) {
      if (typeof id !== 'string' || id === '') {
        throw new TypeError('chargerProjet : identifiant (chaîne non vide) attendu');
      }
      exigerIndexedDB();
      const base = await ouvrirBase();
      return new Promise((resoudre, rejeter) => {
        const tx = base.transaction('projets', 'readonly');
        const demande = tx.objectStore('projets').get(id);
        demande.onsuccess = () => {
          if (demande.result === undefined) {
            rejeter(new Error('etat : projet introuvable dans IndexedDB (« ' + id + ' »)'));
          } else {
            resoudre(demande.result);
          }
        };
        demande.onerror = () => rejeter(new Error('etat : lecture impossible (' + demande.error + ')'));
      });
    },
    /**
     * Enregistre (crée ou remplace) un projet.
     * @param {object} projet
     * @returns {Promise<void>}
     */
    async sauvegarder(projet) {
      if (!projet || typeof projet !== 'object') {
        throw new TypeError('sauvegarderProjet : projet objet attendu');
      }
      if (!projet.id) {
        throw new Error('sauvegarderProjet : projet sans identifiant (id) — passer par creerProjetVide()');
      }
      exigerIndexedDB();
      const base = await ouvrirBase();
      return new Promise((resoudre, rejeter) => {
        const tx = base.transaction('projets', 'readwrite');
        tx.objectStore('projets').put(projet);
        tx.oncomplete = () => resoudre();
        tx.onerror = () => rejeter(new Error('etat : sauvegarde impossible (' + tx.error + ')'));
      });
    },
    /**
     * Liste tous les projets de la base.
     * @returns {Promise<object[]>}
     */
    async lister() {
      exigerIndexedDB();
      const base = await ouvrirBase();
      return new Promise((resoudre, rejeter) => {
        const tx = base.transaction('projets', 'readonly');
        const demande = tx.objectStore('projets').getAll();
        demande.onsuccess = () => resoudre(demande.result || []);
        demande.onerror = () => rejeter(new Error('etat : liste impossible (' + demande.error + ')'));
      });
    },
    /**
     * Supprime un projet par son identifiant (idempotent : supprimer une clé
     * absente ne lève pas).
     * @param {string} id
     * @returns {Promise<void>}
     */
    async supprimer(id) {
      if (typeof id !== 'string' || id === '') {
        throw new TypeError('supprimerProjet : identifiant (chaîne non vide) attendu');
      }
      exigerIndexedDB();
      const base = await ouvrirBase();
      return new Promise((resoudre, rejeter) => {
        const tx = base.transaction('projets', 'readwrite');
        tx.objectStore('projets').delete(id);
        tx.oncomplete = () => resoudre();
        tx.onerror = () => rejeter(new Error('etat : suppression impossible (' + tx.error + ')'));
      });
    },
  };
}

/**
 * Adaptateur MÉMOIRE du port de stockage : Map en mémoire de processus, sans
 * navigateur ni base — l'adaptateur des tests Node (aucun DOM requis) et des
 * usages jetables. Sémantique identique à IndexedDB : sauvegarder enregistre
 * une COPIE structurée (comme le fait IndexedDB), charger rend une copie
 * (l'appelant ne partage jamais l'objet stocké), lister rend tous les projets,
 * supprimer est idempotent. Hors ligne par construction : le test Node peut
 * donc exercer charger/sauvegarder/lister/supprimer pour de vrai.
 * @returns {{charger: Function, sauvegarder: Function, lister: Function, supprimer: Function}}
 */
export function creerStockageMemoire() {
  const projets = new Map();
  return {
    async charger(id) {
      if (typeof id !== 'string' || id === '') {
        throw new TypeError('stockage mémoire : identifiant (chaîne non vide) attendu');
      }
      if (!projets.has(id)) {
        throw new Error('stockage mémoire : projet introuvable (« ' + id + ' »)');
      }
      return structuredClone(projets.get(id));
    },
    async sauvegarder(projet) {
      if (!projet || typeof projet !== 'object') {
        throw new TypeError('stockage mémoire : projet objet attendu');
      }
      if (!projet.id) {
        throw new Error('stockage mémoire : projet sans identifiant (id) — passer par creerProjetVide()');
      }
      projets.set(projet.id, structuredClone(projet));
    },
    async lister() {
      return [...projets.values()].map((p) => structuredClone(p));
    },
    async supprimer(id) {
      if (typeof id !== 'string' || id === '') {
        throw new TypeError('stockage mémoire : identifiant (chaîne non vide) attendu');
      }
      projets.delete(id);
    },
  };
}

// Adaptateur PAR DÉFAUT du port : IndexedDB, créé à la première utilisation.
// definirStockageParDefaut() est le SEUL point de branchement d'un autre
// adaptateur (base de l'agence, adaptateur mémoire des tests) — les
// générateurs et l'interface, qui appellent sauvegarderProjet() /
// chargerProjet(), ne savent jamais quel adaptateur est branché.
let adaptateurDefaut = null;

/**
 * Branche un adaptateur du port de stockage comme défaut (recette du second
 * adaptateur, base de l'agence : une ligne au démarrage, rien d'autre à
 * changer). Vérifie que l'objet porte bien les QUATRE méthodes du port.
 * @param {{charger: Function, sauvegarder: Function, lister: Function, supprimer: Function}} adaptateur
 */
export function definirStockageParDefaut(adaptateur) {
  if (!adaptateur || typeof adaptateur !== 'object'
    || typeof adaptateur.charger !== 'function'
    || typeof adaptateur.sauvegarder !== 'function'
    || typeof adaptateur.lister !== 'function'
    || typeof adaptateur.supprimer !== 'function') {
    throw new TypeError('definirStockageParDefaut : adaptateur { charger, sauvegarder, lister, supprimer } attendu');
  }
  adaptateurDefaut = adaptateur;
}

/**
 * Adaptateur du port de stockage actuellement branché (IndexedDB tant qu'un
 * autre n'a pas été branché par definirStockageParDefaut).
 * @returns {{charger: Function, sauvegarder: Function, lister: Function, supprimer: Function}}
 */
export function stockageParDefaut() {
  if (!adaptateurDefaut) adaptateurDefaut = creerStockageIndexedDB();
  return adaptateurDefaut;
}

/**
 * Enregistre (crée ou remplace) le projet — SIGNATURE ET COMPORTEMENT
 * INCHANGÉS (refactor du port de stockage, SPEC §6 quater : IndexedDB par
 * défaut, base « smt-projets », magasin « projets », clé projet.id ; hors
 * navigateur, rejet « IndexedDB indisponible hors navigateur »).
 * @param {object} projet
 * @returns {Promise<void>}
 */
export function sauvegarderProjet(projet) {
  return stockageParDefaut().sauvegarder(projet);
}

/**
 * Charge un projet par son identifiant — SIGNATURE ET COMPORTEMENT INCHANGÉS.
 * @param {string} id
 * @returns {Promise<object>} Projet
 */
export function chargerProjet(id) {
  return stockageParDefaut().charger(id);
}
