// tests/verif-navigateur.mjs
//
// Vérification de l'application DANS UN VRAI NAVIGATEUR, par le protocole CDP.
//
// Pourquoi ce fichier existe : le projet a passé des heures à valider des modules
// en Node sans jamais exécuter l'interface. Un contrôle naïf par « msedge --dump-dom »
// a d'abord conclu à tort que le démarrage se bloquait — cet outil capture l'état au
// chargement et ne sait rien d'un démarrage asynchrone. Il faut donc PILOTER le
// navigateur et ATTENDRE en temps réel avant de lire l'état.
//
// Prérequis : l'application servie en HTTP (les modules ES sont bloqués en file://).
//   python -m http.server 8777 --bind 127.0.0.1 --directory <dépôt>
// Usage :
//   node tests/verif-navigateur.mjs http://127.0.0.1:8777/index.html [attente_ms]
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9224;
const url = process.argv[2] || 'http://127.0.0.1:8777/index.html';
const attenteMs = Number(process.argv[3] || 9000);

const bord = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '\\edge-verif-' + Date.now(),
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
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    problemes.push('console.' + m.params.type + ' : ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  }
});
const envoyer = (methode, params = {}) => new Promise((res) => {
  const id = ++compteur; attentes.set(id, res); ws.send(JSON.stringify({ id, method: methode, params }));
});

await envoyer('Runtime.enable');
await envoyer('Page.navigate', { url });
await dormir(attenteMs);

const mesure = await envoyer('Runtime.evaluate', {
  expression: `JSON.stringify({
    titre: document.title,
    etapes: document.querySelectorAll('#etapes .etape').length,
    indicateur: (document.getElementById('sauvegarde-indicateur') || {}).textContent || '',
    contenuLongueur: ((document.getElementById('contenu') || {}).innerText || '').length,
    contenuDebut: ((document.getElementById('contenu') || {}).innerText || '').slice(0, 400)
  })`,
  returnByValue: true,
});

const etat = JSON.parse(mesure.result.result.value);
console.log('titre            : ' + etat.titre);
console.log('etapes rendues   : ' + etat.etapes);
console.log('indicateur       : ' + etat.indicateur);
console.log('contenu          : ' + etat.contenuLongueur + ' caracteres');
console.log('premier ecran    : ' + etat.contenuDebut.replace(/\n/g, ' | ').slice(0, 200));
console.log('problemes        : ' + (problemes.length ? problemes.join(' ; ') : 'aucun'));
const ok = etat.etapes === 4 && etat.contenuLongueur > 200 && problemes.length === 0;
console.log(ok ? 'VERIF NAVIGATEUR OK' : 'VERIF NAVIGATEUR EN ECHEC');
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(ok ? 0 : 1);
