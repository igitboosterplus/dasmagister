-- ============================================================
-- BASE DE DONNÉES X - V2 SIMPLE
-- PostgreSQL / Supabase
--
-- RECONSTRUCTION COMPLÈTE DE LA BASE MÉTIER
--
-- ATTENTION :
-- Cette migration supprime les anciennes tables V1 :
--   profiles
--   user_roles
--   attendance
--   app_settings
--
-- Elle NE supprime PAS auth.users.
-- ============================================================


-- ============================================================
-- 0. NETTOYAGE DE L'ANCIENNE VERSION
-- ============================================================

-- ------------------------------------------------------------
-- Suppression de l'ancien trigger Auth
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;


-- ------------------------------------------------------------
-- Suppression des anciennes tables
--
-- CASCADE permet de supprimer automatiquement :
-- - policies
-- - contraintes dépendantes
-- - triggers
-- etc.
-- ------------------------------------------------------------

DROP TABLE IF EXISTS public.reports CASCADE;
DROP TABLE IF EXISTS public.report_types CASCADE;
DROP TABLE IF EXISTS public.attendances CASCADE;
DROP TABLE IF EXISTS public.employee_roles CASCADE;
DROP TABLE IF EXISTS public.employees CASCADE;
DROP TABLE IF EXISTS public.positions CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;
DROP TABLE IF EXISTS public.sites CASCADE;
DROP TABLE IF EXISTS public.cities CASCADE;
DROP TABLE IF EXISTS public.structures CASCADE;

DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.attendance CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;

-- ------------------------------------------------------------
-- Suppression des anciennes fonctions
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role);
DROP FUNCTION IF EXISTS public.get_user_role(UUID);
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- ------------------------------------------------------------
-- Suppression de l'ancien ENUM
-- ------------------------------------------------------------

DROP TYPE IF EXISTS public.app_role CASCADE;

-- ============================================================
-- 1. STRUCTURES
-- ============================================================

CREATE TABLE public.structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL,

    code VARCHAR(20) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 2. VILLES
-- ============================================================

CREATE TABLE public.cities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 3. SITES
--
-- Un site peut être :
--   magasin
--   cave
-- ============================================================

CREATE TABLE public.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    structure_id UUID NOT NULL
        REFERENCES public.structures(id)
        ON DELETE RESTRICT,

    city_id UUID NOT NULL
        REFERENCES public.cities(id)
        ON DELETE RESTRICT,

    name VARCHAR(150) NOT NULL,

    type VARCHAR(20) NOT NULL
        CHECK (type IN ('magasin', 'cave')),

    work_start TIME NOT NULL,

    work_end TIME NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sites_work_hours_check
        CHECK (work_start < work_end),

    CONSTRAINT sites_structure_name_unique
        UNIQUE (structure_id, name)
);


-- ============================================================
-- 4. SERVICES
-- ============================================================

CREATE TABLE public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    structure_id UUID NOT NULL
        REFERENCES public.structures(id)
        ON DELETE RESTRICT,

    name VARCHAR(100) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT services_structure_name_unique
        UNIQUE (structure_id, name)
);


-- ============================================================
-- 5. FONCTIONS / POSTES
--
-- Exemple :
--   PDG
--   DG
--   Responsable
--   Commercial
--   Caissier
--   Manutentionnaire
--   Employé
--
-- IMPORTANT :
-- Le poste métier est différent du rôle de sécurité.
-- ============================================================

CREATE TABLE public.positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 6. EMPLOYÉS
--
-- Chaque utilisateur Auth possède au maximum un employé.
--
-- Le PDG peut avoir structure_id = NULL.
-- Les autres employés doivent normalement appartenir
-- à une structure.
-- ============================================================

CREATE TABLE public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    auth_user_id UUID NOT NULL UNIQUE
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    first_name VARCHAR(100) NOT NULL,

    last_name VARCHAR(100) NOT NULL,

    phone VARCHAR(30),

    structure_id UUID
        REFERENCES public.structures(id)
        ON DELETE RESTRICT,

    service_id UUID
        REFERENCES public.services(id)
        ON DELETE SET NULL,

    position_id UUID
        REFERENCES public.positions(id)
        ON DELETE SET NULL,

    site_id UUID
        REFERENCES public.sites(id)
        ON DELETE SET NULL,

    manager_id UUID
        REFERENCES public.employees(id)
        ON DELETE SET NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employees_not_self_manager
        CHECK (
            manager_id IS NULL
            OR manager_id <> id
        )
);


-- ============================================================
-- 7. RÔLES DE SÉCURITÉ
--
-- Position ≠ rôle.
--
-- position :
--   PDG
--   DG
--   Commercial
--
-- role :
--   admin
--   manager
--   employee
-- ============================================================

CREATE TYPE public.employee_role AS ENUM (
    'admin',
    'manager',
    'employee'
);


CREATE TABLE public.employee_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL UNIQUE
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    role public.employee_role NOT NULL DEFAULT 'employee',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 8. PRÉSENCES
-- ============================================================

CREATE TABLE public.attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    site_id UUID NOT NULL
        REFERENCES public.sites(id)
        ON DELETE RESTRICT,

    attendance_date DATE NOT NULL,

    check_in TIMESTAMPTZ,

    check_out TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_date_unique
        UNIQUE (employee_id, attendance_date),

    CONSTRAINT attendance_checkout_check
        CHECK (
            check_out IS NULL
            OR check_in IS NULL
            OR check_out >= check_in
        )
);


-- ============================================================
-- 9. TYPES DE RAPPORTS
-- ============================================================

CREATE TABLE public.report_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 10. RAPPORTS
--
-- Une fois soumis, le rapport est considéré comme envoyé.
-- La logique applicative empêchera sa modification.
-- ============================================================

CREATE TABLE public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE RESTRICT,

    report_type_id UUID NOT NULL
        REFERENCES public.report_types(id)
        ON DELETE RESTRICT,

    title VARCHAR(200) NOT NULL,

    description TEXT,

    file_url TEXT,

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    validated_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 11. INDEX
-- ============================================================

CREATE INDEX idx_sites_structure_id
ON public.sites(structure_id);

CREATE INDEX idx_sites_city_id
ON public.sites(city_id);

CREATE INDEX idx_services_structure_id
ON public.services(structure_id);

CREATE INDEX idx_employees_structure_id
ON public.employees(structure_id);

CREATE INDEX idx_employees_service_id
ON public.employees(service_id);

CREATE INDEX idx_employees_position_id
ON public.employees(position_id);

CREATE INDEX idx_employees_site_id
ON public.employees(site_id);

CREATE INDEX idx_employees_manager_id
ON public.employees(manager_id);

CREATE INDEX idx_employee_roles_role
ON public.employee_roles(role);

CREATE INDEX idx_attendances_employee_id
ON public.attendances(employee_id);

CREATE INDEX idx_attendances_date
ON public.attendances(attendance_date);

CREATE INDEX idx_reports_employee_id
ON public.reports(employee_id);

CREATE INDEX idx_reports_type_id
ON public.reports(report_type_id);

CREATE INDEX idx_reports_submitted_at
ON public.reports(submitted_at);


-- ============================================================
-- 12. DONNÉES INITIALES
-- ============================================================


-- ------------------------------------------------------------
-- Structures
-- ------------------------------------------------------------

INSERT INTO public.structures (name, code)
VALUES
    ('Structure Das-Sarl', 'Das-Sarl'),
    ('Structure MAGISTERE', 'MAGISTERE');


-- ------------------------------------------------------------
-- Villes
-- ------------------------------------------------------------

INSERT INTO public.cities (name)
VALUES
    ('Douala'),
    ('Yaoundé');


-- ------------------------------------------------------------
-- Positions
-- ------------------------------------------------------------

INSERT INTO public.positions (name)
VALUES
    ('PDG'),
    ('DG'),
    ('Responsable'),
    ('Commercial'),
    ('Caissier'),
    ('Manutentionnaire'),
    ('Employé');


-- ------------------------------------------------------------
-- Services de Das-Sarl
-- ------------------------------------------------------------

INSERT INTO public.services (
    structure_id,
    name
)
SELECT
    id,
    'Comptabilité'
FROM public.structures
WHERE code = 'Das-Sarl';


INSERT INTO public.services (
    structure_id,
    name
)
SELECT
    id,
    'Commercial'
FROM public.structures
WHERE code = 'Das-Sarl';


INSERT INTO public.services (
    structure_id,
    name
)
SELECT
    id,
    'Manutention'
FROM public.structures
WHERE code = 'Das-Sarl';


-- ============================================================
-- 13. RLS
-- ============================================================

ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employee_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.report_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 14. FONCTIONS DE SÉCURITÉ
-- ============================================================


-- ============================================================
-- ID DE L'EMPLOYÉ CONNECTÉ
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


-- ============================================================
-- EMPLOYÉ CONNECTÉ
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee()
RETURNS public.employees
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
    LIMIT 1;
$$;


-- ============================================================
-- STRUCTURE DE L'EMPLOYÉ CONNECTÉ
-- ============================================================

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
    LIMIT 1;
$$;


-- ============================================================
-- RÔLE DE L'EMPLOYÉ CONNECTÉ
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_role()
RETURNS public.employee_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT er.role
    FROM public.employee_roles er
    INNER JOIN public.employees e
        ON e.id = er.employee_id
    WHERE e.auth_user_id = auth.uid()
    LIMIT 1;
$$;


-- ============================================================
-- VÉRIFIER UN RÔLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(
    requested_role public.employee_role
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.employee_roles er
        INNER JOIN public.employees e
            ON e.id = er.employee_id
        WHERE e.auth_user_id = auth.uid()
          AND er.role = requested_role
    );
$$;


-- ============================================================
-- VÉRIFIER SI L'UTILISATEUR PEUT GÉRER UN EMPLOYÉ
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_employee(
    target_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.has_role('admin')

        OR EXISTS (
            SELECT 1
            FROM public.employees current_employee
            INNER JOIN public.employees target_employee
                ON target_employee.id = target_employee_id
            WHERE current_employee.auth_user_id = auth.uid()

              AND public.has_role('manager')

              AND current_employee.structure_id
                  = target_employee.structure_id

              AND target_employee.id
                  <> current_employee.id
        );
$$;


-- ============================================================
-- VÉRIFIER SI L'EMPLOYÉ EST ACTIF
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_employee_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT is_active
            FROM public.employees
            WHERE auth_user_id = auth.uid()
            LIMIT 1
        ),
        FALSE
    );
$$;


-- ============================================================
-- 15. CRÉATION AUTOMATIQUE D'UN EMPLOYÉ APRÈS SIGNUP
--
-- Supabase Auth crée :
--
-- auth.users
--      ↓
-- trigger
--      ↓
-- employees
--      ↓
-- employee_roles
--
-- Les informations sont récupérées depuis :
--
-- raw_user_meta_data
--
-- first_name
-- last_name
-- phone
-- structure_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_first_name VARCHAR(100);
    v_last_name VARCHAR(100);
    v_phone VARCHAR(30);
    v_structure_id UUID;

    v_employee_id UUID;
    v_default_position_id UUID;
BEGIN

    -- --------------------------------------------------------
    -- Récupération des données envoyées lors du signup
    -- --------------------------------------------------------

    v_first_name :=
        NULLIF(
            TRIM(NEW.raw_user_meta_data ->> 'first_name'),
            ''
        );

    v_last_name :=
        NULLIF(
            TRIM(NEW.raw_user_meta_data ->> 'last_name'),
            ''
        );

    v_phone :=
        NULLIF(
            TRIM(NEW.raw_user_meta_data ->> 'phone'),
            ''
        );

    -- --------------------------------------------------------
    -- Structure sélectionnée avant l'inscription
    -- --------------------------------------------------------

    BEGIN
        v_structure_id :=
            NULLIF(
                NEW.raw_user_meta_data ->> 'structure_id',
                ''
            )::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION
                'Invalid structure_id';
    END;


    -- --------------------------------------------------------
    -- Vérification prénom
    -- --------------------------------------------------------

    IF v_first_name IS NULL THEN
        RAISE EXCEPTION
            'first_name is required';
    END IF;


    -- --------------------------------------------------------
    -- Vérification nom
    -- --------------------------------------------------------

    IF v_last_name IS NULL THEN
        RAISE EXCEPTION
            'last_name is required';
    END IF;


    -- --------------------------------------------------------
    -- Vérification structure
    -- --------------------------------------------------------

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION
            'structure_id is required';
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM public.structures
        WHERE id = v_structure_id
    ) THEN

        RAISE EXCEPTION
            'The selected structure does not exist';

    END IF;


    -- --------------------------------------------------------
    -- Position par défaut
    --
    -- Tous les nouveaux utilisateurs commencent comme :
    --
    -- position = Employé
    -- role     = employee
    --
    -- Un administrateur pourra ensuite modifier le poste.
    -- --------------------------------------------------------

    SELECT id
    INTO v_default_position_id
    FROM public.positions
    WHERE name = 'Employé'
    LIMIT 1;


    IF v_default_position_id IS NULL THEN

        RAISE EXCEPTION
            'Default position "Employé" does not exist';

    END IF;


    -- --------------------------------------------------------
    -- Création de l'employé
    -- --------------------------------------------------------

    INSERT INTO public.employees (
        auth_user_id,
        first_name,
        last_name,
        phone,
        structure_id,
        position_id
    )
    VALUES (
        NEW.id,
        v_first_name,
        v_last_name,
        v_phone,
        v_structure_id,
        v_default_position_id
    )
    RETURNING id
    INTO v_employee_id;


    -- --------------------------------------------------------
    -- Création du rôle de sécurité
    -- --------------------------------------------------------

    INSERT INTO public.employee_roles (
        employee_id,
        role
    )
    VALUES (
        v_employee_id,
        'employee'
    );


    RETURN NEW;
END;
$$;


-- ============================================================
-- TRIGGER AUTH → EMPLOYEE
-- ============================================================

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_employee();


-- ============================================================
-- 16. FONCTION : MODIFIER SON PROFIL
--
-- L'utilisateur peut modifier uniquement :
--   first_name
--   last_name
--   phone
--
-- Il ne peut pas modifier :
--   structure
--   service
--   position
--   manager
--   role
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_my_profile(
    p_first_name VARCHAR(100),
    p_last_name VARCHAR(100),
    p_phone VARCHAR(30)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.current_employee_is_active() THEN
        RAISE EXCEPTION
            'Employee account is inactive';
    END IF;


    UPDATE public.employees
    SET
        first_name = TRIM(p_first_name),
        last_name = TRIM(p_last_name),
        phone = NULLIF(TRIM(p_phone), '')
    WHERE auth_user_id = auth.uid();


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Employee not found';
    END IF;

END;
$$;


-- ============================================================
-- 17. ADMIN : MODIFIER LE RÔLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_employee_role(
    p_employee_id UUID,
    p_role public.employee_role
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.has_role('admin') THEN

        RAISE EXCEPTION
            'Only administrators can change employee roles';

    END IF;


    UPDATE public.employee_roles
    SET role = p_role
    WHERE employee_id = p_employee_id;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Employee role not found';

    END IF;

END;
$$;


-- ============================================================
-- 18. POLICIES : STRUCTURES
-- ============================================================

CREATE POLICY "authenticated_can_view_structures"
ON public.structures
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 19. POLICIES : VILLES
-- ============================================================

CREATE POLICY "authenticated_can_view_cities"
ON public.cities
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 20. POLICIES : SITES
-- ============================================================

CREATE POLICY "authenticated_can_view_sites"
ON public.sites
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 21. POLICIES : SERVICES
-- ============================================================

CREATE POLICY "authenticated_can_view_services"
ON public.services
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 22. POLICIES : POSITIONS
-- ============================================================

CREATE POLICY "authenticated_can_view_positions"
ON public.positions
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 23. POLICIES : EMPLOYEES
-- ============================================================


-- ------------------------------------------------------------
-- Un employé peut voir son propre profil
-- ------------------------------------------------------------

CREATE POLICY "employee_can_view_own_profile"
ON public.employees
FOR SELECT
TO authenticated
USING (
    auth_user_id = auth.uid()
);


-- ------------------------------------------------------------
-- Admin peut voir tous les employés
-- ------------------------------------------------------------

CREATE POLICY "admin_can_view_all_employees"
ON public.employees
FOR SELECT
TO authenticated
USING (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- Manager peut voir les employés de sa structure
-- ------------------------------------------------------------

CREATE POLICY "manager_can_view_structure_employees"
ON public.employees
FOR SELECT
TO authenticated
USING (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
);


-- ------------------------------------------------------------
-- Admin peut modifier tous les employés
-- ------------------------------------------------------------

CREATE POLICY "admin_can_update_employees"
ON public.employees
FOR UPDATE
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- Manager peut modifier les employés de sa structure
-- ------------------------------------------------------------

CREATE POLICY "manager_can_update_structure_employees"
ON public.employees
FOR UPDATE
TO authenticated
USING (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
    AND id <> public.current_employee_id()
)
WITH CHECK (
    public.has_role('manager')
    AND structure_id = public.current_structure_id()
);


-- ------------------------------------------------------------
-- Admin peut créer des employés manuellement
-- ------------------------------------------------------------

CREATE POLICY "admin_can_insert_employees"
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('admin')
);


-- ============================================================
-- 24. POLICIES : EMPLOYEE ROLES
-- ============================================================


-- ------------------------------------------------------------
-- Un employé peut voir son propre rôle
-- ------------------------------------------------------------

CREATE POLICY "employee_can_view_own_role"
ON public.employee_roles
FOR SELECT
TO authenticated
USING (
    employee_id = public.current_employee_id()
);


-- ------------------------------------------------------------
-- Admin peut voir tous les rôles
-- ------------------------------------------------------------

CREATE POLICY "admin_can_view_all_roles"
ON public.employee_roles
FOR SELECT
TO authenticated
USING (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- Manager peut voir les rôles de sa structure
-- ------------------------------------------------------------

CREATE POLICY "manager_can_view_structure_roles"
ON public.employee_roles
FOR SELECT
TO authenticated
USING (
    public.has_role('manager')
    AND EXISTS (
        SELECT 1
        FROM public.employees target_employee
        WHERE target_employee.id = employee_roles.employee_id
          AND target_employee.structure_id
              = public.current_structure_id()
    )
);


-- ------------------------------------------------------------
-- Admin peut créer un rôle
-- ------------------------------------------------------------

CREATE POLICY "admin_can_insert_roles"
ON public.employee_roles
FOR INSERT
TO authenticated
WITH CHECK (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- Admin peut modifier un rôle
-- ------------------------------------------------------------

CREATE POLICY "admin_can_update_roles"
ON public.employee_roles
FOR UPDATE
TO authenticated
USING (
    public.has_role('admin')
)
WITH CHECK (
    public.has_role('admin')
);


-- ============================================================
-- 25. POLICIES : ATTENDANCES
-- ============================================================


-- ------------------------------------------------------------
-- Employé voit ses présences
-- ------------------------------------------------------------

CREATE POLICY "employee_can_view_own_attendance"
ON public.attendances
FOR SELECT
TO authenticated
USING (
    employee_id = public.current_employee_id()
);


-- ------------------------------------------------------------
-- Manager voit les présences de sa structure
-- ------------------------------------------------------------

CREATE POLICY "manager_can_view_structure_attendance"
ON public.attendances
FOR SELECT
TO authenticated
USING (
    public.has_role('manager')
    AND EXISTS (
        SELECT 1
        FROM public.employees target_employee
        WHERE target_employee.id = attendances.employee_id
          AND target_employee.structure_id
              = public.current_structure_id()
    )
);


-- ------------------------------------------------------------
-- Admin voit toutes les présences
-- ------------------------------------------------------------

CREATE POLICY "admin_can_view_all_attendance"
ON public.attendances
FOR SELECT
TO authenticated
USING (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- Employé peut créer sa présence
-- ------------------------------------------------------------

CREATE POLICY "employee_can_create_own_attendance"
ON public.attendances
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
);


-- ------------------------------------------------------------
-- Employé peut mettre à jour sa présence
-- ------------------------------------------------------------

CREATE POLICY "employee_can_update_own_attendance"
ON public.attendances
FOR UPDATE
TO authenticated
USING (
    employee_id = public.current_employee_id()
)
WITH CHECK (
    employee_id = public.current_employee_id()
);


-- ============================================================
-- 26. POLICIES : TYPES DE RAPPORTS
-- ============================================================

CREATE POLICY "authenticated_can_view_report_types"
ON public.report_types
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
);


-- ============================================================
-- 27. POLICIES : RAPPORTS
-- ============================================================


-- ------------------------------------------------------------
-- Employé voit ses rapports
-- ------------------------------------------------------------

CREATE POLICY "employee_can_view_own_reports"
ON public.reports
FOR SELECT
TO authenticated
USING (
    employee_id = public.current_employee_id()
);


-- ------------------------------------------------------------
-- Manager voit les rapports de sa structure
-- ------------------------------------------------------------

CREATE POLICY "manager_can_view_structure_reports"
ON public.reports
FOR SELECT
TO authenticated
USING (
    public.has_role('manager')
    AND EXISTS (
        SELECT 1
        FROM public.employees target_employee
        WHERE target_employee.id = reports.employee_id
          AND target_employee.structure_id
              = public.current_structure_id()
    )
);


-- ------------------------------------------------------------
-- Admin voit tous les rapports
-- ------------------------------------------------------------

CREATE POLICY "admin_can_view_all_reports"
ON public.reports
FOR SELECT
TO authenticated
USING (
    public.has_role('admin')
);


-- ------------------------------------------------------------
-- Employé peut créer son rapport
-- ------------------------------------------------------------

CREATE POLICY "employee_can_create_own_reports"
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = public.current_employee_id()
);


-- ============================================================
-- 28. PROTECTION DES RAPPORTS APRÈS SOUMISSION
--
-- Aucun UPDATE/DELETE classique n'est autorisé par RLS.
--
-- Le rapport devient donc immuable côté API PostgREST.
-- ============================================================


-- ============================================================
-- 29. SÉCURITÉ DES FONCTIONS
-- ============================================================

REVOKE ALL
ON FUNCTION public.current_employee_id()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_employee_id()
TO authenticated;


REVOKE ALL
ON FUNCTION public.current_employee()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_employee()
TO authenticated;


REVOKE ALL
ON FUNCTION public.current_structure_id()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_structure_id()
TO authenticated;


REVOKE ALL
ON FUNCTION public.current_employee_role()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_employee_role()
TO authenticated;


REVOKE ALL
ON FUNCTION public.has_role(public.employee_role)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.has_role(public.employee_role)
TO authenticated;


REVOKE ALL
ON FUNCTION public.can_manage_employee(UUID)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.can_manage_employee(UUID)
TO authenticated;


REVOKE ALL
ON FUNCTION public.current_employee_is_active()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.current_employee_is_active()
TO authenticated;


REVOKE ALL
ON FUNCTION public.update_my_profile(
    VARCHAR(100),
    VARCHAR(100),
    VARCHAR(30)
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.update_my_profile(
    VARCHAR(100),
    VARCHAR(100),
    VARCHAR(30)
)
TO authenticated;


REVOKE ALL
ON FUNCTION public.set_employee_role(
    UUID,
    public.employee_role
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.set_employee_role(
    UUID,
    public.employee_role
)
TO authenticated;


-- ============================================================
-- FIN DE LA MIGRATION V2
-- ============================================================