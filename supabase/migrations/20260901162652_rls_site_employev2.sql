
-- ------------------------------------------------------------
-- EMPLOYEE_ROLES : INSERT
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Managers can assign roles to employees"
ON public.employee_roles;

CREATE POLICY "Managers can assign roles to employees"
ON public.employee_roles
FOR INSERT
TO authenticated
WITH CHECK (
    role = 'employee'::employee_role
    AND EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = employee_roles.employee_id
        AND e.structure_id = public.current_structure_id()
    )
);


-- ------------------------------------------------------------
-- EMPLOYEE_ROLES : UPDATE
-- Permet de modifier le rôle d'un employé de la structure.
--
-- La logique métier (qui a le droit de modifier quoi)
-- reste gérée par le backend.
-- ------------------------------------------------------------

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
