const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get all sales (Admin, Cashier, Staff can view, but Staff might have limited views based on business logic)
router.get('/', authenticateToken, authorizeRole(['admin', 'cashier', 'staff']), async (req, res) => {
  try {
    const { data: sales, error } = await supabase
      .from('sales')
      .select('*, users(username)'); // Fetch cashier username

    if (error) throw error;

    res.status(200).json(sales.map(s => ({ ...s, cashier: s.users ? s.users.username : 'Unknown' })));
  } catch (err) {
    console.error('Error fetching sales:', err.message);
    res.status(500).json({ message: 'Error fetching sales' });
  }
});

// Create a new sale (POS transaction) (Admin, Cashier)
router.post('/', authenticateToken, authorizeRole(['admin', 'cashier']), async (req, res) => {
  const { items, subtotal, discountLabel, discountAmt, vatable, vat, total, paymentMethod, amountTendered, change } = req.body;

  if (!items || items.length === 0 || !total || !paymentMethod) {
    return res.status(400).json({ message: 'Missing required sale details or items' });
  }

  const saleId = Date.now().toString().slice(-6); // Replicate original ID generation
  const cashierId = req.user.id;

  try {
    // 1. Deduct stock and prepare sale items
    const saleItems = [];
    for (const item of items) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('name, price, stock')
        .eq('id', item.id)
        .single();

      if (productError || !product) throw new Error(`Product ${item.id} not found.`);
      if (product.stock < item.qty) throw new Error(`Insufficient stock for ${product.name}.`);

      await supabase
        .from('products')
        .update({ stock: product.stock - item.qty })
        .eq('id', item.id);

      saleItems.push({
        product_id: item.id,
        product_name: product.name,
        product_price: product.price,
        quantity: item.qty,
      });
    }

    // 2. Insert into sales table
    const { data: newSale, error: saleError } = await supabase
      .from('sales')
      .insert({
        id: saleId,
        subtotal,
        discount_label: discountLabel,
        discount_amount: discountAmt,
        vatable_amount: vatable,
        vat_amount: vat,
        total_amount: total,
        cashier_id: cashierId,
        payment_method: paymentMethod,
        amount_tendered: amountTendered,
        change_amount: change,
        status: 'Completed'
      })
      .select('*')
      .single();

    if (saleError) throw saleError;

    // 3. Insert into sale_items table
    const itemsToInsert = saleItems.map(si => ({ ...si, sale_id: newSale.id }));
    const { error: saleItemsError } = await supabase
      .from('sale_items')
      .insert(itemsToInsert);

    if (saleItemsError) throw saleItemsError;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'SALE',
      details: `POS Sale #${newSale.id} completed. Total: ${total.toFixed(2)}`
    });

    res.status(201).json(newSale);
  } catch (err) {
    console.error('Error processing sale:', err.message);
    res.status(500).json({ message: 'Error processing sale: ' + err.message });
  }
});

// Process a refund for a sale (Admin)
router.put('/:id/refund', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  const { id } = req.params; // Sale ID

  try {
    const { data: sale, error: fetchError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    if (sale.status === 'Refunded') {
      return res.status(400).json({ message: 'Sale already refunded' });
    }

    // Return items to stock
    const { data: saleItems, error: itemsError } = await supabase
      .from('sale_items')
      .select('product_id, quantity')
      .eq('sale_id', id);

    if (itemsError) throw itemsError;

    for (const item of saleItems) {
      // READ current stock
      const { data: currentProduct, error: fetchStockError } = await supabase
        .from('products')
        .select('stock')
        .eq('id', item.product_id)
        .single();

      if (fetchStockError) throw fetchStockError;

      // UPDATE with new total
      await supabase
        .from('products')
        .update({ stock: currentProduct.stock + item.quantity })
        .eq('id', item.product_id);
    }

    // Update sale status to Refunded
    const { data: updatedSale, error: updateError } = await supabase
      .from('sales')
      .update({ status: 'Refunded', refund_date: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'REFUND_SALE',
      details: `Refunded Sale #${id}. Items returned to stock.`
    });

    res.status(200).json(updatedSale);
  } catch (err) {
    console.error('Error processing refund:', err.message);
    res.status(500).json({ message: 'Error processing refund: ' + err.message });
  }
});

module.exports = router;