-- Guardrails to prevent accidental removal of app_settings.general
-- and enforce that updates are attributed to a specific admin.

-- Backfill updated_by for existing general row when possible so the new
-- trigger requirements do not fail on the next update.
DO $$
DECLARE
  _fallback_admin INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE settings_key = 'general' AND updated_by IS NULL) THEN
    SELECT id INTO _fallback_admin FROM admins ORDER BY id LIMIT 1;
    IF _fallback_admin IS NOT NULL THEN
      UPDATE app_settings
         SET updated_by = _fallback_admin
       WHERE settings_key = 'general'
         AND updated_by IS NULL;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_settings_enforce_general_updated_by()
RETURNS trigger AS $$
BEGIN
  IF NEW.settings_key = 'general' THEN
    IF NEW.updated_by IS NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'app_settings.general updates must originate from the Admin UI save flow (updated_by required)';
    END IF;
    PERFORM 1 FROM admins WHERE id = NEW.updated_by;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format('app_settings.general updated_by % does not reference an existing admin', NEW.updated_by);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_enforce_general_updated_by ON app_settings;
CREATE TRIGGER trg_app_settings_enforce_general_updated_by
BEFORE INSERT OR UPDATE ON app_settings
FOR EACH ROW
WHEN (NEW.settings_key = 'general')
EXECUTE FUNCTION app_settings_enforce_general_updated_by();

CREATE OR REPLACE FUNCTION app_settings_prevent_general_delete()
RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data)
    VALUES (OLD.updated_by, OLD.settings_key, 'DELETE_BLOCKED', OLD.data, NULL);
  EXCEPTION WHEN others THEN
    -- best-effort audit only; ignore failures so the primary error surfaces
  END;
  RAISE EXCEPTION USING
    MESSAGE = 'Deletion of app_settings.general is blocked; use the Admin UI to modify this record instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_prevent_general_delete ON app_settings;
CREATE TRIGGER trg_app_settings_prevent_general_delete
BEFORE DELETE ON app_settings
FOR EACH ROW
WHEN (OLD.settings_key = 'general')
EXECUTE FUNCTION app_settings_prevent_general_delete();
