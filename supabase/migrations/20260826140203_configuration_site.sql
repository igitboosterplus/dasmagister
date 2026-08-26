-- ============================================================
-- MIGRATION V2
-- CONFIGURATION DES SITES & DONNÉES DE PRÉSENCE
-- ============================================================

BEGIN;

-- ============================================================
-- 1. EXTENSION DE LA TABLE SITES
-- ============================================================

ALTER TABLE public.sites

  ADD COLUMN IF NOT EXISTS address TEXT,

  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS location_radius_m INTEGER NOT NULL DEFAULT 100,

  ADD COLUMN IF NOT EXISTS max_gps_accuracy_m INTEGER NOT NULL DEFAULT 100,

  ADD COLUMN IF NOT EXISTS gps_required BOOLEAN NOT NULL DEFAULT FALSE,

  ADD COLUMN IF NOT EXISTS wifi_ssid TEXT,

  ADD COLUMN IF NOT EXISTS wifi_required BOOLEAN NOT NULL DEFAULT FALSE,

  ADD COLUMN IF NOT EXISTS offline_attendance_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Douala',

  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ============================================================
-- 2. CORRECTION DES ANCIENNES DONNÉES
-- ============================================================

-- Les anciens sites ne disposant pas encore de coordonnées
-- ne doivent pas être considérés comme nécessitant le GPS.

UPDATE public.sites
SET gps_required = FALSE
WHERE latitude IS NULL
   OR longitude IS NULL;


-- ============================================================
-- 3. INDEX SITES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sites_structure_id
  ON public.sites(structure_id);

CREATE INDEX IF NOT EXISTS idx_sites_city_id
  ON public.sites(city_id);

CREATE INDEX IF NOT EXISTS idx_sites_active
  ON public.sites(is_active);

CREATE INDEX IF NOT EXISTS idx_sites_coordinates
  ON public.sites(latitude, longitude);


-- ============================================================
-- 4. HORAIRES DES SITES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_work_schedules (

  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id UUID NOT NULL
    REFERENCES public.sites(id)
    ON DELETE CASCADE,

  day_of_week SMALLINT NOT NULL,

  is_working_day BOOLEAN NOT NULL DEFAULT TRUE,

  work_start TIME,

  work_end TIME,

  break_start TIME,

  break_end TIME,

  grace_period_minutes INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT site_work_schedules_unique_day
    UNIQUE(site_id, day_of_week)

);


CREATE INDEX IF NOT EXISTS idx_site_work_schedules_site_id
  ON public.site_work_schedules(site_id);


-- ============================================================
-- 5. MIGRATION DES HORAIRES EXISTANTS
-- ============================================================

-- 1 = lundi
-- 2 = mardi
-- 3 = mercredi
-- 4 = jeudi
-- 5 = vendredi
-- 6 = samedi
-- 7 = dimanche

INSERT INTO public.site_work_schedules (
  site_id,
  day_of_week,
  is_working_day,
  work_start,
  work_end
)

SELECT
  s.id,
  d.day_of_week,

  CASE
    WHEN d.day_of_week BETWEEN 1 AND 5
         AND s.work_start IS NOT NULL
         AND s.work_end IS NOT NULL
    THEN TRUE
    ELSE FALSE
  END,

  CASE
    WHEN d.day_of_week BETWEEN 1 AND 5
    THEN s.work_start
    ELSE NULL
  END,

  CASE
    WHEN d.day_of_week BETWEEN 1 AND 5
    THEN s.work_end
    ELSE NULL
  END

FROM public.sites s

CROSS JOIN (
  VALUES
    (1),
    (2),
    (3),
    (4),
    (5),
    (6),
    (7)
) AS d(day_of_week)

ON CONFLICT (site_id, day_of_week)
DO NOTHING;


-- ============================================================
-- 6. TRIGGER updated_at
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


-- ============================================================
-- 7. TRIGGER SITES
-- ============================================================

DROP TRIGGER IF EXISTS trg_sites_updated_at
ON public.sites;

CREATE TRIGGER trg_sites_updated_at

BEFORE UPDATE ON public.sites

FOR EACH ROW

EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 8. TRIGGER HORAIRES
-- ============================================================

DROP TRIGGER IF EXISTS trg_site_work_schedules_updated_at
ON public.site_work_schedules;

CREATE TRIGGER trg_site_work_schedules_updated_at

BEFORE UPDATE ON public.site_work_schedules

FOR EACH ROW

EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 9. INFORMATIONS GPS DES PRÉSENCES
-- ============================================================

ALTER TABLE public.attendances

  ADD COLUMN IF NOT EXISTS
    check_in_latitude DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    check_in_longitude DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    check_in_accuracy_m DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    check_out_latitude DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    check_out_longitude DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    check_out_accuracy_m DOUBLE PRECISION;


-- ============================================================
-- 10. INFORMATIONS DE VALIDATION
-- ============================================================

ALTER TABLE public.attendances

  ADD COLUMN IF NOT EXISTS
    check_in_distance_m DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    check_out_distance_m DOUBLE PRECISION,

  ADD COLUMN IF NOT EXISTS
    validation_method TEXT,

  ADD COLUMN IF NOT EXISTS
    validation_status TEXT;


-- ============================================================
-- 11. INFORMATIONS DE SYNCHRONISATION
-- ============================================================

ALTER TABLE public.attendances

  ADD COLUMN IF NOT EXISTS
    client_timestamp TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS
    synced_at TIMESTAMPTZ;


-- ============================================================
-- 12. INDEX ATTENDANCES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_attendances_employee_id
  ON public.attendances(employee_id);

CREATE INDEX IF NOT EXISTS idx_attendances_site_id
  ON public.attendances(site_id);

CREATE INDEX IF NOT EXISTS idx_attendances_date
  ON public.attendances(attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendances_employee_date
  ON public.attendances(employee_id, attendance_date);


COMMIT;