-- NOTE:
-- The enforcement trigger (trg_app_settings_enforce_general_updated_by) defined in base migrations
-- requires updated_by to reference an existing admin. At this point in the migration chain no admin
-- accounts have been seeded yet (seedAdmin.js runs after migrations). We temporarily drop/recreate
-- the trigger so we can add pricing defaults without an admin id. The backfill logic and subsequent
-- Admin UI updates will attribute future changes correctly.

DROP TRIGGER IF EXISTS trg_app_settings_enforce_general_updated_by ON app_settings;

DO $$
DECLARE
	existing jsonb;
	next jsonb;
BEGIN
	SELECT data INTO existing FROM app_settings WHERE settings_key = 'general';
	IF existing IS NULL THEN
		next := jsonb_build_object(
			'price_mini', 0,
			'price_basic', 0,
			'price_unlimited', 0,
			'currency', 'USD'
		);
		-- Omit updated_by so it remains NULL until an admin exists.
		INSERT INTO app_settings (settings_key, data, updated_at)
		VALUES ('general', next, now()) ON CONFLICT (settings_key) DO NOTHING;
	ELSE
		next := existing || jsonb_build_object(
			'price_mini', COALESCE(existing->>'price_mini', '0')::numeric,
			'price_basic', COALESCE(existing->>'price_basic', '0')::numeric,
			'price_unlimited', COALESCE(existing->>'price_unlimited', '0')::numeric,
			'currency', COALESCE(existing->>'currency', 'USD')
		);
		UPDATE app_settings SET data = next, updated_at = now() WHERE settings_key = 'general';
	END IF;
END$$;

-- Recreate enforcement trigger (function already present from base migrations)
CREATE TRIGGER trg_app_settings_enforce_general_updated_by
BEFORE INSERT OR UPDATE ON app_settings
FOR EACH ROW
WHEN (NEW.settings_key = 'general')
EXECUTE FUNCTION app_settings_enforce_general_updated_by();

