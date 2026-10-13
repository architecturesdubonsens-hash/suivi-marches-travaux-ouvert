// Contrôle : l'interface démarre-t-elle VIERGE ? On relit la valeur de chaque champ
// du premier écran et on liste ceux qui sont déjà remplis — s'il en reste, ils
// viennent forcément d'une valeur par défaut du code, pas d'une saisie.
import { spawn } from 'node:child_process';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9226;
const url = process.argv[2];
const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '\\edge-vierge-' + Date.now(), url], { stdio: 'ignore' });
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
await envoyer('Runtime.enable');
await dormir(8000);
const res = await envoyer('Runtime.evaluate', {
  expression: "JSON.stringify(Array.from(document.querySelectorAll('#contenu input, #contenu select, #contenu textarea')).map(function (c) { var lab = c.closest('.champ') ? c.closest('.champ').innerText.split(String.fromCharCode(10))[0] : (c.placeholder || c.type); return { champ: String(lab).slice(0, 42), valeur: String(c.value || '') }; }).filter(function (x) { return x.valeur !== ''; }))",
  returnByValue: true,
});
const remplis = JSON.parse(res.result.result.value);
console.log('=== CHAMPS DEJA REMPLIS AU DEMARRAGE (' + remplis.length + ') ===');
for (const c of remplis) console.log('  ' + c.champ + ' = ' + c.valeur);
if (!remplis.length) console.log('  aucun : interface entierement vierge');
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(0);
