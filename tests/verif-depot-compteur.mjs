// tests/verif-depot-compteur.mjs
//
// Défaut signalé le 14/10/2026 : « j'ai chargé des devis au format PDF et l'interface indique
// 0 devis chargé et 0 entreprise ». Cause constatée : déposer un PDF à l'étape 2 ne crée qu'une
// CARTE d'interface ; le devis et l'entreprise n'entrent au dossier qu'au clic sur « Ajouter ce
// devis ». Rien ne le disait : l'étape 3 affirmait même « chaque devis déposé crée ou rattache
// son entreprise », et l'étape 4 annonçait 0 / 0 sans prévenir qu'un fichier attendait.
//
// Ce banc fait le geste réel (dépôt d'un PDF texte généré ici) dans un vrai navigateur et
// vérifie des PROPRIÉTÉS, pas des existences :
//   - un fichier déposé et non ajouté est signalé, EN CLAIR, sur chacun des trois écrans
//     où le décompte 0 / 0 peut surprendre (Dépôt, Validation, Génération) ;
//   - ce signalement disparaît dès que le fichier est ajouté, et n'existe pas avant tout dépôt
//     (un avertissement permanent n'est plus lu) ;
//   - le chemin nominal (choisir une entreprise, ajouter) donne bien 1 entreprise / 1 devis ;
//   - l'étape Validation ne ment plus sur ce que fait un dépôt.
//
// Le banc démarre son propre serveur statique (les modules ES sont refusés en file://) :
//   node tests/verif-depot-compteur.mjs                       (serveur interne, port libre)
//   node tests/verif-depot-compteur.mjs http://127.0.0.1:8777/index.html   (serveur déjà lancé)
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');
const EDGE = process.env.NAVIGATEUR_BANC || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Serveur statique minimal                                            */
/* ------------------------------------------------------------------ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xlsx': 'application/octet-stream' };

function demarrerServeur() {
  return new Promise((resoudre) => {
    const serveur = http.createServer((req, rep) => {
      const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const fichier = path.join(RACINE, chemin === '/' ? 'index.html' : chemin);
      if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) {
        rep.writeHead(404); rep.end(); return;
      }
      rep.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream' });
      fs.createReadStream(fichier).pipe(rep);
    });
    serveur.listen(0, '127.0.0.1', () => resoudre({ serveur, url: 'http://127.0.0.1:' + serveur.address().port + '/index.html' }));
  });
}

/* ------------------------------------------------------------------ */
/* PDF texte minimal (aucune dépendance) : le banc fabrique son devis  */
/* ------------------------------------------------------------------ */
function fabriquerPdf(lignes) {
  const echapper = (s) => s.replace(/[()\\]/g, '\\$&');
  const flux = 'BT /F1 12 Tf 50 780 Td 16 TL\n' + lignes.map((l) => '(' + echapper(l) + ') Tj T*').join('\n') + '\nET';
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + flux.length + ' >>\nstream\n' + flux + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let sortie = '%PDF-1.4\n'; const decalages = [];
  objets.forEach((o, i) => { decalages.push(sortie.length); sortie += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = sortie.length;
  sortie += 'xref\n0 ' + (objets.length + 1) + '\n0000000000 65535 f \n'
    + decalages.map((d) => String(d).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + (objets.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(sortie, 'latin1').toString('base64');
}
const PDF_DEVIS = fabriquerPdf(['ENTREPRISE DUPONT MACONNERIE', 'DEVIS N 2026-014 du 12/10/2026',
  'Lot 01 Gros oeuvre', 'Total HT : 12 500,00 EUR', 'TVA 20 % : 2 500,00 EUR', 'Total TTC : 15 000,00 EUR']);

/* ------------------------------------------------------------------ */
/* Navigateur piloté par CDP                                           */
/* ------------------------------------------------------------------ */
async function lancerNavigateur(url, port) {
  const bord = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + port, '--user-data-dir=' + path.join(process.env.TEMP || '.', 'edge-depot-' + port + '-' + Date.now()),
    'about:blank'], { stdio: 'ignore' });
  let cible = null;
  for (let i = 0; i < 60 && !cible; i++) {
    try {
      const liste = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      cible = liste.find((c) => c.type === 'page' && c.webSocketDebuggerUrl);
    } catch { /* port pas encore ouvert */ }
    if (!cible) await dormir(500);
  }
  if (!cible) { try { process.kill(bord.pid); } catch {} throw new Error('aucune cible de page apres 30 s'); }
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
  const envoyer = (methode, params = {}) => new Promise((res) => {
    const id = ++compteur; attentes.set(id, res); ws.send(JSON.stringify({ id, method: methode, params }));
  });
  await envoyer('Runtime.enable');
  await envoyer('Page.navigate', { url });
  const evaluer = async (expression) => {
    const r = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (!r.result || r.result.exceptionDetails) {
      throw new Error('evaluation en echec : ' + JSON.stringify(r.result && r.result.exceptionDetails ? r.result.exceptionDetails.exception : r).slice(0, 400));
    }
    return r.result.result.value;
  };
  // Outils côté page : définis une fois, utilisés par les scénarios.
  const OUTILS = `window.__banc = {
    attendre: async (cond, ms) => { const fin = Date.now() + (ms || 20000);
      while (Date.now() < fin) { try { if (cond()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 150)); }
      return false; },
    etape: (i) => document.querySelectorAll('#etapes .etape')[i].click(),
    titre: () => { const h = document.querySelector('#contenu h2'); return h ? h.innerText.trim() : ''; },
    bandeau: () => document.getElementById('bandeau').innerText.replace(/\\s+/g, ' ').trim(),
    bouton: (debut) => Array.from(document.querySelectorAll('#contenu button')).find((b) => b.innerText.trim().indexOf(debut) === 0),
    contenu: () => document.getElementById('contenu').innerText.replace(/\\s+/g, ' ').trim(),
    deposer: (nom, b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], nom, { type: 'application/pdf' }));
      document.querySelector('.zone-depot').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); },
  }; true`;
  await evaluer(OUTILS);
  const demarre = await evaluer(`window.__banc.attendre(() => document.querySelectorAll('#etapes .etape').length === 4 && document.getElementById('contenu').innerText.length > 50, 30000)`);
  if (!demarre) throw new Error("l'application n'a pas démarré en 30 s");
  const fermer = async () => { try { ws.close(); } catch {} try { process.kill(bord.pid); } catch {} await dormir(300); };
  return { evaluer, fermer, problemes };
}

/* ------------------------------------------------------------------ */
/* Vérifications                                                       */
/* ------------------------------------------------------------------ */
let ok = 0; let ko = 0;
function verifier(intitule, bon, observe) {
  if (bon) { ok++; console.log('  ok    ' + intitule); }
  else { ko++; console.error('  ECHEC ' + intitule + '  observe=' + JSON.stringify(observe)); }
}
const EN_ATTENTE = /1 fichier.*pas encore ajout/i;

async function deposerUnDevis(nav) {
  await nav.evaluer(`window.__banc.etape(1); window.__banc.attendre(() => window.__banc.titre().indexOf('Dépôt des devis') === 0, 5000)`);
  await nav.evaluer(`window.__banc.deposer('DUPONT-devis-gros-oeuvre.pdf', ${JSON.stringify(PDF_DEVIS)}); true`);
  return nav.evaluer(`window.__banc.attendre(() => !!window.__banc.bouton('Ajouter ce devis'), 25000)`);
}

async function scenarioDepotNonAjoute(url) {
  console.log('--- SCENARIO A : un devis est déposé mais pas ajouté ---');
  const nav = await lancerNavigateur(url, 9341);
  try {
    await nav.evaluer(`window.__banc.etape(1); window.__banc.attendre(() => window.__banc.titre().indexOf('Dépôt des devis') === 0, 5000)`);
    const avant = await nav.evaluer(`window.__banc.bandeau()`);
    verifier("avant tout dépôt, aucun avertissement n'est affiché (pas de bruit permanent)", avant === '', avant);

    const pret = await deposerUnDevis(nav);
    verifier('TÉMOIN : le PDF est lu et la carte propose « Ajouter ce devis »', pret === true, pret);
    const ht = await nav.evaluer(`(document.querySelector('.fichier-depose input[placeholder="Montant HT"]') || {}).value`);
    verifier('TÉMOIN : le montant HT est pré-rempli depuis la couche texte (12500)', ht === '12500', ht);

    const b2 = await nav.evaluer(`window.__banc.bandeau()`);
    verifier("étape 2 (Dépôt) : un bandeau dit qu'1 fichier est déposé mais pas encore ajouté au dossier", EN_ATTENTE.test(b2), b2);

    await nav.evaluer(`window.__banc.bouton('Étape suivante').click(); window.__banc.attendre(() => window.__banc.titre().indexOf('Validation') === 0, 5000)`);
    const b3 = await nav.evaluer(`window.__banc.bandeau()`);
    verifier('étape 3 (Validation) : le même bandeau reste visible', EN_ATTENTE.test(b3), b3);
    const t3 = await nav.evaluer(`window.__banc.contenu()`);
    verifier("étape 3 : ne prétend plus que « chaque devis déposé crée ou rattache son entreprise »", !/cr[ée]+e ou rattache son entreprise/.test(t3), t3.slice(0, 260));

    await nav.evaluer(`window.__banc.etape(3); window.__banc.attendre(() => window.__banc.titre().indexOf('Génération') === 0, 5000)`);
    const b4 = await nav.evaluer(`window.__banc.bandeau()`);
    verifier('étape 4 (Génération) : le même bandeau reste visible', EN_ATTENTE.test(b4), b4);
    const t4 = await nav.evaluer(`window.__banc.contenu()`);
    verifier('TÉMOIN : le décompte 0 entreprise / 0 devis est exact (rien n\'a été ajouté)', /0 entreprise\(s\) \/ 0 devis enregistrés/.test(t4), t4.slice(0, 200));
    // Ce que l'aide annonce : recharger la page avant d'avoir cliqué fait disparaître le fichier.
    // Un énoncé d'aide non éprouvé est la fausse garantie que ce banc existe pour empêcher.
    await nav.evaluer(`setTimeout(() => location.reload(), 50); true`);
    await dormir(1500);
    let rechargee = false;
    for (let i = 0; i < 60 && !rechargee; i++) {
      try { rechargee = await nav.evaluer(`document.querySelectorAll('#etapes .etape').length === 4 && document.getElementById('contenu').innerText.length > 50`); } catch { /* page en cours de rechargement */ }
      if (!rechargee) await dormir(250);
    }
    await nav.evaluer(`document.querySelectorAll('#etapes .etape')[1].click(); true`);
    await dormir(500);
    const apres = await nav.evaluer(`JSON.stringify({ cartes: document.querySelectorAll('.fichier-depose').length, bandeau: document.getElementById('bandeau').innerText.trim() })`);
    verifier("après rechargement, le fichier non ajouté a disparu et le bandeau aussi (ce que dit l'aide)", rechargee && apres === JSON.stringify({ cartes: 0, bandeau: '' }), apres);
    verifier("aucune exception dans le navigateur", nav.problemes.length === 0, nav.problemes);
  } finally { await nav.fermer(); }
}

async function scenarioNominal(url) {
  console.log('--- SCENARIO B : chemin nominal, le devis est ajouté avec une entreprise ---');
  const nav = await lancerNavigateur(url, 9342);
  try {
    const pret = await deposerUnDevis(nav);
    verifier('TÉMOIN : la carte propose « Ajouter ce devis »', pret === true, pret);
    await nav.evaluer(`(() => { const s = document.querySelector('.fichier-depose select'); s.value = 'nouvelle'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const champ = await nav.evaluer(`window.__banc.attendre(() => !!document.querySelector('.fichier-depose input[placeholder^="Raison sociale"]'), 5000)`);
    verifier('choisir « + autre » fait apparaître la saisie de la raison sociale', champ === true, champ);
    await nav.evaluer(`(() => { const i = document.querySelector('.fichier-depose input[placeholder^="Raison sociale"]'); i.value = 'DUPONT MACONNERIE'; i.dispatchEvent(new Event('input', { bubbles: true })); window.__banc.bouton('Ajouter ce devis').click(); return true; })()`);
    const parti = await nav.evaluer(`window.__banc.attendre(() => document.querySelectorAll('.fichier-depose').length === 0, 5000)`);
    verifier('après « Ajouter ce devis », la carte quitte la liste des fichiers déposés', parti === true, parti);
    const b2 = await nav.evaluer(`window.__banc.bandeau()`);
    verifier("le bandeau d'attente disparaît dès que le fichier est ajouté", b2 === '' || !EN_ATTENTE.test(b2), b2);
    await nav.evaluer(`window.__banc.etape(3); window.__banc.attendre(() => window.__banc.titre().indexOf('Génération') === 0, 5000)`);
    const t4 = await nav.evaluer(`window.__banc.contenu()`);
    verifier('étape 4 : « 1 entreprise(s) / 1 devis enregistrés. »', /1 entreprise\(s\) \/ 1 devis enregistrés/.test(t4), t4.slice(0, 200));
    verifier("aucune exception dans le navigateur", nav.problemes.length === 0, nav.problemes);
  } finally { await nav.fermer(); }
}

const argument = process.argv[2];
const interne = argument ? null : await demarrerServeur();
const url = argument || interne.url;
try {
  await scenarioDepotNonAjoute(url);
  await scenarioNominal(url);
} catch (erreur) {
  ko++; console.error('  ECHEC banc interrompu : ' + (erreur && erreur.message ? erreur.message : erreur));
}
if (interne) interne.serveur.close();
console.log((ko === 0 ? 'VERIF DEPOT OK' : 'VERIF DEPOT : ' + ko + ' echec(s)') + ' (' + ok + ' ok)');
process.exit(ko === 0 ? 0 : 1);
