CREATE POLICY "Managers can assign roles to employees"
ON public.employee_roles
FOR INSERT
TO authenticated
WITH CHECK (
  employee_roles.role = 'employee'::employee_role
  AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = employee_roles.employee_id
      AND e.structure_id = (
        SELECT structure_id
        FROM public.employees
        WHERE auth_user_id = auth.uid()
      )
  )
);