const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware');

// GET all domains (admin only)
router.get('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, domain, server, service, unlimited, created_at, updated_at FROM domains ORDER BY created_at DESC'
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error('Error fetching domains:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// POST - Add new domain (admin only)
router.post('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { domain, server, service, unlimited } = req.body;

    if (!domain || !server || !service) {
      return res.status(400).json({ error: 'Domain, server, and service are required' });
    }

    if (!['Basic', 'Premium'].includes(service)) {
      return res.status(400).json({ error: 'Service must be Basic or Premium' });
    }

    const result = await pool.query(
      'INSERT INTO domains (domain, server, service, unlimited) VALUES ($1, $2, $3, $4) RETURNING *',
      [domain.trim(), server.trim(), service, unlimited === true]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding domain:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// PUT - Update domain (admin only)
router.put('/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { domain, server, service, unlimited } = req.body;

    if (!domain || !server || !service) {
      return res.status(400).json({ error: 'Domain, server, and service are required' });
    }

    if (!['Basic', 'Premium'].includes(service)) {
      return res.status(400).json({ error: 'Service must be Basic or Premium' });
    }

    const result = await pool.query(
      'UPDATE domains SET domain = $1, server = $2, service = $3, unlimited = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
      [domain.trim(), server.trim(), service, unlimited === true, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating domain:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// DELETE - Delete single domain (admin only)
router.delete('/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM domains WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    res.json({ message: 'Domain deleted successfully' });
  } catch (err) {
    console.error('Error deleting domain:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

// POST - Batch delete domains (admin only)
router.post('/batch-delete', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'IDs array is required' });
    }

    const result = await pool.query(
      'DELETE FROM domains WHERE id = ANY($1::int[]) RETURNING id',
      [ids]
    );

    res.json({ 
      message: `${result.rows.length} domains deleted successfully`,
      deletedCount: result.rows.length
    });
  } catch (err) {
    console.error('Error batch deleting domains:', err);
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;
