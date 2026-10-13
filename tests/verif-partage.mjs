// Verification de la barre de dossier, DANS LE NAVIGATEUR et SUR LE RESEAU.
//
// Deux choses sont mesurees, pas supposees :
//   1. la barre est presente sur LES QUATRE ECRANS (c'est le defaut constate :
//      elle vivait au bas du dernier ecran, ou personne ne la trouvait) ;
//   2. une connexion reelle avec un compte inexistant affiche le refus de la base
//      ce qui prouve toute la chaine : configuration -> adaptateur -> authentification
//      -> message d'erreur -> interface.
// Une capture d'ecran est enregistree pour inspection visuelle.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9229;
const url = process.argv[2];
const capture = process.argv[3] || null;
const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1400,950',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '\\edge-partage-' + Date.now(), url], { stdio: 'ignore' });
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
  if (m.method === 'Runtime.exceptionThrown') erreurs.push(m.params.exceptionDetails.text || 'exception');
});
const envoyer = (method, params = {}) => new Promise((res) => { const id = ++n; att.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return 'EXCEPTION: ' + r.result.exceptionDetails.text;
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await envoyer('Runtime.enable');
await envoyer('Page.enable');
await dormir(9000);

const NL = 'String.fromCharCode(10)';

// 1. La barre est-elle visible, et sur CHAQUE ecran ?
console.log('1. BARRE SUR LES QUATRE ECRANS');
console.log(await evaluer("(async () => { const out = []; const b = Array.from(document.querySelectorAll('#etapes .etape')); for (let i = 0; i < b.length; i++) { b[i].click(); await new Promise(r => setTimeout(r, 900)); const hote = document.getElementById('barre-dossier'); const t = hote ? hote.innerText.split(" + NL + ").join(' ') : ''; const r = hote ? hote.getBoundingClientRect() : null; out.push({ ecran: i+1, barreTexte: t.slice(0, 70), hauteurPx: r ? Math.round(r.height) : 0, visible: !!(r && r.height > 0 && r.width > 0), champCourriel: !!document.querySelector('#barre-dossier input[type=email]'), boutonConnexion: t.indexOf('Se connecter') >= 0 }); } return JSON.stringify(out, null, 1); })()"));

// 2. Les champs de la barre sont-ils REELLEMENT habilles ? (le defaut : aucun style)
console.log('');
console.log('2. HABILLAGE MESURE DES CHAMPS');
console.log(await evaluer("(() => { const e = document.querySelector('#barre-dossier input[type=email]'); if (!e) return 'champ absent'; const c = getComputedStyle(e); const h = document.getElementById('barre-dossier').getBoundingClientRect(); return JSON.stringify({ largeurChamp: c.width, bordure: c.borderTopWidth + ' ' + c.borderTopColor, rayon: c.borderRadius, police: c.fontFamily.slice(0, 28), hauteurBarre: Math.round(h.height) }); })()"));

// 3. L'etat reel du projet doit etre DIT a l'ecran.
console.log('');
// 3. Le bandeau pleine largeur a ete RETIRE de la barre le 25/09/2026, a la demande de
// l'utilisateur : il occupait une ligne sur les quatre ecrans en permanence. On verifie
// donc son ABSENCE ici, et sa presence dans le mode d'emploi (tests/verif-aide.mjs).
console.log('3. PLUS DE BANDEAU DANS LA BARRE');
console.log(await evaluer("(async () => { const t = document.getElementById('barre-dossier').innerText; return JSON.stringify({ bandeauPleineLargeur: t.indexOf('Inscription publique') >= 0, hauteurBarre: Math.round(document.getElementById('barre-dossier').getBoundingClientRect().height) }); })()"));

// 4. Connexion avec un compte inexistant : le refus de la base doit s'afficher.
console.log('');
console.log('4. TENTATIVE REELLE');
console.log(await evaluer("(async () => { const email = document.querySelector('#barre-dossier input[type=email]'); const mdp = document.querySelector('#barre-dossier input[type=password]'); const bouton = Array.from(document.querySelectorAll('#barre-dossier button')).find(x => x.innerText.indexOf('Se connecter') >= 0); if (!email || !bouton) return 'FORMULAIRE INTROUVABLE'; email.value = 'verification@exemple.invalid'; email.dispatchEvent(new Event('input', { bubbles: true })); mdp.value = 'motdepasse-quelconque'; mdp.dispatchEvent(new Event('input', { bubbles: true })); bouton.click(); await new Promise(r => setTimeout(r, 6000)); const plat = document.getElementById('barre-dossier').innerText.split(" + NL + ").join(' '); const j = plat.indexOf('Connexion'); return JSON.stringify({ messageAffiche: j >= 0 ? plat.slice(j, j + 120) : 'AUCUN MESSAGE', courrielConserve: (document.querySelector('#barre-dossier input[type=email]') || {}).value || null }); })()"));

// 5. Capture d'ecran, pour inspection visuelle.
if (capture) {
  const img = await envoyer('Page.captureScreenshot', { format: 'png' });
  if (img.result && img.result.data) {
    writeFileSync(capture, Buffer.from(img.result.data, 'base64'));
    console.log('');
    console.log('5. CAPTURE           : ' + capture);
  }
}
console.log('');
console.log('6. exceptions        : ' + erreurs.length + (erreurs.length ? ' -> ' + erreurs.slice(0, 4).join(' ; ') : ''));
ws.close();
try { process.kill(bord.pid); } catch {}
await dormir(300);
process.exit(0);
