BEGIN;

-- ============================================================
-- 1. FONCTION : employé actuellement connecté
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e.id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
    LIMIT 1;
$$;


-- ============================================================
-- 2. FONCTION : employé courant actif
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = public.current_employee_id()
          AND e.is_active = true
    );
$$;


-- ============================================================
-- 3. FONCTION : structure de l'employé courant
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_structure_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e.structure_id
    FROM public.employees e
    WHERE e.id = public.current_employee_id()
    LIMIT 1;
$$;


-- ============================================================
-- 4. FONCTION : vérifier ADMIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employee_roles er
        JOIN public.employees e
            ON e.id = er.employee_id
        WHERE er.employee_id = public.current_employee_id()
          AND er.role = 'admin'::employee_role
          AND e.is_active = true
    );
$$;


-- ============================================================
-- 5. FONCTION : vérifier MANAGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employee_roles er
        JOIN public.employees e
            ON e.id = er.employee_id
        WHERE er.employee_id = public.current_employee_id()
          AND er.role = 'manager'::employee_role
          AND e.is_active = true
    );
$$;


-- ============================================================
-- 6. FONCTION : rôle de l'employé courant
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS employee_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT er.role
    FROM public.employee_roles er
    WHERE er.employee_id = public.current_employee_id()
    ORDER BY er.created_at DESC
    LIMIT 1;
$$;


-- ============================================================
-- 7. FONCTION : responsable d'un site
-- ============================================================
--
-- IMPORTANT :
-- On utilise employee_sites comme source de vérité.
--
-- On ne regarde PAS employees.site_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_site_responsible(
    p_site_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p_site_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.employee_sites es
            WHERE es.employee_id = public.current_employee_id()
              AND es.site_id = p_site_id
              AND es.is_responsible = true
              AND es.is_active = true
        );
$$;


-- ============================================================
-- 8. FONCTION : responsable du site d'un employé
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_responsible_for_employee(
    p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employee_sites es
        WHERE es.employee_id = p_employee_id
          AND es.is_active = true
          AND public.is_site_responsible(es.site_id)
    );
$$;


-- ============================================================
-- 9. FONCTION : employé appartenant à la structure courante
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_belongs_to_current_structure(
    p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = p_employee_id
          AND e.structure_id = public.current_structure_id()
          AND e.is_active = true
    );
$$;


-- ============================================================
-- 10. SÉCURITÉ DES FONCTIONS
-- ============================================================

REVOKE ALL
ON FUNCTION public.current_employee_id()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.current_employee_is_active()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.current_structure_id()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.is_admin()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.is_manager()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.current_employee_role()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.is_site_responsible(uuid)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.is_responsible_for_employee(uuid)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.employee_belongs_to_current_structure(uuid)
FROM PUBLIC;


GRANT EXECUTE
ON FUNCTION public.current_employee_id()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.current_employee_is_active()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.current_structure_id()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.is_admin()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.is_manager()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.current_employee_role()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.is_site_responsible(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.is_responsible_for_employee(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.employee_belongs_to_current_structure(uuid)
TO authenticated;


-- ============================================================
-- 11. RLS EMPLOYEES
-- ============================================================

ALTER TABLE public.employees
ENABLE ROW LEVEL SECURITY;


-- Nettoyage des anciennes policies
DROP POLICY IF EXISTS employees_select
ON public.employees;

DROP POLICY IF EXISTS employees_insert_admin
ON public.employees;

DROP POLICY IF EXISTS employees_update_manager
ON public.employees;

DROP POLICY IF EXISTS employees_update_own
ON public.employees;

DROP POLICY IF EXISTS employees_update
ON public.employees;


-- ============================================================
-- 12. SELECT EMPLOYEES
-- ============================================================
--
-- ADMIN
--    -> tous les employés
--
-- EMPLOYÉ
--    -> son propre profil
--
-- MANAGER
--    -> employés de sa structure
--
-- RESPONSABLE SITE
--    -> employés affectés à son site
-- ============================================================

CREATE POLICY employees_select
ON public.employees
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND
    (
        -- ADMIN
        public.is_admin()

        OR

        -- SON PROPRE PROFIL
        employees.id = public.current_employee_id()

        OR

        -- MANAGER
        (
            public.is_manager()
            AND
            employees.structure_id = public.current_structure_id()
        )

        OR

        -- RESPONSABLE DE SITE
        EXISTS (
            SELECT 1
            FROM public.employee_sites es
            WHERE es.employee_id = employees.id
              AND es.is_active = true
              AND public.is_site_responsible(es.site_id)
        )
    )
);


-- ============================================================
-- 13. INSERT EMPLOYEES
-- ============================================================

CREATE POLICY employees_insert_admin
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
);


-- ============================================================
-- 14. UPDATE SON PROPRE PROFIL
-- ============================================================

CREATE POLICY employees_update_own
ON public.employees
FOR UPDATE
TO authenticated
USING (
    public.current_employee_is_active()
    AND employees.id = public.current_employee_id()
)
WITH CHECK (
    employees.id = public.current_employee_id()
);


-- ============================================================
-- 15. UPDATE PAR ADMIN / MANAGER
-- ============================================================

CREATE POLICY employees_update_manager
ON public.employees
FOR UPDATE
TO authenticated
USING (
    public.current_employee_is_active()
    AND
    (
        public.is_admin()

        OR

        (
            public.is_manager()
            AND employees.structure_id = public.current_structure_id()
        )
    )
)
WITH CHECK (
    public.is_admin()

    OR

    (
        public.is_manager()
        AND employees.structure_id = public.current_structure_id()
    )
);


-- ============================================================
-- 16. RLS EMPLOYEE_SITES
-- ============================================================

ALTER TABLE public.employee_sites
ENABLE ROW LEVEL SECURITY;


-- Nettoyage
DROP POLICY IF EXISTS employee_sites_select
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_insert_manager
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_update_manager
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_delete_manager
ON public.employee_sites;


-- ============================================================
-- 17. SELECT EMPLOYEE_SITES
-- ============================================================
--
-- ADMIN
--    -> toutes les affectations
--
-- EMPLOYÉ
--    -> ses propres affectations
--
-- MANAGER
--    -> affectations des employés de sa structure
--
-- RESPONSABLE SITE
--    -> affectations de son site
-- ============================================================

CREATE POLICY employee_sites_select
ON public.employee_sites
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND
    (
        -- ADMIN
        public.is_admin()

        OR

        -- SA PROPRE AFFECTATION
        employee_sites.employee_id = public.current_employee_id()

        OR

        -- MANAGER
        (
            public.is_manager()
            AND
            public.employee_belongs_to_current_structure(
                employee_sites.employee_id
            )
        )

        OR

        -- RESPONSABLE DU SITE
        public.is_site_responsible(
            employee_sites.site_id
        )
    )
);


-- ============================================================
-- 18. INSERT EMPLOYEE_SITES
-- ============================================================

CREATE POLICY employee_sites_insert_manager
ON public.employee_sites
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()

    OR

    (
        public.is_manager()
        AND
        public.employee_belongs_to_current_structure(
            employee_sites.employee_id
        )
    )
);


-- ============================================================
-- 19. UPDATE EMPLOYEE_SITES
-- ============================================================

CREATE POLICY employee_sites_update_manager
ON public.employee_sites
FOR UPDATE
TO authenticated
USING (
    public.is_admin()

    OR

    (
        public.is_manager()
        AND
        public.employee_belongs_to_current_structure(
            employee_sites.employee_id
        )
    )
)
WITH CHECK (
    public.is_admin()

    OR

    (
        public.is_manager()
        AND
        public.employee_belongs_to_current_structure(
            employee_sites.employee_id
        )
    )
);


-- ============================================================
-- 20. DELETE EMPLOYEE_SITES
-- ============================================================

CREATE POLICY employee_sites_delete_manager
ON public.employee_sites
FOR DELETE
TO authenticated
USING (
    public.is_admin()

    OR

    (
        public.is_manager()
        AND
        public.employee_belongs_to_current_structure(
            employee_sites.employee_id
        )
    )
);


-- ============================================================
-- 21. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employee_roles_employee
ON public.employee_roles(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_roles_role
ON public.employee_roles(role);

CREATE INDEX IF NOT EXISTS idx_employee_sites_employee_active
ON public.employee_sites(employee_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employee_sites_site_active
ON public.employee_sites(site_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employee_sites_responsible
ON public.employee_sites(
    employee_id,
    site_id,
    is_responsible,
    is_active
);

CREATE INDEX IF NOT EXISTS idx_employees_auth_user
ON public.employees(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_employees_structure
ON public.employees(structure_id);

CREATE INDEX IF NOT EXISTS idx_employees_active
ON public.employees(is_active);


COMMIT;