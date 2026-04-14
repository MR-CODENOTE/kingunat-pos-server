const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get discount presets
router.get('/discounts', authenticateToken, authorizeRole(['admin', 'cashier']), async (req, res) => {
  try {
    const { data: presets, error } = await supabase
      .from('discount_presets')
      .select('*');

    if (error) throw error;

    res.status(200).json(presets);
  } catch (err) {
    console.error('Error fetching discount presets:', err.message);
    res.status(500).json({ message: 'Error fetching discount presets' });
  }
});

// Update discount preset (Admin only)
router.put('/discounts/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { type, value, label } = req.body;

  if (!type || !value || !label) {
    return res.status(400).json({ message: 'Missing type, value, or label' });
  }
  if (!['percent', 'fixed'].includes(type)) {
    return res.status(400).json({ message: 'Invalid discount type' });
  }
  if (value <= 0) {
    return res.status(400).json({ message: 'Discount value must be positive' });
  }

  try {
    const { data: updatedPreset, error } = await supabase
      .from('discount_presets')
      .update({ type, value, label, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'UPDATE_SETTINGS',
      details: `Updated discount preset '${label}' (ID: ${id})`
    });

    res.status(200).json(updatedPreset);
  } catch (err) {
    console.error('Error updating discount preset:', err.message);
    res.status(500).json({ message: 'Error updating discount preset' });
  }
});

module.exports = router;
