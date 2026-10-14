// tests/verif-pc-delivre.mjs
//
// Demande de l'utilisateur du 14/10/2026 : la page 1 doit demander la DATE DE DÉLIVRANCE du
// permis de construire, sous le libellé exact « Délivré le », juste après le numéro du permis.
// La donnée s'appelle operation.pcDelivreLe (date ISO, comme droc et faitLe).
//
// Ce banc fait le geste réel dans un vrai navigateur (sans fenêtre) et vérifie des PROPRIÉTÉS :
//   - le champ existe, est une date, porte le libellé exact, et SUIT immédiatement le numéro du
//     permis (une existence ne suffit pas : un champ relégué en bas de carte ne répond pas à la
//     demande) ;
//   - la valeur saisie est ENREGISTRÉE (relue dans le dossier du navigateur) et revient après
//     rechargement de la page ;
//   - un dossier enregistré AVANT l'existence du champ se charge sans exception et laisse le
//     champ vide (aucune date inventée).
//
// Le banc démarre son propre serveur statique (les modules ES sont refusés en file://) :
//   node tests/verif-pc-delivre.mjs                       (serveur interne, port libre)
//   node tests/verif-pc-delivre.mjs http://127.0.0.1:8777/index.html   (serveur déjà lancé)
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');
const EDGE = process.env.NAVIGATEUR_BANC || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9361;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function demarrerServeur() {
  return new Promise((resoudre) => {
    const serveur = http.createServer((req, rep) => {
      const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const fichier = path.join(RACINE, chemin === '/' ? 'index.html' : chemin);
      if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) { rep.writeHead(404); rep.end(); return; }
      rep.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream' });
      fs.createReadStream(fichier).pipe(rep);
    });
    serveur.listen(0, '127.0.0.1', () => resoudre({ serveur, url: 'http://127.0.0.1:' + serveur.address().port + '/index.html' }));
  });
}

let ok = 0; let ko = 0;
function verifier(intitule, bon, observe) {
  if (bon) { ok++; console.log('  ok    ' + intitule); }
  else { ko++; console.error('  ECHEC ' + intitule + '  observe=' + JSON.stringify(observe)); }
}

const interne = process.argv[2] ? null : await demarrerServeur();
const url = process.argv[2] || interne.url;
const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(process.env.TEMP || '.', 'edge-pc-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
let cible = null;
for (let i = 0; i < 60 && !cible; i++) {
  try { cible = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((c) => c.type === 'page' && c.webSocketDebuggerUrl); } catch { /* port pas encore ouvert */ }
  if (!cible) await dormir(500);
}
if (!cible) { try { process.kill(bord.pid); } catch {} console.error('aucune cible de page apres 30 s'); process.exit(1); }
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let compteur = 0; const attentes = new Map(); const problemes = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && attentes.has(m.id)) { attentes.get(m.id)(m); attentes.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problemes.push('EXCEPTION : ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
  }
});
const envoyer = (methode, params = {}) => new Promise((res) => { const id = ++compteur; attentes.set(id, res); ws.send(JSON.stringify({ id, method: methode, params })); });
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (!r.result || r.result.exceptionDetails) throw new Error('evaluation en echec : ' + JSON.stringify(r.result && r.result.exceptionDetails ? r.result.exceptionDetails.exception : r).slice(0, 300));
  return r.result.result.value;
};
const PRET = `document.querySelectorAll('#etapes .etape').length === 4 && !!document.querySelector('#conf-operation-pc')`;
async function attendre(expression, ms = 30000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { try { if (await evaluer(expression)) return true; } catch { /* page en cours de chargement */ } await dormir(250); }
  return false;
}
// Libellés des champs de la carte « 1 · Opération », dans l'ordre d'affichage.
const CHAMPS_OPERATION = `(() => {
  const carte = Array.from(document.querySelectorAll('#contenu section.carte')).find((s) => /^1\\s*·\\s*Opération/.test((s.querySelector('h2') || {}).innerText || ''));
  if (!carte) return null;
  return Array.from(carte.querySelectorAll('.champ')).map((c) => ({ libelle: (c.querySelector('label') || {}).textContent, type: (c.querySelector('input') || {}).type, id: (c.querySelector('input') || {}).id }));
})()`;

try {
  await envoyer('Runtime.enable');
  await envoyer('Page.navigate', { url });
  verifier("l'application démarre et affiche la page 1", await attendre(PRET), null);

  const champs = await evaluer(CHAMPS_OPERATION);
  const libelles = (champs || []).map((c) => c.libelle);
  const iPc = libelles.indexOf('N° de permis de construire');
  const iDelivre = libelles.indexOf('Délivré le');
  verifier('TÉMOIN : le champ « N° de permis de construire » existe dans la carte Opération', iPc >= 0, libelles);
  verifier('un champ au libellé exact « Délivré le » existe dans la carte Opération', iDelivre >= 0, libelles);
  verifier('« Délivré le » suit IMMÉDIATEMENT « N° de permis de construire »', iPc >= 0 && iDelivre === iPc + 1, libelles);
  verifier('« Délivré le » est un champ de type date', iDelivre >= 0 && champs[iDelivre].type === 'date', champs && champs[iDelivre]);
  verifier('le champ porte l\'identifiant conf-operation-pcDelivreLe (donnée operation.pcDelivreLe)', iDelivre >= 0 && champs[iDelivre].id === 'conf-operation-pcDelivreLe', champs && champs[iDelivre]);

  if (iDelivre >= 0) {
    await evaluer(`(() => { const i = document.getElementById('conf-operation-pcDelivreLe'); i.value = '2025-03-12'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const enregistre = await attendre(`(async () => { const m = await import('/js/etat.js'); const p = await m.chargerProjet('courant'); return !!p && p.operation.pcDelivreLe === '2025-03-12'; })()`, 15000);
    verifier('la date saisie est ENREGISTRÉE dans le dossier du navigateur (operation.pcDelivreLe = 2025-03-12)', enregistre === true, enregistre);

    await evaluer(`setTimeout(() => location.reload(), 50); true`);
    await dormir(1500);
    verifier('après rechargement, l\'application revient', await attendre(PRET), null);
    const relu = await evaluer(`(document.getElementById('conf-operation-pcDelivreLe') || {}).value`);
    verifier('après rechargement, le champ affiche 2025-03-12', relu === '2025-03-12', relu);

    // Dossier enregistré AVANT l'existence du champ : on retire la clé du dossier enregistré.
    await evaluer(`(async () => { const m = await import('/js/etat.js'); const p = await m.chargerProjet('courant'); delete p.operation.pcDelivreLe; await m.sauvegarderProjet(p); return true; })()`);
    await evaluer(`setTimeout(() => location.reload(), 50); true`);
    await dormir(1500);
    verifier('un dossier sans la clé se charge (aucune exception)', await attendre(PRET), problemes);
    const vide = await evaluer(`(document.getElementById('conf-operation-pcDelivreLe') || {}).value`);
    verifier('un dossier sans la clé laisse le champ vide (aucune date inventée)', vide === '', vide);
  }
  verifier('aucune exception dans le navigateur', problemes.length === 0, problemes);
} catch (erreur) {
  ko++; console.error('  ECHEC banc interrompu : ' + (erreur && erreur.message ? erreur.message : erreur));
} finally {
  try { ws.close(); } catch {} try { process.kill(bord.pid); } catch {}
  if (interne) interne.serveur.close();
  await dormir(300);
}
console.log((ko === 0 ? 'VERIF PC DELIVRE OK' : 'VERIF PC DELIVRE : ' + ko + ' echec(s)') + ' (' + ok + ' ok)');
process.exit(ko === 0 ? 0 : 1);
