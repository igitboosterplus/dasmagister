-- ============================================================
-- MIGRATION : correction du système CLOCK_IN V3
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Supprimer les anciennes surcharges clock_in
-- ============================================================

DROP FUNCTION IF EXISTS public.clock_in(
    double precision,
    double precision,
    double precision,
    uuid,
    timestamptz
);

DROP FUNCTION IF EXISTS public.clock_in(
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
);

DROP FUNCTION IF EXISTS public.clock_in(
    uuid,
    double precision,
    double precision,
    double precision,
    timestamptz,
    uuid,
    timestamptz
);


-- ============================================================
-- 2. Nouvelle fonction CLOCK_IN
-- ============================================================

CREATE OR REPLACE FUNCTION public.clock_in(
    p_site_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION,
    p_occurred_at TIMESTAMPTZ,
    p_client_event_id UUID,
    p_device_recorded_at TIMESTAMPTZ
)
RETURNS public.attendances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    -- --------------------------------------------------------
    -- Employé
    -- --------------------------------------------------------

    v_employee public.employees;

    -- --------------------------------------------------------
    -- Site
    -- --------------------------------------------------------

    v_site public.sites;

    v_distance DOUBLE PRECISION;

    -- --------------------------------------------------------
    -- Horaires
    -- --------------------------------------------------------

    v_work_start TIME;
    v_work_end TIME;
    v_grace INTEGER;

    -- --------------------------------------------------------
    -- Présence
    -- --------------------------------------------------------

    v_attendance public.attendances;

    v_late INTEGER := 0;

    v_status TEXT := 'present';

    v_local_date DATE;

BEGIN

    -- ========================================================
    -- 1. Date locale
    -- ========================================================

    v_local_date :=
        (p_occurred_at AT TIME ZONE 'Africa/Douala')::DATE;


    -- ========================================================
    -- 2. Employé connecté
    -- ========================================================

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


    -- ========================================================
    -- 3. Vérification du site
    -- ========================================================

    IF p_site_id IS NULL THEN
        RAISE EXCEPTION 'Site is required';
    END IF;


    SELECT *
    INTO v_site
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = TRUE;

    IF v_site.id IS NULL THEN
        RAISE EXCEPTION 'Selected site is not active or does not exist';
    END IF;


    -- ========================================================
    -- 4. Vérifier que l'employé est affecté au site
    -- ========================================================

    IF NOT EXISTS (
        SELECT 1
        FROM public.employee_sites es
        WHERE es.employee_id = v_employee.id
          AND es.site_id = p_site_id
          AND es.is_active = TRUE
    ) THEN

        RAISE EXCEPTION
            'Employee is not assigned to the selected site';

    END IF;


    -- ========================================================
    -- 5. Vérification GPS obligatoire
    -- ========================================================

    IF v_site.gps_required = TRUE
       AND (
            p_latitude IS NULL
            OR p_longitude IS NULL
       )
    THEN

        RAISE EXCEPTION
            'GPS location is required for this site';

    END IF;


    -- ========================================================
    -- 6. Vérification précision GPS
    -- ========================================================

    IF p_accuracy_m IS NOT NULL
       AND v_site.max_gps_accuracy_m IS NOT NULL
       AND v_site.max_gps_accuracy_m > 0
       AND p_accuracy_m > v_site.max_gps_accuracy_m
    THEN

        RAISE EXCEPTION
            'GPS accuracy is insufficient: % meters',
            ROUND(p_accuracy_m::numeric, 1);

    END IF;


    -- ========================================================
    -- 7. Calcul de la distance
    -- ========================================================

    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL
       AND v_site.latitude IS NOT NULL
       AND v_site.longitude IS NOT NULL
    THEN

        v_distance :=
            public.calculate_distance_meters(
                p_latitude,
                p_longitude,
                v_site.latitude,
                v_site.longitude
            );


        IF v_distance > v_site.location_radius_m THEN

            RAISE EXCEPTION
                'You are outside the authorized site perimeter: % meters',
                ROUND(v_distance::numeric, 1);

        END IF;

    END IF;


    -- ========================================================
    -- 8. Vérification doublon
    -- ========================================================

    SELECT *
    INTO v_attendance
    FROM public.attendances
    WHERE employee_id = v_employee.id
      AND attendance_date = v_local_date
    FOR UPDATE;


    IF v_attendance.id IS NOT NULL THEN

        IF v_attendance.check_in IS NOT NULL THEN

            RAISE EXCEPTION
                'Attendance already started for today';

        END IF;

    END IF;


    -- ========================================================
    -- 9. Récupération des horaires
    -- ========================================================

    SELECT
        s.work_start,
        s.work_end,
        s.grace_period_minutes
    INTO
        v_work_start,
        v_work_end,
        v_grace
    FROM public.get_my_work_schedule(
        p_site_id,
        v_local_date
    ) s
    LIMIT 1;


    -- ========================================================
    -- 10. Calcul du retard
    -- ========================================================

    IF v_work_start IS NOT NULL THEN

        IF p_occurred_at::TIME >
           (
               v_work_start
               +
               make_interval(
                   mins => COALESCE(v_grace, 0)
               )
           )::TIME
        THEN

            v_late :=
                GREATEST(
                    0,
                    EXTRACT(
                        EPOCH FROM (
                            p_occurred_at::TIME
                            - v_work_start
                        )
                    ) / 60
                )::INTEGER;

        END IF;

    END IF;


    -- ========================================================
    -- 11. Création de la présence
    -- ========================================================

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
            p_site_id,
            v_local_date,

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
            site_id =
                p_site_id,

            check_in =
                p_occurred_at,

            check_in_latitude =
                p_latitude,

            check_in_longitude =
                p_longitude,

            check_in_accuracy_m =
                p_accuracy_m,

            check_in_distance_m =
                v_distance,

            attendance_status =
                v_status,

            late_minutes =
                v_late,

            check_in_method =
                'manual',

            client_event_id =
                p_client_event_id,

            client_timestamp =
                p_occurred_at,

            device_recorded_at =
                p_device_recorded_at,

            server_received_at =
                NOW(),

            is_offline =
                FALSE,

            updated_at =
                NOW()

        WHERE id =
            v_attendance.id

        RETURNING *
        INTO v_attendance;

    END IF;


    -- ========================================================
    -- 12. Sauvegarder les horaires appliqués
    -- ========================================================

    UPDATE public.attendances
    SET
        scheduled_start = v_work_start,
        scheduled_end = v_work_end
    WHERE id = v_attendance.id;


    -- ========================================================
    -- 13. Créer l'événement CLOCK_IN
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

        client_event_id,
        device_recorded_at,
        server_received_at,
        synced_at
    )
    VALUES (
        v_attendance.id,
        v_employee.id,
        p_site_id,

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


    -- ========================================================
    -- 14. Retourner la présence
    -- ========================================================

    RETURN v_attendance;

END;
$$;


-- ============================================================
-- 15. Permissions RPC
-- ============================================================

GRANT EXECUTE ON FUNCTION public.clock_in(
    UUID,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    TIMESTAMPTZ,
    UUID,
    TIMESTAMPTZ
) TO authenticated;


COMMIT;