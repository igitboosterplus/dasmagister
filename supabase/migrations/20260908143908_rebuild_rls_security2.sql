-- ============================================================
-- FIX SITE WORK SCHEDULES RLS
-- ============================================================
-- Objectif :
--   1. Ajouter une fonction sécurisée permettant de vérifier
--      qu'un utilisateur peut gérer les horaires d'un site.
--   2. Corriger les policies RLS de site_work_schedules.
--   3. Permettre à un manager de sa structure de créer,
--      consulter, modifier et supprimer les horaires des sites
--      de sa structure.
--   4. Éviter toute récursion sur employees.
-- ============================================================


-- ============================================================
-- 1. FONCTION : is_manager_of_site
-- ============================================================
--
-- Cette fonction ne consulte PAS directement employees.
--
-- Elle s'appuie sur les fonctions métier déjà présentes dans
-- ton système :
--
--   is_admin()
--   is_manager()
--   current_structure_id()
--
-- Elle vérifie simplement que le site appartient à la structure
-- de l'utilisateur actuellement connecté.
--
-- SECURITY DEFINER :
-- permet à la fonction de réaliser la vérification sans être
-- bloquée par les RLS des tables consultées.
--
-- ============================================================

create or replace function public.is_manager_of_site(
    p_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        public.is_manager()
        and exists (
            select 1
            from public.sites s
            where s.id = p_site_id
              and s.structure_id = public.current_structure_id()
        );
$$;


-- ============================================================
-- 2. FONCTION : can_manage_site_schedule
-- ============================================================
--
-- Fonction générale permettant à un utilisateur autorisé
-- d'administrer les horaires d'un site.
--
-- ADMIN :
--   accès à tous les sites.
--
-- MANAGER :
--   accès uniquement aux sites de sa structure.
--
-- Cette fonction est volontairement séparée de
-- is_manager_of_site afin de rendre les policies plus lisibles
-- et plus faciles à faire évoluer.
--
-- ============================================================

create or replace function public.can_manage_site_schedule(
    p_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        public.is_admin()
        or public.is_manager_of_site(p_site_id);
$$;


-- ============================================================
-- 3. PROTECTION DES FONCTIONS
-- ============================================================
--
-- On retire les droits d'exécution publics afin qu'un utilisateur
-- non authentifié ne puisse pas appeler directement les fonctions.
--
-- authenticated reçoit le droit d'exécution.
--
-- ============================================================

revoke all
on function public.is_manager_of_site(uuid)
from public;

grant execute
on function public.is_manager_of_site(uuid)
to authenticated;


revoke all
on function public.can_manage_site_schedule(uuid)
from public;

grant execute
on function public.can_manage_site_schedule(uuid)
to authenticated;


-- ============================================================
-- 4. RLS DE site_work_schedules
-- ============================================================

alter table public.site_work_schedules
enable row level security;


-- ============================================================
-- 5. SUPPRESSION DES ANCIENNES POLICIES
-- ============================================================
--
-- On supprime les éventuelles anciennes policies portant sur
-- site_work_schedules afin d'éviter plusieurs règles
-- contradictoires ou difficiles à maintenir.
--
-- DROP POLICY IF EXISTS ne provoque aucune erreur si la policy
-- n'existe pas.
--
-- ============================================================

drop policy if exists "site_work_schedules_select"
on public.site_work_schedules;

drop policy if exists "site_work_schedules_insert"
on public.site_work_schedules;

drop policy if exists "site_work_schedules_update"
on public.site_work_schedules;

drop policy if exists "site_work_schedules_delete"
on public.site_work_schedules;


drop policy if exists "Managers can view site schedules"
on public.site_work_schedules;

drop policy if exists "Managers can insert site schedules"
on public.site_work_schedules;

drop policy if exists "Managers can update site schedules"
on public.site_work_schedules;

drop policy if exists "Managers can delete site schedules"
on public.site_work_schedules;


drop policy if exists "site_work_schedules_select_manager"
on public.site_work_schedules;

drop policy if exists "site_work_schedules_insert_manager"
on public.site_work_schedules;

drop policy if exists "site_work_schedules_update_manager"
on public.site_work_schedules;

drop policy if exists "site_work_schedules_delete_manager"
on public.site_work_schedules;


-- ============================================================
-- 6. SELECT
-- ============================================================
--
-- Un manager peut consulter les horaires des sites de sa
-- structure.
--
-- Un administrateur peut consulter tous les horaires.
--
-- ============================================================

create policy "site_work_schedules_select"
on public.site_work_schedules
for select
to authenticated
using (
    public.can_manage_site_schedule(site_id)
);


-- ============================================================
-- 7. INSERT
-- ============================================================
--
-- C'est cette policy qui corrige ton erreur actuelle :
--
--   403
--   new row violates row-level security policy for table
--   "site_work_schedules"
--
-- Lors du upsert, Supabase peut effectuer un INSERT si la ligne
-- site_id + day_of_week n'existe pas encore.
--
-- Le manager doit donc être autorisé à insérer les horaires
-- d'un site de sa structure.
--
-- ============================================================

create policy "site_work_schedules_insert"
on public.site_work_schedules
for insert
to authenticated
with check (
    public.can_manage_site_schedule(site_id)
);


-- ============================================================
-- 8. UPDATE
-- ============================================================
--
-- Le manager doit :
--
--   USING  -> avoir le droit de modifier la ligne existante
--   WITH CHECK -> ne pas pouvoir déplacer la ligne vers un site
--                appartenant à une autre structure.
--
-- ============================================================

create policy "site_work_schedules_update"
on public.site_work_schedules
for update
to authenticated
using (
    public.can_manage_site_schedule(site_id)
)
with check (
    public.can_manage_site_schedule(site_id)
);


-- ============================================================
-- 9. DELETE
-- ============================================================

create policy "site_work_schedules_delete"
on public.site_work_schedules
for delete
to authenticated
using (
    public.can_manage_site_schedule(site_id)
);


-- ============================================================
-- 10. CONTRAINTE D'UNICITÉ
-- ============================================================
--
-- Le frontend utilise :
--
--   upsert(..., {
--      onConflict: 'site_id,day_of_week'
--   })
--
-- PostgreSQL doit donc posséder une contrainte UNIQUE
-- correspondante.
--
-- ============================================================

create unique index if not exists
site_work_schedules_site_day_unique
on public.site_work_schedules (
    site_id,
    day_of_week
);


-- ============================================================
-- 11. CONTRAINTES DE COHÉRENCE
-- ============================================================
--
-- Ces contraintes empêchent la base d'accepter des horaires
-- incohérents.
--
-- IMPORTANT :
-- Elles ne doivent pas empêcher un jour non travaillé d'avoir
-- des horaires NULL.
--
-- ============================================================

alter table public.site_work_schedules
drop constraint if exists site_work_schedules_work_hours_check;


alter table public.site_work_schedules
add constraint site_work_schedules_work_hours_check
check (
    not is_working_day
    or (
        work_start is not null
        and work_end is not null
        and work_end > work_start
    )
);


-- ============================================================
-- 12. CONTRAINTE SUR LES PAUSES
-- ============================================================

alter table public.site_work_schedules
drop constraint if exists site_work_schedules_break_hours_check;


alter table public.site_work_schedules
add constraint site_work_schedules_break_hours_check
check (
    break_start is null
    or break_end is null
    or break_end > break_start
);


-- ============================================================
-- 13. CONTRAINTE : PAUSE DANS LES HORAIRES
-- ============================================================
--
-- Si une pause existe, elle doit être comprise dans la période
-- de travail.
--
-- ============================================================

alter table public.site_work_schedules
drop constraint if exists site_work_schedules_break_inside_work_check;


alter table public.site_work_schedules
add constraint site_work_schedules_break_inside_work_check
check (
    break_start is null
    or break_end is null
    or (
        work_start is not null
        and work_end is not null
        and break_start >= work_start
        and break_end <= work_end
    )
);


-- ============================================================
-- 14. CONTRAINTE SUR LA PÉRIODE DE GRÂCE
-- ============================================================

alter table public.site_work_schedules
drop constraint if exists site_work_schedules_grace_period_check;


alter table public.site_work_schedules
add constraint site_work_schedules_grace_period_check
check (
    grace_period_minutes >= 0
);


-- ============================================================
-- FIN DE MIGRATION
-- ============================================================