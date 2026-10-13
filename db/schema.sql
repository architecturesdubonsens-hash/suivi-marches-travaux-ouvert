-- ==========================================================================
-- Dossiers de suivi des marchés de travaux — schéma de la base partagée
--
-- À exécuter une fois, dans l'éditeur SQL du projet Supabase retenu, puis à
-- vérifier avec db/test-isolation.sql (qui doit répondre « tout est vert »).
--
-- Motif : un dossier est souvent ouvert depuis plusieurs postes (bureau, domicile,
-- mobile). Le stockage du navigateur est cloisonné par navigateur et par adresse :
-- trois postes produiraient trois dossiers divergents, sans moyen de savoir lequel
-- fait foi. La base devient donc la source de vérité, et le navigateur n'est plus
-- qu'un cache de travail.
--
-- Le contenu est volontairement stocké en JSON : le format exporté par
-- l'application (exporterJSON) EST le schéma du dossier. Le figer en colonnes serait
-- prématuré — le modèle évolue encore.
--
-- MODÈLE D'ACCÈS : INSCRIPTION OUVERTE, DOSSIERS PRIVÉS.
-- Chacun peut créer un compte ; chaque dossier appartient à la personne qui l'a créé,
-- et à elle seule. Personne d'autre ne peut le lire, le modifier, le supprimer ni se
-- l'attribuer. Cette garantie est portée par la base (politiques RLS ci-dessous), pas
-- par l'application : la clé publique est dans le JavaScript servi au navigateur, donc
-- publique par construction, et elle ne doit RIEN pouvoir faire seule.
-- ==========================================================================

create table if not exists public.dossiers (
  id           uuid primary key default gen_random_uuid(),
  -- Propriétaire du dossier. La valeur par défaut est l'utilisateur connecté : le client
  -- ne l'envoie jamais, et ne peut pas la choisir (voir les politiques d'insertion).
  -- Supprimer un compte supprime ses dossiers : pas d'orphelins.
  proprietaire uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reference    text not null,                      -- référence interne de l'opération
  intitule     text,                               -- libellé lisible dans la liste
  donnees      jsonb not null,                     -- le dossier complet (format exporterJSON)
  version      integer not null default 1,         -- incrémentée à chaque écriture : détection de conflit
  maj_le       timestamptz not null default now(),
  maj_par      uuid default auth.uid(),            -- qui a écrit en dernier
  cree_le      timestamptz not null default now()
);

comment on table public.dossiers is
  'Dossiers de suivi des marchés : donnees contient le dossier complet au format JSON de l''application. Chaque ligne appartient à son créateur (proprietaire).';

alter table public.dossiers enable row level security;

-- Aucun accès anonyme, jamais.
revoke all on public.dossiers from anon;
grant select, insert, update, delete on public.dossiers to authenticated;

-- Une politique par opération, toutes fondées sur le propriétaire. « (select auth.uid()) »
-- plutôt que « auth.uid() » : la fonction est évaluée une fois par requête, pas par ligne.
drop policy if exists "dossiers lecture authentifiee" on public.dossiers;
drop policy if exists "dossiers creation authentifiee" on public.dossiers;
drop policy if exists "dossiers mise a jour authentifiee" on public.dossiers;
drop policy if exists "dossiers suppression authentifiee" on public.dossiers;

drop policy if exists "dossiers lecture proprietaire" on public.dossiers;
create policy "dossiers lecture proprietaire" on public.dossiers
  for select to authenticated
  using (proprietaire = (select auth.uid()));

-- À la création, le propriétaire DOIT être l'utilisateur connecté : on ne crée pas un
-- dossier au nom de quelqu'un d'autre.
drop policy if exists "dossiers creation proprietaire" on public.dossiers;
create policy "dossiers creation proprietaire" on public.dossiers
  for insert to authenticated
  with check (proprietaire = (select auth.uid()));

-- « with check » empêche de céder ou de s'approprier un dossier en changeant sa colonne
-- proprietaire : la propriété est immuable.
drop policy if exists "dossiers mise a jour proprietaire" on public.dossiers;
create policy "dossiers mise a jour proprietaire" on public.dossiers
  for update to authenticated
  using (proprietaire = (select auth.uid()))
  with check (proprietaire = (select auth.uid()));

drop policy if exists "dossiers suppression proprietaire" on public.dossiers;
create policy "dossiers suppression proprietaire" on public.dossiers
  for delete to authenticated
  using (proprietaire = (select auth.uid()));

create index if not exists dossiers_proprietaire_idx on public.dossiers (proprietaire);
create index if not exists dossiers_maj_le_idx on public.dossiers (maj_le desc);

-- --------------------------------------------------------------------------
-- Contrôle après exécution : doit renvoyer 4 politiques, et rls = true.
-- --------------------------------------------------------------------------
-- select relname, relrowsecurity from pg_class where relname = 'dossiers';
-- select policyname, cmd from pg_policies where tablename = 'dossiers' order by cmd;
