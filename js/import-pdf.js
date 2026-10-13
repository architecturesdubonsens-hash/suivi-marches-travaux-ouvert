// js/import-pdf.js
//
// Lecture des PDF déposés à l'écran 2 (Dépôt) :
//  - couche texte via pdf.js vendored (vendor/pdf.min.js + pdf.worker.min.js),
//    worker chargé en blob (robuste même en file://) sinon chemin relatif ;
//  - détection des pages "sans texte" (scans : environ 42 % du corpus réel) ;
//  - OCR tesseract.js À LA DEMANDE (CDN) : hors ligne, bouton désactivé et
//    message clair — dégradation gracieuse prévue par la SPEC §6.
//
// Aucune dépendance partenaire (calculs/assurances/etat/générateurs).

/** Charge un script classique (<script src>) une seule fois, avec délai d'attente. */
const scriptsEnCours = new Map();

export function chargerScript(src, delaiMs = 15000) {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("chargerScript: disponible uniquement dans le navigateur"));
  }
  if (scriptsEnCours.has(src)) return scriptsEnCours.get(src);
  const promesse = new Promise((resoudre, rejeter) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    const minuteur = setTimeout(() => rejeter(new Error("Chargement trop long : " + src)), delaiMs);
    script.onload = () => { clearTimeout(minuteur); resoudre(); };
    script.onerror = () => { clearTimeout(minuteur); rejeter(new Error("Impossible de charger : " + src)); };
    document.head.append(script);
  });
  scriptsEnCours.set(src, promesse);
  return promesse;
}

/** Instance pdf.js mise en cache (objet {getDocument, GlobalWorkerOptions...}). */
let pdfjsCourant = null;

/**
 * Charge pdf.js depuis vendor/ et configure le worker.
 * Stratégie worker : lecture du fichier en blob (fonctionne aussi en file://),
 * sinon chemin relatif ; en dernier recours pdf.js retombe seul en "fake
 * worker" sur le fil principal — l'extraction reste fonctionnelle.
 */
export async function chargerPdfjs() {
  if (pdfjsCourant) return pdfjsCourant;

  // 1) Build UMD exposée en global ?
  if (!window.pdfjsLib) {
    try {
      await chargerScript("vendor/pdf.min.js");
    } catch (e) {
      // 2) Build ESM : import dynamique relatif à CE module (js/ -> ../vendor/).
      try {
        const mod = await import("../vendor/pdf.min.js");
        pdfjsCourant = mod;
        return pdfjsCourant;
      } catch (e2) {
        throw new Error("pdf.js introuvable dans vendor/ : " + (e2 && e2.message ? e2.message : e));
      }
    }
  }
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("pdf.js chargé mais global pdfjsLib absent (build inattendue).");

  // Configuration du worker : blob d'abord (fetch du fichier vendu).
  try {
    const reponse = await fetch("vendor/pdf.worker.min.js");
    if (reponse.ok) {
      const blob = await reponse.blob();
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } else {
      lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    }
  } catch {
    // fetch refusé (file://) : chemin relatif, pdf.js gérera le repli.
    lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
  pdfjsCourant = lib;
  return lib;
}

/** Seuil : en dessous de ce nombre de caractères "lisibles", la page est un scan. */
export const SEUIL_PAGE_SANS_TEXTE = 30;

/** Une page dont la couche texte est quasi vide est considérée comme scannée. */
export function pageSembleScannee(texte) {
  const utile = String(texte || "").replace(/[^\p{L}\p{N}]/gu, "");
  return utile.length < SEUIL_PAGE_SANS_TEXTE;
}

/**
 * Extrait la couche texte de chaque page d'un PDF déjà lu en ArrayBuffer.
 * @param {ArrayBuffer} donnees
 * @returns {Promise<{nbPages: number, pages: {numero:number, texte:string, scannee:boolean}[]}>}
 */
export async function extraireTextePdf(donnees) {
  const lib = await chargerPdfjs();
  const doc = await lib.getDocument({ data: donnees }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    let texte = "";
    try {
      const page = await doc.getPage(i);
      const contenu = await page.getTextContent();
      texte = contenu.items.map((item) => item.str).join(" ");
    } catch {
      texte = ""; // page illisible : traitée comme un scan (saisie assistée)
    }
    pages.push({ numero: i, texte, scannee: pageSembleScannee(texte) });
  }
  return { nbPages: doc.numPages, pages };
}

/**
 * Haut niveau : analyse un File déposé par l'utilisateur.
 * @param {File} fichier
 * @returns {Promise<{nom:string, chemin:string, tailleKo:number, nbPages:number,
 *   pagesSansTexte:number, texteComplet:string}>}
 */
export async function analyserFichier(fichier) {
  const donnees = await fichier.arrayBuffer();
  const extrait = await extraireTextePdf(donnees);
  return {
    nom: fichier.name,
    chemin: fichier.webkitRelativePath || fichier.name,
    tailleKo: Math.round(fichier.size / 1024),
    nbPages: extrait.nbPages,
    pagesSansTexte: extrait.pages.filter((p) => p.scannee).length,
    texteComplet: extrait.pages.map((p) => p.texte).join("\n\n"),
  };
}

/** Tesseract.js chargé depuis le CDN, à la demande uniquement. */
let tesseractEnCours = null;

export function chargerTesseract() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("OCR : disponible uniquement dans le navigateur"));
  }
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractEnCours) {
    tesseractEnCours = chargerScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", 20000)
      .then(() => {
        if (!window.Tesseract) throw new Error("Tesseract introuvable après chargement CDN");
        return window.Tesseract;
      })
      .catch((e) => {
        tesseractEnCours = null; // permet une nouvelle tentative plus tard
        throw new Error("OCR indisponible (réseau ou CDN inaccessible) : " + e.message);
      });
  }
  return tesseractEnCours;
}

/**
 * OCR d'une page d'un PDF : rendu canvas via pdf.js, puis reconnaissance
 * tesseract.js (langue française). Appel UNIQUEMENT sur action explicite de
 * l'utilisateur (coût élevé, besoin réseau pour le CDN et le modèle fra).
 * @param {File} fichier
 * @param {number} numeroPage  (1-based)
 * @param {(avancement:number)=>void=} surAvancement
 * @returns {Promise<string>} texte reconnu
 */
export async function ocriserPage(fichier, numeroPage, surAvancement) {
  const lib = await chargerPdfjs();
  const Tesseract = await chargerTesseract();
  const doc = await lib.getDocument({ data: await fichier.arrayBuffer() }).promise;
  const page = await doc.getPage(numeroPage);
  const echelle = 2; // 144 dpi : compromis qualité / mémoire pour l'OCR
  const vue = page.getViewport({ scale: echelle });
  const canevas = document.createElement("canvas");
  canevas.width = Math.floor(vue.width);
  canevas.height = Math.floor(vue.height);
  const contexte = canevas.getContext("2d");
  await page.render({ canvasContext: contexte, viewport: vue }).promise;
  const resultat = await Tesseract.recognize(canevas, "fra", {
    logger: (m) => { if (surAvancement && m && typeof m.progress === "number") surAvancement(m.progress); },
  });
  canevas.width = 0; canevas.height = 0; // libère la mémoire
  return (resultat && resultat.data && resultat.data.text) || "";
}
