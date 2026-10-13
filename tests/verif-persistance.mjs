// Contrôle : une saisie survit-elle à un RECHARGEMENT de la page ?
// C'est la question qui décide si « les données sont liées au navigateur » veut dire
// « conservées » ou « perdues à chaque refresh ». On saisit, on recharge, on relit.
import { spawn } from 'node:child_process';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9227;
const url = process.argv[2];
const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '\\edge-persist-' + Date.now(), url], { stdio: 'ignore' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 60 && !page; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    page = l.find((c) => c.type === 'page' && c.webSocketDebuggerUrl);
  } catch {}
  if (!page) await dormir(500);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let n = 0; const att = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && att.has(m.id)) { att.get(m.id)(m); att.delete(m.id); } });
const envoyer = (method, params = {}) => new Promise((res) => { const id = ++n; att.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await envoyer('Runtime.enable');
await envoyer('Page.enable');
await dormir(8000);

const saisie = await evaluer("(async () => { const b = Array.from(document.querySelectorAll('#etapes .etape')); b[2].click(); await new Promise(r => setTimeout(r, 700)); const c = document.getElementById('contenu'); const ch = Array.from(c.querySelectorAll('input[type=\"text\"]')); const nom = ch[ch.length - 3]; const lot = ch[ch.length - 2]; const btn = Array.from(c.querySelectorAll('button')).find(x => x.innerText.indexOf('Ajouter') >= 0); if (!nom || !btn) return 'FORMULAIRE INTROUVABLE'; nom.value = 'PERSISTANCE ESSAI'; nom.dispatchEvent(new Event('input', { bubbles: true })); lot.value = 'CARRELAGE'; lot.dispatchEvent(new Event('input', { bubbles: true })); btn.click(); await new Promise(r => setTimeout(r, 1500)); const t = document.getElementById('contenu').innerText; return t.indexOf('PERSISTANCE ESSAI') >= 0 ? 'SAISIE OK' : 'SAISIE NON VISIBLE'; })()");
console.log('  1. saisie           : ' + saisie);

await dormir(2000);
await envoyer('Page.reload', { ignoreCache: true });
await dormir(9000);
const apres = await evaluer("(async () => { const b = Array.from(document.querySelectorAll('#etapes .etape')); b[2].click(); await new Promise(r => setTimeout(r, 800)); const t = document.getElementById('contenu').innerText; return t.indexOf('PERSISTANCE ESSAI') >= 0 ? 'CONSERVEE' : 'PERDUE'; })()");
console.log('  2. apres rechargement: ' + apres);
const base = await evaluer("(async () => { if (!window.indexedDB) return 'IndexedDB absent'; return new Promise((res) => { const q = indexedDB.open('smt-projets', 1); q.onsuccess = () => { const db = q.result; const tx = db.transaction('projets', 'readonly'); const r = tx.objectStore('projets').getAllKeys(); r.onsuccess = () => res('cles stockees dans IndexedDB : ' + JSON.stringify(r.result)); r.onerror = () => res('lecture impossible'); }; q.onerror = () => res('ouverture impossible'); }); })()");
console.log('  3. ' + base);
console.log(apres === 'CONSERVEE' ? 'PERSISTANCE OK' : 'PERSISTANCE EN ECHEC');
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(apres === 'CONSERVEE' ? 0 : 1);
