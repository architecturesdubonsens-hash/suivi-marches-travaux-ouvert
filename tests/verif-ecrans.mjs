// tests/verif-ecrans.mjs
//
// Parcours RÉEL des quatre écrans de l'application, piloté par le protocole CDP.
// Motif : tests/verif-navigateur.mjs prouve que l'application démarre et rend son
// premier écran ; il ne prouve pas que les écrans 2 à 4 s'affichent, ni qu'un ajout
// d'entreprise fonctionne. Or c'est là que vivent les défauts que Node ne voit pas.
//
// Prérequis : l'application servie en HTTP (les modules ES sont refusés en file://).
//   python -m http.server 8777 --bind 127.0.0.1 --directory <dépôt>
// Usage :
//   node tests/verif-ecrans.mjs http://127.0.0.1:8777/index.html
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9225;
const url = process.argv[2] || 'http://127.0.0.1:8777/index.html';

const bord = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '\\edge-ecrans-' + Date.now(),
  url,
], { stdio: 'ignore' });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function cible() {
  for (let i = 0; i < 60; i++) {
    try {
      const liste = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = liste.find((c) => c.type === 'page' && c.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* port pas encore ouvert */ }
    await dormir(500);
  }
  throw new Error('aucune cible de page apres 30 s');
}

const page = await cible();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

let compteur = 0;
const attentes = new Map();
const problemes = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && attentes.has(m.id)) { attentes.get(m.id)(m); attentes.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problemes.push('EXCEPTION : ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problemes.push('console.error : ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140));
  }
});
const envoyer = (methode, params = {}) => new Promise((res) => {
  const id = ++compteur; attentes.set(id, res); ws.send(JSON.stringify({ id, method: methode, params }));
});

await envoyer('Runtime.enable');
await envoyer('Page.navigate', { url });
await dormir(8000);   // démarrage asynchrone : on attend en TEMPS REEL

// Parcours des quatre étapes : clic sur chaque bouton de la barre, puis lecture.
const expression = `(async () => {
  const sortie = [];
  // Aucun caractere d'echappement dans cette expression : elle est elle-meme
  // construite dans un gabarit, ou un \\n deviendrait un vrai retour a la ligne.
  const NL = String.fromCharCode(10);
  const plat = function (s) { return String(s).split(NL).filter(Boolean).join(' | '); };
  const boutons = Array.from(document.querySelectorAll('#etapes .etape'));
  for (let i = 0; i < boutons.length; i++) {
    boutons[i].click();
    await new Promise((r) => setTimeout(r, 700));
    const conteneur = document.getElementById('contenu');
    const texte = (conteneur && conteneur.innerText) ? conteneur.innerText : '';
    sortie.push({
      etape: i + 1,
      libelle: plat(boutons[i].innerText),
      longueur: texte.length,
      debut: plat(texte).slice(0, 260),
      boutons: (conteneur ? conteneur.querySelectorAll('button').length : 0),
      champs: (conteneur ? conteneur.querySelectorAll('input, select, textarea').length : 0),
    });
  }
  return JSON.stringify(sortie);
})()`;
const res = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
// Diagnostic : si l'évaluation échoue, on veut la RAISON, pas un « undefined ».
const brut = res && res.result && res.result.result ? res.result.result.value : undefined;
if (brut === undefined) {
  console.log('=== EVALUATION EN ECHEC : reponse brute du navigateur ===');
  console.log(JSON.stringify(res).slice(0, 1500));
  ws.close();
  try { process.kill(bord.pid); } catch {}
  process.exit(2);
}
const parcours = JSON.parse(brut);

console.log('=== PARCOURS DES QUATRE ECRANS ===');
let ko = 0;
for (const e of parcours) {
  const vide = e.longueur < 50;
  if (vide) ko++;
  console.log('  etape ' + e.etape + ' [' + e.libelle + '] ' + (vide ? 'VIDE' : e.longueur + ' car., '
    + e.boutons + ' bouton(s), ' + e.champs + ' champ(s)'));
  console.log('      ' + e.debut.slice(0, 200));
}
// ── Exercice réel : ajouter une entreprise SANS devis (SPEC § 6 ter) ──────────
// Le parcours ci-dessus prouve que les écrans s'AFFICHENT. Il ne prouve pas qu'ils
// AGISSENT. On remplit donc le formulaire d'ajout et on clique pour de vrai.
const exercice = await envoyer('Runtime.evaluate', {
  expression: `(async () => {
    const NL = String.fromCharCode(10);
    const etapes = Array.from(document.querySelectorAll('#etapes .etape'));
    etapes[2].click();
    await new Promise((r) => setTimeout(r, 700));
    const conteneur = document.getElementById('contenu');
    const champs = Array.from(conteneur.querySelectorAll('input[type="text"]'));
    const nom = champs[champs.length - 3];
    const lot = champs[champs.length - 2];
    const bouton = Array.from(conteneur.querySelectorAll('button'))
      .find((b) => b.innerText.indexOf('Ajouter') >= 0);
    if (!nom || !lot || !bouton) {
      return JSON.stringify({ erreur: 'formulaire d ajout introuvable', champsTexte: champs.length });
    }
    nom.value = 'SARL CARRELAGE ESSAI';
    nom.dispatchEvent(new Event('input', { bubbles: true }));
    lot.value = 'CARRELAGE';
    lot.dispatchEvent(new Event('input', { bubbles: true }));
    bouton.click();
    await new Promise((r) => setTimeout(r, 1200));
    const texte = document.getElementById('contenu').innerText;
    return JSON.stringify({
      entrepriseAffichee: texte.indexOf('SARL CARRELAGE ESSAI') >= 0,
      completudeAffichee: texte.indexOf('il manque') >= 0 || texte.indexOf('OS prêt') >= 0,
      devisManquantAnnonce: texte.indexOf('devis retenu') >= 0,
      nbCartes: conteneur.querySelectorAll('section.carte').length,
      extrait: texte.split(NL).filter(Boolean).slice(0, 14).join(' | ').slice(0, 320),
    });
  })()`,
  awaitPromise: true, returnByValue: true,
});
const ex = exercice && exercice.result && exercice.result.result && exercice.result.result.value
  ? JSON.parse(exercice.result.result.value) : { erreur: 'evaluation impossible' };
console.log('=== EXERCICE : AJOUTER UNE ENTREPRISE SANS DEVIS ===');
console.log('  ' + JSON.stringify(ex));
const exerciceOk = ex.entrepriseAffichee === true && ex.completudeAffichee === true;
console.log(exerciceOk ? '  AJOUT OK' : '  AJOUT EN ECHEC');

console.log('=== PROBLEMES NAVIGATEUR (' + problemes.length + ') ===');
for (const p of problemes.slice(0, 10)) console.log('  ' + p);
const ok = ko === 0 && problemes.length === 0 && exerciceOk;
console.log(ok ? 'VERIF ECRANS OK' : 'VERIF ECRANS : ' + ko + ' ecran(s) vide(s), '
  + problemes.length + ' probleme(s), ajout ' + (exerciceOk ? 'ok' : 'EN ECHEC'));
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(ok ? 0 : 1);
