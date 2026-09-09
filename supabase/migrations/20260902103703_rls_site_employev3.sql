-- ============================================================
-- MANAGER : MODIFICATION DU SITE D'UN EMPLOYÉ
-- ============================================================

DROP POLICY IF EXISTS "Managers can update employee site"
ON public.employees;

CREATE POLICY "Managers can update employee site"
ON public.employees
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.employee_roles er
        WHERE er.employee_id = (
            SELECT e.id
            FROM public.employees e
            WHERE e.auth_user_id = auth.uid()
            LIMIT 1
        )
        AND er.role = 'manager'::employee_role
    )
    AND structure_id = public.current_structure_id()
)
WITH CHECK (
    structure_id = public.current_structure_id()
);


-- ============================================================
-- MANAGER : MODIFICATION DU RÔLE D'UN EMPLOYÉ
-- ============================================================

DROP POLICY IF EXISTS "Managers can update employee roles"
ON public.employee_roles;

CREATE POLICY "Managers can update employee roles"
ON public.employee_roles
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = employee_roles.employee_id
        AND e.structure_id = public.current_structure_id()
    )
)
WITH CHECK (
    role = 'employee'::employee_role
    AND EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = employee_roles.employee_id
        AND e.structure_id = public.current_structure_id()
    )
);