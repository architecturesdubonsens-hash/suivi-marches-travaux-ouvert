// tests/gen-docx.mjs — tests des générateurs DOCX (Marché de Travaux + CRC n°01)
//
//
// Ce test tourne sans npm ni navigateur : Node 24 seul.
//   node tests/gen-docx.mjs
//
// Principe :
//   1. Vérifier les prérequis — en particulier le module contractuel
//      js/calculs.js. S'il manque, le test échoue AVEC LE
//      MESSAGE EXPLICITE prévu (« en attente de js/calculs.js ») :
//      il ne faut JAMAIS écrire ce fichier à sa place.
//   2. Charger la fixture hermétique tests/fixtures/projet-docx.json (données
//      inspirées du dossier réel OP-2026-01, entièrement autonomes).
//   3. Générer marché + CRC n°01 via les exports contractuels de js/gen-marche.js
//      et js/gen-crc.js (Promise<Blob>), écrire le résultat dans tests-output/.
//   4. Dézipper les .docx avec JSZip vendored (vendor/jszip.min.js, chargé par le
//      chargeur UMD tests/lib/chargeur-umd.mjs) et lire
//      word/document.xml.
//   5. Assertionner le texte aplati : titres clés du CCAP, les 13 pièces
//      contractuelles, le montant en chiffres ET en toutes lettres, le tableau
//      consolidé des intervenants du CRC.
// Sortie attendue en fin d'exécution : « TESTS DOCX OK ».

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── 1. Prérequis — échecs explicites si un partenaire n'a pas encore livré ──
if (!existsSync(path.join(racine, "js", "calculs.js"))) {
  console.error("ECHEC : en attente de js/calculs.js");
  process.exit(1);
}
if (!existsSync(path.join(racine, "vendor", "docx.umd.js"))) {
  console.error("ECHEC : vendor/docx.umd.js absent — la génération DOCX est impossible hors ligne");
  process.exit(1);
}
if (!existsSync(path.join(racine, "vendor", "jszip.min.js"))) {
  console.error("ECHEC : vendor/jszip.min.js absent — le dézippage de contrôle est impossible");
  process.exit(1);
}
if (!existsSync(path.join(racine, "tests", "lib", "chargeur-umd.mjs"))) {
  console.error("ECHEC : tests/lib/chargeur-umd.mjs absent ()");
  process.exit(1);
}

// ── 2. Modules ──────────────────────────────────────────────────────────────
const { chargerUMD } = await import("./lib/chargeur-umd.mjs");
const { genererMarche } = await import("../js/gen-marche.js");
const { genererCRC01 } = await import("../js/gen-crc.js");
const calculs = await import("../js/calculs.js");

const projet = JSON.parse(readFileSync(path.join(racine, "tests", "fixtures", "projet-docx.json"), "utf8"));
const sortie = path.join(racine, "tests-output");
mkdirSync(sortie, { recursive: true });

// ── 3. Génération réelle des deux livrables ────────────────────────────────
async function blobVersFichier(blob, chemin) {
  const tampon = Buffer.from(await blob.arrayBuffer());
  writeFileSync(chemin, tampon);
  return tampon;
}

let tamponMarche, tamponCRC, tamponCRC02, tamponCrcCanevas;
try {
  tamponMarche = await blobVersFichier(
    await genererMarche(projet, "voltalis"),
    path.join(sortie, "marche-voltalis.docx")
  );
  console.log("généré : tests-output/marche-voltalis.docx (" + tamponMarche.length + " octets)");
  tamponCRC = await blobVersFichier(
    await genererCRC01(projet),
    path.join(sortie, "crc-01.docx")
  );
  console.log("généré : tests-output/crc-01.docx (" + tamponCRC.length + " octets)");
  // SPEC § 6 ter : le CRC se régénère à chaque réunion — n°02 via l'option numero.
  tamponCRC02 = await blobVersFichier(
    await genererCRC01(projet, { numero: 2 }),
    path.join(sortie, "crc-02.docx")
  );
  console.log("généré : tests-output/crc-02.docx (" + tamponCRC02.length + " octets)");
  // Canevas sans projet.crc.lotsNonAttribues : la section des lots restera VIDE.
  const projetSansLots = JSON.parse(JSON.stringify(projet));
  delete projetSansLots.crc.lotsNonAttribues;
  tamponCrcCanevas = await blobVersFichier(
    await genererCRC01(projetSansLots),
    path.join(sortie, "crc-canevas-lots.docx")
  );
  console.log("généré : tests-output/crc-canevas-lots.docx (" + tamponCrcCanevas.length + " octets)");
} catch (err) {
  console.error("ECHEC de génération : " + (err && err.message ? err.message : err));
  process.exit(1);
}

// ── 4. Dézippage et lecture de word/document.xml ────────────────────────────
const JSZip = chargerUMD(path.join(racine, "vendor", "jszip.min.js"), "JSZip");

async function xmlDocument(tampon) {
  const zip = await JSZip.loadAsync(tampon);
  const entree = zip.file("word/document.xml");
  if (!entree) throw new Error("word/document.xml absent de l'archive .docx");
  return entree.async("string");
}

const xmlMarche = await xmlDocument(tamponMarche);
const xmlCRC = await xmlDocument(tamponCRC);
const xmlCRC02 = await xmlDocument(tamponCRC02);
const xmlCrcCanevas = await xmlDocument(tamponCrcCanevas);

// Aplatissement du XML : on retire les balises, on dé-échappe les entités et on
// normalise espaces/apostrophes — ainsi une phrase reste cherchable même si
// Word/docx l'a découpée en plusieurs runs.
function aplatir(xml) {
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/[\u00a0\u202f\u2009\u2007]/g, " ")
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/\s+/g, " ");
}
const texteMarche = aplatir(xmlMarche);
const texteCRC = aplatir(xmlCRC);
const texteCRC02 = aplatir(xmlCRC02);
const texteCrcCanevas = aplatir(xmlCrcCanevas);

// ── 5. Assertions ───────────────────────────────────────────────────────────
let echecs = 0;
function verifier(nom, texteAplati, attendu) {
  if (texteAplati.indexOf(attendu) >= 0) {
    console.log("  OK   " + nom);
  } else {
    echecs += 1;
    console.error("  ECHEC " + nom + " — « " + attendu + " » introuvable dans word/document.xml");
  }
}

console.log("Marché de Travaux (CCAP NF P 03-001) :");
verifier("titre MARCHE TRAVAUX PRIVÉS", texteMarche, "MARCHE TRAVAUX PRIVÉS");
verifier("sous-titre CCAP", texteMarche, "Modèle de Cahier des clauses administratives particulières (CCAP)");
verifier("identification opération OP-2026-01", texteMarche, "Opération : OP-2026-01");
verifier("rubrique 1.1 OBJET", texteMarche, "1.1 OBJET");
verifier("nature des travaux (intitulé opération)", texteMarche, "AMENAGEMENT D'UN BATIMENT COMMERCIAL - SUPERMARCHE");
verifier("lieu de construction", texteMarche, "12350 VILLENEUVE-EXEMPLE");
verifier("lot de l'entreprise", texteMarche, "ELECTRICITE");
verifier("N.B. rétractation (L. 231-4 CCH)", texteMarche, "L 231-4");
verifier("N.B. rétractation (L. 271-1 CCH)", texteMarche, "L 271-1");
verifier("désignation des parties", texteMarche, "Désignation des parties");
verifier("maître d'ouvrage DISTRIBEX", texteMarche, "SAS DISTRIBEX");
verifier("représentant MO", texteMarche, "M. Lou EXEMPLE");
verifier("agence", texteMarche, "EXEMPLE ARCHITECTURE");
verifier("entrepreneur VOLTALIS", texteMarche, "VOLTALIS");
verifier("SIRET entrepreneur", texteMarche, "10000004100024");
verifier("contrôle technique", texteMarche, "La mission de contrôle technique est assurée par");
verifier("coordination SPS", texteMarche, "La coordination en matière de sécurité et de protection de la santé est assurée par");
verifier("géotechnicien du gabarit", texteMarche, "Pas d'étude géotechnique sur ce projet.");
verifier("OPC du gabarit", texteMarche, "Pas de mission O.P.C. sur ce projet.");
verifier("documents constituant le marché", texteMarche, "Documents constituant le marché");
verifier("ordre de prévalence énoncé", texteMarche, "la pièce portant le numéro le plus faible prévaut sur les autres");
verifier("pièce n°1 (Le Marché signé)", texteMarche, "1 Le Marché signé par le Maître d'Ouvrage et l'entreprise retenue");
verifier("pièce n°8 (CCAG NF P 03-001)", texteMarche, "8 Le Cahier des Clauses Administratives Générales");
verifier("pièce n°9 (Détail Estimatif)", texteMarche, "9 Le Détail Estimatif des travaux");
verifier("pièce n°12 (plan général de coordination)", texteMarche, "12 Le plan général de coordination");
verifier("pièce n°13 (documents en vigueur)", texteMarche, "13 Documents techniques, textes législatifs et administratifs en vigueur");
verifier("sous-traitance art. 4.4 CCAG", texteMarche, "4.4 du CCAG");
verifier("représentation des parties", texteMarche, "REPRESENTATION DES PARTIES");
verifier("rendez-vous de chantier", texteMarche, "Présence aux rendez-vous de chantier");
verifier("comptes-rendus (dérogation 15-2-1)", texteMarche, "article 15-2-1 du CCAG");
verifier("rubrique prix du marché", texteMarche, "Prix du marché");
verifier("montant HT en chiffres", texteMarche, "560 000,00 €");
verifier("montant TVA en chiffres", texteMarche, "112 000,00 €");
verifier("montant TTC en chiffres", texteMarche, "672 000,00 €");
verifier("marque anti-falsification du gabarit", texteMarche, "****");
verifier("pénalités", texteMarche, "PENALITES");
verifier("retenue de garantie 5 %", texteMarche, "5 % du montant HT des travaux");
verifier("situations au 25", texteMarche, "sera établie le 25");
verifier("trois originaux", texteMarche, "en 3 originaux");
verifier("assurances", texteMarche, "ASSURANCES");
verifier("résiliation (art. 22 CCAG)", texteMarche, "RESILIATION");
verifier("tribunal compétent", texteMarche, "TRIBUNAL COMPETENT");
{
  // Montant en lettres : forme exigée par le gabarit réel (SPEC §3, mise à jour) —
  // majuscules, « ET nn CTS » sur DEUX chiffres (00 si nul), astérisques.
  // montantEnLettresMajuscules est la source unique dès qu'elle est exposée par
  // js/calculs.js ; tant qu'elle manque, le test vérifie le filet rendu
  // par js/gen-marche.js. Dans les deux cas la FORME EXACTE est assertionnée.
  const aSourceUnique = typeof calculs.montantEnLettresMajuscules === "function";
  const attenduLettres = aSourceUnique
    ? String(calculs.montantEnLettresMajuscules(672000))
    : String(calculs.montantEnLettres(672000)).toUpperCase();
  verifier(
    (aSourceUnique ? "montant en lettres (source unique) : " : "montant en lettres (filet, source unique non encore exposée) : ") + attenduLettres,
    texteMarche, attenduLettres
  );
  // Forme exacte du gabarit : centimes de 672 000,00 € -> « ET 00 CTS**** ».
  verifier("forme gabarit « ET 00 CTS**** » (centimes sur 2 chiffres)", texteMarche, " ET 00 CTS****");
  // Aucune minuscule autorisée entre l'étiquette et le suffixe CTS : la phrase
  // entière doit être en capitales, comme dans le .doc réel.
  const formeOk = /Soit en lettres TTC : [^a-z]+ ET \d{2} CTS\*\*\*\*/.test(texteMarche);
  if (formeOk) {
    console.log("  OK   forme exacte du gabarit : majuscules + « ET nn CTS**** » sur 2 chiffres");
  } else {
    echecs += 1;
    console.error("  ECHEC forme exacte du gabarit : segment après « Soit en lettres TTC : » non conforme (majuscules + ET nn CTS**** attendus)");
  }
  // Filet de cohérence : la retranscription doit bien dire « six cent soixante-
  // douze mille euros ». Les segments sont comparés sans les tirets pour ne pas
  // dépendre de la convention d'écriture choisie dans js/calculs.js
  // (orthographe traditionnelle ou rectifiée : « soixante-douze » ou « douze »).
  const lettresSansTirets = attenduLettres.replace(/-/g, " ").replace(/\s+/g, " ");
  const grosMots = ["SIX CENT", "SOIXANTE", "DOUZE MILLE", "EUROS"];
  const manquants = grosMots.filter(function (m) { return lettresSansTirets.indexOf(m) < 0; });
  if (manquants.length === 0) {
    console.log("  OK   cohérence de la retranscription littérale (672 000 → six cent soixante-douze mille euros)");
  } else {
    echecs += 1;
    console.error("  ECHEC cohérence lettres : segments absents du montant en lettres (672000) : " + manquants.join(", ") + " (obtenu : " + attenduLettres + ")");
  }
}

// — Analyse cellule par cellule du tableau des intervenants (SPEC § 6 ter) :
// pour prouver qu'une ligne incomplète reste EN BLANC, on relit les <w:tc> du
// <w:tr> qui porte l'entreprise et on compare le texte de chaque cellule.
function extraireLigneTable(xml, texteCherche) {
  let idx = xml.indexOf(texteCherche);
  while (idx >= 0) {
    const debutCellule = xml.lastIndexOf("<w:tc>", idx);
    const finLignePrecedente = xml.lastIndexOf("</w:tr>", idx);
    if (debutCellule > finLignePrecedente) {
      const debut = xml.lastIndexOf("<w:tr>", debutCellule);
      const fin = xml.indexOf("</w:tr>", idx);
      if (debut >= 0 && fin > debut) return xml.slice(debut, fin + 7);
    }
    idx = xml.indexOf(texteCherche, idx + 1);
  }
  return null;
}
function cellulesDeLigne(ligneXml) {
  const sortie = [];
  const re = /<w:tc>([\s\S]*?)<\/w:tc>/g;
  let m;
  while ((m = re.exec(ligneXml)) !== null) {
    const morceaux = [];
    const rt = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let mt;
    while ((mt = rt.exec(m[1])) !== null) morceaux.push(mt[1]);
    sortie.push(aplatir(morceaux.join("")));
  }
  return sortie;
}

console.log("Compte Rendu de Chantier n°01 :");
verifier("titre CRC n° 01", texteCRC, "COMPTE RENDU DE CHANTIER N° 01");
verifier("réunion d'ouverture de chantier", texteCRC, "Réunion d'ouverture de chantier");
verifier("référence opération", texteCRC, "OP-2026-01");
verifier("tableau des intervenants", texteCRC, "TABLEAU DES INTERVENANTS");
verifier("colonne présence", texteCRC, "Présence");
verifier("ligne maître d'ouvrage", texteCRC, "MAÎTRE D'OUVRAGE");
verifier("MO DISTRIBEX", texteCRC, "SAS DISTRIBEX");
verifier("ligne architecte signataire", texteCRC, "ARCHITECTE SIGNATAIRE");
verifier("agence dans le tableau", texteCRC, "EXEMPLE ARCHITECTURE");
verifier("architecte signataire nommé", texteCRC, "Camille Exemple");
verifier("conducteur de travaux", texteCRC, "CONDUCTEUR DE TRAVAUX");
verifier("conducteur de travaux nommé", texteCRC, "Sacha Modele");
verifier("ligne BET", texteCRC, "BET (BUREAU D'ETUDES TECHNIQUES)");
verifier("BET CONTROLTECH / TEST", texteCRC, "M. TEST");
verifier("courriel du BET", texteCRC, "controle@controltech.example");
verifier("ligne SPS", texteCRC, "COORDINATION SPS");
verifier("SPS MODELE", texteCRC, "Mme MODELE");
verifier("ligne géotechnicien (canevas)", texteCRC, "GEOTECHNICIEN");
verifier("ligne OPC (canevas)", texteCRC, "OPC (ORDONNANCEMENT PILOTAGE COORDINATION)");
verifier("entreprise lot électricité", texteCRC, "VOLTALIS");
verifier("entreprise lot peinture", texteCRC, "COLORAMA");
verifier("téléphone du lot (contacts CRC)", texteCRC, "01 00 00 00 02");
verifier("généralités administratives", texteCRC, "GENERALITES ADMINISTRATIVES");
verifier("fondement assurance L. 241-1", texteCRC, "L. 241-1");
verifier("sous-section par lot (calque CRC réel)", texteCRC, "BATIMENT SUPERMARCHE");
verifier("point attribué -> destinataire", texteCRC, "-> groupe Exemple");
verifier("clôture prochaine réunion", texteCRC, "Prochaine réunion");
{
  // Le tableau consolidé doit être un vrai tableau Word (structure <w:tbl>).
  const nbTables = (xmlCRC.match(/<w:tbl>/g) || []).length;
  if (nbTables >= 1) {
    console.log("  OK   tableau Word présent dans le CRC (" + nbTables + " table(s))");
  } else {
    echecs += 1;
    console.error("  ECHEC : aucun tableau Word (<w:tbl>) dans le CRC");
  }
}

console.log("Saisie progressive (SPEC § 6 ter) — document vivant :");
{
  // (a) Une entreprise complète ET une entreprise réduite au nom + lot
  //     coexistent dans le tableau ; la réduite garde ses cellules VIDES.
  verifier("entreprise réduite listée (rôle + lot)", texteCRC, "ENTREPRISE — CARRELAGE");
  verifier("entreprise réduite listée (raison sociale)", texteCRC, "S.A.R.L. CARRELAGE MODELE");
  const ligneReduite = extraireLigneTable(xmlCRC, "S.A.R.L. CARRELAGE MODELE");
  if (!ligneReduite) {
    echecs += 1;
    console.error("  ECHEC : ligne de l'entreprise réduite introuvable dans le tableau des intervenants");
  } else {
    const cellules = cellulesDeLigne(ligneReduite);
    if (cellules.length !== 6) {
      echecs += 1;
      console.error("  ECHEC : la ligne réduite compte " + cellules.length + " cellules (6 attendues)");
    } else {
      const vides = cellules.slice(2).every(function (c) { return c === ""; });
      const pleines = cellules[0] === "ENTREPRISE — CARRELAGE" && cellules[1] === "S.A.R.L. CARRELAGE MODELE";
      if (vides && pleines) {
        console.log("  OK   ligne réduite : rôle et société renseignés, représentant/téléphone/courriel/présence VIDES (à remplir à la main)");
      } else {
        echecs += 1;
        console.error("  ECHEC : cellules inattendues sur la ligne réduite : " + JSON.stringify(cellules));
      }
      if (ligneReduite.indexOf("…") >= 0 || /inconnu/i.test(ligneReduite)) {
        echecs += 1;
        console.error("  ECHEC : la ligne réduite ne doit contenir ni pointillés ni « inconnu »");
      } else {
        console.log("  OK   ligne réduite sans pointillés ni « inconnu »");
      }
    }
  }
  // L'entreprise complète, elle, garde ses coordonnées.
  const ligneComplete = extraireLigneTable(xmlCRC, "VOLTALIS");
  if (!ligneComplete) {
    echecs += 1;
    console.error("  ECHEC : ligne de l'entreprise complète introuvable");
  } else {
    const cellules = cellulesDeLigne(ligneComplete);
    if (cellules.length === 6 && cellules[1] === "S.A.S. VOLTALIS" && cellules[3] === "01 00 00 00 02" && cellules[4] === "contact@voltalis.example") {
      console.log("  OK   entreprise complète : coordonnées conservées dans la même grille");
    } else {
      echecs += 1;
      console.error("  ECHEC : cellules inattendues sur la ligne complète : " + JSON.stringify(cellules));
    }
  }
  // (b) lotsNonAttribues rempli -> la section liste les lots.
  verifier("section lots restant à attribuer", texteCRC, "LOTS RESTANT À ATTRIBUER");
  verifier("lot restant listé (cloisons sèches)", texteCRC, "LOT n° 14 - CLOISONS SECHES (clos technique)");
  verifier("lot restant listé (piscine)", texteCRC, "LOT n° 15 - PISCINE (non arbitre)");
  // La date de réunion du projet est reportée dans le CRC n°01.
  verifier("date de réunion reportée (n°01)", texteCRC, "du 14 avril 2025");
}
{
  // (c) Sans projet.crc.lotsNonAttribues : la section reste PRÉSENTE, avec des
  //     lignes vides de saisie manuelle (un canevas ne disparaît jamais).
  verifier("canevas : section lots présente même sans champ", texteCrcCanevas, "LOTS RESTANT À ATTRIBUER");
  if (texteCrcCanevas.indexOf("CLOISONS SECHES") >= 0) {
    echecs += 1;
    console.error("  ECHEC : libellé de lot présent alors que lotsNonAttribues est absent");
  } else {
    console.log("  OK   canevas sans champ : aucun lot inventé");
  }
  const idxTitre = xmlCrcCanevas.indexOf("LOTS RESTANT");
  const idxTable = idxTitre >= 0 ? xmlCrcCanevas.indexOf("<w:tbl>", idxTitre) : -1;
  const finTable = idxTable >= 0 ? xmlCrcCanevas.indexOf("</w:tbl>", idxTable) : -1;
  if (idxTable < 0 || finTable < 0) {
    echecs += 1;
    console.error("  ECHEC : tableau de saisie manuelle absent sous la section des lots");
  } else {
    const tbl = xmlCrcCanevas.slice(idxTable, finTable);
    const nbLignes = (tbl.match(/<w:tr>/g) || []).length;
    const cellules = [];
    const re = /<w:tc>([\s\S]*?)<\/w:tc>/g;
    let m;
    while ((m = re.exec(tbl)) !== null) {
      const morceaux = [];
      const rt = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let mt;
      while ((mt = rt.exec(m[1])) !== null) morceaux.push(mt[1]);
      cellules.push(aplatir(morceaux.join("")));
    }
    const nonVides = cellules.filter(function (c) { return c !== ""; });
    if (nbLignes >= 4 && cellules.length >= 8 && nonVides.length === 2) {
      console.log("  OK   canevas : " + nbLignes + " lignes (en-tête + 3 lignes de saisie), cellules vides à remplir");
    } else {
      echecs += 1;
      console.error("  ECHEC : canevas inattendu — lignes=" + nbLignes + ", cellules=" + cellules.length + ", nonVides=" + JSON.stringify(nonVides));
    }
  }
}
{
  // (d) genererCRC01(projet, { numero: 2 }) -> le titre porte N° 02 et la
  //     date de réunion du projet ; sans option, le titre reste N° 01.
  verifier("titre CRC n° 02 (option numero)", texteCRC02, "COMPTE RENDU DE CHANTIER N° 02");
  if (texteCRC02.indexOf("COMPTE RENDU DE CHANTIER N° 01") >= 0) {
    echecs += 1;
    console.error("  ECHEC : le CRC n°02 porte encore le titre n°01");
  } else {
    console.log("  OK   le n°02 ne porte pas le titre n°01");
  }
  verifier("réunion de chantier (n°02)", texteCRC02, "Réunion de chantier");
  verifier("date de réunion reportée (n°02)", texteCRC02, "du 14 avril 2025");
}

// ── Verdict ─────────────────────────────────────────────────────────────────
if (echecs > 0) {
  console.error("TESTS DOCX : " + echecs + " assertion(s) en échec");
  process.exit(1);
}
console.log("TESTS DOCX OK");