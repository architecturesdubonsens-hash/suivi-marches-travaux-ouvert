// js/ui/ecran-generation.js
//
// ÉCRAN 4 — GÉNÉRATION 1-clic : appelle les quatre générateurs contractuels
// (js/gen-os.js, js/gen-avenant.js; js/gen-marche.js,
// js/gen-crc.js), assemble le ZIP final
// (01_MARCHES/ 02_OS/ 03_CRC/ 04_SUIVI_AVENANTS/ PROJET.json) avec JSZip
// vendored, et gère export/import de l'état (js/etat.js).
//
// Chaque générateur est appelé par import() dynamique et try/catch : un
// module manquant n'empêche pas la génération des autres, et l'absence est
// signalée avec l'agent responsable.

import { el, toast, fmtEuros, fmtDate, telecharger, slug } from "./helpers.js";
import { titreAide } from "./bulle.js";
import { boutonsSauvegarde } from "./sauvegarde-ui.js";
import { chargerScript } from "../import-pdf.js";
import { MODULES_PARTENAIRES, construireIndicateur } from "./etat-modules.js";
// Dossier partagé entre les postes (SPEC § 6 quinquies) : connexion, liste des dossiers
// de la base, enregistrement, conflits. Module autonome — un seul point de branchement.

/** Recherche la définition d'un module partenaire par son chemin d'import. */
function definitionModule(cheminImport) {
  return MODULES_PARTENAIRES.find((m) => m.importer === cheminImport) || { agent: "?", chemin: cheminImport };
}

/** Import dynamique défensif d'un générateur. */
async function importerGenerateur(cheminImport) {
  const def = definitionModule(cheminImport);
  try {
    return { mod: await import(cheminImport), def };
  } catch {
    return { mod: null, def };
  }
}

/** Charge JSZip (vendored) via <script> dynamique. */
async function chargerJszip() {
  if (window.JSZip) return window.JSZip;
  await chargerScript("vendor/jszip.min.js");
  if (!window.JSZip) throw new Error("JSZip introuvable dans vendor/");
  return window.JSZip;
}

/** Nom de fichier unique dans le ZIP (suffixe -2, -3… en cas de doublon). */
function nomUnique(prises, nom) {
  let candidat = nom;
  let n = 2;
  while (prises.has(candidat.toLowerCase())) {
    candidat = nom.replace(/(\.[a-z0-9]+)$/i, "-" + n + "$1");
    n++;
  }
  prises.add(candidat.toLowerCase());
  return candidat;
}

/* ------------------------------------------------------------------ */
/* Génération du dossier complet                                       */
/* ------------------------------------------------------------------ */

async function genererDossier(ctx, zoneResultat) {
  const { projet } = ctx;
  const reference = slug(projet.operation && projet.operation.reference) || "PROJET";
  const entreprises = Array.isArray(projet.entreprises) ? projet.entreprises : [];
  const messages = [];
  const arbo = [];
  const prises = new Set();

  let JSZip;
  try {
    JSZip = await chargerJszip();
  } catch (erreur) {
    zoneResultat.append(el("p", { classe: "message-attente", texte: "ZIP impossible : " + erreur.message }));
    return;
  }
  const zip = new JSZip();

  // Les quatre générateurs : import une fois, usage répété.
  const genMarche = await importerGenerateur("./gen-marche.js");
  const genOs = await importerGenerateur("./gen-os.js");
  const genCrc = await importerGenerateur("./gen-crc.js");
  const genAvenant = await importerGenerateur("./gen-avenant.js");

  // Marchés de travaux : un .docx par entreprise (lot).
  for (const entreprise of entreprises) {
    if (genMarche.mod && typeof genMarche.mod.genererMarche === "function") {
      try {
        const blob = await genMarche.mod.genererMarche(projet, entreprise.id);
        const nom = nomUnique(prises, "01_MARCHES/MT-" + reference + "-" + slug(entreprise.lotNom || entreprise.raisonSociale) + ".docx");
        zip.file(nom, blob);
        arbo.push(nom);
      } catch (erreur) {
        messages.push("MT " + entreprise.raisonSociale + " : " + (erreur && erreur.message ? erreur.message : erreur));
      }
    }
  }
  if (!genMarche.mod) messages.push("Module js/gen-marche.js en attente de l'agent " + genMarche.def.agent + " : aucun Marché de Travaux généré.");

  // Ordres de service : un appel par entreprise (contrat §8).
  for (const entreprise of entreprises) {
    if (genOs.mod && typeof genOs.mod.genererOS === "function") {
      try {
        const blob = await genOs.mod.genererOS(projet, entreprise.id);
        const nom = nomUnique(prises, "02_OS/OS-" + reference + "-" + slug(entreprise.raisonSociale) + ".xlsx");
        zip.file(nom, blob);
        arbo.push(nom);
      } catch (erreur) {
        messages.push("OS " + entreprise.raisonSociale + " : " + (erreur && erreur.message ? erreur.message : erreur));
      }
    }
  }
  if (!genOs.mod) messages.push("Module js/gen-os.js en attente de l'agent " + genOs.def.agent + " : aucun Ordre de Service généré.");

  // CRC n°01 : un document pour l'opération.
  if (genCrc.mod && typeof genCrc.mod.genererCRC01 === "function") {
    try {
      const blob = await genCrc.mod.genererCRC01(projet);
      const nom = nomUnique(prises, "03_CRC/CRC-01-" + reference + ".docx");
      zip.file(nom, blob);
      arbo.push(nom);
    } catch (erreur) {
      messages.push("CRC : " + (erreur && erreur.message ? erreur.message : erreur));
    }
  } else {
    messages.push("Module js/gen-crc.js en attente de l'agent " + genCrc.def.agent + " : aucun CRC généré.");
  }

  // Fiches d'avenant : un .xlsx par avenant enregistré.
  const avenants = Array.isArray(projet.avenants) ? projet.avenants : [];
  for (const avenant of avenants) {
    const entreprise = entreprises.find((e) => e.id === avenant.entrepriseId);
    if (genAvenant.mod && typeof genAvenant.mod.genererAvenant === "function") {
      try {
        const blob = await genAvenant.mod.genererAvenant(projet, avenant.entrepriseId, avenant);
        const nom = nomUnique(prises, "04_SUIVI_AVENANTS/AV" + (avenant.numero || "?") + "-" + slug(entreprise ? entreprise.raisonSociale : avenant.entrepriseId) + ".xlsx");
        zip.file(nom, blob);
        arbo.push(nom);
      } catch (erreur) {
        messages.push("Avenant n°" + avenant.numero + " : " + (erreur && erreur.message ? erreur.message : erreur));
      }
    }
  }
  if (!genAvenant.mod) messages.push("Module js/gen-avenant.js en attente de l'agent " + genAvenant.def.agent + " : aucune fiche d'avenant générée.");

  // État complet du projet (contrat §8 : exporterJSON de js/etat.js).
  const jsonEtat = ctx.services.etat && typeof ctx.services.etat.exporterJSON === "function"
    ? ctx.services.etat.exporterJSON(projet)
    : JSON.stringify(projet, null, 2);
  zip.file("PROJET.json", jsonEtat);
  arbo.push("PROJET.json");

  if (!arbo.length) {
    zoneResultat.append(el("p", { classe: "message-attente", texte: "Rien à générer : aucun générateur disponible et aucune donnée." }));
    return;
  }

  const blobZip = await zip.generateAsync({ type: "blob" });
  telecharger(blobZip, "DOSSIER-" + reference + ".zip");

  zoneResultat.replaceChildren(
    el("h3", { texte: "Résultat de la génération" }),
    el("p", { classe: "message-info", texte: "Archive téléchargée : DOSSIER-" + reference + ".zip (" + arbo.length + " fichier(s))." }),
    el("pre", { classe: "arborescence", texte: arbo.sort().join("\n") }));
  if (messages.length) {
    const liste = el("ul", { classe: "raisons" });
    for (const message of messages) liste.append(el("li", { texte: message }));
    zoneResultat.append(el("p", { classe: "message-attente", texte: "Génération partielle — points en attente :" }), liste);
  } else {
    toast("Dossier complet généré.", "succes");
  }
}

/* ------------------------------------------------------------------ */
/* Avenants (suivi : projet.avenants, contrat §2)                      */
/* ------------------------------------------------------------------ */

function blocAvenants(ctx) {
  const { projet } = ctx;
  const zone = el("div");
  function rendre() {
    zone.replaceChildren();
    const avenants = Array.isArray(projet.avenants) ? projet.avenants : [];
    if (!avenants.length) {
      zone.append(el("p", { classe: "entre-deux", texte: "Aucun avenant enregistré." }));
    } else {
      const table = el("table", { classe: "donnees" },
        el("thead", {}, el("tr", {},
          el("th", { texte: "N°" }), el("th", { texte: "Objet" }), el("th", { texte: "Entreprise" }),
          el("th", { texte: "Lignes" }), el("th", { texte: "" }))));
      const corps = el("tbody");
      for (const avenant of avenants) {
        const entreprise = (projet.entreprises || []).find((e) => e.id === avenant.entrepriseId);
        corps.append(el("tr", {},
          el("td", { texte: String(avenant.numero ?? "") }),
          el("td", { texte: avenant.objet || "" }),
          el("td", { texte: entreprise ? entreprise.raisonSociale : "" }),
          el("td", { texte: (avenant.lignes || []).map((l) => l.libelle + " : " + fmtEuros(l.montant)).join(" / ") || "—" }),
          el("td", {}, el("button", { classe: "bouton discret", texte: "supprimer", onClick: () => ctx.majProjet((p) => {
            const index = p.avenants.indexOf(avenant);
            if (index >= 0) p.avenants.splice(index, 1);
            rendre();
          }) }))));
      }
      table.append(corps);
      zone.append(table);
    }

    // Formulaire de création
    const prochainNumero = avenants.reduce((max, a) => Math.max(max, Number(a.numero) || 0), 0) + 1;
    const iObjet = el("input", { type: "text", placeholder: "Objet de l'avenant (ex. Travaux modificatifs n°1)" });
    const iEntreprise = el("select", {},
      el("option", { value: "", texte: "— choisir l'entreprise —" }));
    for (const entreprise of projet.entreprises || []) {
      iEntreprise.append(el("option", { value: entreprise.id, texte: entreprise.raisonSociale }));
    }
    const zoneLignes = el("div");
    function rendreLignes() {
      zoneLignes.replaceChildren();
      for (const ligne of lignesCourantes) {
        const iLibelle = el("input", { type: "text", value: ligne.libelle, placeholder: "Libellé" });
        iLibelle.addEventListener("input", () => { ligne.libelle = iLibelle.value; });
        const iMontant = el("input", { type: "number", step: "0.001", value: ligne.montant ?? "", placeholder: "Montant HT" });
        iMontant.addEventListener("input", () => { ligne.montant = iMontant.value === "" ? 0 : Number(iMontant.value); });
        zoneLignes.append(el("div", { classe: "champs-ligne" }, iLibelle, iMontant));
      }
    }
    const lignesCourantes = [{ libelle: "", montant: 0 }];
    rendreLignes();
    const iDelais = el("input", { type: "text", placeholder: "Modification des délais (vide = Néant)" });
    const boutonAjouter = el("button", { classe: "bouton primaire", texte: "Enregistrer l'avenant", onClick: () => {
      if (!iEntreprise.value) { toast("Choisissez l'entreprise de l'avenant.", "erreur"); return; }
      const lignes = lignesCourantes.filter((l) => l.libelle.trim());
      ctx.majProjet((p) => {
        p.avenants = Array.isArray(p.avenants) ? p.avenants : [];
        p.avenants.push({
          numero: prochainNumero,
          objet: iObjet.value.trim(),
          entrepriseId: iEntreprise.value,
          lignes,
          modificationDelais: iDelais.value.trim() || null,
        });
      });
      toast("Avenant n°" + prochainNumero + " enregistré.", "succes");
      rendre();
    } });
    zone.append(el("h3", { texte: "Nouvel avenant" }),
      el("div", { classe: "champs-ligne" }, iObjet, iEntreprise, iDelais),
      zoneLignes,
      el("div", { classe: "rangee-boutons" },
        el("button", { classe: "bouton", texte: "+ une ligne de travaux", onClick: () => { lignesCourantes.push({ libelle: "", montant: 0 }); rendreLignes(); } }),
        boutonAjouter));
  }
  rendre();
  return zone;
}

/* ------------------------------------------------------------------ */
/* Écran principal                                                     */
/* ------------------------------------------------------------------ */

/**
 * Écrit l'écran 4 dans le conteneur.
 * @param {HTMLElement} conteneur
 * @param {object} ctx contexte applicatif fourni par app.js
 */
export function afficher(conteneur, ctx) {
  const { projet } = ctx;
  const entreprises = Array.isArray(projet.entreprises) ? projet.entreprises : [];
  const devis = Array.isArray(projet.devis) ? projet.devis : [];

  // Synthèse simple, lisible avant de cliquer.
  const synthese = el("ul", { classe: "raisons" },
    el("li", { texte: entreprises.length + " entreprise(s) / " + devis.length + " devis enregistrés." }),
    el("li", { texte: "Opération : " + ((projet.operation && projet.operation.reference) || "(référence non saisie)") }),
    el("li", { texte: "DROC : " + fmtDate(projet.operation && projet.operation.droc) }));

  const zoneResultat = el("div", { classe: "resultat-generation", style: "display:none" });
  const boutonGenerer = el("button", { classe: "bouton primaire", texte: "GÉNÉRER LE DOSSIER COMPLET (ZIP)" });
  boutonGenerer.addEventListener("click", async () => {
    boutonGenerer.disabled = true;
    zoneResultat.style.display = "";
    zoneResultat.replaceChildren(el("p", { classe: "entre-deux", texte: "Génération en cours…" }));
    try {
      await genererDossier(ctx, zoneResultat);
    } catch (erreur) {
      zoneResultat.append(el("p", { classe: "message-attente", texte: "Échec de la génération : " + (erreur && erreur.message ? erreur.message : erreur) }));
    }
    boutonGenerer.disabled = false;
  });

  // Export / import de l'état (transfert multi-postes, SPEC §6).
  const boutonExport = el("button", { classe: "bouton", texte: "Exporter l'état (JSON)" });
  boutonExport.addEventListener("click", () => {
    const json = ctx.services.etat && typeof ctx.services.etat.exporterJSON === "function"
      ? ctx.services.etat.exporterJSON(projet)
      : JSON.stringify(projet, null, 2);
    telecharger(new Blob([json], { type: "application/json" }), "PROJET-" + (slug(projet.operation && projet.operation.reference) || "etat") + ".json");
  });
  const inputImport = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  inputImport.addEventListener("change", async () => {
    const fichier = inputImport.files[0];
    inputImport.value = "";
    if (!fichier) return;
    try {
      const texte = await fichier.text();
      let projetImporte;
      if (ctx.services.etat && typeof ctx.services.etat.importerJSON === "function") {
        projetImporte = ctx.services.etat.importerJSON(texte);
      } else {
        projetImporte = JSON.parse(texte);
      }
      ctx.remplacerProjet(projetImporte);
      toast("État importé : " + fichier.name, "succes");
    } catch (erreur) {
      toast("Import impossible : " + (erreur && erreur.message ? erreur.message : erreur), "erreur");
    }
  });

  conteneur.replaceChildren(
    el("section", { classe: "carte" },
      titreAide("h2", "Génération 1-clic", "generation"),
      el("p", { classe: "aide", texte: "Un seul bouton produit les quatre livrables dans les gabarits réels de l'agence, classés : 01_MARCHES/, 02_OS/, 03_CRC/, 04_SUIVI_AVENANTS/, plus l'état complet PROJET.json." }),
      synthese,
      el("div", { classe: "rangee-boutons" }, boutonGenerer),
      zoneResultat,
    ),
    el("section", { classe: "carte" },
      titreAide("h2", "Suivi des avenants", "avenant"),
      el("p", { classe: "aide", texte: "Chaque avenant alimente sa fiche AV (gabarit réel) et le chaînage (A) initial → (B) rectifié → (C)/(D) → montant cumulé." }),
      blocAvenants(ctx),
    ),
    el("section", { classe: "carte" },
      el("h2", { texte: "Transfert multi-postes" }),
      el("p", { classe: "aide", texte: "L'état du projet s'enregistre automatiquement (IndexedDB). Exportez-le en JSON pour le poursuivre sur un autre poste, sans serveur." }),
      el("div", { classe: "rangee-boutons" }, boutonExport, el("button", { classe: "bouton", texte: "Importer un état (JSON)", onClick: () => inputImport.click() }), inputImport),
      // Les deux boutons ci-dessus ne portent QUE le dossier ouvert. La sauvegarde, elle,
      // prend tous les dossiers de la base en une fois — c'est une autre opération, et
      // les confondre était le moyen le plus sûr de ne jamais sauvegarder.
      boutonsSauvegarde(() => afficher(conteneur, ctx)),
    ),
    // Rend null quand les huit fonctions sont disponibles : el() ignore null, donc la
    // carte DISPARAÎT au lieu d'annoncer en permanence que tout va bien.
    construireIndicateur(ctx.etatsModules, () => ctx.reverifierModules().then(() => afficher(conteneur, ctx))),
    el("div", { classe: "carte" }, el("div", { classe: "rangee-boutons" },
      el("button", { classe: "bouton", texte: "← Retour à la validation", onClick: () => ctx.aller(2) }))),
  );
}
