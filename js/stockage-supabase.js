// js/stockage-supabase.js — adaptateur de stockage sur la base partagée.
//
// TROISIÈME adaptateur du port de stockage (SPEC §6 quater), après IndexedDB et la
// mémoire. Il ne remplace pas les autres : IndexedDB reste le cache de travail, la
// base porte la vérité partagée entre les postes (SPEC §6 quinquies).
//
// AUCUNE DÉPENDANCE : l'API REST de la base est appelée directement par fetch, et
// l'authentification passe par son point d'entrée standard. L'application reste
// sans build, sans SDK, sans node_modules.
//
// Ce que l'adaptateur NE fait PAS, volontairement :
//   - il ne décide pas qui voit quoi : c'est le rôle des politiques d'accès (RLS)
//     définies dans db/schema.sql, côté base ;
//   - il n'écrase jamais une écriture distante : chaque sauvegarde est conditionnée
//     à la version connue (SPEC §6 quinquies, règle 3), et un conflit lève une
//     erreur explicite au lieu de perdre la saisie de quelqu'un.

/** Conflit d'écriture : quelqu'un a enregistré entre-temps. Rien n'a été écrasé. */
export class ErreurConflit extends Error {
  constructor(message, versionDistante) {
    super(message);
    this.name = 'ErreurConflit';
    this.versionDistante = versionDistante ?? null;
  }
}

/** La session est absente ou expirée : il faut se reconnecter. */
export class ErreurAuthentification extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurAuthentification';
  }
}

/**
 * Appelle `fetch` SANS receveur.
 *
 * POURQUOI CETTE FONCTION EXISTE — défaut trouvé le 25/09/2026 par un essai de bout
 * en bout sur la base réelle, et il rendait la base partagée INUTILISABLE :
 *
 *   appeler(courante.fetchImpl,url, options)      -> fetch reçoit this = courante
 *   appeler(courante.fetchImpl, url, options) -> fetch reçoit this = undefined
 *
 * Le navigateur exige que `fetch` soit appelé sur la fenêtre. Avec un autre `this`,
 * il refuse : « Failed to execute 'fetch' on 'Window': Illegal invocation ». La
 * connexion réussissait donc, puis TOUTE opération sur la base échouait — lister,
 * charger, enregistrer, supprimer. Les tests ne l'ont pas vu parce qu'ils passent un
 * fetch simulé, qui accepte n'importe quel `this`. Seul un vrai navigateur, avec un
 * vrai compte, pouvait le révéler.
 */
function appeler(impl, url, options) {
  return impl(url, options);
}

function verifierArguments(url, clePublique, fetchImpl) {
  if (typeof url !== 'string' || !url.startsWith('http')) {
    throw new TypeError('stockage-supabase : url du projet attendue (https://…)');
  }
  if (typeof clePublique !== 'string' || clePublique === '') {
    throw new TypeError('stockage-supabase : clé publique attendue');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('stockage-supabase : fetch indisponible');
  }
}

// Refus d'authentification que l'utilisateur peut RÉELLEMENT rencontrer, traduits en
// cause et en geste à faire. Motif : « Email logins are disabled » est exact, mais ne
// dit pas où aller.
const EXPLICATIONS = {
  email_provider_disabled:
    "La connexion par courriel est DÉSACTIVÉE sur ce projet : personne ne peut se connecter ni créer de "
    + "compte. À corriger par la personne qui administre la base (Authentication, Providers, Email).",
  signup_disabled:
    "L'inscription est fermée sur ce projet : demandez l'ouverture d'un compte à la personne qui "
    + "administre la base.",
  user_already_exists:
    "Un compte existe déjà avec ce courriel : connectez-vous, ou utilisez une autre adresse.",
  email_address_invalid:
    "Cette adresse de courriel n'est pas acceptée par le service.",
  invalid_credentials:
    "Courriel ou mot de passe incorrect.",
  email_not_confirmed:
    "Ce compte n'a pas encore confirmé son courriel.",
  over_email_send_rate_limit:
    "Trop de courriels envoyés en peu de temps : réessayez dans quelques minutes.",
};

// Traduit une réponse en erreur PARLANTE. Le cas « table absente » est distingué
// parce qu'il a une cause unique et un remède unique : exécuter db/schema.sql.
async function erreurDepuis(reponse, contexte) {
  let corps = null;
  let texte = '';
  try {
    texte = await reponse.text();
    corps = texte ? JSON.parse(texte) : null;
  } catch { /* corps non JSON : on garde le texte brut */ }
  const code = corps && corps.code ? corps.code : '';
  const codeErreur = corps && corps.error_code ? String(corps.error_code) : '';
  const message = EXPLICATIONS[codeErreur]
    || (corps && (corps.message || corps.msg || corps.error_description))
    || texte || ('HTTP ' + reponse.status);

  if (reponse.status === 401 || reponse.status === 403) {
    return new ErreurAuthentification(contexte + ' : accès refusé (' + message
      + ') — la session est peut-être expirée, ou la politique d\'accès refuse cette opération.');
  }
  if (code === 'PGRST205' || /Could not find the table/i.test(message)) {
    return new Error(contexte + ' : la table « dossiers » n\'existe pas dans la base. '
      + 'Exécutez db/schema.sql dans l\'éditeur SQL du projet (une fois).');
  }
  return new Error(contexte + ' : ' + message);
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * Crée un compte. L'inscription est OUVERTE : n'importe qui peut s'ouvrir un compte, et
 * c'est voulu. La confidentialité des dossiers ne repose pas sur le secret de l'adresse de
 * l'application (la clé publique est dans le JavaScript servi au navigateur) mais sur la
 * base : chaque dossier appartient à son créateur et à lui seul (db/schema.sql, politiques
 * RLS, prouvées par db/test-isolation.sql).
 *
 * Selon le réglage du projet, la base répond de deux façons, et l'appelant doit les
 * distinguer — c'est la raison d'être de `confirmationRequise` :
 *   - une SESSION (confirmation par courriel désactivée) : l'utilisateur est connecté ;
 *   - un utilisateur SANS session (confirmation activée) : un courriel de confirmation est
 *     parti, et le compte ne servira qu'après le clic sur le lien.
 *
 * @returns {Promise<{session: object|null, confirmationRequise: boolean, utilisateur: object|null}>}
 */
export async function creerCompte({ url, clePublique, email, motDePasse, fetchImpl = globalThis.fetch } = {}) {
  verifierArguments(url, clePublique, fetchImpl);
  if (!email || !motDePasse) throw new TypeError('creerCompte : courriel et mot de passe attendus');
  const reponse = await fetchImpl(url + '/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: clePublique, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: motDePasse }),
  });
  if (!reponse.ok) throw await erreurDepuis(reponse, 'Création du compte');
  const donnees = await reponse.json();
  if (donnees && donnees.access_token) {
    return {
      session: {
        url,
        clePublique,
        jeton: donnees.access_token,
        jetonRafraichissement: donnees.refresh_token || null,
        utilisateur: donnees.user || null,
        expireLe: Date.now() + (Number(donnees.expires_in || 3600) * 1000),
        fetchImpl,
      },
      confirmationRequise: false,
      utilisateur: donnees.user || null,
    };
  }
  // Sans session : la base a répondu par l'utilisateur lui-même (ou par rien d'exploitable).
  return { session: null, confirmationRequise: true, utilisateur: (donnees && donnees.user) || donnees || null };
}

/**
 * Ouvre une session utilisateur. La clé publique ne suffit pas : il faut un compte.
 * @returns {Promise<object>} session
 */
export async function seConnecter({ url, clePublique, email, motDePasse, fetchImpl = globalThis.fetch } = {}) {
  verifierArguments(url, clePublique, fetchImpl);
  if (!email || !motDePasse) throw new TypeError('seConnecter : courriel et mot de passe attendus');
  const reponse = await fetchImpl(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: clePublique, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: motDePasse }),
  });
  if (!reponse.ok) throw await erreurDepuis(reponse, 'Connexion');
  const donnees = await reponse.json();
  return {
    url,
    clePublique,
    jeton: donnees.access_token,
    jetonRafraichissement: donnees.refresh_token || null,
    utilisateur: donnees.user || null,
    expireLe: Date.now() + (Number(donnees.expires_in || 3600) * 1000),
    fetchImpl,
  };
}

/**
 * Renouvelle le jeton d'accès à partir du jeton de rafraîchissement.
 * @returns {Promise<object>} session mise à jour
 */
export async function rafraichirSession(session) {
  if (!session || !session.jetonRafraichissement) {
    throw new ErreurAuthentification('rafraichirSession : aucun jeton de rafraîchissement — reconnectez-vous');
  }
  const reponse = await appeler(session.fetchImpl,session.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: session.clePublique, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.jetonRafraichissement }),
  });
  if (!reponse.ok) throw await erreurDepuis(reponse, 'Renouvellement de session');
  const donnees = await reponse.json();
  return {
    ...session,
    jeton: donnees.access_token,
    jetonRafraichissement: donnees.refresh_token || session.jetonRafraichissement,
    utilisateur: donnees.user || session.utilisateur,
    expireLe: Date.now() + (Number(donnees.expires_in || 3600) * 1000),
  };
}

/** Ferme la session côté base (le jeton local n'est alors plus utilisable). */
export async function seDeconnecter(session) {
  if (!session || !session.url) return;
  try {
    await appeler(session.fetchImpl,session.url + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: session.clePublique, Authorization: 'Bearer ' + session.jeton },
    });
  } catch { /* une déconnexion qui échoue ne doit pas bloquer l'utilisateur */ }
}

/**
 * Change le mot de passe de l'utilisateur connecté.
 *
 * Chacun peut changer son mot de passe à tout moment ; il n'est connu que de son titulaire.
 * (Pour CRÉER un compte, voir creerCompte.)
 *
 * @returns {Promise<object>} l'utilisateur mis à jour
 */
export async function changerMotDePasse(session, nouveauMotDePasse) {
  if (!session || !session.url || !session.jeton) {
    throw new ErreurAuthentification("changerMotDePasse : session requise (seConnecter d'abord)");
  }
  if (typeof nouveauMotDePasse !== 'string' || nouveauMotDePasse.length === 0) {
    throw new TypeError('changerMotDePasse : nouveau mot de passe attendu');
  }
  const reponse = await appeler(session.fetchImpl,session.url + '/auth/v1/user', {
    method: 'PUT',
    headers: {
      apikey: session.clePublique,
      Authorization: 'Bearer ' + session.jeton,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: nouveauMotDePasse }),
  });
  if (!reponse.ok) throw await erreurDepuis(reponse, 'Changement de mot de passe');
  return reponse.json();
}

/**
 * Lit les réglages PUBLICS d'authentification du projet. Aucune session requise.
 *
 * Il permet à l'interface de dire la vérité sur le projet : l'inscription est-elle
 * ouverte ou fermée ? faut-il confirmer son courriel ? — au lieu de proposer un geste que
 * le projet refuserait. Un outil qui taît ce genre d'état est un outil qui ment par omission.
 *
 * @returns {Promise<{inscriptionOuverte: boolean, confirmationParCourrielRequise: boolean}>}
 */
export async function lireReglages({ url, clePublique, fetchImpl = globalThis.fetch } = {}) {
  verifierArguments(url, clePublique, fetchImpl);
  const reponse = await fetchImpl(url + '/auth/v1/settings', {
    headers: { apikey: clePublique, Authorization: 'Bearer ' + clePublique },
  });
  if (!reponse.ok) throw await erreurDepuis(reponse, 'Lecture des réglages');
  const reglages = await reponse.json();
  return {
    inscriptionOuverte: reglages.disable_signup === false,
    confirmationParCourrielRequise: reglages.mailer_autoconfirm === false,
  };
}

/* ------------------------------------------------------------------ */
/* Port de stockage                                                    */
/* ------------------------------------------------------------------ */

/**
 * Crée l'adaptateur du port de stockage adossé à la base.
 *
 * L'interface est celle du port (SPEC §6 quater) : charger, sauvegarder, lister,
 * supprimer. `sauvegarder` accepte en plus une version attendue : c'est ce qui
 * empêche d'écraser le travail d'un autre poste sans le dire.
 *
 * Écart assumé et documenté : `lister()` rend des MÉTADONNÉES (identifiant,
 * référence, intitulé, version, date), pas les dossiers complets — charger tout
 * le contenu de tous les dossiers pour afficher une liste serait un gaspillage pur.
 * Le contenu complet s'obtient par `charger(id)`.
 *
 * @param {object} session issue de seConnecter/rafraichirSession
 * @returns {{charger: Function, sauvegarder: Function, lister: Function, supprimer: Function}}
 */
export function creerStockageSupabase(session) {
  if (!session || !session.url || !session.jeton) {
    throw new ErreurAuthentification('creerStockageSupabase : session requise (seConnecter d\'abord)');
  }
  let courante = session;
  const base = () => courante.url + '/rest/v1/dossiers';
  const entetes = (supplementaires = {}) => ({
    apikey: courante.clePublique,
    Authorization: 'Bearer ' + courante.jeton,
    'Content-Type': 'application/json',
    ...supplementaires,
  });

  // Renouvelle la session si le jeton approche de l'expiration (marge d'une minute).
  async function jetonFrais() {
    if (courante.expireLe && Date.now() > courante.expireLe - 60000) {
      courante = await rafraichirSession(courante);
    }
    return courante.jeton;
  }

  return {
    /** @returns {Promise<object>} le dossier (son contenu complet) */
    async charger(id) {
      if (typeof id !== 'string' || id === '') throw new TypeError('charger : identifiant attendu');
      await jetonFrais();
      const reponse = await appeler(courante.fetchImpl,base() + '?id=eq.' + encodeURIComponent(id) + '&select=*', {
        headers: entetes(),
      });
      if (!reponse.ok) throw await erreurDepuis(reponse, 'Chargement du dossier');
      const lignes = await reponse.json();
      if (!Array.isArray(lignes) || !lignes.length) {
        throw new Error('Dossier introuvable dans la base (« ' + id + ' »)');
      }
      const ligne = lignes[0];
      return {
        ...ligne.donnees,
        _base: { id: ligne.id, version: ligne.version, majLe: ligne.maj_le, majPar: ligne.maj_par },
      };
    },

    /**
     * Enregistre le dossier. Sans `versionAttendue`, la ligne est créée si elle
     * n'existe pas (identifiant absent). Avec, l'écriture est conditionnée à la
     * version : en cas de course, rien n'est écrasé et ErreurConflit est levée.
     * @returns {Promise<{id: string, version: number}>}
     */
    async sauvegarder(projet, { versionAttendue = null } = {}) {
      if (!projet || typeof projet !== 'object') throw new TypeError('sauvegarder : dossier objet attendu');
      await jetonFrais();
      const identifiant = projet._base && projet._base.id ? projet._base.id : null;
      const corps = {
        reference: (projet.operation && projet.operation.reference) || '(sans référence)',
        intitule: (projet.operation && projet.operation.intitule) || null,
        donnees: projet,
        maj_le: new Date().toISOString(),
      };

      if (!identifiant) {
        const reponse = await appeler(courante.fetchImpl,base(), {
          method: 'POST',
          headers: entetes({ Prefer: 'return=representation' }),
          body: JSON.stringify({ ...corps, version: 1 }),
        });
        if (!reponse.ok) throw await erreurDepuis(reponse, 'Création du dossier');
        const lignes = await reponse.json();
        const ligne = Array.isArray(lignes) ? lignes[0] : lignes;
        return { id: ligne.id, version: ligne.version };
      }

      const version = versionAttendue === null
        ? (projet._base && projet._base.version) || 1
        : versionAttendue;
      const reponse = await appeler(courante.fetchImpl,
        base() + '?id=eq.' + encodeURIComponent(identifiant) + '&version=eq.' + Number(version),
        {
          method: 'PATCH',
          headers: entetes({ Prefer: 'return=representation' }),
          body: JSON.stringify({ ...corps, version: Number(version) + 1 }),
        },
      );
      if (!reponse.ok) throw await erreurDepuis(reponse, 'Enregistrement du dossier');
      const lignes = await reponse.json();
      if (!Array.isArray(lignes) || lignes.length === 0) {
        // Aucune ligne touchée : la version a changé sous nos pieds. On lit la version
        // distante pour la DONNER à l'utilisateur — il doit pouvoir trancher, pas deviner.
        let distante = null;
        try {
          const lecture = await appeler(courante.fetchImpl,
            base() + '?id=eq.' + encodeURIComponent(identifiant) + '&select=version,maj_le,maj_par',
            { headers: entetes() },
          );
          if (lecture.ok) {
            const l = await lecture.json();
            if (Array.isArray(l) && l.length) distante = l[0].version;
          }
        } catch { /* la lecture du conflit est un confort, pas une condition */ }
        throw new ErreurConflit(
          'Ce dossier a été modifié sur un autre poste depuis son ouverture. '
          + 'Votre version n\'a PAS été écrasée : enregistrez-la sous un autre nom, ou rechargez la version distante.',
          distante,
        );
      }
      return { id: lignes[0].id, version: lignes[0].version };
    },

    /** @returns {Promise<Array<{id, reference, intitule, version, majLe}>>} */
    async lister() {
      await jetonFrais();
      const reponse = await appeler(courante.fetchImpl,
        base() + '?select=id,reference,intitule,version,maj_le&order=maj_le.desc',
        { headers: entetes() },
      );
      if (!reponse.ok) throw await erreurDepuis(reponse, 'Liste des dossiers');
      const lignes = await reponse.json();
      return (Array.isArray(lignes) ? lignes : []).map((l) => ({
        id: l.id, reference: l.reference, intitule: l.intitule,
        version: l.version, majLe: l.maj_le,
      }));
    },

    /**
     * TOUS les dossiers, contenu compris, en une seule lecture. C'est la source de la
     * sauvegarde : un dossier à la fois ne serait pas une sauvegarde, ce serait une
     * procédure, et une procédure ne se fait pas.
     *
     * Les politiques d'accès font le tri : on exporte exactement ce que la session a le
     * droit de lire, ni plus, ni moins. Pas de pagination : la table porte des dossiers
     * de marché, pas un journal — quelques dizaines de lignes. Si elle devait grossir au
     * point de le nécessiter, il faudrait le voir, pas le masquer par une boucle muette.
     * @returns {Promise<Array<object>>} lignes brutes
     */
    async exporterTout() {
      await jetonFrais();
      const reponse = await appeler(courante.fetchImpl,
        base() + '?select=*&order=id.asc', { headers: entetes() });
      if (!reponse.ok) throw await erreurDepuis(reponse, 'Sauvegarde de tous les dossiers');
      const lignes = await reponse.json();
      return Array.isArray(lignes) ? lignes : [];
    },

    /**
     * Repose un dossier issu d'une sauvegarde, en CONSERVANT son identifiant — sans
     * quoi une restauration créerait des doublons au lieu de rétablir l'état.
     *
     * Deux écritures distinctes, et volontairement pas un upsert unique : créer un
     * dossier absent et écraser un dossier présent n'ont pas les mêmes conséquences, et
     * l'appelant a déjà tranché (voir planifierRestauration). Un upsert masquerait cette
     * différence au moment précis où elle compte.
     * @param {{id:string, reference?:string, intitule?:string, donnees:object}} dossier
     * @param {{ecraser?: boolean}} [options]
     */
    async reposerDossier(dossier, { ecraser = false } = {}) {
      if (!dossier || typeof dossier !== 'object' || !dossier.id) {
        throw new TypeError('reposerDossier : dossier avec identifiant attendu');
      }
      await jetonFrais();
      const corps = {
        id: dossier.id,
        reference: dossier.reference || '(sans référence)',
        intitule: dossier.intitule ?? null,
        donnees: dossier.donnees,
        maj_le: new Date().toISOString(),
      };
      if (ecraser) {
        const reponse = await appeler(courante.fetchImpl,
          base() + '?id=eq.' + encodeURIComponent(dossier.id),
          {
            method: 'PATCH',
            headers: entetes({ Prefer: 'return=representation' }),
            // La version AVANCE au lieu de revenir à celle de la sauvegarde : les autres
            // postes doivent voir qu'une écriture a eu lieu. Reposer une version plus
            // basse ferait croire à un retour en arrière à la détection de conflit.
            body: JSON.stringify({ ...corps, version: Number(dossier.version || 1) + 1 }),
          });
        if (!reponse.ok) throw await erreurDepuis(reponse, 'Restauration du dossier');
        const lignes = await reponse.json();
        if (!Array.isArray(lignes) || lignes.length === 0) {
          throw new Error('Restauration : le dossier « ' + dossier.id + ' » est introuvable dans la base.');
        }
        return { id: lignes[0].id, version: lignes[0].version, action: 'remplace' };
      }
      const reponse = await appeler(courante.fetchImpl, base(), {
        method: 'POST',
        headers: entetes({ Prefer: 'return=representation' }),
        body: JSON.stringify({ ...corps, version: Number(dossier.version || 1) }),
      });
      if (!reponse.ok) throw await erreurDepuis(reponse, 'Restauration du dossier');
      const lignes = await reponse.json();
      const ligne = Array.isArray(lignes) ? lignes[0] : lignes;
      return { id: ligne.id, version: ligne.version, action: 'cree' };
    },

    /** @returns {Promise<void>} */
    async supprimer(id) {
      if (typeof id !== 'string' || id === '') throw new TypeError('supprimer : identifiant attendu');
      await jetonFrais();
      const reponse = await appeler(courante.fetchImpl,base() + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: entetes(),
      });
      if (!reponse.ok) throw await erreurDepuis(reponse, 'Suppression du dossier');
    },
  };
}
