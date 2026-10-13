-- ==========================================================================
-- Banc d'isolation des dossiers — à exécuter dans l'éditeur SQL du projet.
--
-- CE QU'IL PROUVE : un utilisateur ne lit, ne modifie, ne supprime aucun dossier
-- d'un autre, ne peut ni en créer au nom d'un autre ni s'en attribuer un, et un
-- visiteur anonyme n'accède à rien.
--
-- COMMENT : deux utilisateurs fictifs sont fabriqués le temps d'une transaction,
-- puis TOUT est annulé (rollback) : aucun compte, aucun dossier ne subsiste. Le banc
-- joue les politiques réelles de la base en prenant le rôle « authenticated » avec
-- l'identité de l'un puis de l'autre — c'est ce que fait la base quand l'application
-- envoie une requête avec un jeton.
--
-- RÉSULTAT ATTENDU : 10 lignes, toutes avec ok = true.
--
-- UN BANC SE PROUVE ROUGE AVANT D'ÊTRE VERT : pour vérifier que ce banc détecte bien
-- une fuite, remplacez temporairement les quatre politiques par « using (true) » et
-- rejouez-le : des lignes passent à ok = false. Rétablissez ensuite db/schema.sql.
-- ==========================================================================

begin;

-- Deux utilisateurs fictifs, valables jusqu'au rollback.
insert into auth.users (id, aud, role)
values ('00000000-0000-0000-0000-00000000a001', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000b002', 'authenticated', 'authenticated');

create temp table resultats (n int, controle text, attendu text, obtenu text, ok boolean);

do $$
declare
  ua constant uuid := '00000000-0000-0000-0000-00000000a001';
  ub constant uuid := '00000000-0000-0000-0000-00000000b002';
  -- Une cible PAR attaque : si une attaque réussit (fuite), elle ne doit pas masquer les
  -- suivantes en détruisant leur cible. Chaque contrôle se juge seul.
  dossier_a uuid;                           -- lecture, modification, cession, intégrité
  dossier_s uuid;                           -- suppression
  dossier_p uuid;                           -- appropriation
  n int;
  etat text;
  res text[] := '{}';                       -- lignes « controle|attendu|obtenu »

begin
  -- ---- A crée son dossier et le relit ------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.dossiers (reference, donnees) values ('TEST-A', '{"secret":"A"}') returning id into dossier_a;
  insert into public.dossiers (reference, donnees) values ('TEST-A-SUPPRESSION', '{}') returning id into dossier_s;
  insert into public.dossiers (reference, donnees) values ('TEST-A-APPROPRIATION', '{}') returning id into dossier_p;
  select count(*) into n from public.dossiers where id = dossier_a;
  res := res || format('A lit son propre dossier|1|%s', n);

  -- ---- B n'a aucun accès au dossier de A --------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);

  select count(*) into n from public.dossiers where id = dossier_a;
  res := res || format('B ne lit pas le dossier de A (par id)|0|%s', n);

  select count(*) into n from public.dossiers;
  res := res || format('B ne voit aucun dossier dans la liste|0|%s', n);

  update public.dossiers set donnees = '{"secret":"pirate"}' where id = dossier_a;
  get diagnostics n = row_count;
  res := res || format('B ne modifie pas le dossier de A (lignes touchées)|0|%s', n);

  delete from public.dossiers where id = dossier_s;
  get diagnostics n = row_count;
  res := res || format('B ne supprime pas le dossier de A (lignes touchées)|0|%s', n);

  update public.dossiers set proprietaire = ub where id = dossier_p;
  get diagnostics n = row_count;
  res := res || format('B ne s''attribue pas le dossier de A (lignes touchées)|0|%s', n);

  begin
    insert into public.dossiers (proprietaire, reference, donnees) values (ua, 'FAUX-AU-NOM-DE-A', '{}');
    etat := 'insertion acceptée';
  exception when insufficient_privilege or check_violation then
    etat := 'refusée';
  end;
  res := res || format('B ne crée pas de dossier au nom de A|refusée|%s', etat);

  -- ---- A ne peut pas céder son dossier (la propriété est immuable) -------
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin
    update public.dossiers set proprietaire = ub where id = dossier_a;
    etat := 'cession acceptée';
  exception when insufficient_privilege or check_violation then
    etat := 'refusée';
  end;
  res := res || format('A ne cède pas son dossier à B|refusée|%s', etat);

  -- ---- Un visiteur anonyme n'accède à rien --------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    select count(*) into n from public.dossiers;
    etat := 'lecture acceptée : ' || n || ' ligne(s)';
  exception when insufficient_privilege then
    etat := 'refusée';
  end;
  res := res || format('Un visiteur anonyme ne lit rien|refusée|%s', etat);

  -- ---- Le dossier de A est intact après toutes ces tentatives ------------
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.dossiers where id = dossier_a and donnees = '{"secret":"A"}'::jsonb and proprietaire = ua;
  res := res || format('Le dossier de A est intact (contenu et propriétaire)|1|%s', n);

  reset role;

  -- Consigner les résultats (le rôle de départ peut écrire dans la table temporaire).
  for n in 1 .. array_length(res, 1) loop
    insert into resultats
    select n,
           split_part(res[n], '|', 1), split_part(res[n], '|', 2), split_part(res[n], '|', 3),
           split_part(res[n], '|', 2) = split_part(res[n], '|', 3);
  end loop;
end $$;

select n, controle, attendu, obtenu, ok from resultats order by n;
select count(*) filter (where ok) as controles_verts, count(*) as controles_total,
       bool_and(ok) as tout_est_vert
from resultats;

rollback;
