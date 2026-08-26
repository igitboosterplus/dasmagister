
-- ============================================================
-- SITES — IS_ACTIVE + RLS POLICIES
-- ============================================================
--
-- OBJECTIFS :
--   1. Ajout de la colonne is_active sur la table sites
--   2. Désactivation logique (pas de suppression physique)
--   3. Policies RLS pour admin, manager, employee
--
-- IMPORTANT :
--   Cette migration NE SUPPRIME aucune donnée existante.
-- ============================================================


-- ============================================================
-- 1. COLONNE is_active
-- ============================================================

ALTER TABLE public.sites
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_sites_is_active
ON public.sites(is_active);


-- ============================================================
-- 2. POLICIES RLS — SITES
--
-- Nettoyage des éventuelles anciennes policies.
-- ============================================================

DROP POLICY IF EXISTS "admin_can_view_all_sites"        ON public.sites;
DROP POLICY IF EXISTS "admin_can_insert_sites"          ON public.sites;
DROP POLICY IF EXISTS "admin_can_update_sites"          ON public.sites;
DROP POLICY IF EXISTS "manager_can_view_structure_sites" ON public.sites;
DROP POLICY IF EXISTS "manager_can_insert_structure_sites" ON public.sites;
DROP POLICY IF EXISTS "manager_can_update_structure_sites" ON public.sites;
DROP POLICY IF EXISTS "employee_can_view_active_site"   ON public.sites;
DROP POLICY IF EXISTS "authenticated_can_view_all_sites" ON public.sites;


-- ------------------------------------------------------------
-- ADMIN : accès complet
-- ------------------------------------------------------------

CREATE POLICY "admin_can_view_all_sites"
ON public.sites
FOR SELECT
TO authenticated
USING (
    public.has_role('admin')
);

CREATE POLICY "admin_can_insert_sites"
ON public.sites
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('admin')
);

CREATE POLICY "admin_can_update_sites"
ON public.sites
FOR UPDATE
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- MANAGER : accès limité à sa structure
--
-- Le manager ne peut jamais changer la structure d'un site.
-- La clause WITH CHECK garantit que structure_id
-- reste celui du manager.
-- ------------------------------------------------------------

CREATE POLICY "manager_can_view_structure_sites"
ON public.sites
FOR SELECT
TO authenticated
USING (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
);

CREATE POLICY "manager_can_insert_structure_sites"
ON public.sites
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
);

CREATE POLICY "manager_can_update_structure_sites"
ON public.sites
FOR UPDATE
TO authenticated
USING (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
)
WITH CHECK (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
);


-- ------------------------------------------------------------
-- EMPLOYEE : lecture des sites actifs de sa structure
-- ------------------------------------------------------------

CREATE POLICY "employee_can_view_active_site"
ON public.sites
FOR SELECT
TO authenticated
USING (
    public.has_role('employee')
    AND is_active = TRUE
    AND structure_id = public.current_structure_id()
);


-- ============================================================
-- FIN DE LA MIGRATION
-- ============================================================
