BEGIN;

ALTER TABLE public.attendance_events
DROP CONSTRAINT IF EXISTS attendance_events_event_type_check;

UPDATE public.attendance_events
SET event_type = 'check_in'
WHERE event_type = 'CLOCK_IN';

UPDATE public.attendance_events
SET event_type = 'check_out'
WHERE event_type = 'CLOCK_OUT';

UPDATE public.attendance_events
SET event_type = 'site_exit'
WHERE event_type = 'SITE_EXIT';

UPDATE public.attendance_events
SET event_type = 'site_enter'
WHERE event_type = 'SITE_ENTER';

ALTER TABLE public.attendance_events
ADD CONSTRAINT attendance_events_event_type_check
CHECK (
    event_type IN (
        'check_in',
        'site_exit',
        'site_enter',
        'check_out'
    )
);

COMMIT;