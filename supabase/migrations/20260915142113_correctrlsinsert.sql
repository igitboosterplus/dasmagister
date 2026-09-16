-- =========================================================
-- 1. Supprimer l'ancienne policy trop complexe
-- =========================================================

DROP POLICY IF EXISTS reports_insert_own
ON public.reports;


-- =========================================================
-- 2. Nouvelle policy INSERT
-- =========================================================

CREATE POLICY reports_insert_own
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = current_employee_id()
    AND author_employee_id = current_employee_id()
);

CREATE OR REPLACE FUNCTION public.get_current_structure_manager()
RETURNS TABLE (
    id uuid,
    first_name varchar,
    last_name varchar
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_structure_id uuid;
    v_manager_count integer;
BEGIN

    SELECT e.structure_id
    INTO v_structure_id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
      AND e.is_active = true
    LIMIT 1;

    IF v_structure_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO v_manager_count
    FROM public.employees e
    INNER JOIN public.employee_roles er
        ON er.employee_id = e.id
    WHERE e.structure_id = v_structure_id
      AND e.is_active = true
      AND er.role = 'manager'::employee_role;

    IF v_manager_count = 0 THEN
        RETURN;
    END IF;

    IF v_manager_count > 1 THEN
        RAISE EXCEPTION
            'Plusieurs managers actifs existent dans la structure %',
            v_structure_id;
    END IF;

    RETURN QUERY
    SELECT
        e.id,
        e.first_name,
        e.last_name
    FROM public.employees e
    INNER JOIN public.employee_roles er
        ON er.employee_id = e.id
    WHERE e.structure_id = v_structure_id
      AND e.is_active = true
      AND er.role = 'manager'::employee_role
    LIMIT 1;

END;
$$;

REVOKE ALL
ON FUNCTION public.get_current_structure_manager()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_current_structure_manager()
TO authenticated;