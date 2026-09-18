-- ============================================================
-- MIGRATION — RLS + SÉCURITÉ ATTENDANCE
-- ============================================================
-- Modèle métier :
--
-- employee
--    └── 1 structure
--
-- structure
--    └── N sites
--
-- employee
--    └── N sites appartenant à sa structure
--
-- ADMIN
--    └── accès global
--
-- MANAGER
--    └── accès à sa structure
--
-- SITE RESPONSIBLE
--    └── accès à ses sites
--
-- EMPLOYEE
--    └── accès à ses propres données
--
-- ============================================================


BEGIN;

-- ============================================================
-- 1. NETTOYAGE DES ANCIENNES POLICIES
-- ============================================================

DROP POLICY IF EXISTS attendance_anomalies_select
ON public.attendance_anomalies;

DROP POLICY IF EXISTS admin_can_view_all_attendance_events
ON public.attendance_events;

DROP POLICY IF EXISTS employee_can_view_own_attendance_events
ON public.attendance_events;

DROP POLICY IF EXISTS manager_can_view_structure_attendance_events
ON public.attendance_events;

DROP POLICY IF EXISTS attendances_insert_own
ON public.attendances;

DROP POLICY IF EXISTS attendances_select
ON public.attendances;

DROP POLICY IF EXISTS attendances_update_own
ON public.attendances;

DROP POLICY IF EXISTS audit_logs_select_admin
ON public.audit_logs;

DROP POLICY IF EXISTS cities_select
ON public.cities;

DROP POLICY IF EXISTS employee_absences_select
ON public.employee_absences;

DROP POLICY IF EXISTS employee_actions_select
ON public.employee_actions;

DROP POLICY IF EXISTS employee_roles_insert
ON public.employee_roles;

DROP POLICY IF EXISTS employee_roles_select
ON public.employee_roles;

DROP POLICY IF EXISTS employee_roles_update
ON public.employee_roles;

DROP POLICY IF EXISTS employee_sites_insert_manager
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_select
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_update_manager
ON public.employee_sites;

DROP POLICY IF EXISTS employees_insert_admin
ON public.employees;

DROP POLICY IF EXISTS employees_select
ON public.employees;

DROP POLICY IF EXISTS employees_update_manager
ON public.employees;

DROP POLICY IF EXISTS update
ON public.employees;

DROP POLICY IF EXISTS notifications_select_own
ON public.notifications;

DROP POLICY IF EXISTS notifications_update_own
ON public.notifications;

DROP POLICY IF EXISTS positions_select
ON public.positions;

DROP POLICY IF EXISTS report_attachments_insert
ON public.report_attachments;

DROP POLICY IF EXISTS report_attachments_select
ON public.report_attachments;

DROP POLICY IF EXISTS report_types_select
ON public.report_types;

DROP POLICY IF EXISTS reports_insert_own
ON public.reports;

DROP POLICY IF EXISTS reports_select
ON public.reports;

DROP POLICY IF EXISTS services_select
ON public.services;

DROP POLICY IF EXISTS site_work_schedules_delete
ON public.site_work_schedules;

DROP POLICY IF EXISTS site_work_schedules_insert
ON public.site_work_schedules;

DROP POLICY IF EXISTS site_work_schedules_select
ON public.site_work_schedules;

DROP POLICY IF EXISTS site_work_schedules_update
ON public.site_work_schedules;

DROP POLICY IF EXISTS sites_insert_admin_or_manager
ON public.sites;

DROP POLICY IF EXISTS sites_select
ON public.sites;

DROP POLICY IF EXISTS sites_update_admin_or_manager
ON public.sites;

DROP POLICY IF EXISTS structures_select
ON public.structures;

DROP POLICY IF EXISTS employees_insert_admin ON public.employees;
DROP POLICY IF EXISTS employees_select ON public.employees;
DROP POLICY IF EXISTS employees_update_manager ON public.employees;
DROP POLICY IF EXISTS employees_update_own ON public.employees;
DROP POLICY IF EXISTS update ON public.employees;

DROP POLICY IF EXISTS attendance_events_select
ON public.attendance_events;



-- ============================================================
-- 2. ACTIVER RLS
-- ============================================================

ALTER TABLE public.attendance_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 3. STRUCTURES
-- ============================================================
--
-- IMPORTANT :
-- Les structures doivent être lisibles pendant l'inscription.
--
-- On conserve donc :
--
-- SELECT → public
-- USING TRUE
--
-- Cela ne donne PAS de droit de modification.
-- ============================================================

CREATE POLICY structures_select
ON public.structures
FOR SELECT
TO public
USING (true);


-- ============================================================
-- 4. TABLE EMPLOYEES
-- ============================================================
--
-- ATTENTION :
-- Ne jamais utiliser une sous-requête directe sur employees
-- dans employees_select.
--
-- Sinon :
--
-- employees
--   -> RLS employees
--      -> SELECT employees
--         -> RLS employees
--            -> récursion
--
-- On utilise uniquement les fonctions SECURITY DEFINER.
-- ============================================================

CREATE POLICY employees_select
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


-- Admin uniquement pour créer un employee
CREATE POLICY employees_insert_admin
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
);


-- Manager peut modifier les employés de sa structure
CREATE POLICY employees_update_manager
ON public.employees
FOR UPDATE
TO authenticated
USING (
    public.is_manager()
    AND id <> public.current_employee_id()
    AND public.employee_belongs_to_current_structure(id)
    AND NOT public.employee_is_manager(id)
)
WITH CHECK (
    structure_id = public.current_structure_id()
    AND NOT public.employee_is_manager(id)
);


-- L'utilisateur peut modifier son propre profil

CREATE POLICY employees_update_own
ON public.employees
FOR UPDATE
TO authenticated
USING (
    auth_user_id = auth.uid()
)
WITH CHECK (
    auth_user_id = auth.uid()
);


-- ============================================================
-- 5. EMPLOYEE ROLES
-- ============================================================

CREATE POLICY employee_roles_select
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


CREATE POLICY employee_roles_insert
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


CREATE POLICY employee_roles_update
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
-- 6. SITES
-- ============================================================

CREATE POLICY sites_select
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


CREATE POLICY sites_insert_admin_or_manager
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


CREATE POLICY sites_update_admin_or_manager
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
-- 7. EMPLOYEE SITES
-- ============================================================

CREATE POLICY employee_sites_select
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


CREATE POLICY employee_sites_insert_manager
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


CREATE POLICY employee_sites_update_manager
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
--
-- IMPORTANT :
-- Le frontend ne doit pas avoir besoin d'insérer directement
-- n'importe quelle présence.
--
-- Le pointage normal doit passer par :
--
-- clock_in()
-- clock_out()
--
-- Les RPC SECURITY DEFINER appliquent les règles métier.
--
-- La policy INSERT reste volontairement limitée à son propre
-- employee_id.
-- ============================================================

CREATE POLICY attendances_select
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


CREATE POLICY attendances_insert_own
ON public.attendances
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
);


CREATE POLICY attendances_update_own
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
-- 9. ATTENDANCE EVENTS
-- ============================================================

CREATE POLICY attendance_events_select
ON public.attendance_events
FOR SELECT
TO authenticated
USING (
    public.is_admin()
    OR employee_id = public.current_employee_id()
    OR (
        public.is_manager()
        AND public.employee_belongs_to_current_structure(employee_id)
    )
    OR public.is_site_responsible(site_id)
);


-- ============================================================
-- 10. ATTENDANCE ANOMALIES
-- ============================================================

CREATE POLICY attendance_anomalies_select
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
-- 11. ABSENCES
-- ============================================================

CREATE POLICY employee_absences_select
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
-- 12. ACTIONS EMPLOYES
-- ============================================================

CREATE POLICY employee_actions_select
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
-- 13. NOTIFICATIONS
-- ============================================================

CREATE POLICY notifications_select_own
ON public.notifications
FOR SELECT
TO authenticated
USING (
    recipient_employee_id = public.current_employee_id()
);


CREATE POLICY notifications_update_own
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
-- 14. REPORTS
-- ============================================================

CREATE POLICY reports_select
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


CREATE POLICY reports_insert_own
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
    AND author_employee_id = public.current_employee_id()
);


-- ============================================================
-- 15. REPORT ATTACHMENTS
-- ============================================================

CREATE POLICY report_attachments_insert
ON public.report_attachments
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.reports r
        WHERE r.id = report_attachments.report_id
        AND (
            r.employee_id = public.current_employee_id()
            OR r.author_employee_id = public.current_employee_id()
        )
    )
);


CREATE POLICY report_attachments_select
ON public.report_attachments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.reports r
        WHERE r.id = report_attachments.report_id
        AND (
            r.employee_id = public.current_employee_id()
            OR r.author_employee_id = public.current_employee_id()
            OR r.recipient_employee_id = public.current_employee_id()
            OR r.recipient_id = public.current_employee_id()
            OR (
                public.is_manager()
                AND r.structure_id = public.current_structure_id()
            )
            OR public.is_site_responsible(r.site_id)
            OR public.is_admin()
        )
    )
);


-- ============================================================
-- 16. DONNÉES DE RÉFÉRENCE
-- ============================================================

CREATE POLICY cities_select
ON public.cities
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


CREATE POLICY positions_select
ON public.positions
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


CREATE POLICY services_select
ON public.services
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


CREATE POLICY report_types_select
ON public.report_types
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 17. SITE WORK SCHEDULES
-- ============================================================

CREATE POLICY site_work_schedules_select
ON public.site_work_schedules
FOR SELECT
TO authenticated
USING (
    public.can_manage_site_schedule(site_id)
);


CREATE POLICY site_work_schedules_insert
ON public.site_work_schedules
FOR INSERT
TO authenticated
WITH CHECK (
    public.can_manage_site_schedule(site_id)
);


CREATE POLICY site_work_schedules_update
ON public.site_work_schedules
FOR UPDATE
TO authenticated
USING (
    public.can_manage_site_schedule(site_id)
)
WITH CHECK (
    public.can_manage_site_schedule(site_id)
);


CREATE POLICY site_work_schedules_delete
ON public.site_work_schedules
FOR DELETE
TO authenticated
USING (
    public.can_manage_site_schedule(site_id)
);


-- ============================================================
-- 18. AUDIT LOGS
-- ============================================================

CREATE POLICY audit_logs_select_admin
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    public.is_admin()
);


COMMIT;


-- ============================================================
-- 19. VÉRIFICATION
-- ============================================================

SELECT
    schemaname,
    tablename,
    policyname,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- Vérification RLS
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;