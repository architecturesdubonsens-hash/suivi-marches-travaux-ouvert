// js/ui/etat-modules.js
//
// Définition des modules PARTENAIRES (contractuels, SPEC §8) et écran de
// contrôle qui affiche l'état de chacun. Les quatre agents écrivent en
// parallèle dans le même dépôt : cette vue dit explicitement ce qui est
// disponible, ce qui est attendu (et de qui), et ce qui est non conforme.
//
// Cette interface n'importe ces modules QUE par import() dynamique, jamais en
// static : l'application doit rester ouvrable et utilisable partiellement tant
// que les partenaires ne sont pas livrés.

/** Cartographie des modules écrits par les autres agents. */
export const MODULES_PARTENAIRES = [
  {
    fonction: "le calcul des montants (TVA, variantes, prorata, montant en lettres)",
    malgre: "Les montants hors taxes déjà saisis restent enregistrés, et la saisie continue",
    chemin: "js/calculs.js", agent: "A",
    role: "Règles de calcul : TVA, variantes, prorata, montants en lettres",
    importer: "./calculs.js",
    symboles: ["montantAvecVariantes", "appliquerProrata", "montantEnLettres", "chainageAvenant", "retenueGarantie", "penalites"],
  },
  {
    fonction: "le contrôle des assurances et le voyant de conformité décennale",
    malgre: "Les attestations déjà déposées restent enregistrées, et le dépôt continue",
    chemin: "js/assurances.js", agent: "A",
    role: "Analyse des attestations, voyant vert/orange/rouge",
    importer: "./assurances.js",
    symboles: ["analyserAttestation", "adequationActivite", "controler"],
  },
  {
    fonction: "l'enregistrement automatique du dossier",
    malgre: "La saisie en cours reste à l'écran, mais elle ne survivra pas au rechargement",
    // Geste PROPRE à ce module : le conseil général « rechargez la page » détruirait
    // exactement la saisie que la phrase précédente annonce comme fragile. Exporter
    // d'abord est le seul ordre qui ne perd rien.
    geste: "Exportez l'état du dossier en JSON depuis l'écran Génération AVANT de recharger la page, "
      + "puis réimportez-le : sans cela la saisie en cours serait perdue.",
    chemin: "js/etat.js", agent: "A",
    role: "Modèle de données + persistance IndexedDB",
    importer: "./etat.js",
    symboles: ["creerProjetVide", "chargerProjet", "sauvegarderProjet", "exporterJSON", "importerJSON"],
  },
  {
    fonction: "le pré-remplissage des données de référence",
    malgre: "Tous les champs restent saisissables à la main",
    chemin: "js/referentiels.js", agent: "A",
    role: "Référentiels : agence (vide), entreprises d'exemple, types de pièces",
    importer: "./referentiels.js",
    symboles: ["AGENCE_PAR_DEFAUT", "ENTREPRISES_EXEMPLE", "TYPES_PIECES", "SYNONYMES_LOTS"],
  },
  {
    fonction: "la production des ordres de service",
    malgre: "Les autres pièces du dossier se génèrent normalement",
    chemin: "js/gen-os.js", agent: "B",
    role: "Ordre de Service (.xlsx)",
    importer: "./gen-os.js",
    symboles: ["genererOS"],
  },
  {
    fonction: "la production des fiches d'avenant",
    malgre: "Les autres pièces du dossier se génèrent normalement",
    chemin: "js/gen-avenant.js", agent: "B",
    role: "Fiches d'avenant (.xlsx, gabarit réel AV1)",
    importer: "./gen-avenant.js",
    symboles: ["genererAvenant"],
  },
  {
    fonction: "la production des marchés de travaux",
    malgre: "Les autres pièces du dossier se génèrent normalement",
    chemin: "js/gen-marche.js", agent: "C",
    role: "Marché de Travaux CCAP NF P 03-001 (.docx)",
    importer: "./gen-marche.js",
    symboles: ["genererMarche"],
  },
  {
    fonction: "la production du compte rendu de chantier",
    malgre: "Les autres pièces du dossier se génèrent normalement",
    chemin: "js/gen-crc.js", agent: "C",
    role: "Compte rendu de chantier n°01 (.docx)",
    importer: "./gen-crc.js",
    symboles: ["genererCRC01"],
  },
];

/** Texte des statuts, côté utilisateur. « en attente » a été retiré : rien n'est en
    attente de livraison — un module qui ne se charge pas est un module en panne. */
export const LIBELLES_STATUT = {
  charge: "disponible",
  absent: "indisponible",
  erreur: "indisponible",
};

/**
 * Message affiché quand une fonction est indisponible. Quatre parties, toujours dans
 * cet ordre : QUOI est indisponible, en termes métier ; ce qui reste POSSIBLE malgré
 * tout ; le GESTE à faire ; et à qui cela revient si le geste ne suffit pas.
 *
 * CE QUE CE MESSAGE NE DIT PLUS, ET POURQUOI. Il disait « en attente d'un module »,
 * et nommait un fichier. Les deux étaient faux ou inutiles : il n'y a personne à
 * attendre, et rien n'est en cours de livraison. Le déclencheur réel est tout autre —
 * un module qui ne se charge pas (HEAD non-200, échec d'import, symbole contractuel
 * manquant). Le diagnostic reste donc exact et utile, mais il part en console et dans
 * l'indicateur de l'écran Génération ; le texte affiché, lui, parle du métier.
 *
 * @param {string} chemin identifiant interne du module
 * @returns {string} message destiné à l'utilisateur, sans jargon ni nom de fichier
 */
export function messageIndisponible(chemin) {
  const def = MODULES_PARTENAIRES.find((d) => d.chemin === chemin);
  if (!def) return "Une fonction de l'application est momentanément indisponible. Rechargez la page.";
  const geste = def.geste
    || "Rechargez la page pour la rétablir.";
  return "Fonction momentanément indisponible : " + def.fonction + ". " + def.malgre + ". " + geste
    + " Si le message revient après rechargement, l'application est mal déployée : "
    + "signalez-le à la personne qui administre l'application.";
}

/** Modules qui ne sont pas chargés. Vide = tout va bien, et il n'y a rien à afficher. */
export function modulesIndisponibles(etats) {
  if (!etats) return [];
  return MODULES_PARTENAIRES.filter((def) => {
    const etat = etats.get(def.chemin);
    return !etat || etat.statut !== "charge";
  });
}

/**
 * Vérifie les symboles contractuels d'un module chargé.
 * @param {object} mod module importé
 * @param {string[]} symboles attendus (SPEC §8)
 * @returns {string[]} liste des symboles manquants (vide = conforme)
 */
export function symbolesManquants(mod, symboles) {
  return symboles.filter((s) => typeof mod[s] === "undefined");
}

/**
 * Indicateur des fonctions indisponibles. REND null QUAND TOUT VA BIEN.
 *
 * CE QUI A CHANGÉ, ET POURQUOI PAS UNE SUPPRESSION. C'était une carte intitulée
 * « État des modules partenaires », affichée en permanence sur l'écran Génération,
 * même les huit modules verts, et qui expliquait à l'utilisateur que « chaque module
 * est écrit par un agent distinct (répartition) ». Rien de cela ne le
 * concerne : c'était l'organisation d'une session de construction, exposée dans
 * l'interface d'un outil de production.
 *
 * Mais le diagnostic a de la valeur, et la supprimer l'aurait renvoyé à la seule
 * console — c'est-à-dire hors de portée de la personne qui appelle pour dire que
 * « les montants ne s'affichent plus ». C'est le SEUL endroit consultable où la cause
 * réelle d'un échec de chargement est lisible sans ouvrir les outils de développement.
 * Ce qui n'avait pas de valeur, c'était sa permanence et son vocabulaire. Les deux
 * sont corrigés : elle n'apparaît que lorsqu'une fonction manque réellement, elle
 * parle du métier, et la cause technique est reléguée en second rang, sous un intitulé
 * qui annonce qu'elle est destinée au dépannage.
 *
 * @param {Map<string, {statut:string, detail:string}>} etats remplie par app.js
 * @param {()=>void=} surReverification action du bouton de nouvelle tentative
 * @returns {HTMLElement|null} null si toutes les fonctions sont disponibles
 */
export function construireIndicateur(etats, surReverification) {
  const manquants = modulesIndisponibles(etats);
  if (manquants.length === 0) return null;

  const section = document.createElement("section");
  section.className = "carte carte-indisponible";
  const titre = document.createElement("h2");
  titre.textContent = manquants.length === 1
    ? "Une fonction est indisponible"
    : manquants.length + " fonctions sont indisponibles";
  const aide = document.createElement("p");
  aide.className = "aide";
  aide.textContent = "Le reste de l'application fonctionne normalement, et aucune saisie n'est perdue. "
    + "Rechargez la page pour rétablir ces fonctions. Si elles manquent encore après rechargement, "
    + "l'application est mal déployée : signalez-le à la personne qui administre l'application.";
  section.append(titre, aide);

  const liste = document.createElement("ul");
  liste.className = "liste-indisponibles";
  for (const def of manquants) {
    const etat = etats.get(def.chemin) || { statut: "absent", detail: "jamais testé" };
    const li = document.createElement("li");
    const quoi = document.createElement("span");
    quoi.className = "indisponible-fonction";
    quoi.textContent = def.fonction.charAt(0).toUpperCase() + def.fonction.slice(1) + ".";
    const malgre = document.createElement("span");
    malgre.className = "indisponible-malgre";
    malgre.textContent = def.malgre + ".";
    li.append(quoi, malgre);
    liste.append(li);
  }
  section.append(liste);

  if (surReverification) {
    const bouton = document.createElement("button");
    bouton.className = "bouton";
    bouton.textContent = "Réessayer";
    bouton.addEventListener("click", surReverification);
    section.append(bouton);
  }

  // Le détail technique, replié et annoncé comme tel : il sert à réparer, pas à
  // informer. Même contenu qu'en console, pour que la personne au téléphone puisse
  // le lire sans ouvrir les outils de développement.
  const details = document.createElement("details");
  details.className = "indisponible-technique";
  const resume = document.createElement("summary");
  resume.textContent = "Détail technique (pour le dépannage)";
  details.append(resume);
  const pre = document.createElement("pre");
  pre.textContent = manquants
    .map((def) => {
      const etat = etats.get(def.chemin) || { statut: "absent", detail: "jamais testé" };
      return def.chemin + " — " + (LIBELLES_STATUT[etat.statut] || etat.statut) + " — " + (etat.detail || "");
    })
    .join("\n");
  details.append(pre);
  section.append(details);

  return section;
}
