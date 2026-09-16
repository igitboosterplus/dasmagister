CREATE OR REPLACE FUNCTION public.get_current_admin()
RETURNS TABLE (
    id uuid,
    first_name varchar,
    last_name varchar
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.first_name,
        e.last_name
    FROM public.employees e
    INNER JOIN public.employee_roles er
        ON er.employee_id = e.id
    WHERE e.is_active = true
      AND er.role = 'admin'::employee_role
    LIMIT 1;
END;
$$;

REVOKE ALL
ON FUNCTION public.get_current_admin()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_current_admin()
TO authenticated;