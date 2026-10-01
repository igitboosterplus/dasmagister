-- ============================================================
-- REPORTS WORKFLOW — MIGRATION COMPLÈTE
-- ============================================================
-- Objectifs :
--   1. Créer la table report_recipients (multi-destinataires)
--   2. Migrer les données existantes (recipient_id, recipient_employee_id)
--   3. Créer la RPC submit_report (SECURITY DEFINER)
--      → détermine auteur, structure, destinataires côté serveur
--   4. Ajouter les RLS UPDATE/DELETE
--   5. Notifier les destinataires via la table notifications
--
-- NE supprime PAS les colonnes recipient_id / recipient_employee_id
-- pour préserver la compatibilité avec les anciennes données et les
-- policies RLS existantes.
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1 : TABLE report_recipients
-- ============================================================

CREATE TABLE IF NOT EXISTS public.report_recipients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    report_id       UUID NOT NULL
        REFERENCES public.reports(id)
        ON DELETE CASCADE,

    employee_id     UUID NOT NULL
        REFERENCES public.employees(id)
        ON DELETE CASCADE,

    -- 'primary' = destinataire principal
    -- 'cc'      = copie
    recipient_type  TEXT NOT NULL DEFAULT 'primary'
        CHECK (recipient_type IN ('primary', 'cc')),

    -- Suivi lecture / transmission
    read_at         TIMESTAMPTZ,
    forwarded_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT report_recipients_unique
        UNIQUE (report_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_report_recipients_report_id
    ON public.report_recipients(report_id);

CREATE INDEX IF NOT EXISTS idx_report_recipients_employee_id
    ON public.report_recipients(employee_id);

ALTER TABLE public.report_recipients ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- SECTION 2 : RLS SUR report_recipients
-- ============================================================

-- SELECT : auteur du rapport, destinataires, manager de la structure, admin
CREATE POLICY report_recipients_select
ON public.report_recipients
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        -- Le destinataire lui-même
        employee_id = public.current_employee_id()

        -- L'auteur du rapport
        OR EXISTS (
            SELECT 1 FROM public.reports r
            WHERE r.id = report_id
              AND (
                  r.employee_id = public.current_employee_id()
                  OR r.author_employee_id = public.current_employee_id()
              )
        )

        -- Manager de la structure concernée
        OR (
            public.is_manager()
            AND EXISTS (
                SELECT 1 FROM public.reports r
                WHERE r.id = report_id
                  AND r.structure_id = public.current_structure_id()
            )
        )

        -- Admin global
        OR public.is_admin()
    )
);

-- INSERT : uniquement via la RPC submit_report (SECURITY DEFINER)
-- On interdit l'INSERT direct depuis le frontend.
CREATE POLICY report_recipients_insert_rpc
ON public.report_recipients
FOR INSERT
TO authenticated
WITH CHECK (false);


-- ============================================================
-- SECTION 3 : MIGRATION DES DONNÉES EXISTANTES
-- ============================================================
-- Insérer dans report_recipients tous les rapports existants
-- qui ont déjà un recipient_id ou recipient_employee_id.
--
-- On déduplique : si un rapport a les deux colonnes qui pointent
-- vers le même employee_id, on n'insère qu'une seule ligne.
-- ============================================================

INSERT INTO public.report_recipients (report_id, employee_id, recipient_type, created_at)
SELECT DISTINCT
    r.id AS report_id,
    COALESCE(r.recipient_employee_id, r.recipient_id) AS employee_id,
    'primary' AS recipient_type,
    r.created_at
FROM public.reports r
WHERE
    -- Uniquement les rapports qui ont au moins un destinataire
    (r.recipient_id IS NOT NULL OR r.recipient_employee_id IS NOT NULL)
    -- On s'assure que l'employee_id résolu existe bien
    AND EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = COALESCE(r.recipient_employee_id, r.recipient_id)
    )
    -- On ne réinsère pas ce qui existe déjà
    AND NOT EXISTS (
        SELECT 1 FROM public.report_recipients rr
        WHERE rr.report_id = r.id
          AND rr.employee_id = COALESCE(r.recipient_employee_id, r.recipient_id)
    )
ON CONFLICT (report_id, employee_id) DO NOTHING;

-- Vérification : signalons les rapports qui ont recipient_id ≠ recipient_employee_id
-- (incohérences potentielles — elles sont consignées dans les logs mais non écrasées)
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.reports
    WHERE recipient_id IS NOT NULL
      AND recipient_employee_id IS NOT NULL
      AND recipient_id <> recipient_employee_id;

    IF v_count > 0 THEN
        RAISE WARNING 'ATTENTION : % rapport(s) ont recipient_id ≠ recipient_employee_id. '
                      'Vérifiez manuellement ces lignes : '
                      'SELECT id, recipient_id, recipient_employee_id FROM reports '
                      'WHERE recipient_id IS NOT NULL AND recipient_employee_id IS NOT NULL '
                      'AND recipient_id <> recipient_employee_id;',
                      v_count;
    END IF;
END;
$$;


-- ============================================================
-- SECTION 4 : RLS SELECT / INSERT / UPDATE sur reports
-- ============================================================

-- Nettoyage de l'ancienne policy SELECT
DROP POLICY IF EXISTS reports_select ON public.reports;

-- Nouvelle policy SELECT élargie (inclut report_recipients)
CREATE POLICY reports_select
ON public.reports
FOR SELECT
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        -- Admin voit tout
        public.is_admin()

        -- Auteur du rapport (V1 et V3)
        OR employee_id = public.current_employee_id()
        OR author_employee_id = public.current_employee_id()

        -- Destinataire (ancien modèle mono-destinataire)
        OR recipient_employee_id = public.current_employee_id()
        OR recipient_id = public.current_employee_id()

        -- Destinataire (nouveau modèle multi-destinataires)
        OR EXISTS (
            SELECT 1 FROM public.report_recipients rr
            WHERE rr.report_id = id
              AND rr.employee_id = public.current_employee_id()
        )

        -- Manager de la structure
        OR (
            public.is_manager()
            AND structure_id = public.current_structure_id()
        )

        -- Responsable du site associé
        OR public.is_site_responsible(site_id)
    )
);

-- Nettoyage de l'ancienne policy INSERT
DROP POLICY IF EXISTS reports_insert_own ON public.reports;

-- Nouvelle policy INSERT : auteur = utilisateur courant uniquement
-- structure_id et recipient_* sont calculés par la RPC
CREATE POLICY reports_insert_rpc
ON public.reports
FOR INSERT
TO authenticated
WITH CHECK (
    -- L'auteur et l'employee_id doivent être l'utilisateur courant
    employee_id = public.current_employee_id()
    AND author_employee_id = public.current_employee_id()
);

-- UPDATE : uniquement le manager de la structure ou l'admin
-- peuvent changer le statut. Pas d'UPDATE libre sur le contenu.
DROP POLICY IF EXISTS reports_update ON public.reports;

CREATE POLICY reports_update
ON public.reports
FOR UPDATE
TO authenticated
USING (
    public.current_employee_is_active()
    AND (
        public.is_admin()
        OR (
            public.is_manager()
            AND structure_id = public.current_structure_id()
        )
    )
)
WITH CHECK (
    public.is_admin()
    OR (
        public.is_manager()
        AND structure_id = public.current_structure_id()
    )
);


-- ============================================================
-- SECTION 5 : RPC submit_report (SECURITY DEFINER)
-- ============================================================
-- Le frontend envoie uniquement les données métier :
--   p_report_type_id  TEXT
--   p_title           TEXT
--   p_description     TEXT (nullable)
--
-- La RPC détermine automatiquement :
--   - l'auteur (auth.uid() → employees)
--   - la structure de l'auteur
--   - le site principal de l'auteur (via employee_sites)
--   - le rôle de l'auteur
--   - les destinataires :
--       • EMPLOYÉ → manager de la structure (primary) + admin (cc)
--       • MANAGER → admin (primary)
--
-- RETURNS UUID : l'identifiant du rapport créé.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_report(
    p_report_type_id  UUID,
    p_title           TEXT,
    p_description     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_author_id         UUID;
    v_author            public.employees%ROWTYPE;
    v_author_role       public.employee_role;
    v_structure_id      UUID;

    v_primary_site_id   UUID;

    v_manager_id        UUID;
    v_admin_id          UUID;

    v_report_id         UUID;
BEGIN

    -- --------------------------------------------------------
    -- 5.1 Identifier l'auteur
    -- --------------------------------------------------------

    v_author_id := public.current_employee_id();

    IF v_author_id IS NULL THEN
        RAISE EXCEPTION 'AUTHOR_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_author
    FROM public.employees
    WHERE id = v_author_id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'AUTHOR_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_author.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'AUTHOR_INACTIVE'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_author.account_status::TEXT <> 'active' THEN
        RAISE EXCEPTION 'AUTHOR_ACCOUNT_NOT_ACTIVE'
            USING ERRCODE = 'P0001';
    END IF;

    v_structure_id := v_author.structure_id;

    IF v_structure_id IS NULL THEN
        RAISE EXCEPTION 'AUTHOR_HAS_NO_STRUCTURE'
            USING ERRCODE = 'P0001';
    END IF;


    -- --------------------------------------------------------
    -- 5.2 Rôle de l'auteur
    -- --------------------------------------------------------

    SELECT er.role
    INTO v_author_role
    FROM public.employee_roles er
    WHERE er.employee_id = v_author_id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'AUTHOR_HAS_NO_ROLE'
            USING ERRCODE = 'P0001';
    END IF;


    -- --------------------------------------------------------
    -- 5.3 Site principal de l'auteur (via employee_sites V3)
    -- --------------------------------------------------------

    -- Priorité : site où l'auteur est responsable actif
    SELECT es.site_id
    INTO v_primary_site_id
    FROM public.employee_sites es
    WHERE es.employee_id = v_author_id
      AND es.is_active = TRUE
      AND es.is_responsible = TRUE
    LIMIT 1;

    -- Sinon, premier site actif de l'auteur
    IF v_primary_site_id IS NULL THEN
        SELECT es.site_id
        INTO v_primary_site_id
        FROM public.employee_sites es
        WHERE es.employee_id = v_author_id
          AND es.is_active = TRUE
        LIMIT 1;
    END IF;


    -- --------------------------------------------------------
    -- 5.4 Résolution des destinataires selon le rôle
    -- --------------------------------------------------------

    IF v_author_role = 'employee'::public.employee_role THEN

        -- EMPLOYÉ → manager de la structure
        SELECT er.employee_id
        INTO v_manager_id
        FROM public.employees emp
        INNER JOIN public.employee_roles er ON er.employee_id = emp.id
        WHERE emp.structure_id = v_structure_id
          AND emp.is_active = TRUE
          AND er.role = 'manager'::public.employee_role
        LIMIT 1;

        IF v_manager_id IS NULL THEN
            RAISE EXCEPTION 'NO_MANAGER_FOR_STRUCTURE'
                USING ERRCODE = 'P0001';
        END IF;

        -- Admin en copie
        SELECT er.employee_id
        INTO v_admin_id
        FROM public.employee_roles er
        INNER JOIN public.employees emp ON emp.id = er.employee_id
        WHERE er.role = 'admin'::public.employee_role
          AND emp.is_active = TRUE
        LIMIT 1;

    ELSIF v_author_role = 'manager'::public.employee_role THEN

        -- MANAGER → admin uniquement
        SELECT er.employee_id
        INTO v_admin_id
        FROM public.employee_roles er
        INNER JOIN public.employees emp ON emp.id = er.employee_id
        WHERE er.role = 'admin'::public.employee_role
          AND emp.is_active = TRUE
        LIMIT 1;

        IF v_admin_id IS NULL THEN
            RAISE EXCEPTION 'NO_ADMIN_FOUND'
                USING ERRCODE = 'P0001';
        END IF;

        v_manager_id := NULL; -- un manager n'envoie pas à un manager

    ELSE
        -- Admin ou autre rôle : pas de destinataire automatique
        v_manager_id := NULL;
        v_admin_id := NULL;
    END IF;


    -- --------------------------------------------------------
    -- 5.5 Valider le type de rapport
    -- --------------------------------------------------------

    PERFORM 1 FROM public.report_types
    WHERE id = p_report_type_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_REPORT_TYPE'
            USING ERRCODE = 'P0001';
    END IF;


    -- --------------------------------------------------------
    -- 5.6 Créer le rapport
    -- --------------------------------------------------------

    -- On conserve également recipient_employee_id (premier destinataire)
    -- pour compatibilité avec les RLS existantes.
    INSERT INTO public.reports (
        employee_id,
        author_employee_id,
        recipient_employee_id,
        recipient_id,
        report_type_id,
        structure_id,
        site_id,
        title,
        description,
        file_url,
        status,
        submitted_at,
        created_at
    )
    VALUES (
        v_author_id,
        v_author_id,
        COALESCE(v_manager_id, v_admin_id),   -- destinataire principal (compat V3)
        COALESCE(v_manager_id, v_admin_id),   -- idem pour compat V1
        p_report_type_id,
        v_structure_id,
        v_primary_site_id,
        TRIM(p_title),
        NULLIF(TRIM(COALESCE(p_description, '')), ''),
        NULL,
        'submitted',
        NOW(),
        NOW()
    )
    RETURNING id INTO v_report_id;


    -- --------------------------------------------------------
    -- 5.7 Insérer les destinataires dans report_recipients
    -- --------------------------------------------------------

    IF v_author_role = 'employee'::public.employee_role THEN

        -- Manager = destinataire principal
        IF v_manager_id IS NOT NULL THEN
            INSERT INTO public.report_recipients (report_id, employee_id, recipient_type)
            VALUES (v_report_id, v_manager_id, 'primary')
            ON CONFLICT (report_id, employee_id) DO NOTHING;
        END IF;

        -- Admin = copie
        IF v_admin_id IS NOT NULL AND v_admin_id <> v_manager_id THEN
            INSERT INTO public.report_recipients (report_id, employee_id, recipient_type)
            VALUES (v_report_id, v_admin_id, 'cc')
            ON CONFLICT (report_id, employee_id) DO NOTHING;
        END IF;

    ELSIF v_author_role = 'manager'::public.employee_role THEN

        -- Admin = destinataire principal
        IF v_admin_id IS NOT NULL THEN
            INSERT INTO public.report_recipients (report_id, employee_id, recipient_type)
            VALUES (v_report_id, v_admin_id, 'primary')
            ON CONFLICT (report_id, employee_id) DO NOTHING;
        END IF;

    END IF;


    -- --------------------------------------------------------
    -- 5.8 Notifications
    -- --------------------------------------------------------

    IF v_manager_id IS NOT NULL
       AND v_author_role = 'employee'::public.employee_role THEN
        INSERT INTO public.notifications (
            recipient_employee_id,
            type,
            title,
            message,
            entity_type,
            entity_id
        )
        VALUES (
            v_manager_id,
            'new_report',
            'Nouveau rapport reçu',
            'Un employé de votre structure vient de soumettre un rapport : ' || TRIM(p_title),
            'report',
            v_report_id
        );
    END IF;

    IF v_admin_id IS NOT NULL THEN
        INSERT INTO public.notifications (
            recipient_employee_id,
            type,
            title,
            message,
            entity_type,
            entity_id
        )
        VALUES (
            v_admin_id,
            'new_report',
            'Nouveau rapport',
            CASE
                WHEN v_author_role = 'employee'::public.employee_role
                    THEN 'Un employé a soumis un rapport : ' || TRIM(p_title)
                WHEN v_author_role = 'manager'::public.employee_role
                    THEN 'Un manager a soumis un rapport : ' || TRIM(p_title)
                ELSE 'Nouveau rapport : ' || TRIM(p_title)
            END,
            'report',
            v_report_id
        );
    END IF;


    -- --------------------------------------------------------
    -- 5.9 Retourner l'id du rapport créé
    -- --------------------------------------------------------

    RETURN v_report_id;

END;
$$;

-- Sécurité
REVOKE ALL ON FUNCTION public.submit_report(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_report(UUID, TEXT, TEXT) TO authenticated;


-- ============================================================
-- SECTION 6 : RLS — report_attachments (UPDATE cohérence)
-- ============================================================

-- Ajout d'un DELETE sur report_attachments pour que l'auteur
-- puisse supprimer ses propres pièces jointes
DROP POLICY IF EXISTS report_attachments_delete ON public.report_attachments;

CREATE POLICY report_attachments_delete
ON public.report_attachments
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.reports r
        WHERE r.id = report_attachments.report_id
          AND (
              r.employee_id = public.current_employee_id()
              OR r.author_employee_id = public.current_employee_id()
          )
          AND r.status IN ('draft', 'submitted')
    )
);


-- ============================================================
-- SECTION 7 : INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_reports_structure_id
    ON public.reports(structure_id);

CREATE INDEX IF NOT EXISTS idx_reports_author_employee_id
    ON public.reports(author_employee_id);

CREATE INDEX IF NOT EXISTS idx_reports_recipient_employee_id
    ON public.reports(recipient_employee_id);


COMMIT;
