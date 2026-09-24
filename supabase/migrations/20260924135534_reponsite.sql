DROP POLICY IF EXISTS employees_select ON public.employees;

CREATE POLICY employees_select
ON public.employees
FOR SELECT
TO authenticated
USING (
    current_employee_is_active()
    AND (
        is_admin()
        OR id = current_employee_id()

        OR (
            is_manager()
            AND structure_id = current_structure_id()
        )

        OR EXISTS (
            SELECT 1
            FROM public.employee_sites es
            WHERE es.employee_id = employees.id
              AND es.is_active = true
              AND is_site_responsible(es.site_id)
        )
    )
);