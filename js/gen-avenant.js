// js/gen-avenant.js — Générateur de la FICHE AVENANT (.xlsx)
//
// RÔLE : produire, sans ressaisie, la fiche d'avenant de l’agence dans le
// gabarit Excel réel. Le gabarit gabarits/avenant-gabarit.xlsx a été construit une
// fois pour toutes depuis le fichier d’origine (fiche
// réelle AV1) : la feuille s'appelle « AVENANT », les valeurs dynamiques sont
// vidées, tout le reste est conservé à l'identique (styles Trebuchet, format
// monétaire €, pageSetup A4 portrait échelle 75 %, zone d'impression A1:H141,
// système de dates 1904). La feuille tient sur DEUX pages imprimées : page 1 =
// fiche financière (lignes 1-66), page 2 = « OS AVENANT » (lignes 77-141) — la
// séparation vient du gabarit lui-même et est conservée.
//
// LOGIQUE FINANCIÈRE DU GABARIT (les documents d’origine + SPEC §3/§5) — colonnes
// « Montant H.T | TVA 20 % | Montant T.T.C », lignes marquées :
//   (A) montant initial du lot à l'acte d'engagement ............... r18
//   Montants rectifiés par les avenants précédents (n° + montant) .. r21-r22
//   (B) montant total rectifié = (A) + avenants précédents ......... r24
//   §1 « OBJET : PV » — lignes de travaux en plus (2 emplacements) . r31, r33
//       (C) montant en plus = somme des PV ......................... r38
//   §2 « OBJET : MV » — ligne de travaux en moins .................. r45
//       (D) montant en moins = somme des MV ........................ r47
//   MONTANT CUMULÉ = (B) + (C) - (D) ............................... r50
//   §3 modification des délais (« Néant » par défaut) .............. r53
//   §4 clause de survie ............................................ r56-r58 (fixe)
//   « Lu et approuvé » + signatures ................................ r61-r63
//   Page 2 : OS AVENANT — en-têtes repris par formules (D79=D3, D83=D6, D87=D9,
//   D94=D87…), « ORDRE DE SERVICE A L'ENTREPRENEUR N°X » (r91), avertissement
//   QUINZE JOURS (r101-r103), blocs LE:/À: laissés à l'émargement manuel, accusé
//   de réception (r122-r128).
//
// POURQUOI LES TOTAUX SONT ÉCRITS EN NUMÉRIQUE (et non en formules) : dans le
// classeur réel, (B) ne somme que le premier avenant précédent (F24=F18+F21) et
// le montant cumulé ADDITIONNE (D) au lieu de le retrancher (F50=F24+F38+F47)
// deux limites du fichier réel, invisibles dans l'AV1 car (D)=0. Les générateurs
// écrivent donc (B), (C), (D) et le MONTANT CUMULÉ calculés par js/calculs.js
// (chainageAvenant, contrat SPEC §8 : cumulé = B + C - D) ; les lignes de saisie
// gardent leurs montants unitaires. La relecture de tests/gen-xlsx.mjs est ainsi
// déterministe et conforme à la SPEC.
//
// LIGNES PV/MV (contrat §2 : lignes:[{libelle, montant}]) : une ligne est une
// PLUS-VALUE (colonne C) si montant positif ou sens « plus », une MOINS-VALUE
// (colonne D) si montant négatif ou sens « moins ». Le champ sens, s'il est
// présent, prime sur le signe (interprétation du générateur — la SPEC §2 ne
// décrit pas ce champ).
//
// (A) MONTANT INITIAL : montant HT retenu du devis de l'entreprise (même chaîne
// que l'OS : montantAvecVariantes puis prorata « valeur »). À défaut de champ
// dédié dans le contrat §2, c'est la donnée « sans ressaisie » disponible.
//
// EXPORT (contrat SPEC §8) : genererAvenant(projet, entrepriseId, avenant)
// -> Promise<Blob> — un classeur d'une feuille nommée « AVENANT n ».
// Les utilitaires partagés (chargement ExcelJS, lecture de gabarit, clonage de
// feuille, dates 1904) viennent de js/gen-os.js : même mécanique pour les deux
// gabarits xlsx, et la liste de propriétés de fichiers n'admet
// pas de module utilitaire supplémentaire.

import {
  lireGabarit, clonerFeuille, chargerCalculs, versBlob,
  dateVersSerie1904, dateFrancaise, montantsDevisRetenu, tvaTauxContrat,
} from "./gen-os.js";

// SPEC § 6 quater : même règle que pour le marché — un avenant se construit sur le devis
// ACTIF. La règle (statut 'actif' / 'remplace') vit dans js/etat.js : on la consomme, on ne
// la réimplémente pas.
import { devisActif } from "./etat.js";

// Gabarit avenant, résolu depuis CE fichier (Node comme navigateur).
const URL_GABARIT_AVENANT = new URL("../gabarits/avenant-gabarit.xlsx", import.meta.url);

// Arrondi à la 4e décimale — même convention que js/calculs.js — pour les
// colonnes TVA/TTC déduites localement (supprime le bruit flottant IEEE 754 du
// type 19426.714000000004 ; le numFmt € du gabarit n'affiche que 2 décimales).
function arrondi4(x) {
  return Math.round(x * 1e4) / 1e4;
}

/* ------------------------------------------------------------------ */
/* Normalisation des montants renvoyés par js/calculs.js               */
/* ------------------------------------------------------------------ */

// Le contrat §8 ne fige pas la forme exacte de ce que renvoient les fonctions
// de js/calculs.js (nombre simple ou objet {ht, tva, ttc}) ; on accepte les
// deux pour rester robuste à la livraison de js/calculs.js.
function valeurNombre(valeur, tvaTaux) {
  if (typeof valeur === "number") return valeur;
  if (valeur && typeof valeur === "object") {
    if (typeof valeur.ht === "number") return valeur.ht;
    if (typeof valeur.ttc === "number") return valeur.ttc / (1 + tvaTaux);
  }
  return 0;
}

// Une ligne d'avenant est une plus-value (C) si montant positif ou sens
// « plus », une moins-value (D) si montant négatif ou sens « moins ».
function sensLigne(ligne) {
  if (ligne && ligne.sens === "moins") return "moins";
  if (ligne && ligne.sens === "plus") return "plus";
  return (ligne && Number(ligne.montant) < 0) ? "moins" : "plus";
}

function montantHT(ligne) {
  return Math.abs(Number(ligne && ligne.montant) || 0);
}

// Net HT d'un avenant (effet sur le marché) : somme des plus, moins les moins.
function netHT(avenant) {
  let net = 0;
  for (const ligne of avenant.lignes || []) {
    net += sensLigne(ligne) === "plus" ? montantHT(ligne) : -montantHT(ligne);
  }
  return net;
}

/* ------------------------------------------------------------------ */
/* Injection                                                           */
/* ------------------------------------------------------------------ */

async function injecterAvenant(feuille, projet, entreprise, avenant, calculs) {
  const mo = projet.maitreOuvrage || {};
  const operation = projet.operation || {};

  // --- En-tête (page 1)
  // L'espacement du titre est celui du gabarit réel : « A V E N A N T   N °  1 »
  // (trois espaces avant le N, deux après le degré).
  feuille.getCell("D1").value = "A V E N A N T   N °  " + (avenant.numero ?? "");
  feuille.getCell("D3").value = [operation.reference, operation.intitule].filter(Boolean).join(" - ");
  feuille.getCell("D4").value = [operation.adresse, operation.cp, operation.ville].filter(Boolean).join(" ");
  feuille.getCell("D6").value = [mo.raisonSociale, mo.representant ? "representé par " + mo.representant : ""]
    .filter(Boolean).join(", ");
  feuille.getCell("D7").value = [mo.adresse, mo.cp, mo.ville].filter(Boolean).join(" ");
  feuille.getCell("D9").value = entreprise.raisonSociale || "";
  feuille.getCell("D10").value = [entreprise.adresse, entreprise.cp, entreprise.ville].filter(Boolean).join(" ");
  feuille.getCell("D13").value = entreprise.lotNom || "";

  // --- Chaînage financier (contrat SPEC §8) : tout en HT ; les colonnes TVA et
  // TTC valent x × tvaTaux et x × (1 + tvaTaux), dans l'esprit des formules
  // d'origine du gabarit mais au TAUX DU CONTRAT (plus de 0,2/1,2 en dur).
  const devis = devisActif(projet, entreprise.id);
  // Taux de TVA du contrat : devis > projet > défaut 20 % (tvaTauxContrat,
  // SPEC §2 « surchargeable ») — plus aucun 1,2 ni 0,2 en dur dans ce fichier.
  const tvaTaux = tvaTauxContrat(projet, devis);
  const montantsInitial = await montantsDevisRetenu(calculs, devis, projet); // lève si devis absent
  const htInitial = valeurNombre(montantsInitial, tvaTaux);

  const precedents = (projet.avenants || [])
    .filter((a) => a.entrepriseId === entreprise.id && Number(a.numero) < Number(avenant.numero))
    .sort((a, b) => Number(a.numero) - Number(b.numero));
  // Contrat SPEC §8 : avenantsPrecedents est la LISTE
  // des effets nets HT des avenants antérieurs (nombres, positifs ou négatifs,
  // triés par numéro) — JAMAIS un cumul pré-sommé : la règle (A)+(1)+(2)+(x)=(B)
  // appartient à js/calculs.js seul, pour ne pas diverger entre la fiche AV et
  // le marché. Cf. js/calculs.js (validation des éléments sans borne de signe).
  const effetsPrecedents = precedents.map(netHT);

  const lignes = avenant.lignes || [];
  const lignesPV = lignes.filter((l) => sensLigne(l) === "plus");
  const lignesMV = lignes.filter((l) => sensLigne(l) === "moins");
  const htPlus = lignesPV.reduce((somme, l) => somme + montantHT(l), 0);
  const htMoins = lignesMV.reduce((somme, l) => somme + montantHT(l), 0);

  // Appel contractuel — renvoie {A, B, C, D, cumule} (nombres HT).
  const chain = calculs.chainageAvenant({
    montantInitial: htInitial,
    avenantsPrecedents: effetsPrecedents,
    plusValue: htPlus,
    moinsValue: htMoins,
    tvaTaux,
  });
  const A = valeurNombre(chain.A, tvaTaux);
  const B = valeurNombre(chain.B, tvaTaux);
  const C = valeurNombre(chain.C, tvaTaux);
  const D = valeurNombre(chain.D, tvaTaux);
  const cumule = valeurNombre(chain.cumule, tvaTaux);

  // (A) — montant initial du lot (acte d'engagement) : HT | TVA | TTC
  feuille.getCell("F18").value = A;
  feuille.getCell("G18").value = arrondi4(A * tvaTaux);
  feuille.getCell("H18").value = arrondi4(A * (1 + tvaTaux));

  // Avenants précédents : n° (E21/E22) et effet net HT (F21/F22).
  // Le gabarit n'offre que deux emplacements ; au-delà, la somme (B) reste
  // exacte car elle est écrite en numérique.
  precedents.slice(0, 2).forEach((a, i) => {
    feuille.getCell(i === 0 ? "E21" : "E22").value = a.numero;
    feuille.getCell(i === 0 ? "F21" : "F22").value = netHT(a);
  });

  // (B) — montant total rectifié
  feuille.getCell("F24").value = B;
  feuille.getCell("G24").value = arrondi4(B * tvaTaux);
  feuille.getCell("H24").value = arrondi4(B * (1 + tvaTaux));

  // §1 OBJET : PV — deux emplacements (r31, r33). Au-delà de deux lignes,
  // libellés joints dans le premier et total dans le second emplacement vidé.
  feuille.getCell("B31").value = lignesPV.length <= 2
    ? (lignesPV[0] ? String(lignesPV[0].libelle || "") : "")
    : lignesPV.map((l) => l.libelle).filter(Boolean).join(" ; ");
  feuille.getCell("F31").value = lignesPV.length <= 2 ? montantHT(lignesPV[0]) : htPlus;
  feuille.getCell("G31").value = arrondi4(feuille.getCell("F31").value * tvaTaux);
  feuille.getCell("H31").value = arrondi4(feuille.getCell("F31").value * (1 + tvaTaux));
  if (lignesPV.length === 2) {
    feuille.getCell("B33").value = String(lignesPV[1].libelle || "");
    feuille.getCell("F33").value = montantHT(lignesPV[1]);
    feuille.getCell("G33").value = arrondi4(montantHT(lignesPV[1]) * tvaTaux);
    feuille.getCell("H33").value = arrondi4(montantHT(lignesPV[1]) * (1 + tvaTaux));
  }

  // (C) — montant en plus
  feuille.getCell("F38").value = C;
  feuille.getCell("G38").value = arrondi4(C * tvaTaux);
  feuille.getCell("H38").value = arrondi4(C * (1 + tvaTaux));

  // §2 OBJET : MV — un emplacement (r45) ; libellés joints en B45 si plusieurs.
  feuille.getCell("B45").value = lignesMV.map((l) => l.libelle).filter(Boolean).join(" ; ");
  feuille.getCell("F45").value = htMoins;
  feuille.getCell("G45").value = arrondi4(htMoins * tvaTaux);
  feuille.getCell("H45").value = arrondi4(htMoins * (1 + tvaTaux));

  // (D) — montant en moins
  feuille.getCell("F47").value = D;
  feuille.getCell("G47").value = arrondi4(D * tvaTaux);
  feuille.getCell("H47").value = arrondi4(D * (1 + tvaTaux));

  // MONTANT CUMULÉ = (B) + (C) - (D) — calculé par chainageAvenant (SPEC §3),
  // écrit en numérique (voir note d'en-tête sur les formules du réel).
  feuille.getCell("F50").value = cumule;
  feuille.getCell("G50").value = arrondi4(cumule * tvaTaux);
  feuille.getCell("H50").value = arrondi4(cumule * (1 + tvaTaux));

  // §3 — délais : « Néant » comme dans le gabarit réel si aucune modification.
  const delais = avenant.modificationDelais;
  feuille.getCell("F53").value = delais
    ? (typeof delais === "string" ? delais : String(delais.libelle || delais.texte || "Voir avenant"))
    : "Néant";

  // --- Page 2 : OS AVENANT
  feuille.getCell("C91").value =
    String(feuille.getCell("C91").value || "ORDRE DE SERVICE A L'ENTREPRENEUR N° 1")
      .replace(/N°\s*\d*\s*$/, "N° " + (avenant.numero ?? 1));
  const representant = [entreprise.representant, entreprise.qualiteRepresentant].filter(Boolean).join(" ");
  // le gabarit imprime « M. » en dur : on ne répète pas le titre porté par la donnée
  if (representant) feuille.getCell("C93").value = " M.  " + representant.replace(/^M\.\s*/, "");
  // (r106/r115 « LE: / À: » laissés vides : émargement manuel, comme dans le réel.)
}

/* ------------------------------------------------------------------ */
/* Export principal                                                    */
/* ------------------------------------------------------------------ */

// Contrat SPEC §8 : genererAvenant(projet, entrepriseId, avenant) -> Promise<Blob>
export async function genererAvenant(projet, entrepriseId, avenant) {
  if (!avenant) throw new Error("Aucun avenant fourni à genererAvenant.");
  const entreprise = (projet.entreprises || []).find((e) => e.id === entrepriseId);
  if (!entreprise) throw new Error("Entreprise inconnue dans le projet : " + entrepriseId);

  const calculs = await chargerCalculs();
  const classeur = await lireGabarit(URL_GABARIT_AVENANT);
  const modele = classeur.getWorksheet("AVENANT");
  if (!modele) throw new Error('Gabarit avenant invalide : feuille modèle « AVENANT » absente.');

  const clone = clonerFeuille(classeur, modele, "AVENANT " + (avenant.numero ?? ""));
  await injecterAvenant(clone, projet, entreprise, avenant, calculs);
  classeur.removeWorksheet(modele.id);
  classeur.properties.date1904 = true;           // gabarit Mac, SPEC §5
  classeur.calcProperties.fullCalcOnLoad = true; // recalcul des formules conservées
  return versBlob(await classeur.xlsx.writeBuffer());
}