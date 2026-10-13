// tests/agence-vide.mjs — les quatre générateurs avec une agence VIDE.
//
// POURQUOI CE TEST EXISTE. Cette application ne présuppose rien sur l'agence qui s'en sert :
// elle démarre avec une agence vide (js/referentiels.js, AGENCE_PAR_DEFAUT), que l'utilisateur
// renseigne à l'écran Configuration. Tous les autres tests utilisent une agence renseignée ; ils
// ne verraient donc pas deux défauts qui frapperaient pourtant chaque nouvel utilisateur :
//   1. un gabarit qui porterait encore, en dur, l'identité de son auteur : tant que l'agence est
//      vide, le générateur ne remplace rien, et le document sortirait au nom de quelqu'un d'autre ;
//   2. un champ vide rendu littéralement (« undefined », « null », « NaN ») dans un document
//      destiné à être signé.
// Les propriétés vérifiées sont donc des PROPRIÉTÉS DU DOCUMENT PRODUIT, lues dans son XML
// pas l'existence d'une fonction.
//
// Usage : node tests/agence-vide.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chargerUMD } from "./lib/chargeur-umd.mjs";
import { creerProjetVide } from "../js/etat.js";
import { genererMarche } from "../js/gen-marche.js";
import { genererCRC01 } from "../js/gen-crc.js";
import { genererOS } from "../js/gen-os.js";
import { genererAvenant } from "../js/gen-avenant.js";

const JSZip = chargerUMD(fileURLToPath(new URL("../vendor/jszip.min.js", import.meta.url)), "JSZip");
const ExcelJS = chargerUMD(fileURLToPath(new URL("../vendor/exceljs.min.js", import.meta.url)), "ExcelJS");
const fixture = (nom) => JSON.parse(readFileSync(new URL("fixtures/" + nom, import.meta.url), "utf8"));

let reussis = 0;
const echecs = [];
async function cas(nom, bloc) {
  try { await bloc(); reussis++; console.log("  ok    " + nom); }
  catch (e) { echecs.push(nom); console.error("  ECHEC " + nom); console.error("        " + (e && e.message ? e.message.split("\n")[0] : e)); }
}

// L'agence EXACTEMENT telle que la crée l'application pour un nouvel utilisateur.
const agenceVide = () => JSON.parse(JSON.stringify(creerProjetVide().agence));
const projetDocx = fixture("projet-docx.json");
const projetXlsx = fixture("projet-xlsx.json");
// Mémoire de ce que les fixtures portaient comme agence : il ne doit apparaître nulle part.
const nomAgenceFixture = projetDocx.agence.raisonSociale;
// Agence ET équipe vides, comme pour un nouvel utilisateur : l'architecte signataire est lui aussi
// une saisie de l'utilisateur (Projet.equipe), et sort dans le bloc agence de l'ordre de service.
for (const p of [projetDocx, projetXlsx]) {
  p.agence = agenceVide();
  p.equipe = JSON.parse(JSON.stringify(creerProjetVide().equipe));
}
assert.ok(nomAgenceFixture && nomAgenceFixture.length > 5, "garde-fou du test : la fixture avait bien une agence à effacer");

/** Toutes les parties XML d'une archive office, concaténées et réduites à leur texte. */
async function texteArchive(blob) {
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const parties = {};
  for (const nom of Object.keys(zip.files)) {
    if (zip.files[nom].dir || !/\.xml$/.test(nom)) continue;
    parties[nom] = await zip.file(nom).async("string");
  }
  const aplatir = (xml) => xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
  return { parties, texte: Object.values(parties).map(aplatir).join(" ") };
}

const LITTERAUX = /\bundefined\b|\bnull\b|\bNaN\b|\[object/;

function verifierPropre(nomDocument, { parties, texte }) {
  const m = texte.match(LITTERAUX);
  assert.equal(m, null, nomDocument + " : valeur vide rendue littéralement (« " + (m && m[0]) + " ») : …"
    + (m ? texte.slice(Math.max(0, m.index - 60), m.index + 60) : ""));
  assert.ok(!texte.includes(nomAgenceFixture), nomDocument + " : l'agence effacée de la fixture réapparaît dans le document");
}

console.log("Générateurs avec une agence vide");

await cas("marché de travaux : aucune valeur littérale, aucune agence fantôme, pied de page sans nom", async () => {
  const doc = await texteArchive(await genererMarche(projetDocx, "voltalis"));
  verifierPropre("marché", doc);
  const pied = Object.entries(doc.parties).filter(([n]) => /footer/.test(n)).map(([, x]) => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  assert.ok(pied.length > 0, "le marché porte un pied de page");
  for (const p of pied) assert.match(p, /^Page /, "le pied de page commence par « Page » quand l'agence est vide : « " + p + " »");
});

await cas("compte rendu de chantier : aucune valeur littérale, aucune agence fantôme, pied de page sans nom", async () => {
  const doc = await texteArchive(await genererCRC01(projetDocx));
  verifierPropre("compte rendu", doc);
  const pied = Object.entries(doc.parties).filter(([n]) => /footer/.test(n)).map(([, x]) => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  for (const p of pied) assert.match(p, /^Page /, "pied de page : « " + p + " »");
});

await cas("ordre de service : aucune valeur littérale, bloc agence VIDE (le gabarit ne porte l'identité de personne)", async () => {
  const blob = await genererOS(projetXlsx, "ent-colorama");
  const doc = await texteArchive(blob);
  verifierPropre("ordre de service", doc);
  // Propriété lue dans le classeur produit : le bloc agence (F43 = titre fixe, F44 = raison sociale,
  // F45 = « Représentée par … ») ne porte l'identité de personne tant que l'agence est vide.
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(Buffer.from(await blob.arrayBuffer()).toString("latin1"));
  const feuille = classeur.worksheets[0];
  assert.equal(feuille.getCell("F43").value, "L'agence d'architecture", "le titre fixe du bloc agence subsiste");
  for (const adresse of ["F44", "F45"]) {
    const v = feuille.getCell(adresse).value;
    assert.ok(v === null || v === undefined || v === "", adresse + " doit être vide quand l'agence est vide, trouvé : " + JSON.stringify(v));
  }
});

await cas("avenant : aucune valeur littérale, aucune agence fantôme", async () => {
  const doc = await texteArchive(await genererAvenant(projetXlsx, "ent-desamia", projetXlsx.avenants[0]));
  verifierPropre("avenant", doc);
});

console.log("");
if (echecs.length) { console.error("BILAN agence vide : " + reussis + " ok, " + echecs.length + " ECHEC(s) -> " + echecs.join(" ; ")); process.exit(1); }
console.log("BILAN agence vide : " + reussis + " cas ok, 0 échec.");
