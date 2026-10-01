BEGIN;

ALTER TABLE public.missions
ADD COLUMN IF NOT EXISTS start_latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS start_longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS end_latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS end_longitude DOUBLE PRECISION;

CREATE OR REPLACE FUNCTION public.start_mission(
    p_mission_id UUID,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lon DOUBLE PRECISION DEFAULT NULL
)
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
        start_latitude = p_lat,
        start_longitude = p_lon,
        updated_at = NOW()
    WHERE id = p_mission_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_mission(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_mission(
    p_mission_id UUID,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lon DOUBLE PRECISION DEFAULT NULL
)
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
        end_latitude = p_lat,
        end_longitude = p_lon,
        updated_at = NOW()
    WHERE id = p_mission_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_mission(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;


COMMIT;
