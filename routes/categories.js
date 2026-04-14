const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get all categories
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('id, name');

    if (error) throw error;

    res.status(200).json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err.message);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

// Add a new category (Admin)
router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ message: 'Category name cannot be empty' });
  }

  try {
    // Check if category already exists
    const { data: existingCategory, error: checkError } = await supabase
      .from('categories')
      .select('id')
      .eq('name', name)
      .single();

    if (existingCategory) {
      return res.status(409).json({ message: 'Category with this name already exists' });
    }
    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 means no rows found
        throw checkError;
    }

    const { count: categoryCount, error: countError } = await supabase
      .from('categories')
      .select('*', { count: 'exact' });

    if (countError) throw countError;

    if (categoryCount >= 8) {
        return res.status(400).json({ message: 'Maximum of 8 categories allowed.' });
    }

    const { data: newCategory, error } = await supabase
      .from('categories')
      .insert({ name: name.trim() })
      .select('id, name')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'ADD_CATEGORY',
      details: `Added category: ${newCategory.name}`
    });

    res.status(201).json(newCategory);
  } catch (err) {
    console.error('Error adding category:', err.message);
    res.status(500).json({ message: 'Error adding category' });
  }
});

// Rename a category (Admin)
router.put('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { id } = req.params; // Category ID
  const { name: newName } = req.body;

  if (!newName || newName.trim() === '') {
    return res.status(400).json({ message: 'New category name cannot be empty' });
  }

  try {
    // Check if the new name already exists for another category
    const { data: existingCategory, error: checkError } = await supabase
      .from('categories')
      .select('id')
      .eq('name', newName)
      .not('id', 'eq', id)
      .single();

    if (existingCategory) {
      return res.status(409).json({ message: 'Category with this name already exists' });
    }
    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 means no rows found
      throw checkError;
    }

    const { data: oldCategory, error: fetchError } = await supabase
      .from('categories')
      .select('name')
      .eq('id', id)
      .single();
    
    if (fetchError || !oldCategory) {
        return res.status(404).json({ message: 'Category not found' });
    }

    const { data: updatedCategory, error } = await supabase
      .from('categories')
      .update({ name: newName.trim() })
      .eq('id', id)
      .select('id, name')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'RENAME_CATEGORY',
      details: `Renamed category from '${oldCategory.name}' to '${updatedCategory.name}'`
    });

    res.status(200).json(updatedCategory);
  } catch (err) {
    console.error('Error renaming category:', err.message);
    res.status(500).json({ message: 'Error renaming category' });
  }
});

// Delete a category (Admin)
router.delete('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { id } = req.params;

  try {
    const { data: categoryToDelete, error: fetchError } = await supabase
      .from('categories')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchError || !categoryToDelete) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const { count: categoryCount, error: countError } = await supabase
      .from('categories')
      .select('*', { count: 'exact' });

    if (countError) throw countError;

    if (categoryCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last category.' });
    }

    // Find fallback category (General or the first available)
    const { data: fallbackCategories, error: fallbackError } = await supabase
      .from('categories')
      .select('id, name')
      .neq('id', id)
      .order('name', { ascending: true });
    
    if (fallbackError) throw fallbackError;

    let fallbackCategoryId = null;
    if (fallbackCategories.length > 0) {
        const generalCategory = fallbackCategories.find(c => c.name === 'General');
        fallbackCategoryId = generalCategory ? generalCategory.id : fallbackCategories[0].id;
    }

    // Update products to point to the fallback category
    await supabase
      .from('products')
      .update({ category_id: fallbackCategoryId })
      .eq('category_id', id);

    // Now delete the category
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'DELETE_CATEGORY',
      details: `Deleted category: ${categoryToDelete.name}. Products moved to fallback.`
    });

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting category:', err.message);
    res.status(500).json({ message: 'Error deleting category' });
  }
});

module.exports = router;
