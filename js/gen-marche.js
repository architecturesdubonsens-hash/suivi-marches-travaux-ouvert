// js/gen-marche.js — générateur du Marché de Travaux (.docx)
//
// Rôle métier : le Marché de Travaux est le contrat signé entre le maître d'ouvrage
// et CHAQUE entreprise adjudicataire. Le gabarit réel de l'agence
// (le fichier d’origine, Word 97 binaire, CCAP NF P 03-001) a été
// intégralement extrait dans les documents d’origine : la structure de ce
// module calque ce texte article par article (en-tête, 1.1 OBJET, N.B. de
// rétractation L. 231-4 / L. 271-1 et L. 271-2 du CCH, désignation des parties,
// contrôle technique / SPS / géotechnicien / OPC, 13 pièces contractuelles avec
// ordre de prévalence, sous-traitance art. 4.4 CCAG, représentation des parties,
// rendez-vous de chantier, comptes-rendus, rémunération, pénalités, délais,
// travaux modificatifs, hygiène-sécurité, préparation, réception, paiements,
// financement, garantie de paiement, assurances, résiliation, tribunal compétent).
//
// Contrat SPEC §8 : export genererMarche(projet, entrepriseId) -> Promise<Blob> ;
// importe depuis js/calculs.js montantAvecVariantes, montantEnLettres et,
// dès qu'il est exposé (SPEC §3 mise à jour), montantEnLettresMajuscules — source
// unique du rendu gabarit du montant en lettres. Jamais de recalcul local.
//
// Bibliothèque : vendor/docx.umd.js (window.docx), chargée à la demande
// par <script> dynamique dans le navigateur (pattern app-v3/bc-template.js :
// le fichier pèse 725 Ko, le charger à l'ouverture pénaliserait chaque visite),
// par le chargeur UMD (tests/lib/chargeur-umd.mjs) dans Node.

// Import par espace de noms : permet de détecter la PRÉSENCE de
// montantEnLettresMajuscules (SPEC §3, mise à jour : source unique du rendu CCAP)
// sans casser le chargement tant que le module de calcul ne l'expose pas encore. Seuls les
// symboles contractuels sont consommés, jamais réimplémentés de ce côté.
import * as calculs from "./calculs.js";
// SPEC § 6 quater : les documents générés utilisent TOUJOURS le devis ACTIF.
// La règle (statut 'actif' / 'remplace') vit dans js/etat.js : on la consomme, on ne la
// réimplémente pas — un devis remplacé ne doit plus jamais alimenter un marché signé.
import { devisActif } from "./etat.js";
const montantAvecVariantes = calculs.montantAvecVariantes;
const montantEnLettres = calculs.montantEnLettres;

const PRIMAIRE = "1E3A5F"; // charte graphique : bleu marine
const ACCENT = "F97316";   // charte graphique : orange
const POLICE = "Trebuchet MS";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const A4_LARGEUR = 11906;  // twips (A4 portrait)
const A4_HAUTEUR = 16838;
const MARGE_MT = 1418;     // marges du marché, idem gabarit
const LARGEUR_UTILE_MT = A4_LARGEUR - 2 * MARGE_MT; // 9070 twips

// ── Chargement à la demande de la bibliothèque docx ──────────────────────────
let promesseDocx = null;

function chargerDocx() {
  // Navigateur : window.docx déjà présent (ou promesse en cours) → rien à faire.
  if (typeof window !== "undefined" && window.docx) return Promise.resolve(window.docx);
  if (promesseDocx) return promesseDocx;
  promesseDocx = (async function () {
    // Node (tests) : le harnais évalue le bundle UMD dans un contexte vm.
    // L'import dynamique évite de résoudre les modules Node dans le navigateur.
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      const { chargerUMD } = await import("../tests/lib/chargeur-umd.mjs");
      const { fileURLToPath } = await import("node:url");
      const chemin = fileURLToPath(new URL("../vendor/docx.umd.js", import.meta.url));
      // Surcharge d'environnement : quelques globaux que le bundle peut attendre.
      const surcharge = {};
      if (typeof setImmediate !== "undefined") surcharge.setImmediate = setImmediate;
      if (typeof structuredClone !== "undefined") surcharge.structuredClone = structuredClone;
      if (typeof queueMicrotask !== "undefined") surcharge.queueMicrotask = queueMicrotask;
      return chargerUMD(chemin, "docx", surcharge);
    }
    // Navigateur : injection d'un <script> vendor/, motif repris de bc-template.js
    // (la promesse est relâchée en cas d'échec pour qu'un second clic puisse retenter).
    return new Promise(function (resoudre, rejeter) {
      const script = document.createElement("script");
      script.src = "vendor/docx.umd.js";
      script.onload = function () {
        if (window.docx) resoudre(window.docx);
        else { promesseDocx = null; rejeter(new Error("vendor/docx.umd.js chargé mais window.docx absent")); }
      };
      script.onerror = function () { promesseDocx = null; rejeter(new Error("vendor/docx.umd.js introuvable")); };
      document.head.appendChild(script);
    });
  })();
  return promesseDocx;
}

// ── Petits utilitaires de formatage (français, sans dépendance) ─────────────

function formaterMontant(n) {
  // 672000 -> "672 000,00 €" : espace pour les milliers, virgule décimale.
  const valeur = Math.round(Math.abs(Number(n) || 0) * 100) / 100;
  const partieEntiere = Math.floor(valeur);
  const centimes = Math.round((valeur - partieEntiere) * 100);
  const entier = String(partieEntiere).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "-" : "") + entier + "," + String(centimes).padStart(2, "0") + " €";
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

function formaterDateFr(iso) {
  // "2025-04-03" -> "3 avril 2025" ; valeur absente -> date du jour.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (m) return Number(m[3]) + " " + MOIS_FR[Number(m[2]) - 1] + " " + m[1];
  if (iso) return String(iso);
  const aujourdhui = new Date();
  return aujourdhui.getDate() + " " + MOIS_FR[aujourdhui.getMonth()] + " " + aujourdhui.getFullYear();
}

function aireTexte(texte) {
  // Normalisation d'affichage : espaces multiples du gabarit extrait réduits à un seul.
  return String(texte == null ? "" : texte).replace(/\s+/g, " ").trim();
}

// ── Les 13 pièces contractuelles du gabarit (ordre de prévalence) ───────────
// Transcrites depuis les documents d’origine (texte du .doc réel).
const PIECES_CONTRACTUELLES = [
  "Le Marché signé par le Maître d’Ouvrage et l’entreprise retenue",
  "Le Cahier des Clauses Administratives Particulières (C.C.A.P) et son additif éventuel comprenant la désignation de l’entreprise contractante, la définition du type de marché, les formules de révision, les clauses particulières du marché.",
  "Les plans et dessins établis par l’équipe Maître d’œuvre.",
  "Le Cahier des Clauses Techniques Particulières (C.C.T.P) comprenant : les Spécifications Techniques et les descriptions et localisation des ouvrages.",
  "Le calendrier général des travaux.",
  "Le permis de construire.",
  "Le rapport préliminaire du bureau de contrôle, et le rapport de sondage lorsque ce dernier a été commandé par le Maître d’Ouvrage.",
  "Le Cahier des Clauses Administratives Générales (NFP 03.001, modifié décembre 2000) applicables aux travaux de bâtiment faisant l’objet de marchés privés, y compris tout additif ultérieur ; - avec/sans - l’application de l’annexe C relative aux clauses modificatives dans le cas d’un marché à prix global forfaitaire défini.",
  "Le Détail Estimatif des travaux. Seuls les prix unitaires sont contractuels ; ils permettront d’estimer les travaux en plus ou en moins et de décompter s’il y a lieu les travaux au métré.",
  "Les documents techniques, normes françaises, les textes législatifs et administratifs et règlements en vigueur que l’entrepreneur déclare expressément connaître et qui ne sont pas joints au marché.",
  "Les directives, recommandations, prescriptions techniques des services publics concernés ou organismes professionnels compétents.",
  "Le plan général de coordination.",
  "Documents techniques, textes législatifs et administratifs en vigueur."
];

const MATERIAUX_TRADITIONNELS = [
  "- les normes françaises,",
  "- les cahiers des charges, règles de calculs, documents techniques unifiés (D.T.U) et leurs documents annexes."
];
const MATERIAUX_NOUVEAUX = [
  "- les avis techniques délivrés par une Commission Ministérielle publiés par le C.S.T.B.",
  "- les règles techniques d’organismes professionnels tels que SECURITAS, le C.S.T.B, l’U.N.M, TECMAVER, CONTROLTECH, etc.",
  "- les directives communes de l’U.E.T.A.C.",
  "- le cahier des charges des fabricants de matériaux nouveaux."
];

// Clause de rétractation — reproduite du gabarit (L. 231-4, L. 271-1 et L. 271-2 CCH).
const NB_RETRACTATION = "N.B. : lorsqu’il est signé pour la construction d’un immeuble neuf d’habitation, le marché de travaux ne devient définitif qu’au terme d’un délai de 7 jours pendant lequel l’acquéreur non professionnel a la faculté de se rétracter. Le marché est adressé par lettre recommandée avec demande d’avis de réception. La faculté de rétractation est exercée dans ces mêmes formes. (article L 231-4, L 271-1 et L 271-2 du CCH)";

const SOUS_TRAITANCE_CCAG = "Conformément à l’article 4.4 du CCAG, l’entrepreneur qui sous-traite l’exécution de certaines parties de son marché doit adresser au maître d’ouvrage sa demande de sous-traitance par lettre recommandée avec avis de réception ou la remettre contre reçu. Si le maître d’ouvrage n’a pas répondu à cette demande dans un délai de quinze jours à compter de sa réception, l’acceptation et l’agrément des conditions de paiement du sous-traitant sont réputés acquis.";

// ── Fabriques d'éléments docx (inspirées du pattern bc-template.js) ─────────

function fabriques(docx, largeurUtile) {
  function run(texte, opts) {
    const o = opts || {};
    return new docx.TextRun({
      text: texte, bold: !!o.bold, italics: !!o.italics,
      size: o.size || 20, color: o.color || "000000", font: POLICE
    });
  }
  function para(children, opts) {
    const o = opts || {};
    return new docx.Paragraph({
      children: children,
      alignment: o.align || docx.AlignmentType.JUSTIFIED,
      spacing: { before: o.avant == null ? 60 : o.avant, after: o.apres == null ? 60 : o.apres },
      indent: o.indent,
      tabStops: o.tabs
    });
  }
  function corps(texte, opts) { return para([run(texte, opts)], opts); }
  // Titre de rubrique (rémunération, pénalités...) : majuscules du gabarit, bleu marine.
  function rubrique(texte) {
    return new docx.Paragraph({
      children: [run(texte, { bold: true, size: 22, color: PRIMAIRE })],
      spacing: { before: 300, after: 100 }, keepNext: true
    });
  }
  function sousRubrique(texte) {
    return new docx.Paragraph({
      children: [run(texte, { bold: true, size: 20, color: PRIMAIRE })],
      spacing: { before: 180, after: 80 }, keepNext: true
    });
  }
  function itemListe(texte) {
    return para([run("–  " + texte)], { indent: { left: 480, hanging: 240 }, align: docx.AlignmentType.LEFT });
  }
  // Tableau simple à largeurs fixes (colonnes en twips), texte 9 pt lisible à l'impression.
  function tableau(entetes, lignes, largeurs, opts) {
    const o = opts || {};
    const bordFin = { style: docx.BorderStyle.SINGLE, size: 2, color: "8A99B3" };
    const lignesDocx = [];
    if (entetes) {
      lignesDocx.push(new docx.TableRow({
        tableHeader: true,
        children: entetes.map(function (h, i) {
          return new docx.TableCell({
            width: { size: largeurs[i], type: docx.WidthType.DXA },
            shading: { type: docx.ShadingType.CLEAR, fill: "DCE4F2" },
            margins: { top: 60, bottom: 60, left: 90, right: 90 },
            children: [para([run(h, { bold: true, size: 16, color: PRIMAIRE })], { align: docx.AlignmentType.LEFT, avant: 0, apres: 0 })]
          });
        })
      }));
    }
    lignes.forEach(function (ligne) {
      lignesDocx.push(new docx.TableRow({
        children: ligne.map(function (cellule, i) {
          const c = typeof cellule === "object" && cellule !== null ? cellule : { texte: cellule };
          return new docx.TableCell({
            width: { size: largeurs[i], type: docx.WidthType.DXA },
            margins: { top: 50, bottom: 50, left: 90, right: 90 },
            children: [para([run(c.texte, { bold: !!c.bold, size: c.size || 16 })],
              { align: c.align || docx.AlignmentType.LEFT, avant: 0, apres: 0 })]
          });
        })
      }));
    });
    return new docx.Table({
      layout: docx.TableLayoutType.FIXED,
      width: { size: largeurUtile, type: docx.WidthType.DXA },
      rows: lignesDocx,
      borders: {
        top: bordFin, bottom: bordFin, left: bordFin, right: bordFin,
        insideHorizontal: bordFin, insideVertical: bordFin
      }
    });
  }
  return { run: run, para: para, corps: corps, rubrique: rubrique, sousRubrique: sousRubrique, item: itemListe, tableau: tableau };
}

// En-tête et pied de page — charte graphique de l'outil (nom de l'agence à
// gauche, titre du document à droite, filet orange sous la référence
// d'opération, pagination en pied).
function entetePied(docx, titrePage, referenceOperation, intituleOperation, largeurUtile, nomAgence) {
  return {
    headers: {
      default: new docx.Header({
        children: [
          new docx.Paragraph({
            tabStops: [{ type: docx.TabStopType.RIGHT, position: largeurUtile }],
            children: [
              new docx.TextRun({ text: String(nomAgence || "").toUpperCase(), bold: true, size: 24, color: PRIMAIRE, font: POLICE }),
              new docx.TextRun({ text: "\t" + titrePage, bold: true, size: 16, color: PRIMAIRE, font: POLICE })
            ]
          }),
          new docx.Paragraph({
            border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: ACCENT } },
            spacing: { after: 120 },
            children: [new docx.TextRun({
              text: referenceOperation + " — " + intituleOperation,
              bold: true, size: 16, color: PRIMAIRE, font: POLICE
            })]
          })
        ]
      })
    },
    footers: {
      default: new docx.Footer({
        children: [
          new docx.Paragraph({
            border: { top: { style: docx.BorderStyle.SINGLE, size: 4, color: ACCENT, space: 10 } },
            alignment: docx.AlignmentType.CENTER,
            spacing: { before: 120 },
            children: [
              new docx.TextRun({ text: (nomAgence ? nomAgence + " — " : "") + "Page ", size: 13, color: "666666", font: POLICE }),
              new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 13, color: "666666", font: POLICE }),
              new docx.TextRun({ text: " / ", size: 13, color: "666666", font: POLICE }),
              new docx.TextRun({ children: [docx.PageNumber.TOTAL_PAGES], size: 13, color: "666666", font: POLICE })
            ]
          })
        ]
      })
    }
  };
}

// Bloc « désignation d'une partie » du gabarit : raison sociale, représentant,
// adresse, identifiants — chaque ligne du .doc réel reprise telle quelle.
function blocPartie(F, docx, lignes) {
  return lignes.map(function (l) { return F.corps(l, { align: docx.AlignmentType.LEFT }); });
}

// ── Corps du marché ─────────────────────────────────────────────────────────

function construireEnfants(docx, projet, entreprise, devis, montant, lettres) {
  const F = fabriques(docx, LARGEUR_UTILE_MT);
  const op = projet.operation || {};
  const mo = projet.maitreOuvrage || {};
  const ag = projet.agence || {};
  const marche = projet.marche || {};
  const enfants = [];

  // En-tête du document (dans le corps, conformément au gabarit).
  enfants.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER, spacing: { after: 60 },
    children: [F.run("MARCHE TRAVAUX PRIVÉS", { bold: true, size: 32, color: PRIMAIRE })]
  }));
  enfants.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER, spacing: { after: 240 },
    children: [F.run("Modèle de Cahier des clauses administratives particulières (CCAP)", { bold: true, size: 20 })]
  }));
  // Identification de l'opération dans le corps du document : le gabarit réel la
  // porte en en-tête de page (« OP-2026-01 - AMENAGEMENT ... / MARCHÉ DE TRAVAUX - »),
  // elle est reprise ici pour que la première page s'identifie seule.
  enfants.push(F.corps("Opération : " + (op.reference ? op.reference + " — " : "") + aireTexte(op.intitule || ""), { bold: true }));

  // ── LE MARCHE / 1.1 OBJET ──
  enfants.push(F.rubrique("LE MARCHE"));
  enfants.push(F.sousRubrique("1.1 OBJET"));
  enfants.push(F.corps("Nature des travaux : " + aireTexte(op.intitule)));
  enfants.push(F.corps("Lieu de construction : " + aireTexte(
    [op.adresse ? op.adresse + " - " : "", [op.cp, op.ville].filter(Boolean).join(" ")].join("")
  )));
  enfants.push(F.corps("Lot : " + [entreprise.lotNumero, entreprise.lotNom].filter(Boolean).join(" - ")));
  enfants.push(F.corps(NB_RETRACTATION, { italics: true }));

  // ── Désignation des parties ──
  enfants.push(F.sousRubrique("Désignation des parties"));
  enfants.push(F.corps("Ce marché est conclu entre :"));
  blocPartie(F, docx, [
    aireTexte([mo.forme, mo.raisonSociale].filter(Boolean).join(" ")),
    "REPRESENTÉE PAR : " + aireTexte([mo.representant, mo.qualiteRepresentant ? "(" + mo.qualiteRepresentant + ")" : ""].filter(Boolean).join(" ")),
    "DOMICILIÉE : " + aireTexte([mo.adresse, mo.cp, mo.ville].filter(Boolean).join(" - ")),
    mo.siren ? "SIREN : " + mo.siren : "",
    mo.siret ? "SIRET : " + mo.siret : ""
  ].filter(Boolean)).forEach(function (p) { enfants.push(p); });
  enfants.push(F.corps("désigné ci-après le Maître d’Ouvrage"));
  enfants.push(F.corps("assisté de :"));
  blocPartie(F, docx, [
    aireTexte([ag.forme, ag.raisonSociale].filter(Boolean).join(" ")),
    "REPRESENTÉE PAR : " + aireTexte(ag.representant || ""),
    "DOMICILIÉE : " + aireTexte([ag.adresse, ag.cp, ag.ville].filter(Boolean).join(" - ")),
    ag.siren ? "SIREN : " + ag.siren : "",
    ag.tel ? "TEL : " + ag.tel : "",
    "CHARGÉE D’UNE MISSION DE BASE AU SENS DE LA LOI M.O.P."
  ].filter(Boolean)).forEach(function (p) { enfants.push(p); });
  enfants.push(F.corps("Et"));
  blocPartie(F, docx, [
    aireTexte([entreprise.forme, entreprise.raisonSociale].filter(Boolean).join(" ")),
    "REPRESENTÉE PAR : " + aireTexte([entreprise.representant, entreprise.qualiteRepresentant ? "(" + entreprise.qualiteRepresentant + ")" : ""].filter(Boolean).join(" ")),
    "DOMICILIÉE : " + aireTexte([entreprise.adresse, entreprise.cp, entreprise.ville].filter(Boolean).join(" - ")),
    entreprise.siren ? "SIREN : " + entreprise.siren : "",
    entreprise.siret ? "SIRET : " + entreprise.siret : ""
  ].filter(Boolean)).forEach(function (p) { enfants.push(p); });
  enfants.push(F.corps("désigné ci-après l’entrepreneur"));

  // ── Intervenants de chantier (contrôle technique, SPS, géotechnicien, OPC) ──
  // Données optionnelles : projet.marche = { controleTechnique, sps, geotechnicien, opc }
  // avec { organisme, contact, adresse, tel, email }. À défaut, lignes pointillées
  // à compléter à la main, ou mention du gabarit quand la mission n'existe pas.
  function blocIntervenant(titre, phrase, donnees, suffixe) {
    enfants.push(F.sousRubrique(titre));
    enfants.push(F.corps(phrase));
    if (donnees) {
      blocPartie(F, docx, [
        aireTexte(donnees.organisme || ""),
        aireTexte(donnees.contact || ""),
        aireTexte(donnees.adresse || ""),
        donnees.tel ? "TEL : " + donnees.tel : "",
        donnees.email ? "E-mail : " + donnees.email : ""
      ].filter(Boolean)).forEach(function (p) { enfants.push(p); });
    } else {
      enfants.push(F.corps("................................................................................................................."));
    }
    if (suffixe) enfants.push(F.corps(suffixe));
  }
  blocIntervenant("Contrôle technique", "La mission de contrôle technique est assurée par :",
    marche.controleTechnique, "chargé de la maîtrise d’œuvre de chantier.");
  blocIntervenant("Coordination Sécurité",
    "La coordination en matière de sécurité et de protection de la santé est assurée par :",
    marche.sps, "chargé de la maîtrise d’œuvre de chantier.");
  enfants.push(F.sousRubrique("Géotechnicien"));
  enfants.push(F.corps(marche.geotechnicien || "Pas d’étude géotechnique sur ce projet."));
  enfants.push(F.sousRubrique("Coordination de chantier OPC"));
  enfants.push(F.corps(marche.opc || "Pas de mission O.P.C. sur ce projet."));

  // ── Documents constituant le marché (13 pièces, ordre de prévalence) ──
  enfants.push(F.sousRubrique("Documents constituant le marché"));
  enfants.push(F.corps("Les pièces contractuelles qui constituent le marché prévalent les une contre les autres dans l'ordre suivant : (en cas de contradiction entre elles, la pièce portant le numéro le plus faible prévaut sur les autres.)"));
  PIECES_CONTRACTUELLES.forEach(function (piece, i) {
    enfants.push(F.para([F.run((i + 1) + "  " + piece)], { align: docx.AlignmentType.LEFT, indent: { left: 360, hanging: 360 } }));
  });
  enfants.push(F.corps("A. Pour les matériaux traditionnels :"));
  MATERIAUX_TRADITIONNELS.forEach(function (l) { enfants.push(F.item(l)); });
  enfants.push(F.corps("B. Pour les éléments, produits et ensembles nouveaux :"));
  MATERIAUX_NOUVEAUX.forEach(function (l) { enfants.push(F.item(l)); });
  enfants.push(F.corps("Les documents applicables sont ceux dont le mois de prise d'effet est antérieur de deux mois à celui du lancement de la consultation (cf. CCAG art. 04.1.3), à l'exception des règlements applicables dès leur parution."));

  // ── Sous-traitance (art. 4.4 CCAG) ──
  enfants.push(F.sousRubrique("Sous-traitance"));
  enfants.push(F.corps(SOUS_TRAITANCE_CCAG));

  // ── Représentation des parties / RDV de chantier / comptes-rendus ──
  enfants.push(F.rubrique("REPRESENTATION DES PARTIES – COMMUNICATION ENTRE ELLES"));
  enfants.push(F.sousRubrique("Présence aux rendez-vous de chantier"));
  enfants.push(F.corps("L’entrepreneur ou le mandataire commun ou le représentant unique est tenu d’assister aux rendez-vous de chantier provoqués par le maître d’œuvre ou d’y déléguer un agent qui a pouvoir pour donner sur le champ les ordres nécessaires sur le chantier."));
  enfants.push(F.corps("Le maître d’œuvre détermine en début de travaux le rythme des rendez-vous de chantier."));
  enfants.push(F.corps("Le programme de participation de l’entrepreneur aux rendez-vous de chantier doit tenir compte du montant et de la nature des travaux."));
  enfants.push(F.sousRubrique("Comptes-rendus"));
  enfants.push(F.corps("Les prescriptions contenues dans les comptes-rendus de réunions de chantier sont applicables sauf contestation écrite de la part de l’entrepreneur dans un délai de 5 jours à compter de leur réception, par dérogation à l’article 15-2-1 du CCAG."));
  enfants.push(F.corps("Les comptes-rendus sont transmis soit par lettre, soit par télécopie, soit par courriel."));

  // ── RÉMUNÉRATION : montant en chiffres ET en toutes lettres ──
  enfants.push(F.rubrique("REMUNERATION"));
  enfants.push(F.sousRubrique("Prix du marché"));
  enfants.push(F.corps("Le marché est passé à prix global, forfaitaire, ferme et non actualisable, comprenant le compte pro-rata de :"));
  const ligneMontant = function (label, valeur) {
    return new docx.Paragraph({
      tabStops: [{ type: docx.TabStopType.RIGHT, position: LARGEUR_UTILE_MT }],
      spacing: { before: 40, after: 40 },
      children: [F.run(label), F.run("\t" + formaterMontant(valeur), { bold: true })]
    });
  };
  enfants.push(ligneMontant("HORS TAXES", montant.ht));
  enfants.push(ligneMontant("TVA 20 %", montant.tva));
  enfants.push(ligneMontant("T.T.C", montant.ttc));
  // Retranscription littérale : obligatoire pour le CCAP (cahier des charges, § B).
  // SPEC §3 (mise à jour) : le gabarit réel porte « Soit en lettres : TTC SIX CENT
  // SOIXANTE MILLE EUROS ET 00 CTS**** » — montantEnLettresMajuscules(n) en est la
  // SOURCE UNIQUE : consommé TEL QUEL dès qu'il est exposé par js/calculs.js,
  // sans reformatage local. Le filet ci-dessous ne sert qu'en attendant l'export.
  let lettresAffichees;
  if (typeof calculs.montantEnLettresMajuscules === "function") {
    lettresAffichees = String(calculs.montantEnLettresMajuscules(montant.ttc));
  } else {
    lettresAffichees = String(lettres).toUpperCase();
    if (lettresAffichees.indexOf("CENTIME") < 0) {
      const centimes = Math.round((montant.ttc - Math.floor(montant.ttc)) * 100);
      lettresAffichees += " ET " + String(centimes).padStart(2, "0") + " CTS";
    }
    lettresAffichees += "****";
  }
  enfants.push(F.corps("Soit en lettres TTC : " + lettresAffichees, { bold: true }));
  if ((devis.variantes || []).length > 0) {
    enfants.push(F.corps("Variantes et options retenues au devis :"));
    devis.variantes.forEach(function (v) {
      const sens = v.sens === "plus" ? "plus-value" : (v.sens === "moins" ? "moins-value" : "option");
      enfants.push(F.item(sens + " : " + aireTexte(v.libelle) + " — " + formaterMontant(v.ht) + " HT" + (v.retenue ? " (retenue)" : " (non retenue)")));
    });
  }
  enfants.push(F.corps("L’entrepreneur reconnaît formellement que les prix figurant au présent marché, qu’il s’agisse de prix forfaitaires globaux ou de prix unitaires des bordereaux, tiennent compte :"));
  enfants.push(F.item("de toutes les prescriptions, garanties, sujétions et obligations résultant de ce marché, y compris les impôts, taxes et redevances de toute nature existant à la date de la signature de l’acte d’engagement."));
  enfants.push(F.item("de toutes les charges et de tous les aléas pouvant résulter de l’exécution des travaux notamment des circonstances locales, de la situation géographique du chantier (frais de transport du personnel, du matériel et des matériaux, indemnité de déplacement et de panier, surveillance du chantier, etc….)"));
  enfants.push(F.item("du bénéfice de l’entrepreneur."));
  enfants.push(F.corps("La rémunération des travaux modificatifs acceptés par le maître d’ouvrage tient compte des mêmes éléments."));

  // ── PÉNALITÉS ──
  enfants.push(F.rubrique("PENALITES"));
  enfants.push(F.sousRubrique("Pénalités de retard à l’entreprise"));
  enfants.push(F.corps("En dérogation des articles 9.5 et 9.6 de la NF P 03-001, il sera appliqué les pénalités suivantes."));
  enfants.push(F.corps("En cas de dépassement du délai contractuel, mais aussi en cas de dépassement des délais partiels par rapport au calendrier d'exécution, il sera appliqué une pénalité fixée à " + formaterMontant((projet.penalites && projet.penalites.tauxJournalier) || 250) + " par jour calendaire TTC."));
  enfants.push(F.corps("Elles sont applicables sans mise en demeure préalable sur simple confrontation des dates réelles et prévisionnelles en fin de travaux."));
  enfants.push(F.corps("En cas de force majeure, l'entrepreneur est tenu d'en aviser le Maître de l’ouvrage dans un délai de 48 h par lettre recommandée."));
  enfants.push(F.corps("Le Maître de l’ouvrage se réserve le droit de rechercher la responsabilité de l'entrepreneur pour le préjudice qu'il pourrait subir du fait de ce retard."));
  enfants.push(F.sousRubrique("Retenues en cours de travaux"));
  enfants.push(F.corps("En cas de constat par le maître d’œuvre de retards partiels en cours d’exécution des travaux, une retenue, dont le montant est égale à la pénalité définie ci-avant, est appliquée sur la situation de la période où a été constaté le retard."));
  enfants.push(F.corps("Les sommes ainsi retenues sont reversées à l’entrepreneur, en fin de travaux, s’il a respecté le délai global d’exécution. Sinon, ces retenues deviennent des pénalités de retard définitives."));
  enfants.push(F.sousRubrique("Absences à une réunion"));
  enfants.push(F.corps("Toute absence non explicitée par un motif sérieux de l’entrepreneur à une réunion de chantier à laquelle il aura été dûment convoqué sera passible de l’application d’une pénalité forfaitaire de 100 Euros TTC."));
  enfants.push(F.sousRubrique("Retard dans la remise des documents"));
  enfants.push(F.corps("Tout retard dans la remise des documents par rapport aux délais prescrits par l’article 7.4 du CCAG (procès verbaux de matériaux, plans d’exécution, notes de calcul, etc…) sera passible d’une pénalité de 100 euros TTC par jour calendaire de retard."));
  enfants.push(F.sousRubrique("Pénalités de retard à la maîtrise d’ouvrage pour défaut de paiement"));
  enfants.push(F.corps("La pénalité prévue par le présent marché pour non paiement de la situation à date contractuelle est fixée à 150 € TTC du montant TTC du marché par jour calendaire de retard, plafonnée à " + Math.round(((projet.penalites && projet.penalites.montantMaxPct) || 5) * 100) / 100 + " % du marché HT."));

  // ── DÉLAIS ──
  enfants.push(F.rubrique("DELAIS"));
  enfants.push(F.sousRubrique("Calendrier prévisionnel général d’exécution"));
  enfants.push(F.corps("Le délai global d’exécution de l’ensemble des lots est fixé dans l’acte d’engagement :"));
  enfants.push(F.item("Il est établi en tenant compte de 10 jours d’intempéries prévisibles."));
  enfants.push(F.item("Il tient compte des périodes de congés payés."));
  enfants.push(F.item("Il ne tient pas compte de la période de préparation prévue à l’acte d’engagement par dérogation au CCAG."));
  enfants.push(F.corps("Les délais d’exécution de chaque lot s’inscrivent dans le délai global d’exécution conformément au calendrier prévisionnel général d’exécution. Ils partent de la première intervention de l’entrepreneur sur le chantier et expirent en même temps que sa dernière intervention."));
  enfants.push(F.sousRubrique("Calendrier détaillé d’exécution"));
  enfants.push(F.corps("Le calendrier détaillé d’exécution distingue les différents ouvrages ou groupes d’ouvrages dont la construction fait l’objet des travaux. Il indique en outre, pour chacun des lots, la durée et la date probable de départ des délais particuliers correspondant aux interventions successives de l’entrepreneur sur le chantier."));
  enfants.push(F.corps("Il est établi par le maître d’œuvre en concertation avec les entrepreneurs pendant la période de préparation du chantier."));
  enfants.push(F.corps("Il doit s’inscrire dans les limites du calendrier prévisionnel général d’exécution. A défaut d’accord sur le calendrier détaillé, le calendrier prévisionnel devient contractuel."));

  // ── TRAVAUX MODIFICATIFS ──
  enfants.push(F.rubrique("TRAVAUX MODIFICATIFS"));
  enfants.push(F.corps("Si les travaux modificatifs sont assimilables à des ouvrages prévus au marché, ils seront réglés en utilisant les prix unitaires figurant dans la DPGF, dans le cas contraire, ils seront réglés sur la base de prix nouveaux à déterminer avant exécution à partir des mêmes bases que celles de la DPGF."));
  enfants.push(F.corps("Tout travaux modificatifs, provenant de la maîtrise d’ouvrage, assimilables ou non à des ouvrages prévus dans le marché, et entraînant une augmentation de 5 % du montant d’un marché d’entreprise rendra le calendrier global d’exécution nul."));

  // ── HYGIÈNE / SÉCURITÉ ──
  enfants.push(F.rubrique("HYGIENE SECURITE PROTECTION DE LA SANTE"));
  enfants.push(F.corps("Les obligations de l’entrepreneur sont définies à l’article 5 du CCAG."));

  // ── DÉFENSE D'INTÉRÊT COMMUN ──
  enfants.push(F.rubrique("DEFENSE D’INTERET COMMUN – COMPTE PRORATA"));
  enfants.push(F.corps("Les dispositions de l’article 14 du CCAG s’appliquent."));

  // ── PRÉPARATION DE L'EXÉCUTION ──
  enfants.push(F.rubrique("PREPARATION DE L’EXECUTION"));
  enfants.push(F.sousRubrique("Période de préparation – programme d’exécution des travaux"));
  enfants.push(F.corps("Une période de préparation de 30 jours est prévue à compter de la notification du marché et préalablement à la délivrance de l’ordre de service de démarrage des travaux signé par le maître d’ouvrage."));
  enfants.push(F.corps("Durant cette période, l’entrepreneur, y compris ses sous-traitants, devra établir et présenter au visa du maître d’œuvre les documents d’exécution des travaux."));
  enfants.push(F.sousRubrique("Plans d’exécution – notes de calcul – études de détail"));
  enfants.push(F.corps("L’entrepreneur établira ou fera établir s’il y a lieu, par les entreprises spécialisées, tous dessins d’exécution, calepins, épures, tracés, détails, ainsi que toute note de calcul, notes explicatives et notes justificatives nécessaires à l’exécution des travaux."));
  enfants.push(F.corps("Le maître d’œuvre dispose d’un délai de quinze jours pour donner son accord ou formuler ses observations."));
  enfants.push(F.sousRubrique("Implantation"));
  enfants.push(F.corps("Le piquetage général de la construction est assuré par le lot n° 1 Gros-œuvre."));

  // ── RÉCEPTION ──
  enfants.push(F.rubrique("RECEPTION"));
  enfants.push(F.sousRubrique("Réception"));
  enfants.push(F.corps("La réception a lieu à l’achèvement de l’ensemble des travaux."));
  enfants.push(F.corps("L’entrepreneur chargé d’aviser le maître d’ouvrage et le maître d’œuvre de la date à laquelle ces travaux sont considérés comme achevés est l’entrepreneur titulaire du lot n° 1 Gros-œuvre."));
  enfants.push(F.corps("Chaque entrepreneur est tenu d’aviser le maître d’ouvrage et le maître d’œuvre de la date à laquelle l’ensemble de ses travaux est achevé."));
  enfants.push(F.corps("Postérieurement à cette information, la procédure de réception se déroule, simultanément pour tous les lots considérés, comme il est stipulé à l’article 17 du CCAG."));
  enfants.push(F.sousRubrique("Levée des réserves"));
  enfants.push(F.corps("Lorsque les procès-verbaux de réception font état de réserves, par dérogation à l’article 17-2-5, l’entrepreneur dispose d’un délai fixé au procès-verbal de réception pour reprendre les travaux concernés."));

  // ── CONSTATATION DES DROITS À PAIEMENT (situations au 25, RG 5 %) ──
  enfants.push(F.rubrique("CONSTATATION DES DROITS A PAIEMENT"));
  enfants.push(F.sousRubrique("Etat de situation"));
  enfants.push(F.corps("L’entrepreneur remet chaque mois au maître d’œuvre un état de situation."));
  enfants.push(F.corps("Cet état d’acompte est présenté sous forme cumulative de l’avancement des travaux en 3 exemplaires originaux à l’architecte."));
  enfants.push(F.sousRubrique("Paiements"));
  enfants.push(F.corps("Acomptes : par chèque ou virement à 45 jours après réception de la facture, à compter de la remise de l’état de situation au maître d’œuvre, les acomptes sont payés à l’entrepreneur et, s’il y a sous-traitance et délégation, au sous-traitant."));
  enfants.push(F.corps("Toutes les demandes de paiement seront adressées en triple exemplaire au Maître d’œuvre ou son mandataire qui établira le « bon à payer », libellées au nom de l’Entreprise."));
  enfants.push(F.corps("La situation correspondant aux travaux exécutés en cours de mois sera établie le 25 et adressée pour la fin du mois au Maître d’œuvre pour validation, qui la transmettra ensuite au Maître d’Ouvrage ou son mandataire le mois suivant pour règlement. Le non-respect du présent calendaire, par l’Entreprise, peut entraîner un décalage du règlement pour le mois suivant."));
  enfants.push(F.corps("Solde : dans les 45 jours après l’expiration du délai défini à l’article 19.6.2 du CCAG pour la signification du décompte définitif, est dû le paiement du solde, amputé de la retenue de garantie constituée comme il est dit à l’article 20.5 du CCAG."));
  enfants.push(F.sousRubrique("Retenue de garantie"));
  enfants.push(F.corps("Elle correspond à " + Math.round(((projet.retenueGarantieTaux == null ? 0.05 : projet.retenueGarantieTaux)) * 10000) / 100 + " % du montant HT des travaux (le montant de cette retenue est égale à 5 % à moins que le CCAP n’en dispose autrement)."));
  enfants.push(F.corps("Elle est consignée entre les mains du maître d’ouvrage, sauf présentation d’une caution par l’entrepreneur."));
  enfants.push(F.corps("La caution est libérée ou les sommes consignées sont versées à l’entrepreneur dans un délai de 12 mois à compter de la date de réception (au plus tard à l’expiration du délai d’une année à compter de la date de réception faite avec ou sans réserves)."));
  enfants.push(F.sousRubrique("Intérêts moratoires"));
  enfants.push(F.corps("Après mise en demeure par lettre recommandée avec avis de réception, les retards de paiement ouvrent droit, pour l’entrepreneur, au paiement d’intérêts moratoires à un taux qui sera le taux d’intérêt légal augmenté de 7 points."));

  // ── FINANCEMENT / GARANTIE DE PAIEMENT ──
  enfants.push(F.rubrique("LE FINANCEMENT"));
  enfants.push(F.corps("Dans le cas où le maître d’ouvrage entend acquitter le prix en totalité ou en partie au moyen d’un prêt, les dispositions suivantes sont applicables."));
  enfants.push(F.sousRubrique("Le montant de l’opération ne dépasse pas 21 500 euros TTC"));
  enfants.push(F.corps("L’engagement du maître d’ouvrage au titre du présent marché est subordonné à l’acceptation par lui de l’offre du prêteur et à la non rétractation de cette acceptation dans les 7 jours qui suivent."));
  enfants.push(F.corps("Le maître d’ouvrage s’engage à informer par écrit l’entrepreneur dans un délai de 3 jours suivant l’expiration du délai de rétractation, de l’attribution définitive du prêt."));
  enfants.push(F.corps("En tout état de cause, la durée de validité de l’offre de l’entrepreneur est limitée à 90 jours à compter de la date figurant sur le présent marché."));
  enfants.push(F.sousRubrique("Le montant des travaux dépasse 21 500 euros TTC"));
  enfants.push(F.corps("Le marché est conclu sous la condition suspensive d’obtention du prêt sollicité dans un délai de 10 jours à compter de la date figurant sur le présent marché (au moins un mois)."));
  enfants.push(F.corps("Le maître d’ouvrage s’engage à informer, par écrit, l’entrepreneur de l’obtention du prêt sollicité au plus tard dans les 3 jours suivant l’expiration du délai indiqué ci-dessus."));
  enfants.push(F.rubrique("GARANTIE DE PAIEMENT"));
  enfants.push(F.corps("Conformément aux dispositions de l’article 1799-1 du code civil, rappelées dans l’article 20.9 du CCAG, le maître d’ouvrage doit garantir le paiement des sommes dues à l’entrepreneur lorsque le montant des travaux, déduction faite de l’acompte versé à la commande, est supérieur à 12 000 euros HT."));
  enfants.push(F.corps("Cette garantie peut prendre deux formes : le paiement direct par l’établissement de crédit lorsque les travaux sont entièrement financés par un crédit spécifique, ou la garantie conventionnelle ou le cautionnement solidaire lorsque le maître d’ouvrage ne recourt pas à un crédit spécifique ou lorsqu’il y recourt partiellement."));

  // ── ASSURANCES / RÉSILIATION ──
  enfants.push(F.rubrique("ASSURANCES"));
  enfants.push(F.corps("Avant tout commencement d’exécution, l’entrepreneur ainsi que les co-traitants doivent justifier qu’ils sont assurés."));
  enfants.push(F.corps("L’attestation de la compagnie d’assurance portant mention de l’étendue de la garantie est jointe au présent marché."));
  enfants.push(F.rubrique("RESILIATION"));
  enfants.push(F.corps("Le marché peut être résilié dans les conditions et formes définies à l’article 22 du CCAG."));

  // ── SOUS-TRAITANCE (dossier d'agrément) ──
  enfants.push(F.rubrique("SOUS TRAITANCE"));
  enfants.push(F.corps("Dans le cas où une quelconque partie des travaux du présent marché serait sous-traitée par le titulaire du marché, celui-ci devra, avant toute intervention du sous-traitant sur le chantier, présenter un dossier d’agrément du sous-traitant au Maître d’Ouvrage."));
  enfants.push(F.corps("Ce dossier comportera obligatoirement :"));
  enfants.push(F.item("Certificats d’assurances civile et décennale du sous-traitant,"));
  enfants.push(F.item("Certificats de qualification du sous-traitant,"));
  enfants.push(F.item("Demande d’acceptation du sous-traitant par l’Entreprise titulaire du marché indiquant : la nature des prestations sous-traitées ; le nom, la raison ou dénomination sociale, l’adresse du sous-traitant ; le montant et la définition technique des prestations sous-traitées."));
  enfants.push(F.item("Demande d’agrément des conditions de paiement du sous-traitant indiquant : les délais ; les échéanciers ; les modalités de révision éventuelles."));

  // ── TRIBUNAL COMPÉTENT ──
  enfants.push(F.rubrique("TRIBUNAL COMPETENT"));
  enfants.push(F.corps("Les litiges sont portés devant les tribunaux du lieu d’exécution des travaux."));

  // ── Clôture : « Fait à ... le ... en 3 originaux » + signatures ──
  enfants.push(new docx.Paragraph({
    spacing: { before: 400, after: 200 },
    children: [F.run("Fait à " + aireTexte(op.lieuFait || "") + " le " + formaterDateFr(op.faitLe) + " en 3 originaux", { bold: true })]
  }));
  enfants.push(F.tableau(null, [
    ["Signature du Maître d’ouvrage", { texte: "Signature de l’Entrepreneur", align: docx.AlignmentType.RIGHT }],
    ["Le Maître d’Ouvrage : " + aireTexte([mo.forme, mo.raisonSociale].filter(Boolean).join(" ")),
      { texte: "L’Entrepreneur : " + aireTexte([entreprise.forme, entreprise.raisonSociale].filter(Boolean).join(" ")), align: docx.AlignmentType.RIGHT }]
  ], [LARGEUR_UTILE_MT / 2, LARGEUR_UTILE_MT / 2]));
  enfants.push(F.corps(""));
  enfants.push(F.corps("Le                                Le"));

  return enfants;
}

// ── Export contractuel (SPEC §8) ────────────────────────────────────────────
// genererMarche(projet, entrepriseId) -> Promise<Blob>
// Un marché par entreprise retenue : le lot, le devis et le montant de cette
// entreprise sont injectés dans le gabarit CCAP de l'agence.

export async function genererMarche(projet, entrepriseId) {
  if (!projet) throw new Error("genererMarche : projet manquant");
  const entreprise = (projet.entreprises || []).find(function (e) { return e.id === entrepriseId; });
  if (!entreprise) throw new Error("genererMarche : entreprise introuvable pour l'identifiant « " + entrepriseId + " »");
  // Convention : un seul devis retenu par entreprise ; en cas de plusieurs dépôts,
  // le premier enregistré fait foi (les suivants sont des rectificatifs gérés par avenant).
  const devis = devisActif(projet, entrepriseId);
  if (!devis) {
    throw new Error("genererMarche : aucun devis ACTIF pour l'entreprise « " + entreprise.raisonSociale + " » — le marché ne peut pas être établi");
  }
  // Montant contractuel : JAMAIS de recalcul local, la règle de calcul appartient
  // à js/calculs.js (variantes plus/moins/options, TVA, arrondis).
  const montant = montantAvecVariantes(devis);
  const lettres = montantEnLettres(montant.ttc);

  const docx = await chargerDocx();
  const op = projet.operation || {};
  const titrePage = "MARCHÉ DE TRAVAUX — CCAP NF P 03-001";
  const intitule = aireTexte(op.intitule || "");
  const enTete = entetePied(docx, titrePage, op.reference || "", intitule, LARGEUR_UTILE_MT, (projet.agence || {}).raisonSociale);

  const document = new docx.Document({
    styles: {
      default: {
        document: {
          run: { font: POLICE, size: 20, color: "000000" },
          paragraph: { spacing: { before: 60, after: 60 }, alignment: docx.AlignmentType.JUSTIFIED }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: A4_LARGEUR, height: A4_HAUTEUR },
          margin: { top: MARGE_MT, bottom: MARGE_MT, left: MARGE_MT, right: MARGE_MT }
        }
      },
      headers: enTete.headers,
      footers: enTete.footers,
      children: construireEnfants(docx, projet, entreprise, devis, montant, lettres)
    }]
  });

  // Navigateur : Packer.toBlob ; Node (tests) : toBuffer puis enveloppe Blob
  // (Node 24 fournit le Blob global, l'API contractuelle reste Promise<Blob>).
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    const tampon = await docx.Packer.toBuffer(document);
    return new Blob([tampon], { type: MIME_DOCX });
  }
  return docx.Packer.toBlob(document);
}