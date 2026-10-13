// tests/stockage-supabase.mjs — tests de l'adaptateur de la base partagée.
//
// Aucun réseau : `fetch` est simulé, et le journal des appels est examiné. Ce n'est
// pas un pis-aller — c'est la seule façon de vérifier CE QUI PART réellement : URL
// exacte, en-têtes d'authentification, corps envoyé, et surtout la condition de
// version qui empêche d'écraser le travail d'un autre poste.
import assert from 'node:assert/strict';
import {
  seConnecter, seDeconnecter, rafraichirSession, creerStockageSupabase,
  changerMotDePasse, lireReglages, creerCompte, ErreurConflit, ErreurAuthentification,
} from '../js/stockage-supabase.js';

let reussis = 0;
const echecs = [];
async function cas(nom, bloc) {
  try { await bloc(); reussis++; console.log('  ok    ' + nom); }
  catch (e) { echecs.push(nom); console.error('  ECHEC ' + nom); console.error('        ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

const URL_BASE = 'https://exemple.supabase.co';
const CLE = 'sb_publishable_exemple';

/** Fabrique un fetch simulé : chaque reponse est decrite par {statut, corps}. */
function fauxFetch(reponses) {
  const appels = [];
  const impl = async (url, options = {}) => {
    appels.push({ url, methode: (options.method || 'GET'), entetes: options.headers || {}, corps: options.body ? JSON.parse(options.body) : null });
    const suivante = reponses.shift();
    if (!suivante) throw new Error('appel inattendu : ' + url);
    return {
      ok: suivante.statut >= 200 && suivante.statut < 300,
      status: suivante.statut,
      async json() { return suivante.corps; },
      async text() { return JSON.stringify(suivante.corps ?? ''); },
    };
  };
  return { impl, appels };
}

/**
 * Fetch qui IMITE le navigateur : il refuse d'être appelé avec un `this` qui n'est
 * pas la fenêtre. C'est exactement ce que fait Chrome (« Illegal invocation »), et
 * c'est ce qui a rendu la base partagée inutilisable en production. Un fetch simulé
 * ordinaire accepte n'importe quel `this` : il ne peut pas attraper ce défaut.
 */
function fetchStrict(reponses) {
  const { impl, appels } = fauxFetch(reponses);
  const strict = function (...args) {
    if (this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return impl(...args);
  };
  return { impl: strict, appels };
}

const sessionExemple = (fetchImpl) => ({
  url: URL_BASE, clePublique: CLE, jeton: 'jeton-utilisateur',
  jetonRafraichissement: 'jeton-rafraichissement', utilisateur: { id: 'u-1' },
  expireLe: Date.now() + 3600000, fetchImpl,
});

/* ------------------------------------------------------------------ */
console.log('connexion');

await cas('seConnecter : bon point d\'entree, bonne cle, bon corps', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: { access_token: 'jeton-1', refresh_token: 'raf-1', expires_in: 3600, user: { id: 'u-1' } } }]);
  const s = await seConnecter({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'secret', fetchImpl: impl });
  assert.equal(appels[0].url, URL_BASE + '/auth/v1/token?grant_type=password', 'point d\'entree d\'authentification');
  assert.equal(appels[0].entetes.apikey, CLE, 'cle publique transmise');
  assert.equal(appels[0].corps.email, 'a@b.fr', 'courriel transmis');
  assert.equal(s.jeton, 'jeton-1', 'jeton conservé');
  assert.ok(s.expireLe > Date.now(), 'expiration calculée');
});

await cas('seConnecter : identifiants refuses -> message explicite, pas un HTTP brut', async () => {
  const { impl } = fauxFetch([{ statut: 400, corps: { error_description: 'Invalid login credentials' } }]);
  await assert.rejects(
    () => seConnecter({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'faux', fetchImpl: impl }),
    /Connexion : Invalid login credentials/);
});

/* ------------------------------------------------------------------ */
console.log('ecriture');

await cas('sauvegarder (nouveau dossier) : POST avec version 1', async () => {
  const { impl, appels } = fauxFetch([{ statut: 201, corps: [{ id: 'd-1', version: 1 }] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  const r = await port.sauvegarder({ operation: { reference: 'OP-2026-01', intitule: 'Essai' } });
  assert.equal(appels[0].methode, 'POST', 'creation par POST');
  assert.equal(appels[0].corps.version, 1, 'premiere version');
  assert.equal(appels[0].corps.reference, 'OP-2026-01', 'reference remontee en colonne');
  assert.equal(appels[0].entetes.Authorization, 'Bearer jeton-utilisateur', 'jeton d\'utilisateur, pas la cle publique');
  assert.deepEqual(r, { id: 'd-1', version: 1 }, 'identifiant et version rendus');
});

await cas('sauvegarder (dossier existant) : PATCH conditionne a la version connue', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: [{ id: 'd-1', version: 5 }] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  await port.sauvegarder({ _base: { id: 'd-1', version: 4 }, operation: { reference: 'X' } }, { versionAttendue: 4 });
  assert.equal(appels[0].methode, 'PATCH', 'mise a jour par PATCH');
  assert.ok(appels[0].url.includes('id=eq.d-1'), 'cible par identifiant');
  assert.ok(appels[0].url.includes('version=eq.4'), 'CONDITION de version : c\'est elle qui protege l\'autre poste');
  assert.equal(appels[0].corps.version, 5, 'nouvelle version incrementee');
});

await cas('conflit : rien n\'est ecrase, la version distante est rapportee', async () => {
  const { impl, appels } = fauxFetch([
    { statut: 200, corps: [] },
    { statut: 200, corps: [{ version: 7, maj_le: '2026-09-25T14:00:00Z', maj_par: 'u-2' }] },
  ]);
  const port = creerStockageSupabase(sessionExemple(impl));
  let erreur = null;
  try { await port.sauvegarder({ _base: { id: 'd-1', version: 4 }, operation: {} }, { versionAttendue: 4 }); }
  catch (e) { erreur = e; }
  assert.ok(erreur instanceof ErreurConflit, 'un conflit leve ErreurConflit, pas un echec generique');
  assert.equal(erreur.versionDistante, 7, 'la version distante est donnee a l\'utilisateur');
  assert.match(erreur.message, /n'a PAS été écrasée/, 'le message dit que rien n\'a ete perdu');
  assert.equal(appels.length, 2, 'une relecture de la version distante a suivi');
});

/* ------------------------------------------------------------------ */
console.log('lecture et suppression');

await cas('charger : rend le contenu et sa version', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: [{ id: 'd-1', version: 3, donnees: { operation: { reference: 'OP-2026-01' } }, maj_le: 'x', maj_par: 'u-1' }] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  const p = await port.charger('d-1');
  assert.equal(p.operation.reference, 'OP-2026-01', 'contenu rendu');
  assert.equal(p._base.version, 3, 'version attachee pour la prochaine ecriture');
  assert.ok(appels[0].url.includes('id=eq.d-1'), 'cible par identifiant');
});

await cas('charger : dossier absent -> message clair', async () => {
  const { impl } = fauxFetch([{ statut: 200, corps: [] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  await assert.rejects(() => port.charger('inconnu'), /introuvable dans la base/);
});

await cas('lister : metadonnees seulement, du plus recent au plus ancien', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: [{ id: 'd-1', reference: 'OP-2026-01', intitule: 'ITM', version: 2, maj_le: 'z' }] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  const liste = await port.lister();
  assert.equal(liste.length, 1, 'une ligne');
  assert.equal(liste[0].reference, 'OP-2026-01', 'reference');
  assert.equal(liste[0].donnees, undefined, 'le contenu complet n\'est PAS rapatrie pour une liste');
  assert.ok(appels[0].url.includes('order=maj_le.desc'), 'tri par date decroissante');
});

await cas('supprimer : DELETE cible', async () => {
  const { impl, appels } = fauxFetch([{ statut: 204, corps: null }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  await port.supprimer('d-1');
  assert.equal(appels[0].methode, 'DELETE', 'suppression par DELETE');
});

/* ------------------------------------------------------------------ */
console.log('erreurs parlantes');

await cas('acces refuse : ErreurAuthentification, pas un HTTP brut', async () => {
  const { impl } = fauxFetch([{ statut: 401, corps: { message: 'JWT expired' } }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  await assert.rejects(() => port.lister(), (e) => e instanceof ErreurAuthentification && /JWT expired/.test(e.message));
});

await cas('table absente : le message dit QUOI FAIRE (executer db/schema.sql)', async () => {
  const { impl } = fauxFetch([{ statut: 404, corps: { code: 'PGRST205', message: "Could not find the table 'public.dossiers'" } }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  await assert.rejects(() => port.lister(), /db\/schema\.sql/);
});

await cas('jeton expire : la session est renouvelee avant l\'operation', async () => {
  const { impl, appels } = fauxFetch([
    { statut: 200, corps: { access_token: 'jeton-2', refresh_token: 'raf-2', expires_in: 3600 } },
    { statut: 200, corps: [] },
  ]);
  const s = sessionExemple(impl);
  s.expireLe = Date.now() - 1000;   // expire
  const port = creerStockageSupabase(s);
  await port.lister();
  assert.ok(appels[0].url.includes('grant_type=refresh_token'), 'renouvellement tente en premier');
  assert.equal(appels[1].entetes.Authorization, 'Bearer jeton-2', 'la seconde requete utilise le jeton neuf');
});

/* ------------------------------------------------------------------ */
console.log('mot de passe et reglages publics');

await cas('changerMotDePasse : PUT avec le jeton de la personne, jamais la cle publique', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: { id: 'u-1' } }]);
  await changerMotDePasse(sessionExemple(impl), 'nouveau-secret');
  assert.equal(appels[0].url, URL_BASE + '/auth/v1/user', 'point d\'entree de mise a jour du compte');
  assert.equal(appels[0].methode, 'PUT', 'mise a jour par PUT');
  assert.equal(appels[0].entetes.Authorization, 'Bearer jeton-utilisateur', 'le jeton de la personne, pas la cle publique');
  assert.equal(appels[0].corps.password, 'nouveau-secret', 'seul le mot de passe est transmis');
});

await cas('changerMotDePasse : mot de passe refuse par la base -> message lisible', async () => {
  const { impl } = fauxFetch([{ statut: 422, corps: { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' } }]);
  await assert.rejects(
    () => changerMotDePasse(sessionExemple(impl), 'abc'),
    /Changement de mot de passe : Password should be at least 6/);
});

await cas('changerMotDePasse : sans session -> refus immediat, aucune requete ne part', async () => {
  let appele = false;
  const impl = async () => { appele = true; return { ok: true, status: 200, async json() { return {}; }, async text() { return '{}'; } }; };
  await assert.rejects(
    () => changerMotDePasse({ url: URL_BASE, clePublique: CLE, jeton: null, fetchImpl: impl }, 'x'),
    (e) => e instanceof ErreurAuthentification);
  assert.equal(appele, false, 'aucun appel reseau sans session');
});

await cas('lireReglages : inscription ouverte -> rapportee', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: { disable_signup: false, mailer_autoconfirm: false } }]);
  const r = await lireReglages({ url: URL_BASE, clePublique: CLE, fetchImpl: impl });
  assert.equal(appels[0].url, URL_BASE + '/auth/v1/settings', 'reglages publics, sans session');
  assert.equal(r.inscriptionOuverte, true, 'l\'inscription ouverte est rapportee');
  assert.equal(r.confirmationParCourrielRequise, true, 'la confirmation par courriel est rapportee');
});

await cas('lireReglages : inscription fermee -> rapportee comme telle', async () => {
  const { impl } = fauxFetch([{ statut: 200, corps: { disable_signup: true, mailer_autoconfirm: true } }]);
  const r = await lireReglages({ url: URL_BASE, clePublique: CLE, fetchImpl: impl });
  assert.equal(r.inscriptionOuverte, false, 'l\'inscription fermee est rapportee comme telle');
  assert.equal(r.confirmationParCourrielRequise, false, 'pas de confirmation par courriel exigee');
});

await cas('refus traduit : fournisseur courriel desactive -> dit QUOI FAIRE', async () => {
  const { impl } = fauxFetch([{ statut: 400, corps: { code: 400, error_code: 'email_provider_disabled', msg: 'Email logins are disabled' } }]);
  await assert.rejects(
    () => seConnecter({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'x', fetchImpl: impl }),
    /administre la base \(Authentication, Providers, Email\)/);
});

await cas('refus traduit : inscription fermee -> dit a qui s\'adresser', async () => {
  const { impl } = fauxFetch([{ statut: 422, corps: { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' } }]);
  await assert.rejects(
    () => creerCompte({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'motdepasse-long', fetchImpl: impl }),
    /demandez l'ouverture d'un compte/);
});

/* --- Creation de compte : l'inscription est OUVERTE --- */
await cas('creerCompte : bon point d\'entree, bonne cle, bon corps — et le mot de passe n\'est jamais dans l\'URL', async () => {
  const { impl, appels } = fauxFetch([{ statut: 200, corps: { id: 'u-1', email: 'a@b.fr', confirmation_sent_at: '2026-01-01T00:00:00Z' } }]);
  await creerCompte({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'motdepasse-secret', fetchImpl: impl });
  assert.equal(appels.length, 1, 'une seule requete');
  assert.equal(appels[0].url, URL_BASE + '/auth/v1/signup', 'point d\'entree d\'inscription');
  assert.equal(appels[0].methode, 'POST');
  assert.equal(appels[0].entetes.apikey, CLE, 'cle publique en en-tete');
  assert.deepEqual(appels[0].corps, { email: 'a@b.fr', password: 'motdepasse-secret' }, 'courriel et mot de passe dans le corps');
  assert.ok(!appels[0].url.includes('motdepasse-secret') && !appels[0].url.includes('a@b.fr'), 'ni courriel ni mot de passe dans l\'URL');
});

await cas('creerCompte : confirmation par courriel exigee -> pas de session, on le dit', async () => {
  const { impl } = fauxFetch([{ statut: 200, corps: { id: 'u-1', email: 'a@b.fr', confirmation_sent_at: '2026-01-01T00:00:00Z' } }]);
  const r = await creerCompte({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'motdepasse-long', fetchImpl: impl });
  assert.equal(r.confirmationRequise, true, 'la confirmation est rapportee');
  assert.equal(r.session, null, 'aucune session tant que le lien n\'est pas clique');
});

await cas('creerCompte : confirmation desactivee -> session ouverte tout de suite', async () => {
  const { impl } = fauxFetch([{ statut: 200, corps: { access_token: 'jeton-1', refresh_token: 'rafraichir-1', expires_in: 3600, user: { id: 'u-1', email: 'a@b.fr' } } }]);
  const r = await creerCompte({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'motdepasse-long', fetchImpl: impl });
  assert.equal(r.confirmationRequise, false);
  assert.ok(r.session, 'une session est rendue');
  assert.equal(r.session.jeton, 'jeton-1');
  assert.equal(r.session.jetonRafraichissement, 'rafraichir-1');
  assert.equal(r.session.url, URL_BASE);
  assert.equal(r.session.utilisateur.email, 'a@b.fr');
});

await cas('creerCompte : compte deja existant -> message clair', async () => {
  const { impl } = fauxFetch([{ statut: 422, corps: { code: 422, error_code: 'user_already_exists', msg: 'User already registered' } }]);
  await assert.rejects(
    () => creerCompte({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'motdepasse-long', fetchImpl: impl }),
    /Un compte existe déjà avec ce courriel/);
});

await cas('creerCompte : sans courriel ou sans mot de passe -> refus immediat, aucune requete ne part', async () => {
  let appele = false;
  const impl = async () => { appele = true; return { ok: true, status: 200, async json() { return {}; }, async text() { return '{}'; } }; };
  await assert.rejects(() => creerCompte({ url: URL_BASE, clePublique: CLE, email: '', motDePasse: 'x', fetchImpl: impl }), TypeError);
  await assert.rejects(() => creerCompte({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: '', fetchImpl: impl }), TypeError);
  assert.equal(appele, false, 'aucun appel reseau');
});

await cas('creerCompte : la session rendue sert ensuite aux requetes du stockage (jeton en Bearer)', async () => {
  const { impl: implInscription } = fauxFetch([{ statut: 200, corps: { access_token: 'jeton-2', refresh_token: 'r-2', expires_in: 3600, user: { id: 'u-2', email: 'c@d.fr' } } }]);
  const r = await creerCompte({ url: URL_BASE, clePublique: CLE, email: 'c@d.fr', motDePasse: 'motdepasse-long', fetchImpl: implInscription });
  const { impl, appels } = fauxFetch([{ statut: 200, corps: [] }]);
  const port = creerStockageSupabase({ ...r.session, fetchImpl: impl });
  await port.lister();
  assert.equal(appels[0].entetes.Authorization, 'Bearer jeton-2', 'le jeton de la nouvelle session part en Authorization');
});

await cas('refus traduit : identifiants faux -> message court, en francais', async () => {
  const { impl } = fauxFetch([{ statut: 400, corps: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }]);
  await assert.rejects(
    () => seConnecter({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'x', fetchImpl: impl }),
    /Courriel ou mot de passe incorrect/);
});

await cas('un code inconnu garde le message d\'origine (aucune invention)', async () => {
  const { impl } = fauxFetch([{ statut: 400, corps: { code: 400, error_code: 'quelque_chose_de_nouveau', msg: 'Message brut du serveur' } }]);
  await assert.rejects(
    () => seConnecter({ url: URL_BASE, clePublique: CLE, email: 'a@b.fr', motDePasse: 'x', fetchImpl: impl }),
    /Message brut du serveur/);
});

/* --- Non-regression : « Illegal invocation » ---
   Ces trois cas echouaient TOUS en production, apres une connexion pourtant reussie. */
await cas('charger : fetch recoit le bon receveur (pas de Illegal invocation)', async () => {
  const { impl } = fetchStrict([{ statut: 200, corps: [{ id: 'd-1', version: 3, donnees: { operation: {} } }] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  const p = await port.charger('d-1');
  assert.equal(p._base.version, 3, 'le chargement aboutit avec un fetch exigeant');
});

await cas('enregistrer : fetch recoit le bon receveur (pas de Illegal invocation)', async () => {
  const { impl } = fetchStrict([{ statut: 201, corps: [{ id: 'd-1', version: 1 }] }]);
  const port = creerStockageSupabase(sessionExemple(impl));
  const r = await port.sauvegarder({ operation: { reference: 'X' } });
  assert.equal(r.id, 'd-1', 'la creation aboutit avec un fetch exigeant');
});

await cas('renouvellement et deconnexion : fetch recoit le bon receveur', async () => {
  const { impl } = fetchStrict([
    { statut: 200, corps: { access_token: 'neuf', refresh_token: 'r2', expires_in: 3600 } },
    { statut: 204, corps: null },
  ]);
  const s = sessionExemple(impl);
  await rafraichirSession(s);
  await seDeconnecter(s);
});

await cas('lireReglages : cle absente -> refus immediat, aucune requete ne part', async () => {
  let appele = false;
  const impl = async () => { appele = true; return { ok: true, status: 200, async json() { return {}; }, async text() { return '{}'; } }; };
  await assert.rejects(() => lireReglages({ url: URL_BASE, clePublique: '', fetchImpl: impl }), TypeError);
  assert.equal(appele, false, 'la validation precede le reseau');
});

/* ------------------------------------------------------------------ */
console.log('');
if (echecs.length) {
  console.error('BILAN stockage : ' + reussis + ' ok, ' + echecs.length + ' ECHEC(s) -> ' + echecs.join(' ; '));
  process.exitCode = 1;
} else {
  console.log('BILAN stockage : ' + reussis + ' cas ok, 0 échec.');
}
