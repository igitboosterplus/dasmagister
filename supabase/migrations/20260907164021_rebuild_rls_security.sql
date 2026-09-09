BEGIN;

-- ============================================================
-- REBUILD RLS - VERSION CONSOLIDEE
-- ============================================================
--
-- PRINCIPES
--
-- 1. Aucune policy ne doit interroger directement la table
--    sur laquelle elle est définie pour déterminer les droits.
--
-- 2. Les vérifications croisées passent par des fonctions
--    SECURITY DEFINER.
--
-- 3. Un manager ne gère que sa propre structure.
--
-- 4. Un manager ne peut pas modifier un autre manager.
--
-- 5. Un employé possède un seul rôle.
--
-- 6. Un employé peut être affecté à plusieurs sites.
--
-- 7. Un site possède un responsable.
--
-- 8. L'admin possède les droits globaux.
-- ============================================================


-- ============================================================
-- 1. FONCTIONS DE CONTEXTE
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


CREATE OR REPLACE FUNCTION public.current_structure_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e.structure_id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
      AND e.account_status = 'active'
      AND e.is_active = TRUE
    LIMIT 1;
$$;


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
        WHERE e.auth_user_id = auth.uid()
          AND e.account_status = 'active'
          AND e.is_active = TRUE
    );
$$;


CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS public.employee_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT er.role
    FROM public.employee_roles er
    INNER JOIN public.employees e
        ON e.id = er.employee_id
    WHERE e.auth_user_id = auth.uid()
    LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_employee_role()
        = 'admin'::public.employee_role;
$$;


CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_employee_role()
        = 'manager'::public.employee_role;
$$;


-- ============================================================
-- 2. FONCTIONS DE VERIFICATION
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
    );
$$;


CREATE OR REPLACE FUNCTION public.employee_is_manager(
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
        FROM public.employee_roles er
        WHERE er.employee_id = p_employee_id
          AND er.role = 'manager'::public.employee_role
    );
$$;


CREATE OR REPLACE FUNCTION public.site_belongs_to_current_structure(
    p_site_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.sites s
        WHERE s.id = p_site_id
          AND s.structure_id = public.current_structure_id()
    );
$$;


CREATE OR REPLACE FUNCTION public.is_site_responsible(
    p_site_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.sites s
        WHERE s.id = p_site_id
          AND s.responsible_employee_id =
              public.current_employee_id()
    );
$$;


-- ============================================================
-- 3. PERMISSIONS DES FONCTIONS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.current_employee_id()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_structure_id()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_employee_is_active()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_employee_role()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_manager()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.employee_belongs_to_current_structure(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.employee_is_manager(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.site_belongs_to_current_structure(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.is_site_responsible(uuid)
TO authenticated;


-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 5. EMPLOYEES
-- ============================================================

DROP POLICY IF EXISTS
"Managers can update employee site"
ON public.employees;

DROP POLICY IF EXISTS
"admin_can_insert_employees"
ON public.employees;

DROP POLICY IF EXISTS
"admin_can_view_active_employees"
ON public.employees;

DROP POLICY IF EXISTS
"employee_can_view_own_active_profile"
ON public.employees;

DROP POLICY IF EXISTS
"employees_select_v3"
ON public.employees;

DROP POLICY IF EXISTS
"manager_can_view_active_structure_employees"
ON public.employees;

DROP POLICY IF EXISTS
"update"
ON public.employees;

DROP POLICY IF EXISTS
"employees_select"
ON public.employees;

DROP POLICY IF EXISTS
"employees_insert_admin"
ON public.employees;

DROP POLICY IF EXISTS
"employees_update_manager"
ON public.employees;

DROP POLICY IF EXISTS
"employees_update_own_profile"
ON public.employees;


CREATE POLICY "employees_select"
ON public.employees
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR id = public.current_employee_id()
        OR (
            public.is_manager()
            AND structure_id = public.current_structure_id()
        )
    )
);


CREATE POLICY "employees_insert_admin"
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
);


CREATE POLICY "employees_update_manager"
ON public.employees
FOR UPDATE
TO authenticated
USING (
    public.is_manager()
    AND public.employee_belongs_to_current_structure(id)
    AND id <> public.current_employee_id()
    AND NOT public.employee_is_manager(id)
)
WITH CHECK (
    structure_id = public.current_structure_id()
    AND NOT public.employee_is_manager(id)
);


-- ============================================================
-- 6. EMPLOYEE ROLES
-- ============================================================

DROP POLICY IF EXISTS
"Managers can assign roles to employees"
ON public.employee_roles;

DROP POLICY IF EXISTS
"Managers can update employee roles"
ON public.employee_roles;

DROP POLICY IF EXISTS
"admin_can_insert_roles"
ON public.employee_roles;

DROP POLICY IF EXISTS
"admin_can_view_all_roles"
ON public.employee_roles;

DROP POLICY IF EXISTS
"employee_can_view_own_role"
ON public.employee_roles;

DROP POLICY IF EXISTS
"employee_roles_select_v3"
ON public.employee_roles;

DROP POLICY IF EXISTS
"manager_can_view_structure_roles"
ON public.employee_roles;

DROP POLICY IF EXISTS
"employee_roles_select"
ON public.employee_roles;

DROP POLICY IF EXISTS
"employee_roles_insert"
ON public.employee_roles;

DROP POLICY IF EXISTS
"employee_roles_update"
ON public.employee_roles;


CREATE POLICY "employee_roles_select"
ON public.employee_roles
FOR SELECT
TO authenticated
USING (
    public.is_admin()
    OR employee_id = public.current_employee_id()
    OR (
        public.is_manager()
        AND public.employee_belongs_to_current_structure(employee_id)
    )
);


CREATE POLICY "employee_roles_insert"
ON public.employee_roles
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND role = 'employee'::public.employee_role
        AND public.employee_belongs_to_current_structure(employee_id)
    )
);


CREATE POLICY "employee_roles_update"
ON public.employee_roles
FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR (
        public.is_manager()
        AND employee_id <> public.current_employee_id()
        AND public.employee_belongs_to_current_structure(employee_id)
        AND NOT public.employee_is_manager(employee_id)
    )
)
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND role = 'employee'::public.employee_role
        AND public.employee_belongs_to_current_structure(employee_id)
    )
);


-- ============================================================
-- 7. EMPLOYEE SITES
-- ============================================================

DROP POLICY IF EXISTS
"employee_sites_select_v3"
ON public.employee_sites;

DROP POLICY IF EXISTS
"employee_sites_select"
ON public.employee_sites;

DROP POLICY IF EXISTS
"employee_sites_insert_manager"
ON public.employee_sites;

DROP POLICY IF EXISTS
"employee_sites_update_manager"
ON public.employee_sites;


CREATE POLICY "employee_sites_select"
ON public.employee_sites
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR employee_id = public.current_employee_id()
        OR (
            public.is_manager()
            AND public.employee_belongs_to_current_structure(employee_id)
        )
        OR public.is_site_responsible(site_id)
    )
);


CREATE POLICY "employee_sites_insert_manager"
ON public.employee_sites
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND public.employee_belongs_to_current_structure(employee_id)
        AND public.site_belongs_to_current_structure(site_id)
    )
);


CREATE POLICY "employee_sites_update_manager"
ON public.employee_sites
FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR (
        public.is_manager()
        AND public.employee_belongs_to_current_structure(employee_id)
    )
)
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND public.employee_belongs_to_current_structure(employee_id)
        AND public.site_belongs_to_current_structure(site_id)
    )
);


-- ============================================================
-- 8. ATTENDANCES
-- ============================================================

DROP POLICY IF EXISTS
"admin_can_view_all_attendance"
ON public.attendances;

DROP POLICY IF EXISTS
"attendances_select_v3"
ON public.attendances;

DROP POLICY IF EXISTS
"employee_can_create_own_attendance"
ON public.attendances;

DROP POLICY IF EXISTS
"employee_can_update_own_attendance"
ON public.attendances;

DROP POLICY IF EXISTS
"employee_can_view_own_attendance"
ON public.attendances;

DROP POLICY IF EXISTS
"manager_can_view_structure_attendance"
ON public.attendances;

DROP POLICY IF EXISTS
"attendances_select"
ON public.attendances;

DROP POLICY IF EXISTS
"attendances_insert_own"
ON public.attendances;

DROP POLICY IF EXISTS
"attendances_update_own"
ON public.attendances;


CREATE POLICY "attendances_select"
ON public.attendances
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR employee_id = public.current_employee_id()
        OR (
            public.is_manager()
            AND public.employee_belongs_to_current_structure(employee_id)
        )
        OR public.is_site_responsible(site_id)
    )
);


CREATE POLICY "attendances_insert_own"
ON public.attendances
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
);


CREATE POLICY "attendances_update_own"
ON public.attendances
FOR UPDATE
TO authenticated
USING (
    employee_id = public.current_employee_id()
)
WITH CHECK (
    employee_id = public.current_employee_id()
);


-- ============================================================
-- 9. ABSENCES
-- ============================================================

DROP POLICY IF EXISTS
"employee_absences_select_v3"
ON public.employee_absences;

DROP POLICY IF EXISTS
"employee_absences_select"
ON public.employee_absences;


CREATE POLICY "employee_absences_select"
ON public.employee_absences
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR employee_id = public.current_employee_id()
        OR (
            public.is_manager()
            AND structure_id = public.current_structure_id()
        )
    )
);


-- ============================================================
-- 10. REPORTS
-- ============================================================

DROP POLICY IF EXISTS
"admin_can_view_all_reports"
ON public.reports;

DROP POLICY IF EXISTS
"employee_can_create_own_reports"
ON public.reports;

DROP POLICY IF EXISTS
"employee_can_view_own_reports"
ON public.reports;

DROP POLICY IF EXISTS
"manager_can_view_own_reports"
ON public.reports;

DROP POLICY IF EXISTS
"manager_can_view_structure_reports"
ON public.reports;

DROP POLICY IF EXISTS
"reports_select_v3"
ON public.reports;

DROP POLICY IF EXISTS
"reports_select"
ON public.reports;

DROP POLICY IF EXISTS
"reports_insert_own"
ON public.reports;


CREATE POLICY "reports_select"
ON public.reports
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR author_employee_id = public.current_employee_id()
        OR recipient_employee_id = public.current_employee_id()
        OR employee_id = public.current_employee_id()
        OR (
            public.is_manager()
            AND structure_id = public.current_structure_id()
        )
        OR public.is_site_responsible(site_id)
    )
);


CREATE POLICY "reports_insert_own"
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
);


-- ============================================================
-- 11. NOTIFICATIONS
-- ============================================================

DROP POLICY IF EXISTS
"notifications_select_v3"
ON public.notifications;

DROP POLICY IF EXISTS
"notifications_update_v3"
ON public.notifications;

DROP POLICY IF EXISTS
"notifications_select_own"
ON public.notifications;

DROP POLICY IF EXISTS
"notifications_update_own"
ON public.notifications;


CREATE POLICY "notifications_select_own"
ON public.notifications
FOR SELECT
TO authenticated
USING (
    recipient_employee_id = public.current_employee_id()
);


CREATE POLICY "notifications_update_own"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
    recipient_employee_id = public.current_employee_id()
)
WITH CHECK (
    recipient_employee_id = public.current_employee_id()
);


-- ============================================================
-- 12. EMPLOYEE ACTIONS
-- ============================================================

DROP POLICY IF EXISTS
"admin_can_view_employee_actions"
ON public.employee_actions;

DROP POLICY IF EXISTS
"manager_can_view_structure_employee_actions"
ON public.employee_actions;

DROP POLICY IF EXISTS
"employee_actions_select"
ON public.employee_actions;


CREATE POLICY "employee_actions_select"
ON public.employee_actions
FOR SELECT
TO authenticated
USING (
    public.is_admin()
    OR (
        public.is_manager()
        AND public.employee_belongs_to_current_structure(employee_id)
    )
);


-- ============================================================
-- 13. ATTENDANCE ANOMALIES
-- ============================================================

DROP POLICY IF EXISTS
"attendance_anomalies_select_v3"
ON public.attendance_anomalies;

DROP POLICY IF EXISTS
"attendance_anomalies_select"
ON public.attendance_anomalies;


CREATE POLICY "attendance_anomalies_select"
ON public.attendance_anomalies
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR employee_id = public.current_employee_id()
        OR (
            public.is_manager()
            AND public.employee_belongs_to_current_structure(employee_id)
        )
        OR public.is_site_responsible(site_id)
    )
);


-- ============================================================
-- 14. SITES
-- ============================================================

DROP POLICY IF EXISTS
"admin_can_insert_sites"
ON public.sites;

DROP POLICY IF EXISTS
"admin_can_update_sites"
ON public.sites;

DROP POLICY IF EXISTS
"admin_can_view_all_sites"
ON public.sites;

DROP POLICY IF EXISTS
"authenticated_can_view_sites"
ON public.sites;

DROP POLICY IF EXISTS
"employee_can_view_active_site"
ON public.sites;

DROP POLICY IF EXISTS
"manager_can_insert_structure_sites"
ON public.sites;

DROP POLICY IF EXISTS
"manager_can_update_structure_sites"
ON public.sites;

DROP POLICY IF EXISTS
"manager_can_view_structure_sites"
ON public.sites;

DROP POLICY IF EXISTS
"sites_select_v3"
ON public.sites;

DROP POLICY IF EXISTS
"sites_select"
ON public.sites;

DROP POLICY IF EXISTS
"sites_insert_admin_or_manager"
ON public.sites;

DROP POLICY IF EXISTS
"sites_update_admin_or_manager"
ON public.sites;


CREATE POLICY "sites_select"
ON public.sites
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR structure_id = public.current_structure_id()
        OR public.is_site_responsible(id)
    )
);


CREATE POLICY "sites_insert_admin_or_manager"
ON public.sites
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND structure_id = public.current_structure_id()
    )
);


CREATE POLICY "sites_update_admin_or_manager"
ON public.sites
FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR (
        public.is_manager()
        AND structure_id = public.current_structure_id()
    )
)
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND structure_id = public.current_structure_id()
    )
);


-- ============================================================
-- 15. STRUCTURES
-- ============================================================

DROP POLICY IF EXISTS
"Enable read access for all users"
ON public.structures;

DROP POLICY IF EXISTS
"structures_select_v3"
ON public.structures;

DROP POLICY IF EXISTS
"structures_select"
ON public.structures;


CREATE POLICY "structures_select"
ON public.structures
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR id = public.current_structure_id()
    )
);


-- ============================================================
-- 16. SERVICES
-- ============================================================

DROP POLICY IF EXISTS
"authenticated_can_view_services"
ON public.services;

DROP POLICY IF EXISTS
"services_select"
ON public.services;


CREATE POLICY "services_select"
ON public.services
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 17. POSITIONS
-- ============================================================

DROP POLICY IF EXISTS
"authenticated_can_view_positions"
ON public.positions;

DROP POLICY IF EXISTS
"positions_select"
ON public.positions;


CREATE POLICY "positions_select"
ON public.positions
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 18. CITIES
-- ============================================================

DROP POLICY IF EXISTS
"authenticated_can_view_cities"
ON public.cities;

DROP POLICY IF EXISTS
"cities_select_v3"
ON public.cities;

DROP POLICY IF EXISTS
"cities_select"
ON public.cities;


CREATE POLICY "cities_select"
ON public.cities
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 19. REPORT TYPES
-- ============================================================

DROP POLICY IF EXISTS
"authenticated_can_view_report_types"
ON public.report_types;

DROP POLICY IF EXISTS
"report_types_select"
ON public.report_types;


CREATE POLICY "report_types_select"
ON public.report_types
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 20. AUDIT LOGS
-- ============================================================

DROP POLICY IF EXISTS
"audit_logs_select_v3"
ON public.audit_logs;

DROP POLICY IF EXISTS
"audit_logs_select_admin"
ON public.audit_logs;


CREATE POLICY "audit_logs_select_admin"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    public.is_admin()
);


COMMIT;