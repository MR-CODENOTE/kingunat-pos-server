const jwt = require('jsonwebtoken');
const supabase = require('../utils/supabase');

const JWT_SECRET = process.env.JWT_SECRET;

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.status(401).json({ message: 'Authentication token required' });

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });

    // Fetch user from DB to ensure they still exist and role is current
    const { data, error } = await supabase.from('users').select('id, username, role').eq('id', user.id).single();
    if (error || !data) {
      return res.status(403).json({ message: 'User not found or token invalid' });
    }

    req.user = data; // Attach user information to request
    next();
  });
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: Insufficient privileges' });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRole };
