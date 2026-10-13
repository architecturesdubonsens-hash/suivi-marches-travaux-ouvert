// calculs.js — moteur de calcul pur.
//
// Aucune dépendance, aucun DOM, aucun import : ce module est directement
// exécutable côté navigateur comme sous Node (tests/calculs.mjs).
// La surface exportée est EXACTEMENT celle du contrat SPEC §8 — les modules
// partenaires (gen-os, gen-avenant, gen-marche, gen-crc, ui) n'importent que
// ces six fonctions.
//
// Conventions de précision : les montants sont renvoyés arrondis à la 4e
// décimale. Cela supprime le bruit flottant (97133.57 * 1.2 = 116560.28400000001
// en IEEE 754) tout en conservant la 3e décimale observée sur les gabarits
// réels (OS : 116560.284 ; 101253.696). L'ARRONDI COMPTABLE AU CENTIME reste du
// ressort de l'affichage et des gabarits, pas du moteur.

const TVA_DEFAUT = 0.2; // TVA 20 % : source unique du DÉFAUT des paramètres tvaTaux (le taux est toujours un paramètre, SPEC §8)

// Arrondit x à 4 décimales (fonction interne du module).
function arrondi(x) {
  return Math.round(x * 1e4) / 1e4;
}

// Vérifie qu'une valeur est un nombre fini (fonction interne, messages en français).
function exigerNombre(valeur, nom, options = {}) {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
    throw new TypeError(nom + ' : nombre fini attendu, reçu ' + afficher(valeur));
  }
  if (options.min !== undefined && valeur < options.min) {
    throw new RangeError(nom + ' : valeur ' + valeur + ' inférieure au minimum ' + options.min);
  }
  if (options.max !== undefined && valeur > options.max) {
    throw new RangeError(nom + ' : valeur ' + valeur + ' supérieure au maximum ' + options.max);
  }
  return valeur;
}

// Représentation lisible d'une valeur reçue pour les messages d'erreur internes.
function afficher(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

// --------------------------------------------------------------------------
// montantAvecVariantes — montant du devis retraité par les variantes retenues.
//
// devis attendu (modèle Devis de SPEC §2) : { htBase, variantes: [...] }.
// Une variante { libelle, sens, ht, retenue } n'est prise en compte que si
// retenue === true (l'architecte l'a cochée avec le maître d'ouvrage).
// sens 'plus'  -> plus-value    : ajoutée au HT de base ;
// sens 'moins' -> moins-value   : déduite du HT de base ;
// sens 'option'-> option retenue: ajoutée (une option retenue s'ajoute, comme
//                                  une plus-value — arbitrage documenté dans
//                                  MODELE-DONNEES.md §Arbitrages).
// Renvoie { ht, tva, ttc } — TVA par défaut 20 %, surchargeable via tvaTaux.
export function montantAvecVariantes(devis, { tvaTaux = TVA_DEFAUT } = {}) {
  if (!devis || typeof devis !== 'object' || Array.isArray(devis)) {
    throw new TypeError('montantAvecVariantes : devis objet attendu, reçu ' + afficher(devis));
  }
  exigerNombre(devis.htBase, 'montantAvecVariantes : devis.htBase', { min: 0 });
  exigerNombre(tvaTaux, 'montantAvecVariantes : tvaTaux', { min: 0, max: 1 });
  const variantes = devis.variantes ?? [];
  if (!Array.isArray(variantes)) {
    throw new TypeError('montantAvecVariantes : devis.variantes doit être un tableau');
  }
  let ht = devis.htBase;
  for (const variante of variantes) {
    if (!variante || typeof variante !== 'object') {
      throw new TypeError('montantAvecVariantes : variante objet attendu, reçu ' + afficher(variante));
    }
    if (variante.retenue !== true) continue; // non retenue : ignorée (option non cochée)
    exigerNombre(variante.ht, 'montantAvecVariantes : variante « ' + (variante.libelle ?? '?') + ' ».ht', { min: 0 });
    switch (variante.sens) {
      case 'plus':
      case 'option':
        ht += variante.ht;
        break;
      case 'moins':
        ht -= variante.ht;
        break;
      default:
        throw new Error('montantAvecVariantes : sens de variante inconnu ' + afficher(variante.sens) +
          ' (attendus : \'plus\', \'moins\', \'option\')');
    }
  }
  ht = arrondi(ht);
  const tva = arrondi(ht * tvaTaux);
  const ttc = arrondi(ht + tva);
  return { ht, tva, ttc };
}

// --------------------------------------------------------------------------
// appliquerProrata — application du prorata au HT d'un devis.
//
// prorata attendu (modèle Devis de SPEC §2) : { mode, taux? }.
// - mode 'inclus' (ou prorata absent) : « PRO RATA INCLUS » tel que porté sur
//   l'OS — le HT affiché est inchangé, la TVA et le TTC sont calculés dessus
//   (le montant de référence du marché reste le TTC, cf. SPEC §3).
// - mode 'valeur' : prorata de valeur — seul le taux (0 à 1) du HT entre dans
//   le compte de l'entreprise ; TVA et TTC recalculés sur ce HT réduit.
// Le taux de TVA est un PARAMÈTRE ({tvaTaux = 0.2}, SPEC §8 du 25/09/2026),
// jamais une constante interne : un lot à prorata « valeur » et à taux
// particulier produirait un TTC faux sans que rien ne le signale si le 20 %
// restait codé en dur (défaut relevé sur les générateurs). Sans
// troisième argument, le comportement reste inchangé à 20 %.
export function appliquerProrata(ht, prorata, { tvaTaux = TVA_DEFAUT } = {}) {
  exigerNombre(ht, 'appliquerProrata : ht', { min: 0 });
  exigerNombre(tvaTaux, 'appliquerProrata : tvaTaux', { min: 0, max: 1 });
  const mode = prorata == null ? 'inclus' : prorata.mode;
  if (mode === 'inclus') {
    const tva = arrondi(ht * tvaTaux);
    return { ht: arrondi(ht), tva, ttc: arrondi(ht + tva) };
  }
  if (mode === 'valeur') {
    const taux = prorata.taux;
    exigerNombre(taux, 'appliquerProrata : prorata.taux', { min: 0, max: 1 });
    const htReduit = arrondi(ht * taux);
    const tva = arrondi(htReduit * tvaTaux);
    return { ht: htReduit, tva, ttc: arrondi(htReduit + tva) };
  }
  throw new Error('appliquerProrata : mode de prorata inconnu ' + afficher(mode) +
    " (attendus : 'inclus', 'valeur')");
}

// --------------------------------------------------------------------------
// montantEnLettres — retranscription en toutes lettres d'un montant en euros
// (colonne « Montant en toutes lettres » du CCAP / MT).
//
// Français rigoureux, orthographe traditionnelle (traits d'union et « et »)
// tel que le l'exige SPEC §3 : « zéro euro », « un euro », « cinq cent soixante
// mille euros », « soixante-douze euros et cinq centimes », mille invariable,
// « deux cents » (seul) mais « deux cent trois », pluriel « euros » sauf 0 et 1.
// Domaine : 0 à 999 999 999,99 € ; arrondi au centime ; hors domaine -> erreur.

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const DIX_A_DIX_NEUF = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

// Écrit 0..99. suitNombre : vrai si un mot-numéral (« mille ») suit immédiatement
// ce groupe — « quatre-vingt » perd alors son « s » (« quatre-vingt mille »),
// alors qu'il le garde devant un nom (« quatre-vingts euros »).
function nom99(r, suitNombre) {
  if (r === 0) return '';
  if (r < 10) return UNITES[r];
  if (r < 20) return DIX_A_DIX_NEUF[r - 10];
  if (r < 70) {
    const d = Math.floor(r / 10);
    const u = r % 10;
    const dizaine = DIZAINES[d];
    if (u === 0) return dizaine;
    if (u === 1) return dizaine + ' et un';
    return dizaine + '-' + UNITES[u];
  }
  if (r < 80) {
    const u = r - 60; // 10..19
    if (u === 11) return 'soixante et onze'; // 71 : seul cas en « et » de la famille 70
    return 'soixante-' + DIX_A_DIX_NEUF[u - 10]; // 70 -> soixante-dix, 72 -> soixante-douze...
  }
  // 80..99 : famille « quatre-vingt »
  if (r === 80) return suitNombre ? 'quatre-vingt' : 'quatre-vingts';
  return 'quatre-vingt-' + nom99(r - 80, suitNombre);
}

// Écrit 0..999. suitNombre : voir nom99 — il pilote aussi l'accord de « cent »
// (« deux cent mille » mais « deux cents euros »).
function nomCentaines(n, suitNombre) {
  if (n === 0) return '';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let tete;
  if (c === 0) tete = '';
  else if (c === 1) tete = 'cent'; // un seul cent : jamais de « s » et jamais de multiplicateur
  else tete = UNITES[c] + (r === 0 && !suitNombre ? ' cents' : ' cent');
  const reste = r > 0 ? (c > 0 ? ' ' : '') + nom99(r, suitNombre) : '';
  return tete + reste;
}

export function montantEnLettres(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError('montantEnLettres : nombre fini attendu, reçu ' + afficher(n));
  }
  if (n < 0) {
    throw new RangeError('montantEnLettres : montant négatif non géré (' + n + ') — traiter la valeur absolue côté appelant');
  }
  // Arrondi au centime (Math.round : comportement d'arrondi arithmétique standard).
  const centimesTotal = Math.round(n * 100);
  const MAX = 99999999999; // 999 999 999,99 € exprimé en centimes
  if (centimesTotal > MAX) {
    throw new RangeError('montantEnLettres : montant au-delà de 999 999 999,99 € (' + n + ')');
  }
  const euros = Math.floor(centimesTotal / 100);
  const centimes = centimesTotal % 100;

  // Découpage en groupes : millions | mille | unités (le domaine couvert va
  // jusqu'à 999 999 999 : pas de groupe « milliards »).
  const millions = Math.floor(euros / 1e6);
  const mille = Math.floor((euros % 1e6) / 1e3);
  const unites = euros % 1e3;

  const parties = [];
  if (millions > 0) {
    parties.push(millions === 1 ? 'un million' : nomCentaines(millions, false) + ' millions');
  }
  if (mille > 0) {
    // « mille » suit : les « cents »/« vingts » du groupe perdent leur accord.
    parties.push(mille === 1 ? 'mille' : nomCentaines(mille, true) + ' mille');
  }
  if (unites > 0) {
    parties.push(nomCentaines(unites, false));
  }

  // Suffixe « euro(s) » : pluriel sauf 0 et 1 (« zéro euro », « un euro »).
  // Après un « million(s) » terminal, liaison par « d'euros » (elision).
  let motEuros;
  if (euros === 0 || euros === 1) motEuros = ' euro';
  else if (millions > 0 && mille === 0 && unites === 0) motEuros = " d'euros";
  else motEuros = ' euros';

  const corps = parties.length > 0 ? parties.join(' ') : 'zéro';
  let phrase = corps + motEuros;
  if (centimes > 0) {
    phrase += ' et ' + nom99(centimes, false) + (centimes === 1 ? ' centime' : ' centimes');
  }
  return phrase;
}

// --------------------------------------------------------------------------
// montantEnLettresMajuscules — rendu CCAP exigé par le gabarit MT RÉEL de
// l'agence (constaté dans le .doc, SPEC §3 du 25/09/2026) :
//   « Soit en lettres : TTC SIX CENT SOIXANTE MILLE EUROS ET 00 CTS**** »
// Cette fonction rend la portion montant (le préfixe « Soit en lettres : TTC »
// appartient à la ligne du gabarit, pas au montant) : mots en MAJUSCULES,
// puis « ET nn CTS » avec les centimes TOUJOURS présents sur deux chiffres
// (00 si nuls), puis quatre astérisques. SOURCE UNIQUE du rendu CCAP : les
// générateurs l'utilisent et ne réimplémentent jamais ce format (pas de
// padding à leur charge).
// Accents : la typographie française accentue les majuscules (ZÉRO) ; les
// montants réels du corpus n'en portent pas, donc la divergence n'apparaît
// que sur un montant nul, sans objet en CCAP.
export function montantEnLettresMajuscules(n) {
  // Mêmes bornes et mêmes messages que montantEnLettres, visant l'argument reçu.
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError('montantEnLettresMajuscules : nombre fini attendu, reçu ' + afficher(n));
  }
  if (n < 0) {
    throw new RangeError('montantEnLettresMajuscules : montant négatif non géré (' + n + ') — traiter la valeur absolue côté appelant');
  }
  const centimesTotal = Math.round(n * 100);
  if (centimesTotal > 99999999999) {
    throw new RangeError('montantEnLettresMajuscules : montant au-delà de 999 999 999,99 € (' + n + ')');
  }
  const centimes = centimesTotal % 100;
  // Partie entière en mots via montantEnLettres : un entier ne produit jamais
  // de centimes, donc la chaîne se termine par « euros » et se transforme sans
  // parsing fragile (un « et » interne type « vingt et un » ne peut pas piéger).
  const mots = montantEnLettres(Math.floor(centimesTotal / 100));
  return mots.toUpperCase() + ' ET ' + String(centimes).padStart(2, '0') + ' CTS****';
}

// --------------------------------------------------------------------------
// chainageAvenant — chaînage financier exact du gabarit Avenant (cf. AV1 réel
// VOLTALIS, les documents d’origine et le fichier d’origine) :
//   (A) montant initial du lot à l'acte d'engagement ;
//   (B) montant total rectifié = (A) + cumul des avenants précédents ;
//   (C) montant en plus (plus-value du présent avenant) ;
//   (D) montant en moins (moins-value du présent avenant, valeur positive) ;
//   MONTANT CUMULE = (B) + (C) − (D)   (contrat SPEC §3).
// Tous les montants sont exprimés EN HT ; les colonnes TVA / TTC du gabarit
// valent x × tvaTaux et x × (1 + tvaTaux) (formules =F*0.2 / =F*1.2 du gabarit).
// tvaTaux est accepté pour homogénéité du contrat et validé, mais ne change pas
// les lettres (A..D) qui restent HT.
// avenantsPrecedents : tableau de nombres HT (effet net de chaque avenant
// antérieur) ou d'objets { montant } — même convention de signe.
export function chainageAvenant({ montantInitial, avenantsPrecedents = [], plusValue = 0, moinsValue = 0, tvaTaux = TVA_DEFAUT } = {}) {
  exigerNombre(montantInitial, 'chainageAvenant : montantInitial', { min: 0 });
  exigerNombre(plusValue, 'chainageAvenant : plusValue', { min: 0 });
  exigerNombre(moinsValue, 'chainageAvenant : moinsValue', { min: 0 });
  exigerNombre(tvaTaux, 'chainageAvenant : tvaTaux', { min: 0, max: 1 });
  if (!Array.isArray(avenantsPrecedents)) {
    throw new TypeError('chainageAvenant : avenantsPrecedents doit être un tableau (LISTE des effets nets HT de chaque avenant antérieur — JAMAIS un cumul déjà sommé : la règle (A)+(1)+(2)+(x) = (B) appartient à ce module seul, SPEC §8)');
  }
  let cumul = 0;
  for (const precedent of avenantsPrecedents) {
    const valeur = typeof precedent === 'number' ? precedent
      : (precedent && typeof precedent === 'object' ? precedent.montant : undefined);
    exigerNombre(valeur, 'chainageAvenant : avenantsPrecedents (élément)', {});
    cumul += valeur;
  }
  const A = arrondi(montantInitial);
  const B = arrondi(A + cumul);
  const C = arrondi(plusValue);
  const D = arrondi(moinsValue);
  const cumule = arrondi(B + C - D);
  return { A, B, C, D, cumule };
}

// --------------------------------------------------------------------------
// retenueGarantie — retenue de garantie (5 % par défaut, paramétrable),
// appliquée au montant HT du marché (convention : la RG se prélève sur les
// situations HT, cf. gabarit MT « situations mensuelles au 25 »).
export function retenueGarantie(montant, taux = 0.05) {
  exigerNombre(montant, 'retenueGarantie : montant', { min: 0 });
  exigerNombre(taux, 'retenueGarantie : taux', { min: 0, max: 1 });
  return arrondi(montant * taux);
}

// --------------------------------------------------------------------------
// penalites — pénalités de retard : montant du marché × taux journalier × jours,
// plafonnées à plafondPct % du montant du marché.
// Défauts : 1/3000e par jour plafonné à 5 % (habitude des marchés privés du
// cabinet) — les valeurs réelles proviennent de projet.penalites
// { tauxJournalier, montantMaxPct } et écrasent ces défauts.
// plafondPct = null désactive le plafond.
export function penalites({ montantMarche, jours, tauxJournalier = 1 / 3000, plafondPct = 5 } = {}) {
  exigerNombre(montantMarche, 'penalites : montantMarche', { min: 0 });
  exigerNombre(jours, 'penalites : jours', { min: 0 });
  exigerNombre(tauxJournalier, 'penalites : tauxJournalier', { min: 0, max: 1 });
  let montant = arrondi(montantMarche * tauxJournalier * jours);
  if (plafondPct !== null && plafondPct !== undefined) {
    exigerNombre(plafondPct, 'penalites : plafondPct', { min: 0 });
    const plafond = arrondi(montantMarche * (plafondPct / 100));
    if (montant > plafond) montant = plafond;
  }
  return montant;
}
