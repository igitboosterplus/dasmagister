-- ============================================================
-- MIGRATION: promote_employee_to_manager
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.promote_employee_to_manager(
    p_employee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_structure_id UUID;
    v_role public.employee_role;
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED - Seul un administrateur peut promouvoir un employé';
    END IF;

    SELECT structure_id INTO v_structure_id
    FROM public.employees
    WHERE id = p_employee_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND - Employé introuvable ou inactif';
    END IF;

    SELECT role INTO v_role
    FROM public.employee_roles
    WHERE employee_id = p_employee_id;

    IF v_role = 'admin' THEN
        RAISE EXCEPTION 'CANNOT_PROMOTE_ADMIN - Impossible de modifier un administrateur';
    END IF;

    -- Upsert the manager role
    INSERT INTO public.employee_roles (employee_id, role)
    VALUES (p_employee_id, 'manager')
    ON CONFLICT (employee_id) 
    DO UPDATE SET role = 'manager';

END;
$$;

COMMIT;
