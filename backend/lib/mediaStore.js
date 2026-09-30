// Central helpers for storing images in PostgreSQL instead of the local
// filesystem, so logos, favicons and admin avatars survive a host migration or
// a snapshot restore onto a different machine.
//
// Design notes:
//  - Images are kept as `data:<mime>;base64,<payload>` text. That format is
//    already understood by the frontend (`avatar_data`) and by the existing
//    public avatar endpoint, so no client change is required to keep rendering.
//  - A dedicated `media` table keeps blobs out of `app_settings` JSON, which
//    means a plain `SELECT *` of settings never drags megabytes of base64
//    around, and blobs can be replaced independently of other settings.
//  - Every write is upserted on a stable `key`, so re-uploading a logo simply
//    overwrites the previous revision.

const MEDIA_TABLE = 'media';

// Ensure the table exists. Safe to call repeatedly; used at boot and lazily
// before any read/write so a fresh install needs no manual migration step.
async function ensureMediaTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MEDIA_TABLE} (
      key text PRIMARY KEY,
      mime text NOT NULL,
      data text NOT NULL,
      byte_size integer,
      updated_at timestamp with time zone DEFAULT now()
    )
  `);
  // Older installs may predate byte_size; add it defensively.
  try {
    await pool.query(`ALTER TABLE ${MEDIA_TABLE} ADD COLUMN IF NOT EXISTS byte_size integer`);
  } catch (_) {}
}

// Approximate the decoded byte size without allocating a full Buffer copy.
function approxBytes(base64) {
  const s = String(base64 || '');
  if (!s) return 0;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding);
}

// Normalise anything the client might send into a data URI, or null.
function toDataUri(input, fallbackMime) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (s.startsWith('data:')) return s;
  // A bare base64 payload: wrap it using the supplied mime hint.
  if (fallbackMime && /^[A-Za-z0-9+/=\s]+$/.test(s)) {
    return `data:${fallbackMime};base64,${s.replace(/\s+/g, '')}`;
  }
  return null;
}

// Read a data URI and return { mime, base64 }.
function parseDataUri(dataUri) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUri || ''));
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

// Store (or replace) a media blob.
async function putMedia(pool, key, dataUri) {
  const parsed = parseDataUri(dataUri);
  if (!parsed) throw new Error('Invalid data URI for media key: ' + key);
  await ensureMediaTable(pool);
  await pool.query(
    `INSERT INTO ${MEDIA_TABLE} (key, mime, data, byte_size, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (key) DO UPDATE
       SET mime = EXCLUDED.mime, data = EXCLUDED.data,
           byte_size = EXCLUDED.byte_size, updated_at = now()`,
    [key, parsed.mime, `data:${parsed.mime};base64,${parsed.base64}`, approxBytes(parsed.base64)]
  );
  return true;
}

// Fetch a media blob as { key, mime, data } or null when absent.
async function getMedia(pool, key) {
  await ensureMediaTable(pool);
  const { rows } = await pool.query(
    `SELECT key, mime, data FROM ${MEDIA_TABLE} WHERE key = $1`, [key]
  );
  return rows && rows.length ? rows[0] : null;
}

// List every media key with its size. Used by the snapshot backup so a restore
// can rebuild the exact same set of logos/avatars.
async function listMedia(pool) {
  await ensureMediaTable(pool);
  const { rows } = await pool.query(
    `SELECT key, mime, data, byte_size FROM ${MEDIA_TABLE} ORDER BY key`
  );
  return rows || [];
}

async function deleteMedia(pool, key) {
  await ensureMediaTable(pool);
  await pool.query(`DELETE FROM ${MEDIA_TABLE} WHERE key = $1`, [key]);
}

module.exports = {
  MEDIA_TABLE,
  ensureMediaTable,
  putMedia,
  getMedia,
  listMedia,
  deleteMedia,
  toDataUri,
  parseDataUri,
  approxBytes,
};
