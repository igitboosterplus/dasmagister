-- ============================================================
-- DAS - MIGRATION V3
-- Modèle organisationnel + multi-sites + inscription +
-- pointage sécurisé GPS + offline + RLS + RPC
-- ============================================================

BEGIN;

-- ============================================================
-- 0. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'account_status'
    ) THEN
        CREATE TYPE public.account_status AS ENUM (
            'pending',
            'active',
            'rejected',
            'suspended'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'attendance_validation_status'
    ) THEN
        CREATE TYPE public.attendance_validation_status AS ENUM (
            'valid',
            'late',
            'out_of_zone',
            'low_accuracy',
            'no_gps',
            'pending_review',
            'rejected'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'attendance_source'
    ) THEN
        CREATE TYPE public.attendance_source AS ENUM (
            'online',
            'offline',
            'manual'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'attendance_event_type'
    ) THEN
        CREATE TYPE public.attendance_event_type AS ENUM (
            'check_in',
            'check_out'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'anomaly_type'
    ) THEN
        CREATE TYPE public.anomaly_type AS ENUM (
            'late',
            'out_of_zone',
            'low_accuracy',
            'no_gps',
            'offline',
            'duplicate',
            'missing_checkout',
            'suspicious_time'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'anomaly_severity'
    ) THEN
        CREATE TYPE public.anomaly_severity AS ENUM (
            'low',
            'medium',
            'high',
            'critical'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'report_status'
    ) THEN
        CREATE TYPE public.report_status AS ENUM (
            'draft',
            'submitted',
            'received',
            'forwarded',
            'reviewed',
            'archived',
            'rejected'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'absence_type'
    ) THEN
        CREATE TYPE public.absence_type AS ENUM (
            'leave',
            'authorized_absence',
            'sick',
            'mission',
            'training',
            'other'
        );
    END IF;
END
$$;


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'absence_status'
    ) THEN
        CREATE TYPE public.absence_status AS ENUM (
            'pending',
            'approved',
            'rejected',
            'cancelled'
        );
    END IF;
END
$$;


-- ============================================================
-- 2. STRUCTURES
-- ============================================================

ALTER TABLE public.structures
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.structures
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ============================================================
-- 3. CITIES
-- ============================================================

ALTER TABLE public.cities
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ============================================================
-- 4. SITES
-- ============================================================

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS location_radius_m INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS max_gps_accuracy_m INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS gps_required BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS offline_attendance_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Responsable du site
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS responsible_employee_id UUID;


-- ============================================================
-- 5. POSITIONS
-- ============================================================

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS structure_id UUID;

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS code TEXT;

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS is_responsible_position BOOLEAN
        NOT NULL DEFAULT FALSE;

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.positions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ============================================================
-- 6. SERVICES
-- ============================================================

ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS code TEXT;

ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ============================================================
-- 7. EMPLOYEES
-- ============================================================

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS account_status public.account_status
        NOT NULL DEFAULT 'pending';

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS approved_by UUID;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ============================================================
-- 8. MIGRATION DES ANCIENS COMPTES
-- ============================================================

-- Les anciens comptes actifs deviennent actifs.
UPDATE public.employees
SET account_status = 'active'
WHERE account_status = 'pending'
  AND is_active = TRUE;

-- Les anciens comptes désactivés deviennent suspendus.
UPDATE public.employees
SET account_status = 'suspended'
WHERE account_status = 'pending'
  AND is_active = FALSE;


-- ============================================================
-- 9. EMPLOYEE_SITES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.employee_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    site_id UUID NOT NULL
        REFERENCES public.sites(id)
        ON DELETE CASCADE,

    assigned_by UUID
        REFERENCES public.employees(id)
        ON DELETE SET NULL,

    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_sites_unique
        UNIQUE (employee_id, site_id)
);


-- ============================================================
-- 10. MIGRATION EMPLOYEES.SITE_ID -> EMPLOYEE_SITES
-- ============================================================

INSERT INTO public.employee_sites (
    employee_id,
    site_id,
    assigned_at,
    is_active
)
SELECT
    e.id,
    e.site_id,
    COALESCE(e.created_at, NOW()),
    TRUE
FROM public.employees e
WHERE e.site_id IS NOT NULL
ON CONFLICT (employee_id, site_id)
DO NOTHING;


-- ============================================================
-- 11. CONTRAINTE STRUCTURE EMPLOYEE / SITE
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_employee_site_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    employee_structure UUID;
    site_structure UUID;
BEGIN
    SELECT structure_id
    INTO employee_structure
    FROM public.employees
    WHERE id = NEW.employee_id;

    SELECT structure_id
    INTO site_structure
    FROM public.sites
    WHERE id = NEW.site_id;

    IF employee_structure IS NULL THEN
        RAISE EXCEPTION 'Employee does not belong to a structure';
    END IF;

    IF site_structure IS NULL THEN
        RAISE EXCEPTION 'Site does not belong to a structure';
    END IF;

    IF employee_structure <> site_structure THEN
        RAISE EXCEPTION
            'Employee and site must belong to the same structure';
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_employee_site_assignment
ON public.employee_sites;

CREATE TRIGGER trg_validate_employee_site_assignment
BEFORE INSERT OR UPDATE
ON public.employee_sites
FOR EACH ROW
EXECUTE FUNCTION public.validate_employee_site_assignment();


-- ============================================================
-- 12. RESPONSABLE DE SITE
-- ============================================================

ALTER TABLE public.sites
    ADD CONSTRAINT sites_responsible_employee_fk
    FOREIGN KEY (responsible_employee_id)
    REFERENCES public.employees(id)
    ON DELETE SET NULL;


CREATE OR REPLACE FUNCTION public.validate_site_responsible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    employee_structure UUID;
    employee_active BOOLEAN;
    employee_position UUID;
    position_is_responsible BOOLEAN;
    assigned_to_site BOOLEAN;
BEGIN

    IF NEW.responsible_employee_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT
        structure_id,
        is_active,
        position_id
    INTO
        employee_structure,
        employee_active,
        employee_position
    FROM public.employees
    WHERE id = NEW.responsible_employee_id;

    IF employee_structure IS NULL THEN
        RAISE EXCEPTION 'Responsible employee does not exist';
    END IF;

    IF employee_structure <> NEW.structure_id THEN
        RAISE EXCEPTION
            'Responsible employee must belong to the same structure as the site';
    END IF;

    IF employee_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'Responsible employee must be active';
    END IF;

    SELECT is_responsible_position
    INTO position_is_responsible
    FROM public.positions
    WHERE id = employee_position;

    IF position_is_responsible IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'Employee position is not authorized as a site responsible position';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.employee_sites es
        WHERE es.employee_id = NEW.responsible_employee_id
          AND es.site_id = NEW.id
          AND es.is_active = TRUE
    )
    INTO assigned_to_site;

    IF assigned_to_site IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'Responsible employee must be assigned to the site first';
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_validate_site_responsible
ON public.sites;

CREATE TRIGGER trg_validate_site_responsible
BEFORE INSERT OR UPDATE OF responsible_employee_id
ON public.sites
FOR EACH ROW
EXECUTE FUNCTION public.validate_site_responsible();


-- ============================================================
-- 13. EMPLOYEE ROLES
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS employee_roles_employee_unique
ON public.employee_roles(employee_id);


-- ============================================================
-- 14. ATTENDANCES
-- ============================================================

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_in_latitude DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_in_longitude DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_in_accuracy_m DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_out_latitude DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_out_longitude DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS check_out_accuracy_m DOUBLE PRECISION;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS attendance_source public.attendance_source
        NOT NULL DEFAULT 'online';

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS is_offline BOOLEAN
        NOT NULL DEFAULT FALSE;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS client_event_id UUID;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS device_recorded_at TIMESTAMPTZ;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS server_received_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW();

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS validation_reason TEXT;

ALTER TABLE public.attendances
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW();


-- ============================================================
-- 15. ENUM DE VALIDATION
-- ============================================================

DO $$
DECLARE
    col_type TEXT;
BEGIN

    SELECT udt_name
    INTO col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'attendances'
      AND column_name = 'validation_status';

    IF col_type IS NULL THEN

        ALTER TABLE public.attendances
        ADD COLUMN validation_status
            public.attendance_validation_status
            NOT NULL DEFAULT 'pending_review';

    END IF;

END
$$;


-- ============================================================
-- 16. MIGRATION DES ANCIENS STATUTS
-- ============================================================

DO $$
DECLARE
    current_type TEXT;
BEGIN

    SELECT udt_name
    INTO current_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'attendances'
      AND column_name = 'validation_status';

    IF current_type = 'text' THEN

        ALTER TABLE public.attendances
        ALTER COLUMN validation_status DROP DEFAULT;

        ALTER TABLE public.attendances
        ALTER COLUMN validation_status TYPE TEXT;

        UPDATE public.attendances
        SET validation_status = 'pending_review'
        WHERE validation_status IS NULL;

    END IF;

END
$$;


-- ============================================================
-- 17. CLIENT_EVENT_ID UNIQUE
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS attendances_client_event_unique
ON public.attendances(client_event_id)
WHERE client_event_id IS NOT NULL;


-- ============================================================
-- 18. INDEX ATTENDANCES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_attendances_employee_date
ON public.attendances(employee_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendances_site_date
ON public.attendances(site_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendances_status_date
ON public.attendances(validation_status, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendances_server_received
ON public.attendances(server_received_at DESC);


-- ============================================================
-- 19. ANOMALIES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    attendance_id UUID NOT NULL
        REFERENCES public.attendances(id)
        ON DELETE CASCADE,

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    site_id UUID
        REFERENCES public.sites(id)
        ON DELETE SET NULL,

    type public.anomaly_type NOT NULL,

    severity public.anomaly_severity NOT NULL DEFAULT 'medium',

    description TEXT,

    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    resolved_at TIMESTAMPTZ,

    resolved_by UUID
        REFERENCES public.employees(id)
        ON DELETE SET NULL,

    resolution_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_attendance_anomalies_employee
ON public.attendance_anomalies(employee_id);

CREATE INDEX IF NOT EXISTS idx_attendance_anomalies_site
ON public.attendance_anomalies(site_id);

CREATE INDEX IF NOT EXISTS idx_attendance_anomalies_date
ON public.attendance_anomalies(detected_at);


-- ============================================================
-- 20. ABSENCES AUTORISÉES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.employee_absences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    structure_id UUID NOT NULL
        REFERENCES public.structures(id)
        ON DELETE CASCADE,

    type public.absence_type NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    reason TEXT,

    status public.absence_status
        NOT NULL DEFAULT 'pending',

    approved_by UUID
        REFERENCES public.employees(id)
        ON DELETE SET NULL,

    approved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_absence_dates_valid
        CHECK (end_date >= start_date)
);


CREATE INDEX IF NOT EXISTS idx_employee_absences_employee_date
ON public.employee_absences(employee_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_employee_absences_structure_date
ON public.employee_absences(structure_id, start_date, end_date);


-- ============================================================
-- 21. NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    recipient_employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    type TEXT NOT NULL,

    title TEXT NOT NULL,

    message TEXT NOT NULL,

    entity_type TEXT,

    entity_id UUID,

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_notifications_recipient
ON public.notifications(recipient_employee_id, is_read, created_at DESC);


-- ============================================================
-- 22. AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    actor_employee_id UUID
        REFERENCES public.employees(id)
        ON DELETE SET NULL,

    action TEXT NOT NULL,

    entity_type TEXT NOT NULL,

    entity_id UUID,

    old_data JSONB,

    new_data JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
ON public.audit_logs(actor_employee_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
ON public.audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
ON public.audit_logs(created_at DESC);


-- ============================================================
-- 23. RAPPORTS
-- ============================================================

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS structure_id UUID;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS site_id UUID;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS author_employee_id UUID;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS recipient_employee_id UUID;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS status public.report_status
        NOT NULL DEFAULT 'draft';

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMPTZ;


-- ============================================================
-- 24. FONCTIONS DE SÉCURITÉ
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id
    FROM public.employees
    WHERE auth_user_id = auth.uid()
    LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION public.current_structure_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT structure_id
    FROM public.employees
    WHERE auth_user_id = auth.uid()
      AND account_status = 'active'
      AND is_active = TRUE
    LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS public.employee_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT er.role
    FROM public.employee_roles er
    JOIN public.employees e
      ON e.id = er.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND e.account_status = 'active'
      AND e.is_active = TRUE
    LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION public.current_employee_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employees
        WHERE auth_user_id = auth.uid()
          AND account_status = 'active'
          AND is_active = TRUE
    );
$$;


CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_employee_role() = 'admin';
$$;


CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_employee_role() = 'manager';
$$;


CREATE OR REPLACE FUNCTION public.is_employee()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.current_employee_role() = 'employee';
$$;


-- ============================================================
-- 25. RESPONSABLE DE SITE
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_site_responsible(
    p_site_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.sites s
        WHERE s.id = p_site_id
          AND s.responsible_employee_id =
              public.current_employee_id()
    );
$$;


-- ============================================================
-- 26. ACCÈS SITE PAR EMPLOYÉ
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_can_access_site(
    p_site_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.employee_sites es
            WHERE es.employee_id = public.current_employee_id()
              AND es.site_id = p_site_id
              AND es.is_active = TRUE
        )
        OR EXISTS (
            SELECT 1
            FROM public.sites s
            WHERE s.id = p_site_id
              AND s.structure_id = public.current_structure_id()
              AND public.is_manager()
        )
        OR public.is_site_responsible(p_site_id);
$$;


-- ============================================================
-- 27. DISTANCE GPS
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_distance_meters(
    p_lat1 DOUBLE PRECISION,
    p_lon1 DOUBLE PRECISION,
    p_lat2 DOUBLE PRECISION,
    p_lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        6371000.0 *
        2.0 *
        ASIN(
            SQRT(
                POWER(
                    SIN(
                        RADIANS(p_lat2 - p_lat1) / 2
                    ),
                    2
                )
                +
                COS(RADIANS(p_lat1))
                *
                COS(RADIANS(p_lat2))
                *
                POWER(
                    SIN(
                        RADIANS(p_lon2 - p_lon1) / 2
                    ),
                    2
                )
            )
        );
$$;


-- ============================================================
-- 28. TROUVER LE SITE GPS LE PLUS PROCHE
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_employee_site_by_gps(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy DOUBLE PRECISION
)
RETURNS TABLE (
    site_id UUID,
    distance_meters DOUBLE PRECISION,
    gps_valid BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.id,
        public.calculate_distance_meters(
            p_latitude,
            p_longitude,
            s.latitude,
            s.longitude
        ) AS distance_meters,

        (
            public.calculate_distance_meters(
                p_latitude,
                p_longitude,
                s.latitude,
                s.longitude
            ) <= s.location_radius_m
            AND
            (
                p_accuracy IS NULL
                OR p_accuracy <= s.max_gps_accuracy_m
            )
        ) AS gps_valid

    FROM public.sites s
    JOIN public.employee_sites es
      ON es.site_id = s.id

    WHERE es.employee_id = public.current_employee_id()
      AND es.is_active = TRUE
      AND s.is_active = TRUE
      AND s.latitude IS NOT NULL
      AND s.longitude IS NOT NULL

    ORDER BY distance_meters ASC

    LIMIT 1;
$$;


-- ============================================================
-- 29. CLOCK IN
-- ============================================================

CREATE OR REPLACE FUNCTION public.clock_in(
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,
    p_client_event_id UUID DEFAULT gen_random_uuid(),
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_employee_id UUID;
    v_site_id UUID;

    v_distance DOUBLE PRECISION;

    v_status public.attendance_validation_status;

    v_now TIMESTAMPTZ := NOW();

    v_attendance_id UUID;

    v_site_radius INTEGER;
    v_site_accuracy INTEGER;
    v_gps_required BOOLEAN;
    v_offline_enabled BOOLEAN;

    v_check_in_time TIME;
    v_schedule_start TIME;
    v_late_after INTEGER;

BEGIN

    -- --------------------------------------------------------
    -- 1. Utilisateur courant
    -- --------------------------------------------------------

    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'Employee profile not found';
    END IF;

    IF NOT public.current_employee_is_active() THEN
        RAISE EXCEPTION 'Employee account is not active';
    END IF;


    -- --------------------------------------------------------
    -- 2. Empêcher deux check-in ouverts
    -- --------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM public.attendances
        WHERE employee_id = v_employee_id
          AND check_out IS NULL
          AND attendance_date = CURRENT_DATE
    ) THEN
        RAISE EXCEPTION
            'An open attendance already exists for today';
    END IF;


    -- --------------------------------------------------------
    -- 3. Recherche automatique du site
    -- --------------------------------------------------------

    IF p_latitude IS NOT NULL
       AND p_longitude IS NOT NULL THEN

        SELECT
            x.site_id,
            x.distance_meters
        INTO
            v_site_id,
            v_distance
        FROM public.find_employee_site_by_gps(
            p_latitude,
            p_longitude,
            p_accuracy
        ) x
        WHERE x.gps_valid = TRUE
        LIMIT 1;

    END IF;


    -- --------------------------------------------------------
    -- 4. Si aucun site GPS valide
    -- --------------------------------------------------------

    IF v_site_id IS NULL THEN

        -- Si l'employé n'a pas fourni de GPS
        IF p_latitude IS NULL
           OR p_longitude IS NULL THEN

            SELECT
                es.site_id
            INTO
                v_site_id
            FROM public.employee_sites es
            JOIN public.sites s
              ON s.id = es.site_id
            WHERE es.employee_id = v_employee_id
              AND es.is_active = TRUE
              AND s.gps_required = FALSE
              AND s.is_active = TRUE
            ORDER BY es.assigned_at DESC
            LIMIT 1;

            IF v_site_id IS NULL THEN
                v_status := 'no_gps';
            END IF;

        ELSE

            v_status := 'out_of_zone';

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- 5. Vérification site
    -- --------------------------------------------------------

    IF v_site_id IS NOT NULL THEN

        SELECT
            location_radius_m,
            max_gps_accuracy_m,
            gps_required,
            offline_attendance_enabled
        INTO
            v_site_radius,
            v_site_accuracy,
            v_gps_required,
            v_offline_enabled
        FROM public.sites
        WHERE id = v_site_id;

        IF p_accuracy IS NOT NULL
           AND p_accuracy > v_site_accuracy THEN

            v_status := 'low_accuracy';

        ELSE

            v_status := 'valid';

        END IF;

    END IF;


    -- --------------------------------------------------------
    -- 6. Calcul du retard
    -- --------------------------------------------------------

    v_check_in_time := v_now::TIME;

    SELECT
        sws.start_time,
        sws.late_after_minutes
    INTO
        v_schedule_start,
        v_late_after
    FROM public.site_work_schedules sws
    WHERE sws.site_id = v_site_id
      AND sws.day_of_week = EXTRACT(
          DOW FROM v_now
      )::INTEGER
      AND sws.is_working_day = TRUE
    LIMIT 1;


    IF v_status = 'valid'
       AND v_schedule_start IS NOT NULL
       AND v_check_in_time >
           (
               v_schedule_start
               +
               make_interval(
                   mins => COALESCE(v_late_after, 0)
               )
           )::TIME
    THEN
        v_status := 'late';
    END IF;


    -- --------------------------------------------------------
    -- 7. Création du pointage
    -- --------------------------------------------------------

    INSERT INTO public.attendances (
        employee_id,
        site_id,
        attendance_date,

        check_in,

        check_in_latitude,
        check_in_longitude,
        check_in_accuracy_m,

        validation_status,

        attendance_source,
        is_offline,

        client_event_id,
        device_recorded_at,

        server_received_at,
        validated_at,

        validation_reason,

        created_at,
        updated_at
    )
    VALUES (
        v_employee_id,
        v_site_id,
        v_now::DATE,

        v_now,

        p_latitude,
        p_longitude,
        p_accuracy,

        COALESCE(
            v_status,
            'pending_review'
        ),

        CASE
            WHEN p_device_recorded_at IS NULL
                THEN 'online'::public.attendance_source
            ELSE
                'online'::public.attendance_source
        END,

        FALSE,

        p_client_event_id,
        p_device_recorded_at,

        v_now,
        CASE
            WHEN v_status IN ('valid', 'late')
                THEN v_now
            ELSE NULL
        END,

        CASE
            WHEN v_status = 'out_of_zone'
                THEN 'Employee outside authorized site radius'
            WHEN v_status = 'low_accuracy'
                THEN 'GPS accuracy exceeds site threshold'
            WHEN v_status = 'no_gps'
                THEN 'GPS coordinates unavailable'
            WHEN v_status = 'late'
                THEN 'Check-in occurred after configured lateness threshold'
            ELSE NULL
        END,

        v_now,
        v_now
    )
    RETURNING id
    INTO v_attendance_id;


    -- --------------------------------------------------------
    -- 8. Anomalies
    -- --------------------------------------------------------

    IF v_status = 'late' THEN

        INSERT INTO public.attendance_anomalies (
            attendance_id,
            employee_id,
            site_id,
            type,
            severity,
            description
        )
        VALUES (
            v_attendance_id,
            v_employee_id,
            v_site_id,
            'late',
            'medium',
            'Employee checked in after the configured lateness threshold'
        );

    ELSIF v_status = 'out_of_zone' THEN

        INSERT INTO public.attendance_anomalies (
            attendance_id,
            employee_id,
            site_id,
            type,
            severity,
            description
        )
        VALUES (
            v_attendance_id,
            v_employee_id,
            v_site_id,
            'out_of_zone',
            'high',
            'GPS position is outside the authorized site radius'
        );

    ELSIF v_status = 'low_accuracy' THEN

        INSERT INTO public.attendance_anomalies (
            attendance_id,
            employee_id,
            site_id,
            type,
            severity,
            description
        )
        VALUES (
            v_attendance_id,
            v_employee_id,
            v_site_id,
            'low_accuracy',
            'medium',
            'GPS accuracy is insufficient'
        );

    ELSIF v_status = 'no_gps' THEN

        INSERT INTO public.attendance_anomalies (
            attendance_id,
            employee_id,
            site_id,
            type,
            severity,
            description
        )
        VALUES (
            v_attendance_id,
            v_employee_id,
            v_site_id,
            'no_gps',
            'high',
            'GPS coordinates were not available'
        );

    END IF;


    RETURN v_attendance_id;

END;
$$;


-- ============================================================
-- 30. CLOCK OUT
-- ============================================================

CREATE OR REPLACE FUNCTION public.clock_out(
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,
    p_client_event_id UUID DEFAULT gen_random_uuid(),
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

    v_employee_id UUID;
    v_attendance_id UUID;

    v_now TIMESTAMPTZ := NOW();

BEGIN

    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'Employee profile not found';
    END IF;

    SELECT id
    INTO v_attendance_id
    FROM public.attendances
    WHERE employee_id = v_employee_id
      AND attendance_date = CURRENT_DATE
      AND check_out IS NULL
    ORDER BY check_in DESC
    LIMIT 1;

    IF v_attendance_id IS NULL THEN
        RAISE EXCEPTION
            'No open attendance found for today';
    END IF;


    UPDATE public.attendances
    SET
        check_out = v_now,

        check_out_latitude = p_latitude,
        check_out_longitude = p_longitude,
        check_out_accuracy_m = p_accuracy,

        updated_at = v_now

    WHERE id = v_attendance_id
      AND employee_id = v_employee_id;


    RETURN v_attendance_id;

END;
$$;


-- ============================================================
-- 31. SYNCHRONISATION OFFLINE
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_offline_attendance(
    p_event_type public.attendance_event_type,
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,
    p_client_event_id UUID DEFAULT NULL,
    p_device_recorded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_id UUID;
    v_existing_id UUID;
    v_attendance_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN

    v_employee_id := public.current_employee_id();

    IF v_employee_id IS NULL THEN
        RAISE EXCEPTION 'Employee profile not found';
    END IF;

    -- --------------------------------------------------------
    -- Idempotence
    -- --------------------------------------------------------

    IF p_client_event_id IS NOT NULL THEN

        SELECT id
        INTO v_existing_id
        FROM public.attendances
        WHERE client_event_id = p_client_event_id
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;

    END IF;

    -- --------------------------------------------------------
    -- Check-in offline
    -- --------------------------------------------------------

    IF p_event_type = 'check_in' THEN

        v_attendance_id := public.clock_in(
            p_latitude,
            p_longitude,
            p_accuracy,
            p_client_event_id,
            p_device_recorded_at
        );

        UPDATE public.attendances
        SET
            attendance_source = 'offline',
            is_offline = TRUE,

            validation_status =
                CASE
                    WHEN validation_status IN ('valid', 'late')
                        THEN 'pending_review'
                    ELSE validation_status
                END,

            validation_reason =
                COALESCE(validation_reason || '; ', '') ||
                'Attendance recorded offline and requires server review',

            updated_at = v_now

        WHERE id = v_attendance_id;

    -- --------------------------------------------------------
    -- Check-out offline
    -- --------------------------------------------------------

    ELSE

        v_attendance_id := public.clock_out(
            p_latitude,
            p_longitude,
            p_accuracy,
            p_client_event_id,
            p_device_recorded_at
        );

        UPDATE public.attendances
        SET
            attendance_source = 'offline',
            is_offline = TRUE,
            updated_at = v_now

        WHERE id = v_attendance_id;

    END IF;

    -- --------------------------------------------------------
    -- Anomalie offline
    -- --------------------------------------------------------

    INSERT INTO public.attendance_anomalies (
        attendance_id,
        employee_id,
        site_id,
        type,
        severity,
        description
    )
    SELECT
        a.id,
        a.employee_id,
        a.site_id,
        'offline',
        'medium',
        'Attendance was synchronized after being recorded offline'
    FROM public.attendances a
    WHERE a.id = v_attendance_id;

    RETURN v_attendance_id;

END;
$$;


-- ============================================================
-- 32. APPROBATION PRÉSENCE
-- ============================================================

CREATE OR REPLACE FUNCTION public.approve_attendance(
    p_attendance_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_structure_id UUID;
BEGIN

    SELECT e.structure_id
    INTO v_structure_id
    FROM public.attendances a
    JOIN public.employees e
      ON e.id = a.employee_id
    WHERE a.id = p_attendance_id;

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'Attendance not found';
    END IF;

    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND v_structure_id = public.current_structure_id()
       )
    THEN
        RAISE EXCEPTION
            'You are not allowed to approve this attendance';
    END IF;


    UPDATE public.attendances
    SET
        validation_status = 'valid',
        validated_at = NOW(),
        validation_reason = 'Manually approved',
        updated_at = NOW()
    WHERE id = p_attendance_id;


    INSERT INTO public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        new_data
    )
    VALUES (
        public.current_employee_id(),
        'ATTENDANCE_APPROVED',
        'attendance',
        p_attendance_id,
        jsonb_build_object(
            'validation_status', 'valid'
        )
    );

END;
$$;


-- ============================================================
-- 33. REJET PRÉSENCE
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_attendance(
    p_attendance_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_structure_id UUID;
BEGIN

    SELECT e.structure_id
    INTO v_structure_id
    FROM public.attendances a
    JOIN public.employees e
      ON e.id = a.employee_id
    WHERE a.id = p_attendance_id;

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'Attendance not found';
    END IF;

    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND v_structure_id = public.current_structure_id()
       )
    THEN
        RAISE EXCEPTION
            'You are not allowed to reject this attendance';
    END IF;


    UPDATE public.attendances
    SET
        validation_status = 'rejected',
        validated_at = NOW(),
        validation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_attendance_id;


    INSERT INTO public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        new_data
    )
    VALUES (
        public.current_employee_id(),
        'ATTENDANCE_REJECTED',
        'attendance',
        p_attendance_id,
        jsonb_build_object(
            'validation_status', 'rejected',
            'reason', p_reason
        )
    );

END;
$$;


-- ============================================================
-- 34. APPROBATION INSCRIPTION
-- ============================================================

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
BEGIN

    SELECT structure_id
    INTO v_target_structure
    FROM public.employees
    WHERE id = p_employee_id
      AND account_status = 'pending';

    IF v_target_structure IS NULL THEN
        RAISE EXCEPTION
            'Pending employee not found';
    END IF;


    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_target_structure
       )
    THEN
        RAISE EXCEPTION
            'You cannot approve this registration';
    END IF;


    UPDATE public.employees
    SET
        account_status = 'active',
        is_active = TRUE,

        service_id =
            COALESCE(p_service_id, service_id),

        position_id =
            COALESCE(p_position_id, position_id),

        approved_by = public.current_employee_id(),
        approved_at = NOW(),

        rejection_reason = NULL,
        updated_at = NOW()

    WHERE id = p_employee_id;


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
        jsonb_build_object(
            'account_status', 'active'
        )
    );


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
        'Compte activé',
        'Votre inscription a été validée.',
        'employee',
        p_employee_id
    );

END;
$$;


-- ============================================================
-- 35. REJET INSCRIPTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_registration(
    p_employee_id UUID,
    p_reason TEXT
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
        RAISE EXCEPTION
            'Pending employee not found';
    END IF;


    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_structure_id
       )
    THEN
        RAISE EXCEPTION
            'You cannot reject this registration';
    END IF;


    UPDATE public.employees
    SET
        account_status = 'rejected',
        is_active = FALSE,
        rejection_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_employee_id;


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
        jsonb_build_object(
            'account_status', 'rejected',
            'reason', p_reason
        )
    );


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
        COALESCE(
            'Votre inscription a été refusée : ' || p_reason,
            'Votre inscription a été refusée.'
        ),
        'employee',
        p_employee_id
    );

END;
$$;


-- ============================================================
-- 36. ASSIGNATION EMPLOYÉ -> SITE
-- ============================================================

CREATE OR REPLACE FUNCTION public.assign_employee_site(
    p_employee_id UUID,
    p_site_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_structure UUID;
    v_site_structure UUID;
    v_assignment_id UUID;
BEGIN

    SELECT structure_id
    INTO v_employee_structure
    FROM public.employees
    WHERE id = p_employee_id
      AND is_active = TRUE;

    SELECT structure_id
    INTO v_site_structure
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = TRUE;

    IF v_employee_structure IS NULL THEN
        RAISE EXCEPTION 'Employee not found or inactive';
    END IF;

    IF v_site_structure IS NULL THEN
        RAISE EXCEPTION 'Site not found or inactive';
    END IF;

    IF v_employee_structure <> v_site_structure THEN
        RAISE EXCEPTION
            'Employee and site must belong to the same structure';
    END IF;


    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_employee_structure
       )
    THEN
        RAISE EXCEPTION
            'You cannot assign this employee to this site';
    END IF;


    INSERT INTO public.employee_sites (
        employee_id,
        site_id,
        assigned_by,
        assigned_at,
        is_active
    )
    VALUES (
        p_employee_id,
        p_site_id,
        public.current_employee_id(),
        NOW(),
        TRUE
    )
    ON CONFLICT (employee_id, site_id)
    DO UPDATE
    SET
        is_active = TRUE,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = NOW(),
        updated_at = NOW()
    RETURNING id
    INTO v_assignment_id;


    INSERT INTO public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        new_data
    )
    VALUES (
        public.current_employee_id(),
        'EMPLOYEE_SITE_ASSIGNED',
        'employee_site',
        v_assignment_id,
        jsonb_build_object(
            'employee_id', p_employee_id,
            'site_id', p_site_id
        )
    );


    RETURN v_assignment_id;

END;
$$;


-- ============================================================
-- 37. RETRAIT EMPLOYÉ -> SITE
-- ============================================================

CREATE OR REPLACE FUNCTION public.remove_employee_site(
    p_employee_id UUID,
    p_site_id UUID
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
    WHERE id = p_employee_id;

    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_structure_id
       )
    THEN
        RAISE EXCEPTION
            'You cannot remove this employee from this site';
    END IF;


    -- Un responsable ne peut pas être retiré sans
    -- changer d'abord le responsable du site.
    IF EXISTS (
        SELECT 1
        FROM public.sites
        WHERE id = p_site_id
          AND responsible_employee_id = p_employee_id
    ) THEN
        RAISE EXCEPTION
            'Change the site responsible before removing the employee';
    END IF;


    UPDATE public.employee_sites
    SET
        is_active = FALSE,
        updated_at = NOW()
    WHERE employee_id = p_employee_id
      AND site_id = p_site_id;

END;
$$;


-- ============================================================
-- 38. DÉSIGNER RESPONSABLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.assign_site_responsible(
    p_site_id UUID,
    p_employee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_structure_id UUID;
    v_position_responsible BOOLEAN;
BEGIN

    SELECT structure_id
    INTO v_structure_id
    FROM public.sites
    WHERE id = p_site_id
      AND is_active = TRUE;

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'Site not found';
    END IF;


    IF NOT public.is_admin()
       AND NOT (
           public.is_manager()
           AND public.current_structure_id() = v_structure_id
       )
    THEN
        RAISE EXCEPTION
            'You cannot manage this site';
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.employees e
        JOIN public.employee_roles er
          ON er.employee_id = e.id
        JOIN public.positions p
          ON p.id = e.position_id
        WHERE e.id = p_employee_id
          AND e.structure_id = v_structure_id
          AND e.is_active = TRUE
          AND e.account_status = 'active'
          AND er.role = 'employee'
          AND p.is_responsible_position = TRUE
    ) THEN
        RAISE EXCEPTION
            'Employee is not eligible to be site responsible';
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.employee_sites es
        WHERE es.employee_id = p_employee_id
          AND es.site_id = p_site_id
          AND es.is_active = TRUE
    ) THEN
        RAISE EXCEPTION
            'Employee must be assigned to the site first';
    END IF;


    UPDATE public.sites
    SET
        responsible_employee_id = p_employee_id,
        updated_at = NOW()
    WHERE id = p_site_id;


    INSERT INTO public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        new_data
    )
    VALUES (
        public.current_employee_id(),
        'SITE_RESPONSIBLE_CHANGED',
        'site',
        p_site_id,
        jsonb_build_object(
            'responsible_employee_id', p_employee_id
        )
    );

END;
$$;


-- ============================================================
-- 39. DASHBOARD ADMIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard(
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;


    SELECT jsonb_build_object(

        'employees_total',
        (
            SELECT COUNT(*)
            FROM public.employees
            WHERE account_status = 'active'
              AND is_active = TRUE
        ),

        'present_today',
        (
            SELECT COUNT(DISTINCT a.employee_id)
            FROM public.attendances a
            JOIN public.employees e
              ON e.id = a.employee_id
            WHERE a.attendance_date = p_date
              AND e.is_active = TRUE
              AND a.validation_status <> 'rejected'
        ),

        'late_today',
        (
            SELECT COUNT(*)
            FROM public.attendances a
            WHERE a.attendance_date = p_date
              AND a.validation_status = 'late'
        ),

        'absent_today',
        (
            SELECT COUNT(*)
            FROM public.employees e
            WHERE e.account_status = 'active'
              AND e.is_active = TRUE
              AND e.id NOT IN (
                  SELECT a.employee_id
                  FROM public.attendances a
                  WHERE a.attendance_date = p_date
              )
        ),

        'anomalies_today',
        (
            SELECT COUNT(*)
            FROM public.attendance_anomalies aa
            WHERE aa.detected_at::DATE = p_date
        ),

        'by_structure',
        (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'structure_id', x.structure_id,
                        'structure_name', x.structure_name,
                        'employees', x.employee_count,
                        'present', x.present_count,
                        'late', x.late_count,
                        'absent',
                            GREATEST(
                                x.employee_count - x.present_count,
                                0
                            )
                    )
                    ORDER BY x.structure_name
                ),
                '[]'::JSONB
            )
            FROM (
                SELECT
                    s.id AS structure_id,
                    s.name AS structure_name,

                    COUNT(DISTINCT e.id)
                        AS employee_count,

                    COUNT(
                        DISTINCT a.employee_id
                    ) AS present_count,

                    COUNT(
                        DISTINCT a.employee_id
                    ) FILTER (
                        WHERE a.validation_status = 'late'
                    ) AS late_count

                FROM public.structures s

                LEFT JOIN public.employees e
                    ON e.structure_id = s.id
                   AND e.is_active = TRUE
                   AND e.account_status = 'active'

                LEFT JOIN public.attendances a
                    ON a.employee_id = e.id
                   AND a.attendance_date = p_date
                   AND a.validation_status <> 'rejected'

                WHERE s.is_active = TRUE

                GROUP BY s.id, s.name
            ) x
        )

    )
    INTO result;


    RETURN result;

END;
$$;


-- ============================================================
-- 40. DASHBOARD MANAGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_manager_dashboard(
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN

    IF NOT public.is_manager() THEN
        RAISE EXCEPTION 'Manager access required';
    END IF;


    SELECT jsonb_build_object(

        'structure_id',
        public.current_structure_id(),

        'employees_total',
        (
            SELECT COUNT(*)
            FROM public.employees
            WHERE structure_id = public.current_structure_id()
              AND account_status = 'active'
              AND is_active = TRUE
        ),

        'present_today',
        (
            SELECT COUNT(DISTINCT a.employee_id)
            FROM public.attendances a
            JOIN public.employees e
              ON e.id = a.employee_id
            WHERE e.structure_id = public.current_structure_id()
              AND a.attendance_date = p_date
              AND a.validation_status <> 'rejected'
        ),

        'late_today',
        (
            SELECT COUNT(*)
            FROM public.attendances a
            JOIN public.employees e
              ON e.id = a.employee_id
            WHERE e.structure_id = public.current_structure_id()
              AND a.attendance_date = p_date
              AND a.validation_status = 'late'
        ),

        'absent_today',
        (
            SELECT COUNT(*)
            FROM public.employees e
            WHERE e.structure_id = public.current_structure_id()
              AND e.account_status = 'active'
              AND e.is_active = TRUE
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.attendances a
                  WHERE a.employee_id = e.id
                    AND a.attendance_date = p_date
              )
        )

    )
    INTO result;


    RETURN result;

END;
$$;


-- ============================================================
-- 41. DASHBOARD RESPONSABLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_responsible_dashboard(
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM public.sites
        WHERE responsible_employee_id =
            public.current_employee_id()
    ) THEN
        RAISE EXCEPTION
            'Site responsible access required';
    END IF;


    SELECT jsonb_build_object(

        'sites',
        (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'site_id', s.id,
                        'site_name', s.name,

                        'employees',
                        (
                            SELECT COUNT(*)
                            FROM public.employee_sites es
                            JOIN public.employees e
                              ON e.id = es.employee_id
                            WHERE es.site_id = s.id
                              AND es.is_active = TRUE
                              AND e.is_active = TRUE
                        ),

                        'present',
                        (
                            SELECT COUNT(DISTINCT a.employee_id)
                            FROM public.attendances a
                            WHERE a.site_id = s.id
                              AND a.attendance_date = p_date
                              AND a.validation_status <> 'rejected'
                        ),

                        'late',
                        (
                            SELECT COUNT(*)
                            FROM public.attendances a
                            WHERE a.site_id = s.id
                              AND a.attendance_date = p_date
                              AND a.validation_status = 'late'
                        )
                    )
                ),
                '[]'::JSONB
            )
            FROM public.sites s
            WHERE s.responsible_employee_id =
                public.current_employee_id()
              AND s.is_active = TRUE
        )

    )
    INTO result;


    RETURN result;

END;
$$;


-- ============================================================
-- 42. RLS : ACTIVER
-- ============================================================

ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 43. RLS STRUCTURES
-- ============================================================

DROP POLICY IF EXISTS structures_select_v3
ON public.structures;

CREATE POLICY structures_select_v3
ON public.structures
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR id = public.current_structure_id()
    )
);


-- ============================================================
-- 44. RLS CITIES
-- ============================================================

DROP POLICY IF EXISTS cities_select_v3
ON public.cities;

CREATE POLICY cities_select_v3
ON public.cities
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 45. RLS SITES
-- ============================================================

DROP POLICY IF EXISTS sites_select_v3
ON public.sites;

CREATE POLICY sites_select_v3
ON public.sites
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR structure_id = public.current_structure_id()
        OR public.is_site_responsible(id)
    )
);


-- ============================================================
-- 46. RLS EMPLOYEES
-- ============================================================

DROP POLICY IF EXISTS employees_select_v3
ON public.employees;

CREATE POLICY employees_select_v3
ON public.employees
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR id = public.current_employee_id()
        OR (
            public.is_manager()
            AND structure_id = public.current_structure_id()
        )
        OR EXISTS (
            SELECT 1
            FROM public.sites s
            WHERE s.responsible_employee_id =
                public.current_employee_id()
              AND s.structure_id = employees.structure_id
        )
    )
);


-- ============================================================
-- 47. RLS EMPLOYEE_SITES
-- ============================================================

DROP POLICY IF EXISTS employee_sites_select_v3
ON public.employee_sites;

CREATE POLICY employee_sites_select_v3
ON public.employee_sites
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()

        OR employee_id = public.current_employee_id()

        OR (
            public.is_manager()
            AND EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = employee_sites.employee_id
                  AND e.structure_id =
                      public.current_structure_id()
            )
        )

        OR EXISTS (
            SELECT 1
            FROM public.sites s
            WHERE s.id = employee_sites.site_id
              AND s.responsible_employee_id =
                  public.current_employee_id()
        )
    )
);


-- Pas de INSERT/UPDATE direct.
-- Les opérations passent par assign_employee_site().
DROP POLICY IF EXISTS employee_sites_insert_v3
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_update_v3
ON public.employee_sites;

DROP POLICY IF EXISTS employee_sites_delete_v3
ON public.employee_sites;


-- ============================================================
-- 48. RLS EMPLOYEE ROLES
-- ============================================================

DROP POLICY IF EXISTS employee_roles_select_v3
ON public.employee_roles;

CREATE POLICY employee_roles_select_v3
ON public.employee_roles
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()

        OR employee_id = public.current_employee_id()

        OR (
            public.is_manager()
            AND EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = employee_roles.employee_id
                  AND e.structure_id =
                      public.current_structure_id()
            )
        )
    )
);


-- Aucun INSERT/UPDATE/DELETE direct.
-- Les rôles sensibles passent par RPC.
DROP POLICY IF EXISTS employee_roles_insert_v3
ON public.employee_roles;

DROP POLICY IF EXISTS employee_roles_update_v3
ON public.employee_roles;

DROP POLICY IF EXISTS employee_roles_delete_v3
ON public.employee_roles;


-- ============================================================
-- 49. RLS ATTENDANCES
-- ============================================================

DROP POLICY IF EXISTS attendances_select_v3
ON public.attendances;

CREATE POLICY attendances_select_v3
ON public.attendances
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()

        OR employee_id = public.current_employee_id()

        OR (
            public.is_manager()
            AND EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = attendances.employee_id
                  AND e.structure_id =
                      public.current_structure_id()
            )
        )

        OR (
            public.is_site_responsible(site_id)
        )
    )
);


-- IMPORTANT :
-- Aucun INSERT direct.
DROP POLICY IF EXISTS attendances_insert_v3
ON public.attendances;

DROP POLICY IF EXISTS attendances_update_v3
ON public.attendances;

DROP POLICY IF EXISTS attendances_delete_v3
ON public.attendances;


-- ============================================================
-- 50. RLS ANOMALIES
-- ============================================================

DROP POLICY IF EXISTS attendance_anomalies_select_v3
ON public.attendance_anomalies;

CREATE POLICY attendance_anomalies_select_v3
ON public.attendance_anomalies
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()

        OR employee_id = public.current_employee_id()

        OR (
            public.is_manager()
            AND EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = attendance_anomalies.employee_id
                  AND e.structure_id =
                      public.current_structure_id()
            )
        )

        OR public.is_site_responsible(site_id)
    )
);


-- ============================================================
-- 51. RLS NOTIFICATIONS
-- ============================================================

DROP POLICY IF EXISTS notifications_select_v3
ON public.notifications;

CREATE POLICY notifications_select_v3
ON public.notifications
FOR SELECT
TO authenticated
USING (
    recipient_employee_id =
        public.current_employee_id()
);


DROP POLICY IF EXISTS notifications_update_v3
ON public.notifications;

CREATE POLICY notifications_update_v3
ON public.notifications
FOR UPDATE
TO authenticated
USING (
    recipient_employee_id =
        public.current_employee_id()
)
WITH CHECK (
    recipient_employee_id =
        public.current_employee_id()
);


-- ============================================================
-- 52. RLS ABSENCES
-- ============================================================

DROP POLICY IF EXISTS employee_absences_select_v3
ON public.employee_absences;

CREATE POLICY employee_absences_select_v3
ON public.employee_absences
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()

        OR employee_id = public.current_employee_id()

        OR (
            public.is_manager()
            AND structure_id =
                public.current_structure_id()
        )
    )
);


-- ============================================================
-- 53. RLS AUDIT
-- ============================================================

DROP POLICY IF EXISTS audit_logs_select_v3
ON public.audit_logs;

CREATE POLICY audit_logs_select_v3
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    public.is_admin()
);


-- ============================================================
-- 54. RLS REPORTS
-- ============================================================

DROP POLICY IF EXISTS reports_select_v3
ON public.reports;

CREATE POLICY reports_select_v3
ON public.reports
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()

        OR author_employee_id =
            public.current_employee_id()

        OR recipient_employee_id =
            public.current_employee_id()

        OR (
            public.is_manager()
            AND structure_id =
                public.current_structure_id()
        )

        OR public.is_site_responsible(site_id)
    )
);


-- ============================================================
-- 55. PERMISSIONS RPC
-- ============================================================

REVOKE ALL ON FUNCTION public.clock_in(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clock_in(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


REVOKE ALL ON FUNCTION public.clock_out(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clock_out(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


REVOKE ALL ON FUNCTION public.sync_offline_attendance(
    public.attendance_event_type,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    UUID,
    TIMESTAMPTZ
)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_offline_attendance(
    public.attendance_event_type,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    UUID,
    TIMESTAMPTZ
)
TO authenticated;


REVOKE ALL ON FUNCTION public.approve_attendance(UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_attendance(UUID)
TO authenticated;


REVOKE ALL ON FUNCTION public.reject_attendance(UUID, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reject_attendance(UUID, TEXT)
TO authenticated;


REVOKE ALL ON FUNCTION public.approve_registration(UUID, UUID, UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_registration(UUID, UUID, UUID)
TO authenticated;


REVOKE ALL ON FUNCTION public.reject_registration(UUID, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reject_registration(UUID, TEXT)
TO authenticated;


REVOKE ALL ON FUNCTION public.assign_employee_site(UUID, UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.assign_employee_site(UUID, UUID)
TO authenticated;


REVOKE ALL ON FUNCTION public.remove_employee_site(UUID, UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.remove_employee_site(UUID, UUID)
TO authenticated;


REVOKE ALL ON FUNCTION public.assign_site_responsible(UUID, UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.assign_site_responsible(UUID, UUID)
TO authenticated;


REVOKE ALL ON FUNCTION public.get_admin_dashboard(DATE)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard(DATE)
TO authenticated;


REVOKE ALL ON FUNCTION public.get_manager_dashboard(DATE)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_manager_dashboard(DATE)
TO authenticated;


REVOKE ALL ON FUNCTION public.get_responsible_dashboard(DATE)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_responsible_dashboard(DATE)
TO authenticated;


-- ============================================================
-- 56. INDEXES ORGANISATIONNELS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employees_structure_active
ON public.employees(structure_id, is_active, account_status);

CREATE INDEX IF NOT EXISTS idx_employees_structure
ON public.employees(structure_id);

CREATE INDEX IF NOT EXISTS idx_sites_structure_active
ON public.sites(structure_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employee_sites_site_active
ON public.employee_sites(site_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employee_sites_employee_active
ON public.employee_sites(employee_id, is_active);


-- ============================================================
-- 57. TIMESTAMPS AUTOMATIQUES
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_structures_updated_at
ON public.structures;

CREATE TRIGGER trg_structures_updated_at
BEFORE UPDATE ON public.structures
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_employees_updated_at
ON public.employees;

CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_sites_updated_at
ON public.sites;

CREATE TRIGGER trg_sites_updated_at
BEFORE UPDATE ON public.sites
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


DROP TRIGGER IF EXISTS trg_employee_sites_updated_at
ON public.employee_sites;

CREATE TRIGGER trg_employee_sites_updated_at
BEFORE UPDATE ON public.employee_sites
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 58. PROTECTION CONTRE L'AUTO-PROMOTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_role public.employee_role;
BEGIN

    caller_role := public.current_employee_role();

    -- Seul admin peut attribuer admin.
    IF NEW.role = 'admin'
       AND caller_role <> 'admin'
    THEN
        RAISE EXCEPTION
            'Only an admin can assign admin role';
    END IF;


    -- Un manager ne peut pas créer/promouvoir un manager.
    IF NEW.role = 'manager'
       AND caller_role <> 'admin'
    THEN
        RAISE EXCEPTION
            'Only an admin can assign manager role';
    END IF;


    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS trg_prevent_privilege_escalation
ON public.employee_roles;

CREATE TRIGGER trg_prevent_privilege_escalation
BEFORE INSERT OR UPDATE OF role
ON public.employee_roles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_privilege_escalation();


-- ============================================================
-- 59. PROTECTION STRUCTURE
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_employee_structure_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF TG_OP = 'UPDATE'
       AND NEW.structure_id IS DISTINCT FROM OLD.structure_id
    THEN

        IF public.current_employee_role() <> 'admin' THEN
            RAISE EXCEPTION
                'Only an admin can change an employee structure';
        END IF;

    END IF;

    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS trg_prevent_employee_structure_change
ON public.employees;

CREATE TRIGGER trg_prevent_employee_structure_change
BEFORE UPDATE OF structure_id
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.prevent_employee_structure_change();


-- ============================================================
-- 60. PROTECTION AUTH USER
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_auth_user_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
        RAISE EXCEPTION
            'auth_user_id cannot be changed';
    END IF;

    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS trg_prevent_auth_user_change
ON public.employees;

CREATE TRIGGER trg_prevent_auth_user_change
BEFORE UPDATE OF auth_user_id
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.prevent_auth_user_change();


-- ============================================================
-- 61. VUES POUR LES DASHBOARDS
-- ============================================================

CREATE OR REPLACE VIEW public.employee_site_overview
WITH (security_invoker = true)
AS
SELECT
    e.id AS employee_id,
    e.first_name,
    e.last_name,
    e.structure_id,

    es.site_id,
    s.name AS site_name,

    s.responsible_employee_id,

    e.account_status,
    e.is_active

FROM public.employees e
JOIN public.employee_sites es
    ON es.employee_id = e.id
   AND es.is_active = TRUE
JOIN public.sites s
    ON s.id = es.site_id
   AND s.is_active = TRUE;


-- ============================================================
-- 62. VUE PRÉSENCE JOURNALIÈRE
-- ============================================================

CREATE OR REPLACE VIEW public.daily_attendance_overview
WITH (security_invoker = true)
AS
SELECT

    a.id,
    a.attendance_date,

    a.employee_id,

    e.first_name,
    e.last_name,

    e.structure_id,

    a.site_id,
    s.name AS site_name,

    a.check_in,
    a.check_out,

    a.validation_status,

    a.attendance_source,
    a.is_offline,

    a.check_in_accuracy_m,

    a.server_received_at,
    a.validated_at

FROM public.attendances a

JOIN public.employees e
    ON e.id = a.employee_id

LEFT JOIN public.sites s
    ON s.id = a.site_id;


-- ============================================================
-- 63. NOTIFICATION DES RETARDS
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_late_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NEW.validation_status = 'late' THEN

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
            'late',
            'Retard enregistré',
            'Un retard a été détecté sur votre pointage.',
            'attendance',
            NEW.id
        FROM public.employees e
        WHERE e.id = NEW.employee_id;


        -- Notification manager
        INSERT INTO public.notifications (
            recipient_employee_id,
            type,
            title,
            message,
            entity_type,
            entity_id
        )
        SELECT
            m.id,
            'late',
            'Retard employé',
            e.first_name || ' ' ||
            e.last_name ||
            ' est arrivé en retard.',
            'attendance',
            NEW.id

        FROM public.employees e

        JOIN public.employees m
            ON m.structure_id = e.structure_id

        JOIN public.employee_roles mr
            ON mr.employee_id = m.id
           AND mr.role = 'manager'

        WHERE e.id = NEW.employee_id;

    END IF;

    RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS trg_notify_late_attendance
ON public.attendances;

CREATE TRIGGER trg_notify_late_attendance
AFTER INSERT OR UPDATE OF validation_status
ON public.attendances
FOR EACH ROW
WHEN (
    NEW.validation_status = 'late'
)
EXECUTE FUNCTION public.notify_late_attendance();


-- ============================================================
-- 64. SÉCURITÉ DES FONCTIONS
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.calculate_distance_meters(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION
)
FROM PUBLIC;


REVOKE EXECUTE
ON FUNCTION public.find_employee_site_by_gps(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION
)
FROM PUBLIC;


GRANT EXECUTE
ON FUNCTION public.find_employee_site_by_gps(
    DOUBLE PRECISION,
    DOUBLE PRECISION,
    DOUBLE PRECISION
)
TO authenticated;


-- ============================================================
-- 65. FIN
-- ============================================================

COMMIT;