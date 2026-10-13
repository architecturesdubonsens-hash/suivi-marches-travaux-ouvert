// js/ui/panneau-partage.js — dossier partagé entre les postes (SPEC §6 quinquies).
//
// ÉCRAN 4 : tout ce qui touche au DOSSIER plutôt qu'aux documents — se connecter,
// voir les dossiers de la base, ouvrir, enregistrer, et traiter un conflit.
//
// Ce module est autonome : il porte son propre état et n'emprunte au contexte que
// le dossier courant (ctx.projet), de quoi le remplacer (ctx.remplacerProjet) et le
// re-rendu (ctx.reRendre). Aucun autre écran n'a besoin de connaître la base.
//
// PRINCIPE : la base n'est jamais obligatoire. Sans configuration, ou sans session,
// l'application fonctionne exactement comme avant — le dossier vit dans le navigateur
// et l'échange passe par l'export JSON. On ne casse pas ce qui marche.

import { el, toast } from "./helpers.js";
import { CONFIG, stockagePartageConfigure } from "../config.js";
import {
  seConnecter, seDeconnecter, rafraichirSession, creerStockageSupabase,
  changerMotDePasse, lireReglages, creerCompte,
  ErreurConflit, ErreurAuthentification,
} from "../stockage-supabase.js";

const CLE_SESSION = "smt-session-partage";
/** Longueur minimale d'un mot de passe, à la création comme au changement. */
const LONGUEUR_MIN_MDP = 8;

/** État du module : session ouverte, adaptateur, liste, message courant. */
let session = null;
let port = null;
let dossiers = null;
let message = null;
let occupe = false;
// Réglages PUBLICS du projet (inscription ouverte ?), lus une seule fois. Ils servent à ne
// proposer que les gestes que le projet accepte (pas de « Créer un compte » si l'inscription
// est fermée). null = pas encore lu ; { indisponible: true } = illisible (hors ligne) : on
// propose alors le geste, et le projet répondra par une erreur claire s'il le refuse.
let reglages = null;

/** Conteneur fourni par la coquille (index.html : #barre-dossier). */
let hote = null;
/** La copie en cours diffère-t-elle de celle de la base ? (garde-fou avant remplacement) */
let modifie = false;
/** La saisie du courriel survit à un re-rendu de la barre : on ne la retape pas. */
let saisieCourriel = "";
/** La liste a-t-elle déjà été demandée ? (évite de boucler sur un échec réseau) */
let listeTentee = false;
let listeEnCours = false;

/** Retient la session entre deux visites (jeton de rafraîchissement seulement). */
function memoriserSession(s) {
  try {
    if (!s) localStorage.removeItem(CLE_SESSION);
    else localStorage.setItem(CLE_SESSION, JSON.stringify({
      email: (s.utilisateur && s.utilisateur.email) || null,
      jetonRafraichissement: s.jetonRafraichissement,
    }));
  } catch { /* navigation privée : la session ne survivra pas au rechargement, sans gravité */ }
}

function sessionMemorisee() {
  try {
    const brut = localStorage.getItem(CLE_SESSION);
    return brut ? JSON.parse(brut) : null;
  } catch { return null; }
}

/** Rouvre une session mémorisée. Rend true si la base est utilisable. */
export async function restaurerSessionPartage() {
  if (!stockagePartageConfigure() || session) return Boolean(session);
  const memo = sessionMemorisee();
  if (!memo || !memo.jetonRafraichissement) return false;
  try {
    const prealable = {
      url: CONFIG.urlSupabase, clePublique: CONFIG.clePubliqueSupabase,
      jeton: null, jetonRafraichissement: memo.jetonRafraichissement,
      utilisateur: { email: memo.email }, expireLe: 0, fetchImpl: globalThis.fetch,
    };
    session = await rafraichirSession(prealable);
    port = creerStockageSupabase(session);
    memoriserSession(session);
    return true;
  } catch (erreur) {
    session = null; port = null;
    memoriserSession(null);
    message = "Session expirée : reconnectez-vous pour retrouver les dossiers partagés.";
    return false;
  }
}

/** Résumé d'une ligne pour la liste : référence, intitulé, date. */
function resumer(ligne) {
  const date = ligne.majLe ? new Date(ligne.majLe).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "date inconnue";
  return (ligne.reference || "(sans référence)")
    + (ligne.intitule ? " — " + ligne.intitule : "")
    + " · v" + ligne.version + " · " + date;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function connecter(ctx, email, motDePasse) {
  occupe = true; message = null; ctx.reRendre();
  try {
    session = await seConnecter({
      url: CONFIG.urlSupabase, clePublique: CONFIG.clePubliqueSupabase, email, motDePasse,
    });
    port = creerStockageSupabase(session);
    memoriserSession(session);
    saisieCourriel = "";
    listeTentee = false;
    dossiers = await port.lister();
    message = "Connecté. " + dossiers.length + " dossier(s) dans la base.";
  } catch (erreur) {
    session = null; port = null;
    message = erreur && erreur.message ? erreur.message : String(erreur);
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

/**
 * Crée un compte, puis connecte la personne si le projet n'exige pas de confirmation par
 * courriel. Sinon, elle est invitée à cliquer le lien reçu : le compte ne sert qu'après.
 */
async function creerUnCompte(ctx, email, motDePasse) {
  if (!email || !motDePasse) {
    message = "Saisissez un courriel et un mot de passe pour créer votre compte.";
    ctx.reRendre();
    return;
  }
  if (motDePasse.length < LONGUEUR_MIN_MDP) {
    message = "Le mot de passe doit comporter au moins " + LONGUEUR_MIN_MDP + " caractères : le compte n'a pas été créé.";
    ctx.reRendre();
    return;
  }
  occupe = true; message = null; ctx.reRendre();
  try {
    const resultat = await creerCompte({
      url: CONFIG.urlSupabase, clePublique: CONFIG.clePubliqueSupabase, email, motDePasse,
    });
    if (resultat.session) {
      session = resultat.session;
      port = creerStockageSupabase(session);
      memoriserSession(session);
      saisieCourriel = "";
      listeTentee = false;
      dossiers = await port.lister();
      message = "Compte créé, vous êtes connecté. Vos dossiers vous appartiennent : vous seul pouvez les voir.";
    } else {
      saisieCourriel = email;
      message = "Un courriel de confirmation vient d'être envoyé à " + email + " (si ce compte n'existait pas déjà). "
        + "Cliquez le lien qu'il contient, puis connectez-vous ici.";
    }
  } catch (erreur) {
    session = null; port = null;
    message = erreur && erreur.message ? erreur.message : String(erreur);
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

async function deconnecter(ctx) {
  occupe = true; ctx.reRendre();
  try { if (session) await seDeconnecter(session); } catch { /* sans conséquence */ }
  session = null; port = null; dossiers = null;
  memoriserSession(null);
  message = "Déconnecté : le dossier reste dans ce navigateur, et l'échange entre postes passe par l'export JSON.";
  occupe = false;
  ctx.reRendre();
}

async function rafraichirListe(ctx) {
  if (!port) return;
  occupe = true; message = null; ctx.reRendre();
  try {
    dossiers = await port.lister();
    message = dossiers.length + " dossier(s) dans la base.";
  } catch (erreur) {
    message = erreur && erreur.message ? erreur.message : String(erreur);
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

/** Le dossier courant porte-t-il une saisie qu'on ne peut pas perdre en silence ? */
function aDuContenu(p) {
  if (!p) return false;
  const operation = p.operation || {};
  return Boolean(operation.reference || operation.intitule)
    || (p.entreprises || []).length > 0
    || (p.devis || []).length > 0;
}

async function ouvrir(ctx, id, libelle) {
  if (!id) return;
  // GARDE-FOU : ouvrir un dossier REMPLACE celui en cours, définitivement. Si celui-ci
  // contient des modifications absentes de la base, on le dit AVANT de le faire —
  // jamais après. C'est le même principe que le refus d'écraser une version distante.
  if (modifie && aDuContenu(ctx.projet)) {
    const accord = window.confirm(
      "Le dossier en cours contient des modifications qui ne sont PAS enregistrées dans la base.\n\n"
      + "Ouvrir « " + (libelle || "le dossier choisi") + " » les remplacera définitivement.\n\n"
      + "Continuer ?");
    if (!accord) return;
  }
  occupe = true; message = null; ctx.reRendre();
  try {
    const charge = await port.charger(id);
    ctx.remplacerProjet(charge);
    modifie = false;
    message = "Dossier ouvert depuis la base (version " + (charge._base ? charge._base.version : "?") + ").";
    toast("Dossier ouvert depuis la base.", "succes");
  } catch (erreur) {
    message = erreur && erreur.message ? erreur.message : String(erreur);
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

async function enregistrer(ctx) {
  if (!port) return;
  occupe = true; message = null; ctx.reRendre();
  const projet = ctx.projet;
  const base = projet._base || null;
  try {
    const resultat = await port.sauvegarder(projet, { versionAttendue: base ? base.version : null });
    // On attache l'identité distante au dossier : c'est elle qui permettra la
    // prochaine écriture conditionnelle. Sans elle, chaque enregistrement créerait
    // une ligne de plus.
    ctx.majProjet((p) => {
      p._base = { id: resultat.id, version: resultat.version, majLe: new Date().toISOString() };
    }, { reRendre: false });
    dossiers = await port.lister();
    modifie = false;
    message = "Dossier enregistré dans la base (version " + resultat.version + ").";
    toast("Enregistré dans la base partagée.", "succes");
  } catch (erreur) {
    if (erreur instanceof ErreurConflit) {
      // Rien n'a été écrasé. On le dit, et on donne les deux issues possibles.
      message = erreur.message
        + (erreur.versionDistante ? " Version distante : " + erreur.versionDistante + "." : "");
    } else if (erreur instanceof ErreurAuthentification) {
      session = null; port = null; memoriserSession(null);
      message = "Session expirée : reconnectez-vous. Votre travail n'est PAS perdu, il est toujours dans ce navigateur.";
    } else {
      message = erreur && erreur.message ? erreur.message : String(erreur);
    }
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

/** Enregistre la version locale comme un NOUVEAU dossier (issue d'un conflit). */
async function enregistrerCommeNouveau(ctx) {
  if (!port) return;
  occupe = true; ctx.reRendre();
  try {
    const copie = { ...ctx.projet };
    delete copie._base;
    const resultat = await port.sauvegarder(copie, { versionAttendue: null });
    ctx.majProjet((p) => {
      p._base = { id: resultat.id, version: resultat.version, majLe: new Date().toISOString() };
      if (p.operation) p.operation.reference = (p.operation.reference || "") + " (copie locale)";
    }, { reRendre: false });
    dossiers = await port.lister();
    modifie = false;
    message = "Version locale enregistrée comme nouveau dossier (version 1).";
    toast("Votre version est enregistrée comme nouveau dossier.", "succes");
  } catch (erreur) {
    message = erreur && erreur.message ? erreur.message : String(erreur);
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

/** Change le mot de passe de la personne connectée. */
async function changerMdp(ctx, nouveau, confirmation) {
  if (!session) return;
  if (nouveau !== confirmation) {
    message = "Les deux mots de passe saisis ne correspondent pas : rien n'a été changé.";
    ctx.reRendre();
    return;
  }
  if (nouveau.length < LONGUEUR_MIN_MDP) {
    message = "Le mot de passe doit comporter au moins " + LONGUEUR_MIN_MDP + " caractères : rien n'a été changé.";
    ctx.reRendre();
    return;
  }
  occupe = true; message = null; ctx.reRendre();
  try {
    await changerMotDePasse(session, nouveau);
    message = "Mot de passe changé. Il n'est enregistré nulle part en clair : conservez-le.";
    toast("Mot de passe changé.", "succes");
  } catch (erreur) {
    if (erreur instanceof ErreurAuthentification) {
      session = null; port = null; memoriserSession(null);
      message = "Session expirée : reconnectez-vous, puis changez le mot de passe. Rien n'a été modifié.";
    } else {
      message = erreur && erreur.message ? erreur.message : String(erreur);
    }
  } finally {
    occupe = false;
    ctx.reRendre();
  }
}

/* ------------------------------------------------------------------ */
/* Rendu — barre de dossier, visible sur TOUS les écrans               */
/* ------------------------------------------------------------------ */

/**
 * Barre de dossier partagé, rendue dans #barre-dossier par js/app.js à chaque
 * re-rendu d'écran. C'est ici, et nulle part ailleurs, qu'on se connecte et qu'on
 * choisit une opération.
 *
 * POURQUOI ELLE N'EST PLUS À L'ÉTAPE 4. Le panneau vivait au bas de l'écran
 * « Génération » — le dernier écran, celui des livrables. À l'ouverture, rien
 * n'indiquait qu'une connexion existait, ni qu'il y avait des dossiers à ouvrir.
 * Constat de l'utilisateur, sur l'application déployée : « Je ne vois pas de fenêtre
 * de connexion, ni de navigation entre projets. » Il avait raison : se connecter et
 * choisir une opération sont les PREMIÈRES choses qu'on fait, pas les dernières.
 *
 * Elle ne rend QUE sa propre zone, et jamais l'écran : un re-rendu d'écran ne fait
 * donc pas perdre une saisie en cours dans la barre.
 */
export function barreDossier(ctx, conteneur) {
  hote = conteneur;
  rendreBandeau(ctx);
}

/** Signale que la copie en cours diffère de celle de la base. */
export function signalerModification() {
  modifie = true;
}

/**
 * Réglages publics déjà lus (inscription ouverte ?), ou null si pas encore lus.
 *
 * L'AVERTISSEMENT N'EST PLUS DANS LA BARRE. Il y occupait une ligne pleine largeur, sur
 * les quatre écrans, en permanence — un rappel permanent pour un état qu'on connaît
 * désormais. Il a été retiré à la demande de l'utilisateur le 25/09/2026, et déplacé
 * dans le mode d'emploi, section « Les comptes » : l'information reste disponible, mais
 * on va la chercher au lieu de la subir.
 */
/** Port de stockage de la session en cours, ou null si personne n'est connecté.
    La sauvegarde passe par là : elle est faite avec la session de l'utilisateur, donc
    sans clé de service et sans secret nouveau. */
export function portCourant() {
  return port;
}

export function reglagesCourants() {
  return reglages;
}

/** Recharge la liste SANS repasser par le re-rendu d'écran — donc sans boucle. */
async function chargerListeSilencieux(ctx) {
  if (!port || listeEnCours) return;
  listeEnCours = true;
  try {
    dossiers = await port.lister();
  } catch { /* la barre offre « Actualiser » : on ne boucle pas sur un échec réseau */ }
  finally {
    listeEnCours = false;
    rendreBandeau(ctx);
  }
}

function rendreBandeau(ctx) {
  if (!hote) return;
  hote.replaceChildren();
  // Sans base configurée, l'application est purement locale : pas de barre, pas de bruit.
  if (!stockagePartageConfigure()) return;

  // Réglages publics, lus UNE fois : c'est ce qui permet de n'offrir « Créer un compte » que
  // si le projet accepte les inscriptions.
  if (reglages === null) {
    reglages = { indisponible: true };
    lireReglages({ url: CONFIG.urlSupabase, clePublique: CONFIG.clePubliqueSupabase })
      // La lecture revient APRÈS le premier rendu. Le bandeau d'avertissements doit donc
      // être refait à ce moment-là, sinon un réglage dangereux resterait invisible
      // jusqu'au prochain changement d'écran. Notifié par événement et non par import :
      // avertissements.js lit déjà ce module, l'importer en retour ferait un cycle.
      .then((lus) => {
        reglages = lus;
        rendreBandeau(ctx);
        document.dispatchEvent(new CustomEvent("reglages-base-lus"));
      })
      .catch(() => { /* illisible : on reste sur « indisponible », sans fausse alerte */ });
  }

  const barre = el("div", { classe: "barre-dossier" });
  barre.append(el("span", { classe: "etiquette", texte: "Dossier partagé" }));

  if (!session) {
    const iEmail = el("input", { type: "email", placeholder: "courriel", autocomplete: "username" });
    iEmail.value = saisieCourriel;                     // la saisie survit à un re-rendu
    iEmail.addEventListener("input", () => { saisieCourriel = iEmail.value; });
    const iMotDePasse = el("input", { type: "password", placeholder: "mot de passe", autocomplete: "current-password" });
    const bouton = el("button", { classe: "bouton primaire", texte: occupe ? "Connexion…" : "Se connecter" });
    bouton.addEventListener("click", () => connecter(ctx, iEmail.value.trim(), iMotDePasse.value));
    for (const champ of [iEmail, iMotDePasse]) {
      champ.addEventListener("keydown", (e) => { if (e.key === "Enter") bouton.click(); });
    }
    if (occupe) bouton.disabled = true;
    const boutonCreation = el("button", { classe: "bouton", texte: "Créer un compte" });
    boutonCreation.addEventListener("click", () => creerUnCompte(ctx, iEmail.value.trim(), iMotDePasse.value));
    if (occupe) boutonCreation.disabled = true;
    const inscriptionFermee = Boolean(reglages) && reglages.inscriptionOuverte === false;
    barre.append(iEmail, iMotDePasse, bouton);
    if (!inscriptionFermee) barre.append(boutonCreation);
    barre.append(el("span", { classe: "etat-dossier", texte: inscriptionFermee
      ? "L'inscription est fermée sur ce service. Sans connexion, le dossier reste dans ce navigateur."
      : "Créez votre compte ou connectez-vous : vos dossiers restent privés et vous suivent d'un poste à l'autre. "
        + "Sans connexion, le dossier reste dans ce navigateur." }));
  } else {
    const utilisateur = (session.utilisateur && session.utilisateur.email) || "utilisateur connecté";
    const base = ctx.projet._base || null;
    barre.append(el("span", { classe: "etat-dossier", texte: utilisateur }));

    // NAVIGATION ENTRE LES OPÉRATIONS : la liste des dossiers de la base.
    const choix = el("select", { "aria-label": "Choisir un dossier de la base" });
    choix.append(el("option", { value: "", texte: (dossiers && dossiers.length)
      ? "— choisir un dossier (" + dossiers.length + ") —"
      : "— aucun dossier dans la base —" }));
    for (const ligne of (dossiers || [])) {
      const ouvert = base && base.id === ligne.id;
      choix.append(el("option", { value: ligne.id, texte: resumer(ligne) + (ouvert ? "  (ouvert)" : "") }));
    }
    if (base) choix.value = base.id;

    const boutonOuvrir = el("button", { classe: "bouton", texte: "Ouvrir" });
    boutonOuvrir.disabled = !choix.value;
    choix.addEventListener("change", () => { boutonOuvrir.disabled = !choix.value; });
    boutonOuvrir.addEventListener("click", () => {
      const ligne = (dossiers || []).find((l) => l.id === choix.value);
      ouvrir(ctx, choix.value, ligne ? resumer(ligne) : null);
    });
    barre.append(choix, boutonOuvrir);

    const boutonEnregistrer = el("button", { classe: "bouton primaire",
      texte: occupe ? "…" : (base ? "Enregistrer" : "Créer dans la base") });
    boutonEnregistrer.addEventListener("click", () => enregistrer(ctx));
    if (occupe) boutonEnregistrer.disabled = true;
    barre.append(boutonEnregistrer);

    const boutonListe = el("button", { classe: "bouton discret", texte: "Actualiser" });
    boutonListe.addEventListener("click", () => rafraichirListe(ctx));
    const boutonDeconnexion = el("button", { classe: "bouton discret", texte: "Se déconnecter" });
    boutonDeconnexion.addEventListener("click", () => deconnecter(ctx));
    barre.append(boutonListe, boutonDeconnexion);

    // État du dossier courant : lié à la base, ou en attente d'y être déposé.
    const reference = (ctx.projet.operation && ctx.projet.operation.reference) || "(sans référence)";
    barre.append(el("span", { classe: "etat-dossier", texte: base
      ? "ouvert : " + reference + " · v" + base.version + (modifie ? " · modifications NON enregistrées" : "")
      : "ce dossier (" + reference + ") n'est PAS encore dans la base" }));

    if (message && /conflit|n'a PAS été écrasée/i.test(message)) {
      const boutonNouveau = el("button", { classe: "bouton", texte: "Enregistrer ma version comme nouveau dossier" });
      boutonNouveau.addEventListener("click", () => enregistrerCommeNouveau(ctx));
      barre.append(boutonNouveau);
    }

    // Repliée : la barre reste une barre.
    const details = el("details", {});
    details.append(el("summary", { texte: "Mon mot de passe" }));
    const iNouveau = el("input", { type: "password", placeholder: "nouveau mot de passe", autocomplete: "new-password" });
    const iConfirme = el("input", { type: "password", placeholder: "confirmer", autocomplete: "new-password" });
    const boutonMdp = el("button", { classe: "bouton", texte: occupe ? "…" : "Changer" });
    boutonMdp.addEventListener("click", () => changerMdp(ctx, iNouveau.value, iConfirme.value));
    if (occupe) boutonMdp.disabled = true;
    details.append(
      el("p", { classe: "aide", texte:
        "Changez ici le mot de passe de votre compte. Au moins " + LONGUEUR_MIN_MDP + " caractères." }),
      el("div", { classe: "champs-ligne" }, iNouveau, iConfirme, boutonMdp));
    barre.append(details);

    // À la reprise d'une session mémorisée, la liste n'a pas encore été lue.
    if (dossiers === null && !listeTentee && port) {
      listeTentee = true;
      chargerListeSilencieux(ctx);
    }
  }

  if (message) {
    const classe = /conflit|expirée|refusé|n'existe pas|impossible|ne correspondent pas|doit comporter|n'a été changé|pas été créé|fermée/i.test(message)
      ? "message-attente" : "message-info";
    barre.append(el("p", { classe: classe + " message-ligne", texte: message }));
  }

  hote.append(barre);
}
