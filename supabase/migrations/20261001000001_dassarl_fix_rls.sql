BEGIN;

DROP POLICY IF EXISTS report_types_select ON public.report_types;

CREATE POLICY report_types_select
ON public.report_types
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active() 
    AND (
        structure_id IS NULL 
        OR structure_id = public.current_structure_id()
        OR public.is_admin()
    )
    AND (
        is_active = TRUE 
        OR public.is_admin()
        OR (public.is_manager() AND structure_id = public.current_structure_id())
    )
);

COMMIT;
