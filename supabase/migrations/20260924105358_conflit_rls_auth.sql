BEGIN;

DROP POLICY IF EXISTS employees_select
ON public.employees;

CREATE POLICY employees_select
ON public.employees
FOR SELECT
TO authenticated
USING (
    auth_user_id = auth.uid()
    OR (
        current_employee_is_active()
        AND (
            is_admin()
            OR (
                is_manager()
                AND structure_id = current_structure_id()
            )
            OR is_site_responsible(site_id)
        )
    )
);

COMMIT;