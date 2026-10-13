// js/gen-crc.js — générateur du Compte Rendu de Chantier n°01 (.docx)
//
// Rôle métier : le CRC est le DOCUMENT VIVANT du chantier (SPEC § 6 ter) — le
// canevas de la première réunion, initialisé SANS ressaisie avec toutes les
// parties prenantes, qui se RÉGÉNÈRE à chaque réunion (genererCRC01(projet,
// { numero })) en listant TOUTES les entreprises connues, complètes ou non :
// une entreprise ajoutée après coup apparaît dans le CRC suivant. Le calque vient
// du CRC réellement rédigé par l'agence (le fichier d’origine,
// texte dans les documents d’origine) et du § 2 du cahier des charges :
//   - en-tête : opération, date, destinataires, formule d'introduction ;
//   - tableau CONSOLIDÉ des intervenants (maîtrise d'ouvrage, architecte
//     signataire, conducteurs de travaux, BET, SPS, géotechnicien, OPC, puis
//     entreprises par lot) avec colonnes nom / représentant / téléphone /
//     courriel / présence — chaque ligne reste lisible à l'impression ;
//   - généralités administratives (assurances, situations, retenue, pénalités) ;
//   - sous-sections par lot : sections titrées dont chaque point peut être
//     attribué à un destinataire, à la façon du CRC réel
//     (« ... -> groupe Exemple », « ... -> DISTRIBEX »).
//
// Contrat SPEC §8 : export genererCRC01(projet) -> Promise<Blob>.
// Le modèle Projet (SPEC §2) ne décrit pas projet.crc ; ce générateur l'accepte
// quand il existe (convention notée dans docs/MODELE-DONNEES.md ) :
//   projet.crc = {
//     dateReunion, lieuReunion,
//     intervenants: [{role, nom, representant, tel, email}],   // BET/SPS/…
//     contacts: { [entrepriseId]: {tel, email} },              // tél/courriel lot
//     lotsNonAttribues: ["LOT n° … — désignation", ...],       // lots pas encore confiés
//     generalites: [ "...points administratifs surchargés..." ],
//     sections: [{titre, points: [{texte, destinataire}]}]
//   }
// et s'en passe proprement sinon (lignes pointillées, sections déduites des lots).

const PRIMAIRE = "1E3A5F"; // charte graphique : bleu marine
const ACCENT = "F97316";   // charte graphique : orange
const POLICE = "Trebuchet MS";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const A4_LARGEUR = 11906;
const A4_HAUTEUR = 16838;
const MARGE = 1134;        // 2 cm : le tableau des intervenants a besoin de largeur
const LARGEUR_UTILE = A4_LARGEUR - 2 * MARGE; // 9638 twips

let promesseDocx = null;

function chargerDocx() {
  if (typeof window !== "undefined" && window.docx) return Promise.resolve(window.docx);
  if (promesseDocx) return promesseDocx;
  promesseDocx = (async function () {
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      const { chargerUMD } = await import("../tests/lib/chargeur-umd.mjs");
      const { fileURLToPath } = await import("node:url");
      const chemin = fileURLToPath(new URL("../vendor/docx.umd.js", import.meta.url));
      const surcharge = {};
      if (typeof setImmediate !== "undefined") surcharge.setImmediate = setImmediate;
      if (typeof structuredClone !== "undefined") surcharge.structuredClone = structuredClone;
      if (typeof queueMicrotask !== "undefined") surcharge.queueMicrotask = queueMicrotask;
      return chargerUMD(chemin, "docx", surcharge);
    }
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

function aireTexte(texte) { return String(texte == null ? "" : texte).replace(/\s+/g, " ").trim(); }

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

function formaterDateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (m) return Number(m[3]) + " " + MOIS_FR[Number(m[2]) - 1] + " " + m[1];
  if (iso) return String(iso);
  return "……………"; // canevas : la date de réunion se complète à la main si absente
}

// ── Fabriques docx (mêmes conventions que js/gen-marche.js) ─────────────────

function fabriques(docx) {
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
      alignment: o.align || docx.AlignmentType.LEFT,
      spacing: { before: o.avant == null ? 60 : o.avant, after: o.apres == null ? 60 : o.apres }
    });
  }
  function tableau(entetes, lignes, largeurs) {
    const bordFin = { style: docx.BorderStyle.SINGLE, size: 2, color: "8A99B3" };
    const lignesDocx = [];
    if (entetes) {
      lignesDocx.push(new docx.TableRow({
        tableHeader: true,
        children: entetes.map(function (h, i) {
          return new docx.TableCell({
            width: { size: largeurs[i], type: docx.WidthType.DXA },
            shading: { type: docx.ShadingType.CLEAR, fill: "DCE4F2" },
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [para([run(h, { bold: true, size: 16, color: PRIMAIRE })], { avant: 0, apres: 0 })]
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
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
            children: [para([run(c.texte, { bold: !!c.bold, size: c.size || 16 })], { avant: 0, apres: 0 })]
          });
        })
      }));
    });
    return new docx.Table({
      layout: docx.TableLayoutType.FIXED,
      width: { size: LARGEUR_UTILE, type: docx.WidthType.DXA },
      rows: lignesDocx,
      borders: {
        top: bordFin, bottom: bordFin, left: bordFin, right: bordFin,
        insideHorizontal: bordFin, insideVertical: bordFin
      }
    });
  }
  return { run: run, para: para, tableau: tableau };
}

// ── Tableau consolidé des intervenants ──────────────────────────────────────
// Colonnes : Rôle | Société | Représentant | Téléphone | Courriel | Présence.
// Les largeurs (twips) sont figées pour que chaque ligne reste lisible à l'impression.
const COLONNES_CRC = [1750, 2100, 1900, 1250, 1950, 688];

function lignesIntervenants(projet) {
  const crc = projet.crc || {};
  const mo = projet.maitreOuvrage || {};
  const ag = projet.agence || {};
  const equipe = projet.equipe || {};
  const parRole = {};
  (crc.intervenants || []).forEach(function (i) {
    if (i && i.role) parRole[String(i.role).toUpperCase()] = i;
  });
  // SPEC § 6 ter (saisie progressive) : les cellules manquantes restent VIDES —
  // mot de l'utilisateur : « on peut avoir les lignes en blanc ». Jamais de
  // tiret, jamais « inconnu », jamais de valeur inventée : la ligne se complète
  // à la main en réunion, puis se reporte dans le CRC suivant.
  function celluleOu(v, cle) {
    const d = v ? v[cle] : "";
    return aireTexte(d);
  }
  const lignes = [];
  // 1) Maître d'ouvrage
  lignes.push([
    { texte: "MAÎTRE D'OUVRAGE", bold: true },
    aireTexte([mo.forme, mo.raisonSociale].filter(Boolean).join(" ")),
    aireTexte([mo.representant, mo.qualiteRepresentant ? " (" + mo.qualiteRepresentant + ")" : ""].filter(Boolean).join("")),
    celluleOu(parRole["MAITRE D'OUVRAGE"] || parRole["MO"], "tel"),
    celluleOu(parRole["MAITRE D'OUVRAGE"] || parRole["MO"], "email"),
    ""
  ]);
  // 2) Architecte signataire (l'agence)
  lignes.push([
    { texte: "ARCHITECTE SIGNATAIRE", bold: true },
    aireTexte(ag.raisonSociale),
    aireTexte(equipe.architecteSignataire || ag.representant),
    aireTexte(ag.tel),
    aireTexte(ag.email),
    ""
  ]);
  // 3) Conducteurs de travaux (un par ligne)
  (equipe.conducteursTravaux || []).forEach(function (nom) {
    lignes.push([
      { texte: "CONDUCTEUR DE TRAVAUX", bold: true },
      aireTexte(ag.raisonSociale),
      aireTexte(nom), "", "", ""
    ]);
  });
  // 4) BET / SPS / géotechnicien / OPC — lignes du canevas même sans données
  const rolesCanoniques = [
    ["BET", "BET (BUREAU D'ETUDES TECHNIQUES)"],
    ["SPS", "COORDINATION SPS"],
    ["GEOTECHNICIEN", "GEOTECHNICIEN"],
    ["OPC", "OPC (ORDONNANCEMENT PILOTAGE COORDINATION)"]
  ];
  rolesCanoniques.forEach(function (paire) {
    const donnees = parRole[paire[0]] || {};
    lignes.push([
      { texte: paire[1], bold: true },
      aireTexte(donnees.nom),
      aireTexte(donnees.representant),
      aireTexte(donnees.tel),
      aireTexte(donnees.email),
      ""
    ]);
  });
  // 5) Entreprises, une ligne par lot
  (projet.entreprises || []).forEach(function (e) {
    const contact = (crc.contacts || {})[e.id] || {};
    const suffixeLot = [(e.lotNumero ? "LOT n° " + e.lotNumero : ""), aireTexte(e.lotNom)].filter(Boolean).join(" ");
    lignes.push([
      { texte: "ENTREPRISE" + (suffixeLot ? " — " + suffixeLot : ""), bold: true },
      aireTexte([e.forme, e.raisonSociale].filter(Boolean).join(" ")),
      aireTexte([e.representant, e.qualiteRepresentant ? " (" + e.qualiteRepresentant + ")" : ""].filter(Boolean).join("")),
      aireTexte(contact.tel),
      aireTexte(contact.email),
      ""
    ]);
  });
  return lignes;
}

// ── Généralités administratives (calque des clauses du marché de l'agence) ──

function pointsGeneralites(projet) {
  const crc = projet.crc || {};
  if (crc.generalites && crc.generalites.length) return crc.generalites.map(aireTexte);
  const penalites = projet.penalites || {};
  const rg = (projet.retenueGarantieTaux == null ? 0.05 : projet.retenueGarantieTaux) * 100;
  return [
    "Assurances : chaque entrepreneur justifie, avant tout démarrage, d'une attestation de responsabilité décennale couvrant la DROC (art. L. 241-1 du Code des assurances) et de ses attestations URSSAF et fiscales ; les attestations sont jointes au marché.",
    "Situations mensuelles établies le 25, présentées en 3 originaux au maître d'œuvre qui établit le « bon à payer ».",
    "Retenue de garantie : " + rg.toLocaleString("fr-FR") + " % du montant HT des travaux, consignée chez le maître d'ouvrage ou remplacée par une caution, libérée dans les 12 mois suivant la réception.",
    "Pénalités de retard : " + (penalites.tauxJournalier || 250) + " € TTC par jour calendaire de retard, plafonnées à " + ((penalites.montantMaxPct == null ? 5 : penalites.montantMaxPct)) + " % du marché HT.",
    "Comptes-rendus : applicables sauf contestation écrite dans les 5 jours de leur réception (dérogation à l'article 15-2-1 du CCAG) ; transmission par courriel.",
    "Rendez-vous de chantier hebdomadaires : présence obligatoire de chaque entrepreneur ou de son représentant ayant pouvoir de prendre décision sur le chantier.",
    "Pièces administratives : chaque lot suivi jusqu'au visa complet des plans d'exécution (attestations, plans BE, notes de calcul, fiches de sécurité)."
  ];
}

// ── Sous-sections par lot ───────────────────────────────────────────────────
// projet.crc.sections quand il existe (calque du CRC réel : « Bâtiment
// SUPERMARCHE », « BOUTIQUES / RETAIL », « ETUDES », points attribués
// « -> destinataire ») ; sinon une section par lot d'entreprise, en canevas.

function sectionsParLot(projet) {
  const crc = projet.crc || {};
  if (crc.sections && crc.sections.length) return crc.sections;
  return (projet.entreprises || []).map(function (e) {
    return {
      titre: "LOT " + (e.lotNumero ? "n° " + e.lotNumero + " — " : "") + (e.lotNom || e.raisonSociale),
      points: [
        { texte: "Suivi des pièces administratives du lot (attestations d'assurance, plans d'exécution, notes de calcul)", destinataire: e.raisonSociale },
        { texte: "Visas des documents d'exécution", destinataire: "architecte" }
      ]
    };
  });
}

// ── Corps du CRC n°01 ───────────────────────────────────────────────────────

function construireEnfants(docx, projet, numero, numeroFormate) {
  const F = fabriques(docx);
  const op = projet.operation || {};
  const crc = projet.crc || {};
  const enfants = [];

  enfants.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER, spacing: { after: 60 },
    children: [F.run("COMPTE RENDU DE CHANTIER N° " + numeroFormate, { bold: true, size: 30, color: PRIMAIRE })]
  }));
  // N°01 accompagne la réunion d'ouverture ; les numéros suivants, les réunions
  // hebdomadaires — le CRC se régénère à chaque réunion (SPEC § 6 ter.5).
  enfants.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER, spacing: { after: 40 },
    children: [F.run(numero === 1 ? "Réunion d'ouverture de chantier" : "Réunion de chantier", { bold: true, size: 22, color: PRIMAIRE })]
  }));
  enfants.push(new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER, spacing: { after: 200 },
    children: [F.run((op.reference || "") + (op.intitule ? " — " + aireTexte(op.intitule) : ""), { bold: true, size: 20 })]
  }));
  enfants.push(F.para([F.run("Opération : " + aireTexte(
    [op.adresse ? op.adresse + " - " : "", [op.cp, op.ville].filter(Boolean).join(" ")].join("")
  ), { size: 18 })], { avant: 0, apres: 40 }));
  enfants.push(F.para([F.run("Réunion tenue le " + formaterDateFr(crc.dateReunion) + (crc.lieuReunion ? ", " + aireTexte(crc.lieuReunion) : ""), { size: 18 })], { avant: 0, apres: 200 }));

  // Destinataires — le CRC réel commence par « Mesdames, messieurs, » suivi de
  // la formule d'introduction ; la liste des diffusés reprend le tableau.
  const diffusables = [(projet.maitreOuvrage || {}).raisonSociale, (projet.agence || {}).raisonSociale]
    .concat((projet.entreprises || []).map(function (e) { return e.raisonSociale; }))
    .filter(Boolean);
  enfants.push(F.para([F.run("Mesdames, messieurs,", { size: 20 })], { avant: 60, apres: 60 }));
  const qualificatifReunion = numero === 1 ? " d'ouverture de chantier" : " de chantier";
  enfants.push(F.para([F.run("Suite à la réunion" + qualificatifReunion + (crc.dateReunion ? " du " + formaterDateFr(crc.dateReunion) : "") + ", veuillez trouver ci-joint les points abordés. Diffusion : " + diffusables.join(" ; ") + ".", { size: 20 })], { avant: 0, apres: 200 }));

  // Tableau consolidé des intervenants.
  enfants.push(new docx.Paragraph({
    spacing: { before: 120, after: 80 }, keepNext: true,
    children: [F.run("TABLEAU DES INTERVENANTS", { bold: true, size: 22, color: PRIMAIRE })]
  }));
  enfants.push(F.tableau(
    ["Rôle", "Société", "Représentant", "Téléphone", "Courriel", "Présence"],
    lignesIntervenants(projet),
    COLONNES_CRC
  ));
  enfants.push(F.para([F.run("", { size: 8 })], { avant: 0, apres: 80 }));

  // Généralités administratives.
  enfants.push(new docx.Paragraph({
    spacing: { before: 200, after: 80 }, keepNext: true,
    children: [F.run("GENERALITES ADMINISTRATIVES", { bold: true, size: 22, color: PRIMAIRE })]
  }));
  pointsGeneralites(projet).forEach(function (texte, i) {
    enfants.push(F.para([F.run((i + 1) + ". " + texte, { size: 18 })], { avant: 20, apres: 20 }));
  });

  // Sous-sections par lot, points attribués « -> destinataire » comme dans le CRC réel.
  sectionsParLot(projet).forEach(function (section) {
    enfants.push(new docx.Paragraph({
      spacing: { before: 220, after: 60 }, keepNext: true,
      children: [F.run(aireTexte(section.titre), { bold: true, size: 21, color: ACCENT })]
    }));
    (section.points || []).forEach(function (point) {
      const texte = aireTexte(point.texte);
      const suffixe = point.destinataire ? " -> " + aireTexte(point.destinataire) : "";
      enfants.push(F.para([F.run("•  " + texte + suffixe, { size: 18 })], { avant: 20, apres: 20 }));
    });
  });

  // ── Lots restant à attribuer (SPEC § 6 ter : le chantier démarre avec des
  // lots non encore confiés — seules les entreprises du clos couvert sont
  // souvent connues). Rubrique TOUJOURS présente : un canevas de réunion doit
  // offrir les lignes à remplir même quand rien n'est encore connu.
  // projet.crc.lotsNonAttribues (tableau de libellés, rempli par l'interface)
  // liste les lots en attente ; à défaut, un tableau vierge tient lieu de
  // lignes de saisie manuelle.
  enfants.push(new docx.Paragraph({
    spacing: { before: 220, after: 60 }, keepNext: true,
    children: [F.run("LOTS RESTANT À ATTRIBUER", { bold: true, size: 21, color: ACCENT })]
  }));
  const lotsRestants = (crc.lotsNonAttribues || []).map(aireTexte).filter(Boolean);
  if (lotsRestants.length > 0) {
    lotsRestants.forEach(function (libelle) {
      enfants.push(F.para([F.run("•  " + libelle, { size: 18 })], { avant: 20, apres: 20 }));
    });
  } else {
    enfants.push(F.tableau(
      ["Lot / désignation des travaux", "Entreprise pressentie / observations"],
      [["", ""], ["", ""], ["", ""]],
      [5200, 4438]
    ));
    enfants.push(F.para([F.run("", { size: 8 })], { avant: 0, apres: 60 }));
  }

  // Clôture du canevas : prochaine réunion + diffusion.
  enfants.push(F.para([F.run("Prochaine réunion : le ……………", { bold: true, size: 18 })], { avant: 260, apres: 40 }));
  enfants.push(F.para([F.run("Diffusion : intervenants du tableau ci-dessus.", { size: 18 })], { avant: 0, apres: 0 }));

  return enfants;
}

// ── Export contractuel (SPEC §8) ────────────────────────────────────────────
// genererCRC01(projet, { numero = 1 } = {}) -> Promise<Blob> — le CRC se
// régénère à chaque réunion ; le numéro suit l'ordre des réunions (n°01, n°02…)
// et la date de réunion vient de projet.crc.dateReunion. Sans second argument,
// comportement historique : n°01.

export async function genererCRC01(projet, options) {
  if (!projet) throw new Error("genererCRC01 : projet manquant");
  const opts = options || {};
  const numero = Number(opts.numero == null ? 1 : opts.numero);
  if (!Number.isFinite(numero) || numero < 1 || Math.floor(numero) !== numero) {
    throw new Error("genererCRC01 : numéro de CRC invalide (" + opts.numero + ") — entier >= 1 attendu");
  }
  const numeroFormate = String(numero).padStart(2, "0");
  const docx = await chargerDocx();
  const op = projet.operation || {};
  const enTete = {
    headers: {
      default: new docx.Header({
        children: [
          new docx.Paragraph({
            tabStops: [{ type: docx.TabStopType.RIGHT, position: LARGEUR_UTILE }],
            children: [
              new docx.TextRun({ text: String(((projet.agence || {}).raisonSociale) || "").toUpperCase(), bold: true, size: 24, color: PRIMAIRE, font: POLICE }),
              new docx.TextRun({ text: "\tCOMPTE RENDU DE CHANTIER N° " + numeroFormate, bold: true, size: 16, color: PRIMAIRE, font: POLICE })
            ]
          }),
          new docx.Paragraph({
            border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: ACCENT } },
            spacing: { after: 120 },
            children: [new docx.TextRun({
              text: (op.reference || "") + (op.intitule ? " — " + aireTexte(op.intitule) : ""),
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
              new docx.TextRun({ text: (((projet.agence || {}).raisonSociale) ? (projet.agence || {}).raisonSociale + " — " : "") + "Page ", size: 13, color: "666666", font: POLICE }),
              new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 13, color: "666666", font: POLICE }),
              new docx.TextRun({ text: " / ", size: 13, color: "666666", font: POLICE }),
              new docx.TextRun({ children: [docx.PageNumber.TOTAL_PAGES], size: 13, color: "666666", font: POLICE })
            ]
          })
        ]
      })
    }
  };

  const document = new docx.Document({
    styles: {
      default: {
        document: {
          run: { font: POLICE, size: 20, color: "000000" },
          paragraph: { spacing: { before: 60, after: 60 } }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: A4_LARGEUR, height: A4_HAUTEUR },
          margin: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE }
        }
      },
      headers: enTete.headers,
      footers: enTete.footers,
      children: construireEnfants(docx, projet, numero, numeroFormate)
    }]
  });

  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    const tampon = await docx.Packer.toBuffer(document);
    return new Blob([tampon], { type: MIME_DOCX });
  }
  return docx.Packer.toBlob(document);
}