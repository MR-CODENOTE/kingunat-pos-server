const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, authorizeRole(['admin', 'cashier', 'staff']), async (req, res) => {
  try {
    const { data: sales, error } = await supabase.from('sales').select('*, users(username)');
    if (error) throw error;
    res.status(200).json(sales.map(s => ({ ...s, cashier: s.users ? s.users.username : 'Unknown' })));
  } catch (err) { res.status(500).json({ message: 'Error fetching sales' }); }
});

router.post('/', authenticateToken, authorizeRole(['admin', 'cashier']), async (req, res) => {
  const { items, total, paymentMethod } = req.body;
  if (!items || items.length === 0 || !total) return res.status(400).json({ message: 'Missing sale details' });

  const saleId = Date.now().toString().slice(-6);
  try {
    const saleItems = [];
    for (const item of items) {
      const { data: product } = await supabase.from('products').select('*').eq('id', item.id).single();
      if (!product || product.stock < item.qty) throw new Error(`Stock error for ${product?.name}`);
      
      await supabase.from('products').update({ stock: product.stock - item.qty }).eq('id', item.id);
      saleItems.push({ product_id: item.id, product_name: product.name, product_price: product.price, quantity: item.qty });
    }

    const { data: newSale } = await supabase.from('sales').insert({ id: saleId, total_amount: total, cashier_id: req.user.id, payment_method: paymentMethod, status: 'Completed' }).select('*').single();
    await supabase.from('sale_items').insert(saleItems.map(si => ({ ...si, sale_id: newSale.id })));
    res.status(201).json(newSale);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put('/:id/refund', authenticateToken, authorizeRole(['admin']), async (req, res) => {
  try {
    const { data: sale } = await supabase.from('sales').select('*').eq('id', req.params.id).single();
    if (!sale || sale.status === 'Refunded') return res.status(404).json({ message: 'Invalid refund' });

    const { data: items } = await supabase.from('sale_items').select('*').eq('sale_id', req.params.id);
    for (const item of items) {
      const { data: prod } = await supabase.from('products').select('stock').eq('id', item.product_id).single();
      await supabase.from('products').update({ stock: prod.stock + item.quantity }).eq('id', item.product_id);
    }

    const { data: updated } = await supabase.from('sales').update({ status: 'Refunded' }).eq('id', req.params.id).select('*').single();
    res.status(200).json(updated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;