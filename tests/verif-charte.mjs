// Preuve de la bascule : on lit les couleurs CALCULÉES par le navigateur, pas le
// contenu du fichier. Une feuille de style peut être chargée sans être appliquée.
import { spawn } from 'node:child_process';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9228;
const url = process.argv[2];
const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '\\edge-charte-' + Date.now(), url], { stdio: 'ignore' });
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
let n = 0; const att = new Map(); const erreurs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && att.has(m.id)) { att.get(m.id)(m); att.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') erreurs.push('EXCEPTION ' + (m.params.exceptionDetails.text || ''));
});
const envoyer = (method, params = {}) => new Promise((res) => { const id = ++n; att.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await envoyer('Runtime.enable');
await dormir(8000);
const r = await envoyer('Runtime.evaluate', {
  expression: "JSON.stringify({ page: getComputedStyle(document.body).backgroundColor, police: getComputedStyle(document.body).fontFamily.split(',')[0], entete: getComputedStyle(document.getElementById('entete')).backgroundColor, bandeau: getComputedStyle(document.getElementById('bandeau')).backgroundColor, carte: (function () { var c = document.querySelector('.carte'); return c ? getComputedStyle(c).backgroundColor : 'aucune'; })(), bouton: (function () { var b = document.querySelector('.bouton.primaire'); return b ? getComputedStyle(b).backgroundColor : 'aucun'; })(), ongletActif: (function () { var e = document.querySelector('#etapes .etape.courante'); return e ? getComputedStyle(e).backgroundColor + ' / texte ' + getComputedStyle(e).color : 'aucun'; })() })",
  returnByValue: true,
});
const v = JSON.parse(r.result.result.value);
const attendu = { page: 'rgb(243, 241, 237)', entete: 'rgb(27, 42, 64)', bandeau: 'rgb(24, 133, 158)' };
console.log('=== COULEURS REELLEMENT APPLIQUEES ===');
for (const [k, val] of Object.entries(v)) console.log('  ' + k.padEnd(12) + ' : ' + val);
console.log('');
let ok = true;
for (const [k, att] of Object.entries(attendu)) { if (v[k] !== att) { ok = false; console.log('  ECART sur ' + k + ' : attendu ' + att + ', obtenu ' + v[k]); } }
console.log('  erreurs navigateur : ' + erreurs.length);
console.log(ok && !erreurs.length ? 'CHARTE APPLIQUEE' : 'CHARTE NON CONFORME');
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(ok && !erreurs.length ? 0 : 1);
