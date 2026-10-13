// tests/lib/chargeur-umd.mjs
//
// Les tests de ce dépôt doivent charger docx, ExcelJS et JSZip SANS npm :
// le dépôt vit sur le Drive et l'interdiction des node_modules porte sur
// l'emplacement, pas sur l'execution. On evalue donc le bundle UMD de vendor/
// dans un contexte vm qui imite un navigateur, puis on lit l'objet global.
//
// Usage :
//   const docx = chargerUMD('vendor/docx.umd.js', 'docx');
//   const ExcelJS = chargerUMD('vendor/exceljs.min.js', 'ExcelJS');
// Surcharge d'environnement (3e argument) si une bibliotheque exige un
// symbole particulier : chargerUMD(chemin, nom, { TextDecoder }).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function chargerUMD(chemin, nomGlobal, surcharge = {}) {
  const code = readFileSync(chemin, 'utf8');
  const exportsModule = { exports: {} };
  const contexte = {
    module: exportsModule,
    exports: exportsModule.exports,
    console, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: globalThis.performance ?? { now: () => Date.now() },
    ...surcharge,
  };
  contexte.window = contexte;
  contexte.self = contexte;
  contexte.globalThis = contexte;
  vm.createContext(contexte, { name: 'umd:' + chemin });
  vm.runInContext(code, contexte, { filename: chemin, timeout: 120000 });

  const candidats = [contexte[nomGlobal], exportsModule.exports, contexte.exports];
  const obj = candidats.find(Boolean);
  if (!obj) {
    throw new Error('chargerUMD: global "' + nomGlobal + '" absent apres evaluation de ' + chemin);
  }
  return obj;
}
