-- ============================================================
-- DAS-MAGISTER — Migration pointage GPS prioritaire + IP réseau
-- ============================================================
-- Principe :
--   1. Le GPS est toujours essayé en premier côté client.
--   2. Si le GPS est absent, trop imprécis ou hors périmètre,
--      le RPC peut utiliser l'IP publique du réseau/box du site.
--   3. L'IP de référence n'est JAMAIS fournie par React :
--      elle est lue côté PostgreSQL depuis les en-têtes PostgREST.
--   4. Le SSID Wi-Fi n'est pas utilisé.
--   5. Un pointage totalement hors-ligne sans GPS n'est pas accepté,
--      car son IP ne peut pas être vérifiée au moment de l'événement.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. IP publique autorisée du site
-- ------------------------------------------------------------
ALTER TABLE public.sites
ADD COLUMN IF NOT EXISTS allowed_ip text;

COMMENT ON COLUMN public.sites.allowed_ip IS
'IP publique autorisée du réseau/box du site. Peut être une IPv4/IPv6 ou un CIDR. Le SSID Wi-Fi n''est pas utilisé.';

-- Le SSID reste dans le schéma pour compatibilité, mais n'est
-- volontairement pas utilisé par le système de pointage.
COMMENT ON COLUMN public.sites.wifi_ssid IS
'Champ conservé pour compatibilité historique. NON utilisé pour le pointage.';

COMMENT ON COLUMN public.sites.wifi_required IS
'Active la validation réseau par IP comme solution de secours lorsque la validation GPS échoue.';

-- ------------------------------------------------------------
-- 2. Autoriser la méthode network_ip dans les contraintes
--    CHECK existantes, sans supposer un nom de contrainte.
-- ------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT
            n.nspname AS schema_name,
            c.relname AS table_name,
            con.conname AS constraint_name,
            pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('attendances', 'attendance_events')
          AND con.contype = 'c'
          AND (
              pg_get_constraintdef(con.oid) ILIKE '%check_in_method%'
              OR pg_get_constraintdef(con.oid) ILIKE '%check_out_method%'
              OR pg_get_constraintdef(con.oid) ILIKE '%event_method%'
              OR pg_get_constraintdef(con.oid) ILIKE '%gps_auto%'
          )
          AND pg_get_constraintdef(con.oid) ILIKE '%manual%'
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
            r.schema_name,
            r.table_name,
            r.constraint_name
        );
    END LOOP;
END $$;

-- Recrée les contraintes de méthode avec network_ip.
ALTER TABLE public.attendances
DROP CONSTRAINT IF EXISTS attendances_method_check;

ALTER TABLE public.attendances
ADD CONSTRAINT attendances_method_check
CHECK (
    (check_in_method IS NULL OR check_in_method IN ('manual', 'gps_auto', 'network_ip', 'system', 'manager'))
    AND
    (check_out_method IS NULL OR check_out_method IN ('manual', 'gps_auto', 'network_ip', 'system', 'manager'))
);

ALTER TABLE public.attendance_events
DROP CONSTRAINT IF EXISTS attendance_events_method_check;

ALTER TABLE public.attendance_events
ADD CONSTRAINT attendance_events_method_check
CHECK (
    event_method IN ('manual', 'gps_auto', 'network_ip', 'system', 'manager')
);

-- ------------------------------------------------------------
-- 3. Récupération fiable de l'IP de la requête PostgREST
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_client_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    headers json;
    raw_ip text;
BEGIN
    headers := NULLIF(current_setting('request.headers', true), '')::json;

    IF headers IS NULL THEN
        RETURN NULL;
    END IF;

    -- Supabase/PostgREST documente x-forwarded-for pour l'IP client.
    raw_ip := split_part(
        COALESCE(
            headers->>'x-forwarded-for',
            headers->>'cf-connecting-ip',
            headers->>'x-real-ip',
            ''
        ),
        ',',
        1
    );

    raw_ip := NULLIF(trim(raw_ip), '');

    IF raw_ip IS NULL THEN
        RETURN NULL;
    END IF;

    BEGIN
        RETURN raw_ip::inet;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.request_client_ip() FROM PUBLIC;

-- ------------------------------------------------------------
-- 4. Validation IP d'un site
--    allowed_ip accepte :
--      - une IP simple : 41.202.x.x
--      - un CIDR : 41.202.x.x/24
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.site_ip_matches_request(p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_allowed text;
    v_client_ip inet;
BEGIN
    SELECT NULLIF(trim(allowed_ip), '')
    INTO v_allowed
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = true;

    IF v_allowed IS NULL THEN
        RETURN false;
    END IF;

    v_client_ip := public.request_client_ip();

    IF v_client_ip IS NULL THEN
        RETURN false;
    END IF;

    BEGIN
        IF position('/' IN v_allowed) > 0 THEN
            RETURN v_client_ip <<= v_allowed::cidr;
        END IF;

        RETURN v_client_ip = v_allowed::inet;
    EXCEPTION WHEN OTHERS THEN
        RETURN false;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.site_ip_matches_request(uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- 5. Trouver les sites actifs auxquels l'employé est affecté
--    et dont l'IP correspond à la requête actuelle.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_assigned_sites_by_ip()
RETURNS TABLE (
    site_id uuid,
    site_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_id uuid;
BEGIN
    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    RETURN QUERY
    SELECT
        s.id,
        s.name::text
    FROM public.employee_sites es
    JOIN public.sites s ON s.id = es.site_id
    WHERE es.employee_id = v_employee_id
      AND es.is_active = true
      AND s.is_active = true
      AND s.wifi_required = true
      AND s.allowed_ip IS NOT NULL
      AND public.site_ip_matches_request(s.id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_assigned_sites_by_ip() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_assigned_sites_by_ip() TO authenticated;

-- ------------------------------------------------------------
-- 6. CLOCK IN — GPS prioritaire, IP en secours
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clock_in(
    p_site_id uuid,
    p_latitude double precision,
    p_longitude double precision,
    p_accuracy_m double precision,
    p_occurred_at timestamp with time zone,
    p_client_event_id uuid,
    p_device_recorded_at timestamp with time zone
)
RETURNS public.attendances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_id uuid;
    v_employee public.employees%ROWTYPE;
    v_site public.sites%ROWTYPE;
    v_assignment public.employee_sites%ROWTYPE;
    v_attendance public.attendances%ROWTYPE;
    v_existing_attendance public.attendances%ROWTYPE;
    v_distance_m double precision;
    v_attendance_date date;
    v_day_of_week integer;
    v_schedule public.site_work_schedules%ROWTYPE;
    v_late_minutes integer := 0;
    v_validation_status text := 'valid';
    v_validation_method text := 'manual';
    v_check_in_method text := 'manual';
    v_validation_reason text;
    v_occurred_at timestamptz;
    v_server_now timestamptz := now();
    v_local_time time;
    v_start_with_grace time;
    v_diff interval;
    v_gps_problem text;
    v_gps_valid boolean := false;
    v_network_valid boolean := false;
BEGIN
    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    SELECT * INTO v_employee
    FROM public.employees
    WHERE id = v_employee_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    IF v_employee.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'EMPLOYEE_INACTIVE';
    END IF;

    IF v_employee.account_status::text <> 'active' THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE';
    END IF;

    IF v_employee.structure_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_STRUCTURE_NOT_FOUND';
    END IF;

    SELECT * INTO v_site
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SITE_NOT_FOUND_OR_INACTIVE';
    END IF;

    IF v_site.structure_id <> v_employee.structure_id THEN
        RAISE EXCEPTION 'SITE_NOT_IN_EMPLOYEE_STRUCTURE';
    END IF;

    SELECT * INTO v_assignment
    FROM public.employee_sites
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_ASSIGNED_TO_SITE';
    END IF;

    v_occurred_at := COALESCE(p_occurred_at, v_server_now);

    v_attendance_date := (
        v_occurred_at AT TIME ZONE COALESCE(v_site.timezone, 'Africa/Douala')
    )::date;

    IF p_client_event_id IS NOT NULL THEN
        SELECT a.* INTO v_existing_attendance
        FROM public.attendances a
        INNER JOIN public.attendance_events ae ON ae.attendance_id = a.id
        WHERE ae.client_event_id = p_client_event_id
          AND ae.event_type = 'check_in'
          AND a.employee_id = v_employee_id
        LIMIT 1;

        IF FOUND THEN
            RETURN v_existing_attendance;
        END IF;
    END IF;

    -- ========================================================
    -- GPS : tentative prioritaire
    -- ========================================================
    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND p_accuracy_m IS NOT NULL
       AND v_site.latitude IS NOT NULL
       AND v_site.longitude IS NOT NULL THEN

        IF v_site.max_gps_accuracy_m IS NOT NULL
           AND p_accuracy_m > v_site.max_gps_accuracy_m THEN
            v_gps_problem := 'GPS_ACCURACY_TOO_LOW';
        ELSE
            v_distance_m :=
                6371000 * 2 * ASIN(
                    SQRT(
                        POWER(SIN(RADIANS(p_latitude - v_site.latitude) / 2), 2)
                        + COS(RADIANS(v_site.latitude))
                        * COS(RADIANS(p_latitude))
                        * POWER(SIN(RADIANS(p_longitude - v_site.longitude) / 2), 2)
                    )
                );

            IF v_site.location_radius_m IS NOT NULL
               AND v_distance_m > v_site.location_radius_m THEN
                v_gps_problem := 'GPS_OUTSIDE_SITE';
            ELSE
                v_gps_valid := true;
            END IF;
        END IF;
    ELSE
        v_gps_problem := 'GPS_UNAVAILABLE';
    END IF;

    IF v_gps_valid THEN
        v_validation_method := 'gps_auto';
        v_check_in_method := 'gps_auto';
        v_validation_reason := 'Pointage validé par GPS.';
    ELSE
        -- ====================================================
        -- GPS en échec -> réseau/box par IP
        -- ====================================================
        IF v_site.wifi_required IS TRUE THEN
            v_network_valid := public.site_ip_matches_request(v_site.id);
        END IF;

        IF NOT v_network_valid THEN
            IF v_site.wifi_required IS TRUE
               AND NULLIF(trim(v_site.allowed_ip), '') IS NOT NULL THEN
                RAISE EXCEPTION 'NETWORK_IP_NOT_ALLOWED';
            END IF;

            CASE v_gps_problem
                WHEN 'GPS_ACCURACY_TOO_LOW' THEN
                    RAISE EXCEPTION 'GPS_ACCURACY_TOO_LOW';
                WHEN 'GPS_OUTSIDE_SITE' THEN
                    RAISE EXCEPTION 'GPS_OUTSIDE_SITE';
                ELSE
                    RAISE EXCEPTION 'GPS_REQUIRED';
            END CASE;
        END IF;

        v_validation_method := 'network_ip';
        v_check_in_method := 'network_ip';
        v_validation_reason :=
            'GPS indisponible ou non valide. Pointage validé par l''IP du réseau du site.';
        v_distance_m := NULL;
    END IF;

    SELECT * INTO v_existing_attendance
    FROM public.attendances
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND attendance_date = v_attendance_date
      AND check_in IS NOT NULL
      AND check_out IS NULL
    ORDER BY check_in DESC
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'ALREADY_CLOCKED_IN';
    END IF;

    v_day_of_week := EXTRACT(
        DOW FROM (v_occurred_at AT TIME ZONE COALESCE(v_site.timezone, 'Africa/Douala'))
    )::integer;

    SELECT * INTO v_schedule
    FROM public.site_work_schedules
    WHERE site_id = p_site_id
      AND day_of_week = v_day_of_week
    LIMIT 1;

    IF FOUND AND v_schedule.is_working_day IS NOT TRUE THEN
        RAISE EXCEPTION 'NON_WORKING_DAY';
    END IF;

    IF FOUND AND v_schedule.work_start IS NOT NULL THEN
        v_local_time := (
            v_occurred_at AT TIME ZONE COALESCE(v_site.timezone, 'Africa/Douala')
        )::time;

        v_start_with_grace := v_schedule.work_start + make_interval(
            mins => COALESCE(v_schedule.grace_period_minutes, 0)
        );

        IF v_local_time > v_start_with_grace THEN
            v_diff := v_local_time - v_start_with_grace;
            v_late_minutes := FLOOR(EXTRACT(EPOCH FROM v_diff) / 60)::integer;
            v_validation_status := 'late';
        END IF;
    END IF;

    INSERT INTO public.attendances (
        employee_id, site_id, attendance_date,
        check_in, created_at,
        check_in_latitude, check_in_longitude, check_in_accuracy_m, check_in_distance_m,
        validation_method, validation_status,
        client_timestamp, synced_at,
        attendance_source, is_offline,
        client_event_id, device_recorded_at, server_received_at,
        validated_at, validation_reason, updated_at,
        scheduled_start, scheduled_end,
        late_minutes, attendance_status, check_in_method
    )
    VALUES (
        v_employee_id, p_site_id, v_attendance_date,
        v_occurred_at, v_server_now,
        p_latitude, p_longitude, p_accuracy_m, v_distance_m,
        v_validation_method, v_validation_status,
        p_occurred_at, v_server_now,
        'online'::attendance_source, false,
        p_client_event_id, p_device_recorded_at, v_server_now,
        v_server_now, v_validation_reason, v_server_now,
        v_schedule.work_start, v_schedule.work_end,
        v_late_minutes, 'present', v_check_in_method
    )
    RETURNING * INTO v_attendance;

    INSERT INTO public.attendance_events (
        attendance_id, employee_id, site_id,
        event_type, event_method, occurred_at,
        latitude, longitude, accuracy_m, distance_m,
        is_confirmed, confirmed_at,
        client_event_id, device_recorded_at,
        server_received_at, synced_at,
        metadata, created_at
    )
    VALUES (
        v_attendance.id, v_employee_id, p_site_id,
        'check_in', v_check_in_method, v_occurred_at,
        p_latitude, p_longitude, p_accuracy_m, v_distance_m,
        true, v_server_now,
        p_client_event_id, p_device_recorded_at,
        v_server_now, v_server_now,
        jsonb_build_object(
            'validation_method', v_validation_method,
            'validation_status', v_validation_status,
            'validation_reason', v_validation_reason,
            'late_minutes', v_late_minutes
        ),
        v_server_now
    );

    RETURN v_attendance;
END;
$$;

-- ------------------------------------------------------------
-- 7. CLOCK OUT — même logique GPS -> IP
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clock_out(
    p_site_id uuid,
    p_latitude double precision,
    p_longitude double precision,
    p_accuracy_m double precision,
    p_occurred_at timestamp with time zone,
    p_client_event_id uuid,
    p_device_recorded_at timestamp with time zone
)
RETURNS public.attendances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_id uuid;
    v_employee public.employees%ROWTYPE;
    v_site public.sites%ROWTYPE;
    v_assignment public.employee_sites%ROWTYPE;
    v_attendance public.attendances%ROWTYPE;
    v_existing_attendance public.attendances%ROWTYPE;
    v_distance_m double precision;
    v_attendance_date date;
    v_validation_method text := 'manual';
    v_check_out_method text := 'manual';
    v_validation_reason text;
    v_occurred_at timestamptz;
    v_server_now timestamptz := now();
    v_gps_problem text;
    v_gps_valid boolean := false;
    v_network_valid boolean := false;
BEGIN
    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    SELECT * INTO v_employee
    FROM public.employees
    WHERE id = v_employee_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    IF v_employee.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'EMPLOYEE_INACTIVE';
    END IF;

    IF v_employee.account_status::text <> 'active' THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE';
    END IF;

    SELECT * INTO v_site
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SITE_NOT_FOUND_OR_INACTIVE';
    END IF;

    IF v_site.structure_id <> v_employee.structure_id THEN
        RAISE EXCEPTION 'SITE_NOT_IN_EMPLOYEE_STRUCTURE';
    END IF;

    SELECT * INTO v_assignment
    FROM public.employee_sites
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_ASSIGNED_TO_SITE';
    END IF;

    v_occurred_at := COALESCE(p_occurred_at, v_server_now);

    v_attendance_date := (
        v_occurred_at AT TIME ZONE COALESCE(v_site.timezone, 'Africa/Douala')
    )::date;

    IF p_client_event_id IS NOT NULL THEN
        SELECT a.* INTO v_existing_attendance
        FROM public.attendances a
        INNER JOIN public.attendance_events ae ON ae.attendance_id = a.id
        WHERE ae.client_event_id = p_client_event_id
          AND ae.event_type = 'check_out'
          AND a.employee_id = v_employee_id
        LIMIT 1;

        IF FOUND THEN
            RETURN v_existing_attendance;
        END IF;
    END IF;

    SELECT * INTO v_attendance
    FROM public.attendances
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND check_in IS NOT NULL
      AND check_out IS NULL
    ORDER BY check_in DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_OPEN_ATTENDANCE';
    END IF;

    -- GPS prioritaire.
    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND p_accuracy_m IS NOT NULL
       AND v_site.latitude IS NOT NULL
       AND v_site.longitude IS NOT NULL THEN

        IF v_site.max_gps_accuracy_m IS NOT NULL
           AND p_accuracy_m > v_site.max_gps_accuracy_m THEN
            v_gps_problem := 'GPS_ACCURACY_TOO_LOW';
        ELSE
            v_distance_m :=
                6371000 * 2 * ASIN(
                    SQRT(
                        POWER(SIN(RADIANS(p_latitude - v_site.latitude) / 2), 2)
                        + COS(RADIANS(v_site.latitude))
                        * COS(RADIANS(p_latitude))
                        * POWER(SIN(RADIANS(p_longitude - v_site.longitude) / 2), 2)
                    )
                );

            IF v_site.location_radius_m IS NOT NULL
               AND v_distance_m > v_site.location_radius_m THEN
                v_gps_problem := 'GPS_OUTSIDE_SITE';
            ELSE
                v_gps_valid := true;
            END IF;
        END IF;
    ELSE
        v_gps_problem := 'GPS_UNAVAILABLE';
    END IF;

    IF v_gps_valid THEN
        v_validation_method := 'gps_auto';
        v_check_out_method := 'gps_auto';
        v_validation_reason := 'Départ validé par GPS.';
    ELSE
        IF v_site.wifi_required IS TRUE THEN
            v_network_valid := public.site_ip_matches_request(v_site.id);
        END IF;

        IF NOT v_network_valid THEN
            IF v_site.wifi_required IS TRUE
               AND NULLIF(trim(v_site.allowed_ip), '') IS NOT NULL THEN
                RAISE EXCEPTION 'NETWORK_IP_NOT_ALLOWED';
            END IF;

            CASE v_gps_problem
                WHEN 'GPS_ACCURACY_TOO_LOW' THEN
                    RAISE EXCEPTION 'GPS_ACCURACY_TOO_LOW';
                WHEN 'GPS_OUTSIDE_SITE' THEN
                    RAISE EXCEPTION 'GPS_OUTSIDE_SITE';
                ELSE
                    RAISE EXCEPTION 'GPS_REQUIRED';
            END CASE;
        END IF;

        v_validation_method := 'network_ip';
        v_check_out_method := 'network_ip';
        v_validation_reason :=
            'GPS indisponible ou non valide. Départ validé par l''IP du réseau du site.';
        v_distance_m := NULL;
    END IF;

    UPDATE public.attendances
    SET
        check_out = v_occurred_at,
        check_out_latitude = p_latitude,
        check_out_longitude = p_longitude,
        check_out_accuracy_m = p_accuracy_m,
        check_out_distance_m = v_distance_m,
        check_out_method = v_check_out_method,
        attendance_status = 'completed',
        validation_reason = CASE
            WHEN validation_reason IS NULL THEN v_validation_reason
            ELSE validation_reason || ' ' || v_validation_reason
        END,
        updated_at = v_server_now
    WHERE id = v_attendance.id
    RETURNING * INTO v_attendance;

    INSERT INTO public.attendance_events (
        attendance_id, employee_id, site_id,
        event_type, event_method, occurred_at,
        latitude, longitude, accuracy_m, distance_m,
        is_confirmed, confirmed_at,
        client_event_id, device_recorded_at,
        server_received_at, synced_at,
        metadata, created_at
    )
    VALUES (
        v_attendance.id, v_employee_id, p_site_id,
        'check_out', v_check_out_method, v_occurred_at,
        p_latitude, p_longitude, p_accuracy_m, v_distance_m,
        true, v_server_now,
        p_client_event_id, p_device_recorded_at,
        v_server_now, v_server_now,
        jsonb_build_object(
            'validation_method', v_validation_method,
            'validation_reason', v_validation_reason
        ),
        v_server_now
    );

    RETURN v_attendance;
END;
$$;

-- ------------------------------------------------------------
-- 8. Privilèges RPC
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.clock_in(uuid, double precision, double precision, double precision, timestamptz, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clock_out(uuid, double precision, double precision, double precision, timestamptz, uuid, timestamptz) TO authenticated;

COMMIT;

-- ============================================================
-- Vérifications après migration
-- ============================================================
-- SELECT id, name, wifi_required, allowed_ip FROM public.sites;
-- SELECT public.request_client_ip();
-- SELECT * FROM public.resolve_assigned_sites_by_ip();
-- ============================================================
