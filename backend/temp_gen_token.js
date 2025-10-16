require('dotenv').config();
const jwt = require('jsonwebtoken');
const token = jwt.sign({ user: { id: 1, role: 'ADMIN' } }, process.env.JWT_SECRET, { expiresIn: '24h' });
console.log(token);
