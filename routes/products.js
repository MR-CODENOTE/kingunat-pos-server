const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get all products
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('*, categories(name)'); // Fetch category name

    if (error) throw error;

    res.status(200).json(products.map(p => ({
      ...p, category: p.categories ? p.categories.name : 'General' // Flatten category name
    })));
  } catch (err) {
    console.error('Error fetching products:', err.message);
    res.status(500).json({ message: 'Error fetching products' });
  }
});

// Add a new product (Admin, Staff)
router.post('/', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  const { name, category, price, stock, image } = req.body;

  if (!name || !price || stock === undefined || !image) {
    return res.status(400).json({ message: 'Missing required product fields' });
  }
  if (price <= 0 || stock < 0) {
    return res.status(400).json({ message: 'Price must be positive, stock cannot be negative' });
  }

  try {
    // Find or create category
    let category_id = null;
    if (category) {
      const { data: existingCategory, error: catError } = await supabase
        .from('categories')
        .select('id')
        .eq('name', category)
        .single();

      if (catError && catError.code !== 'PGRST116') { // PGRST116 means no rows found
        console.error('Error finding category:', catError.message);
        throw catError;
      }

      if (existingCategory) {
        category_id = existingCategory.id;
      } else {
        // If category doesn't exist, create it (assuming general categories are managed elsewhere)
        const { data: newCategory, error: newCatError } = await supabase
          .from('categories')
          .insert({ name: category })
          .select('id')
          .single();
        if (newCatError) throw newCatError;
        category_id = newCategory.id;
      }
    }

    const { data: newProduct, error } = await supabase
      .from('products')
      .insert({ name, category_id, price, stock, image })
      .select('*')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'ADD_PRODUCT',
      details: `Added product: ${name} (ID: ${newProduct.id})`
    });

    res.status(201).json(newProduct);
  } catch (err) {
    console.error('Error adding product:', err.message);
    res.status(500).json({ message: 'Error adding product' });
  }
});

// Update product stock (Admin, Staff)
router.put('/:id/stock', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  const { id } = req.params;
  const { stock } = req.body;

  if (stock === undefined || stock < 0) {
    return res.status(400).json({ message: 'Stock must be a non-negative number' });
  }

  try {
    const { data: oldProduct, error: fetchError } = await supabase
      .from('products')
      .select('name, stock')
      .eq('id', id)
      .single();

    if (fetchError || !oldProduct) throw new Error('Product not found');

    const { data: updatedProduct, error } = await supabase
      .from('products')
      .update({ stock })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'UPDATE_STOCK',
      details: `Updated stock for ${oldProduct.name} from ${oldProduct.stock} to ${updatedProduct.stock}`
    });

    res.status(200).json(updatedProduct);
  } catch (err) {
    console.error('Error updating product stock:', err.message);
    res.status(500).json({ message: 'Error updating product stock' });
  }
});

// Delete a product (Admin, Staff)
router.delete('/:id', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  const { id } = req.params;

  try {
    const { data: productToDelete, error: fetchError } = await supabase
      .from('products')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchError || !productToDelete) throw new Error('Product not found');

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'DELETE_PRODUCT',
      details: `Deleted product: ${productToDelete.name} (ID: ${id})`
    });

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting product:', err.message);
    res.status(500).json({ message: 'Error deleting product' });
  }
});

module.exports = router;
