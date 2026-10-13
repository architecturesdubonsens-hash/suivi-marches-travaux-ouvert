// js/ui/avertissements.js — ce qui doit être VU sans être cherché, et l'état de la base en clair.
//
// UN AVERTISSEMENT N'EST PAS DE L'AIDE.
//   Une aide explique ce qu'il faut faire ; un avertissement constate ce qui ne va pas
//   MAINTENANT, dans ce projet ou dans cette installation, et il s'affiche à l'écran.
//
// CE QUI JUSTIFIE UN AVERTISSEMENT. Trois conditions réunies : l'état est LU, pas supposé ;
// il est ANORMAL, pas simplement incomplet ; et il existe un GESTE pour le corriger.
//
// POURQUOI IL N'Y A PLUS D'AVERTISSEMENT DE SÉCURITÉ SUR L'INSCRIPTION. Dans ce modèle,
// l'inscription est OUVERTE par construction : chacun crée son compte, et la confidentialité
// des dossiers est portée par la base elle-même (chaque dossier appartient à son créateur,
// db/schema.sql, prouvé par db/test-isolation.sql). Une inscription ouverte n'est donc pas un
// état anormal. Si une installation en fait un autre usage (inscription fermée, comptes
// créés par un administrateur), c'est un choix légitime, que l'aide énonce sans l'alarmer.
// La fonction avertissementsCourants() reste pour y ranger les anomalies réelles qui
// apparaîtraient un jour ; elle est vide tant qu'il n'y en a pas.

import { el } from "./helpers.js";
import { stockagePartageConfigure } from "../config.js";
import { reglagesCourants } from "./panneau-partage.js";

/**
 * Avertissements en vigueur, lus à l'instant.
 * @returns {Array<{cle:string, gravite:'securite'|'attention', titre:string, texte:string, geste:string}>}
 */
export function avertissementsCourants() {
  return [];
}

/**
 * État de la base en une phrase, pour le mode d'emploi. Rend aussi le cas « illisible »,
 * que l'écran ne montre pas — un écran silencieux veut dire « rien à signaler », une aide
 * doit pouvoir le dire en mots.
 * @returns {{gravite:'securite'|'neutre', texte:string}}
 */
export function etatBaseEnUnePhrase() {
  if (!stockagePartageConfigure()) {
    return { gravite: "neutre", texte: "Aucune base n'est configurée : l'application fonctionne "
      + "localement, et l'échange entre postes passe par l'export JSON." };
  }
  const lus = reglagesCourants();
  if (!lus || lus.indisponible) {
    return { gravite: "neutre", texte: "L'état de la base n'a pas pu être lu (hors ligne ?). "
      + "Rouvrez cette aide une fois la connexion rétablie." };
  }
  if (lus.inscriptionOuverte) {
    return { gravite: "neutre", texte: "Vérifié à l'instant : l'inscription est OUVERTE. Chacun peut créer son compte, "
      + "et chaque dossier reste privé à son propriétaire (règle appliquée par la base)."
      + (lus.confirmationParCourrielRequise ? " Une confirmation par courriel est exigée à l'inscription." : "") };
  }
  return { gravite: "neutre", texte: "Vérifié à l'instant : l'inscription est FERMÉE. "
    + "Seuls les comptes déjà créés par l'administrateur peuvent se connecter." };
}

/* ------------------------------------------------------------------ */
/* Rendu dans #bandeau — présent sur tous les écrans, vide si rien    */
/* ------------------------------------------------------------------ */

// #bandeau existe dans index.html, au-dessus de la barre de dossier. Il reste vide tant
// qu'avertissementsCourants() ne renvoie rien.
export function rafraichirAvertissements() {
  const hote = document.getElementById("bandeau");
  if (!hote) return 0;
  const liste = avertissementsCourants();
  hote.replaceChildren(...liste.map((a) => el("div", { classe: "message-attente" },
    el("strong", { texte: a.titre + " — " }), el("span", { texte: a.texte + " " + a.geste }))));
  return liste.length;
}

// Les réglages de la base sont lus de façon asynchrone, donc APRÈS le premier rendu :
// l'écoute est posée une fois, au chargement du module.
if (typeof document !== "undefined") {
  document.addEventListener("reglages-base-lus", () => {
    try { rafraichirAvertissements(); } catch { /* ne doit jamais casser l'écran */ }
  });
}
