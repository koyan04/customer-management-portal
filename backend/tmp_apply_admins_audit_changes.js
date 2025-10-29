const { Pool } = require('pg');
(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'user_management_portal',
  });

  const sql = `
-- add changed_fields column if missing
ALTER TABLE admins_audit
  ADD COLUMN IF NOT EXISTS changed_fields text[] DEFAULT '{}' ;

-- ensure password_changed column exists (defensive)
ALTER TABLE admins_audit
  ADD COLUMN IF NOT EXISTS password_changed boolean DEFAULT false ;

-- recreate trigger function with changed_fields computation
CREATE OR REPLACE FUNCTION admins_audit_trigger_fn() RETURNS trigger AS $$
DECLARE
  old_json jsonb;
  new_json jsonb;
  actor integer;
  pw_changed boolean := false;
  changed text[] := ARRAY[]::text[];
BEGIN
  actor := (CASE WHEN current_setting('app.current_admin_id', true) IS NULL THEN NULL ELSE current_setting('app.current_admin_id', true)::int END);

  IF (TG_OP = 'UPDATE') THEN
    pw_changed := (OLD.password_hash IS DISTINCT FROM NEW.password_hash);

    IF (OLD.display_name IS DISTINCT FROM NEW.display_name) THEN
      changed := array_append(changed, 'display_name');
    END IF;
    IF (OLD.username IS DISTINCT FROM NEW.username) THEN
      changed := array_append(changed, 'username');
    END IF;
    IF (OLD.role IS DISTINCT FROM NEW.role) THEN
      changed := array_append(changed, 'role');
    END IF;
    IF (OLD.avatar_url IS DISTINCT FROM NEW.avatar_url) THEN
      changed := array_append(changed, 'avatar_url');
    END IF;
    IF (OLD.avatar_data IS DISTINCT FROM NEW.avatar_data) THEN
      changed := array_append(changed, 'avatar_data');
    END IF;

    old_json := to_jsonb(OLD) - 'password_hash';
    new_json := to_jsonb(NEW) - 'password_hash';

    INSERT INTO admins_audit (admin_id, changed_by, change_type, old, new, password_changed, changed_fields, created_at)
    VALUES (
      OLD.id,
      actor,
      'UPDATE',
      old_json,
      new_json,
      pw_changed,
      changed,
      now()
    );

    NEW.updated_at := now();
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    new_json := to_jsonb(NEW) - 'password_hash';
    INSERT INTO admins_audit (admin_id, changed_by, change_type, old, new, password_changed, changed_fields, created_at)
    VALUES (
      NEW.id,
      actor,
      'INSERT',
      NULL,
      new_json,
      false,
      ARRAY[]::text[],
      now()
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- recreate trigger
DROP TRIGGER IF EXISTS admins_audit_trigger ON admins;
CREATE TRIGGER admins_audit_trigger
  AFTER INSERT OR UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION admins_audit_trigger_fn();
`;

  try {
    console.log('Applying DB changes...');
    await pool.query(sql);
    console.log('Done.');

    // show current admins_audit table columns
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='admins_audit';");
    console.log('---ADMINS_AUDIT_COLUMNS---');
    console.log(JSON.stringify(cols.rows, null, 2));
  } catch (err) {
    console.error('ERROR', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
