// js/ui/aide.js — RENDU de l'aide. Le texte, lui, vit dans js/aide-contenu.js.
//
// CE QUI A CHANGÉ, ET POURQUOI. Ce module portait à la fois le contenu du mode
// d'emploi et son affichage. Ajouter une aide contextuelle dans ces conditions aurait
// créé un second gisement de phrases : deux endroits à corriger quand une règle
// change, donc, tôt ou tard, deux versions de la même règle dont une fausse. Le texte
// est donc parti dans js/aide-contenu.js — source unique — et il ne reste ici que le
// rendu, partagé avec les bulles (voir brancherRendu dans js/ui/bulle.js).
//
// POURQUOI UN MODE D'EMPLOI EXISTE TOUT DE MÊME. La plupart des difficultés des 24 et
// 25/09/2026 n'étaient PAS des défauts : c'étaient des questions sans réponse écrite.
// Ce qu'on ne peut pas expliquer, on ne peut pas s'en servir.
//
// LA RÉPARTITION. Le mode d'emploi explique l'OUTIL — on le lit une fois. Les bulles
// expliquent le MARCHÉ — on les relit à chaque opération. Et l'état anormal du moment
// n'est ni l'un ni l'autre : il s'affiche à l'écran, voir js/ui/avertissements.js.

import { el } from "./helpers.js";
import { SECTIONS, TITRES_AIDE, JALONS, FICHES_HORS_ECRAN } from "../aide-contenu.js";
import { etatBaseEnUnePhrase } from "./avertissements.js";
import { brancherRendu, brancherModeEmploi, fermerBulle } from "./bulle.js";

export { TITRES_AIDE };

/* ------------------------------------------------------------------ */
/* Rendu des blocs — UNE implémentation, utilisée par les deux formes  */
/* ------------------------------------------------------------------ */

const ETIQUETTES_COUVERTURE = {
  outil: "tenu par l'application",
  partiel: "partiellement tenu",
  absent: "hors outil",
};

function rendreJalons() {
  const liste = el("ol", { classe: "aide-jalons" });
  for (const j of JALONS) {
    liste.append(el("li", { classe: "aide-jalon aide-jalon-" + j.couverture },
      el("span", { classe: "aide-jalon-titre", texte: j.titre }),
      el("span", { classe: "aide-jalon-couverture", texte: ETIQUETTES_COUVERTURE[j.couverture] || j.couverture }),
      el("span", { classe: "aide-texte", texte: j.quoi }),
      el("span", { classe: "aide-jalon-engage", texte: j.engage })));
  }
  return liste;
}

export function rendreBloc(bloc) {
  const [type, contenu, lignes] = bloc;
  if (type === "p") return el("p", { classe: "aide-texte", texte: contenu });
  if (type === "attention") return el("p", { classe: "message-attente", texte: contenu });
  if (type === "ul") return el("ul", { classe: "aide-liste" }, ...contenu.map((x) => el("li", { texte: x })));
  if (type === "cle") return el("div", { classe: "aide-question" },
    el("p", { classe: "aide-question-titre", texte: contenu }),
    el("p", { classe: "aide-texte", texte: lignes }));
  if (type === "jalons") return rendreJalons();
  if (type === "fichesHorsEcran") {
    // Ces fiches n'ont pas de bouton « ? » faute d'écran correspondant. Elles sont donc
    // rendues ici, telles quelles — même source, même grammaire de blocs. Une fiche
    // écrite mais inatteignable serait pire que pas de fiche : on croit l'avoir dite.
    const zone = el("div", { classe: "aide-hors-ecran" });
    for (const f of FICHES_HORS_ECRAN) {
      zone.append(el("h4", { classe: "aide-hors-ecran-titre", texte: f.titre }));
      for (const bloc of f.blocs) zone.append(rendreBloc(bloc));
    }
    return zone;
  }
  if (type === "tableau") {
    const t = el("table", { classe: "donnees aide-tableau" });
    t.append(el("thead", {}, el("tr", {}, ...contenu.map((h) => el("th", { texte: h })))));
    t.append(el("tbody", {}, ...lignes.map((l) => el("tr", {}, ...l.map((c) => el("td", { texte: c }))))));
    return t;
  }
  if (type === "etatBase") {
    // Lu en direct, et NON recopié : un texte figé dans un mode d'emploi devient faux
    // sans prévenir. La formulation vient d'avertissements.js.
    // DEPUIS LE 07/10/2026, CETTE FENÊTRE EST LE SEUL ENDROIT QUI PORTE L'ÉTAT DE LA BASE :
    // le bandeau d'écran a été retiré à la demande de l'utilisateur (« l'utilisateur n'a
    // pas à le voir »). Le bloc est donc placé dans la section « Mise en service — pour le
    // responsable », seule section adressée à celui qui peut corriger le réglage.
    const etat = etatBaseEnUnePhrase();
    return el("p", { classe: etat.gravite === "securite" ? "message-attente" : "aide-texte", texte: etat.texte });
  }
  if (type === "etapes") {
    const liste = el("ol", { classe: "aide-etapes" });
    for (const [titre, texte] of contenu) {
      liste.append(el("li", {},
        el("span", { classe: "aide-etape-titre", texte: titre }),
        el("span", { classe: "aide-texte", texte: texte })));
    }
    return liste;
  }
  return el("p", { texte: String(contenu) });
}

/** Construit le contenu du mode d'emploi (sans l'habillage de la fenêtre). */
export function contenuAide() {
  const corps = el("div", { classe: "aide-corps" });
  for (const section of SECTIONS) {
    // L'ancre permet d'ouvrir directement sur une section depuis une bulle. Dérivée du
    // titre, et non tenue dans une table à côté : un titre renommé ne peut pas laisser
    // une ancre orpheline, puisqu'il n'y a rien à renommer en double.
    corps.append(el("h3", { texte: section.titre, "data-section": section.titre }));
    for (const bloc of section.blocs) corps.append(rendreBloc(bloc));
  }
  return corps;
}

/* ------------------------------------------------------------------ */
/* Fenêtre                                                             */
/* ------------------------------------------------------------------ */

let voile = null;

function fermerAide() {
  if (!voile) return;
  voile.remove();
  voile = null;
  document.removeEventListener("keydown", surTouche);
  const bouton = document.getElementById("bouton-aide");
  if (bouton) bouton.focus();
}

function surTouche(evenement) {
  if (evenement.key === "Escape") fermerAide();
}

/**
 * Ouvre le mode d'emploi par-dessus l'écran courant.
 * @param {string} [section] titre exact d'une section : la fenêtre s'y positionne.
 */
export function ouvrirAide(section) {
  fermerBulle(); // une bulle restée ouverte sous le voile serait inatteignable
  if (voile) { if (section) allerASection(section); return; }
  voile = el("div", { classe: "aide-voile", role: "dialog", "aria-modal": "true", "aria-label": "Mode d'emploi" });
  // Cliquer À CÔTÉ ferme ; cliquer DEDANS ne ferme pas. On compare les deux cibles
  // plutôt que d'arrêter la propagation, qui masquerait d'autres gestionnaires.
  voile.addEventListener("click", (evenement) => { if (evenement.target === voile) fermerAide(); });

  const fenetre = el("div", { classe: "aide-fenetre" });
  const entete = el("div", { classe: "aide-entete" },
    el("h2", { texte: "Mode d'emploi" }),
    el("button", { classe: "bouton discret", type: "button", texte: "Fermer", onClick: fermerAide }));
  fenetre.append(entete, contenuAide());
  voile.append(fenetre);
  document.body.append(voile);
  document.addEventListener("keydown", surTouche);
  const premier = fenetre.querySelector("button");
  if (premier) premier.focus();
  if (section) allerASection(section);
}

function allerASection(titre) {
  if (!voile) return;
  const cible = voile.querySelector('[data-section="' + String(titre).replace(/"/g, '\\"') + '"]');
  if (!cible) return; // section inconnue : on laisse la fenêtre en haut plutôt que de sauter n'importe où
  cible.scrollIntoView({ block: "start" });
  cible.classList.add("aide-section-visee");
  setTimeout(() => cible.classList.remove("aide-section-visee"), 2000);
}

/** Branche le bouton de l'en-tête et les deux liaisons des bulles. Appelé une fois. */
export function installerAide() {
  brancherRendu(rendreBloc);
  brancherModeEmploi(ouvrirAide);
  const bouton = document.getElementById("bouton-aide");
  if (!bouton) return false;
  bouton.addEventListener("click", () => ouvrirAide());
  return true;
}
