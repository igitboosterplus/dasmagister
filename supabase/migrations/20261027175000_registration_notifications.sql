-- ============================================================
-- MIGRATION : NOTIFICATIONS & VALIDATION D'INSCRIPTION BIDIRECTIONNELLE
-- 1. Notification au(x) manager(s) lors d'une nouvelle inscription
-- 2. Notification au nouvel employé lors de l'approbation ou du refus
-- 3. Passage de pending à active via approve_registration
-- ============================================================

-- 1. FONCTION : handle_new_employee avec notification aux managers
CREATE OR REPLACE FUNCTION public.handle_new_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_first_name VARCHAR(100);
    v_last_name VARCHAR(100);
    v_phone VARCHAR(30);
    v_structure_id UUID;
    v_employee_id UUID;
    v_default_position_id UUID;
BEGIN
    -- Récupération des métadonnées
    v_first_name := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'first_name'), '');
    v_last_name  := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'last_name'), '');
    v_phone      := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'phone'), '');

    BEGIN
        v_structure_id := NULLIF(NEW.raw_user_meta_data ->> 'structure_id', '')::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'Invalid structure_id';
    END;

    IF v_first_name IS NULL THEN
        RAISE EXCEPTION 'first_name is required';
    END IF;

    IF v_last_name IS NULL THEN
        RAISE EXCEPTION 'last_name is required';
    END IF;

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'structure_id is required';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.structures WHERE id = v_structure_id) THEN
        RAISE EXCEPTION 'The selected structure does not exist';
    END IF;

    SELECT id INTO v_default_position_id
    FROM public.positions
    WHERE name = 'Employé'
    LIMIT 1;

    IF v_default_position_id IS NULL THEN
        SELECT id INTO v_default_position_id FROM public.positions LIMIT 1;
    END IF;

    -- Création de l'employé avec statut 'pending' et is_active = FALSE
    INSERT INTO public.employees (
        auth_user_id,
        first_name,
        last_name,
        phone,
        structure_id,
        position_id,
        account_status,
        is_active
    )
    VALUES (
        NEW.id,
        v_first_name,
        v_last_name,
        v_phone,
        v_structure_id,
        v_default_position_id,
        'pending',
        FALSE
    )
    RETURNING id INTO v_employee_id;

    -- Rôle par défaut
    INSERT INTO public.employee_roles (
        employee_id,
        role
    )
    VALUES (
        v_employee_id,
        'employee'
    );

    -- NOTIFICATION SENS 1 : Alerte envoyée aux managers de la structure (ou admins)
    INSERT INTO public.notifications (
        recipient_employee_id,
        type,
        title,
        message,
        entity_type,
        entity_id
    )
    SELECT
        e.id,
        'new_registration',
        'Nouvelle inscription à valider',
        v_first_name || ' ' || v_last_name || ' vient de s''inscrire au sein de votre structure et attend votre validation.',
        'employee',
        v_employee_id
    FROM public.employees e
    JOIN public.employee_roles er ON er.employee_id = e.id
    WHERE (
        (er.role = 'manager' AND e.structure_id = v_structure_id)
        OR er.role = 'admin'
    )
    AND e.is_active = TRUE
    AND e.account_status = 'active';

    RETURN NEW;
END;
$$;

-- 2. FONCTION : approve_registration avec notification à l'employé
CREATE OR REPLACE FUNCTION public.approve_registration(
    p_employee_id UUID,
    p_service_id UUID DEFAULT NULL,
    p_position_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_structure UUID;
    v_first_name TEXT;
    v_last_name TEXT;
BEGIN
    SELECT structure_id, first_name, last_name
    INTO v_target_structure, v_first_name, v_last_name
    FROM public.employees
    WHERE id = p_employee_id
      AND account_status = 'pending';

    IF v_target_structure IS NULL THEN
        RAISE EXCEPTION 'Pending employee not found';
    END IF;

    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_target_structure
       )
    THEN
        RAISE EXCEPTION 'You cannot approve this registration';
    END IF;

    -- Activation de l'employé
    UPDATE public.employees
    SET
        account_status = 'active',
        is_active = TRUE,
        service_id = COALESCE(p_service_id, service_id),
        position_id = COALESCE(p_position_id, position_id),
        approved_by = public.current_employee_id(),
        approved_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = p_employee_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        new_data
    )
    VALUES (
        public.current_employee_id(),
        'REGISTRATION_APPROVED',
        'employee',
        p_employee_id,
        jsonb_build_object('account_status', 'active')
    );

    -- NOTIFICATION SENS 2 : Envoi de la confirmation au nouvel employé
    INSERT INTO public.notifications (
        recipient_employee_id,
        type,
        title,
        message,
        entity_type,
        entity_id
    )
    VALUES (
        p_employee_id,
        'registration_approved',
        'Inscription validée !',
        'Votre compte a été activé avec succès par votre responsable. Vous pouvez dès à présent utiliser toutes les fonctionnalités de l''application.',
        'employee',
        p_employee_id
    );
END;
$$;

-- 3. FONCTION : reject_registration avec notification à l'employé
CREATE OR REPLACE FUNCTION public.reject_registration(
    p_employee_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_structure_id UUID;
BEGIN
    SELECT structure_id
    INTO v_structure_id
    FROM public.employees
    WHERE id = p_employee_id
      AND account_status = 'pending';

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'Pending employee not found';
    END IF;

    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_structure_id
       )
    THEN
        RAISE EXCEPTION 'You cannot reject this registration';
    END IF;

    -- Rejet du compte
    UPDATE public.employees
    SET
        account_status = 'rejected',
        is_active = FALSE,
        rejection_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_employee_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        new_data
    )
    VALUES (
        public.current_employee_id(),
        'REGISTRATION_REJECTED',
        'employee',
        p_employee_id,
        jsonb_build_object('account_status', 'rejected', 'reason', p_reason)
    );

    -- Notification au nouvel employé
    INSERT INTO public.notifications (
        recipient_employee_id,
        type,
        title,
        message,
        entity_type,
        entity_id
    )
    VALUES (
        p_employee_id,
        'registration_rejected',
        'Inscription refusée',
        COALESCE('Votre inscription a été refusée par votre responsable : ' || p_reason, 'Votre inscription n''a pas été retenue.'),
        'employee',
        p_employee_id
    );
END;
$$;

-- 4. Permissions d'exécution
GRANT EXECUTE ON FUNCTION public.approve_registration(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_registration(UUID, TEXT) TO authenticated;
