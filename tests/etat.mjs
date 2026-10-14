// tests/etat.mjs — tests du modèle de données et de la persistance.
//
// Exécution : node tests/etat.mjs   (Node 24, sans npm ni navigateur)
// Fichier versé dans le dépôt à la demande (25/09/2026) : la
// vérification de js/etat.js avait été menée par script ad-hoc hors dépôt ;
// « aucun livrable ne reste dans un scratch d'agent » — elle est ici opposable.
//
// Herétique par construction : fixtures locales, aucun réseau, aucun navigateur.
// Les fonctions IndexedDB doivent y REJETTER avec le message explicite attendu
// (« IndexedDB indisponible hors navigateur ») — c'est le comportement contractuel
// hors navigateur, pas un incident.

import assert from 'node:assert/strict';
import {
  creerProjetVide, sauvegarderProjet, chargerProjet, exporterJSON, importerJSON,
  etatEntreprise, devisActif, remplacerDevis, marcheSigne, ecartDevis, creerStockageMemoire,
} from '../js/etat.js';

let reussis = 0;
const echecs = [];
async function cas(nom, bloc) {
  try {
    await bloc();
    reussis++;
    console.log('  ok    ' + nom);
  } catch (e) {
    echecs.push(nom);
    console.error('  ECHEC ' + nom);
    console.error('        ' + (e && e.message ? e.message.split('\n')[0] : String(e)));
  }
}

// --------------------------------------------------------------------------
console.log('creerProjetVide (modèle SPEC §2 à jour)');

await cas('socle : AUCUNE agence présupposée, RG 5 %, lieu vide, id généré', () => {
  const p = creerProjetVide();
  // Version ouverte : l'outil ne présuppose rien sur l'agence qui s'en sert. Toute valeur
  // d'identité est vide tant que l'utilisateur ne l'a pas saisie ; seul le titre du bloc est fixe.
  for (const champ of ['raisonSociale', 'forme', 'representant', 'siren', 'siret', 'adresse', 'cp', 'ville', 'tel', 'email', 'lieuFait']) {
    assert.equal(p.agence[champ] ?? null, null, 'agence.' + champ + ' vide par défaut');
  }
  assert.equal(p.agence.titreBloc, "L'agence d'architecture", 'titreBloc : première ligne du bloc agence des gabarits (SPEC §2)');
  assert.equal(p.retenueGarantieTaux, 0.05, 'retenue de garantie 5 %');
  assert.equal(p.operation.lieuFait ?? null, null, 'lieu de « FAIT À » vide tant que l\'utilisateur ne l\'a pas saisi');
  assert.equal(typeof p.id, 'string', 'id généré (clé IndexedDB)');
});

await cas('operation : coutTravauxHT, ouvertureChantier, ouvrageSoumis à null (SPEC §4)', () => {
  const p = creerProjetVide();
  assert.equal(p.operation.coutTravauxHT, null, 'coût total de construction HT à saisir par l\'interface');
  assert.equal(p.operation.ouvertureChantier, null, 'ouverture de chantier réelle à saisir (annexe I art. A. 243-1)');
  assert.equal(p.operation.ouvrageSoumis, null, 'nature soumise/non soumise à déclarer (choisit le seuil applicable)');
});

await cas('listes vides : entreprises, devis, attestations, OS, avenants', () => {
  const p = creerProjetVide();
  for (const liste of ['entreprises', 'devis', 'attestations', 'OS', 'avenants']) {
    assert.deepEqual(p[liste], [], 'liste ' + liste + ' vide');
  }
});

await cas('extensions du CCAP : marche vide (quatre intervenants à null)', () => {
  const p = creerProjetVide();
  assert.deepEqual(p.marche, { controleTechnique: null, sps: null, geotechnicien: null, opc: null },
    'intervenants du CCAP vides, sans valeur inventée');
});

await cas('extensions du CRC : canevas vide — contacts est un OBJET INDEXÉ (arbitrage du 25/09/2026)', () => {
  const p = creerProjetVide();
  assert.equal(p.crc.dateReunion, null, 'date de réunion vide');
  assert.deepEqual(p.crc.intervenants, [], 'intervenants vides');
  assert.deepEqual(p.crc.generalites, [], 'generalites vides');
  assert.deepEqual(p.crc.sections, [], 'sections vides');
  assert.deepEqual(p.crc.contacts, {}, 'contacts = objet indexé vide, PAS un tableau');
  assert.equal(Array.isArray(p.crc.contacts), false, 'contacts ne doit jamais être un tableau (le générateur ne réindexe pas)');
});

// --------------------------------------------------------------------------
console.log('exporterJSON (JSON stable)');

await cas('sortie déterministe, clés triées, aucune Date sérialisée', () => {
  const p = creerProjetVide();
  const j1 = exporterJSON(p);
  const j2 = exporterJSON(p);
  assert.equal(j1, j2, 'deux exports du même objet identiques');
  const o = JSON.parse(j1);
  assert.deepEqual(Object.keys(o), Object.keys(o).slice().sort(), 'clés triées alphabétiquement');
  assert.ok(!/"\d{4}-\d{2}-\d{2}T/.test(j1), 'aucun horodatage avec heure (pas d\'objet Date)');
});

await cas('les extensions crc/marche passent l\'aller-retour export -> relecture', () => {
  const o = JSON.parse(exporterJSON(creerProjetVide()));
  assert.deepEqual(o.marche, { controleTechnique: null, sps: null, geotechnicien: null, opc: null }, 'marche exporté');
  assert.deepEqual(o.crc.contacts, {}, 'contacts exporté en objet indexé vide');
});

// --------------------------------------------------------------------------
console.log('importerJSON (normalisation et tolérance)');

await cas('dates JJ/MM/AAAA -> AAAA-MM-JJ : droc, faitLe, valideDu/valideAu, dateReunion', () => {
  const r = importerJSON(JSON.stringify({
    operation: { reference: 'OP-2026-01', droc: '05/03/2025', faitLe: '27/03/2025' },
    maitreOuvrage: { raisonSociale: 'S.A.S. DISTRIBEX' },
    agence: { raisonSociale: 'X' },
    attestations: [{ entrepriseId: 'eleval', type: 'RCD', valideDu: '01/01/2025', valideAu: '31/12/2025' }],
    crc: { dateReunion: '01/04/2025' },
  }));
  assert.equal(r.operation.droc, '2025-03-05', 'droc normalisée');
  assert.equal(r.operation.faitLe, '2025-03-27', 'faitLe normalisé');
  assert.equal(r.attestations[0].valideDu, '2025-01-01', 'valideDu normalisée');
  assert.equal(r.attestations[0].valideAu, '2025-12-31', 'valideAu normalisée');
  assert.equal(r.crc.dateReunion, '2025-04-01', 'dateReunion (extension CRC) normalisée');
});

await cas('pcDelivreLe (date de délivrance du permis, page 1) : défaut inconnu, JJ/MM/AAAA -> AAAA-MM-JJ, dossier ancien toléré', () => {
  assert.equal(creerProjetVide().operation.pcDelivreLe, null, 'défaut null : date inconnue, jamais inventée');
  const base = { maitreOuvrage: { raisonSociale: 'S.A.S. DISTRIBEX' }, agence: { raisonSociale: 'X' } };
  const r = importerJSON(JSON.stringify({ ...base, operation: { reference: 'OP-2026-01', pc: 'PC 031 123 25 A0001', pcDelivreLe: '12/03/2025' } }));
  assert.equal(r.operation.pcDelivreLe, '2025-03-12', 'pcDelivreLe normalisée comme droc et faitLe');
  assert.equal(r.operation.pc, 'PC 031 123 25 A0001', 'le numéro du permis n\'est pas altéré');
  const ancien = importerJSON(JSON.stringify({ ...base, operation: { reference: 'OP-2026-01', pc: 'PC 1' } }));
  assert.ok(ancien.operation.pcDelivreLe == null || ancien.operation.pcDelivreLe === '', 'dossier enregistré avant ce champ : toléré, valeur vide');
});

await cas('défauts complétés à l\'import : RG, pénalités, listes, équipe', () => {
  const r = importerJSON(JSON.stringify({ operation: {}, maitreOuvrage: {}, agence: {} }));
  assert.equal(r.retenueGarantieTaux, 0.05, 'RG par défaut');
  assert.ok(r.penalites.tauxJournalier > 0 && r.penalites.tauxJournalier < 1, 'pénalités par défaut');
  assert.deepEqual(r.entreprises, [], 'entreprises par défaut');
  assert.deepEqual(r.equipe.conducteursTravaux, [], 'équipe par défaut');
});

await cas('un projet SANS crc/marche reçoit les canevas vides (tolérance d\'absence, SPEC §2)', () => {
  const r = importerJSON(JSON.stringify({ operation: {}, maitreOuvrage: {}, agence: {} }));
  assert.deepEqual(r.crc.contacts, {}, 'contacts = objet indexé vide');
  assert.deepEqual(r.marche, { controleTechnique: null, sps: null, geotechnicien: null, opc: null }, 'marche vide complet');
});

await cas('un crc PARTIEL est complété sans écraser les données présentes', () => {
  const r = importerJSON(JSON.stringify({
    operation: {},
    maitreOuvrage: {},
    agence: {},
    crc: { intervenants: [{ role: 'MO' }] },
  }));
  assert.equal(r.crc.intervenants.length, 1, 'donnée présente conservée');
  assert.deepEqual(r.crc.sections, [], 'clé manquante complétée');
  assert.deepEqual(r.marche, { controleTechnique: null, sps: null, geotechnicien: null, opc: null }, 'marche par défaut');
});

await cas('erreurs explicites : date non reconnue, JSON invalide, section obligataire absente, liste non tableau', () => {
  assert.throws(
    () => importerJSON(JSON.stringify({ operation: { droc: '03/2025' }, maitreOuvrage: {}, agence: {} })),
    /date non reconnue/,
    'date ambiguë refusée',
  );
  assert.throws(() => importerJSON('{pas du json'), /JSON invalide/, 'JSON cassé refusé');
  assert.throws(
    () => importerJSON(JSON.stringify({ operation: {}, maitreOuvrage: {} })),
    /section obligataire absente « agence »/,
    'section agence exigée',
  );
  assert.throws(
    () => importerJSON(JSON.stringify({ operation: {}, maitreOuvrage: {}, agence: {}, entreprises: 'x' })),
    /doit être un tableau/,
    'liste non tableau refusée',
  );
});

// --------------------------------------------------------------------------
console.log('persistance IndexedDB (hors navigateur : rejet contractuel)');

await cas('sauvegarderProjet : rejet explicite « IndexedDB indisponible hors navigateur »', async () => {
  await assert.rejects(() => sauvegarderProjet(creerProjetVide()), /IndexedDB indisponible hors navigateur/);
});

await cas('chargerProjet : rejet explicite hors navigateur', async () => {
  await assert.rejects(() => chargerProjet('x'), /IndexedDB indisponible hors navigateur/);
});

// --------------------------------------------------------------------------
console.log('complétude et cycle de vie des pièces (SPEC § 6 ter et § 6 quater)');
//
// Ces cas couvrent les fonctions livrées avec le port de stockage : sans eux,
// la règle la plus structurante du projet — « une entreprise incomplète ne doit
// jamais empêcher l'émission de l'OS d'une entreprise prête » — reposerait sur
// du code non éprouvé.

function projetEssai() {
  const p = creerProjetVide();
  p.entreprises = [
    { id: 'macon', raisonSociale: 'SAS MACONNERIE DURAND', lotNom: 'GROS OEUVRE', lotNumero: 2 },
    { id: 'carrelage', raisonSociale: 'SARL CARRELAGE MODELE', lotNom: 'CARRELAGE' },
  ];
  p.devis = [{ id: 'd-1', entrepriseId: 'macon', numero: 'D-1', date: '2025-03-05', htBase: 100000, statut: 'actif' }];
  p.OS = [{ entrepriseId: 'macon', numero: 1, dateDebut: '2025-04-28' }];
  return p;
}

await cas('complétude : l entreprise prête est OS-prête et CRC-prête', () => {
  const j = etatEntreprise(projetEssai(), 'macon');
  assert.equal(j.osPret, true, 'OS prêt');
  assert.equal(j.crcPret, true, 'CRC prêt');
  assert.deepEqual(j.manquants, [], 'aucun manque');
});

await cas('complétude : l entreprise réduite est DÉCRITE, jamais bloquante', () => {
  const j = etatEntreprise(projetEssai(), 'carrelage');
  assert.equal(j.osPret, false, 'OS pas prêt');
  assert.equal(j.crcPret, true, 'CRC prêt : raison sociale et lot suffisent (lignes vides du tableau)');
  assert.ok(j.manquants.includes('devis retenu'), 'le manque est nommé en clair : ' + j.manquants.join(' ; '));
  assert.ok(j.manquants.includes("date de l'ordre de service"), 'la date manquante est nommée');
});

await cas('complétude : ajouter une entreprise incomplète ne change rien à la prête', () => {
  const p = projetEssai();
  const avant = etatEntreprise(p, 'macon');
  p.entreprises.push({ id: 'troisieme', raisonSociale: '' });
  assert.deepEqual(etatEntreprise(p, 'macon'), avant, 'non-régression : la règle centrale du § 6 ter');
});

await cas('complétude : entreprise inconnue = description, pas exception', () => {
  const j = etatEntreprise(projetEssai(), 'inconnue');
  assert.equal(j.osPret, false);
  assert.equal(j.crcPret, false);
  assert.match(j.manquants[0], /introuvable/);
});

await cas('devisActif : rend l actif, ignore le remplacé, tolère l absence de statut', () => {
  const p = creerProjetVide();
  p.devis = [
    { id: 'a', entrepriseId: 'x', htBase: 10, statut: 'actif' },
    { id: 'b', entrepriseId: 'x', htBase: 20, statut: 'remplace' },
    { id: 'c', entrepriseId: 'x', htBase: 30 },
  ];
  assert.equal(devisActif(p, 'x').id, 'c', 'le dernier actif gagne ; absence de statut = actif (dossiers anciens)');
  assert.equal(devisActif(p, 'y'), null, 'aucun devis : null, jamais une exception');
});

await cas('remplacerDevis : l ancien est conservé et marqué, le nouveau devient actif', () => {
  const p = projetEssai();
  const apres = remplacerDevis(p, 'd-1', { numero: 'D-2', date: '2025-03-20', htBase: 110000 },
    { motif: 'Modification de dernière minute', date: '2025-03-21' });
  assert.equal(p.devis.length, 1, 'le projet reçu n est pas muté (fonction pure)');
  assert.equal(apres.devis.length, 2, 'les deux pièces coexistent : rien n est effacé');
  const ancien = apres.devis.find((d) => d.id === 'd-1');
  assert.equal(ancien.statut, 'remplace');
  assert.equal(ancien.remplaceLe, '2025-03-21', 'date du remplacement');
  assert.equal(ancien.motifRemplacement, 'Modification de dernière minute');
  assert.equal(ancien.remplacePar, devisActif(apres, 'macon').id, 'lien vers le remplaçant');
  assert.equal(devisActif(apres, 'macon').htBase, 110000, 'le nouveau devis est celui que les documents utiliseront');
});

await cas('remplacerDevis : on ne remplace pas deux fois la même pièce', () => {
  const p = remplacerDevis(projetEssai(), 'd-1', { htBase: 1 });
  assert.throws(() => remplacerDevis(p, 'd-1', { htBase: 2 }), /déjà remplacé/,
    'remplacer une pièce déjà remplacée effacerait la trace du premier remplacement');
});

await cas('marcheSigne : vrai si un OS existe ou si le marché est arrêté', () => {
  const p = projetEssai();
  assert.equal(marcheSigne(p, 'macon'), true, 'un OS existe : il suit la signature');
  assert.equal(marcheSigne(p, 'carrelage'), false, 'ni OS ni marché arrêté');
  p.entreprises[1].etat = 'marche_arrete';
  assert.equal(marcheSigne(p, 'carrelage'), true, 'marché arrêté déclaré');
});

await cas('ecartDevis : plus-value, moins-value, et montants toujours positifs', () => {
  const plus = ecartDevis(100000, 110000);
  assert.equal(plus.sens, 'plus');
  assert.equal(plus.ht, 10000);
  assert.equal(plus.tva, 2000);
  assert.equal(plus.ttc, 12000);
  const moins = ecartDevis({ htBase: 110000 }, { htBase: 100000 });
  assert.equal(moins.sens, 'moins');
  assert.equal(moins.ht, 10000, 'une moins-value est POSITIVE : c est sens qui porte la direction (SPEC § 3)');
  assert.equal(ecartDevis(1000, 2000, { tvaTaux: 0.05 }).tva, 50, 'le taux est un paramètre, jamais une constante');
});

await cas('port de stockage : l adaptateur mémoire sauvegarde, liste, charge et supprime', async () => {
  const port = creerStockageMemoire();
  const p = creerProjetVide();
  p.operation.reference = 'OP-2026-01';
  await port.sauvegarder(p);
  assert.equal((await port.charger(p.id)).operation.reference, 'OP-2026-01', 'projet relu');
  const relu = await port.charger(p.id);
  relu.operation.reference = 'MUTATION';
  assert.equal((await port.charger(p.id)).operation.reference, 'OP-2026-01',
    'le port rend une COPIE : muter la relecture ne touche pas le stockage');
  assert.equal((await port.lister()).length, 1, 'listé');
  await port.supprimer(p.id);
  assert.equal((await port.lister()).length, 0, 'supprimé');
  await port.supprimer(p.id); // idempotent : ne lève pas
});

await cas('l historique des pièces survit à l export/import JSON', () => {
  const p = remplacerDevis(projetEssai(), 'd-1', { id: 'd-2', htBase: 110000 }, { motif: 'x', date: '2025-03-21' });
  const relu = importerJSON(exporterJSON(p));
  assert.equal(relu.devis.length, 2, 'les deux devis sont conservés');
  assert.equal(relu.devis.find((d) => d.id === 'd-1').statut, 'remplace', 'le statut survit à l aller-retour');
  assert.equal(devisActif(relu, 'macon').id, 'd-2', 'le devis actif est le même après export puis import');
});

// --------------------------------------------------------------------------
console.log('');
if (echecs.length > 0) {
  console.error('BILAN etat : ' + reussis + ' ok, ' + echecs.length + ' ECHEC(s) -> ' + echecs.join(' ; '));
  process.exitCode = 1;
} else {
  console.log('BILAN etat : ' + reussis + ' cas ok, 0 échec.');
}
