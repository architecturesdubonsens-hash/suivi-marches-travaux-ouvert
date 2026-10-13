// test-devis.mjs — test (exécution réelle) des fonctions pures de js/devis.js, sur des cas
// représentatifs : noms de fichiers de pièces, montants et dates au format français.
// Usage : node tests/test-devis.mjs [url-du-module]

// Cible testable au choix : js/devis.js du dépôt (défaut) ou une URL file:// de module.
const urlCible = process.argv[2] || new URL("../js/devis.js", import.meta.url).href;
const {
  classerPiece, sembleEtreUnDevis, parseMontantFrancais, parseDateLibreFr,
  extraireDevis, fabriqueEntreprise, fabriqueAttestation, suggererEntrepriseDepuisChemin,
} = await import(urlCible);

let ok = 0; let ko = 0;
function verifier(nom, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log("  OK   " + nom); }
  else { ko++; console.error("  FAIL " + nom + "  attendu=" + JSON.stringify(attendu) + "  obtenu=" + JSON.stringify(obtenu)); }
}

console.log("— classification des pièces (noms réels du corpus OP-2026-01)");
verifier("décennale ELEVAL", classerPiece("Attestation d'assurance responsabilite decennale 2025 (2).pdf").type, "RCD");
verifier("décennale GLOBAL CONSTRUCTEUR", classerPiece("Attestations 2025 GLOBAL CONSTRUCTEUR decennale.pdf").type, "RCD");
verifier("RC RCEIC", classerPiece("Attestations 2025 RCEIC responsabilite civile.pdf").type, "RC");
verifier("URSSAF vigilance", classerPiece("URSSAF Attestation de vigilance 10 04 2025.pdf").type, "URSSAF");
verifier("fiscale", classerPiece("Attestation de regularite fiscale 09 04 2025.pdf").type, "FISCALE");
verifier("Kbis", classerPiece("Kbis ELEVAL 2025 02 03.pdf").type, "KBIS");
verifier("Kbis immatriculation", classerPiece("20250224Justificatif_d'Immatriculation_K_Bis.pdf").type, "KBIS");
verifier("Qualibat", classerPiece("CERTIFICAT QUALIBAT DQ 2024_D34-Certificat-3025-E3025-4-20241127.pdf").type, "QUALIBAT");
verifier("CIBTP", classerPiece("20241119 - SEE AQUATHERM Attestation CIBTP (Marchés privés).pdf").type, "TRAVAIL_CACHE");
verifier("RIB -> AUTRE", classerPiece("RIB LCL ALUMINOR ALU OK.pdf").type, "AUTRE");
verifier("RIB -> libellé RIB", classerPiece("RIB LCL ALUMINOR ALU OK.pdf").libelle, "Relevé d'identité bancaire (RIB)");
verifier("fichier sans indice -> inconnu", classerPiece("photo-chantier.pdf").confiance, "inconnu");

console.log("— détection de devis");
verifier("devis par nom", sembleEtreUnDevis("Devis DESAMIA 22041 v2.pdf"), true);
verifier("attestation n'est pas un devis", sembleEtreUnDevis("Attestation URSSAF 2025.pdf"), false);

console.log("— montants écrits à la française");
verifier("97 133,57", parseMontantFrancais("97 133,57"), 97133.57);
verifier("560 000,00 €", parseMontantFrancais("560 000,00 €"), 560000);
verifier("116560.284 (corpus OS)", parseMontantFrancais("116560.284"), 116560.284);
verifier("1 234 567", parseMontantFrancais("1 234 567"), 1234567);
verifier("chaîne vide -> null", parseMontantFrancais(""), null);

console.log("— dates");
verifier("5/3/25 (corpus OS)", parseDateLibreFr("du 5/3/25"), "2025-03-05");
verifier("16/01/2025 (corpus OS)", parseDateLibreFr("devis numéro DEV00000693 du 16/01/2025"), "2025-01-16");
verifier("ISO déjà normalisée", parseDateLibreFr("2025-03-05"), "2025-03-05");

console.log("— extraction devis (texte pdf.js simulé d'après le corpus)");
const texteDevis = "DEVIS N° 22041 v2 du 5/3/25  Rénovation couverture  TOTAL HT : 97 133,57 €  TVA 20% : 19 426,71 €  TOTAL TTC : 116 560,28 €";
const extrait = extraireDevis(texteDevis);
verifier("numéro extrait", extrait.numero, "22041 v2");
verifier("date extraite", extrait.date, "2025-03-05");
verifier("HT extrait", extrait.ht, 97133.57);
verifier("TTC détecté", extrait.ttcDetecte, 116560.28);
const extrait2 = extraireDevis("Proposition commerciale\nMontant hors taxes : 560 000,00 €\nSans total TTC");
verifier("HT par 'montant hors taxes'", extrait2.ht, 560000);
const extrait3 = extraireDevis("Devis general\nPrix de la prestation 25 000 €\nTotal 25 000 €");
verifier("aucune étiquette HT/TTC -> filet sur €", extrait3.ttcDetecte, 25000);

console.log("— fabriques conformes au contrat (SPEC §2)");
const entreprise = fabriqueEntreprise("S.A.S. DESAMIA", { lotNom: "ÉTANCHÉITÉ", lotNumero: "05" });
verifier("id d'entreprise généré", typeof entreprise.id === "string" && entreprise.id.startsWith("ent-"), true);
verifier("champs du contrat présents", Object.keys(entreprise).sort().join(","), ["adresse","cp","forme","id","lotNom","lotNumero","qualiteRepresentant","raisonSociale","representant","siren","siret","ville"].join(","));
const attestation = fabriqueAttestation(entreprise.id, { sourcePdf: "x.pdf", extraction: "texte" });
verifier("champs d'attestation présents", Object.keys(attestation).sort().join(","), ["activites","assureur","entrepriseId","exclusions","extraction","numeroContrat","sourcePdf","type","valideAu","valideDu"].join(","));

console.log("— suggestion d'entreprise depuis un chemin de dépôt réel");
verifier("dossier ELEVAL PA", suggererEntrepriseDepuisChemin("OP-2026-01-CH-PIECES ADMINSTRATIVES\\OP-2026-01 ELEVAL PA\\Kbis ELEVAL 2025 02 03.pdf"), "ELEVAL");

console.log("");
console.log("RÉSULTAT : " + ok + " OK, " + ko + " échec(s)");
process.exit(ko ? 1 : 0);

