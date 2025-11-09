// Robust .env loading: prefer backend/.env, then project-root/.env, then fallback to CWD
const path = require('path');
const fs = require('fs');
try {
	const dotenv = require('dotenv');
	let loadedAny = false;
	// 1) backend/.env (same folder as this file)
	try {
		const backendEnv = path.join(__dirname, '.env');
		if (fs.existsSync(backendEnv)) {
			dotenv.config({ path: backendEnv, override: false });
			loadedAny = true;
		}
	} catch (_) {}
	// 2) project root .env (one level up from backend/)
	try {
		const rootEnv = path.join(path.resolve(__dirname, '..'), '.env');
		if (fs.existsSync(rootEnv)) {
			dotenv.config({ path: rootEnv, override: false });
			loadedAny = true;
		}
	} catch (_) {}
	// 3) fallback to default (process.cwd()) if neither file existed
	if (!loadedAny) {
		try { dotenv.config(); } catch (_) {}
	}
} catch (_) {
	// If dotenv not available, continue; environment may be provided via process env.
}
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

let serverRoutes, userRoutes, authRoutes, adminRoutes;
try {
	serverRoutes = require('./routes/servers');
} catch (e) {
	console.error('Failed to load ./routes/servers:', e && e.message ? e.message : e);
}
try {
	userRoutes = require('./routes/users');
} catch (e) {
	console.error('Failed to load ./routes/users:', e && e.message ? e.message : e);
}
try {
	authRoutes = require('./routes/auth');
} catch (e) {
	console.error('Failed to load ./routes/auth:', e && e.message ? e.message : e);
}
try {
	adminRoutes = require('./routes/admin');
} catch (e) {
	console.error('Failed to load ./routes/admin:', e && e.message ? e.message : e);
}

const getRawBody = require('raw-body');
const app = express();
// Read app version from project root VERSION file (e.g., "cmp ver 1.0") and cache it
try {
	const versionFile = path.resolve(__dirname, '..', 'VERSION');
	if (fs.existsSync(versionFile)) {
		const v = fs.readFileSync(versionFile, 'utf8').trim();
		if (v) app.locals.appVersion = v;
	}
} catch (_) { /* ignore version read errors */ }
// Allow credentials for cookie-based refresh tokens in development when frontend runs on a different port
app.use(cors({ origin: (origin, cb) => {
	// allow undefined origin (e.g., same-origin requests from tests or tools)
	if (!origin) return cb(null, true);
	// allow localhost frontend during development
	if (origin.includes('localhost:5174') || origin.includes('127.0.0.1:5174')) return cb(null, true);
	return cb(null, true);
}, credentials: true }));

app.use(cookieParser());

const log = require('./lib/logger');
// Toggle verbose HTTP request logs with VERBOSE_HTTP_LOG=1|true|on|debug
const VERBOSE_HTTP = /^(1|true|on|debug)$/i.test(String(process.env.VERBOSE_HTTP_LOG || ''));
// Early logger to help trace incoming requests before other middleware (disabled by default)
app.use((req, res, next) => {
	try {
		if (VERBOSE_HTTP) {
			log.info('early-req', { method: req.method, url: req.originalUrl, origin: req.headers.origin, host: req.headers.host });
		}
	} catch (e) { }
	next();
});

// diagnose large uploads: log incoming content-length/transfer-encoding before body parsing (verbose only)
app.use((req, res, next) => {
	try {
		if (VERBOSE_HTTP) {
			const cl = req.headers['content-length'];
			const te = req.headers['transfer-encoding'];
			log.debug('incoming', { method: req.method, url: req.originalUrl, contentLength: cl, transferEncoding: te });
		}
	} catch (e) { /* ignore */ }
	next();
});

// Pre-parse JSON bodies for admin routes using raw-body so we can accept very large payloads
// This runs BEFORE the global express.json() parser and avoids raw-body throwing 413 prematurely
app.use('/api/admin', async (req, res, next) => {
	try {
		const ct = (req.headers['content-type'] || '').toLowerCase();
		if (ct.includes('application/json')) {
			const len = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
			const str = await getRawBody(req, { length: len, limit: '200mb' });
			try {
				req.body = JSON.parse(str.toString());
			} catch (e) {
				// invalid json -> let downstream handle
				req.body = {};
			}
			return next();
		}
	} catch (err) {
		return next(err);
	}
	next();
});

// allow very large JSON payloads during development; global parser remains as a fallback
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// High-priority fallbacks for viewer permissions to avoid router-order issues
// (moved fallbacks further below after pool/authenticateToken are defined)

// Ensure a very small fallback endpoint is available early for clients that query current user's server-admin assignments
// Placing this before the admin router mount guarantees the path exists regardless of router internals
app.get('/api/admin/my-server-admins', async (req, res, next) => {
	try {
		// Use authenticateToken to ensure we parse the token; call it manually so we can reuse the same middleware
		return authenticateToken(req, res, async () => {
			try {
				const uid = req.user && req.user.id ? req.user.id : null;
				if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
				if (req.user.role === 'ADMIN') return res.json({ role: 'ADMIN', server_admin_for: [] });
				const { rows } = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [uid]);
				return res.json({ role: req.user.role, server_admin_for: rows.map(r => r.server_id) });
			} catch (err) {
				console.error('Early fallback my-server-admins error', err && err.stack ? err.stack : err);
				return res.status(500).json({ msg: 'Server Error' });
			}
		});
	} catch (err) {
		return next(err);
	}
});

// Top-level, simple endpoint for current user's server-admin assignments
app.get('/api/my-server-admins', async (req, res, next) => {
	try {
		return authenticateToken(req, res, async () => {
			try {
				const uid = req.user && req.user.id ? req.user.id : null;
				if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
				if (req.user.role === 'ADMIN') return res.json({ role: 'ADMIN', server_admin_for: [] });
				const { rows } = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [uid]);
				return res.json({ role: req.user.role, server_admin_for: rows.map(r => r.server_id) });
			} catch (err) {
				console.error('Top-level my-server-admins error', err && err.stack ? err.stack : err);
				return res.status(500).json({ msg: 'Server Error' });
			}
		});
	} catch (err) {
		return next(err);
	}
});

// ensure uploads directory exists and serve uploaded files at /uploads
const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
	if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
	console.warn('Failed to ensure uploads directory:', e && e.message ? e.message : e);
}
app.use('/uploads', express.static(uploadsDir));

// Serve any static assets from backend/public (e.g., favicon.ico)
try {
	const publicDir = path.join(__dirname, 'public');
	// Ensure public dir exists
	try { if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true }); } catch (_) {}
	// Drop a tiny default favicon if missing (1x1 transparent PNG; browsers accept PNG at .ico path)
	try {
		const favPath = path.join(publicDir, 'favicon.ico');
		if (!fs.existsSync(favPath)) {
			const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
			fs.writeFileSync(favPath, Buffer.from(b64, 'base64'));
		}
	} catch (_) {}
	app.use(express.static(publicDir));
} catch (e) {
	console.warn('Failed to mount static public dir:', e && e.message ? e.message : e);
}

// Fallback for favicon requests to avoid noisy 404s when no icon is present
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve built frontend (vite) directly from backend in production
// If ../frontend/dist exists (relative to backend/), expose it and set up SPA fallback.
try {
	const feDistDir = path.resolve(__dirname, '..', 'frontend', 'dist');
	if (fs.existsSync(feDistDir)) {
		console.log('[static] serving frontend from', feDistDir);
		app.use(express.static(feDistDir, { index: false }));
		// SPA fallback: use generic middleware instead of app.get('*') (Express 5 path-to-regexp no longer accepts bare '*')
		app.use((req, res, next) => {
			try {
				if (req.method !== 'GET') return next();
				const url = req.originalUrl || '';
				if (url.startsWith('/api') || url.startsWith('/uploads') || url.startsWith('/metrics') || url.startsWith('/internal')) return next();
				// Only attempt send if index.html exists
				const indexFile = path.join(feDistDir, 'index.html');
				if (!fs.existsSync(indexFile)) return next();
				return res.sendFile(indexFile);
			} catch (e) { return next(e); }
		});
	} else {
		console.log('[static] frontend dist not found at', feDistDir);
	}
} catch (e) {
	console.warn('Failed to setup frontend static serving:', e && e.message ? e.message : e);
}

const pool = require('./db');
const bcrypt = require('bcrypt');
const { authenticateToken } = require('./middleware/authMiddleware');
// Prometheus client for /metrics
const client = require('prom-client');

// register default metrics (avoid enabling during tests to prevent open handles in Jest)
const collectDefaultMetrics = client.collectDefaultMetrics;
if (process.env.NODE_ENV !== 'test') {
	try {
		collectDefaultMetrics({ timeout: 5000 });
	} catch (e) {
		console.warn('collectDefaultMetrics failed to start:', e && e.message ? e.message : e);
	}
} else {
	// In test runs we avoid starting the default metrics collection which uses setInterval
	// and can keep the Node process alive, causing Jest to report open handles.
	log.info('test-skip-metrics');
}

// custom gauge for telegram bot health (0 = down, 1 = up)
const telegramBotGauge = new client.Gauge({ name: 'cmp_telegram_bot_up', help: 'Telegram bot up (1) or down (0)' });

// keep a lightweight registry of mounts (helps when express internals are unexpected)
const registeredRoutes = [];

// High-priority fallbacks for viewer permissions to avoid router-order issues
app.get('/api/admin/permissions/me', async (req, res, next) => {
	try {
		return authenticateToken(req, res, async () => {
			try {
				const uid = req.user && req.user.id;
				const idNum = typeof uid === 'string' ? Number(uid) : (typeof uid === 'number' ? uid : NaN);
				if (!Number.isFinite(idNum)) return res.status(401).json({ msg: 'Unauthorized' });
				let rows = [];
				try {
					const r = await pool.query('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [idNum]);
					rows = r.rows || [];
				} catch (err) {
					if (err && err.code === '42P01') {
						const legacy = await pool.query('SELECT server_id FROM editor_server_permissions WHERE editor_id = $1', [idNum]);
						rows = legacy.rows || [];
					} else {
						throw err;
					}
				}
				return res.json(rows.map(r => r.server_id));
			} catch (err) {
				console.error('fallback /permissions/me error', err && err.stack ? err.stack : err);
				return res.status(500).json({ msg: 'Server Error' });
			}
		});
	} catch (err) { return next(err); }
});

app.get('/api/admin/permissions/:editorId', async (req, res, next) => {
	try {
		return authenticateToken(req, res, async () => {
			try {
				const eid = Number(req.params.editorId);
				const uidRaw = req.user && req.user.id;
				const uid = typeof uidRaw === 'string' ? Number(uidRaw) : (typeof uidRaw === 'number' ? uidRaw : NaN);
				const isAdminRole = req.user && req.user.role === 'ADMIN';
				const isSelf = Number.isFinite(uid) && Number.isFinite(eid) && uid === eid;
				if (!isAdminRole && !isSelf) return res.status(403).json({ msg: 'Forbidden' });
				let rows = [];
				try {
					const r = await pool.query('SELECT server_id FROM viewer_server_permissions WHERE editor_id = $1', [eid]);
					rows = r.rows || [];
				} catch (err) {
					if (err && err.code === '42P01') {
						const legacy = await pool.query('SELECT server_id FROM editor_server_permissions WHERE editor_id = $1', [eid]);
						rows = legacy.rows || [];
					} else {
						throw err;
					}
				}
				return res.json(rows.map(r => r.server_id));
			} catch (err) {
				console.error('fallback /permissions/:editorId error', err && err.stack ? err.stack : err);
				return res.status(500).json({ msg: 'Server Error' });
			}
		});
	} catch (err) { return next(err); }
});

// simple request logger to aid local debugging (verbose only)
app.use((req, res, next) => {
	if (VERBOSE_HTTP) {
		log.debug('req', { method: req.method, url: req.originalUrl });
		// avoid logging large bodies in production
		if (process.env.NODE_ENV !== 'production' && ['POST','PUT','PATCH'].includes(req.method)) {
			console.log('Body:', req.body);
		}
	}
	next();
});

if (serverRoutes) { app.use('/api/servers', serverRoutes); registeredRoutes.push({ mount: '/api/servers', loaded: true }); } else { console.warn('Skipping /api/servers mount because serverRoutes failed to load'); registeredRoutes.push({ mount: '/api/servers', loaded: false }); }
if (userRoutes) { app.use('/api/users', userRoutes); registeredRoutes.push({ mount: '/api/users', loaded: true }); } else { console.warn('Skipping /api/users mount because userRoutes failed to load'); registeredRoutes.push({ mount: '/api/users', loaded: false }); }
if (authRoutes) { app.use('/api/auth', authRoutes); registeredRoutes.push({ mount: '/api/auth', loaded: true }); } else { console.warn('Skipping /api/auth mount because authRoutes failed to load'); registeredRoutes.push({ mount: '/api/auth', loaded: false }); }
if (adminRoutes) { app.use('/api/admin', adminRoutes); registeredRoutes.push({ mount: '/api/admin', loaded: true }); } else { console.warn('Skipping /api/admin mount because adminRoutes failed to load'); registeredRoutes.push({ mount: '/api/admin', loaded: false }); }

// Fallback route: expose a lightweight endpoint for frontend to query current user's server-admin assignments
// This duplicates the logic in routes/admin.js but ensures the endpoint is available even if router internals differ
app.get('/api/admin/my-server-admins', authenticateToken, async (req, res) => {
	try {
		const uid = req.user && req.user.id ? req.user.id : null;
		if (!uid) return res.status(401).json({ msg: 'Unauthorized' });
		if (req.user.role === 'ADMIN') return res.json({ role: 'ADMIN', server_admin_for: [] });
		const { rows } = await pool.query('SELECT server_id FROM server_admin_permissions WHERE admin_id = $1', [uid]);
		return res.json({ role: req.user.role, server_admin_for: rows.map(r => r.server_id) });
	} catch (err) {
		console.error('Fallback my-server-admins error', err && err.stack ? err.stack : err);
		res.status(500).json({ msg: 'Server Error' });
	}
});

// Debug: print what we registered and the internal router stack size so it's visible on startup
try {
	log.info('registered-mounts', { mounts: registeredRoutes });
	const stack = (app._router && app._router.stack) || [];
	log.debug('router-stack', { length: stack.length });
} catch (e) {
	console.warn('Failed to log router diagnostics', e && e.message ? e.message : e);
}

// Health endpoint for bot status (reads telegram_bot_status stored by the bot process)
console.log('[MOUNT] mounting /internal/bot/status');
app.get('/internal/bot/status', async (req, res) => {
	// handler entry
	console.log('[REQ-HIT] /internal/bot/status received');
	try {
		const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram_bot_status'");
		const data = r.rows && r.rows[0] ? r.rows[0].data : null;
		return res.json({ ok: true, status: data });
	} catch (e) {
		console.error('GET /internal/bot/status failed:', e && e.message ? e.message : e);
		return res.status(500).json({ ok: false, error: 'failed to read bot status' });
	}
});

// Prometheus metrics endpoint
console.log('[MOUNT] mounting /metrics');
app.get('/metrics', async (req, res) => {
	console.log('[REQ-HIT] /metrics received');
	try {
			// read current bot status and set gauge accordingly
		try {
			const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram_bot_status'");
			const data = r.rows && r.rows[0] ? r.rows[0].data : null;
			if (data && data.last_success) {
				telegramBotGauge.set(1);
			} else {
				telegramBotGauge.set(0);
			}
		} catch (e) {
			telegramBotGauge.set(0);
		}
			// expose matview refresh state gauges
			try {
				const { getMatviewRefreshState } = require('./lib/matview_refresh_state');
				const st = getMatviewRefreshState();
				if (!app.locals.matviewRunningGauge) {
					app.locals.matviewRunningGauge = new client.Gauge({ name: 'cmp_matview_refresh_running', help: 'Matview refresh currently running (1) or idle (0)' });
				}
				if (!app.locals.matviewPendingGauge) {
					app.locals.matviewPendingGauge = new client.Gauge({ name: 'cmp_matview_refresh_pending', help: 'Matview refresh pending flag (1 if another refresh queued)' });
				}
				app.locals.matviewRunningGauge.set(st.isRunning ? 1 : 0);
				app.locals.matviewPendingGauge.set(st.pending ? 1 : 0);
			} catch (e) {
				// swallow errors; gauges just won't update
			}
		// general settings key count & drop detection gauges (lightweight)
		try {
			if (!app.locals.generalKeyCountGauge) {
				app.locals.generalKeyCountGauge = new client.Gauge({ name: 'cmp_general_settings_key_count', help: 'Number of top-level keys in app_settings.general' });
			}
			if (!app.locals.generalKeyDropCounter) {
				app.locals.generalKeyDropCounter = new client.Counter({ name: 'cmp_general_settings_key_drop_events', help: 'Count of detected significant key-drop warning audit events' });
			}
			const gRow = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
			const gData = gRow.rows && gRow.rows[0] ? (gRow.rows[0].data || {}) : {};
			app.locals.generalKeyCountGauge.set(Object.keys(gData).length);
			// read recent WARNING_KEY_DROP events to increment counter since last scrape (best-effort)
			const warnRows = await pool.query("SELECT COUNT(*)::int AS c FROM settings_audit WHERE settings_key = 'general' AND action = 'WARNING_KEY_DROP' AND created_at >= (now() - interval '10 minutes')");
			const recentDrops = warnRows.rows && warnRows.rows[0] ? warnRows.rows[0].c : 0;
			if (recentDrops > 0) {
				// increment counter by recentDrops (counter is cumulative so this adds; slight overcount possible on overlapping scrapes)
				app.locals.generalKeyDropCounter.inc(recentDrops);
			}
		} catch (e) {
			// ignore errors; metrics are ancillary
		}
		res.set('Content-Type', client.register.contentType);
		return res.end(await client.register.metrics());
	} catch (e) {
		console.error('Failed to render /metrics:', e && e.message ? e.message : e);
		res.status(500).end();
	}
});

// Simple readiness/liveness endpoints for orchestration
// - /internal/live: always 200 when process is up
// - /internal/ready: checks DB connectivity briefly
app.get('/internal/live', (req, res) => {
	res.json({ ok: true, pid: process.pid, uptimeSec: Math.round(process.uptime()) });
});

app.get('/internal/ready', async (req, res) => {
	try {
		// very light query; if db env not set (test), still return ok
		if (!process.env.DB_HOST) return res.json({ ok: true, db: 'skipped' });
		const r = await pool.query('SELECT 1 as x');
		if (r && r.rows && r.rows[0] && r.rows[0].x === 1) {
			return res.json({ ok: true, db: 'ok' });
		}
		return res.status(500).json({ ok: false, db: 'unexpected result' });
	} catch (e) {
		return res.status(500).json({ ok: false, db: 'error', error: e && e.message ? e.message : String(e) });
	}
});

// Lightweight health & feature flags endpoint
// Returns process uptime, timestamp, and feature toggles (matview usage) for UI indicators.
app.get('/api/health', async (req, res) => {
	try {
		let useMatview = false;
		try {
			const { detectMatviewSupport } = require('./lib/matview_detect');
			const mv = await detectMatviewSupport(pool);
			useMatview = !!mv.enabled;
		} catch (e) {
			const v = String(process.env.USE_USER_STATUS_MATVIEW || '').trim().toLowerCase();
			useMatview = (v === '1' || v === 'true' || v === 'yes' || v === 'on');
			console.warn('matview dynamic detection failed in /api/health; using env only:', e && e.message ? e.message : e);
		}
		// Report whether a refresh is currently running (best-effort): require matview_refresh lazily
		let refreshState = null;
		try {
			const { isMatviewRefreshRunning } = require('./lib/matview_refresh_state');
			refreshState = typeof isMatviewRefreshRunning === 'function' ? !!isMatviewRefreshRunning() : null;
		} catch (_) { /* ignore missing helper */ }
		// Versions block: git SHA + build timestamp (if available)
		let gitSha = null;
		try {
			const rev = require('child_process').execSync('git rev-parse --short HEAD', { cwd: path.resolve(__dirname, '..'), stdio: ['ignore','pipe','ignore'] }).toString().trim();
			gitSha = rev || null;
		} catch (_) {}
		const buildTs = process.env.BUILD_TIMESTAMP || null;
		return res.json({
			ok: true,
			ts: Date.now(),
			uptimeSec: Math.round(process.uptime()),
			features: { useUserStatusMatview: useMatview },
			matview: { refreshing: refreshState },
			versions: { gitSha, buildTimestamp: buildTs, appVersion: app.locals.appVersion || null }
		});
	} catch (e) {
		return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'health failed' });
	}
});

// Admin-only Matview status and control endpoints
app.get('/api/admin/matviews', async (req, res, next) => {
	try {
		return authenticateToken(req, res, async () => {
			try {
				if (!req.user || req.user.role !== 'ADMIN') return res.status(403).json({ msg: 'Forbidden' });
				// Read in-process state
				let running = null, pendingFlag = null;
				try {
					const { getMatviewRefreshState } = require('./lib/matview_refresh_state');
					const st = getMatviewRefreshState();
					running = !!st.isRunning;
					pendingFlag = !!st.pending;
				} catch (_) {}
				// Read last success timestamp (if app_settings available)
				let lastSuccess = null;
				try {
					const r = await pool.query("SELECT data->>'last_success' AS last_success FROM app_settings WHERE settings_key = 'user_status_matview_refresh'");
					lastSuccess = r.rows && r.rows[0] ? (r.rows[0].last_success || null) : null;
				} catch (_) {}
				// Check existence and unique index support for CONCURRENT refresh
				let exists = null;
				let uniqueIndex = null;
				try {
					const mv = await pool.query("SELECT to_regclass('public.user_status_matview') AS name");
					exists = !!(mv.rows && mv.rows[0] && mv.rows[0].name);
				} catch (_) { exists = null; }
				try {
					// check specific unique index created by our migration
					const iq = await pool.query(
						"SELECT EXISTS (\n                           SELECT 1\n                           FROM pg_class c\n                           JOIN pg_index i ON c.oid = i.indrelid\n                           JOIN pg_class ic ON i.indexrelid = ic.oid\n                           WHERE c.relname = 'user_status_matview'\n                             AND ic.relname = 'user_status_matview_id_unique_idx'\n                             AND i.indisunique = true\n                         ) AS has_unique"
					);
					uniqueIndex = iq.rows && iq.rows[0] ? !!iq.rows[0].has_unique : false;
				} catch (_) { uniqueIndex = null; }
				const concurrent_supported = exists === true && uniqueIndex === true;
				return res.json({ ok: true, matviews: [{ name: 'user_status_matview', refreshing: running, pending: pendingFlag, last_success: lastSuccess, exists, unique_index: uniqueIndex, concurrent_supported }] });
			} catch (e) {
				console.error('GET /api/admin/matviews error:', e);
				return res.status(500).json({ msg: 'Server Error' });
			}
		});
	} catch (e) { return next(e); }
});

app.post('/api/admin/matviews/:name/refresh', async (req, res, next) => {
	try {
		return authenticateToken(req, res, async () => {
			try {
				if (!req.user || req.user.role !== 'ADMIN') return res.status(403).json({ msg: 'Forbidden' });
				const name = String(req.params.name || '').toLowerCase();
				if (name !== 'user_status_matview') return res.status(400).json({ msg: 'Unknown matview' });
				const mode = (String(req.query.mode || 'enqueue').toLowerCase());
				const { enqueueRefresh, refreshNow } = require('./lib/matview_refresh');
				if (mode === 'now') {
					await refreshNow();
					return res.json({ ok: true, refreshed: true });
				}
				enqueueRefresh();
				return res.json({ ok: true, enqueued: true });
			} catch (e) {
				console.error('POST /api/admin/matviews/:name/refresh error:', e);
				return res.status(500).json({ msg: 'Server Error' });
			}
		});
	} catch (e) { return next(e); }
});

// Development-only debug endpoints to assist during local troubleshooting
if (process.env.NODE_ENV !== 'production') {
	app.get('/__debug/ping', (req, res) => res.json({ ok: true }));

    		// Dev-only create-admin route removed - use proper seed script (`seedAdmin.js`) or migration runner instead.

	app.get('/__debug/routes', (req, res) => {
			try {
				const routes = [];
				const stack = (app._router && app._router.stack) || [];
				stack.forEach(layer => {
					try {
						// direct route
						if (layer && layer.route) {
							const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase());
							routes.push({ path: layer.route.path, methods });
							return;
						}

						// nested router
						if (layer && (layer.name === 'router' || layer.handle && layer.handle.stack)) {
							const inner = (layer.handle && layer.handle.stack) || [];
							inner.forEach(l => {
								try {
									if (l && l.route) {
										const methods = Object.keys(l.route.methods || {}).map(m => m.toUpperCase());
										// attempt to include the parent prefix if present
										const parentPath = layer.regexp && layer.regexp.source ? layer.regexp.source.replace('^\\/?', '').replace('(?=\\/?|$)', '') : '';
										routes.push({ path: l.route.path, methods, parent: parentPath });
									}
								} catch (e) {
									// ignore inner error
								}
							});
						}
					} catch (e) {
						// ignore this layer if anything goes wrong
					}
				});
						// also include a lightweight diagnostic of the raw stack to help debug
						const raw = stack.map((layer, i) => ({
							index: i,
							name: layer && layer.name,
							hasRoute: !!(layer && layer.route),
							routePath: layer && layer.route && layer.route.path,
							regexp: layer && layer.regexp && layer.regexp.source,
							hasHandleStack: !!(layer && layer.handle && layer.handle.stack),
						}));

						res.json({ routes, rawLayers: raw, registeredMounts: registeredRoutes });
			} catch (err) {
				console.error('Route enumeration failed:', err);
				res.status(500).json({ error: 'failed to enumerate routes' });
			}
	});
	}
	// Development-only debug endpoints were removed to harden the local environment.
	// Use `seedAdmin.js` or `run_migrations.js` for seeding and migrations, and local logging for diagnostics.

module.exports = app;

// 404 handler for unmatched routes (JSON) - helpful during dev
app.use((req, res) => {
	console.warn('404 - not found:', req.method, req.originalUrl);
	res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// error handler to convert payload-too-large HTML to JSON and log details
app.use((err, req, res, next) => {
	if (!err) return next();
	try {
		console.error('Express error middleware caught:', err && err.stack ? err.stack : err);
		// multer file-size error
		if (err.code === 'LIMIT_FILE_SIZE') {
			console.error('Multer LIMIT_FILE_SIZE:', err.message);
			return res.status(413).json({ msg: 'Uploaded file too large' });
		}
		if (err.type === 'entity.too.large' || err.status === 413) {
			console.error('Raw body/entity too large:', err.message || err);
			return res.status(413).json({ msg: 'Payload too large' });
		}
		// For API routes, return JSON instead of the default HTML error page
		if (req && typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/api/')) {
			const status = err.status && Number.isFinite(Number(err.status)) ? Number(err.status) : 500;
			return res.status(status).json({ msg: err.message || 'Server Error' });
		}
	} catch (e) {
		console.error('Error in error handler', e);
	}
	next(err);
});
