BEGIN;

-- ============================================================
-- RESPONSABLE DE SITE
-- Accès en lecture aux employés de son site
-- ============================================================

DROP POLICY IF EXISTS employees_select
ON public.employees;

CREATE POLICY employees_select
ON public.employees
FOR SELECT
TO authenticated
USING (
    current_employee_is_active()
    AND (
        -- Administrateur
        is_admin()

        -- L'employé peut toujours voir son propre profil
        OR id = current_employee_id()

        -- Manager : accès aux employés de sa structure
        OR (
            is_manager()
            AND structure_id = current_structure_id()
        )

        -- Responsable de site :
        -- accès aux employés de son site
        OR is_site_responsible(site_id)
    )
);


-- ============================================================
-- RESPONSABLE DE SITE
-- Accès aux absences des employés de son site
-- ============================================================

DROP POLICY IF EXISTS employee_absences_select
ON public.employee_absences;

CREATE POLICY employee_absences_select
ON public.employee_absences
FOR SELECT
TO authenticated
USING (
    current_employee_is_active()
    AND (
        -- Administrateur
        is_admin()

        -- L'employé peut voir ses propres absences
        OR employee_id = current_employee_id()

        -- Manager : accès aux absences de sa structure
        OR (
            is_manager()
            AND structure_id = current_structure_id()
        )

        -- Responsable de site :
        -- accès aux absences des employés affectés
        -- à son site
        OR EXISTS (
            SELECT 1
            FROM public.employee_sites es
            WHERE es.employee_id = employee_absences.employee_id
              AND es.is_active = true
              AND is_site_responsible(es.site_id)
        )
    )
);


COMMIT;