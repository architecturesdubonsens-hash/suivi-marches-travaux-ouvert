// tests/sauvegarde-locale.mjs — l'utilisateur sait OÙ sont ses données, et comment les sortir.
//
// CE QUI EST VÉRIFIÉ. Par défaut, l'application n'enregistre le dossier que dans le navigateur
// du poste : c'est une propriété qu'un utilisateur ne peut pas deviner, et dont l'ignorance se paie
// d'un dossier perdu (données du site vidées, autre ordinateur, navigation privée). Les propriétés
// testées sont celles du TEXTE affiché à l'utilisateur — il doit dire quatre choses précises — et
// celles du fichier d'export. Le rendu et les boutons, eux, se vérifient dans un navigateur.
//
// Usage : node tests/sauvegarde-locale.mjs
import assert from "node:assert/strict";
import {
  texteSauvegardeLocale, nomFichierEtat, LIBELLE_ENREGISTRE, INFOBULLE_INDICATEUR,
} from "../js/ui/sauvegarde-locale.js";
import { creerProjetVide, exporterJSON, importerJSON } from "../js/etat.js";

let reussis = 0;
const echecs = [];
function cas(nom, bloc) {
  try { bloc(); reussis++; console.log("  ok    " + nom); }
  catch (e) { echecs.push(nom); console.error("  ECHEC " + nom); console.error("        " + (e && e.message ? e.message.split("\n")[0] : e)); }
}

const plat = (s) => s.paragraphes.join(" ");
console.log("Signalement de la sauvegarde locale");

cas("le texte dit que l'enregistrement a lieu UNIQUEMENT dans ce navigateur, et que rien n'est envoyé ailleurs", () => {
  const t = plat(texteSauvegardeLocale(false));
  assert.match(t, /uniquement dans ce navigateur/, "« uniquement dans ce navigateur »");
  assert.match(t, /Rien n'est envoyé ailleurs/, "« rien n'est envoyé ailleurs »");
});

cas("le texte dit ce qui fait perdre le dossier : données du site vidées, autre poste, navigation privée", () => {
  const t = plat(texteSauvegardeLocale(false));
  assert.match(t, /Vider les données du site/);
  assert.match(t, /navigation privée/);
  assert.match(t, /changer de navigateur ou d'ordinateur/);
});

cas("le texte nomme les deux gestes : exporter pour sauvegarder, importer pour reprendre", () => {
  const t = plat(texteSauvegardeLocale(false));
  assert.match(t, /Exportez-le pour le sauvegarder/);
  assert.match(t, /importez-le pour le reprendre/);
});

cas("sans base partagée configurée, le texte ne promet pas un partage qui n'existe pas", () => {
  assert.ok(!/Dossier partagé/.test(plat(texteSauvegardeLocale(false))), "aucune mention de « Dossier partagé »");
});

cas("avec une base partagée configurée, le texte l'indique comme alternative sans fichier", () => {
  assert.match(plat(texteSauvegardeLocale(true)), /« Dossier partagé »/);
});

cas("le titre annonce la même chose que le texte", () => {
  assert.match(texteSauvegardeLocale(false).titre, /dans ce navigateur/);
});

cas("l'indicateur d'en-tête dit OÙ l'enregistrement a eu lieu, et son info-bulle renvoie vers l'export", () => {
  assert.match(LIBELLE_ENREGISTRE, /dans ce navigateur/);
  assert.match(INFOBULLE_INDICATEUR, /uniquement dans ce navigateur/);
  assert.match(INFOBULLE_INDICATEUR, /Exportez/);
});

cas("nom du fichier d'export : dérivé de la référence de l'opération, extension .json", () => {
  const p = creerProjetVide();
  p.operation.reference = "OP-2026-01";
  assert.equal(nomFichierEtat(p), "PROJET-OP-2026-01.json");
  p.operation.reference = "Lot n°3 / Villa Étoile";
  assert.match(nomFichierEtat(p), /^PROJET-[A-Z0-9-]+\.json$/, "aucun caractère qui gêne un nom de fichier");
  assert.match(nomFichierEtat(creerProjetVide()), /^PROJET-.+\.json$/, "même sans référence, un nom valide");
});

cas("aller-retour : ce que l'export écrit, l'import le relit à l'identique (le dossier survit au fichier)", () => {
  const p = creerProjetVide();
  p.operation.reference = "OP-ALLER-RETOUR";
  p.operation.intitule = "Opération d'essai";
  p.agence.raisonSociale = "Agence d'essai";
  const relu = importerJSON(exporterJSON(p));
  assert.equal(relu.operation.reference, "OP-ALLER-RETOUR");
  assert.equal(relu.operation.intitule, "Opération d'essai");
  assert.equal(relu.agence.raisonSociale, "Agence d'essai");
  assert.equal(relu.retenueGarantieTaux, p.retenueGarantieTaux, "les paramètres financiers survivent aussi");
});

console.log("");
if (echecs.length) { console.error("BILAN sauvegarde locale : " + reussis + " ok, " + echecs.length + " ECHEC(s) -> " + echecs.join(" ; ")); process.exit(1); }
console.log("BILAN sauvegarde locale : " + reussis + " cas ok, 0 échec.");
