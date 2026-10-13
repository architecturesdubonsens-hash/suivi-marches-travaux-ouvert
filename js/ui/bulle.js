// js/ui/bulle.js — aide contextuelle à la demande, ancrée au titre concerné.
//
// POURQUOI UNE BULLE À LA DEMANDE, ET PAS UNE VISITE GUIDÉE.
// Une visite guidée au premier lancement a été écartée, pour une raison d'usage et
// non de goût : cet outil sert quelques fois par opération, à des mois d'intervalle.
// Une visite se subit une fois, se saute ensuite, et n'est jamais là le jour où
// quelqu'un bute sur « le cumul des avenants » au bout de six mois. Elle enseigne
// l'interface à qui sait déjà se servir d'un formulaire, et reste muette sur le
// métier, qui est la vraie difficulté. L'aide contextuelle a la propriété inverse :
// elle ne coûte rien à celui qui n'en a pas besoin, et elle est atteignable
// exactement là où la question se pose, indéfiniment.
//
// AUCUN SÉQUENCEMENT, DONC. Pas de « suivant », pas de progression, pas de mémoire
// de ce qui a été vu : il n'y a rien à terminer. Une bulle s'ouvre, se lit, se ferme.
//
// LE TEXTE NE VIT PAS ICI. Ce module ne contient pas une phrase d'aide : tout vient
// de js/aide-contenu.js. C'est la condition pour que l'aide de l'interface et le
// document d'explication hors interface ne divergent jamais.

import { el } from "./helpers.js";
import { fiche } from "../aide-contenu.js";

/* Une seule bulle ouverte à la fois : deux bulles superposées n'ont aucun sens,
   et la seconde masquerait la première. */
let ouverte = null;
let ancreCourante = null;
/* Fourni par app.js au démarrage : ouvrir le mode d'emploi à une section donnée.
   Injecté plutôt qu'importé pour éviter un cycle aide.js <-> bulle.js. */
let ouvrirModeEmploi = null;

/** Branche le lien « Tout le mode d'emploi ». Appelé une fois, au démarrage. */
export function brancherModeEmploi(fn) {
  ouvrirModeEmploi = typeof fn === "function" ? fn : null;
}

export function fermerBulle() {
  if (!ouverte) return;
  ouverte.remove();
  ouverte = null;
  document.removeEventListener("keydown", surTouche, true);
  document.removeEventListener("click", surClicAilleurs, true);
  window.removeEventListener("resize", fermerBulle);
  window.removeEventListener("scroll", fermerBulle, true);
  if (ancreCourante) {
    ancreCourante.setAttribute("aria-expanded", "false");
    ancreCourante.focus();
    ancreCourante = null;
  }
}

function surTouche(evenement) {
  if (evenement.key === "Escape") { evenement.stopPropagation(); fermerBulle(); }
}

// Cliquer DANS la bulle ou sur son bouton ne ferme pas ; ailleurs, oui. On compare
// par containment plutôt qu'en stoppant la propagation : arrêter la propagation
// masquerait les gestionnaires des écrans, qui sont nombreux.
function surClicAilleurs(evenement) {
  if (!ouverte) return;
  if (ouverte.contains(evenement.target)) return;
  if (ancreCourante && ancreCourante.contains(evenement.target)) return;
  fermerBulle();
}

/* Le rendu des blocs est celui du mode d'emploi : même grammaire, même source.
   Il est passé en paramètre par aide.js (brancherRendu) afin qu'il n'existe qu'UNE
   implémentation de « comment s'affiche un bloc d'aide » dans l'application. */
let rendreBloc = null;

/** Branche le rendu de blocs partagé avec le mode d'emploi. Appelé une fois. */
export function brancherRendu(fn) {
  rendreBloc = typeof fn === "function" ? fn : null;
}

/* Place la bulle sous son ancre, et la ramène dans la fenêtre si elle dépasse.
   Mesures prises APRÈS insertion : une largeur calculée sur un élément pas encore
   dans le document vaut zéro. */
function placer(boite, ancre) {
  const r = ancre.getBoundingClientRect();
  const marge = 8;
  boite.style.visibility = "hidden";
  boite.style.left = "0px";
  boite.style.top = "0px";
  const b = boite.getBoundingClientRect();
  let gauche = r.left;
  if (gauche + b.width > window.innerWidth - marge) gauche = window.innerWidth - b.width - marge;
  if (gauche < marge) gauche = marge;
  let haut = r.bottom + 6;
  // Pas de place en dessous : on passe au-dessus plutôt que de déborder.
  if (haut + b.height > window.innerHeight - marge && r.top - b.height - 6 > marge) {
    haut = r.top - b.height - 6;
  }
  boite.style.left = Math.round(gauche) + "px";
  boite.style.top = Math.round(haut) + "px";
  boite.style.visibility = "";
}

/** Ouvre la bulle de la fiche « cle », ancrée sur l'élément « ancre ». */
export function ouvrirBulle(cle, ancre) {
  const f = fiche(cle);
  // Clé inconnue : on n'invente rien et on n'affiche pas de bulle vide. Le cas est
  // par ailleurs refusé par tests/verif-coherence-aide.mjs avant d'arriver ici.
  if (!f) { console.info("[aide] fiche inconnue : " + cle); return; }
  const memeAncre = ouverte && ancreCourante === ancre;
  fermerBulle();
  if (memeAncre) return; // second clic sur le même « ? » : on referme, on ne rouvre pas.

  const boite = el("div", {
    classe: "aide-bulle",
    role: "dialog",
    "aria-label": "Aide : " + f.titre,
  });
  const entete = el("div", { classe: "aide-bulle-entete" },
    el("h4", { classe: "aide-bulle-titre", texte: f.titre }),
    el("button", { classe: "aide-bulle-fermer", type: "button", "aria-label": "Fermer l'aide",
      texte: "×", onClick: fermerBulle }));
  const corps = el("div", { classe: "aide-bulle-corps" });
  for (const bloc of f.blocs) {
    if (rendreBloc) corps.append(rendreBloc(bloc));
  }
  const pied = el("div", { classe: "aide-bulle-pied" },
    el("button", {
      classe: "bouton discret",
      type: "button",
      texte: "Tout le mode d'emploi",
      onClick: () => { const s = f.section; fermerBulle(); if (ouvrirModeEmploi) ouvrirModeEmploi(s); },
    }));
  boite.append(entete, corps, pied);
  document.body.append(boite);
  ouverte = boite;
  ancreCourante = ancre;
  ancre.setAttribute("aria-expanded", "true");
  placer(boite, ancre);
  const fermer = boite.querySelector(".aide-bulle-fermer");
  if (fermer) fermer.focus();
  // En capture : une bulle doit se fermer même si l'écran en dessous intercepte.
  document.addEventListener("keydown", surTouche, true);
  document.addEventListener("click", surClicAilleurs, true);
  window.addEventListener("resize", fermerBulle);
  window.addEventListener("scroll", fermerBulle, true);
}

/** Le bouton « ? » lui-même. Rend null si la clé n'a pas de fiche : pas de bouton mort. */
export function boutonAide(cle) {
  if (!fiche(cle)) return null;
  const bouton = el("button", {
    classe: "aide-ancre",
    type: "button",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    // Pas d'attribut title : ce serait une seconde source de texte d'aide, hors de
    // js/aide-contenu.js. Le libellé accessible suffit, et il ne dit rien du contenu.
    "aria-label": "Aide sur ce point",
    texte: "?",
    onClick: (e) => { e.preventDefault(); ouvrirBulle(cle, bouton); },
  });
  return bouton;
}

/**
 * Titre d'écran porteur de son aide. Remplace el("h2", { texte }) dans les écrans :
 * c'est le seul point de couplage entre les écrans et l'aide, et il tient en un
 * argument — la clé. Aucune table de correspondance à maintenir à côté.
 */
export function titreAide(balise, texte, cle) {
  const b = boutonAide(cle);
  return el(balise, { classe: "titre-avec-aide" }, el("span", { texte: texte }), b);
}
