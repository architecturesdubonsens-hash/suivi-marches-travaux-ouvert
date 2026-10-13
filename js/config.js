// js/config.js — configuration de la base partagée (facultative).
//
// PAR DÉFAUT, RIEN N'EST CONFIGURÉ : l'application fonctionne entièrement dans le navigateur
// (les dossiers restent sur le poste, l'échange entre postes passe par l'export/import JSON).
// C'est volontaire : un dépôt copié ne doit jamais écrire, sans qu'on le sache, dans la base
// de quelqu'un d'autre.
//
// Pour activer le partage entre postes, créez votre PROPRE projet Supabase, exécutez db/schema.sql
// puis db/test-isolation.sql, et renseignez les deux valeurs ci-dessous.
//
// La CLÉ PUBLIQUE est faite pour être publiée : elle voyage dans le JavaScript servi au navigateur.
// Elle ne protège rien par elle-même, et c'est voulu : la sécurité repose sur l'AUTHENTIFICATION et
// sur les politiques d'accès au niveau des lignes (RLS, cf. db/schema.sql), qui isolent chaque
// dossier de son propriétaire et refusent tout accès anonyme. Ne JAMAIS mettre ici une clé de
// service (service_role) : celle-ci contourne les RLS et donnerait à quiconque lit le code l'accès
// complet à tous les dossiers.

export const CONFIG = {
  /** Adresse de votre projet Supabase (https://xxxx.supabase.co). Vide : mode local. */
  urlSupabase: '',

  /** Clé publique de votre projet (format « sb_publishable_… »). Vide : mode local. */
  clePubliqueSupabase: '',
};

/**
 * L'accès partagé est-il configuré ? Tant que non, l'application fonctionne
 * exactement comme avant : le dossier vit dans le navigateur, et l'échange entre
 * postes passe par l'export/import JSON. On ne casse jamais ce qui marche.
 * @returns {boolean}
 */
export function stockagePartageConfigure() {
  return Boolean(CONFIG.urlSupabase && CONFIG.clePubliqueSupabase);
}
