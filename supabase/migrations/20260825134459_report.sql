ALTER TABLE public.reports
ADD COLUMN IF NOT EXISTS recipient_id uuid NULL,
ADD COLUMN IF NOT EXISTS forwarded_by uuid NULL,
ADD COLUMN IF NOT EXISTS forwarded_at timestamptz NULL;

ALTER TABLE public.reports
ADD CONSTRAINT reports_recipient_id_fkey
FOREIGN KEY (recipient_id)
REFERENCES public.employees(id)
ON DELETE SET NULL;

ALTER TABLE public.reports
ADD CONSTRAINT reports_forwarded_by_fkey
FOREIGN KEY (forwarded_by)
REFERENCES public.employees(id)
ON DELETE SET NULL;