-- ============================================================
-- MIGRATION : employee_sites
-- Modèle :
--   - Un employé peut travailler sur plusieurs sites
--   - Un employé peut avoir au maximum un site responsable
--   - Le site responsable doit être un site auquel l'employé
--     est effectivement affecté
--   - Les affectations peuvent être désactivées sans être supprimées
-- ============================================================

BEGIN;

-- ============================================================
-- 1. AJOUT DE LA COLONNE is_responsible
-- ============================================================

ALTER TABLE public.employee_sites
ADD COLUMN IF NOT EXISTS is_responsible
    boolean NOT NULL DEFAULT false;


-- ============================================================
-- 2. INDEX
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employee_sites_employee_active
ON public.employee_sites (employee_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employee_sites_site_active
ON public.employee_sites (site_id, is_active);

CREATE INDEX IF NOT EXISTS idx_employee_sites_responsible
ON public.employee_sites (employee_id, is_responsible)
WHERE is_active = true;


-- ============================================================
-- 3. CONTRAINTE :
--    UN SEUL SITE RESPONSABLE ACTIF PAR EMPLOYÉ
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
idx_employee_sites_one_responsible
ON public.employee_sites (employee_id)
WHERE is_active = true
  AND is_responsible = true;


-- ============================================================
-- 4. FONCTION DE VALIDATION
--
-- Cette fonction vérifie :
--
--   A. employee_id existe
--   B. site_id appartient à la même structure que l'employé
--   C. un site responsable doit être actif
--
-- IMPORTANT :
-- Cette fonction NE bloque PLUS plusieurs sites par employé.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_employee_site_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    employee_structure_id uuid;
    site_structure_id uuid;
BEGIN

    -- --------------------------------------------------------
    -- Récupération de la structure de l'employé
    -- --------------------------------------------------------

    SELECT e.structure_id
    INTO employee_structure_id
    FROM public.employees e
    WHERE e.id = NEW.employee_id;

    IF employee_structure_id IS NULL THEN
        RAISE EXCEPTION
            'L''employé % n''existe pas ou ne possède aucune structure.',
            NEW.employee_id;
    END IF;


    -- --------------------------------------------------------
    -- Récupération de la structure du site
    -- --------------------------------------------------------

    SELECT s.structure_id
    INTO site_structure_id
    FROM public.sites s
    WHERE s.id = NEW.site_id;

    IF site_structure_id IS NULL THEN
        RAISE EXCEPTION
            'Le site % n''existe pas ou ne possède aucune structure.',
            NEW.site_id;
    END IF;


    -- --------------------------------------------------------
    -- L'employé et le site doivent appartenir
    -- à la même structure
    -- --------------------------------------------------------

    IF employee_structure_id <> site_structure_id THEN
        RAISE EXCEPTION
            'Impossible d''affecter l''employé % au site % : '
            'l''employé et le site appartiennent à des structures différentes.',
            NEW.employee_id,
            NEW.site_id;
    END IF;


    -- --------------------------------------------------------
    -- Un site responsable doit obligatoirement être actif
    -- --------------------------------------------------------

    IF NEW.is_responsible = true
       AND NEW.is_active = false THEN

        RAISE EXCEPTION
            'Une affectation inactive ne peut pas être définie comme site responsable.';
    END IF;


    RETURN NEW;

END;
$$;


-- ============================================================
-- 5. SUPPRESSION DE L'ANCIEN TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS
trg_validate_employee_site_assignment
ON public.employee_sites;


-- ============================================================
-- 6. RECRÉATION DU TRIGGER
-- ============================================================

CREATE TRIGGER trg_validate_employee_site_assignment
BEFORE INSERT OR UPDATE
ON public.employee_sites
FOR EACH ROW
EXECUTE FUNCTION public.validate_employee_site_assignment();


-- ============================================================
-- 7. TRIGGER updated_at
-- ============================================================

DROP TRIGGER IF EXISTS
trg_employee_sites_updated_at
ON public.employee_sites;


CREATE TRIGGER trg_employee_sites_updated_at
BEFORE UPDATE
ON public.employee_sites
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 8. NETTOYAGE DES DONNÉES EXISTANTES
--
-- Si plusieurs affectations d'un même employé sont actuellement
-- marquées responsables, on en conserve une seule.
-- ============================================================

WITH responsible_duplicates AS (
    SELECT
        id,
        employee_id,
        ROW_NUMBER() OVER (
            PARTITION BY employee_id
            ORDER BY assigned_at ASC, created_at ASC, id ASC
        ) AS rn
    FROM public.employee_sites
    WHERE is_active = true
      AND is_responsible = true
)
UPDATE public.employee_sites es
SET
    is_responsible = false,
    updated_at = now()
FROM responsible_duplicates rd
WHERE es.id = rd.id
  AND rd.rn > 1;


-- ============================================================
-- 9. SÉCURISATION :
--    Un employé inactif ne doit pas conserver un site
--    responsable actif.
-- ============================================================

UPDATE public.employee_sites es
SET
    is_responsible = false,
    updated_at = now()
FROM public.employees e
WHERE es.employee_id = e.id
  AND es.is_responsible = true
  AND (
      es.is_active = false
      OR e.is_active = false
  );


COMMIT;