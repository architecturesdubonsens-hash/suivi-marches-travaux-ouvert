// js/sauvegarde.js — sauvegarde et restauration de TOUS les dossiers, en une action.
//
// POURQUOI DANS L'APPLICATION, ET PAS DANS UN SCRIPT.
// La base vit dans un projet qui n'appartient pas à l'organisation atteinte par les
// outils d'administration. Aucun script serveur ne peut donc l'atteindre sans qu'on lui
// confie une clé de service — c'est-à-dire une clé qui contourne les politiques d'accès
// et qui, posée quelque part, devient le vrai problème de sécurité. La sauvegarde est
// donc faite PAR l'utilisateur, DEPUIS l'application, avec sa propre session : aucun
// secret nouveau, aucune permission nouvelle, et ce qu'il sauvegarde est exactement ce
// qu'il a le droit de lire.
//
// POURQUOI LE FORMAT EST DÉJÀ BON. La colonne `donnees` contient le dossier au format
// exporterJSON de l'application. Une sauvegarde n'a donc rien à convertir : elle
// rassemble les lignes telles quelles, et une restauration les repose telles quelles.
// C'est ce qui rend le chemin inverse court, donc crédible.
//
// CE MODULE NE TOUCHE NI AU RÉSEAU NI AU DOM. Il prend des lignes, rend un objet ; il
// prend un objet, rend un verdict. C'est ce qui permet de l'éprouver entièrement en
// Node, sur des données fabriquées, sans approcher la base réelle
// (tests/sauvegarde.mjs).

export const FORMAT_SAUVEGARDE = 'suivi-marches-travaux/sauvegarde';
export const VERSION_SAUVEGARDE = 1;

/* ------------------------------------------------------------------ */
/* Empreinte                                                           */
/* ------------------------------------------------------------------ */

/**
 * Sérialisation CANONIQUE : clés d'objet triées, à toute profondeur.
 *
 * Indispensable à l'empreinte. JSON.stringify conserve l'ordre d'insertion des clés,
 * qui n'est pas garanti identique entre une lecture de la base et une relecture du
 * fichier. Sans tri, l'empreinte varierait sans qu'aucune donnée n'ait changé — et un
 * contrôle qui crie au loup sans raison finit par être ignoré, ce qui est pire que pas
 * de contrôle.
 */
export function canonique(valeur) {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur) ?? 'null';
  if (Array.isArray(valeur)) return '[' + valeur.map(canonique).join(',') + ']';
  const cles = Object.keys(valeur).filter((c) => valeur[c] !== undefined).sort();
  return '{' + cles.map((c) => JSON.stringify(c) + ':' + canonique(valeur[c])).join(',') + '}';
}

/**
 * Empreinte du contenu. FNV-1a 32 bits sur la forme canonique, rendue en hexadécimal.
 *
 * CE QU'ELLE EST, ET CE QU'ELLE N'EST PAS. C'est un contrôle d'INTÉGRITÉ : elle
 * détecte un fichier tronqué, une écriture interrompue, une conversion de fin de ligne
 * appliquée par erreur, un octet perdu en synchronisation. Ce n'est PAS une signature :
 * elle n'empêche pas une modification volontaire, puisque quiconque modifie le contenu
 * peut recalculer l'empreinte. On ne lui fait donc pas dire plus qu'elle ne peut.
 *
 * Choix de FNV-1a plutôt que SHA-256 : l'empreinte doit se calculer de façon
 * SYNCHRONE, dans le navigateur comme en Node, sans dépendance. crypto.subtle est
 * asynchrone et absent en contexte non sécurisé ; node:crypto n'existe pas dans un
 * navigateur. Pour détecter une corruption, FNV-1a suffit.
 */
export function empreinte(valeur) {
  const texte = typeof valeur === 'string' ? valeur : canonique(valeur);
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    // Les caractères hors ASCII portent de l'information sur leur octet haut : sans
    // cette seconde passe, « é » et « e » auraient la même empreinte.
    const haut = texte.charCodeAt(i) >> 8;
    if (haut) { h ^= haut; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/**
 * Ce sur quoi porte l'empreinte : l'identifiant et le CONTENU, rien d'autre.
 *
 * DÉFAUT TROUVÉ PAR LE TEST D'ALLER-RETOUR, et c'est exactement ce qu'on lui demandait.
 * L'empreinte portait d'abord sur la ligne entière, `majLe` et `version` comprises. Or
 * une restauration met légitimement ces deux champs à jour — elle écrit maintenant, et
 * la version avance pour que les autres postes voient le passage. L'empreinte changeait
 * donc après une restauration PARFAITE, et le contrôle aurait annoncé une corruption là
 * où il n'y avait rien. Un contrôle qui crie au loup sans raison est pire que pas de
 * contrôle : on apprend à l'ignorer, et il se tait le jour où il avait raison.
 *
 * `majLe` et `version` restent dans le fichier — ils servent à décider ce qu'une
 * restauration écraserait — mais ils ne sont pas du contenu, donc pas de l'empreinte.
 */
function contenuEmpreignable(dossiers) {
  return dossiers.map((d) => ({ id: d.id, reference: d.reference ?? null, donnees: d.donnees }));
}

/** Ne retient d'une ligne de base que ce qui sert à la reposer. */
function ligneNormalisee(l) {
  return {
    id: l.id,
    reference: l.reference ?? null,
    intitule: l.intitule ?? null,
    version: typeof l.version === 'number' ? l.version : 1,
    majLe: l.maj_le ?? l.majLe ?? null,
    donnees: l.donnees,
  };
}

/**
 * Objet de sauvegarde, prêt à être écrit dans un fichier.
 * @param {Array<object>} lignes lignes brutes de la base (select=*)
 * @param {{projet?: string, creeLe?: string, creePar?: string}} [contexte]
 */
export function construireSauvegarde(lignes, contexte = {}) {
  if (!Array.isArray(lignes)) throw new TypeError('construireSauvegarde : tableau de lignes attendu');
  const dossiers = lignes
    .map(ligneNormalisee)
    // Ordre stable par identifiant : deux sauvegardes du même contenu doivent porter la
    // même empreinte, quel que soit l'ordre dans lequel la base a répondu.
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const sansId = dossiers.filter((d) => !d.id);
  if (sansId.length) throw new Error('construireSauvegarde : ' + sansId.length + ' ligne(s) sans identifiant');
  return {
    format: FORMAT_SAUVEGARDE,
    version: VERSION_SAUVEGARDE,
    creeLe: contexte.creeLe || new Date().toISOString(),
    creePar: contexte.creePar || null,
    projet: contexte.projet || null,
    nbDossiers: dossiers.length,
    // Ni la date de création, ni les métadonnées de ligne : voir contenuEmpreignable.
    empreinte: empreinte(contenuEmpreignable(dossiers)),
    dossiers,
  };
}

/** Nom de fichier daté, triable, sans caractère problématique. */
export function nomFichierSauvegarde(creeLe = new Date()) {
  const d = creeLe instanceof Date ? creeLe : new Date(creeLe);
  const p = (n) => String(n).padStart(2, '0');
  return 'sauvegarde-marches-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
    + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
}

/* ------------------------------------------------------------------ */
/* Relecture et contrôle                                               */
/* ------------------------------------------------------------------ */

/**
 * Relit et CONTRÔLE une sauvegarde. Rend toujours un verdict, ne lève jamais : un
 * fichier illisible est un résultat, pas un accident de programme.
 * @returns {{valide: boolean, motifs: string[], sauvegarde: object|null}}
 */
export function relireSauvegarde(texte) {
  const motifs = [];
  let obj = null;
  try {
    obj = typeof texte === 'string' ? JSON.parse(texte) : texte;
  } catch (e) {
    return { valide: false, motifs: ['fichier illisible (JSON invalide) : ' + (e && e.message ? e.message : e)], sauvegarde: null };
  }
  if (!obj || typeof obj !== 'object') return { valide: false, motifs: ['contenu vide'], sauvegarde: null };
  if (obj.format !== FORMAT_SAUVEGARDE) {
    motifs.push("ce fichier n'est pas une sauvegarde de cette application"
      + (obj.format ? ' (format « ' + obj.format + ' »)' : ''));
  }
  if (obj.version !== VERSION_SAUVEGARDE) {
    motifs.push('version de sauvegarde ' + obj.version + ', attendue ' + VERSION_SAUVEGARDE);
  }
  if (!Array.isArray(obj.dossiers)) {
    motifs.push('aucune liste de dossiers');
    return { valide: false, motifs, sauvegarde: null };
  }
  if (typeof obj.nbDossiers === 'number' && obj.nbDossiers !== obj.dossiers.length) {
    motifs.push('le fichier annonce ' + obj.nbDossiers + ' dossier(s) et en contient '
      + obj.dossiers.length + ' : fichier probablement tronqué');
  }
  const recalculee = empreinte(contenuEmpreignable(obj.dossiers));
  if (obj.empreinte && obj.empreinte !== recalculee) {
    motifs.push('empreinte du contenu différente de celle enregistrée (' + obj.empreinte
      + ' attendue, ' + recalculee + ' recalculée) : le fichier a été modifié ou abîmé');
  }
  const sansDonnees = obj.dossiers.filter((d) => !d || !d.donnees || typeof d.donnees !== 'object');
  if (sansDonnees.length) motifs.push(sansDonnees.length + ' dossier(s) sans contenu exploitable');
  return { valide: motifs.length === 0, motifs, sauvegarde: obj };
}

/**
 * Compare ce qui a été relu à ce qui avait été écrit. C'est CE contrôle qui fait la
 * différence entre une sauvegarde et un fichier : une sauvegarde jamais relue n'est pas
 * une sauvegarde, et le seul moyen de le savoir est de la relire et de comparer.
 * @returns {{identique: boolean, nbAvant: number, nbApres: number, empreinteAvant: string,
 *            empreinteApres: string, manquants: string[], enTrop: string[], differents: string[]}}
 */
export function comparerSauvegardes(avant, apres) {
  const dAvant = (avant && avant.dossiers) || [];
  const dApres = (apres && apres.dossiers) || [];
  const parId = (liste) => new Map(liste.map((d) => [String(d.id), d]));
  const mAvant = parId(dAvant);
  const mApres = parId(dApres);
  const manquants = [...mAvant.keys()].filter((id) => !mApres.has(id));
  const enTrop = [...mApres.keys()].filter((id) => !mAvant.has(id));
  const differents = [...mAvant.keys()]
    .filter((id) => mApres.has(id))
    .filter((id) => empreinte(mAvant.get(id).donnees) !== empreinte(mApres.get(id).donnees));
  const eAvant = empreinte(contenuEmpreignable(dAvant));
  const eApres = empreinte(contenuEmpreignable(dApres));
  return {
    identique: dAvant.length === dApres.length && eAvant === eApres
      && manquants.length === 0 && enTrop.length === 0 && differents.length === 0,
    nbAvant: dAvant.length,
    nbApres: dApres.length,
    empreinteAvant: eAvant,
    empreinteApres: eApres,
    manquants,
    enTrop,
    differents,
  };
}

/* ------------------------------------------------------------------ */
/* Plan de restauration                                                */
/* ------------------------------------------------------------------ */

/**
 * Décide, dossier par dossier, ce qu'une restauration ferait — SANS rien écrire.
 *
 * POURQUOI UN PLAN AVANT L'ACTE. Une restauration est l'opération la plus dangereuse de
 * l'application : elle peut écraser du travail plus récent que la sauvegarde. On montre
 * donc d'abord ce qui serait fait, et on laisse trancher.
 *
 * Le mode par défaut, « completer », ne touche à AUCUN dossier existant : il ne repose
 * que les absents. C'est le cas réel le plus fréquent — une suppression accidentelle,
 * une base recréée — et il ne peut rien détruire. Le mode « remplacer » écrase les
 * existants, et n'existe que parce qu'un dossier peut être abîmé sans être absent.
 *
 * @param {object} sauvegarde relue et validée
 * @param {Array<{id,version,majLe}>} presents état actuel de la base (lister())
 * @param {{mode?: 'completer'|'remplacer'}} [options]
 */
export function planifierRestauration(sauvegarde, presents = [], { mode = 'completer' } = {}) {
  if (mode !== 'completer' && mode !== 'remplacer') {
    throw new TypeError("planifierRestauration : mode « completer » ou « remplacer » attendu");
  }
  const existants = new Map((presents || []).map((p) => [String(p.id), p]));
  const aCreer = [];
  const aRemplacer = [];
  const ignores = [];
  for (const d of (sauvegarde && sauvegarde.dossiers) || []) {
    const present = existants.get(String(d.id));
    if (!present) { aCreer.push(d); continue; }
    if (mode === 'remplacer') {
      // Signalé quand la base est PLUS RÉCENTE que la sauvegarde : c'est le cas où
      // l'on perdrait du travail, et il doit être dit avant, pas découvert après.
      const baseePlusRecente = Boolean(present.majLe && d.majLe && new Date(present.majLe) > new Date(d.majLe));
      aRemplacer.push({ ...d, baseePlusRecente, versionPresente: present.version });
    } else {
      ignores.push({ ...d, versionPresente: present.version });
    }
  }
  const pertesPossibles = aRemplacer.filter((d) => d.baseePlusRecente);
  return {
    mode,
    aCreer,
    aRemplacer,
    ignores,
    pertesPossibles,
    resume: mode === 'completer'
      ? aCreer.length + ' dossier(s) à reposer, ' + ignores.length + ' déjà présent(s) et laissé(s) intact(s)'
      : aCreer.length + ' à reposer, ' + aRemplacer.length + ' à écraser'
        + (pertesPossibles.length ? ', dont ' + pertesPossibles.length + ' plus récent(s) dans la base que dans la sauvegarde' : ''),
  };
}

/* ------------------------------------------------------------------ */
/* Ancienneté                                                          */
/* ------------------------------------------------------------------ */

export const SEUIL_ATTENTION_JOURS = 7;
export const SEUIL_ALERTE_JOURS = 30;

/**
 * Juge l'ancienneté de la dernière sauvegarde.
 *
 * LA COMPARAISON QUI COMPTE N'EST PAS L'ÂGE ABSOLU, c'est l'écart avec la dernière
 * écriture dans la base. Une sauvegarde de trois mois sur une base qui n'a pas bougé
 * depuis quatre mois ne manque rien ; une sauvegarde de deux jours sur une base
 * modifiée ce matin, si. On regarde donc les deux, et la plus mauvaise des deux
 * conclusions l'emporte.
 *
 * @param {string|null} derniereSauvegardeIso
 * @param {string|null} derniereEcritureBaseIso le maj_le le plus récent
 * @param {Date} [maintenant]
 * @returns {{gravite:'neutre'|'attention'|'alerte', jours:number|null, enRetard:boolean, texte:string}}
 */
export function etatAnciennete(derniereSauvegardeIso, derniereEcritureBaseIso, maintenant = new Date()) {
  if (!derniereSauvegardeIso) {
    return {
      gravite: 'alerte', jours: null, enRetard: Boolean(derniereEcritureBaseIso),
      texte: "Aucune sauvegarde n'a jamais été faite depuis ce poste. Si la base était perdue, "
        + 'les dossiers le seraient avec elle.',
    };
  }
  const t = new Date(derniereSauvegardeIso);
  if (Number.isNaN(t.getTime())) {
    return { gravite: 'attention', jours: null, enRetard: false,
      texte: "La date de la dernière sauvegarde est illisible : refaites-en une." };
  }
  const jours = Math.floor((maintenant - t) / 86400000);
  const enRetard = Boolean(derniereEcritureBaseIso && new Date(derniereEcritureBaseIso) > t);
  let gravite = 'neutre';
  if (jours >= SEUIL_ALERTE_JOURS) gravite = 'alerte';
  else if (jours >= SEUIL_ATTENTION_JOURS) gravite = 'attention';
  if (enRetard && gravite === 'neutre') gravite = 'attention';

  const age = jours === 0 ? "aujourd'hui" : jours === 1 ? 'hier' : 'il y a ' + jours + ' jours';
  let texte = 'Dernière sauvegarde depuis ce poste : ' + age + '.';
  if (enRetard) texte += ' Des dossiers ont été modifiés dans la base depuis : cette sauvegarde ne les contient pas.';
  else if (gravite === 'neutre') texte += ' À jour.';
  if (gravite === 'alerte' && jours >= SEUIL_ALERTE_JOURS) texte += ' Plus d\'un mois : refaites-en une.';
  return { gravite, jours, enRetard, texte };
}
