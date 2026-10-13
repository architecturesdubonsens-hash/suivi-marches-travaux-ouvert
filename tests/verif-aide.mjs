// Verification du mode d'emploi, dans le navigateur.
// On ne se contente pas de constater que le bouton existe : on ouvre la fenetre depuis
// CHAQUE ecran, on verifie que les sections sont bien la, et qu'Echap la referme.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9301;
const url = process.argv[2];
const capture = process.argv[3] || null;
const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1400,1000',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '\\edge-aide-' + Date.now(), url], { stdio: 'ignore' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 60 && !page; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); page = l.find((c) => c.type === 'page' && c.webSocketDebuggerUrl); } catch {}
  if (!page) await dormir(500);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let n = 0; const att = new Map(); const erreurs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && att.has(m.id)) { att.get(m.id)(m); att.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') erreurs.push(m.params.exceptionDetails.text || 'exception');
});
const envoyer = (method, params = {}) => new Promise((res) => { const id = ++n; att.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluer = async (e) => {
  const r = await envoyer('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return 'EXCEPTION: ' + r.result.exceptionDetails.text;
  return r.result && r.result.result ? r.result.result.value : 'undefined';
};
await envoyer('Runtime.enable'); await envoyer('Page.enable');
await dormir(9000);
const NL = 'String.fromCharCode(10)';

console.log('1. LE BOUTON EST-IL DANS L EN-TETE ?');
console.log(await evaluer("(() => { const b = document.getElementById('bouton-aide'); if (!b) return 'ABSENT'; const r = b.getBoundingClientRect(); const c = getComputedStyle(b); return JSON.stringify({ texte: b.innerText, visible: r.width > 0 && r.height > 0, contraste: c.color + ' sur ' + c.backgroundColor }); })()"));

console.log('');
console.log('2. OUVERTURE DEPUIS CHAQUE ECRAN');
console.log(await evaluer("(async () => { const out = []; const etapes = Array.from(document.querySelectorAll('#etapes .etape')); for (let i = 0; i < etapes.length; i++) { etapes[i].click(); await new Promise(r => setTimeout(r, 700)); document.getElementById('bouton-aide').click(); await new Promise(r => setTimeout(r, 500)); const f = document.querySelector('.aide-voile'); const t = f ? f.innerText : ''; out.push({ ecran: i+1, ouverte: !!f, sections: (t.match(/Ce que fait|quatre étapes|Dossier partagé|Les comptes|Mise en service|Questions fréquentes/g) || []).length, hauteur: f ? Math.round(f.querySelector('.aide-fenetre').getBoundingClientRect().height) : 0 }); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 400)); out[out.length-1].fermeeParEchap = !document.querySelector('.aide-voile'); } return JSON.stringify(out, null, 1); })()"));

console.log('');
console.log('3. CONTENU : LES SIX SECTIONS ET LES DEUX INTERRUPTEURS DE LA BASE');
console.log(await evaluer("(async () => { document.getElementById('bouton-aide').click(); await new Promise(r => setTimeout(r, 500)); const t = document.querySelector('.aide-voile').innerText; const attendus = ['Ce que fait', 'quatre étapes', 'Dossier partagé', 'Les comptes', 'Mise en service', 'Questions fréquentes']; const manquants = attendus.filter(x => t.indexOf(x) < 0); return JSON.stringify({ sectionsPresentes: attendus.length - manquants.length, manquants: manquants, parleDesDeuxInterrupteurs: t.indexOf('Enable Email provider') >= 0 && t.indexOf('Allow new users to sign up') >= 0, ditQueLesDossiersSontPrives: t.indexOf('vous appartiennent') >= 0, ditCommentCreerUnCompte: t.indexOf('Créer un compte') >= 0, longueurTexte: t.length }); })()"));

console.log('');
console.log('3 bis. L INFORMATION VIT DESORMAIS DANS L AIDE');
console.log(await evaluer("(async () => { const t = document.querySelector('.aide-voile').innerText; const i = t.indexOf('inscription est'); return JSON.stringify({ etatDonneDansLAide: i >= 0, extrait: i >= 0 ? t.slice(Math.max(0, i - 60), i + 150).split(String.fromCharCode(10)).join(' ') : 'ABSENT' }); })()"));

console.log('');
console.log('4. FERMETURE PAR CLIC A COTE');
console.log(await evaluer("(async () => { if (!document.querySelector('.aide-voile')) { document.getElementById('bouton-aide').click(); await new Promise(r => setTimeout(r, 500)); } const avant = !!document.querySelector('.aide-voile'); const v = document.querySelector('.aide-voile'); v.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 400)); return JSON.stringify({ ouverteAvant: avant, fermeeApres: !document.querySelector('.aide-voile') }); })()"));

if (capture) {
  await evaluer("(async () => { document.getElementById('bouton-aide').click(); await new Promise(r => setTimeout(r, 600)); return 1; })()");
  const img = await envoyer('Page.captureScreenshot', { format: 'png' });
  if (img.result && img.result.data) { writeFileSync(capture, Buffer.from(img.result.data, 'base64')); console.log(''); console.log('5. CAPTURE : ' + capture); }
}
console.log('');
console.log('6. exceptions : ' + erreurs.length + (erreurs.length ? ' -> ' + erreurs.slice(0,3).join(' ; ') : ''));
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(0);