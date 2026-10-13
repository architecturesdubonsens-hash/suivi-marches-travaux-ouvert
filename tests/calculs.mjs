// tests/calculs.mjs — tests hermétiques du moteur de calcul.
//
// Exécution : node tests/calculs.mjs   (Node 24, sans npm ni navigateur)
// Sortie : une ligne « ok »/« ECHEC » par cas, bilan final, code retour 0 si
// tout passe, 1 sinon. Toutes les valeurs de référence proviennent du corpus
// réel OP-2026-01 (os.txt, av.txt, gabarits source) — aucun appareil inventé.

import assert from 'node:assert/strict';
import {
  montantAvecVariantes,
  appliquerProrata,
  montantEnLettres,
  montantEnLettresMajuscules,
  chainageAvenant,
  retenueGarantie,
  penalites,
} from '../js/calculs.js';

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
console.log('montantAvecVariantes');

cas('VOLTALIS : 560 000 HT -> 112 000 TVA / 672 000 TTC (corpus AV1 (A))', () => {
  const m = montantAvecVariantes({ htBase: 560000, variantes: [] });
  assert.deepEqual(m, { ht: 560000, tva: 112000, ttc: 672000 }, 'montant VOLTALIS attendu {560000, 112000, 672000}, reçu ' + JSON.stringify(m));
});

cas('COLORAMA : 84 378,08 HT -> 101 253,696 TTC (corpus OS r27-r28)', () => {
  const m = montantAvecVariantes({ htBase: 84378.08, variantes: [] });
  assert.equal(m.ht, 84378.08, 'HT COLORAMA');
  assert.equal(m.tva, 16875.616, 'TVA COLORAMA = 84 378,08 × 0,2');
  assert.equal(m.ttc, 101253.696, 'TTC COLORAMA : la mission indiquait 101253,284 par erreur, la valeur du gabarit est 101253,696');
});

cas('DESAMIA : base 89 918,24 + variante retenue 7 215,33 -> 97 133,57 / 116 560,284 (formule F29 du gabarit OS)', () => {
  const devis = {
    htBase: 89918.24,
    variantes: [{ libelle: 'Composante F29', sens: 'plus', ht: 7215.33, retenue: true }],
  };
  const m = montantAvecVariantes(devis);
  assert.equal(m.ht, 97133.57, 'HT DESAMIA = 89 918,24 + 7 215,33');
  assert.equal(m.tva, 19426.714, 'TVA DESAMIA');
  assert.equal(m.ttc, 116560.284, 'TTC DESAMIA (3 décimales observées sur l\'OS réel)');
});

cas('variante non retenue (retenue:false) : ignorée', () => {
  const devis = {
    htBase: 89918.24,
    variantes: [{ libelle: 'Composante F29', sens: 'plus', ht: 7215.33, retenue: false }],
  };
  const m = montantAvecVariantes(devis);
  assert.equal(m.ht, 89918.24, 'variante non cochée -> HT de base inchangé');
  assert.equal(m.ttc, 107901.888, 'TTC sur base seule');
});

cas('moins-value retenue : déduite du HT', () => {
  const m = montantAvecVariantes({
    htBase: 1000,
    variantes: [{ libelle: 'MV test', sens: 'moins', ht: 200, retenue: true }],
  });
  assert.deepEqual(m, { ht: 800, tva: 160, ttc: 960 }, '1000 − 200 -> {800, 160, 960}');
});

cas('option retenue (sens option) : ajoutée comme une plus-value', () => {
  const m = montantAvecVariantes({
    htBase: 1000,
    variantes: [{ libelle: 'Option test', sens: 'option', ht: 250, retenue: true }],
  });
  assert.equal(m.ht, 1250, 'option retenue ajoutée');
});

cas('TVA surchargeable (taux 10 %)', () => {
  const m = montantAvecVariantes({ htBase: 560000, variantes: [] }, { tvaTaux: 0.1 });
  assert.deepEqual(m, { ht: 560000, tva: 56000, ttc: 616000 }, 'TVA 10 % -> 56 000 / 616 000');
});

cas('sens de variante inconnu : erreur explicite', () => {
  assert.throws(
    () => montantAvecVariantes({ htBase: 100, variantes: [{ sens: 'mystere', ht: 10, retenue: true }] }),
    /sens de variante inconnu/,
    'un sens inconnu doit lever une erreur explicite',
  );
});

cas('htBase absent/non numérique/négatif : erreurs explicites', () => {
  assert.throws(() => montantAvecVariantes({}), /devis\.htBase/, 'htBase manquant');
  assert.throws(() => montantAvecVariantes({ htBase: 'abc' }), /htBase/, 'htBase chaîne');
  assert.throws(() => montantAvecVariantes({ htBase: -1 }), /inférieure au minimum/, 'htBase négatif');
});

// --------------------------------------------------------------------------
console.log('appliquerProrata');

cas('mode inclus : HT inchangé, TVA/TTC recalculés (OS « PRO RATA INCLUS »)', () => {
  const m = appliquerProrata(84378.08, { mode: 'inclus' });
  assert.deepEqual(m, { ht: 84378.08, tva: 16875.616, ttc: 101253.696 }, 'inclus -> inchangé (SPEC §3)');
});

cas('prorata absent ou null : traité comme inclus', () => {
  assert.deepEqual(appliquerProrata(1000), { ht: 1000, tva: 200, ttc: 1200 }, 'sans prorata');
  assert.deepEqual(appliquerProrata(1000, null), { ht: 1000, tva: 200, ttc: 1200 }, 'prorata null');
});

cas('mode valeur : taux 0,5 -> moitié du HT, TVA/TTC sur le HT réduit', () => {
  const m = appliquerProrata(1000, { mode: 'valeur', taux: 0.5 });
  assert.deepEqual(m, { ht: 500, tva: 100, ttc: 600 }, 'prorata de valeur 0,5');
});

cas('mode valeur bornes : taux 0 autorisé, taux 1 équivaut à inclus, taux 1,2 refusé', () => {
  assert.deepEqual(appliquerProrata(1000, { mode: 'valeur', taux: 0 }), { ht: 0, tva: 0, ttc: 0 }, 'taux 0');
  assert.deepEqual(appliquerProrata(1000, { mode: 'valeur', taux: 1 }), { ht: 1000, tva: 200, ttc: 1200 }, 'taux 1');
  assert.throws(() => appliquerProrata(1000, { mode: 'valeur', taux: 1.2 }), /taux/, 'taux > 1 refusé');
});

cas('taux non standard sur prorata valeur : 1000 × 0,5 à 5 % -> {500, 25, 525} (SPEC §8)', () => {
  const m = appliquerProrata(1000, { mode: 'valeur', taux: 0.5 }, { tvaTaux: 0.05 });
  assert.deepEqual(m, { ht: 500, tva: 25, ttc: 525 }, 'HT réduit puis TVA et TTC calculés avec le taux passé en paramètre, jamais la constante interne ; reçu : ' + JSON.stringify(m));
});

cas('taux non standard sur prorata inclus : 1000 à 5 % -> {1000, 50, 1050}', () => {
  const m = appliquerProrata(1000, { mode: 'inclus' }, { tvaTaux: 0.05 });
  assert.deepEqual(m, { ht: 1000, tva: 50, ttc: 1050 }, 'la TVA du HT affiché suit aussi le taux paramétré');
});

cas('compatibilité : sans 3e argument, le défaut reste 20 % (0,2)', () => {
  assert.deepEqual(appliquerProrata(1000, { mode: 'valeur', taux: 0.5 }), { ht: 500, tva: 100, ttc: 600 }, 'défaut 0,2 inchangé avec prorata valeur');
  assert.deepEqual(appliquerProrata(1000), { ht: 1000, tva: 200, ttc: 1200 }, 'défaut 0,2 inchangé sans prorata');
  assert.deepEqual(appliquerProrata(84378.08, { mode: 'inclus' }), { ht: 84378.08, tva: 16875.616, ttc: 101253.696 }, 'cas corpus COLORAMA inchangé');
});

cas('tvaTaux invalide en 3e paramètre : erreur explicite', () => {
  assert.throws(() => appliquerProrata(1000, { mode: 'inclus' }, { tvaTaux: 1.5 }), /tvaTaux/, 'taux hors bornes refusé');
  assert.throws(() => appliquerProrata(1000, { mode: 'inclus' }, { tvaTaux: '0.05' }), /tvaTaux/, 'taux non numérique refusé');
});

cas('mode inconnu : erreur explicite', () => {
  assert.throws(() => appliquerProrata(1000, { mode: 'forfait' }), /mode de prorata inconnu/, 'mode inconnu');
});

// --------------------------------------------------------------------------
console.log('montantEnLettres');

const LETTRES = [
  [0, 'zéro euro'],
  [1, 'un euro'],
  [2, 'deux euros'],
  [0.01, 'zéro euro et un centime'],
  [0.5, 'zéro euro et cinquante centimes'],
  [0.8, 'zéro euro et quatre-vingts centimes'],
  [1.01, 'un euro et un centime'],
  [21, 'vingt et un euros'],
  [71, 'soixante et onze euros'],
  [72, 'soixante-douze euros'],
  [80, 'quatre-vingts euros'],
  [81, 'quatre-vingt-un euros'],
  [91, 'quatre-vingt-onze euros'],
  [99, 'quatre-vingt-dix-neuf euros'],
  [100, 'cent euros'],
  [101, 'cent un euros'],
  [200, 'deux cents euros'],
  [201, 'deux cent un euros'],
  [999, 'neuf cent quatre-vingt-dix-neuf euros'],
  [1000, 'mille euros'],
  [1001, 'mille un euros'],
  [2000, 'deux mille euros'],
  [21000, 'vingt et un mille euros'],
  [80000, 'quatre-vingt mille euros'],
  [100000, 'cent mille euros'],
  [200000, 'deux cent mille euros'],
  [200200, 'deux cent mille deux cents euros'],
  [560000, 'cinq cent soixante mille euros'],
  [1000000, "un million d'euros"],
  [2000000, "deux millions d'euros"],
  [1000001, 'un million un euros'],
  [1000010, 'un million dix euros'],
  [1500000, 'un million cinq cent mille euros'],
  [123456789.99, 'cent vingt-trois millions quatre cent cinquante-six mille sept cent quatre-vingt-neuf euros et quatre-vingt-dix-neuf centimes'],
  [999999999.99, 'neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf euros et quatre-vingt-dix-neuf centimes'],
  // Montants réels du corpus, en toutes lettres pour le CCAP :
  [598682.1, 'cinq cent quatre-vingt-dix-huit mille six cent quatre-vingt-deux euros et dix centimes'],
  [718418.52, 'sept cent dix-huit mille quatre cent dix-huit euros et cinquante-deux centimes'],
  [97133.57, 'quatre-vingt-dix-sept mille cent trente-trois euros et cinquante-sept centimes'],
  [7215.33, 'sept mille deux cent quinze euros et trente-trois centimes'],
  [38682.1, 'trente-huit mille six cent quatre-vingt-deux euros et dix centimes'],
];

for (const [valeur, attendu] of LETTRES) {
  cas('lettres ' + valeur + ' -> « ' + attendu + ' »', () => {
    assert.equal(montantEnLettres(valeur), attendu, 'orthographe attendue pour ' + valeur);
  });
}

cas('arrondi au centime : 101253,696 -> « ... et soixante-dix centimes »', () => {
  assert.equal(
    montantEnLettres(101253.696),
    'cent un mille deux cent cinquante-trois euros et soixante-dix centimes',
    'arrondi au centime du TTC à 3 décimales du gabarit OS',
  );
});

cas('arrondi au centime : 1,006 -> « un euro et un centime »', () => {
  assert.equal(montantEnLettres(1.006), 'un euro et un centime', '1,006 s\'arrondit à 1,01');
});

cas('hors domaine : erreurs explicites', () => {
  assert.throws(() => montantEnLettres(-1), /négatif/, 'négatif refusé');
  assert.throws(() => montantEnLettres(NaN), /nombre fini/, 'NaN refusé');
  assert.throws(() => montantEnLettres(Infinity), /nombre fini/, 'Infinity refusé');
  assert.throws(() => montantEnLettres('12'), /nombre/, 'chaîne refusée');
  assert.throws(() => montantEnLettres(1e10), /999 999 999/, 'au-delà du plafond refusé');
  assert.throws(() => montantEnLettres(999999999.995), /999 999 999/, '999 999 999,995 s\'arrondit au milliard -> refusé');
});

// --------------------------------------------------------------------------
console.log('montantEnLettresMajuscules (rendu CCAP du gabarit MT réel : « ET nn CTS**** », SOURCE UNIQUE)');

cas('560000 -> « CINQ CENT SOIXANTE MILLE EUROS ET 00 CTS**** » (cas de référence)', () => {
  assert.equal(montantEnLettresMajuscules(560000), 'CINQ CENT SOIXANTE MILLE EUROS ET 00 CTS****', 'forme exacte du gabarit .doc');
});

cas('672000 -> « SIX CENT SOIXANTE-DOUZE MILLE EUROS ET 00 CTS**** » (cas de référence)', () => {
  assert.equal(montantEnLettresMajuscules(672000), 'SIX CENT SOIXANTE-DOUZE MILLE EUROS ET 00 CTS****', 'forme exacte du gabarit .doc');
});

cas('116560.284 -> centimes arrondis à 28 -> « CENT SEIZE MILLE CINQ CENT SOIXANTE EUROS ET 28 CTS**** »', () => {
  assert.equal(
    montantEnLettresMajuscules(116560.284),
    'CENT SEIZE MILLE CINQ CENT SOIXANTE EUROS ET 28 CTS****',
    'arrondi au centime (28) porté sur deux chiffres',
  );
});

cas('1 -> « UN EURO ET 00 CTS**** » (singulier, centimes nuls sur deux chiffres)', () => {
  assert.equal(montantEnLettresMajuscules(1), 'UN EURO ET 00 CTS****', 'cas de référence');
});

cas('21000.50 -> « VINGT ET UN MILLE EUROS ET 50 CTS**** » (le « et » interne ne piège pas le format)', () => {
  assert.equal(montantEnLettresMajuscules(21000.5), 'VINGT ET UN MILLE EUROS ET 50 CTS****', 'reconstruction sans parsing : le « et » de « vingt et un » est préservé');
});

cas('0.01 -> « ZÉRO EURO ET 01 CTS**** » (accent conservé en majuscule, arbitrage documenté)', () => {
  assert.equal(montantEnLettresMajuscules(0.01), 'ZÉRO EURO ET 01 CTS****', 'typographie française : majuscules accentuées');
});

cas('999999999.99 -> borne haute complète en forme CCAP', () => {
  assert.equal(
    montantEnLettresMajuscules(999999999.99),
    'NEUF CENT QUATRE-VINGT-DIX-NEUF MILLIONS NEUF CENT QUATRE-VINGT-DIX-NEUF MILLE NEUF CENT QUATRE-VINGT-DIX-NEUF EUROS ET 99 CTS****',
    'borne haute',
  );
});

cas('hors domaine : mêmes refus que montantEnLettres, messages visant le bon argument', () => {
  assert.throws(() => montantEnLettresMajuscules(-1), /montantEnLettresMajuscules.*négatif/, 'négatif refusé');
  assert.throws(() => montantEnLettresMajuscules(NaN), /montantEnLettresMajuscules.*nombre fini/, 'NaN refusé');
  assert.throws(() => montantEnLettresMajuscules(1e10), /montantEnLettresMajuscules.*999 999 999/, 'au-delà du plafond refusé');
});

// --------------------------------------------------------------------------
console.log('chainageAvenant');

cas('AV1 VOLTALIS réel : (A) 560000, (C) 38682,10, (D) 0 -> cumulé 598 682,10 (av.txt r50)', () => {
  const r = chainageAvenant({ montantInitial: 560000, avenantsPrecedents: [], plusValue: 38682.1, moinsValue: 0 });
  assert.deepEqual(r, { A: 560000, B: 560000, C: 38682.1, D: 0, cumule: 598682.1 },
    'chaînage attendu {560000, 560000, 38682.1, 0, 598682.1}, reçu ' + JSON.stringify(r));
});

cas('chaînage avec avenant précédent : B = A + cumul, cumulé = B + C − D', () => {
  const r = chainageAvenant({
    montantInitial: 560000,
    avenantsPrecedents: [38682.1],
    plusValue: 10000,
    moinsValue: 2500,
  });
  assert.equal(r.B, 598682.1, '(B) = (A) + avenants précédents');
  assert.equal(r.cumule, 606182.1, 'cumulé = (B) + (C) − (D) = 598 682,10 + 10 000 − 2 500');
});

cas('avenantsPrecedents en objets {montant} : accepté, même convention de signe', () => {
  const r = chainageAvenant({
    montantInitial: 100000,
    avenantsPrecedents: [{ montant: 5000 }, { montant: -2000 }],
    plusValue: 0,
    moinsValue: 0,
  });
  assert.equal(r.B, 103000, 'cumul antérieur algébrique (+5000 −2000)');
  assert.equal(r.cumule, 103000, 'sans PV/MV, cumulé = B');
});

cas('moins-value seule : cumulé descend sous (B)', () => {
  const r = chainageAvenant({ montantInitial: 100000, avenantsPrecedents: [], plusValue: 0, moinsValue: 500 });
  assert.deepEqual(r, { A: 100000, B: 100000, C: 0, D: 500, cumule: 99500 }, 'B + C − D');
});

cas('scalaire déjà sommé refusé (arbitrage SPEC §8 du 25/09/2026) : avenantsPrecedents = 38682.1 -> TypeError', () => {
  // Cas exact d'un cumul pré-sommé passé en nombre nu : la LISTE est le contrat, la règle (A)+(1)+(2)+(x) = (B) reste dans
  // ce module seul. Ce cas verrouille l'arbitrage contre toute régression.
  assert.throws(
    () => chainageAvenant({ montantInitial: 560000, avenantsPrecedents: 38682.1, plusValue: 0, moinsValue: 0 }),
    /LISTE des effets nets/,
    'un nombre nu (cumul pré-sommé) doit être refusé, jamais toléré',
  );
});

cas('entrées invalides : erreurs explicites', () => {
  assert.throws(() => chainageAvenant({}), /montantInitial/, 'montantInitial manquant');
  assert.throws(
    () => chainageAvenant({ montantInitial: 100, plusValue: -5 }),
    /inférieure au minimum/,
    'plus-value négative refusée (déclarer en moinsValue)',
  );
  assert.throws(
    () => chainageAvenant({ montantInitial: 100, tvaTaux: 3 }),
    /tvaTaux/,
    'tvaTaux hors 0..1 refusé',
  );
  assert.throws(
    () => chainageAvenant({ montantInitial: 100, avenantsPrecedents: 'x' }),
    /tableau/,
    'avenantsPrecedents non tableau refusé',
  );
});

// --------------------------------------------------------------------------
console.log('retenueGarantie');

cas('retenue de garantie par défaut 5 % : 560 000 -> 28 000', () => {
  assert.equal(retenueGarantie(560000), 28000, '5 % de 560 000');
});

cas('retenue de garantie sur TTC à 3 décimales : 84 378,08 -> 4 218,904', () => {
  assert.equal(retenueGarantie(84378.08), 4218.904, '5 % de 84 378,08');
});

cas('taux paramétrable : 10 %', () => {
  assert.equal(retenueGarantie(560000, 0.1), 56000, '10 % de 560 000');
});

cas('taux hors bornes : erreur explicite', () => {
  assert.throws(() => retenueGarantie(1000, 2), /taux/, 'taux > 1 refusé');
});

// --------------------------------------------------------------------------
console.log('penalites');

cas('défauts : 1/3000e par jour, 5 % de plafond -> 30 jours de retard sur 560 000 = 5 600', () => {
  assert.equal(penalites({ montantMarche: 560000, jours: 30 }), 5600, '560000 × 30 / 3000');
});

cas('plafond 5 % atteint : 3000 jours -> plafonné à 28 000', () => {
  assert.equal(penalites({ montantMarche: 560000, jours: 3000 }), 28000, 'pénalités plafonnées à 5 % du marché');
});

cas('plafondPct null : pas de plafond', () => {
  assert.equal(penalites({ montantMarche: 560000, jours: 3000, plafondPct: null }), 560000, 'sans plafond');
});

cas('taux journalier explicite : 1/1000e sur 10 jours, marché 100 000 -> 1 000', () => {
  assert.equal(
    penalites({ montantMarche: 100000, jours: 10, tauxJournalier: 1 / 1000 }),
    1000,
    '100000 × 10 / 1000',
  );
});

cas('jours 0 -> 0 ; jours négatif refusé', () => {
  assert.equal(penalites({ montantMarche: 560000, jours: 0 }), 0, 'aucun jour de retard');
  assert.throws(() => penalites({ montantMarche: 560000, jours: -5 }), /jours/, 'jours négatifs refusés');
});

// --------------------------------------------------------------------------
console.log('');
if (echecs.length > 0) {
  console.error('BILAN calculs : ' + reussis + ' ok, ' + echecs.length + ' ECHEC(s) -> ' + echecs.join(' ; '));
  process.exitCode = 1;
} else {
  console.log('BILAN calculs : ' + reussis + ' cas ok, 0 échec.');
}
