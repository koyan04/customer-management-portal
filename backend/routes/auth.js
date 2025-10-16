const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// --- REGISTER A NEW ADMIN/EDITOR ---
// This route should ideally be protected or used only once for initial setup.
router.post('/register', async (req, res) => {
  const { display_name, username, password, role } = req.body;

  try {
    // 1. Check if the username already exists
    const user = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (user.rows.length > 0) {
      return res.status(401).json("Username already exists");
    }

    // 2. Hash the password
    const saltRounds = 10;
    const salt = await bcrypt.genSalt(saltRounds);
    const password_hash = await bcrypt.hash(password, salt);

    // 3. Insert the new admin into the database
    const newAdmin = await pool.query(
      'INSERT INTO admins (display_name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
      [display_name, username, password_hash, role]
    );

    res.status(201).json(newAdmin.rows[0]);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// --- LOGIN AN ADMIN/EDITOR ---
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Check if the user exists
    const user = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      return res.status(401).json("Invalid credentials");
    }

    // 2. Compare the provided password with the stored hash
    const admin = user.rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json("Invalid credentials");
    }

    // 3. If credentials are correct, create a JWT token
    const payload = {
      user: {
        id: admin.id,
        role: admin.role
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' }, // Token expires in 24 hours
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


module.exports = router;
