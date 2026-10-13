// tests/assurances.mjs — tests du contrôle d'assurances.
//
// Exécution : node tests/assurances.mjs   (Node 24, sans npm ni navigateur)
// Cas d'essai RÉEL : l'attestation RCD ELEVAL du dossier OP-2026-01
// (Abeille IARD & Santé, contrat EDIFICE n° 10000042, période
// 01/01/2025-31/12/2025, activités S839 + S899, clause « travaux accessoires »).
// Le texte est d'abord testé en fixture embarquée (test hermétique), puis tel
// quel depuis les documents d’origine (donnée réelle du dépôt).
//
// Second gabarit testé : SMABTP « CAP 2000 » — SARL PLATERIA (scan sans couche
// texte, retranscrite) : période « Période de validité :
// du ... au ... », activités en liste à puces SANS code, sous-traitance garantie
// même hors périmètre. Les tests imposent le multi-gabarits de analyserAttestation.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyserAttestation, adequationActivite, controler } from '../js/assurances.js';
import { creerProjetVide } from '../js/etat.js';
import { ENTREPRISES_EXEMPLE } from '../js/referentiels.js';

let reussis = 0;
const echecs = [];
function cas(nom, bloc) {
  try {
    bloc();
    reussis++;
    console.log('  ok    ' + nom);
  } catch (e) {
    echecs.push(nom);
    console.error('  ECHEC ' + nom);
    console.error('        ' + (e && e.message ? e.message.split('\n')[0] : String(e)));
  }
}

// --------------------------------------------------------------------------
// Fixture hermétique : passage ESSENTIEL d'une attestation décennale (programme EDIFICE),
// reconstitué avec des valeurs fictives.
const FIXTURE_KONE = [
  'Abeille IARD & Santé',
  'Siège social : 13 rue du Moulin Bailly - 92270 Bois-Colombes.',
  'Standard',
  '1/5',
  'ATTESTATION D\'ASSURANCE',
  'ASSURANCE DE RESPONSABILITE DECENNALE OBLIGATOIRE',
  'EDIFICE',
  'Valable pour la période du 01/01/2025 au 31/12/2025',
  'Abeille IARD & Santé',
  'SA ELEVAL',
  'ZAC DE L EXEMPLE',
  '455 AVENUE DU TEST',
  'CS 93316',
  '12206 GRANDVILLE CEDEX 3',
  'La société Abeille IARD & Santé certifie que SA  ELEVAL , immatriculé(e) sous le n°100000058, est titulaire d\'un contrat',
  'EDIFICE en vigueur n° 10000042 garantissant les activités visées ci-après, à l\'exclusion de toute autre, exercées par',
  'l\'Assuré lui-même ou par ses sous traitants, dans le cadre d\'un contrat de louage ou de sous-traitance et afférentes à des',
  'travaux de construction :',
  'Pour des ouvrages soumis à l\'obligation d\'assurance édictée par l\'article L.241-1 du Code des assurances :',
  'S839 – Ascenseur – monte charge – monte personne – escalier mécanique et trottoir roulant',
  'Réalisation d\'ascenseur, de monte-charge, monte-personne, escalier mécanique et trottoir roulant, y compris les organes',
  'et équipements nécessaires à leur fonctionnement.',
  'S899',
  'Activités secondaires et accessoires',
  'Fourniture et pose d\'antennes de réception hertzienne et satellitaire, de sas bancaires et sas',
  'd\'étanchéité, d\'équipements de quai de chargement, y compris niveleurs, de barrières de piscines et',
  'de clôtures de sites, de porte-tourniquet, de couloir d\'accès contrôlé, de contrôle d\'accès (type',
  'VIGIK, interphone, vidéophone), installation d\'élévateurs de personnes à mobilité réduite (EPMR) et',
  'd\'élévateur à usage particulier (EUP), de plateformes élévatrices.',
  'Fourniture et pose de portes automatiques de bâtiment (porte de garage, portes piétonnes de bloc',
  'opératoires, portes sectionnelles, portes coupe-feu).',
  'Cette activité comprend les travaux accessoires de serrurerie-métallerie, fermetures, électricité et',
  'petits travaux de maçonnerie.',
  'Pour des ouvrages non soumis à l\'obligation d\'assurance, visés à l\'article L.243-1-1 du Code des assurances:',
  'G899',
  'Ascenseurs',
  'Réalisation de travaux visés aux',
  'La notion des travaux accessoires et/ou complémentaires, comprend la réalisation des travaux nécessaires et',
  'indispensables à l\'exécution des travaux relevant de l\'activité principale définie. Ces travaux répertoriés comme',
  'accessoires ou complémentaires ne peuvent faire l\'objet d\'un marché de travaux à part entière. Si tel est le cas,',
  'l\'attestation d\'assurance doit reproduire précisément l\'activité objet du marché des travaux. A l\'inverse, ces travaux',
  'seraient alors réputés non garantis.',
  'aux chantiers dont le coût total de construction HT tous corps d\'état, y compris honoraires, déclaré par le maître',
  'd\'ouvrage n\'est pas supérieur à la somme de 15 000 000 EUR.',
].join('\n');

const ELEVAL = ENTREPRISES_EXEMPLE.find((e) => e.id === 'eleval');
assert.ok(ELEVAL, 'entreprise ELEVAL présente dans ENTREPRISES_EXEMPLE');

// --------------------------------------------------------------------------
console.log('analyserAttestation (fixture ELEVAL embarquée)');

const analyseEleval = analyserAttestation(FIXTURE_KONE);

cas('type détecté : RCD', () => {
  assert.equal(analyseEleval.type, 'RCD', 'assurance de responsabilité décennale obligatoire -> RCD');
});

cas('assureur détecté : Abeille IARD & Santé', () => {
  assert.equal(analyseEleval.assureur, 'Abeille IARD & Santé', 'première ligne utile de l\'en-tête');
});

cas('contrat : n° 10000042, programme EDIFICE, assuré SA ELEVAL (n° 100000058)', () => {
  assert.equal(analyseEleval.numeroContrat, '10000042', 'numéro de contrat EDIFICE');
  assert.equal(analyseEleval.programme, 'EDIFICE', 'nom du programme contractuel');
  assert.equal(analyseEleval.assure, 'SA ELEVAL', 'assuré nommé dans la phrase « certifie que ... »');
});

cas('période : 01/01/2025 au 31/12/2025 -> 2025-01-01 / 2025-12-31', () => {
  assert.equal(analyseEleval.valideDu, '2025-01-01', 'début de période au canon AAAA-MM-JJ');
  assert.equal(analyseEleval.valideAu, '2025-12-31', 'fin de période au canon AAAA-MM-JJ');
});

cas('activités garanties : S839, S899, G899 avec libellés', () => {
  const codes = analyseEleval.activites.map((a) => a.code);
  for (const attendu of ['S839', 'S899', 'G899']) {
    assert.ok(codes.includes(attendu), 'code ' + attendu + ' attendu, codes reçus : ' + codes.join(', '));
  }
  const s839 = analyseEleval.activites.find((a) => a.code === 'S839');
  assert.match(s839.libelle, /Ascenseur/, 'libellé S839 porte « Ascenseur »');
  const s899 = analyseEleval.activites.find((a) => a.code === 'S899');
  assert.match(s899.libelle, /Activités secondaires/, 'libellé S899 porte « Activités secondaires »');
});

cas('exclusions : clause « travaux accessoires » + limite de coût 15 000 000 EUR', () => {
  assert.ok(
    analyseEleval.exclusions.some((x) => /travaux accessoires/.test(x)),
    'la clause travaux accessoires (marché à part entière) doit être repérée ; reçues : ' + JSON.stringify(analyseEleval.exclusions),
  );
  assert.ok(
    analyseEleval.exclusions.some((x) => /15 000 000/.test(x)),
    'la limite de coût total de construction doit être repérée',
  );
});

cas('champs de traçage : extraction « texte », entrepriseId et sourcePdf à rattacher', () => {
  assert.equal(analyseEleval.extraction, 'texte', 'extraction depuis une couche texte');
  assert.equal(analyseEleval.entrepriseId, null, 'rattachement à une entreprise = travail de l\'interface');
  assert.equal(analyseEleval.sourcePdf, null, 'sourcePdf inconnu au niveau texte');
});

cas('entrée invalide : texte vide refusé', () => {
  assert.throws(() => analyserAttestation('   '), /texte non vide/, 'texte vide refusé');
});

cas('seuil de coût de la police ELEVAL/Abeille restitué : soumisHT = 15 000 000 (page 3 du gabarit)', () => {
  assert.deepEqual(analyseEleval.plafonds, { soumisHT: 15000000 }, 'limite de coût des ouvrages soumis portée par le gabarit Abeille ; reçu : ' + JSON.stringify(analyseEleval.plafonds));
});

// --------------------------------------------------------------------------
console.log('analyserAttestation (second gabarit : SMABTP CAP 2000 — scan retranscrit, fiche attestation-plateria-cap2000.md)');

// Fixture hermétique d'une attestation décennale (programme CAP 2000), valeurs fictives
// (apostrophe typographique volontaire dans deux lignes pour éprouver la normalisation OCR).
const FIXTURE_SMABTP = [
  'SMABTP — Société mutuelle d\u2019assurance du bâtiment et des travaux publics',
  'RCS Paris 775 684 764',
  'Agence SMABTP Toulouse, CS 77643, 92 allée du Lac, 31676 Labège Cedex',
  'ATTESTATION D\'ASSURANCE',
  'RESPONSABILITE DECENNALE',
  'SARL PLATERIA',
  '8 rue du Modèle, ZI Nord, 12000 HAUTMONT-TEST',
  'SIREN 100000025',
  'Contrat : CAP 2000 n° 9990001 / 001 999999/143 — n° assuré 999999B',
  'Période de validité : du 01/01/2025 au 31/12/2025',
  'Périmètre des activités professionnelles garanties :',
  '- carrelages mosaïques',
  '- plâtrerie – faux plafonds',
  '- revêtements textiles et plastiques',
  '- structure et travaux courants de maçonnerie – béton armé',
  '- chapes fluides (ciment et anhydrite) – chapes traditionnelles',
  '- cloisons industrialisées de structure métallique',
  '- isolation acoustique',
  '- plâtrerie à base de plaques de plâtre',
  '- parquets, faux plafonds, plancher technique INTERCELL (avis technique 3/03-412)',
  '- isolation thermique – faux plafonds',
  '- application de matériaux synthétiques (sur toiture) – étanchéité sous carrelage',
  '- aménagements de locaux',
  '- menuiserie en bois (sans charpente)',
  '- démolition',
  '- revêtements de sols industriels',
  'Lorsque l\'assuré donne des travaux en sous-traitance, la garantie lui reste acquise même s\u2019ils ne correspondent pas aux activités déclarées ci-dessus.',
  // --- pages 2 à 5 (fiche attestation-plateria-cap2000-pages2-5.md) ---
  'Les garanties objet de la présente attestation s\'appliquent :',
  'aux travaux ayant fait l\'objet d\'une ouverture de chantier pendant la période de validité mentionnée ci-dessus. L\'ouverture de chantier est définie à l\'annexe I à l\'article A. 243-1 du code des assurances.',
  'aux chantiers dont le coût total de construction H.T., tous corps d\'état (honoraires compris), déclaré par le maître d\'ouvrage, n\'est pas supérieur à 26 000 000 €.',
  'Au-delà de ce seuil, la garantie est illimitée en présence d\'un contrat collectif de responsabilité décennale (CCRD), avec franchise absolue au maximum de 10 000 000 € (travaux incluant la structure ou le gros œuvre), 6 000 000 € (hors structure et gros œuvre), 3 000 000 € (assuré concepteur non réalisateur).',
  'Responsabilité civile décennale obligatoire : garantie des articles 1792 et suivants du code civil, dans les limites des articles L. 241-1, L. 241-2 et L. 243-1-1 du code des assurances ; le montant couvre le coût de réparation dans la limite du coût total de construction déclaré.',
  'Garantie de bon fonctionnement : dommages matériels aux éléments d\'équipement, durée de deux ans à compter de la réception, 2 500 000 € par sinistre.',
  'RCD pour ouvrages NON soumis à l\'obligation : s\'applique aux opérations dont le coût total de construction H.T. n\'excède pas 6 000 000 €. Au-delà de 6 000 000 €, l\'assuré doit déclarer le chantier et souscrire un avenant d\'adaptation de garantie ; à défaut, les garanties du contrat ne s\'appliquent pas. Plafond : 3 000 000 € par sinistre.',
  'Responsabilité civile : dommages causés aux tiers, hors tout dommage à l\'ouvrage.',
  'Dommages corporels : 8 000 000 € par sinistre.',
  'Dommages matériels : 2 000 000 € par sinistre.',
  'Dommages immatériels : 1 000 000 € par sinistre.',
  'Matériels et immatériels consécutifs à une erreur d\'implantation : 200 000 € par sinistre.',
  'Dommages confondus amiante (ou tout matériau en contenant) : 1 000 000 € par sinistre et par an.',
  'Dommages confondus atteinte à l\'environnement : 1 000 000 € par sinistre et par an.',
].join('\n');

const analyseSmabtp = analyserAttestation(FIXTURE_SMABTP);

cas('type détecté : RCD', () => {
  assert.equal(analyseSmabtp.type, 'RCD', 'responsabilité décennale -> RCD');
});

cas('assureur détecté : SMABTP', () => {
  assert.match(analyseSmabtp.assureur, /SMABTP/, 'assureur SMABTP en tête de pièce ; reçu : ' + JSON.stringify(analyseSmabtp.assureur));
});

cas('contrat : programme CAP 2000, n° composite 9990001 / 001 999999/143, n° assuré 999999B', () => {
  assert.equal(analyseSmabtp.programme, 'CAP 2000', 'nom du programme');
  assert.equal(analyseSmabtp.numeroContrat, '9990001 / 001 999999/143', 'numéro composite du contrat CAP 2000');
  assert.equal(analyseSmabtp.numeroAssure, '999999B', 'n° assuré propre au gabarit SMABTP');
});

cas('période au format « Période de validité : du ... au ... » -> 2025-01-01 / 2025-12-31', () => {
  assert.equal(analyseSmabtp.valideDu, '2025-01-01', 'seconde formulation de période reconnue');
  assert.equal(analyseSmabtp.valideAu, '2025-12-31', 'fin de période');
});

cas('activités sans code : les 15 items de la liste à puces, aucun code Sxxx', () => {
  assert.equal(analyseSmabtp.activites.length, 15, '15 items attendus, reçus : ' + analyseSmabtp.activites.length);
  assert.ok(analyseSmabtp.activites.every((a) => a.code === undefined), 'aucun item ne porte de code ; reçus : ' + JSON.stringify(analyseSmabtp.activites.filter((a) => a.code !== undefined)));
  assert.equal(analyseSmabtp.activites[0].libelle, 'carrelages mosaïques', 'premier item de la liste');
  assert.ok(analyseSmabtp.activites.some((a) => a.libelle === 'revêtements de sols industriels'), 'dernier item conservé intact');
});

cas('exclusions[] vide : ce gabarit limite par des plafonds, pas par des exclusions « Sauf »', () => {
  assert.deepEqual(analyseSmabtp.exclusions, [], 'aucune exclusion nommée détectée dans la pièce complète (pages 1 à 5) ; les limites vivent dans plafonds');
});

cas('clause de sous-traitance : SMABTP garantie acquise hors périmètre (true), Abeille restreinte (false)', () => {
  assert.equal(analyseSmabtp.sousTraitanceHorsPerimetre, true, 'clause CAP 2000 : la garantie reste acquise même hors activités déclarées');
  assert.equal(analyseEleval.sousTraitanceHorsPerimetre, false, 'clause EDIFICE : sous-traitants couverts dans le cadre des activités visées seulement');
});

cas('adéquation PLATRERIE SOLS <-> activités CAP 2000 : chemin textuel principal, sans aucun code', () => {
  const { score, matches } = adequationActivite('PLATRERIE SOLS', analyseSmabtp.activites);
  assert.ok(score >= 0.5, 'score attendu >= 0,5 pour PLATRERIE SOLS, reçu ' + score);
  assert.ok(matches.some((m) => m.motCle === 'carrelage'), 'mot-clé « carrelage » rapproché du libellé « carrelages mosaïques »');
});

cas('plafonds et seuils de coût restitués depuis les pages 2 à 5 (gabarit SMABTP)', () => {
  assert.deepEqual(analyseSmabtp.plafonds, {
    bonFonctionnementHT: 2500000,
    rcCorporels: 8000000,
    rcMateriels: 2000000,
    rcImmatériels: 1000000,
    implantation: 200000,
    amiante: 1000000,
    environnement: 1000000,
    soumisHT: 26000000,
    nonSoumisHT: 6000000,
    rcdNonSoumisHT: 3000000,
  }, 'plafonds chiffrés, seuils de coût et plafond RCD non soumis du gabarit SMABTP ; reçu : ' + JSON.stringify(analyseSmabtp.plafonds));
});

// --------------------------------------------------------------------------
console.log('adequationActivite');

cas('lot ASCENSEURS <-> attestation ELEVAL : rapprochement net (score >= 0,5, mot-clé ascenseur)', () => {
  const { score, matches } = adequationActivite('ASCENSEURS', analyseEleval.activites);
  assert.ok(score >= 0.5, 'score attendu >= 0,5 pour ASCENSEURS, reçu ' + score);
  assert.ok(matches.some((m) => m.motCle === 'ascenseur'), 'le mot-clé « ascenseur » doit figurer dans les matches');
});

cas('lot PEINTURE <-> attestation ELEVAL : aucun rapprochement (score 0)', () => {
  const { score } = adequationActivite('PEINTURE', analyseEleval.activites);
  assert.equal(score, 0, 'aucun mot-clé peinture chez ELEVAL');
});

cas('lot BARDAGE COUVERTURES <-> activité étanchéité/bardage : rapprochement positif', () => {
  const { score, matches } = adequationActivite('BARDAGE COUVERTURES', [{ code: 'S842', libelle: 'Étanchéité de toiture, pose de bardage' }]);
  assert.ok(score > 0, 'score attendu > 0, reçu ' + score);
  assert.ok(matches.length > 0, 'matches non vides');
});

cas('lot vide ou inconnu : score 0 sans erreur', () => {
  assert.deepEqual(adequationActivite('', analyseEleval.activites), { score: 0, matches: [] }, 'lot vide');
  assert.equal(adequationActivite('LOT INCONNU XYZW', analyseEleval.activites).score, 0, 'lot hors dictionnaire sans mot commun');
});

// --------------------------------------------------------------------------
console.log('controler (voyant du dossier entreprise)');

// Socle de projet réel : creerProjetVide pré-remplit l'agence et les paramètres.
function projetAvec(operation, entreprises, attestations) {
  const projet = creerProjetVide();
  Object.assign(projet.operation, operation);
  projet.entreprises = entreprises;
  projet.attestations = attestations;
  return projet;
}

cas('fumée du socle : creerProjetVide ne présuppose aucune agence, RG 5 %, lieu vide', () => {
  const projet = creerProjetVide();
  assert.equal(projet.agence.raisonSociale ?? null, null, 'aucune agence par défaut');
  assert.equal(projet.retenueGarantieTaux, 0.05, 'retenue de garantie 5 %');
  assert.equal(projet.operation.lieuFait ?? null, null, 'lieu de « FAIT À » vide par défaut');
  assert.ok(projet.penalites.tauxJournalier > 0 && projet.penalites.tauxJournalier < 1, 'taux journalier de pénalités cohérent');
  assert.equal(projet.operation.coutTravauxHT, null, 'coutTravauxHT (SPEC §2, seuils 26 M€ / 6 M€) à null par défaut');
  assert.deepEqual(projet.marche, { controleTechnique: null, sps: null, geotechnicien: null, opc: null }, 'intervenants du CCAP vides');
  assert.equal(projet.crc.dateReunion, null, 'CRC : date de réunion vide');
  assert.deepEqual(projet.crc.intervenants, [], 'CRC : intervenants vides');
  assert.deepEqual(projet.crc.contacts, {}, 'CRC : contacts = OBJET INDEXÉ vide (arbitrage de conception du 25/09/2026)');
});

// NB : les cas d'import/normalisation de js/etat.js vivent dans tests/etat.mjs
// (fichier dédié) — pas de duplication
// de règle de test ; la fumée ci-dessus ne garde que le socle utilisé par les
// fixtures du contrôle d'assurance.

cas('rouge : aucune RCD au dossier (art. L. 241-1)', () => {
  const projet = projetAvec({ droc: null }, [ELEVAL], []);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'rouge', 'RCD absente -> rouge');
  assert.ok(raisons.some((r) => /L\. 241-1/.test(r)), 'la raison cite le fondement L. 241-1 ; reçues : ' + JSON.stringify(raisons));
});

cas('rouge : une RC seule ne remplace pas la RCD', () => {
  const rcSeule = { entrepriseId: 'eleval', type: 'RC', assureur: 'X', numeroContrat: null, valideDu: '2025-01-01', valideAu: '2026-12-31', activites: analyseEleval.activites, exclusions: [] };
  const projet = projetAvec({ droc: null }, [ELEVAL], [rcSeule]);
  assert.equal(controler(projet, 'eleval').voyant, 'rouge', 'RC sans RCD -> rouge');
});

cas('orange : cas ELEVAL RÉEL — garantie au 31/12/2025, DROC 05/03/2025 + 12 mois prévisionnels', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'orange', 'la garantie expire avant la fin prévisionnelle (05/03/2026) -> orange ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /avant la fin prévisionnelle/.test(r)), 'la raison nomme la fin prévisionnelle');
  assert.ok(raisons.some((r) => /\[info\] Seuil de coût non vérifié/.test(r)), 'coutTravauxHT non saisi : le seuil est signalé sans conclure');
  assert.ok(raisons.some((r) => /\[info\] Ouverture de chantier présumée égale à la DROC \(date non saisie\)/.test(r)), 'l\'approximation DROC est signalée (date non saisie)');
});

cas('rouge : l\'ouverture de chantier présumée (DROC) n\'est pas couverte par la garantie', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-06-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'rouge', 'garantie postérieure à l\'ouverture de chantier présumée -> rouge');
  assert.ok(raisons.some((r) => /n\'est pas couverte par la garantie/.test(r)), 'raison explicite sur l\'ouverture de chantier présumée');
});

cas('vert : période couvrant l\'ouverture de chantier présumée + fin prévisionnelle, avec [info] explicites', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'vert', 'couverture et adéquation satisfaisantes, les [info] ne dégradent pas ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.every((r) => r.startsWith('[info]')), 'au vert, seules des raisons informatives peuvent figurer');
  assert.ok(raisons.some((r) => /présumée égale à la DROC/.test(r)), 'l\'architecte sait que l\'ouverture de chantier a été PRÉSUMÉE');
});

cas('rouge : exclusion nommée touchant le poste (Sauf verrières pour un lot COUVERTURE)', () => {
  const entreprise = { id: 'couv-test', lotNom: 'COUVERTURE' };
  const rcd = {
    entrepriseId: 'couv-test', type: 'RCD', assureur: 'Y', numeroContrat: '1',
    valideDu: '2025-01-01', valideAu: '2026-12-31',
    activites: [{ code: 'S842', libelle: 'Étanchéité de toiture, pose de bardage' }],
    exclusions: ['Sauf verrières de surface supérieure à 100 m²'],
  };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12 }, [entreprise], [rcd]);
  const { voyant, raisons } = controler(projet, 'couv-test');
  assert.equal(voyant, 'rouge', 'exclusion « Sauf verrières » sur un lot COUVERTURE -> rouge ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /Exclusion susceptible de toucher le lot/.test(r)), 'raison citant l\'exclusion');
});

cas('vert : PLATERIA + attestation SMABTP CAP 2000 (gabarit sans code, rapprochement textuel)', () => {
  const plateria = ENTREPRISES_EXEMPLE.find((e) => e.id === 'plateria');
  const rcd = { ...analyseSmabtp, entrepriseId: 'plateria' };
  const projet = projetAvec({ droc: '2025-02-01', dureePrevisionnelleMois: 10 }, [plateria], [rcd]);
  const { voyant, raisons } = controler(projet, 'plateria');
  assert.equal(voyant, 'vert', 'garantie 2025 couvrant DROC+10 mois et adéquation platrerie >= 0,5 ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.every((r) => r.startsWith('[info]')), 'au vert, seules des raisons informatives peuvent figurer');
});

cas('rouge : coût du chantier au-delà du seuil opposable de la police (16 M€ vs limite ELEVAL 15 M€) — sur le seul montant', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 16000000 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'rouge', 'coût au-delà du seuil de la police -> rouge sans autre condition ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /supérieur au seuil de garantie \(16 000 000 € > 15 000 000 €\)/.test(r)), 'le seuil PORTÉ PAR LA POLICE (15 M€) prime sur le défaut 26 M€ ; reçues : ' + JSON.stringify(raisons));
});

cas('orange : coût entre le seuil des ouvrages non soumis et celui des soumis (10 M€) — vigilance avenant d\'adaptation', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 10000000 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'orange', 'coût au-delà du seuil non soumis (6 M€) sans dépasser celui des soumis -> vigilance ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /ouvrages NON soumis \(6 000 000 € HT\)/.test(r) && /avenant d\'adaptation/.test(r)), 'la raison cite le seuil non soumis et l\'avenant d\'adaptation');
});

cas('vert : coût sous le seuil des ouvrages non soumis (5 M€) — aucune raison de seuil', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 5000000 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'vert', 'coût sous les seuils, aucune alerte ; reçues : ' + JSON.stringify(raisons));
  assert.ok(!raisons.some((r) => /Seuil de coût/.test(r)), 'le seuil a pu être vérifié : pas de signal d\'absence');
});

cas('orange : DROC absente — ouverture de chantier inconnue, couverture temporelle invérifiable', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: null, coutTravauxHT: 1000000 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'orange', 'sans ouverture de chantier (ni DROC), la couverture ne peut pas être conclue ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /Ouverture de chantier inconnue/.test(r)), 'raison explicite sur l\'ouverture de chantier inconnue');
});

cas('vert : ouverture de chantier Saisie — plus d\'approximation, vert sans aucune raison [info]', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: null, ouvertureChantier: '2025-03-10', coutTravauxHT: 1000000, dureePrevisionnelleMois: 12 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'vert', 'OC réelle dans la période, coût vérifié, adéquation : vert pur ; reçues : ' + JSON.stringify(raisons));
  assert.deepEqual(raisons, [], 'le modèle complet ne laisse aucune raison au vert');
});

cas('vert : ouvrageSoumis true — le seuil des ouvrages non soumis ne s\'applique pas (10 M€)', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 10000000, ouvrageSoumis: true }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'vert', 'ouvrage soumis : seul le seuil 26 M€ s\'applique ; reçues : ' + JSON.stringify(raisons));
  assert.ok(!raisons.some((r) => /NON soumis/.test(r)), 'pas de vigilance non soumis pour un ouvrage déclaré soumis');
});

cas('rouge : ouvrageSoumis false — garantie annulée au-delà de 6 M€ (10 M€)', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 10000000, ouvrageSoumis: false }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'rouge', 'ouvrage non soumis au-delà du seuil 6 M€ : garantie annulée ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /ouvrages NON soumis \(6 000 000 € HT\)/.test(r) && /non soumis à l\'obligation/.test(r)), 'raison citant le seuil 6 M€ et la nature déclarée');
});

cas('rouge : coût 30 M€ sur l\'attestation SMABTP (seuil porté 26 M€) — cas', () => {
  const plateria = ENTREPRISES_EXEMPLE.find((e) => e.id === 'plateria');
  const rcd = { ...analyseSmabtp, entrepriseId: 'plateria' };
  const projet = projetAvec({ droc: '2025-02-01', dureePrevisionnelleMois: 10, coutTravauxHT: 30000000 }, [plateria], [rcd]);
  const { voyant, raisons } = controler(projet, 'plateria');
  assert.equal(voyant, 'rouge', 'coût au-delà du seuil 26 M€ -> rouge ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /supérieur au seuil de garantie \(30 000 000 € > 26 000 000 €\)/.test(r)), 'motif exact attendu, avec le seuil porté par la police');
});

cas('rouge : ouvrageSoumis true au-delà de 26 M€ (30 M€) — la nature true n\'atténue pas le seuil soumis', () => {
  const plateria = ENTREPRISES_EXEMPLE.find((e) => e.id === 'plateria');
  const rcd = { ...analyseSmabtp, entrepriseId: 'plateria' };
  const projet = projetAvec({ droc: '2025-02-01', dureePrevisionnelleMois: 10, coutTravauxHT: 30000000, ouvrageSoumis: true }, [plateria], [rcd]);
  const { voyant, raisons } = controler(projet, 'plateria');
  assert.equal(voyant, 'rouge', 'ouvrageSoumis true ne protège pas au-delà du seuil soumis ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /supérieur au seuil de garantie \(30 000 000 € > 26 000 000 €\)/.test(r)), 'même motif que sans nature déclarée');
});

cas('pas de rouge imputable au coût : 10 M€ avec une attestation couvrant l\'article L. 241-1 (ELEVAL)', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 10000000 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.notEqual(voyant, 'rouge', 'l\'attestation couvre des ouvrages soumis : pas de rouge du seul fait du coût ; reçues : ' + JSON.stringify(raisons));
  assert.ok(!raisons.some((r) => /supérieur au seuil de garantie/.test(r)), 'aucun rouge imputable au coût');
  assert.ok(raisons.some((r) => /dépend de la nature soumise\/non soumise/.test(r)), 'l\'incertitude est déclarée (vigilance, nature non saisie)');
});

cas('coût du chantier non renseigné : raison informative, aucun rouge', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideDu: '2025-01-01', valideAu: '2026-12-31' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: null }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'vert', 'sans coût, aucune conclusion et aucun rouge ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /Seuil de coût non vérifié : coût du chantier non renseigné/.test(r)), 'libellé attendu ; reçues : ' + JSON.stringify(raisons));
});

cas('rouge : attestation ne couvrant que des ouvrages non soumis (aucune activité L. 241-1) + coût 10 M€', () => {
  const entreprise = { id: 'ns-test', lotNom: 'PEINTURE' };
  const rcd = {
    entrepriseId: 'ns-test', type: 'RCD', assureur: 'Z', numeroContrat: '9',
    valideDu: '2025-01-01', valideAu: '2026-12-31',
    couvreOuvragesSoumis: false,
    plafonds: { nonSoumisHT: 6000000 },
    activites: [{ libelle: 'Peinture et revêtements des plafonds et murs' }],
    exclusions: [],
  };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12, coutTravauxHT: 10000000 }, [entreprise], [rcd]);
  const { voyant, raisons } = controler(projet, 'ns-test');
  assert.equal(voyant, 'rouge', 'attestation non soumise seule au-delà de 6 M€ -> rouge ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /ne couvre que des ouvrages NON soumis \(aucune activité au titre de l\'article L\. 241-1\)/.test(r)), 'motif attendu ; reçues : ' + JSON.stringify(raisons));
});

cas('orange : attestation saisie manuellement — la provenance abaisse le voyant', () => {
  const rcd = { ...analyseEleval, entrepriseId: 'eleval', valideAu: '2026-12-31', extraction: 'manuelle' };
  const projet = projetAvec({ droc: '2025-03-05', dureePrevisionnelleMois: 12 }, [ELEVAL], [rcd]);
  const { voyant, raisons } = controler(projet, 'eleval');
  assert.equal(voyant, 'orange', 'extraction manuelle -> orange même si dates et activités sont conformes ; reçues : ' + JSON.stringify(raisons));
  assert.ok(raisons.some((r) => /saisie manuellement/.test(r)), 'raison explicite sur la saisie manuelle');
});

cas('entreprise inconnue : erreur explicite', () => {
  const projet = projetAvec({ droc: null }, [ELEVAL], []);
  assert.throws(() => controler(projet, 'inconnu'), /introuvable/, 'id inexistant -> erreur explicite');
});

// --------------------------------------------------------------------------
console.log('');
if (echecs.length > 0) {
  console.error('BILAN assurances : ' + reussis + ' ok, ' + echecs.length + ' ECHEC(s) -> ' + echecs.join(' ; '));
  process.exitCode = 1;
} else {
  console.log('BILAN assurances : ' + reussis + ' cas ok, 0 échec.');
}
