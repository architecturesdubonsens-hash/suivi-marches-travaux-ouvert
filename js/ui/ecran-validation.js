// js/ui/ecran-validation.js
//
// ÉCRAN 3 — VALIDATION, entreprise par entreprise :
//  - montants HT / TVA / TTC calculés par js/calculs.js
//    avec CASES À COCHER des variantes (recalcul instantané) et montant
//    retranscrit EN LETTRES pour le CCAP ;
//  - VOYANT d'assurances vert/orange/rouge issu de js/assurances.js
//    (controler), avec la liste des raisons et le rappel du fondement
//    (art. L. 241-1 du Code des assurances) ;
//  - date de début des travaux par entreprise (alimente l'OS n°1).
//
// Si un module partenaire manque, la saisie reste possible : les cases et les
// champs sont enregistrés dans le projet, le calcul s'affichera dès livraison.

import { el, toast, fmtEuros } from "./helpers.js";
import { titreAide } from "./bulle.js";
import { messageIndisponible } from "./etat-modules.js";
import { LIBELLES_TYPES } from "../devis.js";

/** Mise à jour de l'OS n°1 d'une entreprise (projet.OS, contrat §2). */
function majOsNumeroUn(projet, entrepriseId, dateDebut) {
  projet.OS = Array.isArray(projet.OS) ? projet.OS : [];
  let os = projet.OS.find((o) => o && o.entrepriseId === entrepriseId && o.numero === 1);
  if (!os) {
    os = { entrepriseId, numero: 1, dateDebut: "" };
    projet.OS.push(os);
  }
  os.dateDebut = dateDebut || "";
}

/** Voyant + raisons du contrôle assurances, ou message d'attente. */
function blocAssurances(ctx, entreprise) {
  const assurances = ctx.services.assurances;
  if (!assurances || typeof assurances.controler !== "function") {
    return el("div", {},
      el("span", { classe: "badge attente", texte: "Voyant d'assurance indisponible" }),
      el("p", { classe: "message-attente", texte: messageIndisponible("js/assurances.js") }));
  }
  let resultat;
  try {
    resultat = assurances.controler(ctx.projet, entreprise.id);
  } catch (erreur) {
    return el("p", { classe: "message-attente",
      texte: "Contrôle d'assurance en erreur : " + (erreur && erreur.message ? erreur.message : erreur) });
  }
  const voyant = (resultat && resultat.voyant) || "orange";
  const raisons = (resultat && Array.isArray(resultat.raisons)) ? resultat.raisons : [];
  const couleur = voyant === "vert" ? "vert" : voyant === "rouge" ? "rouge" : "orange";
  const bloc = el("div", {},
    el("span", { classe: "voyant " + couleur, title: "Voyant d'assurance : " + voyant }),
    " ",
    el("strong", { texte: voyant === "vert" ? "Assurances conformes" : voyant === "rouge" ? "Assurances NON conformes" : "Assurances à vérifier" }));
  if (raisons.length) {
    const liste = el("ul", { classe: "raisons" });
    for (const raison of raisons) liste.append(el("li", { texte: String(raison) }));
    bloc.append(liste);
  }
  bloc.append(el("p", { classe: "fondement", texte:
    "Fondement : art. L. 241-1 du Code des assurances — l'attestation décennale doit couvrir l'activité effectivement confiée ; une activité seulement « accessoire » ne vaut pas marché à part entière." }));
  return bloc;
}

/** Carte d'un devis : variantes cochables, prorata, montants calculés. */
function blocDevis(ctx, devis) {
  const calculs = ctx.services.calculs;
  const carte = el("div", { classe: "fichier-depose" });

  // --- En-tête du devis (numéro, date, HT de base, prorata)
  const iNumero = el("input", { type: "text", value: devis.numero || "", placeholder: "N° de devis" });
  iNumero.addEventListener("change", () => ctx.majProjet((p) => { devis.numero = iNumero.value; }, { reRendre: false }));
  const iDate = el("input", { type: "date", value: devis.date || "" });
  iDate.addEventListener("change", () => ctx.majProjet((p) => { devis.date = iDate.value; }));
  const iHtBase = el("input", { type: "number", step: "0.001", min: "0", value: devis.htBase ?? "" });
  iHtBase.addEventListener("change", () => ctx.majProjet((p) => { devis.htBase = Number(iHtBase.value) || 0; }));
  const iMode = el("select", {},
    el("option", { value: "inclus", texte: "PRO RATA INCLUS" }),
    el("option", { value: "valeur", texte: "Valeur du prorata (%)" }));
  iMode.value = (devis.prorata && devis.prorata.mode) || "inclus";
  iMode.addEventListener("change", () => ctx.majProjet((p) => {
    devis.prorata = devis.prorata || {};
    devis.prorata.mode = iMode.value;
  }));
  const iTaux = el("input", { type: "number", step: "0.01", min: "0", value: (devis.prorata && devis.prorata.taux) ?? "", placeholder: "%" });
  iTaux.addEventListener("change", () => ctx.majProjet((p) => {
    devis.prorata = devis.prorata || {};
    devis.prorata.taux = iTaux.value === "" ? null : Number(iTaux.value);
  }));

  carte.append(el("div", { classe: "champs-ligne" }, iNumero, iDate, iHtBase, iMode, iTaux));

  // --- Variantes : cases à cocher (retenue) avec recalcul instantané
  devis.variantes = Array.isArray(devis.variantes) ? devis.variantes : [];
  const tableVariantes = el("table", { classe: "donnees" });
  const tete = el("tr", {},
    el("th", { texte: "Retenue" }), el("th", { texte: "Libellé" }),
    el("th", { texte: "Sens" }), el("th", { texte: "HT (€)" }), el("th", { texte: "" }));
  tableVariantes.append(el("thead", {}, tete));
  const corps = el("tbody");
  function rendreVariantes() {
    corps.replaceChildren();
    if (!devis.variantes.length) {
      corps.append(el("tr", {}, el("td", { colspan: "5", texte: "Aucune variante sur ce devis." })));
    }
    devis.variantes.forEach((variante, index) => {
      const caseCochee = el("input", { type: "checkbox" });
      caseCochee.checked = variante.retenue === true;
      caseCochee.addEventListener("change", () => ctx.majProjet((p) => { variante.retenue = caseCochee.checked; }));
      const iLibelle = el("input", { type: "text", value: variante.libelle || "", placeholder: "Ex. option bardage" });
      iLibelle.addEventListener("change", () => ctx.majProjet((p) => { variante.libelle = iLibelle.value; }, { reRendre: false }));
      const iSens = el("select", {},
        el("option", { value: "plus", texte: "Plus-value" }),
        el("option", { value: "moins", texte: "Moins-value" }),
        el("option", { value: "option", texte: "Option" }));
      iSens.value = variante.sens || "option";
      iSens.addEventListener("change", () => ctx.majProjet((p) => { variante.sens = iSens.value; }));
      const iHt = el("input", { type: "number", step: "0.001", value: variante.ht ?? "" });
      iHt.addEventListener("change", () => ctx.majProjet((p) => { variante.ht = Number(iHt.value) || 0; }));
      corps.append(el("tr", {},
        el("td", {}, caseCochee),
        el("td", {}, iLibelle),
        el("td", {}, iSens),
        el("td", {}, iHt),
        el("td", {}, el("button", { classe: "bouton discret", texte: "supprimer", onClick: () => ctx.majProjet((p) => { devis.variantes.splice(index, 1); }) }))));
    });
  }
  rendreVariantes();
  tableVariantes.append(corps);
  carte.append(el("h3", { texte: "Variantes et options" }), tableVariantes,
    el("div", { classe: "rangee-boutons" },
      el("button", { classe: "bouton", texte: "+ Ajouter une variante", onClick: () => ctx.majProjet((p) => {
        devis.variantes.push({ libelle: "", sens: "option", ht: 0, retenue: false });
      }) })));

  // --- Montants calculés (contrat §8 : montantAvecVariantes puis
  //     appliquerProrata) + retranscription en lettres (montantEnLettres).
  const zoneMontants = el("div");
  function rendreMontants() {
    zoneMontants.replaceChildren();
    if (!calculs || typeof calculs.montantAvecVariantes !== "function") {
      zoneMontants.append(el("p", { classe: "message-attente",
        texte: messageIndisponible("js/calculs.js") + " Montant hors taxes de base saisi : "
          + fmtEuros(Number(devis.htBase) || 0) + "." }));
      return;
    }
    try {
      let montant = calculs.montantAvecVariantes(devis);
      let source = "calcul variantes";
      if (devis.prorata && devis.prorata.mode === "valeur" && devis.prorata.taux !== null && typeof calculs.appliquerProrata === "function") {
        montant = calculs.appliquerProrata(montant.ht, devis.prorata);
        source = "prorata appliqué";
      }
      if (!montant || typeof montant.ttc !== "number") {
        throw new Error("réultat inattendu de montantAvecVariantes");
      }
      const lettres = typeof calculs.montantEnLettres === "function"
        ? calculs.montantEnLettres(montant.ttc)
        : "(montantEnLettres indisponible)";
      zoneMontants.append(
        el("table", { classe: "donnees" },
          el("tbody", {},
            el("tr", {}, el("td", { texte: "HT" }), el("td", { classe: "numerique", texte: fmtEuros(montant.ht) })),
            el("tr", {}, el("td", { texte: "TVA" }), el("td", { classe: "numerique", texte: fmtEuros(montant.tva) })),
            el("tr", {}, el("td", { texte: "TTC" }), el("td", { classe: "numerique", texte: fmtEuros(montant.ttc) })))),
        el("p", { classe: "montant-lettres", texte: "Montant en lettres : " + lettres }),
        el("p", { classe: "entre-deux", texte: "(" + source + ")" }));
    } catch (erreur) {
      zoneMontants.append(el("p", { classe: "message-attente",
        texte: "Calcul impossible : " + (erreur && erreur.message ? erreur.message : erreur) }));
    }
  }
  rendreMontants();
  // Recalcul instantané : tout changement de case/sens/HT/taux re-rend
  // l'écran (majProjet déclenche déjà la sauvegarde automatique).
  const relancer = () => { rendreMontants(); };
  corps.addEventListener("change", relancer);
  iTaux.addEventListener("change", relancer);
  iHtBase.addEventListener("change", relancer);
  iMode.addEventListener("change", relancer);
  carte.append(titreAide("h3", "Montant du marché", "montant-marche"), zoneMontants);
  return carte;
}

/**
 * Écrit l'écran 3 dans le conteneur.
 * @param {HTMLElement} conteneur
 * @param {object} ctx contexte applicatif fourni par app.js
 */
/**
 * Complétude d'une entreprise (SPEC § 6 ter) — la règle vient de js/etat.js
 * (etatEntreprise), on ne la réimplémente pas ici : l'écran AFFICHE ce qui manque,
 * il ne décide pas à la place du modèle.
 */
function blocCompletude(ctx, entreprise) {
  const etat = ctx.services.etat;
  if (!etat || typeof etat.etatEntreprise !== "function") {
    return el("p", { classe: "message-attente", texte: messageIndisponible("js/etat.js") });
  }
  const jugement = etat.etatEntreprise(ctx.projet, entreprise.id);
  if (jugement.osPret) {
    return el("p", { classe: "ligne-completude" },
      el("span", { classe: "pastille vert", texte: "OS prêt" }),
      " toutes les données nécessaires à l'ordre de service sont réunies.");
  }
  return el("p", { classe: "ligne-completude" },
    el("span", { classe: "pastille orange", texte: jugement.crcPret ? "En attente d'OS" : "Incomplète" }),
    " il manque : " + (jugement.manquants.length ? jugement.manquants.join(", ") : "données à compléter")
    + (jugement.crcPret ? "" : " — l'entreprise apparaîtra tout de même dans le compte rendu, avec des cases vides."));
}

/**
 * Ajout d'une entreprise À TOUT MOMENT (SPEC § 6 ter) : on connaît souvent le lot
 * avant de connaître le devis, et le marché se signe plus tard. Un devis n'est donc
 * PAS exigé pour créer une entreprise — c'est la règle centrale de la saisie
 * progressive, et l'inverse obligerait à attendre pour saisir ce qu'on sait déjà.
 */
function blocAjoutEntreprise(ctx) {
  const iNom = el("input", { type: "text", placeholder: "ex. SAS CARRELAGE MODELE" });
  const iLot = el("input", { type: "text", placeholder: "ex. CARRELAGE" });
  const iLotNumero = el("input", { type: "text", placeholder: "n°", classe: "champ-court" });
  const bouton = el("button", { classe: "bouton primaire", texte: "+ Ajouter l'entreprise" });
  bouton.addEventListener("click", () => {
    const nom = iNom.value.trim();
    if (!nom) {
      toast("Indiquez au moins la raison sociale : c'est elle qui identifiera l'entreprise dans le compte rendu.", "erreur");
      return;
    }
    ctx.majProjet((p) => {
      if (!Array.isArray(p.entreprises)) p.entreprises = [];
      p.entreprises.push({
        id: "ent-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        raisonSociale: nom,
        lotNom: iLot.value.trim(),
        lotNumero: iLotNumero.value.trim() || null,
        etat: "pressentie",
      });
    });
    toast("Entreprise ajoutée : « " + nom + " ». Son devis pourra être déposé plus tard.", "succes");
  });
  return el("section", { classe: "carte" },
    el("h2", { texte: "Ajouter une entreprise" }),
    el("p", { classe: "aide", texte: "Une entreprise peut être créée AVANT son devis : on connaît le lot, le marché n'est pas encore signé. Les données inconnues resteront vides dans les documents — jamais inventées — et se compléteront au fil des marchés." }),
    el("div", { classe: "champs-ligne" }, iNom, iLot, iLotNumero, bouton));
}

export function afficher(conteneur, ctx) {
  const { projet } = ctx;
  const entreprises = Array.isArray(projet.entreprises) ? projet.entreprises : [];

  // SPEC § 6 ter : un dossier incomplet est la situation NORMALE en début de chantier.
  // On n'oblige donc jamais à passer par le dépôt d'un devis pour créer une entreprise :
  // le message informe, le formulaire d'ajout reste à disposition plus bas.
  const avertissementVide = entreprises.length ? [] : [
    el("p", { classe: "message-info", texte: "Aucune entreprise pour l'instant : ajoutez-les ci-dessous, ou déposez leurs devis à l'étape 2 (Dépôt), puis cliquez sur « Ajouter ce devis » : l'entreprise est créée ou rattachée à ce clic, pas au dépôt." }),
  ];

  const cartes = [];
  for (const entreprise of entreprises) {
    const devisEntreprise = (projet.devis || []).filter((d) => d && d.entrepriseId === entreprise.id);
    const attestations = (projet.attestations || []).filter((a) => a && a.entrepriseId === entreprise.id);

    // Lot + OS n°1
    const iLotNumero = el("input", { type: "text", value: entreprise.lotNumero || "", placeholder: "n°" });
    iLotNumero.addEventListener("change", () => ctx.majProjet((p) => { entreprise.lotNumero = iLotNumero.value; }, { reRendre: false }));
    const iLotNom = el("input", { type: "text", value: entreprise.lotNom || "", placeholder: "ex. ÉTANCHÉITÉ" });
    iLotNom.addEventListener("change", () => ctx.majProjet((p) => { entreprise.lotNom = iLotNom.value; }));
    const os = (projet.OS || []).find((o) => o && o.entrepriseId === entreprise.id && o.numero === 1);
    const iDebut = el("input", { type: "date", value: (os && os.dateDebut) || "" });
    iDebut.addEventListener("change", () => ctx.majProjet((p) => majOsNumeroUn(p, entreprise.id, iDebut.value)));

    // Attestations enregistrées + relance d'analyse
    const zoneAttestations = el("div");
    if (!attestations.length) {
      zoneAttestations.append(el("p", { classe: "entre-deux", texte: "Aucune pièce administrative enregistrée pour cette entreprise." }));
    } else {
      const liste = el("ul", { classe: "raisons" });
      for (const attestation of attestations) {
        liste.append(el("li", { texte: (LIBELLES_TYPES[attestation.type] || attestation.type)
          + (attestation.valideDu ? " — valable du " + attestation.valideDu + " au " + attestation.valideAu : "")
          + " (source : " + (attestation.sourcePdf || "saisie manuelle") + ")" }));
      }
      zoneAttestations.append(liste);
    }
    const assurances = ctx.services.assurances;
    const boutonReanalyse = el("button", { classe: "bouton", texte: "Relancer l'analyse des attestations" });
    boutonReanalyse.addEventListener("click", async () => {
      if (!assurances || typeof assurances.analyserAttestation !== "function") {
        toast(messageIndisponible("js/assurances.js"), "erreur");
        return;
      }
      let relancees = 0;
      for (const attestation of attestations) {
        const texte = ctx.dossier.textesParSource.get(attestation.sourcePdf);
        if (!texte) continue;
        try {
          const analyse = assurances.analyserAttestation(texte);
          if (analyse) {
            attestation.assureur = analyse.assureur || attestation.assureur;
            attestation.numeroContrat = analyse.numeroContrat || attestation.numeroContrat;
            attestation.valideDu = analyse.valideDu || attestation.valideDu;
            attestation.valideAu = analyse.valideAu || attestation.valideAu;
            if (Array.isArray(analyse.activites) && analyse.activites.length) attestation.activites = analyse.activites;
            if (Array.isArray(analyse.exclusions) && analyse.exclusions.length) attestation.exclusions = analyse.exclusions;
            relancees++;
          }
        } catch { /* une pièce illisible ne bloque pas les autres */ }
      }
      toast(relancees + " attestation(s) analysée(s) à nouveau.", relancees ? "succes" : "erreur");
      if (!relancees) toast("Textes sources non disponibles en mémoire : redéposez les PDF à l'étape 2.", "erreur");
      ctx.reRendre();
    });

    const carte = el("section", { classe: "carte" },
      el("h2", { texte: entreprise.raisonSociale || "(entreprise sans nom)" }),
      el("p", { classe: "entre-deux", texte: (entreprise.representant ? "Représentant : " + entreprise.representant + " — " : "")
        + (entreprise.siren ? "SIREN " + entreprise.siren : "") }),
      blocCompletude(ctx, entreprise),
      blocAssurances(ctx, entreprise),
      el("h3", { texte: "Lot" }),
      el("div", { classe: "champs-ligne" }, iLotNumero, iLotNom),
      titreAide("h3", "Ordre de service n°1 — début des travaux", "os"),
      el("div", { classe: "champs-ligne" }, iDebut),
      titreAide("h3", "Pièces administratives", "depot-pieces"),
      zoneAttestations,
      el("div", { classe: "rangee-boutons" }, boutonReanalyse),
      el("h3", { texte: "Devis actif" }));
    // SPEC § 6 quater : un devis remplacé n'alimente plus aucun document, mais il n'est
    // jamais effacé. L'écran doit donc montrer LES DEUX, sans ambiguïté sur lequel fait foi.
    const estActif = (d) => (d.statut || "actif") === "actif";
    const devisActifs = devisEntreprise.filter(estActif);
    const devisRemplaces = devisEntreprise.filter((d) => !estActif(d));
    if (!devisActifs.length) {
      carte.append(el("p", { classe: "message-attente", texte: devisRemplaces.length
        ? "Aucun devis ACTIF pour cette entreprise : le devis présent a été remplacé. Déposez le devis de remplacement à l'étape 2."
        : "Aucun devis rattaché : déposez-le à l'étape 2, ou laissez vide tant que le marché n'est pas signé." }));
    } else {
      for (const devis of devisActifs) carte.append(blocDevis(ctx, devis));
    }
    if (devisRemplaces.length) {
      carte.append(el("h3", { texte: "Historique — devis remplacés (" + devisRemplaces.length + ")" }));
      const listeHistorique = el("ul", { classe: "raisons" });
      for (const d of devisRemplaces) {
        listeHistorique.append(el("li", { texte: "devis " + (d.numero || "(sans numéro)")
          + (d.date ? " du " + d.date : "")
          + " — remplacé le " + (d.remplaceLe || "date non saisie")
          + (d.motifRemplacement ? " (" + d.motifRemplacement + ")" : "") }));
      }
      carte.append(listeHistorique, el("p", { classe: "aide", texte: "Un devis remplacé n'est jamais effacé : c'est ce qui permet d'expliquer, six mois plus tard, un montant paru dans un document déjà émis." }));
    }
    cartes.push(carte);
  }

  conteneur.replaceChildren(
    el("section", { classe: "carte" },
      titreAide("h2", "Validation des devis et des assurances", "assurances-verdict"),
      el("p", { classe: "aide", texte: "Cochez les variantes retenues avec le maître d'ouvrage : les montants et leur retranscription en lettres se recalculent instantanément. Le voyant d'assurance résume la conformité décennale (art. L. 241-1 du Code des assurances)." }),
    ),
    ...avertissementVide,
    blocAjoutEntreprise(ctx),
    ...cartes,
    el("div", { classe: "carte" }, el("div", { classe: "rangee-boutons" },
      el("button", { classe: "bouton", texte: "← Retour au dépôt", onClick: () => ctx.aller(1) }),
      el("button", { classe: "bouton primaire", texte: "Étape suivante : génération →", onClick: () => ctx.aller(3) }))),
  );
}
