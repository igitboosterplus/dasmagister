-- ============================================================
-- MIGRATION : POSTE RESPONSABLE RH (MAGISTÈRE & MULTI-SITES)
-- 1. Détection automatique du poste Responsable RH
-- 2. Autorisation de pointage itinérant sur tous les sites de sa structure
-- 3. Synchronisation et bypass des restrictions d'affectation unique
-- ============================================================

-- 1. Helper : Vérifier si un employé a le poste Responsable RH
CREATE OR REPLACE FUNCTION public.is_responsable_rh(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pos_name text;
BEGIN
    IF p_employee_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT p.name INTO v_pos_name
    FROM public.employees e
    JOIN public.positions p ON p.id = e.position_id
    WHERE e.id = p_employee_id;

    IF v_pos_name IS NULL THEN
        RETURN false;
    END IF;

    RETURN (
        LOWER(TRIM(v_pos_name)) = 'responsable rh'
        OR LOWER(TRIM(v_pos_name)) ILIKE '%responsable rh%'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_responsable_rh(uuid) TO authenticated;

-- 2. Synchronisation proactive des sites pour les Responsables RH
CREATE OR REPLACE FUNCTION public.sync_responsable_rh_sites()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.employee_sites (employee_id, site_id, is_active, is_responsible)
    SELECT e.id, s.id, true, false
    FROM public.employees e
    JOIN public.positions p ON p.id = e.position_id
    JOIN public.sites s ON s.structure_id = e.structure_id
    WHERE (LOWER(TRIM(p.name)) = 'responsable rh' OR LOWER(TRIM(p.name)) ILIKE '%responsable rh%')
      AND e.is_active = true
      AND s.is_active = true
    ON CONFLICT (employee_id, site_id) DO UPDATE SET is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_responsable_rh_sites() TO authenticated;

-- Trigger sur employees : sync quand un employé prend le poste Responsable RH
CREATE OR REPLACE FUNCTION public.trg_sync_rh_on_employee_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (NEW.position_id IS NOT NULL AND NEW.structure_id IS NOT NULL) THEN
        IF public.is_responsable_rh(NEW.id) THEN
            INSERT INTO public.employee_sites (employee_id, site_id, is_active, is_responsible)
            SELECT NEW.id, s.id, true, false
            FROM public.sites s
            WHERE s.structure_id = NEW.structure_id
              AND s.is_active = true
            ON CONFLICT (employee_id, site_id) DO UPDATE SET is_active = true;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_rh_sync ON public.employees;
CREATE TRIGGER trg_employee_rh_sync
AFTER INSERT OR UPDATE OF position_id, structure_id, is_active ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_rh_on_employee_change();

-- Trigger sur sites : sync quand un nouveau site est créé pour le Responsable RH de cette structure
CREATE OR REPLACE FUNCTION public.trg_sync_rh_on_site_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (NEW.structure_id IS NOT NULL AND NEW.is_active = true) THEN
        INSERT INTO public.employee_sites (employee_id, site_id, is_active, is_responsible)
        SELECT e.id, NEW.id, true, false
        FROM public.employees e
        JOIN public.positions p ON p.id = e.position_id
        WHERE e.structure_id = NEW.structure_id
          AND e.is_active = true
          AND (LOWER(TRIM(p.name)) = 'responsable rh' OR LOWER(TRIM(p.name)) ILIKE '%responsable rh%')
        ON CONFLICT (employee_id, site_id) DO UPDATE SET is_active = true;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_site_rh_sync ON public.sites;
CREATE TRIGGER trg_site_rh_sync
AFTER INSERT OR UPDATE OF structure_id, is_active ON public.sites
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_rh_on_site_change();

-- 3. Mise à jour de CLOCK IN avec support Responsable RH itinérant
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
    v_is_rh boolean := false;
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

    v_is_rh := public.is_responsable_rh(v_employee_id);

    SELECT * INTO v_assignment
    FROM public.employee_sites
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        -- Si Responsable RH : autoriser automatiquement le pointage itinérant sur tout site de sa structure
        IF v_is_rh AND v_site.structure_id = v_employee.structure_id THEN
            INSERT INTO public.employee_sites (employee_id, site_id, is_active, is_responsible)
            VALUES (v_employee_id, p_site_id, true, false)
            ON CONFLICT (employee_id, site_id) DO UPDATE SET is_active = true;
        ELSE
            RAISE EXCEPTION 'EMPLOYEE_NOT_ASSIGNED_TO_SITE';
        END IF;
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

    -- GPS : tentative prioritaire
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
            'late_minutes', v_late_minutes,
            'is_rh_multi_site', v_is_rh
        ),
        v_server_now
    );

    RETURN v_attendance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in(uuid, double precision, double precision, double precision, timestamptz, uuid, timestamptz) TO authenticated;

-- 4. Mise à jour de CLOCK OUT avec support Responsable RH itinérant
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
    v_is_rh boolean := false;
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

    v_is_rh := public.is_responsable_rh(v_employee_id);

    SELECT * INTO v_assignment
    FROM public.employee_sites
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        IF v_is_rh AND v_site.structure_id = v_employee.structure_id THEN
            INSERT INTO public.employee_sites (employee_id, site_id, is_active, is_responsible)
            VALUES (v_employee_id, p_site_id, true, false)
            ON CONFLICT (employee_id, site_id) DO UPDATE SET is_active = true;
        ELSE
            RAISE EXCEPTION 'EMPLOYEE_NOT_ASSIGNED_TO_SITE';
        END IF;
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
      AND attendance_date = v_attendance_date
      AND check_in IS NOT NULL
      AND check_out IS NULL
    ORDER BY check_in DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_ACTIVE_CHECK_IN';
    END IF;

    -- GPS
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
            'validation_reason', v_validation_reason,
            'is_rh_multi_site', v_is_rh
        ),
        v_server_now
    );

    RETURN v_attendance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_out(uuid, double precision, double precision, double precision, timestamptz, uuid, timestamptz) TO authenticated;

-- 5. Mise à jour de RESOLVE_ASSIGNED_SITES_BY_IP pour le Responsable RH
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
    v_employee public.employees%ROWTYPE;
BEGIN
    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    SELECT * INTO v_employee
    FROM public.employees
    WHERE id = v_employee_id;

    IF public.is_responsable_rh(v_employee_id) AND v_employee.structure_id IS NOT NULL THEN
        RETURN QUERY
        SELECT
            s.id,
            s.name::text
        FROM public.sites s
        WHERE s.structure_id = v_employee.structure_id
          AND s.is_active = true
          AND s.wifi_required = true
          AND s.allowed_ip IS NOT NULL
          AND public.site_ip_matches_request(s.id);
    ELSE
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
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_assigned_sites_by_ip() TO authenticated;

-- Initialisation immédiate de tous les Responsables RH actuels
SELECT public.sync_responsable_rh_sites();
