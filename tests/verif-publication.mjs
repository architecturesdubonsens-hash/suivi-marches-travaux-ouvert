// tests/verif-publication.mjs — ce qui part sur l'adresse PUBLIQUE de l'application.
//
// MOTIF, pour qu'on ne refasse pas l'erreur : au premier déploiement, .vercelignore
// listait ce qu'il fallait EXCLURE, et « db/ » n'y figurait pas. Le schéma de la base
// s'est donc retrouvé PUBLIC sur l'adresse de l'application — relevé le 25/09/2026 en
// confrontant les 73 fichiers versionnés à l'adresse en ligne (un seul était en trop).
//
// Une liste d'exclusions ne prévient pas quand on l'oublie. Une liste d'AUTORISATIONS,
// si. Ce contrôle transforme donc la doctrine en règle vérifiable : tout fichier
// versionné qui ne serait pas exclu ET qui ne figure pas dans la liste blanche
// ci-dessous fait ÉCHOUER le contrôle.
//
// Usage :
//   node tests/verif-publication.mjs                        contrôle hors ligne
//   node tests/verif-publication.mjs https://exemple.app    + confrontation à l'adresse
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || null;

// CE QUI A LE DROIT D'ÊTRE PUBLIÉ — liste blanche, volontairement étroite.
// L'application seule : aucune donnée d'agence, aucun dossier client, aucun document
// d'origine. Les deux gabarits publiés sont les formulaires VIDES.
const PUBLIES = [
  /^index\.html$/,
  /^css\/[^/]+\.css$/,
  /^js\/[^/]+\.js$/,
  /^js\/ui\/[^/]+\.js$/,
  /^vendor\/[^/]+\.js$/,
  /^gabarits\/(os|avenant)-gabarit\.xlsx$/,
];
// Fichiers de configuration : présents dans le dépôt, jamais servis par l'hébergeur.
const CONFIGURATION = [/^vercel\.json$/, /^\.[^/]*$/];

const motifDexclusion = (ligne) => {
  if (ligne.endsWith('/')) return (f) => f.startsWith(ligne);
  if (ligne.startsWith('*')) return (f) => f.endsWith(ligne.slice(1));
  return (f) => f === ligne;
};

const fichiers = execFileSync('git', ['ls-files'], { cwd: racine, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);
const exclusions = readFileSync(join(racine, '.vercelignore'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const estExclu = exclusions.map(motifDexclusion);

const publies = fichiers.filter((f) => !estExclu.some((m) => m(f)));
const intrus = publies.filter((f) =>
  !PUBLIES.some((p) => p.test(f)) && !CONFIGURATION.some((c) => c.test(f)));
const nonPublies = fichiers.filter((f) => estExclu.some((m) => m(f)));

console.log('FICHIERS VERSIONNES      : ' + fichiers.length);
console.log('SERAient PUBLIES         : ' + publies.length);
console.log('NON PUBLIES (exclus)     : ' + nonPublies.length);
console.log('');

let echec = false;
if (intrus.length) {
  echec = true;
  console.error('ECHEC — ces fichiers seraient publiés sans figurer dans la liste blanche :');
  for (const f of intrus) console.error('   *** ' + f);
  console.error('');
  console.error('  Deux issues : les ajouter à .vercelignore (s\'ils ne doivent pas être');
  console.error('  publiés), ou à la liste blanche de ce fichier (s\'ils le doivent).');
} else {
  console.log('ok    tout ce qui serait publié figure dans la liste blanche');
}

if (url) {
  console.log('');
  console.log('CONFRONTATION A L\'ADRESSE : ' + url);
  const encoder = (c) => c.split('/').map(encodeURIComponent).join('/');
  const statut = async (chemin) => {
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/' + encoder(chemin), { redirect: 'follow' });
      return r.status;
    } catch { return 'ERR'; }
  };
  // 1. Ce qui doit être servi l'est.
  let absents = 0;
  for (const f of publies) {
    const s = await statut(f);
    if (s !== 200) {
      const attendu = CONFIGURATION.some((c) => c.test(f));
      if (!attendu) { absents++; console.error('   ABSENT (HTTP ' + s + ') : ' + f); }
    }
  }
  console.log(absents ? '   ' + absents + ' fichier(s) publié(s) manquant(s) — déploiement en retard ?'
    : '   ok     tous les fichiers publiés répondent');
  // 2. Ce qui ne doit PAS être servi ne l'est pas. C'est le contrôle qui compte.
  const fuites = [];
  for (const f of nonPublies) {
    const s = await statut(f);
    if (s === 200) fuites.push(f);
  }
  if (fuites.length) {
    echec = true;
    console.error('   ECHEC — ATTEIGNABLE ALORS QUE NON PUBLIE :');
    for (const f of fuites) console.error('      *** ' + f);
  } else {
    console.log('   ok     aucun des ' + nonPublies.length + ' fichiers non publiés n\'est atteignable');
  }
}

console.log('');
if (echec) { console.error('BILAN publication : ECHEC.'); process.exitCode = 1; }
else console.log('BILAN publication : conforme.');
