-- Add default pricing keys into app_settings.general if missing
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
		INSERT INTO app_settings (settings_key, data, updated_by, updated_at) VALUES ('general', next, NULL, now()) ON CONFLICT (settings_key) DO NOTHING;
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

