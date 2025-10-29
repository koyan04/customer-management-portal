BEGIN;

-- add updated_at to admins so we can tell when rows changed
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- audit table for admins
CREATE TABLE IF NOT EXISTS admins_audit (
  id bigserial PRIMARY KEY,
  admin_id integer NOT NULL,
  changed_by integer,
  change_type text NOT NULL,
  old jsonb,
  new jsonb,
  password_changed boolean DEFAULT false,
  changed_fields text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- trigger function to populate admins_audit on INSERT/UPDATE
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
      -- detect password change using the real OLD/NEW record values
      pw_changed := (OLD.password_hash IS DISTINCT FROM NEW.password_hash);

      -- build list of changed fields (exclude password_hash which is handled separately)
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

      -- redact password_hash from stored JSON before inserting into audit
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

-- install trigger
DROP TRIGGER IF EXISTS admins_audit_trigger ON admins;
CREATE TRIGGER admins_audit_trigger
  AFTER INSERT OR UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION admins_audit_trigger_fn();

COMMIT;
