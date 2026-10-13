// js/app.js : contrôleur principal.
//
// Machine à états du workflow en 4 écrans (cahier des charges § 4) :
//   1 Configuration -> 2 Dépôt -> 3 Validation -> 4 Génération.
//
// Les modules PARTENAIRES (js/calculs.js, js/assurances.js, js/etat.js,
// js/referentiels.js; les 4 générateurs — agents B et C) sont
// chargés UNIQUEMENT par import() dynamique, avec pré-vérification silencieuse
// par fetch : l'application doit démarrer sans AUCUNE erreur de console même
// quand aucun partenaire n'est encore livré, et rester utilisable
// partiellement (panneau d'état à l'écran 4).
//
// La persistance passe par js/etat.js (contrat §8) : sauvegarde automatique
// débouncée à chaque modification. Tant que le module est absent, l'état vit
// en mémoire dans un objet conforme au contrat (SPEC §2) et l'indicateur
// d'en-tête l'explique clairement.

import { el, toast, debounce } from "./ui/helpers.js";
import { afficher as ecranConfiguration } from "./ui/ecran-configuration.js";
import { afficher as ecranDepot } from "./ui/ecran-depot.js";
import { afficher as ecranValidation } from "./ui/ecran-validation.js";
import { afficher as ecranGeneration } from "./ui/ecran-generation.js";
import { restaurerSessionPartage, barreDossier, signalerModification } from "./ui/panneau-partage.js";
import { installerAide } from "./ui/aide.js";
import { rafraichirAvertissements } from "./ui/avertissements.js";
import { MODULES_PARTENAIRES, symbolesManquants } from "./ui/etat-modules.js";

/* ------------------------------------------------------------------ */
/* État applicatif                                                     */
/* ------------------------------------------------------------------ */

/** Miroir local du contrat de données (SPEC §2) : sert tant que js/etat.js
 * n'est pas livré, et pour compléter un état importé partiel. */
function creerProjetLocal() {
  return {
    operation: { reference: "", intitule: "", adresse: "", cp: "", ville: "", droc: "", dureePrevisionnelleMois: null, pc: "", faitLe: "", lieuFait: "" },
    maitreOuvrage: { raisonSociale: "", representant: "", qualiteRepresentant: "", siren: "", adresse: "", cp: "", ville: "" },
    agence: { raisonSociale: "", forme: "", representant: "", siren: "", siret: "", adresse: "", cp: "", ville: "", tel: "", email: "" },
    entreprises: [],
    devis: [],
    attestations: [],
    equipe: { architecteSignataire: "", conducteursTravaux: [] },
    retenueGarantieTaux: 0.05,
    penalites: { tauxJournalier: null, montantMaxPct: null },
    OS: [],
    avenants: [],
  };
}

/** Garantit que tous les sous-objets/tables du contrat existent (import JSON
 *  partiel, ancienne version...) sans jamais écraser une donnée présente. */
function completerProjet(p) {
  const defaut = creerProjetLocal();
  for (const cle of Object.keys(defaut)) {
    if (p[cle] === undefined) p[cle] = defaut[cle];
  }
  for (const cle of ["operation", "maitreOuvrage", "agence", "equipe", "penalites"]) {
    if (typeof p[cle] !== "object" || p[cle] === null || Array.isArray(p[cle])) p[cle] = defaut[cle];
    else for (const sous of Object.keys(defaut[cle])) {
      if (p[cle][sous] === undefined) p[cle][sous] = defaut[cle][sous];
    }
  }
  for (const cle of ["entreprises", "devis", "attestations", "OS", "avenants"]) {
    if (!Array.isArray(p[cle])) p[cle] = [];
  }
  if (!Array.isArray(p.equipe.conducteursTravaux)) p.equipe.conducteursTravaux = [];

  // Clé de stockage STABLE — défaut trouvé le 25/09/2026 : js/etat.js enregistre sous
  // projet.id (un identifiant tiré au hasard par creerProjetVide), tandis que
  // l'application RELIT sous la clé fixe « courant ». Écrire et lire à deux endroits
  // différents faisait perdre toute la saisie à chaque rechargement de la page.
  // L'application gère UN dossier courant : son identifiant EST cette clé. Pour
  // conserver plusieurs dossiers, on passe par l'export JSON (bouton de l'écran 4).
  p.id = "courant";
}

const ECRANS = [
  { titre: "Configuration", module: ecranConfiguration },
  { titre: "Dépôt", module: ecranDepot },
  { titre: "Validation", module: ecranValidation },
  { titre: "Génération", module: ecranGeneration },
];

let projet = null;
let ecranCourant = 0;
let indicateur = null;
const services = { calculs: null, assurances: null, etat: null, referentiels: null };
const etatsModules = new Map();
/** Textes extraits des PDF (mémoire de session) : permet de relancer
 *  l'analyse d'assurance à l'écran 3 quand le module arrive plus tard. */
const dossier = { textesParSource: new Map() };

/* ------------------------------------------------------------------ */
/* Chargement défensif des modules partenaires                         */
/* ------------------------------------------------------------------ */

/**
 * Teste chaque module contractuel, sans bruit de console :
 *  - fetch HEAD (une 404 de fetch ne logge RIEN, contrairement à un
 *    import() raté) -> si absent, statut « en attente », pas d'import ;
 *  - import() si le fichier existe, puis vérification des symboles §8.
 */
async function chargerPartenaires() {
  for (const def of MODULES_PARTENAIRES) {
    let disponible = true;
    try {
      const reponse = await fetch(def.chemin, { method: "HEAD" });
      disponible = reponse.ok;
    } catch {
      disponible = true; // file:// : fetch interdit -> on tente l'import réel
    }
    if (!disponible) {
      const cause = "fichier introuvable (réponse HEAD non 200) — déploiement incomplet ou cache";
      etatsModules.set(def.chemin, { statut: "absent", detail: cause });
      console.info("[module indisponible]", def.chemin, "—", cause);
      continue;
    }
    try {
      const mod = await import(def.importer);
      const manquants = symbolesManquants(mod, def.symboles);
      if (manquants.length) {
        const cause = "symboles contractuels manquants (SPEC §8) : " + manquants.join(", ");
        etatsModules.set(def.chemin, { statut: "erreur", detail: cause });
        console.info("[module indisponible]", def.chemin, "—", cause);
        continue;
      }
      etatsModules.set(def.chemin, { statut: "charge", detail: "conforme au contrat (SPEC §8)" });
      if (def.chemin === "js/calculs.js") services.calculs = mod;
      else if (def.chemin === "js/assurances.js") services.assurances = mod;
      else if (def.chemin === "js/etat.js") services.etat = mod;
      else if (def.chemin === "js/referentiels.js") services.referentiels = mod;
    } catch (erreur) {
      const cause = "échec de chargement : " + (erreur && erreur.message ? erreur.message : erreur);
      etatsModules.set(def.chemin, { statut: "erreur", detail: cause });
      console.info("[module indisponible]", def.chemin, "—", cause);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sauvegarde automatique                                              */
/* ------------------------------------------------------------------ */

function majIndicateur(texte) {
  if (indicateur) indicateur.textContent = texte;
}

async function sauvegarder() {
  if (!services.etat || typeof services.etat.sauvegarderProjet !== "function") {
    majIndicateur("Enregistrement automatique indisponible — ne quittez pas la page");
    return;
  }
  try {
    await services.etat.sauvegarderProjet(projet);
    majIndicateur("Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  } catch (erreur) {
    majIndicateur("Échec de la sauvegarde : " + (erreur && erreur.message ? erreur.message : erreur));
  }
}
const planifierSauvegarde = debounce(sauvegarder, 800);

/** Mutation du projet + sauvegarde + (re)rendu éventuel. */
function majProjet(mutation, options = {}) {
  if (typeof mutation === "function") mutation(projet);
  planifierSauvegarde();
  // Signale à la barre de dossier que la copie en cours n'est plus identique à celle
  // de la base : c'est ce qui permet d'AVERTIR avant de la remplacer, au lieu de
  // perdre une saisie en silence.
  signalerModification();
  if (options.reRendre !== false) reRendre();
}

/* ------------------------------------------------------------------ */
/* Contexte passé aux écrans                                           */
/* ------------------------------------------------------------------ */

const ctx = {
  get projet() { return projet; },
  services,
  etatsModules,
  dossier,
  majProjet,
  /** Navigation vers l'écran d'index donné (0..3). */
  aller(index) {
    ecranCourant = Math.max(0, Math.min(ECRANS.length - 1, index));
    reRendre();
    window.scrollTo(0, 0);
  },
  /** Re-rendu de l'écran courant (après chaque mutation visible). */
  reRendre,
  /** Re-test de tous les modules partenaires (bouton du panneau). */
  async reverifierModules() {
    await chargerPartenaires();
    reRendre();
  },
  /** Remplace tout le projet (import JSON) puis re-rend et sauvegarde. */
  remplacerProjet(nouveau) {
    if (!nouveau || typeof nouveau !== "object") throw new Error("État importé illisible.");
    projet = nouveau;
    completerProjet(projet);
    reRendre();
    planifierSauvegarde();
  },
};

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

function marquerEtape() {
  const boutons = document.querySelectorAll("#etapes .etape");
  boutons.forEach((bouton, index) => {
    bouton.classList.toggle("courante", index === ecranCourant);
    bouton.classList.toggle("joignable", true);
  });
}

function reRendre() {
  marquerEtape();

  // La barre de dossier est rendue AVEC l'écran : elle est donc visible partout, et
  // pas seulement sur l'écran qui la porte. Elle ne doit jamais pouvoir casser un
  // écran — d'où un try/catch qui lui est propre.
  const zoneBarre = document.getElementById("barre-dossier");
  if (zoneBarre) {
    try { barreDossier(ctx, zoneBarre); }
    catch (erreur) { console.info("Barre de dossier interrompue :", erreur); }
  }

  // Les avertissements d'état sont rendus À CHAQUE écran, au-dessus du contenu, et pas
  // dans la fenêtre d'aide : un avertissement qu'il faut aller chercher n'est pas lu.
  // Même traitement défensif que la barre — un avertissement ne casse pas un écran.
  try { rafraichirAvertissements(); }
  catch (erreur) { console.info("Bandeau d'avertissements interrompu :", erreur); }

  const conteneur = document.getElementById("contenu");
  if (!conteneur) return;
  try {
    ECRANS[ecranCourant].module(conteneur, ctx);
  } catch (erreur) {
    // Un bug d'écran ne doit jamais tuer l'application : message lisible.
    console.info("Rendu de l'écran interrompu :", erreur);
    conteneur.replaceChildren(el("section", { classe: "carte" },
      el("h2", { texte: "Affichage momentanément interrompu" }),
      el("p", { classe: "message-attente", texte: "Erreur : " + (erreur && erreur.message ? erreur.message : erreur) }),
      el("button", { classe: "bouton", texte: "Réessayer", onClick: () => reRendre() })));
  }
}

function construireNavigation() {
  const nav = document.getElementById("etapes");
  if (!nav) return;
  ECRANS.forEach((ecran, index) => {
    const bouton = el("button", { classe: "etape", type: "button" },
      el("span", { classe: "numero", texte: String(index + 1) }),
      el("span", { classe: "libelle-long", texte: ecran.titre }));
    bouton.addEventListener("click", () => ctx.aller(index));
    nav.append(bouton);
  });
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

async function demarrer() {
  indicateur = document.getElementById("sauvegarde-indicateur");
  construireNavigation();
  installerAide();

  await chargerPartenaires();

  // Projet : état persistant via le contrat js/etat.js, sinon miroir local.
  if (services.etat && typeof services.etat.creerProjetVide === "function") {
    let charge = null;
    try {
      charge = await services.etat.chargerProjet("courant");
    } catch { /* IndexedDB indisponible ou projet absent : on repart à vide */ }
    projet = charge && typeof charge === "object" ? charge : services.etat.creerProjetVide();
  } else {
    projet = creerProjetLocal();
  }
  completerProjet(projet);

  // Session partagée (SPEC § 6 quinquies) : si un jeton a été mémorisé, on rouvre la
  // session en silence pour que les dossiers de la base soient accessibles d'emblée.
  // La base n'est JAMAIS obligatoire : sans configuration, ou si le jeton a expiré,
  // l'application continue exactement comme avant, en local.
  try {
    await restaurerSessionPartage();
  } catch {
    /* sans conséquence : on reste en mode local */
  }

  reRendre();
  majIndicateur(services.etat
    ? "Sauvegarde automatique activée"
    : "Enregistrement automatique indisponible — ne quittez pas la page");
  const manquants = MODULES_PARTENAIRES.filter((def) => {
    const etat = etatsModules.get(def.chemin);
    return !etat || etat.statut !== "charge";
  });
  if (manquants.length) {
    toast(manquants.length === 1
      ? "Une fonction est indisponible : " + manquants[0].fonction + ". Détail dans l'écran Génération."
      : manquants.length + " fonctions sont indisponibles — détail dans l'écran Génération.",
    "info", 6000);
  }
}

// Un module ES importé en Node (contrôle de syntaxe) n'exécute rien :
// document est absent, demarrer() n'est jamais appelé.
if (typeof document !== "undefined") {
  demarrer().catch((erreur) => {
    console.info("Démarrage interrompu :", erreur);
    majIndicateur("Erreur au démarrage : " + (erreur && erreur.message ? erreur.message : erreur));
  });
}
