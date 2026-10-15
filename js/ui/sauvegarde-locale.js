// js/ui/sauvegarde-locale.js — dire OÙ vivent les données, et offrir de les sortir.
//
// POURQUOI CE MODULE EXISTE. Par défaut, l'application n'envoie rien nulle part : le dossier est
// enregistré automatiquement dans le navigateur de CE poste (IndexedDB). C'est une propriété
// importante — et invisible : l'en-tête disait seulement « Enregistré », et l'export n'existait
// qu'à la dernière étape, sous une phrase technique. Un utilisateur qui change de poste, vide les
// données du site ou ouvre une fenêtre de navigation privée perd son dossier sans avoir su qu'il
// pouvait l'exporter.
//
// Ce module porte donc, en UN seul endroit, la formulation et les deux gestes (exporter, importer).
// Il est affiché dès l'écran Configuration, et rappelé à l'étape Génération : la logique n'existe
// qu'une fois, pour que les deux écrans ne puissent pas dire des choses différentes.

import { el, toast, telecharger, slug } from "./helpers.js";
import { stockagePartageConfigure } from "../config.js";

/** Texte court de l'indicateur d'en-tête : il dit où l'enregistrement a eu lieu. */
export const LIBELLE_ENREGISTRE = "Enregistré dans ce navigateur à ";

/** Info-bulle de l'indicateur d'en-tête. */
export const INFOBULLE_INDICATEUR =
  "Vos données sont enregistrées uniquement dans ce navigateur, sur ce poste. "
  + "Exportez votre dossier (fichier JSON) pour le sauvegarder ou le reprendre ailleurs : écran Configuration, en haut.";

/**
 * La formulation, séparée du rendu pour pouvoir être testée sans navigateur.
 * @param {boolean} [partageConfigure] une base partagée est-elle configurée ?
 * @returns {{titre: string, paragraphes: string[]}}
 */
export function texteSauvegardeLocale(partageConfigure = stockagePartageConfigure()) {
  const paragraphes = [
    "Votre dossier est enregistré automatiquement, mais uniquement dans ce navigateur, sur ce poste. "
      + "Rien n'est envoyé ailleurs.",
    "Vider les données du site, changer de navigateur ou d'ordinateur, ou ouvrir une fenêtre de navigation privée "
      + "vous ferait perdre ce dossier. Exportez-le pour le sauvegarder, puis importez-le pour le reprendre, ici ou "
      + "sur un autre poste.",
  ];
  if (partageConfigure) {
    paragraphes.push(
      "Pour le retrouver sans fichier sur plusieurs postes, connectez-vous à la barre « Dossier partagé » "
      + "et enregistrez-le dans la base.");
  }
  return { titre: "Vos données restent dans ce navigateur", paragraphes };
}

/** Nom du fichier d'export : stable et lisible, dérivé de la référence de l'opération. */
export function nomFichierEtat(projet) {
  const reference = projet && projet.operation && projet.operation.reference;
  return "PROJET-" + (slug(reference) || "etat") + ".json";
}

/**
 * Les deux gestes : exporter le dossier ouvert en JSON, importer un JSON qui le REMPLACE.
 * @param {object} ctx contexte des écrans (ctx.projet, ctx.services.etat, ctx.remplacerProjet)
 */
export function boutonsExportImport(ctx) {
  const etat = ctx.services && ctx.services.etat;

  const boutonExport = el("button", { classe: "bouton primaire", texte: "Exporter le dossier (JSON)", type: "button" });
  boutonExport.addEventListener("click", () => {
    const json = etat && typeof etat.exporterJSON === "function"
      ? etat.exporterJSON(ctx.projet)
      : JSON.stringify(ctx.projet, null, 2);
    telecharger(new Blob([json], { type: "application/json" }), nomFichierEtat(ctx.projet));
    toast("Dossier exporté : conservez ce fichier, il contient tout le dossier.", "succes");
  });

  const saisieImport = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  saisieImport.addEventListener("change", async () => {
    const fichier = saisieImport.files[0];
    saisieImport.value = "";
    if (!fichier) return;
    // Importer REMPLACE le dossier en cours : on demande avant, jamais après.
    if (!window.confirm("Importer « " + fichier.name + " » remplace le dossier en cours dans ce navigateur. Continuer ?")) return;
    try {
      const texte = await fichier.text();
      const importe = etat && typeof etat.importerJSON === "function" ? etat.importerJSON(texte) : JSON.parse(texte);
      ctx.remplacerProjet(importe);
      toast("Dossier importé : " + fichier.name, "succes");
    } catch (erreur) {
      toast("Import impossible : " + (erreur && erreur.message ? erreur.message : erreur), "erreur");
    }
  });

  const boutonImport = el("button", { classe: "bouton", texte: "Importer un dossier (JSON)", type: "button" });
  boutonImport.addEventListener("click", () => saisieImport.click());

  return el("div", { classe: "rangee-boutons" }, boutonExport, boutonImport, saisieImport);
}

/** La carte complète : ce que dit la formulation, puis les deux gestes. */
export function blocSauvegardeLocale(ctx) {
  const { titre, paragraphes } = texteSauvegardeLocale();
  return el("section", { classe: "carte", id: "bloc-sauvegarde-locale" },
    el("h2", { texte: titre }),
    ...paragraphes.map((p) => el("p", { classe: "aide", texte: p })),
    boutonsExportImport(ctx));
}
