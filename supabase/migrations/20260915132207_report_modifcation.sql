-- ============================================================
-- REPORTS : RESOLUTION DU MANAGER PAR STRUCTURE
-- ============================================================

-- 1. Fonction permettant à un utilisateur connecté de récupérer
--    le manager de sa propre structure.
--
--    Le frontend ne fournit PAS l'id de l'employé.
--    La fonction utilise auth.uid() pour retrouver l'employé connecté.

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

    -- ========================================================
    -- Récupérer la structure de l'utilisateur connecté
    -- ========================================================

    SELECT e.structure_id
    INTO v_structure_id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
      AND e.is_active = true
    LIMIT 1;

    IF v_structure_id IS NULL THEN
        RETURN;
    END IF;


    -- ========================================================
    -- Vérifier combien de managers actifs existent
    -- dans cette structure.
    -- ========================================================

    SELECT COUNT(*)
    INTO v_manager_count
    FROM public.employees e
    INNER JOIN public.employee_roles er
        ON er.employee_id = e.id
    WHERE e.structure_id = v_structure_id
      AND e.is_active = true
      AND er.role = 'manager'::employee_role;


    -- ========================================================
    -- Aucun manager
    -- ========================================================

    IF v_manager_count = 0 THEN
        RETURN;
    END IF;


    -- ========================================================
    -- Plusieurs managers
    -- On ne choisit surtout pas arbitrairement.
    -- ========================================================

    IF v_manager_count > 1 THEN
        RAISE EXCEPTION
            'Plusieurs managers actifs existent dans la structure %',
            v_structure_id;
    END IF;


    -- ========================================================
    -- Retourner le manager
    -- ========================================================

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


-- ============================================================
-- 2. Sécurité de la fonction
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_current_structure_manager()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_current_structure_manager()
TO authenticated;


-- ============================================================
-- 3. Renforcer l'insertion des rapports
--
-- L'employé doit créer son propre rapport.
-- Le destinataire doit être le manager de sa structure.
--
-- Cette règle évite qu'un frontend compromis puisse envoyer
-- un rapport à n'importe quel employé.
-- ============================================================

DROP POLICY IF EXISTS reports_insert_own
ON public.reports;


CREATE POLICY reports_insert_own
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = current_employee_id()
    AND author_employee_id = current_employee_id()
    AND (
        -- ----------------------------------------------------
        -- EMPLOYÉ → MANAGER DE SA STRUCTURE
        -- ----------------------------------------------------
        (
            EXISTS (
                SELECT 1
                FROM public.employee_roles er_current
                WHERE er_current.employee_id = current_employee_id()
                  AND er_current.role = 'employee'::employee_role
            )
            AND recipient_employee_id = (
                SELECT er_manager.employee_id
                FROM public.employees current_employee
                INNER JOIN public.employees manager
                    ON manager.structure_id = current_employee.structure_id
                   AND manager.is_active = true
                INNER JOIN public.employee_roles er_manager
                    ON er_manager.employee_id = manager.id
                   AND er_manager.role = 'manager'::employee_role
                WHERE current_employee.id = current_employee_id()
                  AND current_employee.is_active = true
                LIMIT 1
            )
        )

        OR

        -- ----------------------------------------------------
        -- MANAGER → ADMIN
        --
        -- Ici on conserve le comportement actuel.
        -- Le frontend fournit recipient_employee_id = admin.
        -- ----------------------------------------------------
        (
            EXISTS (
                SELECT 1
                FROM public.employee_roles er_current
                WHERE er_current.employee_id = current_employee_id()
                  AND er_current.role = 'manager'::employee_role
            )
            AND EXISTS (
                SELECT 1
                FROM public.employee_roles er_recipient
                WHERE er_recipient.employee_id = recipient_employee_id
                  AND er_recipient.role = 'admin'::employee_role
            )
        )
    )
);