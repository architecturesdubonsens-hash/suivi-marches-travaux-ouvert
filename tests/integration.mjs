// tests/integration.mjs
//
// Vérifie ce qu'AUCUNE suite unitaire ne vérifie : la CHAÎNE COMPLÈTE sur le jeu de données
// d'exemple (donnees/op-2026-01.json, entièrement fictif), et non sur les fixtures hermétiques
// de chaque générateur. Quatre générateurs, quatre livrables, et des valeurs attendues
// calculées indépendamment — jamais tirées du retour des modules.
//
// Les preuves sont lues dans le XML BRUT des fichiers produits : c'est la seule façon
// de savoir ce qu'Excel et Word afficheront réellement (leçon du 25/09/2026, format
// de date américain passé inaperçu à travers une assertion de valeur).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chargerUMD } from './lib/chargeur-umd.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');
const SORTIE = path.join(RACINE, 'tests-output', 'integration');
fs.mkdirSync(SORTIE, { recursive: true });

const JSZip = chargerUMD(path.join(RACINE, 'vendor', 'jszip.min.js'), 'JSZip');
// Node exige une URL file:// pour un import absolu sous Windows (piège déjà payé
// avec le chargeur UMD) : on convertit, on ne concatène pas.
const charger = (relatif) => import(pathToFileURL(path.join(RACINE, relatif)).href);
const calculs = await charger('js/calculs.js');
const { genererOS } = await charger('js/gen-os.js');
const { genererAvenant } = await charger('js/gen-avenant.js');
const { genererMarche } = await charger('js/gen-marche.js');
const { genererCRC01 } = await charger('js/gen-crc.js');

let ok = 0; let ko = 0;
function verifier(intitule, obtenu, attendu) {
  const bon = typeof attendu === 'function' ? attendu(obtenu) : JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + intitule); }
  else { ko++; console.error('  ECHEC ' + intitule + '  attendu=' + JSON.stringify(attendu) + '  obtenu=' + JSON.stringify(obtenu)); }
}

async function octets(blob) { return Buffer.from(await blob.arrayBuffer()); }
async function lireZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const contenu = async (nom) => zip.file(nom) ? zip.file(nom).async('string') : null;
  return { zip, contenu };
}
function cellule(xml, ref) {
  // Piège payé : '<c r="X"[^>]*>(.*?)</c>' sur une cellule AUTO-FERMANTE
  // (<c r="C42" s="79"/>) saute jusqu'au </c> d'une cellule voisine et renvoie
  // la valeur d'autrui. On traite donc les deux formes explicitement.
  const autoFermante = new RegExp('<c r="' + ref + '"[^>]*/>').exec(xml || '');
  if (autoFermante) return null;
  const m = new RegExp('<c r="' + ref + '"[^>]*>([\\s\\S]*?)</c>').exec(xml || '');
  if (!m) return null;
  const v = /<v>([^<]*)<\/v>/.exec(m[1]);
  return v ? v[1] : null;
}

/* ------------------------------------------------------------------ */
console.log('— assemblage du Projet depuis le jeu de données réel');
const donnees = JSON.parse(fs.readFileSync(path.join(RACINE, 'donnees', 'op-2026-01.json'), 'utf8'));
verifier('jeu de données : deux opérations', donnees.operations.length, 2);
const operation = donnees.operations.find((o) => o.cle === 'villeneuve-exemple') || donnees.operations[0];
const entreprises = (operation.entreprises || []).map((e) =>
  (typeof e === 'string' ? donnees.entreprises.find((x) => x.id === e) : e)).filter(Boolean);
verifier('opération villeneuve-exemple : entreprises rattachées', entreprises.length > 10, true);
verifier('opération villeneuve-exemple : devis rattachés', (operation.devis || []).length > 10, true);

const projet = {
  id: 'integration-op-2026-01-villeneuve-exemple',
  operation: { ...operation, maitreOuvrage: undefined },
  maitreOuvrage: operation.maitreOuvrage,
  agence: donnees.agence,
  entreprises,
  devis: operation.devis || [],
  attestations: [],
  OS: operation.os || [],
  avenants: operation.avenants || [],
  equipe: { architecteSignataire: donnees.agence.representant, conducteursTravaux: [] },
  retenueGarantieTaux: 0.05,
  penalites: { tauxJournalier: 1 / 3000, montantMaxPct: 5 },
};
delete projet.operation.maitreOuvrage;

/* ------------------------------------------------------------------ */
console.log('— ORDRE DE SERVICE (colorama, valeurs du classeur réel)');
const blobOS = await genererOS(projet, 'colorama');
verifier('OS produit', (await octets(blobOS)).length > 5000, true);
const osZip = await lireZip(await octets(blobOS));
const wbXml = await osZip.contenu('xl/workbook.xml');
verifier('workbook déclare le calendrier 1904', /date1904="1"/.test(wbXml || ''), true);
const feuille = await osZip.contenu('xl/worksheets/sheet1.xml');
verifier('F29 = HT réel 84378.08 (os.txt r29)', cellule(feuille, 'F29'), '84378.08');
verifier('F28 = TTC réel 101253.696 (os.txt r28)', cellule(feuille, 'F28'), '101253.696');
verifier('F33 = série 1904 du 28/04/2025', cellule(feuille, 'F33'), '44313');
verifier('C42 = série 1904 du 27/03/2025', cellule(feuille, 'C42'), '44281');

/* ------------------------------------------------------------------ */
console.log('— AVENANT (VOLTALIS, chaînage du gabarit réel AV1)');
const ttcVoltalis = 560000 * 1.2;
const avenant = {
  numero: 1, objet: 'PV — divisionnaire cellules', entrepriseId: 'voltalis',
  lignes: [{ libelle: 'Devis 27/03/2025 — Rac. TJ et divisionnaire', sens: 'plus', montant: 38682.1 }],
  modificationDelais: null,
};
const blobAV = await genererAvenant(projet, 'voltalis', avenant);
const avZip = await lireZip(await octets(blobAV));
const avFeuille = await avZip.contenu('xl/worksheets/sheet2.xml');
verifier('(A) montant initial = HT du devis réel (560000)', cellule(avFeuille, 'F18'), '560000');
verifier('(C) plus-value = 38682.1 (AV1 réel)', cellule(avFeuille, 'F31'), '38682.1');
verifier('MONTANT CUMULÉ = 598682.1 (fiche AV1 réelle)', cellule(avFeuille, 'F50'), '598682.1');
verifier('TVA du cumulé = 119736.42 (fiche AV1 réelle)', cellule(avFeuille, 'G50'), '119736.42');
verifier('TTC du cumulé = 718418.52 (fiche AV1 réelle)', cellule(avFeuille, 'H50'), '718418.52');

/* ------------------------------------------------------------------ */
console.log('— MARCHÉ DE TRAVAUX (CCAP, montant en lettres source unique)');
const blobMT = await genererMarche(projet, 'colorama');
const mtZip = await lireZip(await octets(blobMT));
const docXml = await mtZip.contenu('word/document.xml');
verifier('marché : document.xml non vide', (docXml || '').length > 20000, true);
verifier('marché : titre du gabarit', /MARCHE TRAVAUX PRIV/i.test(docXml || ''), true);
const lettres = calculs.montantEnLettresMajuscules(101253.696);
verifier('marché : montant en lettres de la source unique', (docXml || '').includes(lettres), true);
verifier('marché : 13 pièces contractuelles listées', /13\s*Documents techniques/i.test(docXml || ''), true);

/* ------------------------------------------------------------------ */
console.log('— COMPTE RENDU DE CHANTIER n°01 (tableau des intervenants)');
const blobCRC = await genererCRC01(projet);
const crcZip = await lireZip(await octets(blobCRC));
const crcXml = await crcZip.contenu('word/document.xml');
verifier('CRC : un tableau Word', /<w:tbl>/.test(crcXml || ''), true);
verifier('CRC : maître d\'ouvrage présent', /DISTRIBEX/.test(crcXml || ''), true);
verifier('CRC : une entreprise du corpus présente', /COLORAMA/.test(crcXml || ''), true);
verifier('CRC : agence présente', /EXEMPLE ARCHITECTURE/.test(crcXml || ''), true);

/* ------------------------------------------------------------------ */
for (const [nom, blob] of [['os-colorama.xlsx', blobOS], ['avenant-voltalis.xlsx', blobAV],
  ['marche-colorama.docx', blobMT], ['crc-01.docx', blobCRC]]) {
  fs.writeFileSync(path.join(SORTIE, nom), await octets(blob));
}
console.log('');
console.log('BILAN integration : ' + ok + ' cas ok, ' + ko + ' echec(s).');
console.log('Livrables reels ecrits dans tests-output/integration/');
process.exit(ko ? 1 : 0);
