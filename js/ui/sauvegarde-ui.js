// js/ui/sauvegarde-ui.js — deux boutons, et rien de plus.
//
// VOLONTAIREMENT MINIMAL. Un bouton qui sauvegarde tous les dossiers en un fichier, un
// bouton qui relit ce fichier et repose ce qui manque. Pas de signal d'ancienneté, pas
// d'orientation de l'emplacement, pas de panneau : ce qui manquait n'était pas du
// confort, c'était la sauvegarde elle-même. Le reste se verra quand celle-ci servira.
//
// La logique est dans js/sauvegarde.js, éprouvée de bout en bout par tests/sauvegarde.mjs
// sur une base simulée. Ce fichier ne fait que relier des boutons à cette logique.

import { el, toast, telecharger } from "./helpers.js";
import { portCourant } from "./panneau-partage.js";
import {
  construireSauvegarde, nomFichierSauvegarde, relireSauvegarde,
  planifierRestauration, comparerSauvegardes,
} from "../sauvegarde.js";

/** Sauvegarde : tous les dossiers, un fichier, et un contrôle avant de le proposer. */
async function sauvegarderTout() {
  const port = portCourant();
  if (!port) {
    toast("Connectez-vous d'abord à la base partagée (barre « Dossier partagé », en haut) : la sauvegarde "
      + "se fait avec votre session.", "erreur");
    return;
  }
  try {
    const lignes = await port.exporterTout();
    if (lignes.length === 0) {
      toast("La base ne contient aucun dossier : il n'y a rien à sauvegarder.", "info");
      return;
    }
    const sauvegarde = construireSauvegarde(lignes);
    const texte = JSON.stringify(sauvegarde, null, 2);

    // CONTRÔLE AVANT TÉLÉCHARGEMENT : on relit le texte qu'on est en train de proposer,
    // et on le compare à ce qui a été lu. Un fichier qu'on n'a pas relu une fois n'est
    // pas une sauvegarde — autant s'en apercevoir maintenant qu'au moment de s'en servir.
    const relu = relireSauvegarde(texte);
    const controle = comparerSauvegardes(sauvegarde, relu.sauvegarde);
    if (!relu.valide || !controle.identique) {
      toast("Sauvegarde ABANDONNÉE : le fichier produit ne se relit pas correctement ("
        + relu.motifs.join(" / ") + "). Rien n'a été téléchargé.", "erreur", 12000);
      console.info("[sauvegarde] contrôle échoué", relu.motifs, controle);
      return;
    }

    telecharger(new Blob([texte], { type: "application/json" }), nomFichierSauvegarde());
    toast(sauvegarde.nbDossiers + " dossier(s) sauvegardé(s), relus et vérifiés. Empreinte "
      + sauvegarde.empreinte + ".", "succes", 9000);
  } catch (erreur) {
    toast("Sauvegarde impossible : " + (erreur && erreur.message ? erreur.message : erreur), "erreur", 12000);
  }
}

/** Restauration : relit un fichier, repose ce qui MANQUE, ne touche pas à l'existant. */
async function restaurer(fichier, surFin) {
  const port = portCourant();
  if (!port) {
    toast("Connectez-vous d'abord à la base partagée (barre « Dossier partagé », en haut).", "erreur");
    return;
  }
  try {
    const relu = relireSauvegarde(await fichier.text());
    if (!relu.valide) {
      toast("Fichier refusé : " + relu.motifs.join(" / "), "erreur", 12000);
      return;
    }
    const presents = await port.lister();
    // Mode « completer » seul : il ne peut rien détruire. Écraser un dossier existant
    // demande de trancher au cas par cas, ce qui n'est pas fait ici — et tant que ce
    // n'est pas fait, ne pas l'offrir vaut mieux que l'offrir à moitié.
    const plan = planifierRestauration(relu.sauvegarde, presents, { mode: "completer" });
    if (plan.aCreer.length === 0) {
      toast("Les " + relu.sauvegarde.nbDossiers + " dossier(s) de la sauvegarde sont déjà "
        + "dans la base : rien à reposer.", "info", 8000);
      return;
    }
    if (!window.confirm("Reposer " + plan.aCreer.length + " dossier(s) absent(s) de la base ?\n\n"
      + plan.ignores.length + " dossier(s) déjà présent(s) ne seront PAS modifiés.")) return;

    let reposes = 0;
    const echecs = [];
    for (const d of plan.aCreer) {
      try { await port.reposerDossier(d, { ecraser: false }); reposes += 1; }
      catch (e) { echecs.push((d.reference || d.id) + " : " + (e && e.message ? e.message : e)); }
    }
    if (echecs.length) {
      toast(reposes + " dossier(s) reposé(s), " + echecs.length + " en échec — " + echecs[0], "erreur", 14000);
      console.info("[restauration] échecs", echecs);
    } else {
      toast(reposes + " dossier(s) reposé(s) dans la base.", "succes", 9000);
    }
    if (surFin) surFin();
  } catch (erreur) {
    toast("Restauration impossible : " + (erreur && erreur.message ? erreur.message : erreur), "erreur", 12000);
  }
}

/** La rangée de deux boutons, à insérer dans un écran. */
export function boutonsSauvegarde(surFin) {
  const entree = el("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  entree.addEventListener("change", () => {
    const fichier = entree.files && entree.files[0];
    entree.value = ""; // permet de rechoisir le même fichier après une correction
    if (fichier) restaurer(fichier, surFin);
  });
  return el("div", { classe: "rangee-boutons" },
    el("button", { classe: "bouton", type: "button", texte: "Sauvegarder tous les dossiers",
      onClick: sauvegarderTout }),
    el("button", { classe: "bouton", type: "button", texte: "Restaurer depuis une sauvegarde",
      onClick: () => entree.click() }),
    entree);
}
