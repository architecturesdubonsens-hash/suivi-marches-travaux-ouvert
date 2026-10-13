// bin/aide-document.mjs — tire de l'aide un document lisible HORS de l'application.
//
// POURQUOI. Le contenu d'aide a deux usages : guider dans l'interface, et servir de
// support pour expliquer l'outil à quelqu'un qui ne l'a pas sous les yeux. Recopier
// le second depuis le premier garantirait qu'ils divergent à la première correction.
// Ce script lit donc la MÊME source — js/aide-contenu.js — et en rend une page
// autonome. Aucun texte n'est écrit ici : s'il manque une phrase, elle manque dans
// la source, et il faut l'y ajouter.
//
// L'ORDRE EST CELUI DU MÉTIER, PAS CELUI DE L'INTERFACE. Le document suit les huit
// moments du marché (JALONS), et rattache à chacun sa fiche. C'est l'ordre dans lequel
// on explique un marché de travaux à quelqu'un ; l'ordre des écrans ne vaut que devant
// l'écran. Les sections du mode d'emploi viennent après, en annexe : elles parlent de
// l'outil, pas du métier.
//
// NE PAS PUBLIER. bin/ est exclu du déploiement (.vercelignore) : ce script n'est pas
// servi au navigateur, et le document produit va dans tests-output/, non versionné.
//
// Usage :
//   node bin/aide-document.mjs                      -> tests-output/aide-fonctionnalites.md
//                                                      tests-output/aide-fonctionnalites.html
//   node bin/aide-document.mjs <dossier-de-sortie>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const sortie = process.argv[2] || join(racine, 'tests-output');

// Import par URL de fichier : indispensable sous Windows, où un chemin « D:\... »
// n'est pas une URL de module valide.
const { JALONS, FICHES, SECTIONS, fiche } = await import(
  pathToFileURL(join(racine, 'js', 'aide-contenu.js')).href
);

const ETIQUETTES = { outil: "tenu par l'application", partiel: 'partiellement tenu', absent: 'hors outil' };

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

function blocsMd(blocs, niveau) {
  const out = [];
  for (const [type, contenu, lignes] of blocs) {
    if (type === 'p') out.push(contenu, '');
    else if (type === 'attention') out.push('> **Ce qui engage.** ' + contenu, '');
    else if (type === 'ul') { for (const x of contenu) out.push('- ' + x); out.push(''); }
    else if (type === 'cle') out.push('**' + contenu + '**', '', lignes, '');
    else if (type === 'etapes') {
      for (const [t, x] of contenu) out.push('- **' + t + '** — ' + x);
      out.push('');
    } else if (type === 'tableau') {
      out.push('| ' + contenu.join(' | ') + ' |');
      out.push('|' + contenu.map(() => ' --- ').join('|') + '|');
      for (const l of lignes) out.push('| ' + l.join(' | ') + ' |');
      out.push('');
    } else if (type === 'jalons' || type === 'fichesHorsEcran' || type === 'etatBase') {
      // Blocs vivants ou déjà développés par ailleurs dans ce document : on ne les
      // redit pas, et on ne prétend pas lire l'état d'une base depuis un script.
      continue;
    }
  }
  return out;
}

function markdown() {
  const l = [];
  l.push('# Suivi des marchés de travaux — ce que fait l\'outil', '');
  l.push('Document produit automatiquement depuis `js/aide-contenu.js`, source unique de l\'aide de');
  l.push('l\'application. Ne pas le modifier à la main : toute correction se fait dans la source,');
  l.push('et ce document est régénéré par `node bin/aide-document.mjs`.', '');
  l.push('L\'ordre suivi est celui du marché, pas celui des écrans.', '');

  l.push('## Le marché de bout en bout', '');
  l.push('| Phase | Couverture |');
  l.push('| --- | --- |');
  for (const j of JALONS) l.push('| ' + j.titre + ' | ' + (ETIQUETTES[j.couverture] || j.couverture) + ' |');
  l.push('');

  let n = 0;
  for (const j of JALONS) {
    n += 1;
    l.push('## ' + n + '. ' + j.titre, '');
    l.push('*' + (ETIQUETTES[j.couverture] || j.couverture) + '*', '');
    l.push(j.quoi, '');
    l.push('> **Ce qui engage.** ' + j.engage, '');
    const f = fiche(j.fiche);
    if (f) {
      l.push('### ' + f.titre, '');
      l.push(...blocsMd(f.blocs));
    }
  }

  // Fiches rattachées à aucun jalon : rien ne doit tomber du document.
  const vues = new Set(JALONS.map((j) => j.fiche));
  const restantes = FICHES.filter((f) => !vues.has(f.cle));
  if (restantes.length) {
    l.push('## Autres points', '');
    for (const f of restantes) { l.push('### ' + f.titre, ''); l.push(...blocsMd(f.blocs)); }
  }

  l.push('## Annexe — mode d\'emploi de l\'application', '');
  l.push('Cette partie explique l\'outil (où l\'on clique, mise en service). Elle ne contient pas de');
  l.push('règle de marché : celles-ci sont au-dessus.', '');
  for (const s of SECTIONS) { l.push('### ' + s.titre, ''); l.push(...blocsMd(s.blocs)); }

  return l.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* HTML autonome — une seule page, sans dépendance                     */
/* ------------------------------------------------------------------ */

const ech = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function blocsHtml(blocs) {
  const out = [];
  for (const [type, contenu, lignes] of blocs) {
    if (type === 'p') out.push('<p>' + ech(contenu) + '</p>');
    else if (type === 'attention') out.push('<p class="engage"><b>Ce qui engage.</b> ' + ech(contenu) + '</p>');
    else if (type === 'ul') out.push('<ul>' + contenu.map((x) => '<li>' + ech(x) + '</li>').join('') + '</ul>');
    else if (type === 'cle') out.push('<p class="q">' + ech(contenu) + '</p><p>' + ech(lignes) + '</p>');
    else if (type === 'etapes') {
      out.push('<ul>' + contenu.map(([t, x]) => '<li><b>' + ech(t) + '</b> — ' + ech(x) + '</li>').join('') + '</ul>');
    } else if (type === 'tableau') {
      out.push('<table><thead><tr>' + contenu.map((h) => '<th>' + ech(h) + '</th>').join('') + '</tr></thead><tbody>'
        + lignes.map((l) => '<tr>' + l.map((c) => '<td>' + ech(c) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table>');
    }
  }
  return out.join('\n');
}

function html() {
  const p = [];
  p.push('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">');
  p.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  p.push('<meta name="robots" content="noindex, nofollow">');
  p.push('<title>Suivi des marchés de travaux — ce que fait l\'outil</title><style>');
  p.push(`:root{--bleu:#13364f;--gris:#5b6670;--trait:#d8dee3;--jaune:#fdf6e3;--jauneb:#c9a227}
body{max-width:46rem;margin:2rem auto;padding:0 1.2rem;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2429}
h1{color:var(--bleu);border-bottom:3px solid var(--bleu);padding-bottom:.4rem}
h2{color:var(--bleu);margin-top:2.2rem;border-bottom:1px solid var(--trait);padding-bottom:.25rem}
h3{color:var(--bleu);margin-top:1.4rem;font-size:1.05rem}
.couv{font-family:ui-monospace,monospace;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris)}
.engage{background:var(--jaune);border-left:4px solid var(--jauneb);padding:.5rem .7rem;margin:.6rem 0}
.q{font-weight:600;margin-bottom:.1rem}
table{border-collapse:collapse;width:100%;margin:.6rem 0;font-size:.92rem}
th,td{border:1px solid var(--trait);padding:.35rem .5rem;text-align:left;vertical-align:top}
th{background:#f4f6f8}
.note{color:var(--gris);font-size:.88rem}
@media print{body{max-width:none;margin:0}h2{page-break-after:avoid}}</style></head><body>`);
  p.push('<h1>Suivi des marchés de travaux — ce que fait l\'outil</h1>');
  p.push('<p class="note">Page produite automatiquement depuis <code>js/aide-contenu.js</code>, source unique de '
    + 'l\'aide de l\'application. Toute correction se fait dans la source, puis <code>node bin/aide-document.mjs</code>. '
    + 'L\'ordre suivi est celui du marché, pas celui des écrans.</p>');

  p.push('<h2>Le marché de bout en bout</h2><table><thead><tr><th>Phase</th><th>Couverture</th></tr></thead><tbody>');
  for (const j of JALONS) p.push('<tr><td>' + ech(j.titre) + '</td><td>' + ech(ETIQUETTES[j.couverture] || j.couverture) + '</td></tr>');
  p.push('</tbody></table>');

  let n = 0;
  for (const j of JALONS) {
    n += 1;
    p.push('<h2>' + n + '. ' + ech(j.titre) + '</h2>');
    p.push('<p class="couv">' + ech(ETIQUETTES[j.couverture] || j.couverture) + '</p>');
    p.push('<p>' + ech(j.quoi) + '</p>');
    p.push('<p class="engage"><b>Ce qui engage.</b> ' + ech(j.engage) + '</p>');
    const f = fiche(j.fiche);
    if (f) { p.push('<h3>' + ech(f.titre) + '</h3>'); p.push(blocsHtml(f.blocs)); }
  }

  const vues = new Set(JALONS.map((j) => j.fiche));
  const restantes = FICHES.filter((f) => !vues.has(f.cle));
  if (restantes.length) {
    p.push('<h2>Autres points</h2>');
    for (const f of restantes) { p.push('<h3>' + ech(f.titre) + '</h3>'); p.push(blocsHtml(f.blocs)); }
  }

  p.push('<h2>Annexe — mode d\'emploi de l\'application</h2>');
  p.push('<p class="note">Cette partie explique l\'outil. Les règles de marché sont au-dessus.</p>');
  for (const s of SECTIONS) { p.push('<h3>' + ech(s.titre) + '</h3>'); p.push(blocsHtml(s.blocs)); }

  p.push('</body></html>');
  return p.join('\n');
}

/* ------------------------------------------------------------------ */

mkdirSync(sortie, { recursive: true });
const md = join(sortie, 'aide-fonctionnalites.md');
const ht = join(sortie, 'aide-fonctionnalites.html');
writeFileSync(md, markdown(), 'utf8');
writeFileSync(ht, html(), 'utf8');
const motsJalons = JALONS.reduce((n, j) => n + (j.quoi + ' ' + j.engage).split(/\s+/).length, 0);
console.log('aide-fonctionnalites.md   ' + md);
console.log('aide-fonctionnalites.html ' + ht);
console.log(JALONS.length + ' phases, ' + FICHES.length + ' fiches, ' + SECTIONS.length
  + ' sections, ~' + motsJalons + ' mots de chronologie.');
