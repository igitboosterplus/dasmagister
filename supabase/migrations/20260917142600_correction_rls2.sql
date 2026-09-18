BEGIN;

-- ============================================================
-- 1. SUPPRESSION DES RPC ACTUELS
-- ============================================================

DROP FUNCTION IF EXISTS public.clock_in(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
);

DROP FUNCTION IF EXISTS public.clock_out(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
);


-- ============================================================
-- 2. CLOCK IN
-- ============================================================

CREATE FUNCTION public.clock_in(
    p_site_id uuid,
    p_latitude double precision,
    p_longitude double precision,
    p_accuracy_m double precision,
    p_occurred_at timestamptz,
    p_client_event_id uuid,
    p_device_recorded_at timestamptz
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

    v_occurred_at timestamptz;
    v_server_now timestamptz := now();

    v_local_time time;
    v_start_with_grace time;
    v_diff interval;
BEGIN

    -- ========================================================
    -- Employé connecté
    -- ========================================================

    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;


    -- ========================================================
    -- Vérification employé
    -- ========================================================

    SELECT *
    INTO v_employee
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


    -- ========================================================
    -- Vérification site
    -- ========================================================

    SELECT *
    INTO v_site
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SITE_NOT_FOUND_OR_INACTIVE';
    END IF;


    -- ========================================================
    -- Vérification structure
    -- ========================================================

    IF v_site.structure_id <> v_employee.structure_id THEN
        RAISE EXCEPTION 'SITE_NOT_IN_EMPLOYEE_STRUCTURE';
    END IF;


    -- ========================================================
    -- Vérification affectation employé → site
    -- ========================================================

    SELECT *
    INTO v_assignment
    FROM public.employee_sites
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND is_active = TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_ASSIGNED_TO_SITE';
    END IF;


    -- ========================================================
    -- Date / heure
    -- ========================================================

    v_occurred_at := COALESCE(
        p_occurred_at,
        v_server_now
    );

    v_attendance_date :=
        (
            v_occurred_at
            AT TIME ZONE COALESCE(
                v_site.timezone,
                'Africa/Douala'
            )
        )::date;


    -- ========================================================
    -- Protection contre doublon client_event_id
    -- ========================================================

    IF p_client_event_id IS NOT NULL THEN

        SELECT a.*
        INTO v_existing_attendance
        FROM public.attendances a
        INNER JOIN public.attendance_events ae
            ON ae.attendance_id = a.id
        WHERE ae.client_event_id = p_client_event_id
          AND ae.event_type = 'check_in'
          AND a.employee_id = v_employee_id
        LIMIT 1;

        IF FOUND THEN
            RETURN v_existing_attendance;
        END IF;

    END IF;


    -- ========================================================
    -- Vérification GPS obligatoire
    -- ========================================================

    IF v_site.gps_required IS TRUE THEN

        IF p_latitude IS NULL
           OR p_longitude IS NULL
           OR p_accuracy_m IS NULL THEN

            RAISE EXCEPTION 'GPS_REQUIRED';

        END IF;

    END IF;


    -- ========================================================
    -- Validation GPS
    -- ========================================================

    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND v_site.latitude IS NOT NULL
       AND v_site.longitude IS NOT NULL THEN

        v_distance_m :=
            6371000 * 2 * ASIN(
                SQRT(
                    POWER(
                        SIN(
                            RADIANS(
                                p_latitude - v_site.latitude
                            ) / 2
                        ),
                        2
                    )
                    +
                    COS(RADIANS(v_site.latitude))
                    *
                    COS(RADIANS(p_latitude))
                    *
                    POWER(
                        SIN(
                            RADIANS(
                                p_longitude - v_site.longitude
                            ) / 2
                        ),
                        2
                    )
                )
            );


        -- Précision GPS

        IF v_site.max_gps_accuracy_m IS NOT NULL
           AND p_accuracy_m > v_site.max_gps_accuracy_m THEN

            RAISE EXCEPTION 'GPS_ACCURACY_TOO_LOW';

        END IF;


        -- Distance

        IF v_site.location_radius_m IS NOT NULL
           AND v_distance_m > v_site.location_radius_m THEN

            RAISE EXCEPTION 'GPS_OUTSIDE_SITE';

        END IF;


        v_validation_method := 'gps_auto';
        v_check_in_method := 'gps_auto';

    ELSE

        IF v_site.gps_required IS TRUE THEN
            RAISE EXCEPTION 'GPS_REQUIRED';
        END IF;

        v_validation_method := 'manual';
        v_check_in_method := 'manual';

    END IF;


    -- ========================================================
    -- Vérifier qu'il n'y a pas déjà un pointage ouvert
    -- ========================================================

    SELECT *
    INTO v_existing_attendance
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


    -- ========================================================
    -- Planning
    -- ========================================================

    v_day_of_week :=
        EXTRACT(
            DOW FROM (
                v_occurred_at
                AT TIME ZONE COALESCE(
                    v_site.timezone,
                    'Africa/Douala'
                )
            )
        )::integer;


    SELECT *
    INTO v_schedule
    FROM public.site_work_schedules
    WHERE site_id = p_site_id
      AND day_of_week = v_day_of_week
    LIMIT 1;


    -- ========================================================
    -- Jour non travaillé
    -- ========================================================

    IF FOUND
       AND v_schedule.is_working_day IS NOT TRUE THEN

        RAISE EXCEPTION 'NON_WORKING_DAY';

    END IF;


    -- ========================================================
    -- Calcul retard
    -- ========================================================

    IF FOUND
       AND v_schedule.work_start IS NOT NULL THEN

        v_local_time :=
            (
                v_occurred_at
                AT TIME ZONE COALESCE(
                    v_site.timezone,
                    'Africa/Douala'
                )
            )::time;

        v_start_with_grace :=
            v_schedule.work_start
            +
            make_interval(
                mins => COALESCE(
                    v_schedule.grace_period_minutes,
                    0
                )
            );

        IF v_local_time > v_start_with_grace THEN

            v_diff :=
                v_local_time - v_start_with_grace;

            v_late_minutes :=
                FLOOR(
                    EXTRACT(EPOCH FROM v_diff) / 60
                )::integer;

            v_validation_status := 'late';

        END IF;

    END IF;


    -- ========================================================
    -- Création attendance
    -- ========================================================

    INSERT INTO public.attendances (
        employee_id,
        site_id,
        attendance_date,

        check_in,
        created_at,

        check_in_latitude,
        check_in_longitude,
        check_in_accuracy_m,
        check_in_distance_m,

        validation_method,
        validation_status,

        client_timestamp,
        synced_at,

        attendance_source,
        is_offline,

        client_event_id,
        device_recorded_at,
        server_received_at,

        validated_at,
        validation_reason,

        updated_at,

        scheduled_start,
        scheduled_end,

        late_minutes,
        attendance_status,

        check_in_method
    )
    VALUES (
        v_employee_id,
        p_site_id,
        v_attendance_date,

        v_occurred_at,
        v_server_now,

        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance_m,

        v_validation_method,
        v_validation_status,

        p_occurred_at,
        v_server_now,

        'online'::attendance_source,
        FALSE,

        p_client_event_id,
        p_device_recorded_at,
        v_server_now,

        v_server_now,

        CASE
            WHEN v_validation_status = 'late'
            THEN 'Arrivée après l''heure prévue'
            ELSE NULL
        END,

        v_server_now,

        v_schedule.work_start,
        v_schedule.work_end,

        v_late_minutes,

        CASE
            WHEN v_validation_status = 'late'
            THEN 'late'
            ELSE 'present'
        END,

        v_check_in_method
    )
    RETURNING *
    INTO v_attendance;


    -- ========================================================
    -- Event CHECK IN
    -- ========================================================

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

        client_event_id,
        device_recorded_at,

        server_received_at,
        synced_at,

        metadata,
        created_at
    )
    VALUES (
        v_attendance.id,
        v_employee_id,
        p_site_id,

        'check_in',
        v_check_in_method,

        v_occurred_at,

        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance_m,

        TRUE,
        v_server_now,

        p_client_event_id,
        p_device_recorded_at,

        v_server_now,
        v_server_now,

        jsonb_build_object(
            'validation_method', v_validation_method,
            'validation_status', v_validation_status,
            'late_minutes', v_late_minutes
        ),

        v_server_now
    );


    RETURN v_attendance;

END;
$$;


-- ============================================================
-- 3. CLOCK OUT
-- ============================================================

CREATE FUNCTION public.clock_out(
    p_site_id uuid,
    p_latitude double precision,
    p_longitude double precision,
    p_accuracy_m double precision,
    p_occurred_at timestamptz,
    p_client_event_id uuid,
    p_device_recorded_at timestamptz
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

    v_validation_method text := 'manual';
    v_check_out_method text := 'manual';

    v_occurred_at timestamptz;
    v_server_now timestamptz := now();

    v_attendance_date date;
BEGIN

    -- ========================================================
    -- Employé
    -- ========================================================

    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;


    SELECT *
    INTO v_employee
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


    -- ========================================================
    -- Site
    -- ========================================================

    SELECT *
    INTO v_site
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SITE_NOT_FOUND_OR_INACTIVE';
    END IF;


    -- ========================================================
    -- Structure
    -- ========================================================

    IF v_site.structure_id <> v_employee.structure_id THEN
        RAISE EXCEPTION 'SITE_NOT_IN_EMPLOYEE_STRUCTURE';
    END IF;


    -- ========================================================
    -- Affectation
    -- ========================================================

    SELECT *
    INTO v_assignment
    FROM public.employee_sites
    WHERE employee_id = v_employee_id
      AND site_id = p_site_id
      AND is_active = TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_ASSIGNED_TO_SITE';
    END IF;


    -- ========================================================
    -- Date / heure
    -- ========================================================

    v_occurred_at := COALESCE(
        p_occurred_at,
        v_server_now
    );

    v_attendance_date :=
        (
            v_occurred_at
            AT TIME ZONE COALESCE(
                v_site.timezone,
                'Africa/Douala'
            )
        )::date;


    -- ========================================================
    -- Protection doublon
    -- ========================================================

    IF p_client_event_id IS NOT NULL THEN

        SELECT a.*
        INTO v_existing_attendance
        FROM public.attendances a
        INNER JOIN public.attendance_events ae
            ON ae.attendance_id = a.id
        WHERE ae.client_event_id = p_client_event_id
          AND ae.event_type = 'check_out'
          AND a.employee_id = v_employee_id
        LIMIT 1;

        IF FOUND THEN
            RETURN v_existing_attendance;
        END IF;

    END IF;


    -- ========================================================
    -- GPS
    -- ========================================================

    IF v_site.gps_required IS TRUE THEN

        IF p_latitude IS NULL
           OR p_longitude IS NULL
           OR p_accuracy_m IS NULL THEN

            RAISE EXCEPTION 'GPS_REQUIRED';

        END IF;

    END IF;


    -- ========================================================
    -- Validation GPS
    -- ========================================================

    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND v_site.latitude IS NOT NULL
       AND v_site.longitude IS NOT NULL THEN

        v_distance_m :=
            6371000 * 2 * ASIN(
                SQRT(
                    POWER(
                        SIN(
                            RADIANS(
                                p_latitude - v_site.latitude
                            ) / 2
                        ),
                        2
                    )
                    +
                    COS(RADIANS(v_site.latitude))
                    *
                    COS(RADIANS(p_latitude))
                    *
                    POWER(
                        SIN(
                            RADIANS(
                                p_longitude - v_site.longitude
                            ) / 2
                        ),
                        2
                    )
                )
            );


        IF v_site.max_gps_accuracy_m IS NOT NULL
           AND p_accuracy_m > v_site.max_gps_accuracy_m THEN

            RAISE EXCEPTION 'GPS_ACCURACY_TOO_LOW';

        END IF;


        IF v_site.location_radius_m IS NOT NULL
           AND v_distance_m > v_site.location_radius_m THEN

            RAISE EXCEPTION 'GPS_OUTSIDE_SITE';

        END IF;


        v_validation_method := 'gps_auto';
        v_check_out_method := 'gps_auto';

    ELSE

        IF v_site.gps_required IS TRUE THEN
            RAISE EXCEPTION 'GPS_REQUIRED';
        END IF;

    END IF;


    -- ========================================================
    -- Récupération pointage ouvert
    -- ========================================================

    SELECT *
    INTO v_attendance
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


    -- ========================================================
    -- Mise à jour attendance
    -- ========================================================

    UPDATE public.attendances
    SET
        check_out = v_occurred_at,

        check_out_latitude = p_latitude,
        check_out_longitude = p_longitude,
        check_out_accuracy_m = p_accuracy_m,
        check_out_distance_m = v_distance_m,

        check_out_method = v_check_out_method,

        updated_at = v_server_now,

        server_received_at = v_server_now,

        synced_at = v_server_now,

        validated_at = v_server_now

    WHERE id = v_attendance.id

    RETURNING *
    INTO v_attendance;


    -- ========================================================
    -- Event CHECK OUT
    -- ========================================================

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

        client_event_id,
        device_recorded_at,

        server_received_at,
        synced_at,

        metadata,
        created_at
    )
    VALUES (
        v_attendance.id,
        v_employee_id,
        p_site_id,

        'check_out',
        v_check_out_method,

        v_occurred_at,

        p_latitude,
        p_longitude,
        p_accuracy_m,
        v_distance_m,

        TRUE,
        v_server_now,

        p_client_event_id,
        p_device_recorded_at,

        v_server_now,
        v_server_now,

        jsonb_build_object(
            'validation_method', v_validation_method
        ),

        v_server_now
    );


    RETURN v_attendance;

END;
$$;


-- ============================================================
-- 4. PERMISSIONS
-- ============================================================

REVOKE ALL ON FUNCTION public.clock_in(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clock_in(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
)
TO authenticated;


REVOKE ALL ON FUNCTION public.clock_out(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clock_out(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
)
TO authenticated;


COMMIT;