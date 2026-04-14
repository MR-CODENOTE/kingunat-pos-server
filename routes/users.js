const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get all users (Admin only)
router.get('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, role, last_login, created_at');

    if (error) throw error;

    res.status(200).json(users);
  } catch (err) {
    console.error('Error fetching users:', err.message);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Add a new user (Admin only)
router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Missing username, password, or role' });
  }
  if (!['admin', 'cashier', 'staff'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    // Check for existing username
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (existingUser) {
      return res.status(409).json({ message: 'Username already exists' });
    }
    if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ username, password: hashedPassword, role })
      .select('id, username, role')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'ADD_USER',
      details: `Created new user: ${username} (${role})`
    });

    res.status(201).json(newUser);
  } catch (err) {
    console.error('Error adding user:', err.message);
    res.status(500).json({ message: 'Error adding user' });
  }
});

// Update user (Admin only)
router.put('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { username, password, role } = req.body;
  let updatePayload = {};

  if (username) updatePayload.username = username;
  if (role) {
    if (!['admin', 'cashier', 'staff'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    updatePayload.role = role;
  }
  if (password) updatePayload.password = await bcrypt.hash(password, 10);

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ message: 'No fields to update' });
  }

  try {
    // Check if new username conflicts with another user
    if (username) {
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .not('id', 'eq', id)
        .single();

      if (existingUser) {
        return res.status(409).json({ message: 'Username already taken' });
      }
      if (checkError && checkError.code !== 'PGRST116') {
          throw checkError;
      }
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', id)
      .select('id, username, role')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'UPDATE_USER',
      details: `Updated user: ${updatedUser.username} (ID: ${updatedUser.id})`
    });

    res.status(200).json(updatedUser);
  } catch (err) {
    console.error('Error updating user:', err.message);
    res.status(500).json({ message: 'Error updating user' });
  }
});

// Delete user (Admin only)
router.delete('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { id } = req.params;

  try {
    const { data: userToDelete, error: fetchError } = await supabase
      .from('users')
      .select('username')
      .eq('id', id)
      .single();

    if (fetchError || !userToDelete) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (userToDelete.username === 'admin') {
      return res.status(403).json({ message: 'Cannot delete the default admin user' });
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'DELETE_USER',
      details: `Deleted user: ${userToDelete.username} (ID: ${id})`
    });

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting user:', err.message);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

module.exports = router;
