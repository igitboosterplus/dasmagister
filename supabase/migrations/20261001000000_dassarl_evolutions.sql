-- ============================================================
-- ÉVOLUTIONS SPÉCIFIQUES "DAS-SARL"
-- Missions, Absences Workflow et Types de rapports isolés
-- ============================================================

BEGIN;

-- ============================================================
-- 1. NOUVEAUX ENUMS
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mission_status') THEN
        CREATE TYPE public.mission_status AS ENUM (
            'assigned',
            'in_progress',
            'completed',
            'cancelled'
        );
    END IF;
END
$$;

-- ============================================================
-- 2. MODIFICATION DE LA TABLE DES ABSENCES
-- ============================================================

ALTER TABLE public.employee_absences
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Ajout des politiques d'insertion pour les employés
DROP POLICY IF EXISTS employee_absences_insert_own ON public.employee_absences;
CREATE POLICY employee_absences_insert_own
ON public.employee_absences
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
    AND structure_id = public.current_structure_id()
);

-- ============================================================
-- 3. MODIFICATION DES TYPES DE RAPPORTS
-- ============================================================

-- On ajoute la granularité par structure (+ désactivation)
ALTER TABLE public.report_types
ADD COLUMN IF NOT EXISTS structure_id UUID REFERENCES public.structures(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Modification de la contrainte UNIQUE
-- L'ancienne empêchait deux structures d'avoir le même nom de rapport.
ALTER TABLE public.report_types DROP CONSTRAINT IF EXISTS report_types_name_key;

-- Nouvelle contrainte qui tolère les NULL pour structure_id (types globaux existants) et évite
-- les doublons de noms DANS une même structure.
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_types_structure_name 
ON public.report_types(COALESCE(structure_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- RLS: Select (On voit les types globaux + ceux de sa structure, à condition d'être actif)
DROP POLICY IF EXISTS authenticated_can_view_report_types ON public.report_types;
DROP POLICY IF EXISTS report_types_select ON public.report_types;

CREATE POLICY report_types_select
ON public.report_types
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active() 
    AND (
        structure_id IS NULL 
        OR structure_id = public.current_structure_id()
        OR public.is_admin()
    )
    AND is_active = TRUE
);

-- RLS: Manager peut insérer/modifier sur sa propre structure
CREATE POLICY report_types_insert_manager
ON public.report_types
FOR INSERT
TO authenticated
WITH CHECK (
    (public.is_manager() AND structure_id = public.current_structure_id())
    OR public.is_admin()
);

CREATE POLICY report_types_update_manager
ON public.report_types
FOR UPDATE
TO authenticated
USING (
    (public.is_manager() AND structure_id = public.current_structure_id())
    OR public.is_admin()
)
WITH CHECK (
    (public.is_manager() AND structure_id = public.current_structure_id())
    OR public.is_admin()
);

-- ============================================================
-- 4. CRÉATION DE LA TABLE DES MISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    structure_id UUID NOT NULL REFERENCES public.structures(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    
    title VARCHAR(200) NOT NULL,
    description TEXT,
    location VARCHAR(200),
    
    planned_start TIMESTAMPTZ NOT NULL,
    planned_end TIMESTAMPTZ,
    
    status public.mission_status NOT NULL DEFAULT 'assigned',
    
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT missions_dates_check CHECK (planned_end IS NULL OR planned_end >= planned_start)
);

CREATE INDEX IF NOT EXISTS idx_missions_structure ON public.missions(structure_id);
CREATE INDEX IF NOT EXISTS idx_missions_employee ON public.missions(employee_id);

-- RLS Missions
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY missions_select
ON public.missions
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR (public.is_manager() AND structure_id = public.current_structure_id())
        OR (employee_id = public.current_employee_id())
    )
);

CREATE POLICY missions_insert
ON public.missions
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager() 
        AND structure_id = public.current_structure_id() 
        AND public.employee_belongs_to_current_structure(employee_id)
    )
);

CREATE POLICY missions_update
ON public.missions
FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR (
        public.is_manager() 
        AND structure_id = public.current_structure_id()
    )
)
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager() 
        AND structure_id = public.current_structure_id() 
        AND public.employee_belongs_to_current_structure(employee_id)
    )
);

-- ============================================================
-- 5. RPC SECURISEES (WORKFLOW)
-- ============================================================

-- A. Démarrer une mission (employé)
CREATE OR REPLACE FUNCTION public.start_mission(p_mission_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mission public.missions%ROWTYPE;
BEGIN
    SELECT * INTO v_mission FROM public.missions WHERE id = p_mission_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mission not found';
    END IF;
    
    IF v_mission.employee_id <> public.current_employee_id() THEN
        RAISE EXCEPTION 'You are not assigned to this mission';
    END IF;
    
    IF v_mission.status <> 'assigned' THEN
        RAISE EXCEPTION 'Mission is not in assigned state';
    END IF;
    
    UPDATE public.missions
    SET status = 'in_progress',
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_mission_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_mission(UUID) TO authenticated;

-- B. Terminer une mission (employé)
CREATE OR REPLACE FUNCTION public.complete_mission(p_mission_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mission public.missions%ROWTYPE;
BEGIN
    SELECT * INTO v_mission FROM public.missions WHERE id = p_mission_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mission not found';
    END IF;
    
    IF v_mission.employee_id <> public.current_employee_id() THEN
        RAISE EXCEPTION 'You are not assigned to this mission';
    END IF;
    
    IF v_mission.status <> 'in_progress' THEN
        RAISE EXCEPTION 'Mission is not in progress';
    END IF;
    
    UPDATE public.missions
    SET status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_mission_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_mission(UUID) TO authenticated;

-- C. Approuver une absence (manager)
CREATE OR REPLACE FUNCTION public.approve_absence(p_absence_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_absence public.employee_absences%ROWTYPE;
BEGIN
    SELECT * INTO v_absence FROM public.employee_absences WHERE id = p_absence_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Absence not found';
    END IF;
    
    IF NOT public.is_admin() AND NOT (public.is_manager() AND public.current_structure_id() = v_absence.structure_id) THEN
        RAISE EXCEPTION 'Not authorized to approve this absence';
    END IF;
    
    IF v_absence.status <> 'pending' THEN
        RAISE EXCEPTION 'Absence is not pending';
    END IF;
    
    UPDATE public.employee_absences
    SET status = 'approved',
        approved_by = public.current_employee_id(),
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_absence_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_absence(UUID) TO authenticated;

-- D. Rejeter une absence (manager)
CREATE OR REPLACE FUNCTION public.reject_absence(p_absence_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_absence public.employee_absences%ROWTYPE;
BEGIN
    SELECT * INTO v_absence FROM public.employee_absences WHERE id = p_absence_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Absence not found';
    END IF;
    
    IF NOT public.is_admin() AND NOT (public.is_manager() AND public.current_structure_id() = v_absence.structure_id) THEN
        RAISE EXCEPTION 'Not authorized to reject this absence';
    END IF;
    
    IF v_absence.status <> 'pending' THEN
        RAISE EXCEPTION 'Absence is not pending';
    END IF;
    
    UPDATE public.employee_absences
    SET status = 'rejected',
        rejection_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_absence_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_absence(UUID, TEXT) TO authenticated;


COMMIT;
