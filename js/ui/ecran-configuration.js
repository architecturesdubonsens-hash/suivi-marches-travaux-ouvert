// js/ui/ecran-configuration.js
//
// ÉCRAN 1 — CONFIGURATION du projet : opération, maître d'ouvrage, agence,
// équipe (architecte signataire + conducteurs de travaux), paramètres
// financiers (retenue de garantie 5 %, pénalités). Valeurs pré-remplies
// depuis js/referentiels.js quand ce module est disponible.

import { el } from "./helpers.js";
import { titreAide } from "./bulle.js";
import { messageIndisponible } from "./etat-modules.js";
import { blocSauvegardeLocale } from "./sauvegarde-locale.js";

/** Lecture d'un chemin "a.b.c" sur un objet, avec valeur par défaut. */
function lireChemin(obj, chemin, defaut = "") {
  const valeur = chemin.split(".").reduce((acc, cle) => (acc == null ? undefined : acc[cle]), obj);
  return valeur === undefined || valeur === null ? defaut : valeur;
}

/** Écriture d'un chemin "a.b.c" (crée les niveaux intermédiaires). */
function definirChemin(obj, chemin, valeur) {
  const morceaux = chemin.split(".");
  let cible = obj;
  for (let i = 0; i < morceaux.length - 1; i++) {
    if (typeof cible[morceaux[i]] !== "object" || cible[morceaux[i]] === null) cible[morceaux[i]] = {};
    cible = cible[morceaux[i]];
  }
  cible[morceaux[morceaux.length - 1]] = valeur;
}

/**
 * Champ de saisie lié au projet : chaque modification écrit immédiatement dans
 * l'objet projet (auto-sauvegarde déclenchée par app.js), sans re-rendu.
 */
function champProjet(projet, majProjet, chemin, libelle, options = {}) {
  const type = options.type || "text";
  const valeur = lireChemin(projet, chemin, options.defaut !== undefined ? options.defaut : "");
  const input = el("input", {
    type,
    value: valeur === undefined || valeur === null ? "" : String(valeur),
    id: "conf-" + chemin.replace(/\./g, "-"),
    placeholder: options.placeholder || "",
    min: options.min, max: options.max, step: options.step,
    list: options.liste || null,
  });
  input.addEventListener("input", () => {
    let v = input.value;
    if (type === "number") {
      if (v === "") { v = options.defaut !== undefined ? options.defaut : null; }
      else { v = Number(v); if (!isFinite(v)) return; }
    }
    majProjet((p) => definirChemin(p, chemin, v), { reRendre: false });
  });
  return el("div", { classe: "champ" + (options.etendu ? " etendu" : "") },
    el("label", { for: input.id, texte: libelle }), input);
}

/**
 * Écrit l'écran 1 dans le conteneur.
 * @param {HTMLElement} conteneur
 * @param {object} ctx contexte applicatif fourni par app.js
 */
export function afficher(conteneur, ctx) {
  const { projet, majProjet } = ctx;
  const referentiels = ctx.services.referentiels;

  // Pré-remplissage depuis le référentiel : uniquement si les champs
  // sont encore vides, pour ne jamais écraser une saisie existante.
  if (referentiels && referentiels.AGENCE_PAR_DEFAUT) {
    const a = referentiels.AGENCE_PAR_DEFAUT;
    let modifie = false;
    for (const [cle, valeur] of Object.entries(a)) {
      if (cle === "lieuFait") {
        if (!projet.operation.lieuFait) { projet.operation.lieuFait = valeur; modifie = true; }
        continue;
      }
      if (projet.agence[cle] !== undefined && !projet.agence[cle]) { projet.agence[cle] = valeur; modifie = true; }
    }
    if (modifie) majProjet(() => {}, { reRendre: false });
  }

  const carteOperation = el("section", { classe: "carte" },
    titreAide("h2", "1 · Opération", "operation"),
    el("p", { classe: "aide", texte: "Référence de l'opération (format interne, ex. OP-2026-01), intitulé et localisation. La DROC (date réglementaire d'ouverture du chantier) sert au contrôle des attestations d'assurance." }),
    el("div", { classe: "grille-champs" },
      champProjet(projet, majProjet, "operation.reference", "Référence", { placeholder: "OP-2026-01", etendu: false }),
      champProjet(projet, majProjet, "operation.intitule", "Intitulé de l'opération", { etendu: true, placeholder: "Réfection de la couverture, dépollution…" }),
      champProjet(projet, majProjet, "operation.adresse", "Adresse"),
      champProjet(projet, majProjet, "operation.cp", "Code postal"),
      champProjet(projet, majProjet, "operation.ville", "Ville"),
      champProjet(projet, majProjet, "operation.droc", "DROC (début des travaux)", { type: "date" }),
      champProjet(projet, majProjet, "operation.dureePrevisionnelleMois", "Durée prévisionnelle (mois)", { type: "number", min: "0", step: "1" }),
      champProjet(projet, majProjet, "operation.pc", "N° de permis de construire"),
      champProjet(projet, majProjet, "operation.faitLe", "Fait le (date OS/MT)", { type: "date" }),
      champProjet(projet, majProjet, "operation.lieuFait", "Fait à (lieu)"),
    ));

  const carteMo = el("section", { classe: "carte" },
    el("h2", { texte: "2 · Maître d'ouvrage" }),
    el("div", { classe: "grille-champs" },
      champProjet(projet, majProjet, "maitreOuvrage.raisonSociale", "Raison sociale", { etendu: true }),
      champProjet(projet, majProjet, "maitreOuvrage.representant", "Représentant"),
      champProjet(projet, majProjet, "maitreOuvrage.qualiteRepresentant", "Qualité (gérant, co-dirigeant…)"),
      champProjet(projet, majProjet, "maitreOuvrage.siren", "SIREN"),
      champProjet(projet, majProjet, "maitreOuvrage.adresse", "Adresse"),
      champProjet(projet, majProjet, "maitreOuvrage.cp", "Code postal"),
      champProjet(projet, majProjet, "maitreOuvrage.ville", "Ville"),
    ));

  const carteAgence = el("section", { classe: "carte" },
    el("h2", { texte: "3 · Agence" }),
    referentiels
      ? el("p", { classe: "message-info", texte: "Profil pré-rempli depuis les données de référence — vérifiez puis complétez." })
      : el("p", { classe: "message-attente", texte: messageIndisponible("js/referentiels.js") }),
    el("div", { classe: "grille-champs" },
      champProjet(projet, majProjet, "agence.raisonSociale", "Raison sociale"),
      champProjet(projet, majProjet, "agence.forme", "Forme juridique", { placeholder: "S.A.R.L." }),
      champProjet(projet, majProjet, "agence.representant", "Représentant", { liste: "liste-architectes" }),
      champProjet(projet, majProjet, "agence.siren", "SIREN"),
      champProjet(projet, majProjet, "agence.siret", "SIRET"),
      champProjet(projet, majProjet, "agence.adresse", "Adresse"),
      champProjet(projet, majProjet, "agence.cp", "Code postal"),
      champProjet(projet, majProjet, "agence.ville", "Ville"),
      champProjet(projet, majProjet, "agence.tel", "Téléphone"),
      champProjet(projet, majProjet, "agence.email", "Courriel"),
    ));

  // Liste des architectes proposés au datalist (référentiel ou saisie libre).
  const listeArchitectes = el("datalist", { id: "liste-architectes" });
  if (referentiels && referentiels.AGENCE_PAR_DEFAUT && referentiels.AGENCE_PAR_DEFAUT.representant) {
    listeArchitectes.append(el("option", { value: referentiels.AGENCE_PAR_DEFAUT.representant }));
  }

  // Équipe : architecte signataire (un) + conducteurs de travaux (plusieurs).
  const zoneConducteurs = el("div");
  function rendreConducteurs() {
    zoneConducteurs.replaceChildren();
    const conducteurs = Array.isArray(projet.equipe.conducteursTravaux) ? projet.equipe.conducteursTravaux : [];
    conducteurs.forEach((nom, index) => {
      const input = el("input", { type: "text", value: nom, placeholder: "Nom du conducteur de travaux" });
      input.addEventListener("input", () => majProjet((p) => { p.equipe.conducteursTravaux[index] = input.value; }, { reRendre: false }));
      zoneConducteurs.append(el("div", { classe: "ligne-actions" },
        input,
        el("button", {
          classe: "bouton", type: "button", texte: "Retirer",
          onClick: () => majProjet((p) => { p.equipe.conducteursTravaux.splice(index, 1); rendreConducteurs(); }),
        })));
    });
    if (!conducteurs.length) {
      zoneConducteurs.append(el("p", { classe: "entre-deux", texte: "Aucun conducteur de travaux déclaré." }));
    }
  }
  const boutonConducteur = el("button", {
    classe: "bouton", type: "button", texte: "+ Ajouter un conducteur de travaux",
    onClick: () => majProjet((p) => {
      if (!Array.isArray(p.equipe.conducteursTravaux)) p.equipe.conducteursTravaux = [];
      p.equipe.conducteursTravaux.push("");
      rendreConducteurs();
    }),
  });

  const carteEquipe = el("section", { classe: "carte" },
    el("h2", { texte: "4 · Équipe agence" }),
    el("div", { classe: "grille-champs" },
      champProjet(projet, majProjet, "equipe.architecteSignataire", "Architecte signataire", { liste: "liste-architectes", etendu: true }),
    ),
    listeArchitectes,
    el("h3", { texte: "Conducteurs de travaux (plusieurs possibles)" }),
    zoneConducteurs,
    el("div", { classe: "rangee-boutons" }, boutonConducteur),
  );
  rendreConducteurs();

  // Paramètres financiers : retenue de garantie (5 % par défaut, SPEC §3)
  // et pénalités de retard (taux journalier + plafond en % du marché).
  const carteParametres = el("section", { classe: "carte" },
    titreAide("h2", "5 · Paramètres financiers", "parametres-financiers"),
    el("div", { classe: "grille-champs" },
      champProjet(projet, majProjet, "retenueGarantieTaux", "Retenue de garantie (taux)", { type: "number", defaut: 0.05, step: "0.01", min: "0", max: "0.2" }),
      champProjet(projet, majProjet, "penalites.tauxJournalier", "Pénalités : taux journalier", { type: "number", step: "0.001", min: "0", placeholder: "ex. 0.01 (1 ‰ / jour)" }),
      champProjet(projet, majProjet, "penalites.montantMaxPct", "Pénalités : plafond (% du marché)", { type: "number", step: "0.01", min: "0", placeholder: "ex. 5" }),
    ));

  const nav = el("div", { classe: "rangee-boutons" },
    el("button", {
      classe: "bouton primaire", texte: "Étape suivante : dépôt des devis et pièces →",
      onClick: () => ctx.aller(1),
    }));

  conteneur.replaceChildren(
    el("section", { classe: "carte" },
      el("h2", { texte: "Configuration du projet" }),
      el("p", { classe: "aide", texte: "Saisie unique : ces données alimentent sans ressaisie le Marché de Travaux, les Ordres de Service, le CRC et les fiches d'avenant." }),
    ),
    blocSauvegardeLocale(ctx),
    carteOperation, carteMo, carteAgence, carteEquipe, carteParametres,
    el("div", { classe: "carte" }, nav),
  );
}
