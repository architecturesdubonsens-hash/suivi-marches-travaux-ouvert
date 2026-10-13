// js/ui/helpers.js
//
// Utilitaires DOM et de formatage partagés par les quatre écrans.
// Module SANS dépendance partenaire : utilisable tel quel, et importable en
// Node pour les contrôles de syntaxe (aucun accès au document au chargement).

/** Crée un élément DOM. attrs : {classe, texte, html, attributs..., events...}. */
export function el(balise, attrs = {}, ...enfants) {
  const noeud = document.createElement(balise);
  const { classe, texte, html, ...reste } = attrs;
  if (classe) noeud.className = classe;
  if (texte !== undefined) noeud.textContent = texte;
  if (html !== undefined) noeud.innerHTML = html; // réservé aux contenus internes contrôlés
  for (const [cle, valeur] of Object.entries(reste)) {
    if (cle.startsWith("on") && typeof valeur === "function") {
      // Le type d'événement DOM est SENSIBLE À LA CASSE : « onClick » doit poser un
      // écouteur sur « click », jamais sur « Click ». Un écouteur posé sur « Click »
      // ne se déclenche jamais — et sans lever la moindre erreur : le bouton paraît
      // simplement mort. Constaté le 07/10/2026 sur le bouton « Fermer » de la
      // fenêtre d'aide ; les trente boutons écrits de la même façon étaient muets,
      // seul le pas de l'en-tête (branché à la main sur « click ») répondait.
      noeud.addEventListener(cle.slice(2).toLowerCase(), valeur);
    } else if (valeur !== undefined && valeur !== null && valeur !== false) {
      noeud.setAttribute(cle, valeur === true ? "" : String(valeur));
    }
  }
  for (const enfant of enfants.flat()) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    noeud.append(enfant.nodeType ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

/** Notification flottante (coin bas-droit), disparition automatique. */
export function toast(message, type = "info", dureeMs = 4200) {
  const zone = document.getElementById("toasts");
  if (!zone) { console.info("[toast]", type, message); return; }
  const boite = el("div", { classe: "toast " + type, texte: message });
  zone.append(boite);
  setTimeout(() => boite.remove(), dureeMs);
}

/** 97133.57 -> "97 133,57 €" (séparateur milliers, virgule française). */
export function fmtEuros(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + " €";
}

/** "2025-03-05" -> "05/03/2025" ; renvoie l'entrée si non convertible. */
export function fmtDate(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso);
}

/** Date du jour au format ISO court (YYYY-MM-DD), fuseau local. */
export function aujourdhuiIso() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const jj = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + jj;
}

/** Débounce simple : retarde l'appel jusqu'à un silence de "attenteMs" millisecondes. */
export function debounce(fn, attenteMs = 800) {
  let minuteur = null;
  return (...args) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => fn(...args), attenteMs);
  };
}

/** Déclenche le téléchargement d'un Blob côté navigateur. */
export function telecharger(blob, nomFichier) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nomFichier });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Identifiant court et lisible pour une nouvelle entité (entreprise, devis...). */
export function nouvelId(prefixe) {
  return prefixe + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/** Slug minimal : lettres/chiffres, pour composer des noms de fichiers. */
export function slug(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 40) || "SANS-NOM";
}
