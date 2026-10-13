// tests/verif-clic-boutons.mjs
//
// LE DÉFAUT QUE CE BANC FERME (constaté le 07/10/2026).
// Signalement : « la fenêtre d'aide ne se ferme pas ». Le bouton « Fermer »
// existait, était visible, cliquable — et ne faisait rien, sans lever d'erreur.
// Cause : js/ui/helpers.js posait les écouteurs avec le nom d'événement tel quel
// (« onClick » -> addEventListener("Click")), et un type d'événement DOM est
// SENSIBLE À LA CASSE : « Click » ne se déclenche jamais. Les trente boutons
// écrits avec onClick étaient donc muets — pas seulement celui-là. Seul le pas
// de l'en-tête répondait, parce qu'app.js l'avait branché à la main sur « click ».
//
// CE QUE CE BANC EXIGE, dans un vrai navigateur (aucune de ces preuves n'est
// visible en Node : le défaut ne lève rien) :
//   1. le bouton « Fermer » de la fenêtre d'aide ferme la fenêtre ;
//   2. Échap la ferme aussi (non-régression du chemin qui, lui, marchait) ;
//   3. le bouton « ? » ouvre une bulle d'aide, et son « × » la referme ;
//   4. « + Ajouter un conducteur de travaux » ajoute réellement une ligne ;
//   5. « Étape suivante » fait passer de l'écran 1 à l'écran 2.
// Les points 3 à 5 sont là parce qu'ils viennent d'AUTRES modules : le défaut
// était dans le socle commun (el), donc la preuve doit couvrir le socle, pas
// seulement l'aide.
//
// Prérequis : l'application servie en HTTP.
//   python -m http.server 8777 --bind 127.0.0.1 --directory <dépôt>
// Usage :
//   node tests/verif-clic-boutons.mjs [url]      (défaut : http://127.0.0.1:8777/index.html)
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9321;
const url = process.argv[2] || 'http://127.0.0.1:8777/index.html';

const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1400,1000', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '\\edge-clic-' + Date.now(), url], { stdio: 'ignore' });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 60 && !page; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); page = l.find((c) => c.type === 'page' && c.webSocketDebuggerUrl); } catch { /* port ferme */ }
  if (!page) await dormir(500);
}
if (!page) { console.log('aucune cible de page apres 30 s'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let n = 0; const att = new Map(); const exceptions = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && att.has(m.id)) { att.get(m.id)(m); att.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(String(m.params.exceptionDetails.text || '').slice(0, 160));
});
const envoyer = (method, params = {}) => new Promise((res) => { const id = ++n; att.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluer = async (e) => {
  const r = await envoyer('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { erreur: String(r.result.exceptionDetails.text || '').slice(0, 200) };
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await envoyer('Runtime.enable');
await dormir(9000);

let ok = 0, ko = 0;
const verifier = (cond, libelle, detail = '') => {
  if (cond) { ok++; console.log('  [OK]    ' + libelle); }
  else { ko++; console.log('  [ÉCHEC] ' + libelle + (detail ? ' — ' + detail : '')); }
};
const lire = async (expr) => {
  const v = await evaluer(expr);
  if (v && typeof v === 'object' && v.erreur) { console.log('  (exception dans la sonde : ' + v.erreur + ')'); return null; }
  try { return JSON.parse(v); } catch { return v; }
};

console.log('1. LE BOUTON « FERMER » DE LA FENETRE D AIDE');
const r1 = await lire("(async () => { document.getElementById('bouton-aide').click(); await new Promise(r=>setTimeout(r,600)); const v=document.querySelector('.aide-voile'); const b=v && v.querySelector('.aide-entete button'); if(!b) return JSON.stringify({ ouverte:!!v, bouton:'ABSENT' }); b.click(); await new Promise(r=>setTimeout(r,600)); return JSON.stringify({ ouverte:true, bouton:'present', fermeeApresClic: !document.querySelector('.aide-voile') }); })()");
verifier(r1 && r1.ouverte === true, 'la fenetre d aide s ouvre depuis l en-tete', JSON.stringify(r1));
verifier(r1 && r1.fermeeApresClic === true, 'le clic sur « Fermer » ferme la fenetre', JSON.stringify(r1));

console.log('');
console.log('2. ECHAP FERME TOUJOURS (chemin qui marchait deja)');
const r2 = await lire("(async () => { if(!document.querySelector('.aide-voile')) { document.getElementById('bouton-aide').click(); await new Promise(r=>setTimeout(r,600)); } document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await new Promise(r=>setTimeout(r,500)); return JSON.stringify({ fermeeParEchap: !document.querySelector('.aide-voile') }); })()");
verifier(r2 && r2.fermeeParEchap === true, 'Echap ferme la fenetre', JSON.stringify(r2));

console.log('');
console.log('3. LA BULLE D AIDE : OUVRIR PAR « ? », FERMER PAR « x »');
const r3 = await lire("(async () => { const b=document.querySelector('#contenu .aide-ancre'); if(!b) return JSON.stringify({ boutonAncre:'ABSENT' }); b.click(); await new Promise(r=>setTimeout(r,500)); const bulle=document.querySelector('.aide-bulle'); const x=bulle && bulle.querySelector('.aide-bulle-fermer'); if(!x) return JSON.stringify({ ouverte:!!bulle, croix:'ABSENTE' }); x.click(); await new Promise(r=>setTimeout(r,400)); return JSON.stringify({ ouverte:true, croix:'presente', fermeeParCroix: !document.querySelector('.aide-bulle') }); })()");
verifier(r3 && r3.ouverte === true, 'le bouton « ? » ouvre une bulle d aide', JSON.stringify(r3));
verifier(r3 && r3.fermeeParCroix === true, 'la croix de la bulle la referme', JSON.stringify(r3));

console.log('');
console.log('4. UN BOUTON D ECRAN AGIT VRAIMENT : AJOUTER UN CONDUCTEUR DE TRAVAUX');
const r4 = await lire("(async () => { const champ='input[placeholder=\"Nom du conducteur de travaux\"]'; const avant=document.querySelectorAll(champ).length; const b=Array.from(document.querySelectorAll('#contenu button')).find(x=>/Ajouter un conducteur/.test(x.textContent)); if(!b) return JSON.stringify({ bouton:'ABSENT', avant }); b.click(); await new Promise(r=>setTimeout(r,600)); const apres=document.querySelectorAll(champ).length; return JSON.stringify({ avant, apres, ajoute: apres > avant }); })()");
verifier(r4 && r4.ajoute === true, 'le bouton ajoute reellement une ligne', JSON.stringify(r4));

console.log('');
console.log('5. LE PAS SUIVANT PAR LE BOUTON DE L ECRAN');
const r5 = await lire("(async () => { const b=Array.from(document.querySelectorAll('#contenu button')).find(x=>/Etape suivante|Étape suivante/.test(x.textContent)); if(!b) return JSON.stringify({ bouton:'ABSENT' }); b.click(); await new Promise(r=>setTimeout(r,900)); const etapes=Array.from(document.querySelectorAll('#etapes .etape')); const courante=etapes.findIndex(e=>/courante/.test(e.className)); return JSON.stringify({ courante, vaAuDepot: /D[ée]p[oô]t/.test(document.getElementById('contenu').innerText.slice(0,200)) }); })()");
verifier(r5 && r5.courante === 1, 'le clic fait passer a l ecran 2 (Depot)', JSON.stringify(r5));
verifier(r5 && r5.vaAuDepot === true, 'l ecran affiche est bien celui du depot', JSON.stringify(r5));

console.log('');
console.log('exceptions pendant le parcours : ' + exceptions.length + (exceptions.length ? ' -> ' + exceptions.slice(0, 3).join(' ; ') : ''));
verifier(exceptions.length === 0, 'aucune exception JavaScript');

console.log('');
console.log(ok + ' OK, ' + ko + ' echec(s).');
ws.close(); try { process.kill(bord.pid); } catch { /* deja mort */ }
await dormir(300);
process.exit(ko ? 1 : 0);
