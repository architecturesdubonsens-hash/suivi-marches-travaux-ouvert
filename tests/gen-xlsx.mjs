// tests/gen-xlsx.mjs — Tests des générateurs xlsx (OS + Avenant)
//
// CE QUE LE TEST FAIT, DANS L'ORDRE :
//   1. contrôle de structure des gabarits gabarits/os-gabarit.xlsx et
//      gabarits/avenant-gabarit.xlsx : feuille modèle,
//      système de dates 1904, pageSetup A4 + zone d'impression conservés,
//      valeurs dynamiques bien vidées, textes fixes bien présents ;
//   2. import des générateurs js/gen-os.js et js/gen-avenant.js ;
//   3. import de js/calculs.js. S'il est absent, le
//      test ÉCHOUE avec le message explicite « en attente de js/calculs.js
// » et le code 2 — jamais réécrit ici ;
//   4. génération RÉELLE : OS par entreprise, classeur multi-feuilles, avenants
//      n°1 et n°2 depuis tests/fixtures/projet-xlsx.json (fixture hermétique) ;
//   5. RELECTURE de chaque produit avec ExcelJS (même chargeur UMD que les
//      générateurs) et assertions : feuilles, cellules clés (raison sociale,
//      montants TTC/HT, libellés, chaînage (A)(B)(C)(D), forclusion QUINZE
//      JOURS, dates en série 1904), conservation du pageSetup ;
//   6. écriture des produits dans tests-output/ pour inspection humaine.
//
// Sortie attendue en fin d'exécution : « TESTS XLSX OK » (code 0).
// Commande : node tests/gen-xlsx.mjs  (Node 24, sans npm ni navigateur)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chargerUMD } from "./lib/chargeur-umd.mjs";
import { genererOS, genererClasseurOS } from "../js/gen-os.js";
import { genererAvenant } from "../js/gen-avenant.js";
import { serie1904VersDateISO, dateVersSerie1904 } from "../js/gen-os.js";

const RACINE = new URL("..", import.meta.url); // racine du dépôt, indépendante du cwd

let echecs = 0;
// Taux de TVA PAR DÉFAUT du contrat (SPEC §2 : « 20 % par défaut,
// surchargeable »). Toutes les assertions de TVA/TTC dérivent de CE taux
// aucun 1,2 ni 0,2 dispersé dans le test ; le cas non standard est couvert
// à l'étape 6 bis (taux du devis 0,1, taux du projet 0,05).
const TAUX_DEFAUT = 0.2;
function verifie(condition, libelle, detail) {
  if (condition) {
    console.log("  ok : " + libelle);
  } else {
    echecs++;
    console.error("  ECHEC : " + libelle + (detail !== undefined ? " — " + detail : ""));
  }
}
function egal(actuel, attendu, libelle) {
  verifie(actuel === attendu, libelle, "attendu " + JSON.stringify(attendu) + ", obtenu " + JSON.stringify(actuel));
}
function proche(actuel, attendu, libelle, tolerance = 0.01) {
  verifie(typeof actuel === "number" && Math.abs(actuel - attendu) <= tolerance,
    libelle, "attendu " + attendu + ", obtenu " + actuel);
}
function contient(chaine, fragment, libelle) {
  verifie(String(chaine ?? "").includes(fragment), libelle,
    "attendu un texte contenant « " + fragment + " », obtenu " + JSON.stringify(chaine));
}

// Relecture d'un Blob produit par les générateurs : mêmes contraintes que dans
// les générateurs (chaîne binaire latin1 pour JSZip à l'intérieur de la vm).
const ExcelJS = chargerUMD(fileURLToPath(new URL("../vendor/exceljs.min.js", import.meta.url)), "ExcelJS");
const JSZip = chargerUMD(fileURLToPath(new URL("../vendor/jszip.min.js", import.meta.url)), "JSZip");

// Preuve BRUTE : lecture directe du XML à l'intérieur du zip produit — c'est
// ce qu'Excel affichera réellement, sans normalisation possible par ExcelJS
// (mesure sur gabarits/os-gabarit.xlsx : date1904="1" dans
// xl/workbook.xml et <v>44313</v> dans la feuille pour le 28/04/2025).
async function xmlBrut(blob, membre) {
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const fichier = zip.file(membre);
  return fichier ? await fichier.async("string") : null;
}
async function relireClasseur(blob) {
  const octets = Buffer.from(await blob.arrayBuffer());
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(octets.toString("latin1"));
  return classeur;
}

async function lireFichierGabarit(chemin) {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(readFileSync(chemin).toString("latin1"));
  return classeur;
}

// Le contrat §8 ne fige pas la forme des valeurs renvoyées par js/calculs.js
// (nombre simple ou objet {ht, tva, ttc}) — même normalisation que gen-avenant.js.
function valeurNombre(valeur) {
  if (typeof valeur === "number") return valeur;
  if (valeur && typeof valeur === "object") {
    if (typeof valeur.ht === "number") return valeur.ht;
    if (typeof valeur.ttc === "number") return valeur.ttc / 1.2;
  }
  return 0;
}

// Inventaire des cellules à formule d'une feuille (adresses triées).
function inventaireFormules(feuille) {
  const adresses = [];
  feuille.eachRow({ includeEmpty: true }, (ligne) => {
    ligne.eachCell({ includeEmpty: true }, (cellule) => {
      const v = cellule.value;
      if (v && typeof v === "object" && v.formula) adresses.push(cellule.address);
    });
  });
  return adresses.sort().join(",");
}

// Cellules VISÉES par les formules d'une feuille (le gabarit nettoyé ne doit
// référencer que des cellules d'injection ou des statiques conservées).
function ciblesFormules(feuille) {
  const cibles = new Set();
  feuille.eachRow({ includeEmpty: true }, (ligne) => {
    ligne.eachCell({ includeEmpty: true }, (cellule) => {
      const v = cellule.value;
      if (v && typeof v === "object" && v.formula) {
        for (const m of String(v.formula).matchAll(/([A-Z]{1,2}\d+)/g)) cibles.add(m[1]);
      }
    });
  });
  return [...cibles].sort().join(",");
}

// Recherche de résidus du taux de TVA 18,6 % (ancien taux) dans valeurs et formules.
function cherche186(feuille) {
  const trouvailles = [];
  feuille.eachRow({ includeEmpty: true }, (ligne) => {
    ligne.eachCell({ includeEmpty: true }, (cellule) => {
      const v = cellule.value;
      const texte = v && typeof v === "object" && v.formula ? v.formula : String(v ?? "");
      if (/18[.,]6/.test(texte)) trouvailles.push(cellule.address);
    });
  });
  return trouvailles;
}

/* ------------------------------------------------------------------ */
/* ÉTAPE 1 — Structure des gabarits (sans js/calculs.js)               */
/* ------------------------------------------------------------------ */

console.log("ÉTAPE 1 : structure des gabarits");
{
  const os = await lireFichierGabarit(new URL("gabarits/os-gabarit.xlsx", RACINE));
  const feuille = os.worksheets[0];
  egal(os.worksheets.length, 1, "os-gabarit : une seule feuille");
  egal(feuille.name, "OS", 'os-gabarit : feuille nommée « OS »');
  egal(os.properties.date1904, true, "os-gabarit : système de dates 1904 conservé");
  egal(feuille.pageSetup.paperSize, 9, "os-gabarit : papier A4 (code 9) conservé");
  egal(feuille.pageSetup.printArea, "A1:F66", "os-gabarit : zone d'impression conservée");
  egal((feuille.model.merges || []).length, 3, "os-gabarit : 3 fusions conservées");
  egal(feuille.getCell("A2").value, null, "os-gabarit : A2 (MO) vidé");
  egal(feuille.getCell("A12").value, null, "os-gabarit : A12 (entreprise) vidé");
  egal(feuille.getCell("F29").value, null, "os-gabarit : F29 (HT) vidé");
  egal(feuille.getCell("F33").value, null, "os-gabarit : F33 (A compter du) vidé");
  contient(feuille.getCell("A17").value, "ORDRE DE SERVICE", "os-gabarit : titre OS conservé");
  contient(feuille.getCell("A38").value + " " + feuille.getCell("A39").value, "QUINZE JOURS",
    "os-gabarit : avertissement de forclusion « QUINZE JOURS » conservé");
  contient(feuille.getCell("F44").value, "EXEMPLE ARCHITECTURE", "os-gabarit : bloc agence conservé");
  egal(feuille.getCell("C19").formula, "A12", "os-gabarit : formule de reprise C19=A12 conservée");
  egal(feuille.getCell("B34").value, null, "os-gabarit : B34 (ligne libre n° de lot) vide");
  egal(feuille.getCell("B35").value, null, "os-gabarit : B35 (ligne libre délais) vide");
  egal(feuille.getCell("F44").value, "S.A.R.L. EXEMPLE ARCHITECTURE", "os-gabarit : bloc agence d'origine conservé (valeurs par défaut)");

  const av = await lireFichierGabarit(new URL("gabarits/avenant-gabarit.xlsx", RACINE));
  const fa = av.worksheets[0];
  egal(av.worksheets.length, 1, "avenant-gabarit : une seule feuille");
  egal(fa.name, "AVENANT", 'avenant-gabarit : feuille nommée « AVENANT »');
  egal(av.properties.date1904, true, "avenant-gabarit : système de dates 1904 conservé");
  egal(fa.pageSetup.paperSize, 9, "avenant-gabarit : papier A4 (code 9) conservé");
  egal(fa.pageSetup.printArea, "A1:H141", "avenant-gabarit : zone d'impression conservée");
  egal(fa.getCell("D1").value, null, "avenant-gabarit : D1 (numéro) vidé");
  egal(feuille ? fa.getCell("F18").value : null, null, "avenant-gabarit : F18 (A) vidé");
  egal(fa.getCell("F50").value, null, "avenant-gabarit : F50 (cumulé) vidé");
  contient(fa.getCell("B28").value, "OBJET : PV", "avenant-gabarit : §1 OBJET : PV conservé");
  egal(fa.getCell("E24").value, "(B)", "avenant-gabarit : marqueur (B) conservé");
  egal(fa.getCell("D79").formula, "D3", "avenant-gabarit : formule de cascade D79=D3 conservée");
  egal(fa.getCell("D94").formula, "D87", "avenant-gabarit : formule de cascade D94=D87 conservée");
  // Revue : résidus du gabarit.
  egal(fa.getCell("G46").value, null, "avenant-gabarit : G46 (TVA 18,6 % ancien taux, section MV) vidé");
  egal(fa.getCell("H46").value, null, "avenant-gabarit : H46 (TTC 18,6 % ancien taux, section MV) vidé");
  egal(fa.getCell("G50").value, null, "avenant-gabarit : G50 (cumulé TVA) vidé");
  egal(fa.getCell("H50").value, null, "avenant-gabarit : H50 (cumulé TTC) vidé");
  egal(cherche186(feuille).join(","), "", "os-gabarit : aucun résidu de TVA à 18,6 %");
  egal(cherche186(fa).join(","), "", "avenant-gabarit : aucun résidu de TVA à 18,6 % (G37/H37 et G46/H46 vidés)");
  // La formule fautive du réel (F50 = B + C + F47) est absente : le MONTANT
  // CUMULÉ = (B) + (C) - (D) est écrit en numérique par les générateurs.
  egal(inventaireFormules(feuille), "A15,A44,A45,C19,C21,C55",
    "os-gabarit : inventaire exact des formules (cascade de reprise uniquement)");
  egal(ciblesFormules(feuille), "A12,A2,A5,C13,C21,C3",
    "os-gabarit : toute formule vise une cellule d'injection conservée");
  egal(inventaireFormules(fa), "D79,D80,D83,D84,D87,D88,D94,D95,E63,F105,F124,G105",
    "avenant-gabarit : inventaire exact des formules (cascade page 2 uniquement)");
  egal(ciblesFormules(fa), "D10,D3,D4,D6,D7,D87,D88,D9,E63,E64",
    "avenant-gabarit : toute formule vise une cellule d'injection conservée (E64 vide voulu, comme le réel)");
}

/* ------------------------------------------------------------------ */
/* ÉTAPE 2 — js/calculs.js : obligation contractuelle        */
/* ------------------------------------------------------------------ */

let calculs;
try {
  calculs = await import(new URL("../js/calculs.js", import.meta.url).href);
} catch (e) {
  console.error("ECHEC : en attente de js/calculs.js — contrat SPEC §8 (" +
    (e && e.message ? e.message : e) + ")");
  process.exit(2);
}
for (const symbole of ["montantAvecVariantes", "appliquerProrata", "chainageAvenant"]) {
  if (typeof calculs[symbole] !== "function") {
    console.error("ECHEC : en attente de js/calculs.js — symbole " + symbole + " absent du contrat SPEC §8.");
    process.exit(2);
  }
}
console.log("ÉTAPE 2 : js/calculs.js présent (montantAvecVariantes, appliquerProrata, chainageAvenant)");

/* ------------------------------------------------------------------ */
/* ÉTAPE 3 — Fixture et montants attendus (via le contrat, pas en dur) */
/* ------------------------------------------------------------------ */

const projet = JSON.parse(readFileSync(new URL("fixtures/projet-xlsx.json", import.meta.url), "utf8"));
const [colorama, desamia] = projet.entreprises;
const devisT = projet.devis.find((d) => d.entrepriseId === colorama.id);
const devisA = projet.devis.find((d) => d.entrepriseId === desamia.id);

// HT attendu d'un devis : même chaîne que les générateurs (variantes puis
// prorata « valeur » ; le mode « inclus » signifie HT affiché déjà porteur).
function htAttendu(devis) {
  let m = calculs.montantAvecVariantes(devis, { tvaTaux: 0.2 });
  if (devis.prorata && devis.prorata.mode === "valeur" && typeof calculs.appliquerProrata === "function") {
    m = calculs.appliquerProrata(valeurNombre(m.ht) || m, devis.prorata);
  }
  return valeurNombre(m);
}
const htColorama = htAttendu(devisT);
const htDesamia = htAttendu(devisA);

// Chaînage attendu des deux avenants de la fixture, calculé par le module
// contractuel lui-même (le générateur ne réécrit jamais la règle B + C - D).
const chain1 = calculs.chainageAvenant({
  montantInitial: htDesamia, avenantsPrecedents: [],
  plusValue: 38682.1, moinsValue: 0, tvaTaux: 0.2,
});
const chain2 = calculs.chainageAvenant({
  montantInitial: htDesamia, avenantsPrecedents: [38682.1],
  plusValue: 2000, moinsValue: 500, tvaTaux: 0.2,
});
// La RÈGLE elle-même, vérifiée par arithmétique indépendante du module
// (coordinator, point 2) : (B) = (A) + cumul de la liste ; cumule = B + C - D.
function verifieRegle(chain, cumulAttendu, libelle) {
  const A = valeurNombre(chain.A), B = valeurNombre(chain.B),
    C = valeurNombre(chain.C), D = valeurNombre(chain.D), cu = valeurNombre(chain.cumule);
  proche(B, A + cumulAttendu, libelle + " : (B) = (A) + cumul des avenants précédents");
  proche(cu, B + C - D, libelle + " : MONTANT CUMULÉ = (B) + (C) - (D)");
}
verifieRegle(chain1, 0, "avenant 1");
verifieRegle(chain2, 38682.1, "avenant 2");

/* ------------------------------------------------------------------ */
/* ÉTAPE 4 — Ordres de Service                                         */
/* ------------------------------------------------------------------ */

console.log("ÉTAPE 4 : genererOS (une feuille par entreprise)");
{
  const blob = await genererOS(projet, colorama.id);
  verifie(blob instanceof Blob, "genererOS renvoie un Blob", typeof blob);
  const wb = await relireClasseur(blob);
  egal(wb.worksheets.length, 1, "OS colorama : une seule feuille");
  egal(wb.properties.date1904, true, "OS colorama : dates 1904 conservées à l'export");
  const f = wb.worksheets[0];
  egal(f.name, colorama.raisonSociale, "OS colorama : feuille nommée d'après l'entreprise");
  egal(f.getCell("A2").value, projet.maitreOuvrage.raisonSociale, "OS colorama : A2 = raison sociale MO");
  egal(f.getCell("C4").value, 100000033, "OS colorama : C4 = SIREN MO en numérique");
  egal(f.getCell("C6").value, projet.operation.reference, "OS colorama : C6 = référence opération");
  contient(f.getCell("A7").value, "REFECTION DE LA COUVERTURE", "OS colorama : A7 = intitulé opération");
  egal(f.getCell("A12").value, colorama.raisonSociale, "OS colorama : A12 = raison sociale entreprise");
  contient(f.getCell("C13").value, "MODELE Morgan", "OS colorama : C13 = représentant entreprise");
  egal(f.getCell("C14").value, 100000082, "OS colorama : C14 = SIREN entreprise");
  contient(f.getCell("C27").value, "PEINTURE", "OS colorama : C27 = nom du lot");
  proche(f.getCell("F29").value, htColorama, "OS colorama : F29 = HT « PRO RATA INCLUS »");
  proche(f.getCell("F28").value, htColorama * (1 + TAUX_DEFAUT),
    "OS colorama : F28 = TTC = HT × (1 + tvaTaux, défaut 0,2)");
  proche(f.getCell("F29").value, 84378.08, "OS colorama : F29 = HT du corpus OP-2026-01 (COLORAMA : 84 378,08)");
  proche(f.getCell("F28").value, 101253.696, "OS colorama : F28 = TTC du corpus (101 253,696)");
  contient(f.getCell("F30").value, "devis numéro DEV00000693", "OS colorama : F30 = référence devis");
  contient(f.getCell("F30").value, "du 16/01/2025", "OS colorama : F30 = date devis en français");
  egal(serie1904VersDateISO(f.getCell("F33").value), "2025-04-28", "OS colorama : F33 relue = 28/04/2025 (série 44313, ExcelJS rend un Date)");
  egal(serie1904VersDateISO(44313), "2025-04-28", "OS colorama : contrôle pur de la série 44313 = 2025-04-28");
  egal(f.getCell("C41").value, "Villeclaire", "OS colorama : C41 = lieu FAIT À");
  egal(serie1904VersDateISO(f.getCell("C42").value), "2025-03-27", "OS colorama : C42 relue = 27/03/2025 (série 44281)");
  contient(f.getCell("A17").value, "N°1", "OS colorama : A17 = OS n°1");
  contient(f.getCell("A38").value + " " + f.getCell("A39").value, "QUINZE JOURS", "OS colorama : forclusion QUINZE JOURS conservée");
  egal(f.getCell("C19").formula, "A12", "OS colorama : formule de reprise C19=A12 conservée");
  contient(f.getCell("F44").value, "EXEMPLE ARCHITECTURE", "OS colorama : bloc agence conservé");
  egal(f.pageSetup.paperSize, 9, "OS colorama : pageSetup A4 conservé dans le clone");
  egal(f.pageSetup.printArea, "A1:F66", "OS colorama : zone d'impression conservée dans le clone");
  egal(f.getCell("F29").numFmt && f.getCell("F29").numFmt.includes("#,##0.00"), true,
    "OS colorama : format monétaire de F29 conservé");
  egal(f.getCell("F33").numFmt, "dd/mm/yyyy",
    "OS colorama : F33 au format français dd/mm/yyyy (OS signé, décision de conception)");
  egal(f.getCell("C42").numFmt, "dd/mm/yyyy", "OS colorama : C42 au format français dd/mm/yyyy");
  egal(f.getCell("C41").numFmt, "dd/mm/yyyy", "OS colorama : C41 au format dd/mm/yyyy (hérité, cellule texte)");
  egal(f.getCell("E29").value, "PRO RATA INCLUS",
    "OS colorama : E29 = mention conservée (prorata du devis en mode « inclus »)");
  // Preuve XML du format : xl/styles.xml porte le formatCode personnalisé —
  // une date juste avec un format faux resterait un document faux.
  const stylesXml = await xmlBrut(blob, "xl/styles.xml");
  verifie(/dd\/mm\/yyyy/.test(stylesXml), "OS colorama : XML brut xl/styles.xml porte formatCode dd/mm/yyyy");
  // Preuve BRUTE dans le XML du produit  : date1904="1"
  // dans xl/workbook.xml et les séries exactes dans la feuille.
  const classeurXml = await xmlBrut(blob, "xl/workbook.xml");
  const feuilleXml = await xmlBrut(blob, "xl/worksheets/sheet1.xml");
  verifie(/date1904="1"/.test(classeurXml), 'OS colorama : XML brut xl/workbook.xml porte date1904="1"');
  verifie(/<c r="F33"[^>]*><v>44313<\/v>/.test(feuilleXml), "OS colorama : XML brut F33 = <v>44313</v> (série 1904 du 28/04/2025)");
  verifie(/<c r="C42"[^>]*><v>44281<\/v>/.test(feuilleXml), "OS colorama : XML brut C42 = <v>44281</v> (série 1904 du 27/03/2025)");
  egal(f.getCell("B34").value, "LOTS 12", "OS colorama : B34 = numéro de lot « LOTS 12 » (complément OS signé)");
  egal(f.getCell("B35").value, "avril à juillet 2025", "OS colorama : B35 = délais de réalisation (Devis.delaisRealisation)");
  egal(f.getCell("F28").numFmt, '#,##0.00" €"', "OS colorama : F28 au format monétaire du signé « # ##0,00 € »");
  egal(f.getCell("F29").numFmt, '#,##0.00" €"', "OS colorama : F29 au format monétaire du signé « # ##0,00 € »");
  egal(f.getCell("F43").value, "L'agence d'architecture", "OS colorama : F43 = mention agence (défaut gabarit, paramétrable)");
  egal(f.getCell("F44").value, "S.A.R.L. EXEMPLE ARCHITECTURE", "OS colorama : F44 = raison sociale complète de l'agence");
  egal(f.getCell("F45").value, "Représentée par Camille Exemple", "OS colorama : F45 = signataire (Projet.equipe.architecteSignataire)");

  // Deuxième entreprise : l'injection ne fuit pas d'une feuille à l'autre.
  const blobDesamia = await genererOS(projet, desamia.id);
  const wbA = await relireClasseur(blobDesamia);
  const fa = wbA.worksheets[0];
  egal(fa.getCell("A12").value, desamia.raisonSociale, "OS desamia : A12 = raison sociale entreprise");
  egal(fa.getCell("C14").value, 100000074, "OS desamia : C14 = SIREN entreprise");
  proche(fa.getCell("F29").value, htDesamia, "OS desamia : F29 = HT du devis DESAMIA");
  proche(fa.getCell("F29").value, 97133.57, "OS desamia : F29 = HT du corpus (DESAMIA : 97 133,57)");
  proche(fa.getCell("F28").value, 116560.284, "OS desamia : F28 = TTC du corpus (116 560,284)");
  const feuilleXmlA = await xmlBrut(blobDesamia, "xl/worksheets/sheet1.xml");
  verifie(/<c r="F33"[^>]*><v>44259<\/v>/.test(feuilleXmlA), "OS desamia : XML brut F33 = <v>44259</v> (série 1904 du 05/03/2025)");
  egal(fa.getCell("F33").numFmt, "dd/mm/yyyy", "OS desamia : F33 au format français dd/mm/yyyy");
  egal(fa.getCell("E29").value, "PRO RATA INCLUS", "OS desamia : E29 = mention conservée (prorata « inclus »)");
  egal(serie1904VersDateISO(fa.getCell("F33").value), "2025-03-05", "OS desamia : F33 relue = 05/03/2025 (série 44259)");
  egal(fa.getCell("B34").value, "LOTS 02", "OS desamia : B34 = numéro de lot « LOTS 02 »");
  egal(fa.getCell("B35").value, "mars avril mai 2025", "OS desamia : B35 = délais de réalisation");


  // Champs absents : les lignes libres restent vides ; bloc agence paramétrable
  // (complément OS signé — chaque ligne est remplaçable depuis le projet).
  const projetSansChamps = JSON.parse(JSON.stringify(projet));
  delete projetSansChamps.devis[0].delaisRealisation;
  delete projetSansChamps.entreprises[0].lotNumero;
  projetSansChamps.agence.titreBloc = "Atelier d'architecture";
  projetSansChamps.agence.forme = "S.A.R.L.";
  projetSansChamps.agence.raisonSociale = "EXEMPLE ARCHITECTURE"; // sans la forme -> recomposée
  projetSansChamps.equipe.architecteSignataire = "Alex Modele";
  const wbV = await relireClasseur(await genererOS(projetSansChamps, colorama.id));
  const fv = wbV.worksheets[0];
  egal(fv.getCell("B34").value, null, "OS sans n° de lot : B34 laissée vide");
  egal(fv.getCell("B35").value, null, "OS sans délais : B35 laissée vide");
  egal(fv.getCell("F43").value, "Atelier d'architecture", "OS paramétré : F43 = mention agence remplaçable");
  egal(fv.getCell("F44").value, "S.A.R.L. EXEMPLE ARCHITECTURE", "OS paramétré : F44 = forme juridique recomposée devant la raison sociale");
  egal(fv.getCell("F45").value, "Représentée par Alex Modele", "OS paramétré : F45 = signataire remplaçable");
  egal(fv.getCell("F28").numFmt, '#,##0.00" €"', "OS paramétré : format monétaire du signé appliqué");

  // Entreprise inconnue : erreur explicite.
  let rejete = false;
  try { await genererOS(projet, "ent-inconnue"); } catch (e) {
    rejete = String(e.message).includes("Entreprise inconnue");
  }
  verifie(rejete, "genererOS : entreprise inconnue rejetée avec message explicite");

  // décision de conception — mention « PRO RATA INCLUS » (E29) : vidée quand le
  // prorata vaut « valeur » ou quand le devis n'en porte pas (l'OS signé réel
  // ne la porte pas ; l'afficher sans prorata réel serait une affirmation
  // fausse sur le contrat).
  const projetProrataValeur = JSON.parse(JSON.stringify(projet));
  projetProrataValeur.devis.find((d) => d.entrepriseId === colorama.id).prorata = { mode: "valeur", taux: 0.8 };
  const wbV2 = await relireClasseur(await genererOS(projetProrataValeur, colorama.id));
  egal(wbV2.worksheets[0].getCell("E29").value, null, "OS prorata « valeur » : E29 vidée (mention fausse sinon)");
  proche(wbV2.worksheets[0].getCell("F29").value, htColorama * 0.8,
    "OS prorata « valeur » : F29 = HT réduit par appliquerProrata (taux 0,8)");
  const projetSansProrata = JSON.parse(JSON.stringify(projet));
  delete projetSansProrata.devis.find((d) => d.entrepriseId === colorama.id).prorata;
  const wbV3 = await relireClasseur(await genererOS(projetSansProrata, colorama.id));
  egal(wbV3.worksheets[0].getCell("E29").value, null, "OS sans prorata : E29 vidée");

  // arbitrage de conception (SPEC §5, défaut trouvé par le test d'intégration
  // sur les données réelles) : C42 « LE: » = date de SIGNATURE de l'OS
  // (OS[].date), distincte du « A compter du » (F33) et de l'opération.
  // a) PRIORITÉ : OS[].date gagne même si operation.faitLe existe aussi.
  const projetOsDate = JSON.parse(JSON.stringify(projet));
  projetOsDate.operation.faitLe = "2025-01-15"; // date « leurre » : ne doit PAS sortir
  projetOsDate.OS.find((o) => o.entrepriseId === colorama.id).date = "2025-03-27";
  const wbS1 = await relireClasseur(await genererOS(projetOsDate, colorama.id));
  egal(serie1904VersDateISO(wbS1.worksheets[0].getCell("C42").value), "2025-03-27",
    "OS signature : C42 = OS[].date — la signature prime sur l'opération (arbitrage §5)");
  // b) Situation réelle (données op-2026-01) : opération SANS faitLe + OS AVEC date.
  const projetSansFaitLe = JSON.parse(JSON.stringify(projet));
  delete projetSansFaitLe.operation.faitLe;
  projetSansFaitLe.OS.find((o) => o.entrepriseId === colorama.id).date = "2025-03-27";
  const wbS2 = await relireClasseur(await genererOS(projetSansFaitLe, colorama.id));
  egal(serie1904VersDateISO(wbS2.worksheets[0].getCell("C42").value), "2025-03-27",
    "OS signature : C42 = OS[].date même sans operation.faitLe (cas des données réelles)");
  // c) Les deux manquent -> cellule VIDE, jamais une date inventée.
  const projetSansDates = JSON.parse(JSON.stringify(projet));
  delete projetSansDates.operation.faitLe;
  delete projetSansDates.OS.find((o) => o.entrepriseId === colorama.id).date;
  const wbS3 = await relireClasseur(await genererOS(projetSansDates, colorama.id));
  egal(wbS3.worksheets[0].getCell("C42").value, null,
    "OS signature : C42 VIDE quand ni OS[].date ni operation.faitLe (pas de date inventée)");
  // d) SPEC § 6 ter : un OS sans date de démarrage n'est PAS émis — refus explicite.
  //    L'assertion précédente datait d'avant la § 6 ter et attendait un document troué :
  //    « A compter du » est la raison d'être d'un ordre de service, son absence doit se
  //    dire, pas se combler par du vide.
  const projetSansOS = JSON.parse(JSON.stringify(projet));
  delete projetSansOS.OS;
  let refusSansOS = null;
  try { await genererOS(projetSansOS, colorama.id); } catch (e) { refusSansOS = e.message; }
  egal(typeof refusSansOS === "string" && /date de l'ordre de service/.test(refusSansOS), true,
    "OS sans date de démarrage : refus explicite nommant le manque (SPEC § 6 ter)");

  // e) Repli de la DATE DE SIGNATURE conservé quand l'OS existe et porte une date de
  //    démarrage, mais aucune date de signature (arbitrage §5 : OS[].date > faitLe > vide).
  const projetFaitLeSeul = JSON.parse(JSON.stringify(projet));
  const osColorama = projetFaitLeSeul.OS.find((o) => o.entrepriseId === colorama.id);
  delete osColorama.date;
  osColorama.dateDebut = osColorama.dateDebut || "2025-04-28";
  const wbS4 = await relireClasseur(await genererOS(projetFaitLeSeul, colorama.id));
  egal(serie1904VersDateISO(wbS4.worksheets[0].getCell("C42").value), "2025-03-27",
    "OS signature : repli sur operation.faitLe quand l'OS ne porte pas de date de signature");
}

console.log("ÉTAPE 5 : genererClasseurOS (classeur multi-feuilles 02_OS/)");
{
  const blob = await genererClasseurOS(projet);
  const wb = await relireClasseur(blob);
  egal(wb.worksheets.length, 2, "classeur OS : deux feuilles (deux entreprises retenues)");
  egal(wb.worksheets[0].name, colorama.raisonSociale, "classeur OS : feuille 1 = entreprise 1");
  egal(wb.worksheets[1].name, desamia.raisonSociale, "classeur OS : feuille 2 = entreprise 2");
  egal(wb.worksheets[0].getCell("A12").value, colorama.raisonSociale, "classeur OS : feuille 1 injectée");
  egal(wb.worksheets[1].getCell("A12").value, desamia.raisonSociale, "classeur OS : feuille 2 injectée");
  egal(wb.worksheets[0].pageSetup.paperSize, 9, "classeur OS : pageSetup conservé feuille 1");
  egal(wb.worksheets[1].pageSetup.paperSize, 9, "classeur OS : pageSetup conservé feuille 2");
  egal(wb.properties.date1904, true, "classeur OS : dates 1904 conservées");
}

/* ------------------------------------------------------------------ */
/* ÉTAPE 6 — Fiches d'avenant                                          */
/* ------------------------------------------------------------------ */

console.log("ÉTAPE 6 : genererAvenant (chaînage (A)(B)(C)(D))");
const av1 = projet.avenants[0];
const av2 = projet.avenants[1];
{
  const wb1 = await relireClasseur(await genererAvenant(projet, desamia.id, av1));
  egal(wb1.worksheets.length, 1, "avenant 1 : une seule feuille");
  egal(wb1.properties.date1904, true, "avenant 1 : dates 1904 conservées");
  const f1 = wb1.worksheets[0];
  egal(f1.name, "AVENANT 1", "avenant 1 : feuille nommée « AVENANT 1 »");
  egal(f1.getCell("D1").value, "A V E N A N T   N °  1", "avenant 1 : D1 = titre exact du gabarit");
  contient(f1.getCell("D3").value, "OP-2026-01", "avenant 1 : D3 = objet du marché");
  contient(f1.getCell("D6").value, projet.maitreOuvrage.raisonSociale, "avenant 1 : D6 = maître d'ouvrage");
  egal(f1.getCell("D9").value, desamia.raisonSociale, "avenant 1 : D9 = titulaire du marché");
  contient(f1.getCell("D13").value, "COUVERTURE", "avenant 1 : D13 = numéro de lot");
  proche(f1.getCell("F18").value, valeurNombre(chain1.A), "avenant 1 : F18 = (A) montant initial HT");
  proche(f1.getCell("G18").value, valeurNombre(chain1.A) * TAUX_DEFAUT,
    "avenant 1 : G18 = TVA de (A) = (A) × tvaTaux");
  proche(f1.getCell("H18").value, valeurNombre(chain1.A) * (1 + TAUX_DEFAUT),
    "avenant 1 : H18 = TTC de (A) = (A) × (1 + tvaTaux)");
  proche(f1.getCell("F24").value, valeurNombre(chain1.B), "avenant 1 : F24 = (B) total rectifié");
  proche(f1.getCell("F31").value, 38682.1, "avenant 1 : F31 = ligne PV HT");
  contient(f1.getCell("B31").value, "arêtiers", "avenant 1 : B31 = libellé PV");
  proche(f1.getCell("G31").value, 7736.42, "avenant 1 : G31 = TVA 20 % de la ligne PV du corpus AV1 (7 736,42)");
  proche(f1.getCell("H31").value, 46418.52, "avenant 1 : H31 = TTC du corpus (46 418,52)");
  proche(f1.getCell("F38").value, valeurNombre(chain1.C), "avenant 1 : F38 = (C) montant en plus");
  proche(f1.getCell("F47").value, valeurNombre(chain1.D), "avenant 1 : F47 = (D) montant en moins");
  proche(f1.getCell("F50").value, valeurNombre(chain1.cumule), "avenant 1 : F50 = MONTANT CUMULÉ (B)+(C)-(D)");
  proche(f1.getCell("H50").value, valeurNombre(chain1.cumule) * (1 + TAUX_DEFAUT),
    "avenant 1 : H50 = TTC du montant cumulé = cumulé × (1 + tvaTaux)");
  egal(f1.getCell("F53").value, "Néant", "avenant 1 : F53 = délais « Néant » (modificationDelais null)");
  contient(f1.getCell("C91").value, "N° 1", "avenant 1 : page 2 = OS AVENANT n°1");
  egal(f1.getCell("D79").formula, "D3", "avenant 1 : cascade page 2 D79=D3 conservée");
  egal(f1.getCell("D87").formula, "D9", "avenant 1 : cascade page 2 D87=D9 conservée");
  egal(f1.pageSetup.paperSize, 9, "avenant 1 : pageSetup A4 conservé");
  egal(f1.pageSetup.printArea, "A1:H141", "avenant 1 : zone d'impression conservée");
  egal(f1.getCell("F18").numFmt && f1.getCell("F18").numFmt.includes("#,##0.00"), true,
    "avenant 1 : format monétaire de F18 conservé");

  const wb2 = await relireClasseur(await genererAvenant(projet, desamia.id, av2));
  const f2 = wb2.worksheets[0];
  egal(f2.name, "AVENANT 2", "avenant 2 : feuille nommée « AVENANT 2 »");
  egal(f2.getCell("D1").value, "A V E N A N T   N °  2", "avenant 2 : D1 = titre exact du gabarit");
  egal(f2.getCell("E21").value, 1, "avenant 2 : E21 = numéro de l'avenant précédent");
  proche(f2.getCell("F21").value, 38682.1, "avenant 2 : F21 = effet net HT de l'avenant précédent");
  proche(f2.getCell("F18").value, htDesamia, "avenant 2 : F18 = (A) inchangé (montant initial)");
  proche(f2.getCell("F24").value, valeurNombre(chain2.B), "avenant 2 : F24 = (B) = (A) + avenants précédents");
  proche(f2.getCell("F38").value, valeurNombre(chain2.C), "avenant 2 : F38 = (C) = plus-values");
  proche(f2.getCell("F47").value, valeurNombre(chain2.D), "avenant 2 : F47 = (D) = moins-values");
  proche(f2.getCell("F50").value, valeurNombre(chain2.cumule), "avenant 2 : F50 = MONTANT CUMULÉ");
  egal(f2.getCell("B45").value, "Déduit dressage acrotère nord", "avenant 2 : B45 = libellé MV");
  egal(f2.getCell("F53").value, "Report de la date d'achèvement des travaux au 30/09/2025",
    "avenant 2 : F53 = modification des délais");
  contient(f2.getCell("C93").value, "TEST", "avenant 2 : C93 = représentant de l'entreprise");

  // Avenant n°3 : DEUX avenants antérieurs dans la fixture -> le générateur
  // passe la LISTE des effets nets triée par numéro (pas un total) et les deux
  // emplacements r21/r22 du gabarit sont remplis .
  const chain3 = calculs.chainageAvenant({
    montantInitial: htDesamia, avenantsPrecedents: [38682.1, 1500],
    plusValue: 1000, moinsValue: 250, tvaTaux: 0.2,
  });
  verifieRegle(chain3, 38682.1 + 1500, "avenant 3");
  const wb3 = await relireClasseur(await genererAvenant(projet, desamia.id, projet.avenants[2]));
  const f3 = wb3.worksheets[0];
  egal(f3.name, "AVENANT 3", "avenant 3 : feuille nommée « AVENANT 3 »");
  egal(f3.getCell("D1").value, "A V E N A N T   N °  3", "avenant 3 : D1 = titre exact du gabarit");
  egal(f3.getCell("E21").value, 1, "avenant 3 : E21 = n° du 1er avenant antérieur");
  egal(f3.getCell("E22").value, 2, "avenant 3 : E22 = n° du 2e avenant antérieur");
  proche(f3.getCell("F21").value, 38682.1, "avenant 3 : F21 = effet net HT de l'avenant n°1");
  proche(f3.getCell("F22").value, 1500, "avenant 3 : F22 = effet net HT de l'avenant n°2 (2000 - 500)");
  proche(f3.getCell("F24").value, valeurNombre(chain3.B), "avenant 3 : F24 = (B) = (A) + cumul de la LISTE");
  proche(f3.getCell("F38").value, valeurNombre(chain3.C), "avenant 3 : F38 = (C) = plus-values");
  proche(f3.getCell("F47").value, valeurNombre(chain3.D), "avenant 3 : F47 = (D) = moins-values");
  proche(f3.getCell("F50").value, valeurNombre(chain3.cumule), "avenant 3 : F50 = MONTANT CUMULÉ (B)+(C)-(D)");
  contient(f2.getCell("C91").value, "N° 2", "avenant 2 : page 2 = OS AVENANT n°2");
}

console.log("ÉTAPE 6 bis : taux de TVA paramétrable (SPEC §2, surchargeable)");
{
  // a) Le taux du DEVIS prime sur celui du projet (devis 0,1 + projet 0,05).
  const projetDevisTaux = JSON.parse(JSON.stringify(projet));
  projetDevisTaux.tvaTaux = 0.05;
  projetDevisTaux.devis.find((d) => d.entrepriseId === colorama.id).tvaTaux = 0.1;
  const wbT1 = await relireClasseur(await genererOS(projetDevisTaux, colorama.id));
  proche(wbT1.worksheets[0].getCell("F28").value, htColorama * 1.1,
    "OS taux devis : F28 = HT × (1 + 0,1) — le taux du DEVIS prime sur celui du projet");

  // b) Sans tvaTaux sur le devis, repli sur le taux du PROJET (0,05).
  const projetTauxProjet = JSON.parse(JSON.stringify(projet));
  projetTauxProjet.tvaTaux = 0.05;
  const wbT2 = await relireClasseur(await genererOS(projetTauxProjet, colorama.id));
  proche(wbT2.worksheets[0].getCell("F28").value, htColorama * 1.05,
    "OS taux projet : F28 = HT × (1 + 0,05) — repli sur le taux du projet");

  // c) L'AVENANT suit le même taux : colonnes TVA et TTC de (A), de la ligne
  //    PV et du montant cumulé (taux projet 0,05, aucun taux sur le devis).
  const wbT3 = await relireClasseur(await genererAvenant(projetTauxProjet, desamia.id, av1));
  const fT3 = wbT3.worksheets[0];
  proche(fT3.getCell("G18").value, htDesamia * 0.05, "avenant taux projet : G18 = (A) × 0,05");
  proche(fT3.getCell("H18").value, htDesamia * 1.05, "avenant taux projet : H18 = (A) × 1,05");
  proche(fT3.getCell("G31").value, 38682.1 * 0.05, "avenant taux projet : G31 = PV × 0,05");
  proche(fT3.getCell("H31").value, 38682.1 * 1.05, "avenant taux projet : H31 = PV × 1,05");
  proche(fT3.getCell("G50").value, 135815.67 * 0.05, "avenant taux projet : G50 = cumulé × 0,05");
  proche(fT3.getCell("H50").value, 135815.67 * 1.05, "avenant taux projet : H50 = cumulé × 1,05");

  // d) Le chemin PAR DÉFAUT (0,2) est déjà couvert par toutes les assertions du
  //    corpus ci-dessus (F28 = 101 253,696 etc.), calculées avec TAUX_DEFAUT.
}

/* ------------------------------------------------------------------ */
/* ÉTAPE 7 — Écriture des produits pour inspection humaine             */