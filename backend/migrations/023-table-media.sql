-- Table: media
-- Purpose: store logo / favicon image blobs inside PostgreSQL so branding is
-- part of the database (and therefore of every backup, snapshot and restore)
-- instead of depending on files in backend/public/logos.
--
-- Key format examples: 'logo:1x', 'logo:2x', 'favicon:32', 'favicon:180'
-- The `data` column holds a full data URI: data:<mime>;base64,<payload>
--
-- Admin avatars are NOT stored here; they live in admins.avatar_data because
-- they belong to a specific row and are fetched together with that account.

CREATE TABLE IF NOT EXISTS media (
    key text PRIMARY KEY,
    mime text NOT NULL,
    data text NOT NULL,
    byte_size integer,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_updated_at ON media (updated_at);

COMMENT ON TABLE media IS 'Image blobs (logo, favicon) stored in the database as data URIs so they survive host moves and restores.';
COMMENT ON COLUMN media.key IS 'Stable identifier, e.g. logo:1x, logo:2x, favicon:32, favicon:180';
COMMENT ON COLUMN media.data IS 'Data URI: data:<mime>;base64,<payload>';
