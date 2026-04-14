const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../utils/supabase');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login timestamp
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });

    // Log the login action
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      username: user.username,
      user_role: user.role,
      action: 'LOGIN',
      details: `User ${user.username} logged in.`
    });

    res.status(200).json({ token, user: { id: user.id, username: user.username, role: user.role, lastLogin: new Date().toISOString() } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});

router.post('/logout', async (req, res) => {
  // In a token-based system, logout is often handled client-side by deleting the token.
  // However, we can still log the action on the server if a token is provided.
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.id && decoded.username && decoded.role) {
        await supabase.from('audit_logs').insert({
          user_id: decoded.id,
          username: decoded.username,
          user_role: decoded.role,
          action: 'LOGOUT',
          details: `User ${decoded.username} logged out.`
        });
        return res.status(200).json({ message: 'Logged out successfully' });
      }
    } catch (error) {
      // If token is invalid or expired, we can't decode, just ignore the log for logout
      console.warn('Attempted logout with invalid token:', error.message);
    }
  }
  res.status(200).json({ message: 'Logged out successfully (no token provided or invalid)' });
});

module.exports = router;
