const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get all system audit logs (Admin only)
router.get('/audit-logs', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('log_timestamp', { ascending: false });

    if (error) throw error;

    res.status(200).json(logs);
  } catch (err) {
    console.error('Error fetching audit logs:', err.message);
    res.status(500).json({ message: 'Error fetching audit logs' });
  }
});

// Get user login/logout history (Admin only)
router.get('/user-logs', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .in('action', ['LOGIN', 'LOGOUT'])
      .order('log_timestamp', { ascending: false });

    if (error) throw error;

    res.status(200).json(logs);
  } catch (err) {
    console.error('Error fetching user logs:', err.message);
    res.status(500).json({ message: 'Error fetching user logs' });
  }
});

module.exports = router;
