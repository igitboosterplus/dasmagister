-- ============================================================
-- 1. TYPES & STRUCTURES DE BASE
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'push_queue_status') THEN
        CREATE TYPE public.push_queue_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
    employee_id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    missions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    reports_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    requests_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    attendance_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    feedback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_push_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
    status public.push_queue_status NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    processed_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_push_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id UUID NOT NULL REFERENCES public.notification_push_queue(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
    status public.push_queue_status NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_delivery UNIQUE (queue_id, subscription_id)
);

-- ============================================================
-- 2. INDEX & AUTOMATISATION DES UPDATED_AT
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_push_subs_active ON public.push_subscriptions(employee_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_push_del_queue ON public.notification_push_deliveries(queue_id);
CREATE INDEX IF NOT EXISTS idx_notif_del_claim ON public.notification_push_deliveries(status, available_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at BEFORE UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_user_notification_preferences_updated_at ON public.user_notification_preferences;
CREATE TRIGGER trg_user_notification_preferences_updated_at BEFORE UPDATE ON public.user_notification_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_push_deliveries_updated_at ON public.notification_push_deliveries;
CREATE TRIGGER trg_notification_push_deliveries_updated_at BEFORE UPDATE ON public.notification_push_deliveries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. POLICIES RLS
-- ============================================================
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_push_queue ENABLE ROW LEVEL SECURITY; 
ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY; 

DROP POLICY IF EXISTS notif_queue_no_access ON public.notification_push_queue;
CREATE POLICY notif_queue_no_access ON public.notification_push_queue FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS notif_del_no_access ON public.notification_push_deliveries;
CREATE POLICY notif_del_no_access ON public.notification_push_deliveries FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS push_subs_select ON public.push_subscriptions;
CREATE POLICY push_subs_select ON public.push_subscriptions FOR SELECT TO authenticated USING (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS push_subs_insert ON public.push_subscriptions;
CREATE POLICY push_subs_insert ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS push_subs_update ON public.push_subscriptions;
CREATE POLICY push_subs_update ON public.push_subscriptions FOR UPDATE TO authenticated USING (employee_id = public.current_employee_id()) WITH CHECK (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS push_subs_delete ON public.push_subscriptions;
CREATE POLICY push_subs_delete ON public.push_subscriptions FOR DELETE TO authenticated USING (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS notif_pref_select ON public.user_notification_preferences;
CREATE POLICY notif_pref_select ON public.user_notification_preferences FOR SELECT TO authenticated USING (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS notif_pref_insert ON public.user_notification_preferences;
CREATE POLICY notif_pref_insert ON public.user_notification_preferences FOR INSERT TO authenticated WITH CHECK (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS notif_pref_update ON public.user_notification_preferences;
CREATE POLICY notif_pref_update ON public.user_notification_preferences FOR UPDATE TO authenticated USING (employee_id = public.current_employee_id()) WITH CHECK (employee_id = public.current_employee_id());

-- ============================================================
-- 4. SOURCE DE VÉRITÉ : CRÉATION DE LA NOTIFICATION 
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_internal_notification(
    p_recipient_id UUID, p_type TEXT, p_title TEXT, p_message TEXT, p_entity_type TEXT DEFAULT NULL, p_entity_id UUID DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    INSERT INTO public.notifications(recipient_employee_id, type, title, message, entity_type, entity_id)
    VALUES (p_recipient_id, p_type, p_title, p_message, p_entity_type, p_entity_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_internal_notification(UUID, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_internal_notification(UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO postgres, service_role;

-- ============================================================
-- 5. TRIGGER QUEUE MATRICE : FAN-OUT SÉLECTIF D'ÉVÉNEMENT
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_push_notification_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_prefs public.user_notification_preferences%ROWTYPE;
    v_category TEXT;
    v_queue_id UUID;
BEGIN
    SELECT * INTO v_prefs FROM public.user_notification_preferences WHERE employee_id = NEW.recipient_employee_id;
    IF NOT FOUND OR NOT v_prefs.push_enabled THEN RETURN NEW; END IF;

    v_category := split_part(NEW.type, '_', 1);

    IF (v_category = 'mission' AND NOT v_prefs.missions_enabled) THEN RETURN NEW; END IF;
    IF (v_category = 'report' AND NOT v_prefs.reports_enabled) THEN RETURN NEW; END IF;
    IF (v_category = 'absence' AND NOT v_prefs.requests_enabled) THEN RETURN NEW; END IF;
    IF (v_category = 'attendance' AND NOT v_prefs.attendance_enabled) THEN RETURN NEW; END IF;

    -- Création d'intention. Ignore silencieusement le doublon d'UUID grâce à DO NOTHING sans dépendre de variables inexistantes.
    INSERT INTO public.notification_push_queue(notification_id) VALUES (NEW.id)
    ON CONFLICT (notification_id) DO NOTHING;

    SELECT id INTO v_queue_id FROM public.notification_push_queue WHERE notification_id = NEW.id;
    IF v_queue_id IS NULL THEN RETURN NEW; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE employee_id = NEW.recipient_employee_id AND is_active = TRUE) THEN
        UPDATE public.notification_push_queue SET status = 'completed', processed_at = NOW(), last_error = 'No active subscriptions' WHERE id = v_queue_id;
        RETURN NEW;
    END IF;

    INSERT INTO public.notification_push_deliveries(queue_id, subscription_id)
    SELECT v_queue_id, ps.id FROM public.push_subscriptions ps 
    WHERE ps.employee_id = NEW.recipient_employee_id AND ps.is_active = TRUE
    ON CONFLICT (queue_id, subscription_id) DO NOTHING;

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enqueue_push ON public.notifications;
CREATE TRIGGER trg_enqueue_push AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_push_notification_trigger();

-- ============================================================
-- 6. GESTION CONCURRENCE : RPC DE CLAIM ATOMIQUE
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_push_deliveries(
    p_worker_id TEXT, p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.notification_push_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    -- Fix Zombies: On ne réinitialise QUE les timestamps + id worker, le compteur d'attempts reste acquis !
    UPDATE public.notification_push_deliveries
    SET status = 'pending', locked_by = NULL, locked_at = NULL, available_at = NOW(),
        last_error = COALESCE(last_error, 'Zombie worker recovered by Db timeout')
    WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes';

    RETURN QUERY
    UPDATE public.notification_push_deliveries
    SET status = 'processing', locked_by = p_worker_id, locked_at = NOW(), attempts = attempts + 1
    WHERE id IN (
        SELECT id FROM public.notification_push_deliveries
        WHERE status = 'pending' AND available_at <= NOW()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED LIMIT p_limit
    ) RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_push_deliveries(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(TEXT, INTEGER) TO service_role;

-- ============================================================
-- 7. RPC DE RÉSOLUTION POST-PUSH (PROTECTION WORKER OBSOLÈTE & BACKOFF)
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_push_delivery(
    p_delivery_id UUID, p_worker_id TEXT, p_success BOOLEAN, p_error TEXT DEFAULT NULL, p_is_410 BOOLEAN DEFAULT FALSE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_delivery public.notification_push_deliveries%ROWTYPE;
    v_queue_id UUID;
    v_unresolved INTEGER;
BEGIN
    -- On bloque toute altération par un worker obsolète qui se réveille
    SELECT * INTO v_delivery FROM public.notification_push_deliveries 
    WHERE id = p_delivery_id AND status = 'processing' AND locked_by = p_worker_id;

    IF NOT FOUND THEN RETURN; END IF;
    v_queue_id := v_delivery.queue_id;

    IF p_success THEN
        UPDATE public.notification_push_deliveries 
        SET status = 'completed', sent_at = NOW(), last_error = NULL, locked_by = NULL, locked_at = NULL 
        WHERE id = p_delivery_id;
        
        UPDATE public.notification_push_queue SET status = 'processing' WHERE id = v_queue_id AND status = 'pending';
    ELSE
        IF p_is_410 THEN
            UPDATE public.push_subscriptions SET is_active = FALSE WHERE id = v_delivery.subscription_id;
            UPDATE public.notification_push_deliveries SET status = 'failed', locked_by = NULL, locked_at = NULL, last_error = p_error WHERE id = p_delivery_id;
        ELSE
            -- Retry Logic (Max 3 attempts)
            IF v_delivery.attempts >= 3 THEN
                UPDATE public.notification_push_deliveries SET status = 'failed', locked_by = NULL, locked_at = NULL, last_error = p_error WHERE id = p_delivery_id;
            ELSE
                UPDATE public.notification_push_deliveries
                SET status = 'pending', locked_by = NULL, locked_at = NULL, last_error = p_error,
                    available_at = NOW() + (CASE v_delivery.attempts WHEN 1 THEN INTERVAL '30 seconds' WHEN 2 THEN INTERVAL '1 minute' ELSE INTERVAL '5 minutes' END)
                WHERE id = p_delivery_id;
            END IF;
        END IF;
    END IF;

    -- FINALISATION DU QUEUE PARENT : Teste si TOUS les devices liés à l'intention queue_id ont été résolus
    SELECT COUNT(*) INTO v_unresolved FROM public.notification_push_deliveries WHERE queue_id = v_queue_id AND status IN ('pending', 'processing');
    IF v_unresolved = 0 THEN
        UPDATE public.notification_push_queue SET status = 'completed', processed_at = NOW() WHERE id = v_queue_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_push_delivery(UUID, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_push_delivery(UUID, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role;

-- ============================================================
-- 8. TRIGGERS MÉTIER 
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_mission_events() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'assigned' THEN
        PERFORM public.create_internal_notification(NEW.employee_id, 'mission_assigned', 'Nouvelle mission', 'Une nouvelle mission vous a été assignée.', 'mission', NEW.id);
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
            PERFORM public.create_internal_notification(OLD.employee_id, 'mission_cancelled', 'Mission réaffectée', 'Vous avez été retiré de cette mission.', 'mission', NEW.id);
            IF NEW.status = 'assigned' OR NEW.status = 'in_progress' THEN
                PERFORM public.create_internal_notification(NEW.employee_id, 'mission_assigned', 'Nouvelle mission', 'Une mission vous a été réaffectée.', 'mission', NEW.id);
            END IF;
        ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
            IF OLD.status IS DISTINCT FROM 'assigned' AND NEW.status = 'assigned' THEN 
                PERFORM public.create_internal_notification(NEW.employee_id, 'mission_assigned', 'Mission assignée', 'La mission est repassée au statut assigné.', 'mission', NEW.id);
            ELSIF NEW.status = 'cancelled' THEN
                PERFORM public.create_internal_notification(NEW.employee_id, 'mission_cancelled', 'Mission annulée', 'La mission a été annulée.', 'mission', NEW.id);
            END IF;
        ELSIF (NEW.planned_start IS DISTINCT FROM OLD.planned_start OR NEW.title IS DISTINCT FROM OLD.title) THEN
            PERFORM public.create_internal_notification(NEW.employee_id, 'mission_updated', 'Mission modifiée', 'Les détails de votre mission ont été modifiés.', 'mission', NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_missions ON public.missions;
CREATE TRIGGER trg_notify_missions AFTER INSERT OR UPDATE ON public.missions FOR EACH ROW EXECUTE FUNCTION public.notify_mission_events();

CREATE OR REPLACE FUNCTION public.notify_absence_events() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'approved' THEN
            PERFORM public.create_internal_notification(NEW.employee_id, 'absence_approved', 'Demande validée', 'Votre demande d''absence a été approuvée.', 'employee_absence', NEW.id);
        ELSIF NEW.status = 'rejected' THEN
            PERFORM public.create_internal_notification(NEW.employee_id, 'absence_rejected', 'Demande refusée', COALESCE('Refusée : ' || NEW.rejection_reason, 'Votre demande a été refusée.'), 'employee_absence', NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_absences ON public.employee_absences;
CREATE TRIGGER trg_notify_absences AFTER UPDATE ON public.employee_absences FOR EACH ROW EXECUTE FUNCTION public.notify_absence_events();

CREATE OR REPLACE FUNCTION public.notify_report_events() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status IN ('approved', 'validated') THEN
            PERFORM public.create_internal_notification(NEW.author_employee_id, 'report_approved', 'Rapport validé', 'Votre rapport a été validé avec succès.', 'report', NEW.id);
        ELSIF NEW.status = 'rejected' THEN
            PERFORM public.create_internal_notification(NEW.author_employee_id, 'report_rejected', 'Rapport refusé', 'Votre rapport a été refusé.', 'report', NEW.id);
        ELSIF NEW.status = 'returned' THEN
            PERFORM public.create_internal_notification(NEW.author_employee_id, 'report_returned', 'Rapport retourné', 'Votre rapport nécessite votre attention.', 'report', NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_reports ON public.reports;
CREATE TRIGGER trg_notify_reports AFTER UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.notify_report_events();
