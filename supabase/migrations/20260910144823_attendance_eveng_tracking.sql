-- ============================================================
-- ATTENDANCE EVENT TRACKING
-- ============================================================
-- Version : 2026-09-10
--
-- OBJECTIF
-- ------------------------------------------------------------
-- Ajouter :
--   1. attendance_events
--   2. états de présence
--   3. méthodes de pointage
--   4. RPC sécurisées
--   5. RLS
--   6. suivi GPS des sorties / entrées
--   7. support offline
--
-- RÈGLE MÉTIER PRINCIPALE
-- ------------------------------------------------------------
-- Une journée = une attendance.
--
-- Une attendance possède plusieurs événements :
--
-- CLOCK_IN
-- SITE_EXIT
-- SITE_ENTER
-- CLOCK_OUT
--
-- Une sortie >= 6 minutes devient une sortie confirmée.
--
-- Une sortie prolongée pendant la fin de journée peut
-- déclencher automatiquement CLOCK_OUT.
--
-- L'heure officielle du départ automatique est l'heure
-- réelle de sortie du périmètre, PAS l'heure de confirmation.
-- ============================================================


BEGIN;


-- ============================================================
-- 1. EXTENSIONS / UTILITAIRES
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 2. COLONNES COMPLÉMENTAIRES SUR SITES
-- ============================================================
--
-- Ton modèle actuel possède déjà normalement ces champs.
-- IF NOT EXISTS permet de rendre la migration plus tolérante.
-- ============================================================

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS location_radius_m DOUBLE PRECISION
        DEFAULT 100;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS max_gps_accuracy_m DOUBLE PRECISION
        DEFAULT 100;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS gps_required BOOLEAN
        DEFAULT TRUE;


-- ============================================================
-- 3. COLONNES D'ÉTAT SUR ATTENDANCES
-- ============================================================

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS scheduled_start TIME;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS scheduled_end TIME;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS late_minutes INTEGER
        DEFAULT 0;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS attendance_status TEXT
        DEFAULT 'present';

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_in_method TEXT;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_out_method TEXT;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS monitoring_started_at TIMESTAMPTZ;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS monitoring_last_seen_at TIMESTAMPTZ;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS monitoring_last_latitude DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS monitoring_last_longitude DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS monitoring_last_accuracy_m DOUBLE PRECISION;


-- ============================================================
-- 4. CONTRAINTES ATTENDANCE
-- ============================================================

ALTER TABLE public.attendances
    DROP CONSTRAINT IF EXISTS attendances_status_check;

ALTER TABLE public.attendances
    ADD CONSTRAINT attendances_status_check
    CHECK (
        attendance_status IS NULL
        OR attendance_status IN (
            'not_started',
            'present',
            'completed',
            'missing_departure'
        )
    );


ALTER TABLE public.attendances
    DROP CONSTRAINT IF EXISTS attendances_method_check;

ALTER TABLE public.attendances
    ADD CONSTRAINT attendances_method_check
    CHECK (
        check_in_method IS NULL
        OR check_in_method IN (
            'manual',
            'gps_auto',
            'system',
            'manager'
        )
    );


ALTER TABLE public.attendances
    DROP CONSTRAINT IF EXISTS attendances_checkout_method_check;

ALTER TABLE public.attendances
    ADD CONSTRAINT attendances_checkout_method_check
    CHECK (
        check_out_method IS NULL
        OR check_out_method IN (
            'manual',
            'gps_auto',
            'system',
            'manager'
        )
    );


-- ============================================================
-- 5. ATTENDANCE EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_events (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    attendance_id UUID NOT NULL
        REFERENCES public.attendances(id)
        ON DELETE CASCADE,

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    site_id UUID NOT NULL
        REFERENCES public.sites(id)
        ON DELETE RESTRICT,


    -- --------------------------------------------------------
    -- Type d'événement
    -- --------------------------------------------------------

    event_type TEXT NOT NULL
        CHECK (
            event_type IN (
                'CLOCK_IN',
                'SITE_EXIT',
                'SITE_ENTER',
                'CLOCK_OUT'
            )
        ),


    -- --------------------------------------------------------
    -- Méthode/source de l'événement
    -- --------------------------------------------------------

    event_method TEXT NOT NULL DEFAULT 'manual'
        CHECK (
            event_method IN (
                'manual',
                'gps_auto',
                'system',
                'manager'
            )
        ),


    -- --------------------------------------------------------
    -- Moment réel où l'événement s'est produit
    -- --------------------------------------------------------

    occurred_at TIMESTAMPTZ NOT NULL,


    -- --------------------------------------------------------
    -- Informations GPS
    -- --------------------------------------------------------

    latitude DOUBLE PRECISION,

    longitude DOUBLE PRECISION,

    accuracy_m DOUBLE PRECISION,

    distance_m DOUBLE PRECISION,


    -- --------------------------------------------------------
    -- Confirmation d'une sortie prolongée
    -- --------------------------------------------------------

    is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,

    confirmed_at TIMESTAMPTZ,


    -- --------------------------------------------------------
    -- Synchronisation offline
    -- --------------------------------------------------------

    client_event_id UUID,

    device_recorded_at TIMESTAMPTZ,

    server_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    synced_at TIMESTAMPTZ,


    -- --------------------------------------------------------
    -- Métadonnées
    -- --------------------------------------------------------

    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 6. INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_attendance_events_attendance
ON public.attendance_events(attendance_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_attendance_events_employee
ON public.attendance_events(employee_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_attendance_events_site
ON public.attendance_events(site_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_attendance_events_type
ON public.attendance_events(event_type);

CREATE UNIQUE INDEX IF NOT EXISTS
idx_attendance_events_client_event_id
ON public.attendance_events(client_event_id)
WHERE client_event_id IS NOT NULL;


-- ============================================================
-- 7. FONCTION : DISTANCE GPS
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_distance_meters(
    p_lat1 DOUBLE PRECISION,
    p_lon1 DOUBLE PRECISION,
    p_lat2 DOUBLE PRECISION,
    p_lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_radius CONSTANT DOUBLE PRECISION := 6371000;
    v_dlat DOUBLE PRECISION;
    v_dlon DOUBLE PRECISION;
    v_a DOUBLE PRECISION;
BEGIN

    IF p_lat1 IS NULL
       OR p_lon1 IS NULL
       OR p_lat2 IS NULL
       OR p_lon2 IS NULL
    THEN
        RETURN NULL;
    END IF;

    v_dlat := radians(p_lat2 - p_lat1);
    v_dlon := radians(p_lon2 - p_lon1);

    v_a :=
        sin(v_dlat / 2) ^ 2
        +
        cos(radians(p_lat1))
        *
        cos(radians(p_lat2))
        *
        sin(v_dlon / 2) ^ 2;

    RETURN
        v_radius
        *
        2
        *
        atan2(
            sqrt(v_a),
            sqrt(1 - v_a)
        );

END;
$$;


-- ============================================================
-- 8. FONCTION : SITE DU JOUR
-- ============================================================
--
-- IMPORTANT :
-- L'employé ne choisit plus librement son site.
--
-- Priorité :
--
--   1. employee.site_id
--   2. unique employee_sites actif
--
-- Si plusieurs sites sont actifs sans site principal,
-- on refuse le pointage plutôt que de choisir arbitrairement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_attendance_site()
RETURNS TABLE (
    site_id UUID,
    site_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_radius_m DOUBLE PRECISION,
    max_gps_accuracy_m DOUBLE PRECISION,
    gps_required BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee public.employees;
    v_count INTEGER;
BEGIN

    SELECT *
    INTO v_employee
    FROM public.employees
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_employee.id IS NULL THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    IF NOT v_employee.is_active THEN
        RAISE EXCEPTION 'Employee account is inactive';
    END IF;


    -- --------------------------------------------------------
    -- Site principal
    -- --------------------------------------------------------

    IF v_employee.site_id IS NOT NULL THEN

        RETURN QUERY
        SELECT
            s.id,
            s.name::TEXT,
            s.latitude,
            s.longitude,
            COALESCE(s.location_radius_m, 100),
            COALESCE(s.max_gps_accuracy_m, 100),
            COALESCE(s.gps_required, TRUE)
        FROM public.sites s
        WHERE s.id = v_employee.site_id;

        RETURN;
    END IF;


    -- --------------------------------------------------------
    -- Site via employee_sites
    -- --------------------------------------------------------

    SELECT COUNT(*)
    INTO v_count
    FROM public.employee_sites es
    WHERE es.employee_id = v_employee.id
      AND es.is_active = TRUE;


    IF v_count = 0 THEN
        RAISE EXCEPTION 'No active work site assigned';
    END IF;


    IF v_count > 1 THEN
        RAISE EXCEPTION
            'Multiple active sites assigned. A work site must be determined before clock-in';
    END IF;


    RETURN QUERY
    SELECT
        s.id,
        s.name::TEXT,
        s.latitude,
        s.longitude,
        COALESCE(s.location_radius_m, 100),
        COALESCE(s.max_gps_accuracy_m, 100),
        COALESCE(s.gps_required, TRUE)
    FROM public.employee_sites es
    INNER JOIN public.sites s
        ON s.id = es.site_id
    WHERE es.employee_id = v_employee.id
      AND es.is_active = TRUE
    LIMIT 1;

END;
$$;


-- ============================================================
-- 9. FONCTION : HORAIRE DU JOUR
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_work_schedule(
    p_site_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    work_start TIME,
    work_end TIME,
    grace_period_minutes INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_day SMALLINT;
BEGIN

    /*
     * PostgreSQL :
     * 0 = dimanche
     * 1 = lundi
     * ...
     * 6 = samedi
     */

    v_day := EXTRACT(DOW FROM p_date);


    RETURN QUERY
    SELECT
        sws.work_start,
        sws.work_end,
        COALESCE(sws.grace_period_minutes, 0)
    FROM public.site_work_schedules sws
    WHERE sws.site_id = p_site_id
      AND sws.day_of_week = v_day
      AND sws.is_working_day = TRUE
    LIMIT 1;

END;
$$;


-- ============================================================
-- 10. RPC : CLOCK IN
-- ============================================================

CREATE OR REPLACE FUNCTION public.clock_in(
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
    p_client_event_id UUID DEFAULT NULL,
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.attendances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_employee public.employees;

    v_site_id UUID;
    v_site_name TEXT;
    v_site_lat DOUBLE PRECISION;
    v_site_lon DOUBLE PRECISION;
    v_radius DOUBLE PRECISION;
    v_max_accuracy DOUBLE PRECISION;
    v_gps_required BOOLEAN;

    v_work_start TIME;
    v_work_end TIME;
    v_grace INTEGER;

    v_distance DOUBLE PRECISION;

    v_attendance public.attendances;

    v_late INTEGER := 0;

    v_status TEXT := 'present';

BEGIN

    -- --------------------------------------------------------
    -- Employé connecté
    -- --------------------------------------------------------

    SELECT *
    INTO v_employee
    FROM public.employees
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_employee.id IS NULL THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    IF NOT v_employee.is_active THEN
        RAISE EXCEPTION 'Employee account is inactive';
    END IF;


    -- --------------------------------------------------------
    -- Site du jour
    -- --------------------------------------------------------

    SELECT
        x.site_id,
        x.site_name,
        x.latitude,
        x.longitude,
        x.location_radius_m,
        x.max_gps_accuracy_m,
        x.gps_required
    INTO
        v_site_id,
        v_site_name,
        v_site_lat,
        v_site_lon,
        v_radius,
        v_max_accuracy,
        v_gps_required
    FROM public.get_my_attendance_site() x;


    -- --------------------------------------------------------
    -- GPS obligatoire
    -- --------------------------------------------------------

    IF v_gps_required
       AND (
            p_latitude IS NULL
            OR p_longitude IS NULL
       )
    THEN
        RAISE EXCEPTION
            'GPS location is required for this site';
    END IF;


    -- --------------------------------------------------------
    -- Précision GPS
    -- --------------------------------------------------------

    IF p_accuracy_m IS NOT NULL
       AND p_accuracy_m > v_max_accuracy
    THEN

        RAISE EXCEPTION
            'GPS accuracy is insufficient: % meters',
            ROUND(p_accuracy_m::numeric, 1);

    END IF;


    -- --------------------------------------------------------
    -- Distance
    -- --------------------------------------------------------

    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND v_site_lat IS NOT NULL
       AND v_site_lon IS NOT NULL
    THEN

        v_distance :=
            public.calculate_distance_meters(
                p_latitude,
                p_longitude,
                v_site_lat,
                v_site_lon
            );

        IF v_distance > v_radius THEN
            RAISE EXCEPTION
                'You are outside the authorized site perimeter: % meters',
                ROUND(v_distance::numeric, 1);
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Vérification doublon
    -- --------------------------------------------------------

    SELECT *
    INTO v_attendance
    FROM public.attendances
    WHERE employee_id = v_employee.id
      AND attendance_date = (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE
    FOR UPDATE;


    IF v_attendance.id IS NOT NULL THEN

        IF v_attendance.check_in IS NOT NULL THEN
            RAISE EXCEPTION
                'Attendance already started for today';
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Horaire
    -- --------------------------------------------------------

    SELECT
        s.work_start,
        s.work_end,
        s.grace_period_minutes
    INTO
        v_work_start,
        v_work_end,
        v_grace
    FROM public.get_my_work_schedule(
        v_site_id,
        (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE
    ) s
    LIMIT 1;


    -- --------------------------------------------------------
    -- Calcul retard
    -- --------------------------------------------------------

    IF v_work_start IS NOT NULL THEN

        IF p_occurred_at::TIME > v_work_start THEN

            v_late :=
                GREATEST(
                    0,
                    EXTRACT(
                        EPOCH FROM (
                            p_occurred_at::TIME - v_work_start
                        )
                    ) / 60
                )::INTEGER;

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- Création / mise à jour attendance
    -- --------------------------------------------------------

    IF v_attendance.id IS NULL THEN

        INSERT INTO public.attendances (
            employee_id,
            site_id,
            attendance_date,
            check_in,
            check_in_latitude,
            check_in_longitude,
            check_in_accuracy_m,
            check_in_distance_m,
            attendance_status,
            late_minutes,
            check_in_method,
            client_event_id,
            client_timestamp,
            device_recorded_at,
            server_received_at,
            is_offline,
            updated_at
        )
        VALUES (
            v_employee.id,
            v_site_id,
            (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE,
            p_occurred_at,
            p_latitude,
            p_longitude,
            p_accuracy_m,
            v_distance,
            v_status,
            v_late,
            'manual',
            p_client_event_id,
            p_occurred_at,
            p_device_recorded_at,
            NOW(),
            FALSE,
            NOW()
        )
        RETURNING *
        INTO v_attendance;

    ELSE

        UPDATE public.attendances
        SET
            check_in = p_occurred_at,
            check_in_latitude = p_latitude,
            check_in_longitude = p_longitude,
            check_in_accuracy_m = p_accuracy_m,
            check_in_distance_m = v_distance,
            attendance_status = v_status,
            late_minutes = v_late,
            check_in_method = 'manual',
            client_event_id = p_client_event_id,
            client_timestamp = p_occurred_at,
            device_recorded_at = p_device_recorded_at,
            server_received_at = NOW(),
            is_offline = FALSE,
            updated_at = NOW()
        WHERE id = v_attendance.id
        RETURNING *
        INTO v_attendance;

    END IF;


    -- --------------------------------------------------------
    -- Sauvegarde horaire
    -- --------------------------------------------------------

    UPDATE public.attendances
    SET
        scheduled_start = v_work_start,
        scheduled_end = v_work_end
    WHERE id = v_attendance.id;


    -- --------------------------------------------------------
    -- Événement CLOCK_IN
    -- --------------------------------------------------------

    INSERT INTO public.attendance_events (
        attendance_id,
        employee_id,
        site_id,
        event_type,
        event_method,
        occurred_at,
        latitude,
        longitude,
        accuracy_m,
        distance_m,
        is_confirmed,
        client_event_id,
        device_recorded_at,
        server_received_at,
        synced_at
    )
    VALUES (
        v_attendance.id,
        v_employee.id,
        v_site_id,
        'CLOCK_IN',
        'manual',
        p_occurred_at,
        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance,
        TRUE,
        p_client_event_id,
        p_device_recorded_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (client_event_id)
    WHERE client_event_id IS NOT NULL
    DO NOTHING;


    RETURN v_attendance;

END;
$$;


-- ============================================================
-- 11. RPC : ENREGISTRER SORTIE DU SITE
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_site_exit(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
    p_client_event_id UUID DEFAULT NULL,
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.attendance_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_employee_id UUID;
    v_attendance public.attendances;
    v_site public.sites;

    v_distance DOUBLE PRECISION;
    v_event public.attendance_events;

BEGIN

    SELECT public.current_employee_id()
    INTO v_employee_id;


    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;


    -- --------------------------------------------------------
    -- Attendance active
    -- --------------------------------------------------------

    SELECT *
    INTO v_attendance
    FROM public.attendances
    WHERE employee_id = v_employee_id
      AND attendance_date =
            (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE
    FOR UPDATE;


    IF v_attendance.id IS NULL THEN
        RAISE EXCEPTION
            'No attendance found for today';
    END IF;


    IF v_attendance.check_in IS NULL THEN
        RAISE EXCEPTION
            'Employee has not clocked in';
    END IF;


    IF v_attendance.check_out IS NOT NULL THEN
        RAISE EXCEPTION
            'Attendance is already completed';
    END IF;


    SELECT *
    INTO v_site
    FROM public.sites
    WHERE id = v_attendance.site_id;


    -- --------------------------------------------------------
    -- Distance
    -- --------------------------------------------------------

    v_distance :=
        public.calculate_distance_meters(
            p_latitude,
            p_longitude,
            v_site.latitude,
            v_site.longitude
        );


    -- --------------------------------------------------------
    -- Création événement
    -- --------------------------------------------------------

    INSERT INTO public.attendance_events (
        attendance_id,
        employee_id,
        site_id,
        event_type,
        event_method,
        occurred_at,
        latitude,
        longitude,
        accuracy_m,
        distance_m,
        is_confirmed,
        client_event_id,
        device_recorded_at,
        server_received_at,
        synced_at
    )
    VALUES (
        v_attendance.id,
        v_employee_id,
        v_attendance.site_id,
        'SITE_EXIT',
        'gps_auto',
        p_occurred_at,
        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance,
        FALSE,
        p_client_event_id,
        p_device_recorded_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (client_event_id)
    WHERE client_event_id IS NOT NULL
    DO UPDATE
    SET id = public.attendance_events.id
    RETURNING *
    INTO v_event;


    UPDATE public.attendances
    SET
        monitoring_last_seen_at = p_occurred_at,
        monitoring_last_latitude = p_latitude,
        monitoring_last_longitude = p_longitude,
        monitoring_last_accuracy_m = p_accuracy_m,
        updated_at = NOW()
    WHERE id = v_attendance.id;


    RETURN v_event;

END;
$$;


-- ============================================================
-- 12. RPC : CONFIRMER SORTIE PROLONGÉE
-- ============================================================
--
-- Cette RPC est appelée après les 6 minutes.
--
-- IMPORTANT :
-- l'heure de sortie reste occurred_at.
--
-- Exemple :
--
-- 16:52 SITE_EXIT
-- 16:58 confirmation
--
-- le départ éventuel sera :
--
-- 16:52
--
-- et NON 16:58.
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_site_exit(
    p_event_id UUID,
    p_confirmed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS public.attendance_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_event public.attendance_events;
    v_attendance public.attendances;

    v_duration_seconds DOUBLE PRECISION;

    v_end_time TIME;

    v_employee_id UUID;

BEGIN

    SELECT public.current_employee_id()
    INTO v_employee_id;


    SELECT *
    INTO v_event
    FROM public.attendance_events
    WHERE id = p_event_id
      AND employee_id = v_employee_id
      AND event_type = 'SITE_EXIT'
    FOR UPDATE;


    IF v_event.id IS NULL THEN
        RAISE EXCEPTION
            'Site exit event not found';
    END IF;


    IF v_event.is_confirmed THEN
        RETURN v_event;
    END IF;


    v_duration_seconds :=
        EXTRACT(
            EPOCH FROM (
                p_confirmed_at - v_event.occurred_at
            )
        );


    IF v_duration_seconds < 360 THEN
        RAISE EXCEPTION
            'Exit must remain outside for at least 6 minutes';
    END IF;


    UPDATE public.attendance_events
    SET
        is_confirmed = TRUE,
        confirmed_at = p_confirmed_at
    WHERE id = v_event.id
    RETURNING *
    INTO v_event;


    -- --------------------------------------------------------
    -- Vérification fin de journée
    -- --------------------------------------------------------

    SELECT *
    INTO v_attendance
    FROM public.attendances
    WHERE id = v_event.attendance_id
    FOR UPDATE;


    v_end_time := v_attendance.scheduled_end;


    /*
     * Une sortie pendant la journée ne termine PAS
     * automatiquement la journée.
     *
     * Elle peut uniquement clôturer la journée lorsqu'elle
     * intervient à proximité de l'heure de fin.
     *
     * Ici : à partir de 30 minutes avant l'heure prévue.
     */

    IF v_end_time IS NOT NULL
       AND v_event.occurred_at::TIME >=
           (v_end_time - INTERVAL '30 minutes')
    THEN

        UPDATE public.attendances
        SET
            check_out = v_event.occurred_at,
            check_out_latitude = v_event.latitude,
            check_out_longitude = v_event.longitude,
            check_out_accuracy_m = v_event.accuracy_m,
            check_out_distance_m = v_event.distance_m,
            check_out_method = 'gps_auto',
            attendance_status = 'completed',
            updated_at = NOW()
        WHERE id = v_attendance.id
          AND check_out IS NULL;

        INSERT INTO public.attendance_events (
            attendance_id,
            employee_id,
            site_id,
            event_type,
            event_method,
            occurred_at,
            latitude,
            longitude,
            accuracy_m,
            distance_m,
            is_confirmed,
            confirmed_at,
            server_received_at,
            synced_at,
            metadata
        )
        SELECT
            v_attendance.id,
            v_employee_id,
            v_attendance.site_id,
            'CLOCK_OUT',
            'gps_auto',
            v_event.occurred_at,
            v_event.latitude,
            v_event.longitude,
            v_event.accuracy_m,
            v_event.distance_m,
            TRUE,
            p_confirmed_at,
            NOW(),
            NOW(),
            jsonb_build_object(
                'reason', 'prolonged_site_exit',
                'source_exit_event_id', v_event.id,
                'confirmation_delay_seconds',
                v_duration_seconds
            )
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.attendance_events ae
            WHERE ae.attendance_id = v_attendance.id
              AND ae.event_type = 'CLOCK_OUT'
        );

    END IF;


    RETURN v_event;

END;
$$;


-- ============================================================
-- 13. RPC : ENREGISTRER RETOUR SUR SITE
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_site_enter(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
    p_client_event_id UUID DEFAULT NULL,
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.attendance_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_employee_id UUID;
    v_attendance public.attendances;
    v_site public.sites;

    v_distance DOUBLE PRECISION;
    v_last_exit public.attendance_events;

    v_event public.attendance_events;

BEGIN

    SELECT public.current_employee_id()
    INTO v_employee_id;


    SELECT *
    INTO v_attendance
    FROM public.attendances
    WHERE employee_id = v_employee_id
      AND attendance_date =
            (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE
    FOR UPDATE;


    IF v_attendance.id IS NULL THEN
        RAISE EXCEPTION
            'No attendance found';
    END IF;


    IF v_attendance.check_out IS NOT NULL THEN
        RAISE EXCEPTION
            'Attendance already completed';
    END IF;


    SELECT *
    INTO v_site
    FROM public.sites
    WHERE id = v_attendance.site_id;


    v_distance :=
        public.calculate_distance_meters(
            p_latitude,
            p_longitude,
            v_site.latitude,
            v_site.longitude
        );


    SELECT *
    INTO v_last_exit
    FROM public.attendance_events
    WHERE attendance_id = v_attendance.id
      AND event_type = 'SITE_EXIT'
      AND occurred_at <= p_occurred_at
    ORDER BY occurred_at DESC
    LIMIT 1;


    INSERT INTO public.attendance_events (
        attendance_id,
        employee_id,
        site_id,
        event_type,
        event_method,
        occurred_at,
        latitude,
        longitude,
        accuracy_m,
        distance_m,
        is_confirmed,
        client_event_id,
        device_recorded_at,
        server_received_at,
        synced_at,
        metadata
    )
    VALUES (
        v_attendance.id,
        v_employee_id,
        v_attendance.site_id,
        'SITE_ENTER',
        'gps_auto',
        p_occurred_at,
        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance,
        TRUE,
        p_client_event_id,
        p_device_recorded_at,
        NOW(),
        NOW(),
        jsonb_build_object(
            'previous_exit_event_id',
            v_last_exit.id
        )
    )
    ON CONFLICT (client_event_id)
    WHERE client_event_id IS NOT NULL
    DO UPDATE
    SET id = public.attendance_events.id
    RETURNING *
    INTO v_event;


    UPDATE public.attendances
    SET
        monitoring_last_seen_at = p_occurred_at,
        monitoring_last_latitude = p_latitude,
        monitoring_last_longitude = p_longitude,
        monitoring_last_accuracy_m = p_accuracy_m,
        updated_at = NOW()
    WHERE id = v_attendance.id;


    RETURN v_event;

END;
$$;


-- ============================================================
-- 14. RPC : CLOCK OUT MANUEL
-- ============================================================

CREATE OR REPLACE FUNCTION public.clock_out(
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NOW(),
    p_client_event_id UUID DEFAULT NULL,
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.attendances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_employee_id UUID;
    v_attendance public.attendances;
    v_site public.sites;

    v_distance DOUBLE PRECISION;

BEGIN

    SELECT public.current_employee_id()
    INTO v_employee_id;


    SELECT *
    INTO v_attendance
    FROM public.attendances
    WHERE employee_id = v_employee_id
      AND attendance_date =
            (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE
    FOR UPDATE;


    IF v_attendance.id IS NULL THEN
        RAISE EXCEPTION
            'No attendance found for today';
    END IF;


    IF v_attendance.check_in IS NULL THEN
        RAISE EXCEPTION
            'Employee has not clocked in';
    END IF;


    IF v_attendance.check_out IS NOT NULL THEN
        RAISE EXCEPTION
            'Attendance already completed';
    END IF;


    SELECT *
    INTO v_site
    FROM public.sites
    WHERE id = v_attendance.site_id;


    v_distance :=
        public.calculate_distance_meters(
            p_latitude,
            p_longitude,
            v_site.latitude,
            v_site.longitude
        );


    UPDATE public.attendances
    SET
        check_out = p_occurred_at,
        check_out_latitude = p_latitude,
        check_out_longitude = p_longitude,
        check_out_accuracy_m = p_accuracy_m,
        check_out_distance_m = v_distance,
        check_out_method = 'manual',
        attendance_status = 'completed',
        client_timestamp = p_occurred_at,
        device_recorded_at = p_device_recorded_at,
        server_received_at = NOW(),
        updated_at = NOW()
    WHERE id = v_attendance.id
    RETURNING *
    INTO v_attendance;


    INSERT INTO public.attendance_events (
        attendance_id,
        employee_id,
        site_id,
        event_type,
        event_method,
        occurred_at,
        latitude,
        longitude,
        accuracy_m,
        distance_m,
        is_confirmed,
        client_event_id,
        device_recorded_at,
        server_received_at,
        synced_at
    )
    VALUES (
        v_attendance.id,
        v_employee_id,
        v_attendance.site_id,
        'CLOCK_OUT',
        'manual',
        p_occurred_at,
        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance,
        TRUE,
        p_client_event_id,
        p_device_recorded_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (client_event_id)
    WHERE client_event_id IS NOT NULL
    DO NOTHING;


    RETURN v_attendance;

END;
$$;


-- ============================================================
-- 15. RLS ATTENDANCE EVENTS
-- ============================================================

ALTER TABLE public.attendance_events
ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- Employé : voir ses événements
-- ------------------------------------------------------------

DROP POLICY IF EXISTS
    "employee_can_view_own_attendance_events"
ON public.attendance_events;

CREATE POLICY
    "employee_can_view_own_attendance_events"
ON public.attendance_events
FOR SELECT
TO authenticated
USING (
    employee_id = public.current_employee_id()
);


-- ------------------------------------------------------------
-- Manager : voir les événements de sa structure
-- ------------------------------------------------------------

DROP POLICY IF EXISTS
    "manager_can_view_structure_attendance_events"
ON public.attendance_events;

CREATE POLICY
    "manager_can_view_structure_attendance_events"
ON public.attendance_events
FOR SELECT
TO authenticated
USING (
    public.has_role('manager')
    AND EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id = attendance_events.employee_id
          AND e.structure_id = public.current_structure_id()
    )
);


-- ------------------------------------------------------------
-- Admin : tout voir
-- ------------------------------------------------------------

DROP POLICY IF EXISTS
    "admin_can_view_all_attendance_events"
ON public.attendance_events;

CREATE POLICY
    "admin_can_view_all_attendance_events"
ON public.attendance_events
FOR SELECT
TO authenticated
USING (
    public.has_role('admin')
);


-- ============================================================
-- 16. IMPORTANT :
-- PAS D'INSERT/UPDATE DIRECT VIA RLS
-- ============================================================
--
-- Les événements doivent être créés par les RPC SECURITY DEFINER.
--
-- Cela évite qu'un utilisateur fasse directement :
--
-- INSERT attendance_events
-- event_type = CLOCK_OUT
-- occurred_at = demain
--
-- ============================================================


-- ============================================================
-- 17. DROITS RPC
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_my_attendance_site()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_my_attendance_site()
TO authenticated;


REVOKE ALL
ON FUNCTION public.get_my_work_schedule(UUID, DATE)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_my_work_schedule(UUID, DATE)
TO authenticated;


REVOKE ALL
ON FUNCTION public.clock_in(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.clock_in(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


REVOKE ALL
ON FUNCTION public.record_site_exit(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.record_site_exit(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


REVOKE ALL
ON FUNCTION public.confirm_site_exit(UUID, TIMESTAMPTZ)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.confirm_site_exit(UUID, TIMESTAMPTZ)
TO authenticated;


REVOKE ALL
ON FUNCTION public.record_site_enter(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.record_site_enter(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


REVOKE ALL
ON FUNCTION public.clock_out(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.clock_out(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


-- ============================================================
-- 18. TRIGGER UPDATED_AT
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_attendance_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
    trg_attendance_updated_at
ON public.attendances;


CREATE TRIGGER
    trg_attendance_updated_at
BEFORE UPDATE ON public.attendances
FOR EACH ROW
EXECUTE FUNCTION public.update_attendance_updated_at();


COMMIT;