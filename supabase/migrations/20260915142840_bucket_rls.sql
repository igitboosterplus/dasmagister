CREATE POLICY "authenticated_users_upload_report_files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'reports'
);

CREATE POLICY "authenticated_users_read_report_files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'reports'
);