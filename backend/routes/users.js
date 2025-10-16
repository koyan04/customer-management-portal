const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, isAdmin, isServerAdminOrGlobal } = require('../middleware/authMiddleware');

// Middleware: attach server_id of the target user (from :userId) to req.params.serverId
const attachUserServerId = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!userId || Number.isNaN(Number(userId))) return res.status(400).json({ msg: 'Invalid user id' });
    const { rows } = await pool.query('SELECT server_id FROM users WHERE id = $1', [userId]);
    if (!rows || rows.length === 0) return res.status(404).json({ msg: 'User not found' });
    req.params.serverId = rows[0].server_id;
    return next();
  } catch (err) {
    console.error('attachUserServerId error', err && err.message ? err.message : err);
    return res.status(500).json({ msg: 'Server Error' });
  }
};

// GET all users for a specific server
router.get('/server/:serverId', authenticateToken, async (req, res) => {
  try {
    const { serverId } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ msg: 'Unauthorized' });
    // Admins can view any server
    if (user.role === 'ADMIN') {
      const { rows } = await pool.query('SELECT * FROM users WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
      return res.json(rows);
    }
    // Viewers/Server-Admins: ensure they have permission for this server
    // First check server_admin_permissions (server admins can view users too)
    const serverAdminCheck = await pool.query('SELECT 1 FROM server_admin_permissions WHERE admin_id = $1 AND server_id = $2', [user.id, serverId]);
    if (serverAdminCheck.rows && serverAdminCheck.rows.length > 0) {
      const { rows } = await pool.query('SELECT * FROM users WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
      return res.json(rows);
    }
    const perm = await pool.query('SELECT 1 FROM viewer_server_permissions WHERE editor_id = $1 AND server_id = $2', [user.id, serverId]);
    if (!perm.rows || perm.rows.length === 0) return res.status(403).json({ msg: 'Forbidden' });
    const { rows } = await pool.query('SELECT * FROM users WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
    return res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new user to a server (ADMIN or SERVER_ADMIN for the given server)
router.post('/', authenticateToken, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const {
      account_name, service_type, account_type, expire_date,
      total_devices, data_limit_gb, server_id, remark, // Added remark
    } = req.body;

    const newUser = await pool.query(
      'INSERT INTO users (account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, server_id, remark) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, server_id, remark]
    );
    res.status(201).json(newUser.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// UPDATE a user (ADMIN or SERVER_ADMIN for the target user's server)
// attachUserServerId will set req.params.serverId so isServerAdminOrGlobal can validate access
router.put('/:userId', authenticateToken, attachUserServerId, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      account_name, service_type, account_type, expire_date,
      total_devices, data_limit_gb, remark, // Added remark
    } = req.body;

    const updatedUser = await pool.query(
      'UPDATE users SET account_name = $1, service_type = $2, account_type = $3, expire_date = $4, total_devices = $5, data_limit_gb = $6, remark = $7 WHERE id = $8 RETURNING *',
      [account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, remark, userId]
    );
    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// DELETE a user (ADMIN or SERVER_ADMIN for the target user's server)
// attachUserServerId will set req.params.serverId so isServerAdminOrGlobal can validate access
router.delete('/:userId', authenticateToken, attachUserServerId, isServerAdminOrGlobal(), async (req, res) => {
  try {
    const { userId } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ msg: 'User deleted' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;