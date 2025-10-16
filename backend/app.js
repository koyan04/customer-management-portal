require('dotenv').config();
const express = require('express');
const cors = require('cors');

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

const path = require('path');
const fs = require('fs');
const getRawBody = require('raw-body');
const app = express();
app.use(cors());

// Early logger to help trace incoming requests before other middleware
app.use((req, res, next) => {
	try {
		console.log('[EARLY-REQ] ', req.method, req.originalUrl, ' headers:', { origin: req.headers.origin, host: req.headers.host });
	} catch (e) { }
	next();
});

// diagnose large uploads: log incoming content-length/transfer-encoding before body parsing
app.use((req, res, next) => {
	try {
		const cl = req.headers['content-length'];
		const te = req.headers['transfer-encoding'];
		console.log('[INCOMING] method=%s url=%s Content-Length=%s Transfer-Encoding=%s', req.method, req.originalUrl, cl, te);
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

const pool = require('./db');
const bcrypt = require('bcrypt');
const { authenticateToken } = require('./middleware/authMiddleware');

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

// simple request logger to aid local debugging
app.use((req, res, next) => {
	console.log(`[REQ] ${req.method} ${req.originalUrl}`);
	// avoid logging large bodies in production
	if (process.env.NODE_ENV !== 'production' && ['POST','PUT','PATCH'].includes(req.method)) {
		console.log('Body:', req.body);
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
	console.log('Registered mounts:', JSON.stringify(registeredRoutes, null, 2));
	const stack = (app._router && app._router.stack) || [];
	console.log('Express router stack length:', stack.length);
} catch (e) {
	console.warn('Failed to log router diagnostics', e && e.message ? e.message : e);
}

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
	} catch (e) {
		console.error('Error in error handler', e);
	}
	next(err);
});
