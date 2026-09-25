const fs = require('fs');

const sql = fs.readFileSync('supabase/migrations/20260918095243_correction_rls5.sql', 'utf8');

const ipCheckBlock = `
    -- ========================================================
    -- Vérification IP (Réseau)
    -- ========================================================
    IF v_site.wifi_required IS TRUE AND v_site.allowed_ip IS NOT NULL THEN
        DECLARE
            v_client_ip text;
        BEGIN
            v_client_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
            IF v_client_ip IS NULL OR position(v_site.allowed_ip IN v_client_ip) = 0 THEN
                RAISE EXCEPTION 'INVALID_WIFI_IP';
            END IF;
        END;
    END IF;
`;

const updatedSql = sql.replace(/IF v_site\.structure_id <> v_employee\.structure_id THEN/g, ipCheckBlock + '\n    IF v_site.structure_id <> v_employee.structure_id THEN');

const finalSql = `ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS allowed_ip text;\n\n` + updatedSql;

fs.writeFileSync('supabase/migrations/20260924184000_ip_based_checkin.sql', finalSql);
console.log('Migration created successfully.');
