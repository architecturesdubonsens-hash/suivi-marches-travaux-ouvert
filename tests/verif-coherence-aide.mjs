// tests/verif-coherence-aide.mjs — contrôle de cohérence de l'aide, SANS navigateur.
//
// POURQUOI CE CONTRÔLE EXISTE, ET CE QU'IL EMPÊCHE PRÉCISÉMENT.
// La barre de guidage de CapInSitu est aujourd'hui muette à cause d'une
// non-correspondance de clés : un dictionnaire d'ancres tenu à la main, à côté des
// identifiants réels, qui a cessé de correspondre sans que rien ne le signale. Le
// défaut n'est pas une faute d'inattention, c'est une conséquence de l'architecture :
// dès qu'une correspondance se maintient en double, elle divergera.
//
// Ici, la clé d'une fiche EST la chaîne que l'écran passe à titreAide(). Il n'y a donc
// aucune table à maintenir — mais il faut vérifier que les deux côtés se rejoignent
// RÉELLEMENT. C'est ce que fait ce fichier, dans les deux sens :
//   - toute clé citée par un écran a une fiche (sinon : bouton mort, ou pire, absent) ;
//   - toute fiche est atteignable, soit par un écran, soit rendue dans le mode d'emploi
//     (une fiche écrite sans être atteignable est pire que pas de fiche : on croit
//     l'avoir dite) ;
//   - toute section visée par une fiche existe dans SECTIONS ;
//   - tout jalon cité existe, et tout jalon renvoie à une fiche existante.
//
// Il contrôle en outre l'interdiction de données réelles : js/ est servi publiquement,
// et le référentiel public est déjà un problème ouvert. Aucun nom d'entreprise du
// référentiel, aucune suite de 9 chiffres ou plus (SIREN/SIRET), aucune référence
// d'opération ne doit entrer dans un texte d'aide.
//
// Exécution : node tests/verif-coherence-aide.mjs
// Sortie : liste des anomalies, et code de retour non nul s'il en reste une.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(join(racine, ...p)).href;

const { SECTIONS, FICHES, JALONS, FICHES_HORS_ECRAN } = await import(url('js', 'aide-contenu.js'));
const { ENTREPRISES_EXEMPLE, AGENCE_PAR_DEFAUT } = await import(url('js', 'referentiels.js'));

const anomalies = [];
const ko = (m) => anomalies.push(m);
const titres = new Set(SECTIONS.map((s) => s.titre));
const clesFiches = new Set(FICHES.map((f) => f.cle));
const clesJalons = new Set(JALONS.map((j) => j.cle));

/* ---- 1. Clés citées par les écrans ------------------------------------ */

const dossierUi = join(racine, 'js', 'ui');
const ecrans = readdirSync(dossierUi).filter((f) => f.startsWith('ecran-') && f.endsWith('.js'));
const citees = new Map(); // cle -> [fichiers]
for (const f of ecrans) {
  const src = readFileSync(join(dossierUi, f), 'utf8');
  for (const m of src.matchAll(/titreAide\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]+)"\s*\)/g)) {
    if (!citees.has(m[1])) citees.set(m[1], []);
    citees.get(m[1]).push(f);
  }
}

console.log('1. CLÉS CITÉES PAR LES ÉCRANS');
console.log('   ' + ecrans.length + ' écrans, ' + citees.size + ' clés distinctes citées');
for (const [cle, fichiers] of citees) {
  if (!clesFiches.has(cle)) ko('écran ' + fichiers.join('/') + ' : aucune fiche pour la clé « ' + cle + ' »');
}
if (citees.size === 0) ko('aucun écran ne cite titreAide() : l\'aide contextuelle n\'est branchée nulle part');

/* ---- 2. Atteignabilité de chaque fiche, dans les deux sens ------------ */

console.log('');
console.log('2. ATTEIGNABILITÉ DES FICHES');
const horsEcran = new Set(FICHES_HORS_ECRAN.map((f) => f.cle));
for (const f of FICHES) {
  const surEcran = citees.has(f.cle);
  if (f.horsEcran === true) {
    if (surEcran) ko('fiche « ' + f.cle + ' » marquée horsEcran mais citée par ' + citees.get(f.cle).join('/'));
  } else if (!surEcran) {
    ko('fiche « ' + f.cle + ' » inatteignable : aucun écran ne la cite, et elle n\'est pas marquée horsEcran');
  }
}
console.log('   ' + (FICHES.length - horsEcran.size) + ' fiches sur écran, ' + horsEcran.size
  + ' rendues dans le mode d\'emploi, ' + FICHES.length + ' au total');

/* ---- 3. Renvois : section, jalon -------------------------------------- */

console.log('');
console.log('3. RENVOIS CROISÉS');
for (const f of FICHES) {
  if (!f.titre) ko('fiche « ' + f.cle + ' » sans titre');
  if (!titres.has(f.section)) ko('fiche « ' + f.cle + ' » renvoie à la section « ' + f.section + ' », qui n\'existe pas');
  if (f.jalon && !clesJalons.has(f.jalon)) ko('fiche « ' + f.cle + ' » renvoie au jalon « ' + f.jalon + ' », inconnu');
  if (!Array.isArray(f.blocs) || f.blocs.length === 0) ko('fiche « ' + f.cle + ' » sans contenu');
}
for (const j of JALONS) {
  if (!['outil', 'partiel', 'absent'].includes(j.couverture)) ko('jalon « ' + j.cle + ' » : couverture « ' + j.couverture + ' » hors des trois valeurs admises');
  if (j.fiche && !clesFiches.has(j.fiche)) ko('jalon « ' + j.cle + ' » renvoie à la fiche « ' + j.fiche + ' », inconnue');
  if (!j.engage) ko('jalon « ' + j.cle + ' » ne dit pas ce qui engage');
}
const doublons = FICHES.map((f) => f.cle).filter((c, i, t) => t.indexOf(c) !== i);
if (doublons.length) ko('clés de fiche en double : ' + doublons.join(', '));
console.log('   ' + JALONS.length + ' phases du marché, ' + SECTIONS.length + ' sections du mode d\'emploi');
const couv = JALONS.reduce((a, j) => { a[j.couverture] = (a[j.couverture] || 0) + 1; return a; }, {});
console.log('   couverture : ' + Object.entries(couv).map(([k, v]) => v + ' ' + k).join(', '));

/* ---- 4. Aucune donnée réelle dans les textes d'aide ------------------- */

console.log('');
console.log('4. AUCUNE DONNÉE RÉELLE DANS L\'AIDE');
// On repart du FICHIER SOURCE et pas seulement des objets : un nom glissé dans un
// commentaire serait servi au navigateur comme le reste.
const source = readFileSync(join(racine, 'js', 'aide-contenu.js'), 'utf8');
const chiffres = source.match(/\d{9,}/g) || [];
if (chiffres.length) ko('suite(s) de 9 chiffres ou plus dans js/aide-contenu.js (SIREN/SIRET ?) : ' + chiffres.join(', '));

const interdits = [];
for (const e of ENTREPRISES_EXEMPLE || []) if (e && e.raisonSociale) interdits.push(e.raisonSociale);
if (AGENCE_PAR_DEFAUT && AGENCE_PAR_DEFAUT.raisonSociale) interdits.push(AGENCE_PAR_DEFAUT.raisonSociale);
if (AGENCE_PAR_DEFAUT && AGENCE_PAR_DEFAUT.representant) interdits.push(AGENCE_PAR_DEFAUT.representant);
const hautSource = source.toUpperCase();
for (const nom of interdits) {
  if (hautSource.includes(nom.toUpperCase())) ko('nom du référentiel présent dans l\'aide : « ' + nom + ' »');
}
// Références d'opération de la forme VB00-00 / VB0000.
const refs = source.match(/\bVB\s?\d{2}-?\d{2,}\b/gi) || [];
if (refs.length) ko('référence(s) d\'opération dans l\'aide : ' + refs.join(', '));
console.log('   ' + interdits.length + ' noms du référentiel contrôlés, ' + chiffres.length
  + ' suite(s) de chiffres longue(s), ' + refs.length + ' référence(s) d\'opération');

/* ---- 5. L'aide n'est pas le seul lieu d'un avertissement -------------- */

console.log('');
console.log('5. UN AVERTISSEMENT N\'EST PAS DE L\'AIDE');
// Le défaut du 25/09/2026 : un avertissement déplacé dans la fenêtre d'aide cesse
// d'être lu. On vérifie que la formulation de l'alerte vient d'avertissements.js, que
// l'aide ne la réécrit pas pour son compte, et qu'elle est bien rendue dans #bandeau.
const srcAvert = readFileSync(join(racine, 'js', 'ui', 'avertissements.js'), 'utf8');
const srcAide = readFileSync(join(racine, 'js', 'ui', 'aide.js'), 'utf8');
if (!srcAvert.includes('getElementById("bandeau")')) {
  ko('avertissements.js n\'écrit pas dans #bandeau : l\'avertissement ne serait visible nulle part à l\'écran');
}
if (!srcAide.includes('etatBaseEnUnePhrase')) {
  ko('aide.js ne reprend pas la formulation d\'avertissements.js : deux textes pour la même alerte');
}
if (/inscription publique est (actuellement )?OUVERTE/i.test(source)) {
  ko('js/aide-contenu.js écrit son propre texte d\'alerte : l\'avertissement doit venir d\'avertissements.js');
}
if (!/addEventListener\("reglages-base-lus"/.test(srcAvert)) {
  ko('avertissements.js n\'écoute pas la lecture des réglages : une alerte arrivant après le rendu resterait invisible');
}
console.log('   bandeau d\'écran : ' + (srcAvert.includes('getElementById("bandeau")') ? 'oui' : 'NON')
  + ' · formulation partagée : ' + (srcAide.includes('etatBaseEnUnePhrase') ? 'oui' : 'NON')
  + ' · rafraîchissement asynchrone : ' + (/addEventListener\("reglages-base-lus"/.test(srcAvert) ? 'oui' : 'NON'));

/* ---- 6. Aucun jargon de construction dans un texte affiché ------------ */

console.log('');
console.log('6. AUCUN JARGON DE CONSTRUCTION DANS UN TEXTE AFFICHÉ');
// Les quatre agents (A, B, C pour les modules, D pour l'interface) étaient la
// répartition d'une session de construction du 25/09/2026. Onze messages affichés les
// nommaient, et attribuaient à une livraison en retard ce qui est en réalité un échec
// de chargement. Le diagnostic est utile et reste — en console et dans l'indicateur de
// l'écran Génération ; le vocabulaire, lui, ne doit pas revenir dans un texte vu par
// l'utilisateur. Contrôlé ici parce que rien d'autre ne l'empêche.
const CHEMINS_AFFICHAGE = /(texte:|textContent\s*=|toast\(|majIndicateur\(|throw new Error\()/;
const INTERDITS = [
  [/agent\s+[A-D]\b/i, "mention d'un agent (A, B, C ou D)"],
  [/coordinateur/i, 'mention du « coordinateur »'],
  [/modules? partenaires?/i, 'vocabulaire « module partenaire »'],
  [/d[èe]s sa livraison|en attente de livraison/i, '« dès sa livraison » : rien n\'est en cours de livraison'],
  [/js\/[a-z-]+\.js/, "nom de fichier dans un texte affiché"],
];
const aBalayer = [];
for (const f of readdirSync(join(racine, 'js'))) if (f.endsWith('.js')) aBalayer.push(['js', f]);
for (const f of readdirSync(dossierUi)) if (f.endsWith('.js')) aBalayer.push(['js', 'ui', f]);
let lignesVues = 0;
for (const parts of aBalayer) {
  const chemin = join(racine, ...parts);
  const lignes = readFileSync(chemin, 'utf8').split(/\r?\n/);
  lignes.forEach((ligne, i) => {
    const nu = ligne.trim();
    if (nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*')) return; // commentaires : autorisés
    if (!CHEMINS_AFFICHAGE.test(ligne)) return;
    lignesVues += 1;
    // Les appels à messageIndisponible() et les traces console sont la solution, pas le problème.
    if (/messageIndisponible\(|def\.chemin|console\./.test(ligne)) return;
    for (const [motif, quoi] of INTERDITS) {
      if (motif.test(ligne)) ko(parts.join('/') + ':' + (i + 1) + ' : ' + quoi);
    }
  });
}
console.log('   ' + lignesVues + ' lignes de texte affiché balayées, ' + INTERDITS.length + ' motifs interdits');

// L'indicateur de l'écran Génération doit rester CONDITIONNEL.
const srcModules = readFileSync(join(dossierUi, 'etat-modules.js'), 'utf8');
if (!/if \(manquants\.length === 0\) return null;/.test(srcModules)) {
  ko("construireIndicateur ne rend plus null quand tout va bien : la carte redeviendrait permanente");
}
for (const def of ['fonction:', 'malgre:']) {
  const n = (srcModules.match(new RegExp(def, 'g')) || []).length;
  if (n < 8) ko('etat-modules.js : ' + n + ' « ' + def + ' » pour 8 modules — un module sans libellé métier');
}
console.log('   indicateur conditionnel : ' + (/if \(manquants\.length === 0\) return null;/.test(srcModules) ? 'oui' : 'NON')
  + ' · libellés métier : ' + ((srcModules.match(/fonction:/g) || []).length) + '/8');

/* ---- Verdict ---------------------------------------------------------- */

console.log('');
if (anomalies.length === 0) {
  console.log('AUCUNE ANOMALIE.');
  process.exit(0);
}
console.log(anomalies.length + ' ANOMALIE(S) :');
for (const a of anomalies) console.log('  - ' + a);
process.exit(1);
