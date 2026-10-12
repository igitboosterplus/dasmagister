-- ============================================================
-- FIX: Allow report submission even if structure has no manager
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_report(
    p_report_type_id  UUID,
    p_title           TEXT,
    p_description     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_author_id         UUID;
    v_author            public.employees%ROWTYPE;
    v_author_role       public.employee_role;
    v_structure_id      UUID;

    v_primary_site_id   UUID;

    v_manager_id        UUID;
    v_admin_id          UUID;

    v_report_id         UUID;
BEGIN

    -- --------------------------------------------------------
    -- 1. Identifier l'auteur
    -- --------------------------------------------------------
    v_author_id := public.current_employee_id();

    IF v_author_id IS NULL THEN
        RAISE EXCEPTION 'AUTHOR_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_author FROM public.employees WHERE id = v_author_id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AUTHOR_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    IF v_author.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'AUTHOR_INACTIVE' USING ERRCODE = 'P0001';
    END IF;

    IF v_author.account_status::TEXT <> 'active' THEN
        RAISE EXCEPTION 'AUTHOR_ACCOUNT_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;

    v_structure_id := v_author.structure_id;
    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'AUTHOR_HAS_NO_STRUCTURE' USING ERRCODE = 'P0001';
    END IF;

    -- --------------------------------------------------------
    -- 2. Rôle de l'auteur
    -- --------------------------------------------------------
    SELECT er.role INTO v_author_role
    FROM public.employee_roles er
    WHERE er.employee_id = v_author_id LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'AUTHOR_HAS_NO_ROLE' USING ERRCODE = 'P0001';
    END IF;

    -- --------------------------------------------------------
    -- 3. Site principal de l'auteur
    -- --------------------------------------------------------
    SELECT es.site_id INTO v_primary_site_id
    FROM public.employee_sites es
    WHERE es.employee_id = v_author_id AND es.is_active = TRUE AND es.is_responsible = TRUE LIMIT 1;

    IF v_primary_site_id IS NULL THEN
        SELECT es.site_id INTO v_primary_site_id
        FROM public.employee_sites es
        WHERE es.employee_id = v_author_id AND es.is_active = TRUE LIMIT 1;
    END IF;

    -- --------------------------------------------------------
    -- 4. Résolution des destinataires
    -- --------------------------------------------------------
    IF v_author_role = 'employee'::public.employee_role THEN
        SELECT er.employee_id INTO v_manager_id
        FROM public.employees emp
        INNER JOIN public.employee_roles er ON er.employee_id = emp.id
        WHERE emp.structure_id = v_structure_id AND emp.is_active = TRUE AND er.role = 'manager'::public.employee_role
        LIMIT 1;
        -- REMOVED THE EXCEPTION HERE FOR "NO_MANAGER"

        SELECT er.employee_id INTO v_admin_id
        FROM public.employee_roles er
        INNER JOIN public.employees emp ON emp.id = er.employee_id
        WHERE er.role = 'admin'::public.employee_role AND emp.is_active = TRUE
        LIMIT 1;

    ELSIF v_author_role = 'manager'::public.employee_role THEN
        SELECT er.employee_id INTO v_admin_id
        FROM public.employee_roles er
        INNER JOIN public.employees emp ON emp.id = er.employee_id
        WHERE er.role = 'admin'::public.employee_role AND emp.is_active = TRUE
        LIMIT 1;

        IF v_admin_id IS NULL THEN
            RAISE EXCEPTION 'NO_ADMIN_FOUND' USING ERRCODE = 'P0001';
        END IF;

        v_manager_id := NULL;
    ELSE
        v_manager_id := NULL;
        v_admin_id := NULL;
    END IF;

    -- --------------------------------------------------------
    -- 5. Valider le type de rapport
    -- --------------------------------------------------------
    PERFORM 1 FROM public.report_types WHERE id = p_report_type_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_REPORT_TYPE' USING ERRCODE = 'P0001';
    END IF;

    -- --------------------------------------------------------
    -- 6. Créer le rapport
    -- --------------------------------------------------------
    INSERT INTO public.reports (
        employee_id, author_employee_id, recipient_employee_id, recipient_id,
        report_type_id, structure_id, site_id, title, description,
        file_url, status, submitted_at, created_at
    )
    VALUES (
        v_author_id, v_author_id, COALESCE(v_manager_id, v_admin_id), COALESCE(v_manager_id, v_admin_id),
        p_report_type_id, v_structure_id, v_primary_site_id, TRIM(p_title), NULLIF(TRIM(COALESCE(p_description, '')), ''),
        NULL, 'submitted', NOW(), NOW()
    )
    RETURNING id INTO v_report_id;

    -- --------------------------------------------------------
    -- 7. Insérer les destinataires
    -- --------------------------------------------------------
    IF v_author_role = 'employee'::public.employee_role THEN
        IF v_manager_id IS NOT NULL THEN
            INSERT INTO public.report_recipients (report_id, employee_id, recipient_type)
            VALUES (v_report_id, v_manager_id, 'primary') ON CONFLICT DO NOTHING;
        END IF;

        IF v_admin_id IS NOT NULL AND (v_admin_id <> v_manager_id OR v_manager_id IS NULL) THEN
            INSERT INTO public.report_recipients (report_id, employee_id, recipient_type)
            VALUES (v_report_id, v_admin_id, CASE WHEN v_manager_id IS NULL THEN 'primary' ELSE 'cc' END) ON CONFLICT DO NOTHING;
        END IF;

    ELSIF v_author_role = 'manager'::public.employee_role THEN
        IF v_admin_id IS NOT NULL THEN
            INSERT INTO public.report_recipients (report_id, employee_id, recipient_type)
            VALUES (v_report_id, v_admin_id, 'primary') ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    -- --------------------------------------------------------
    -- 8. Notifications
    -- --------------------------------------------------------
    IF v_manager_id IS NOT NULL AND v_author_role = 'employee'::public.employee_role THEN
        INSERT INTO public.notifications (
            recipient_employee_id, type, title, message, entity_type, entity_id
        ) VALUES (
            v_manager_id, 'new_report', 'Nouveau rapport reçu', 'Un employé de votre structure vient de soumettre un rapport : ' || TRIM(p_title), 'report', v_report_id
        );
    END IF;

    IF v_admin_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            recipient_employee_id, type, title, message, entity_type, entity_id
        ) VALUES (
            v_admin_id, 'new_report', 'Nouveau rapport',
            CASE
                WHEN v_author_role = 'employee'::public.employee_role THEN 'Un employé a soumis un rapport : ' || TRIM(p_title)
                WHEN v_author_role = 'manager'::public.employee_role THEN 'Un manager a soumis un rapport : ' || TRIM(p_title)
                ELSE 'Nouveau rapport : ' || TRIM(p_title)
            END,
            'report', v_report_id
        );
    END IF;

    RETURN v_report_id;
END;
$$;
