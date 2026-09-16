CREATE TABLE IF NOT EXISTS public.report_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    report_id uuid NOT NULL
        REFERENCES public.reports(id)
        ON DELETE CASCADE,

    file_name text NOT NULL,
    file_path text NOT NULL,
    file_url text,

    mime_type text,
    file_size bigint,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_attachments_report_id
ON public.report_attachments(report_id);

-- activation du rls 

ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;

-- rls piece jointe

CREATE POLICY "report_attachments_select"
ON public.report_attachments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.reports r
        WHERE r.id = report_attachments.report_id
        AND (
            r.employee_id = current_employee_id()
            OR r.author_employee_id = current_employee_id()
            OR r.recipient_employee_id = current_employee_id()
            OR r.recipient_id = current_employee_id()
            OR (
                is_manager()
                AND r.structure_id = current_structure_id()
            )
            OR is_site_responsible(r.site_id)
            OR is_admin()
        )
    )
);

-- creation

CREATE POLICY "report_attachments_insert"
ON public.report_attachments
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.reports r
        WHERE r.id = report_attachments.report_id
        AND (
            r.employee_id = current_employee_id()
            OR r.author_employee_id = current_employee_id()
        )
    )
);


DROP POLICY IF EXISTS "authenticated_users_upload_report_files"
ON storage.objects;

DROP POLICY IF EXISTS "authenticated_users_read_report_files"
ON storage.objects;


CREATE POLICY "report_files_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'reports'
    AND (storage.foldername(name))[1] = current_structure_id()::text
    AND (storage.foldername(name))[2] = current_employee_id()::text
);

CREATE POLICY "report_files_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'reports'
    AND (
        (storage.foldername(name))[2] = current_employee_id()::text

        OR (
            is_manager()
            AND (storage.foldername(name))[1] = current_structure_id()::text
        )

        OR is_admin()
    )
);