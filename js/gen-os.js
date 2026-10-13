// js/gen-os.js — Générateur de l'ORDRE DE SERVICE (.xlsx)
//
// RÔLE : produire, sans ressaisie, l'Ordre de Service de l’agence dans le
// gabarit Excel RÉEL du cabinet. Le gabarit gabarits/os-gabarit.xlsx a été construit
// une fois pour toutes depuis le fichier d’origine (classeur réel
// OP-2026-01, feuille « desamia (2) » retenue comme modèle car c'est sa numérotation
// de lignes que reprennent les documents d’origine et la SPEC §5) : la feuille s'appelle
// « OS », ses valeurs dynamiques sont vidées, et tout le reste (styles, bordures,
// fusions A19:B19/B33:C33/B37:E37, largeurs, hauteurs de lignes, pageSetup A4
// portrait échelle 80 %, zone d'impression A1:F66, système de dates 1904) est
// conservé à l'identique. Ce module ne fait QU'INJECTER des valeurs.
//
// MAPPING DE LIGNES (feuille « OS », cf. les documents d’origine et SPEC §5) :
//   A2  = raison sociale du maître d'ouvrage          | r1  = titre « MAÎTRE D'OUVRAGE » (fixe)
//   C3  = représentant du maître d'ouvrage            | r3  = « Co dirigeant : » (fixe)
//   C4  = SIREN MO (numérique, format #,##0 conservé) |
//   C5  = adresse complète du MO                      |
//   C6  = référence de l'opération (ex. OP-2026-01)      | r6  = « OPÉRATION » (fixe)
//   A7/A8 = intitulé de l'opération (scindé en 2 lignes ~60 car., comme dans le réel)
//   C9  = adresse complète de l'opération             | r9  = « ADRESSE : » (fixe)
//   A12 = raison sociale de l'entreprise              | r11 = « ENTREPRISE » (fixe)
//   C13 = représentant + qualité de l'entreprise      |
//   C14 = SIREN entreprise (numérique)                |
//   C15 = adresse complète de l'entreprise            | A15 = formule =A5 (conservée)
//   A17 = titre « ORDRE DE SERVICE A L'ENTREPRENEUR N°X » (n° réécrit)
//   C27 = nom du lot                                  | r27 = « LOT » (fixe)
//   F28 = montant TTC (numérique, format € conservé)  | r28 = « pour un montant de travaux T.T.C. » (fixe)
//   F29 = montant HT « PRO RATA INCLUS » (numérique)  | E29 : mention conservée si le
//         prorata du devis vaut « inclus », VIDÉE sinon (décision de conception :
//         mode « valeur » ou prorata absent = mention fausse, cf. OS signé)
//   F30 = « devis numéro X du jj/mm/aaaa »            | r30 = « suivant devis ci-dessous » (fixe)
//   F33 = date « A compter du » en SÉRIE 1904         | B33 = « A compter du : » (fixe, fusion B33:C33)
//         + format dd/mm/yyyy posé sur le clone (décision de conception : le
//         gabarit porte mm-dd-yy, l'OS signé affiche « 19/02/2025 ») ; idem C42/C41
//   C41 = lieu « FAIT À »                             | r41 = « FAIT À : » (fixe)
//   C42 = date « LE » en série 1904                   | r42 = « LE: » (fixe)
//   B34 = « LOTS <n°> » si Entreprise.lotNumero renseigné — ligne libre stylée,
//         complément OS SIGNÉ (les documents d’origine)
//   B35 = délais de réalisation si Devis.delaisRealisation renseigné (choix :
//         engagement contractuel porté par l'offre, cf. note détaillée plus bas)
//   F28/F29 : format monétaire « 468 930,00 € » (numFmt #,##0.00" €" posé sur le
//         clone produit, comme l'OS signé ; le gabarit garde son format comptable)
//   r38-r39 : avertissement de forclusion QUINZE JOURS (fixe)
//   r43-r45 : signatures — MO repris par formules (A44=A2, A45=C3), bloc agence
//             F43:F45 PARAMÉTRABLE (complément OS signé) : mention, raison
//             sociale complète, signataire = Projet.equipe.architecteSignataire
//             (à défaut agence.representant) ; sans config projet, valeurs
//             d'origine du gabarit conservées
//   r54-r60 : accusé de réception (C55 = formule =C21 conservée)
//
// DATES — SYSTÈME 1904 : le classeur réel utilise le calendrier Mac
// (wb.properties.date1904 = true). Les dates sont donc écrites en NOMBRES (série
// 1904) pour ne rien décaler. Valeurs lues dans le classeur réel via ExcelJS :
// 44259 = 05/03/2025, 44281 = 27/03/2025, 44313 = 28/04/2025. (La note de la SPEC
// §5 qui annonce 44259 = 25/02/2025 résulte d'une conversion en ère 1900 et n'est
// pas exacte.)
//
// MONTANTS — les chiffres passent par js/calculs.js (contrat SPEC §8) :
// montantAvecVariantes(devis) puis appliquerProrata(ht, devis.prorata) pour le mode
// « valeur » (le mode « inclus » signifie que le HT affiché porte déjà le prorata,
// cohérent avec js/ui/ecran-validation.js). Les nombres sont écrits
// tels quels : le format monétaire du gabarit est conservé.
//
// CHARGEMENTS — aucune dépendance hors vendor/ :
//  - ExcelJS : navigateur = <script src="vendor/exceljs.min.js"> injecté à la
//    demande (window.ExcelJS) ; Node (tests) = chargeur UMD
//    (tests/lib/chargeur-umd.mjs). Détection par typeof window === 'undefined'.
//  - Le gabarit est lu par octets : readFileSync en Node, fetch en navigateur.
//  - Particularité Node : le bundle UMD d'ExcelJS tourne dans une vm séparée ; un
//    Buffer/Uint8Array du royaume Node échoue au test instanceof de JSZip à
//    l'intérieur de la vm (« Can't read the data of the loaded zip file »). On
//    contourne en passant la CHAÎNE BINAIRE latin1 des octets, acceptée par JSZip.
//
// EXPORTS :
//   contrat SPEC §8 : genererOS(projet, entrepriseId) -> Promise<Blob> — UN
//   classeur, UNE feuille nommée d'après l'entreprise (comme dans le classeur réel).
//   ajouts locaux (motivés en commentaire) :
//   - genererClasseurOS(projet) -> Promise<Blob> : UN classeur multi-feuilles
//     (une feuille par entreprise retenue), prêt pour 02_OS/ — la SPEC §1 décrit
//     la sortie comme un classeur multi-feuilles et ExcelJS ne sait pas fusionner
//     deux classeurs après coup sans perdre les styles ;
//   - les utilitaires partagés (dates 1904, clonage de feuille, chargements),
//     importés par js/gen-avenant.js — les deux gabarits xlsx partagent la même
//     mécanique et la liste de propriétés de fichiers n'admet pas
//     de module utilitaire supplémentaire.
//
// « Entreprise retenue » : une entreprise du projet pour laquelle un devis est
// présent dans projet.devis (c'est la chaîne « devis retenus » du cahier des charges).

// SPEC § 6 ter : la complétude d'une entreprise est jugée par etatEntreprise(),
// SEULE source de la règle (js/etat.js). On la consomme, on ne la réimplémente pas
// même discipline que pour js/calculs.js. Import statique : les deux modules sont du
// projet, pas du vendor, et etat.js n'a aucune dépendance lourde.
import { etatEntreprise } from "./etat.js";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Chemins résolus depuis CE fichier (Node comme navigateur, indépendamment du
// répertoire courant du processus).
const URL_GABARIT = new URL("../gabarits/os-gabarit.xlsx", import.meta.url);
const URL_VENDOR_EXCELJS = new URL("../vendor/exceljs.min.js", import.meta.url);
const URL_CHARGEUR_UMD = new URL("../tests/lib/chargeur-umd.mjs", import.meta.url);

/* ------------------------------------------------------------------ */
/* Chargement d'ExcelJS (vendor, sans npm)                             */
/* ------------------------------------------------------------------ */

let cacheExcelJS = null;

function chargerScriptNavigateur(src) {
  return new Promise((resoudre, rejeter) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resoudre;
    script.onerror = () => rejeter(new Error("Impossible de charger " + src + " (vendor/ absent ?)"));
    document.head.append(script);
  });
}

export async function chargerExcelJS() {
  if (cacheExcelJS) return cacheExcelJS;
  if (typeof window === "undefined") {
    // Node (tests) : chargeur UMD (vm, sans node_modules).
    // fileURLToPath : le chargeur attend un chemin STRING (readFileSync ET
    // vm.runInContext options.filename refusent un objet URL).
    const { fileURLToPath } = await import("node:url");
    const { chargerUMD } = await import(URL_CHARGEUR_UMD.href);
    cacheExcelJS = chargerUMD(fileURLToPath(URL_VENDOR_EXCELJS), "ExcelJS");
  } else {
    if (!window.ExcelJS) await chargerScriptNavigateur("vendor/exceljs.min.js");
    cacheExcelJS = window.ExcelJS;
  }
  return cacheExcelJS;
}

// js/calculs.js : import dynamique pour que le module reste CHARGEABLE
// tant que js/calculs.js est absent, avec un message d'attente explicite.
export async function chargerCalculs() {
  try {
    return await import(new URL("./calculs.js", import.meta.url).href);
  } catch (e) {
    // Message destiné à l'utilisateur : le calcul des montants est indisponible. La
    // cause technique reste en console, où elle sert au dépannage.
    console.info("[gen-os] calcul des montants indisponible :", e);
    throw new Error("Le calcul des montants est indisponible : l'ordre de service ne peut pas être "
      + "produit. Rechargez la page, puis réessayez.");
  }
}

/* ------------------------------------------------------------------ */
/* Lecture du gabarit                                                  */
/* ------------------------------------------------------------------ */

export async function lireGabarit(urlGabarit = URL_GABARIT) {
  const ExcelJS = await chargerExcelJS();
  const classeur = new ExcelJS.Workbook();
  if (typeof window === "undefined") {
    const { readFileSync } = await import("node:fs");
    // Chaîne binaire latin1 : voir note d'en-tête (contournement instanceof JSZip).
    await classeur.xlsx.load(readFileSync(urlGabarit).toString("latin1"));
  } else {
    const reponse = await fetch(urlGabarit.href);
    if (!reponse.ok) throw new Error("Gabarit introuvable : " + urlGabarit.href);
    await classeur.xlsx.load(await reponse.arrayBuffer());
  }
  return classeur;
}

/* ------------------------------------------------------------------ */
/* Outils génériques (feuille, noms, nombres, dates)                   */
/* ------------------------------------------------------------------ */

// Copie profonde par JSON : les styles ExcelJS partagent des objets entre
// cellules ; sans copie, modifier un style d'un clone modifierait le modèle.
export function copieProfonde(valeur) {
  return valeur === undefined ? undefined : JSON.parse(JSON.stringify(valeur));
}

// Un nom de feuille Excel : 31 caractères max, sans [ ] : * ? / \  (les noms
// réels « desamia (2) » et « COLORAMA » passent tels quels).
export function nomFeuilleValide(nom) {
  const interdits = new Set(["\\", "/", "?", "*", "[", "]", ":"]);
  const nettoye = String(nom || "Feuille")
    .split("")
    .map((c) => (interdits.has(c) ? " " : c))
    .join("")
    .trim();
  return (nettoye || "Feuille").slice(0, 31);
}

// Le gabarit réel stocke les SIREN en NOMBRES (format #,##0 -> « 100000074 »).
// On reproduit ce comportement ; si la valeur n'est pas numérisable, on écrit
// le texte tel quel.
export function sirenNumerique(siren) {
  const chiffres = String(siren || "").replace(/[^0-9]/g, "");
  return chiffres && chiffres.length <= 15 ? Number(chiffres) : String(siren || "");
}

// Adresse postale complète telle que la tape l'agence : « 8 rue du Modèle 82 000 Hautmont-test ».
export function adresseComplete(partie) {
  if (!partie) return "";
  return [partie.adresse, partie.cp, partie.ville].filter(Boolean).join(" ");
}

// Date -> numéro de série du système 1904 (mac). Série 0 = 01/01/1904, sans jour
// fictif de 1900. Les chaînes « AAAA-MM-JJ » sont découpées sans passer par Date
// pour éviter tout décalage de fuseau horaire.
export function dateVersSerie1904(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  let annee, mois, jour;
  const trouve = String(valeur).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (trouve) {
    annee = Number(trouve[1]); mois = Number(trouve[2]); jour = Number(trouve[3]);
  } else {
    const d = valeur instanceof Date ? valeur : new Date(valeur);
    if (Number.isNaN(d.getTime())) throw new Error("Date invalide : " + valeur);
    annee = d.getFullYear(); mois = d.getMonth() + 1; jour = d.getDate();
  }
  return Math.round((Date.UTC(annee, mois - 1, jour) - Date.UTC(1904, 0, 1)) / 86400000);
}

// Série 1904 -> « AAAA-MM-JJ ». TOLÉRANTE PAR CONCEPTION DE LA RELECTURE :
// ExcelJS redonne une cellule de date sous forme d'objet Date (jamais en
// nombre, cf. mesure) — dans ce cas l'ISO de la Date est
// rendue telle quelle, sans repasser par le calcul de série. Toute autre
// entrée non exploitable (null, texte, NaN) lève un message explicite plutôt
// qu'un RangeError opaque de type « Invalid time value ».
export function serie1904VersDateISO(serie) {
  if (serie && typeof serie.toISOString === "function") {
    return serie.toISOString().slice(0, 10);
  }
  const n = Number(serie);
  if (serie === null || serie === undefined || serie === "" || !Number.isFinite(n)) {
    throw new Error("serie1904VersDateISO : numéro de série 1904 (nombre) ou Date attendu, reçu " + String(serie));
  }
  const d = new Date(Date.UTC(1904, 0, 1) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// « jj/mm/aaaa » pour la ligne « devis numéro X du … » (le réel écrit les dates
// en toutes lettres libres : « du 16/01/2025 »).
export function dateFrancaise(valeur) {
  if (!valeur) return "";
  const trouve = String(valeur).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (trouve) return trouve[3] + "/" + trouve[2] + "/" + trouve[1];
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(d.getTime())) return String(valeur);
  const rempli = (n) => String(n).padStart(2, "0");
  return rempli(d.getDate()) + "/" + rempli(d.getMonth() + 1) + "/" + d.getFullYear();
}

// « représentant + qualité » tel que dans le réel : « M. Test Robin Président ».
export function representantComplet(partie) {
  return [partie && partie.representant, partie && partie.qualiteRepresentant]
    .filter(Boolean).join(" ");
}

// Intitulé de l'opération sur 2 lignes de gabarit (A7/A8) : dans le classeur
// réel, l'intitulé long est coupé manuellement vers 60 caractères.
export function scinderIntitule(intitule) {
  const texte = String(intitule || "");
  if (texte.length <= 60) return [texte, ""];
  let coupe = texte.lastIndexOf(" ", 60);
  if (coupe < 20) coupe = 60;
  return [texte.slice(0, coupe).trim(), texte.slice(coupe).trim()];
}

/* ------------------------------------------------------------------ */
/* Montants : pont vers js/calculs.js (contrat SPEC §8)                */
/* ------------------------------------------------------------------ */

// Montant final du devis retenu : variantes puis prorata. Le TTC reste la
// référence (SPEC §3) ; le HT affiché dans l'OS est « PRO RATA INCLUS ».
// Taux de TVA du contrat (TVA paramétrable) : le devis peut
// porter un taux particulier (lot à taux réduit ou majoré), sinon celui du
// projet, sinon le défaut 20 % — SPEC §2 : « tva = 20 % par défaut,
// surchargeable ». AUCUN 1,2 ni 0,2 codé en dur dans les calculs : les colonnes
// TVA/TTC valent x × tvaTaux et x × (1 + tvaTaux).
export function tvaTauxContrat(projet, devis) {
  const taux = (devis && devis.tvaTaux !== undefined && devis.tvaTaux !== null)
    ? devis.tvaTaux
    : (projet && projet.tvaTaux !== undefined && projet.tvaTaux !== null ? projet.tvaTaux : 0.2);
  const n = Number(taux);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error("tvaTauxContrat : taux de TVA invalide (" + taux + ") — attendu un nombre entre 0 et 1 (0,2 = 20 %).");
  }
  return n;
}

export async function montantsDevisRetenu(calculs, devis, projet) {
  if (!devis) {
    throw new Error("Aucun devis retenu pour cette entreprise : le document ne peut pas être chiffré.");
  }
  let montants = calculs.montantAvecVariantes(devis, { tvaTaux: tvaTauxContrat(projet, devis) });
  const prorata = devis.prorata;
  if (prorata && prorata.mode === "valeur" && prorata.taux !== null && prorata.taux !== undefined
      && typeof calculs.appliquerProrata === "function") {
    montants = calculs.appliquerProrata(montants.ht, prorata);
  }
  return montants;
}

/* ------------------------------------------------------------------ */
/* Clonage profond d'une feuille (ExcelJS n'a pas de copie de feuille) */
/* ------------------------------------------------------------------ */

export function clonerFeuille(classeur, modele, nom) {
  const clone = classeur.addWorksheet(nomFeuilleValide(nom), {
    properties: copieProfonde(modele.properties),
    pageSetup: copieProfonde(modele.pageSetup),
    views: copieProfonde(modele.views),
  });
  if (modele.headerFooter && Object.keys(modele.headerFooter).length) {
    clone.headerFooter = copieProfonde(modele.headerFooter);
  }
  // Largeurs de colonnes (celles du gabarit : A≈4,16 ; B/C≈12 ; E≈26 ; F≈40…).
  for (let i = 1; i <= modele.columnCount; i++) {
    const colonne = modele.getColumn(i);
    if (colonne && colonne.width !== undefined) clone.getColumn(i).width = colonne.width;
  }
  // Cellules + hauteurs de lignes : on ne recopie QUE ce qui existe (valeur ou
  // style), pour ne pas matérialiser les ~280 lignes vides du classeur réel.
  modele.eachRow({ includeEmpty: true }, (ligne, numeroLigne) => {
    if (ligne.height !== undefined) clone.getRow(numeroLigne).height = ligne.height;
    for (let c = 1; c <= modele.columnCount; c++) {
      const source = ligne.getCell(c);
      const aStyle = source.style && Object.keys(source.style).length > 0;
      const aValeur = source.value !== null && source.value !== undefined;
      if (!aStyle && !aValeur) continue;
      const cible = clone.getRow(numeroLigne).getCell(c);
      if (aStyle) cible.style = copieProfonde(source.style);
      if (aValeur) {
        cible.value = source.value && typeof source.value === "object" && !source.value.richText
          ? copieProfonde(source.value)   // formules {formula, result} recopiées telles quelles
          : source.value;
      }
    }
  });
  // Fusions en dernier (les valeurs sont déjà posées sur les cellules maîtresses).
  for (const fusion of (modele.model && modele.model.merges) || []) clone.mergeCells(fusion);
  return clone;
}

/* ------------------------------------------------------------------ */
/* Injection d'une feuille OS                                          */
/* ------------------------------------------------------------------ */

async function injecterOS(feuille, projet, entreprise, calculs) {
  const mo = projet.maitreOuvrage || {};
  const operation = projet.operation || {};
  const agence = projet.agence || {};
  const devis = (projet.devis || []).find((d) => d.entrepriseId === entreprise.id);
  const montants = await montantsDevisRetenu(calculs, devis, projet); // lève si devis absent

  // --- Mention « PRO RATA INCLUS » (E29) — décision de conception : la mention
  // n'est vraie que si le prorata du devis vaut réellement « inclus » ; elle
  // est VIDÉE quand le mode vaut « valeur » ou quand le devis n'en porte pas
  // (l'OS signé réel ne la porte pas : l'afficher sans prorata réel serait
  // une affirmation fausse sur le contrat).
  if (!(devis && devis.prorata && devis.prorata.mode === "inclus")) {
    feuille.getCell("E29").value = null;
  }
  const ordres = (projet.OS || []).filter((o) => o.entrepriseId === entreprise.id);
  const ordre = ordres[ordres.length - 1] || { numero: 1, dateDebut: null };

  // --- Bloc maître d'ouvrage (r1-r5)
  feuille.getCell("A2").value = mo.raisonSociale || "";
  feuille.getCell("C3").value = mo.representant || "";
  feuille.getCell("C4").value = sirenNumerique(mo.siren);
  feuille.getCell("C5").value = adresseComplete(mo);

  // --- Bloc opération (r6-r9)
  feuille.getCell("C6").value = operation.reference || "";
  const [ligne1, ligne2] = scinderIntitule(operation.intitule);
  feuille.getCell("A7").value = ligne1;
  feuille.getCell("A8").value = ligne2;
  feuille.getCell("C9").value = adresseComplete(operation);

  // --- Bloc entreprise (r11-r15)
  feuille.getCell("A12").value = entreprise.raisonSociale || "";
  feuille.getCell("C13").value = representantComplet(entreprise);
  feuille.getCell("C14").value = sirenNumerique(entreprise.siren);
  feuille.getCell("C15").value = adresseComplete(entreprise);

  // --- Titre réécrit avec le numéro d'OS (« N°1 » -> « N°2 » si besoin)
  feuille.getCell("A17").value =
    String(feuille.getCell("A17").value || "ORDRE DE SERVICE A L'ENTREPRENEUR N°1")
      .replace(/N°\s*\d*\s*$/, "N°" + (ordre.numero ?? 1));

  // --- Lot et montants (r27-r32)
  feuille.getCell("C27").value = entreprise.lotNom || "";
  feuille.getCell("F28").value = montants.ttc; // TTC (référence, SPEC §3)
  feuille.getCell("F29").value = montants.ht;  // HT « PRO RATA INCLUS »
  feuille.getCell("F30").value = "devis numéro " + (devis.numero || "") + " du " + dateFrancaise(devis.date);

  // --- Dates en série 1904 (gabarit Mac) : « A compter du » et « LE »
  feuille.getCell("F33").value = dateVersSerie1904(ordre.dateDebut);
  feuille.getCell("C41").value = operation.lieuFait || agence.lieuFait || "";
  // C42 « LE: » — arbitrage de conception (SPEC §5, défaut trouvé par le test
  // d'intégration sur les données réelles op-2026-01) : la date de signature
  // appartient à l'ORDRE DE SERVICE (OS[].date, distincte du « A compter du »
  // qui vit en F33), pas à l'opération qui est commune à tous les lots —
  // chaque OS porte sa propre signature (« FAIT À … LE … »). Repli sur
  // operation.faitLe pour les projets plus anciens ; si les deux manquent,
  // cellule VIDE — jamais la date du jour, jamais une date inventée.
  const dateSignature = ordre.date || operation.faitLe || null;
  feuille.getCell("C42").value = dateSignature ? dateVersSerie1904(dateSignature) : null;

  // --- Lignes libres sous « A compter du » (r34-r35) — complément OS SIGNÉ
  // (les documents d’origine) : numéro de lot (« LOTS 18 ») et délais
  // de réalisation (« février mars avril mai 2025 »), restitués SEULEMENT s'ils
  // sont renseignés, tels que sur le document signé (texte libre, sans libellé
  // ajouté ; les cellules B34/B35 du gabarit sont déjà stylées et vides).
  //   - numéro de lot : Entreprise.lotNumero (SPEC §2) — le préfixe « LOTS »
  //     est posé par le générateur, sauf si la donnée le porte déjà ;
  //   - délais de réalisation : Devis.delaisRealisation — CHOIX DOCUMENTÉ :
  //     c'est un engagement contractuel porté par l'OFFRE retenue (il engage le
  //     marché, se répète à l'identique sur tout OS de l'entreprise et reste
  //     réutilisable par le Marché de Travaux) ; il n'est donc pas propre à un
  //     OS et ne vit pas dans Projet.OS[]. js/etat.js doit porter ce
  //     champ optionnel sur le type Devis.
  const numeroLot = entreprise.lotNumero === null || entreprise.lotNumero === undefined
    ? "" : String(entreprise.lotNumero).trim();
  if (numeroLot) {
    feuille.getCell("B34").value = /^lots?\b/i.test(numeroLot) ? numeroLot : "LOTS " + numeroLot;
  }
  const delaisRealisation = devis && devis.delaisRealisation
    ? String(devis.delaisRealisation).trim() : "";
  if (delaisRealisation) feuille.getCell("B35").value = delaisRealisation;

  // --- Format monétaire de l'OS signé : « 468 930,00 € » (deux décimales,
  // séparateurs rendus par la locale FR d'Excel, euro en suffixe). Appliqué aux
  // deux lignes de montants du CLONE produit seulement : le gabarit conserve
  // son format comptable d'origine (référence de mise en page intacte).
  feuille.getCell("F28").numFmt = '#,##0.00" €"';
  feuille.getCell("F29").numFmt = '#,##0.00" €"';

  // --- Formats de DATE français du clone (décision de conception) : le gabarit
  // porte le format intégré 14 (mm-dd-yy, rendu « 04-28-25 ») alors que l'OS
  // signé affiche « 19/02/2025 ». Le clone produit passe en dd/mm/yyyy — une
  // date juste avec un format faux resterait un document faux.
  feuille.getCell("F33").numFmt = "dd/mm/yyyy";
  feuille.getCell("C42").numFmt = "dd/mm/yyyy";
  feuille.getCell("C41").numFmt = "dd/mm/yyyy"; // format hérité, cellule texte (lieu)

  // --- Bloc agence (r43-r45) : TROIS lignes paramétrables (complément OS
  // signé). Sans configuration projet, le gabarit garde ses valeurs d'origine :
  //   F43 = mention « L'agence d'architecture » (agence.titreBloc, optionnel)
  //   F44 = raison sociale complète (agence.raisonSociale, préfixée de la forme
  //        juridique si elle ne la porte pas déjà)
  //   F45 = « Représentée par » + le signataire du projet
  //        (Projet.equipe.architecteSignataire, à défaut agence.representant)
  if (agence.titreBloc) feuille.getCell("F43").value = agence.titreBloc;
  if (agence.raisonSociale) {
    const nomComplet = agence.forme && !String(agence.raisonSociale).startsWith(agence.forme)
      ? agence.forme + " " + agence.raisonSociale
      : agence.raisonSociale;
    feuille.getCell("F44").value = nomComplet;
  }
  const signataire = projet.equipe && projet.equipe.architecteSignataire;
  if (signataire || agence.representant) {
    feuille.getCell("F45").value = "Représentée par " + (signataire || agence.representant);
  }

  // (r38-r39 forclusion, r54+ accusé de réception : rien à faire — fixe. Le
  // lieu, la date et la signature de l'accusé restent à compléter à la main,
  // comme sur l'original signé — le 05/03/2025 à Vendargues sur l'exemple réel.)
}

/* ------------------------------------------------------------------ */
/* Production du classeur final                                        */
/* ------------------------------------------------------------------ */

export function versBlob(tampon) {
  // Le tampon produit par writeBuffer peut venir du royaume vm ; on en extrait
  // des octets « neutres » acceptés par le constructeur Blob.
  let octets;
  if (tampon && typeof tampon === "object" && typeof tampon.byteLength === "number") {
    octets = new Uint8Array(tampon.buffer || tampon, tampon.byteOffset || 0, tampon.byteLength);
  } else {
    octets = new Uint8Array(Array.from(tampon || []));
  }
  return new Blob([octets], { type: MIME_XLSX });
}

async function produireClasseurOS(projet, entreprisesCiblees) {
  const calculs = await chargerCalculs();
  const classeur = await lireGabarit();
  const modele = classeur.getWorksheet("OS");
  if (!modele) throw new Error('Gabarit OS invalide : feuille modèle « OS » absente.');
  for (const entreprise of entreprisesCiblees) {
    const clone = clonerFeuille(classeur, modele, entreprise.raisonSociale || entreprise.id);
    await injecterOS(clone, projet, entreprise, calculs);
  }
  // La feuille modèle quitte le classeur final : il ne reste que les entreprises.
  classeur.removeWorksheet(modele.id);
  classeur.properties.date1904 = true;           // gabarit Mac, SPEC §5
  classeur.calcProperties.fullCalcOnLoad = true; // recalcul des formules conservées
  return versBlob(await classeur.xlsx.writeBuffer());
}

export function entreprisesRetenues(projet) {
  const devisParEntreprise = new Set((projet.devis || []).map((d) => d.entrepriseId));
  return (projet.entreprises || []).filter((e) => devisParEntreprise.has(e.id));
}

// Contrat SPEC §8 : un OS par entreprise.
export async function genererOS(projet, entrepriseId) {
  const entreprise = (projet.entreprises || []).find((e) => e.id === entrepriseId);
  if (!entreprise) {
    throw new Error("Entreprise inconnue dans le projet : " + entrepriseId);
  }
  // SPEC § 6 ter : un OS exige SES prérequis (raison sociale, lot, devis actif avec
  // montants, date d'OS). L'identité partielle (SIREN, adresse, représentant) ne
  // bloque PAS : ces cellules sortent vides, jamais inventées. Le refus est explicite
  // et nomme ce qui manque — l'architecte sait quoi compléter.
  const jugement = etatEntreprise(projet, entrepriseId);
  if (!jugement.osPret) {
    throw new Error("OS impossible : " + (jugement.manquants.length
      ? jugement.manquants.join(" ; ")
      : "état incomplet"));
  }
  return produireClasseurOS(projet, [entreprise]);
}

// Classeur multi-feuilles « 02_OS/ » : une feuille par entreprise RETENUE ET PRÊTE.
//
// SPEC § 6 ter — règle centrale : « une entreprise incomplète ne doit JAMAIS empêcher
// l'émission de l'OS d'une entreprise prête ». Le classeur groupe donc celles qui sont
// mûres et IGNORE les autres, sans échouer sur l'ensemble : les lots non prêts seront
// émis plus tard, au fil des marchés signés.
export async function genererClasseurOS(projet) {
  const retenues = entreprisesRetenues(projet);
  const pretes = retenues.filter((e) => etatEntreprise(projet, e.id).osPret);
  const enAttente = retenues.length - pretes.length;

  if (!pretes.length) {
    const raisons = retenues.map((e) => {
      const j = etatEntreprise(projet, e.id);
      return (e.raisonSociale || e.id) + " (" + (j.manquants.join(", ") || "état incomplet") + ")";
    });
    throw new Error("Aucune entreprise prête pour un ordre de service"
      + (raisons.length ? " - " + raisons.join(" ; ") : " : aucun devis retenu"));
  }
  if (enAttente > 0) {
    // Trace exploitable : le classeur partiel est normal (§ 6 ter), mais il doit être
    // possible de savoir COMBIEN de lots restent à compléter.
    console.info("Classeur OS : " + pretes.length + " entreprise(s) prête(s), "
      + enAttente + " ignorée(s) faute de données complètes (SPEC § 6 ter).");
  }
  return produireClasseurOS(projet, pretes);
}
