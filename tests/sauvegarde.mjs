// tests/sauvegarde.mjs — éprouve l'ALLER-RETOUR complet de la sauvegarde.
//
// CE QUE CE FICHIER CHERCHE À ÉTABLIR. Une sauvegarde qu'on n'a jamais rechargée n'est
// pas une sauvegarde : c'est un fichier dont on espère quelque chose. Le seul moyen de
// savoir est de faire le chemin entier — lire la base, écrire le fichier, relire le
// fichier, comparer, reposer dans une base vide, relire la base — et de comparer ce qui
// revient à ce qui était parti.
//
// SUR DES DONNÉES FABRIQUÉES, ET JAMAIS SUR LA BASE RÉELLE. La base est simulée par un
// fetch de remplacement, selon le procédé déjà employé par tests/stockage-supabase.mjs.
// Aucun réseau, aucune session, aucun dossier d'agence : les entreprises et opérations
// de ce fichier sont inventées, et les tests de cohérence interdisent d'y mettre les
// vraies.
//
// Exécution : node tests/sauvegarde.mjs

import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(join(racine, ...p)).href;

const S = await import(url('js', 'sauvegarde.js'));
const { creerStockageSupabase } = await import(url('js', 'stockage-supabase.js'));

let total = 0; let echecs = 0;
function verifier(intitule, condition, detail) {
  total += 1;
  if (condition) { console.log('  ok   ' + intitule); return; }
  echecs += 1;
  console.log('  ECHEC ' + intitule + (detail ? ' -> ' + detail : ''));
}

/* ------------------------------------------------------------------ */
/* Base simulée                                                        */
/* ------------------------------------------------------------------ */

// Dossiers inventés, avec des accents et des caractères qui ont déjà abîmé des fichiers
// ailleurs dans ce dépôt (fins de ligne, apostrophes typographiques, non-ASCII).
function donneesInitiales() {
  return [
    {
      id: '11111111-1111-4111-8111-111111111111',
      reference: 'ZZ01-01', intitule: 'Opération d’essai n°1', version: 3,
      maj_le: '2026-10-01T09:00:00.000Z',
      donnees: {
        operation: { reference: 'ZZ01-01', intitule: 'Opération d’essai n°1', droc: '2026-03-01' },
        entreprises: [{ id: 'ent-a', raisonSociale: 'ENTREPRISE FICTIVE ALPHA', lotNom: 'MAÇONNERIE' }],
        devis: [{ id: 'dev-1', entrepriseId: 'ent-a', htBase: 125000.5, variantes: [] }],
      },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      reference: 'ZZ02-02', intitule: null, version: 1,
      maj_le: '2026-10-05T14:30:00.000Z',
      donnees: {
        operation: { reference: 'ZZ02-02', intitule: null },
        entreprises: [], devis: [],
        texteDifficile: 'fin de ligne\r\net apostrophe ’ et é à ü — tiret cadratin',
      },
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      reference: 'ZZ03-03', intitule: 'Opération d’essai n°3', version: 7,
      maj_le: '2026-09-20T08:00:00.000Z',
      donnees: { operation: { reference: 'ZZ03-03' }, entreprises: [], devis: [], avenants: [{ n: 1, plusValue: 4200 }] },
    },
  ];
}

/** Base en mémoire + fetch de remplacement parlant le dialecte PostgREST utilisé. */
function baseSimulee(lignes = []) {
  const etat = { lignes: lignes.map((l) => JSON.parse(JSON.stringify(l))), appels: 0 };
  const reponse = (corps, ok = true, statut = 200) => Promise.resolve({
    ok, status: statut,
    json: () => Promise.resolve(corps),
    text: () => Promise.resolve(JSON.stringify(corps)),
  });
  etat.fetchImpl = (adresse, options = {}) => {
    etat.appels += 1;
    const methode = (options.method || 'GET').toUpperCase();
    const idFiltre = /id=eq\.([^&]+)/.exec(adresse);
    const cible = idFiltre ? decodeURIComponent(idFiltre[1]) : null;
    if (methode === 'GET') {
      if (cible) return reponse(etat.lignes.filter((l) => l.id === cible));
      // select=id,reference,... (lister) ou select=* (exporterTout)
      if (/select=id,reference/.test(adresse)) {
        return reponse(etat.lignes.map((l) => ({
          id: l.id, reference: l.reference, intitule: l.intitule, version: l.version, maj_le: l.maj_le,
        })));
      }
      return reponse(etat.lignes.slice().sort((a, b) => a.id.localeCompare(b.id)));
    }
    if (methode === 'POST') {
      const corps = JSON.parse(options.body);
      if (etat.lignes.some((l) => l.id === corps.id)) {
        return reponse({ code: '23505', message: 'duplicate key value violates unique constraint' }, false, 409);
      }
      const ligne = { ...corps, id: corps.id || 'auto-' + (etat.lignes.length + 1) };
      etat.lignes.push(ligne);
      return reponse([ligne]);
    }
    if (methode === 'PATCH') {
      const corps = JSON.parse(options.body);
      const i = etat.lignes.findIndex((l) => l.id === cible);
      if (i < 0) return reponse([]);
      etat.lignes[i] = { ...etat.lignes[i], ...corps };
      return reponse([etat.lignes[i]]);
    }
    if (methode === 'DELETE') {
      etat.lignes = etat.lignes.filter((l) => l.id !== cible);
      return reponse(null);
    }
    return reponse({ message: 'méthode non simulée : ' + methode }, false, 400);
  };
  return etat;
}

const session = (etat) => ({
  url: 'https://base-simulee.invalid', clePublique: 'sb_publishable_simule',
  jeton: 'jeton-simule', jetonRafraichissement: null,
  utilisateur: { email: 'essai@exemple.invalid' }, expireLe: Date.now() + 3600000,
  fetchImpl: etat.fetchImpl,
});

/* ================================================================== */

console.log('1. EMPREINTE : STABLE, ET SENSIBLE');
{
  const a = { b: 1, a: { d: 2, c: [1, 2, 3] } };
  const b = { a: { c: [1, 2, 3], d: 2 }, b: 1 }; // mêmes données, clés dans un autre ordre
  verifier("insensible a l'ordre des cles", S.empreinte(a) === S.empreinte(b),
    S.empreinte(a) + ' vs ' + S.empreinte(b));
  verifier('sensible a un chiffre qui change', S.empreinte({ x: 125000.5 }) !== S.empreinte({ x: 125000.6 }));
  verifier('sensible a un accent', S.empreinte({ x: 'é' }) !== S.empreinte({ x: 'e' }));
  verifier('sensible a une fin de ligne convertie',
    S.empreinte({ x: 'a\r\nb' }) !== S.empreinte({ x: 'a\nb' }));
  verifier('sensible a un dossier retire',
    S.empreinte([{ id: 1 }, { id: 2 }]) !== S.empreinte([{ id: 1 }]));
}

console.log('');
console.log('2. SAUVEGARDE DE TOUS LES DOSSIERS, EN UNE ACTION');
const etatSource = baseSimulee(donneesInitiales());
const portSource = creerStockageSupabase(session(etatSource));
const lignesLues = await portSource.exporterTout();
const appelsPourTout = etatSource.appels;
verifier('les 3 dossiers sont lus', lignesLues.length === 3, 'lus : ' + lignesLues.length);
verifier('en UNE seule requete', appelsPourTout === 1, appelsPourTout + ' appel(s)');

const sauvegarde = S.construireSauvegarde(lignesLues, { projet: 'base-simulee', creePar: 'essai@exemple.invalid' });
verifier('nbDossiers annonce = contenu', sauvegarde.nbDossiers === 3);
verifier('une empreinte est posee', /^[0-9a-f]{8}$/.test(sauvegarde.empreinte), sauvegarde.empreinte);
verifier('nom de fichier date et triable',
  /^sauvegarde-marches-\d{8}-\d{4}\.json$/.test(S.nomFichierSauvegarde(new Date('2026-10-07T12:45:00'))),
  S.nomFichierSauvegarde(new Date('2026-10-07T12:45:00')));
verifier("l'empreinte ne depend pas de la date de creation",
  S.construireSauvegarde(lignesLues, { creeLe: '2020-01-01T00:00:00.000Z' }).empreinte === sauvegarde.empreinte);
verifier("l'empreinte ne depend pas de l'ordre de reponse de la base",
  S.construireSauvegarde(lignesLues.slice().reverse()).empreinte === sauvegarde.empreinte);

console.log('');
console.log('3. LE FICHIER PASSE PAR DU TEXTE, ET REVIENT IDENTIQUE');
// C'est le vrai trajet : un fichier téléchargé puis rouvert est du texte, pas un objet.
const texteFichier = JSON.stringify(sauvegarde, null, 2);
const relu = S.relireSauvegarde(texteFichier);
verifier('relu sans motif de rejet', relu.valide, relu.motifs.join(' / '));
const comparaison = S.comparerSauvegardes(sauvegarde, relu.sauvegarde);
verifier('meme nombre de dossiers', comparaison.nbAvant === comparaison.nbApres,
  comparaison.nbAvant + ' -> ' + comparaison.nbApres);
verifier('meme empreinte de contenu', comparaison.empreinteAvant === comparaison.empreinteApres,
  comparaison.empreinteAvant + ' -> ' + comparaison.empreinteApres);
verifier('aucun dossier manquant ni different', comparaison.identique,
  JSON.stringify({ m: comparaison.manquants, t: comparaison.enTrop, d: comparaison.differents }));

console.log('');
console.log('4. UN FICHIER ABIME EST REFUSE, ET LE MOTIF EST DIT');
{
  verifier('JSON invalide refuse', S.relireSauvegarde('{ ceci n est pas du json').valide === false);
  verifier('autre format refuse', S.relireSauvegarde(JSON.stringify({ format: 'autre-chose', dossiers: [] })).valide === false);
  const tronque = JSON.parse(texteFichier); tronque.dossiers = tronque.dossiers.slice(0, 2);
  const vTronque = S.relireSauvegarde(JSON.stringify(tronque));
  verifier('fichier tronque detecte', vTronque.valide === false, vTronque.motifs.join(' / '));
  verifier('  et le motif parle de troncature', vTronque.motifs.some((m) => /tronqu/.test(m)));
  const altere = JSON.parse(texteFichier);
  altere.dossiers[0].donnees.devis[0].htBase = 999999;
  const vAltere = S.relireSauvegarde(JSON.stringify(altere));
  verifier('montant modifie detecte par l empreinte', vAltere.valide === false, vAltere.motifs.join(' / '));
  const crlf = S.relireSauvegarde(JSON.stringify(JSON.parse(texteFichier.replace(/\\r\\n/g, '\\n'))));
  verifier('conversion de fin de ligne detectee', crlf.valide === false, crlf.motifs.join(' / '));
}

console.log('');
console.log('5. RESTAURATION DANS UNE BASE VIDE : L ETAT EST RETABLI');
const etatCible = baseSimulee([]);
const portCible = creerStockageSupabase(session(etatCible));
{
  const presents = await portCible.lister();
  const plan = S.planifierRestauration(relu.sauvegarde, presents);
  verifier('le plan prevoit de reposer les 3', plan.aCreer.length === 3, plan.resume);
  for (const d of plan.aCreer) await portCible.reposerDossier(d, { ecraser: false });

  const apresRestauration = S.construireSauvegarde(await portCible.exporterTout());
  const controle = S.comparerSauvegardes(sauvegarde, apresRestauration);
  verifier('3 dossiers dans la base cible', controle.nbApres === 3, 'trouves : ' + controle.nbApres);
  verifier('les identifiants sont conserves (aucun doublon)', controle.manquants.length === 0 && controle.enTrop.length === 0,
    JSON.stringify({ m: controle.manquants, t: controle.enTrop }));
  verifier('CONTENU IDENTIQUE a l origine (empreinte)', controle.empreinteAvant === controle.empreinteApres,
    controle.empreinteAvant + ' -> ' + controle.empreinteApres);
  verifier('aucun dossier different', controle.differents.length === 0, controle.differents.join(', '));
}

console.log('');
console.log('6. RESTAURATION SUR UNE BASE NON VIDE : RIEN N EST DETRUIT PAR DEFAUT');
{
  // La base contient un dossier MODIFIÉ depuis la sauvegarde, plus récent qu'elle.
  const lignesPartielles = donneesInitiales().slice(0, 1);
  lignesPartielles[0].donnees.devis[0].htBase = 177777;
  lignesPartielles[0].maj_le = '2026-10-06T18:00:00.000Z';
  const etatMixte = baseSimulee(lignesPartielles);
  const portMixte = creerStockageSupabase(session(etatMixte));
  const presents = await portMixte.lister();

  const planDefaut = S.planifierRestauration(relu.sauvegarde, presents);
  verifier('mode par defaut = completer', planDefaut.mode === 'completer');
  verifier('ne repose que les 2 absents', planDefaut.aCreer.length === 2, planDefaut.resume);
  verifier('laisse le present intact', planDefaut.ignores.length === 1 && planDefaut.aRemplacer.length === 0);

  for (const d of planDefaut.aCreer) await portMixte.reposerDossier(d, { ecraser: false });
  const apres = S.construireSauvegarde(await portMixte.exporterTout());
  const conserve = apres.dossiers.find((d) => d.id === lignesPartielles[0].id);
  verifier('le travail plus recent est CONSERVE', conserve.donnees.devis[0].htBase === 177777,
    'htBase = ' + conserve.donnees.devis[0].htBase);
  verifier('et les 3 dossiers sont la', apres.nbDossiers === 3, 'nb = ' + apres.nbDossiers);

  const planRemplace = S.planifierRestauration(relu.sauvegarde, presents, { mode: 'remplacer' });
  verifier('mode remplacer : 1 ecrasement prevu', planRemplace.aRemplacer.length === 1, planRemplace.resume);
  verifier('  et la perte possible est ANNONCEE avant', planRemplace.pertesPossibles.length === 1,
    planRemplace.resume);
  verifier('mode inconnu refuse', (() => {
    try { S.planifierRestauration(relu.sauvegarde, presents, { mode: 'ecraser-tout' }); return false; }
    catch { return true; }
  })());
}

console.log('');
console.log('7. SIGNAL D ANCIENNETE');
{
  const maintenant = new Date('2026-10-07T12:00:00.000Z');
  const j = (n) => new Date(maintenant - n * 86400000).toISOString();
  verifier('jamais sauvegarde -> alerte', S.etatAnciennete(null, j(1), maintenant).gravite === 'alerte');
  verifier('hier, base plus ancienne -> neutre',
    S.etatAnciennete(j(1), j(3), maintenant).gravite === 'neutre');
  verifier('10 jours -> attention', S.etatAnciennete(j(10), j(40), maintenant).gravite === 'attention');
  verifier('40 jours -> alerte', S.etatAnciennete(j(40), j(50), maintenant).gravite === 'alerte');
  const retard = S.etatAnciennete(j(1), j(0), maintenant);
  verifier('base ecrite APRES la sauvegarde -> attention meme si recente',
    retard.gravite === 'attention' && retard.enRetard === true, JSON.stringify(retard));
  verifier('  et le texte le dit', /ne les contient pas/.test(retard.texte), retard.texte);
  verifier('date illisible -> attention sans planter',
    S.etatAnciennete('pas-une-date', null, maintenant).gravite === 'attention');
}

console.log('');
console.log(total + ' controles, ' + echecs + ' echec(s).');
process.exit(echecs === 0 ? 0 : 1);
