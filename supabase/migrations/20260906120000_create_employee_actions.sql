-- ============================================================
-- EMPLOYEE ACTIONS TABLE
-- Création de la table employee_actions si elle n'existe pas.
-- Cette table est requise avant l'application du RLS dans
-- la migration 20260907164021.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.employee_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    structure_id UUID NOT NULL
        REFERENCES public.structures(id)
        ON DELETE CASCADE,

    action_type TEXT NOT NULL,

    description TEXT,

    performed_by UUID
        REFERENCES public.employees(id)
        ON DELETE SET NULL,

    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_actions_employee
ON public.employee_actions(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_actions_structure
ON public.employee_actions(structure_id);

CREATE INDEX IF NOT EXISTS idx_employee_actions_performed_at
ON public.employee_actions(performed_at DESC);
