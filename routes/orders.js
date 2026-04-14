const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Get all online orders (Admin, Staff)
router.get('/', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('online_orders')
      .select('*');

    if (error) throw error;

    res.status(200).json(orders);
  } catch (err) {
    console.error('Error fetching online orders:', err.message);
    res.status(500).json({ message: 'Error fetching online orders' });
  }
});

// Get a single online order by ID
router.get('/:id', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  const { id } = req.params;
  try {
    const { data: order, error } = await supabase
      .from('online_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', id);
    
    if (itemsError) throw itemsError;

    res.status(200).json({ ...order, items });
  } catch (err) {
    console.error('Error fetching order details:', err.message);
    res.status(500).json({ message: 'Error fetching order details' });
  }
});

// Create a new online order (Admin, Staff)
router.post('/', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  const { customerName, customerContact, customerAddress, items, paymentMethod, notes } = req.body;

  if (!customerName || !customerContact || !customerAddress || !items || items.length === 0 || !paymentMethod) {
    return res.status(400).json({ message: 'Missing required order details' });
  }

  const orderId = (Math.floor(Math.random() * 90000) + 10000).toString(); // Replicate original ID generation
  let totalAmount = 0;
  const orderItems = [];

  try {
    // 1. Validate stock and prepare order items
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

      orderItems.push({
        product_id: item.id,
        product_name: product.name,
        product_price: product.price,
        quantity: item.qty,
      });
      totalAmount += product.price * item.qty;
    }

    // 2. Insert into online_orders table
    const { data: newOrder, error: orderError } = await supabase
      .from('online_orders')
      .insert({
        id: orderId,
        customer_name: customerName,
        customer_contact: customerContact,
        customer_address: customerAddress,
        total_amount: totalAmount,
        status: 'Pending',
        payment_method: paymentMethod,
        payment_status: 'Unpaid',
        notes: notes || null
      })
      .select('*')
      .single();

    if (orderError) throw orderError;

    // 3. Insert into order_items table
    const itemsToInsert = orderItems.map(oi => ({ ...oi, order_id: newOrder.id }));
    const { error: orderItemsError } = await supabase
      .from('order_items')
      .insert(itemsToInsert);

    if (orderItemsError) throw orderItemsError;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'CREATE_ONLINE_ORDER',
      details: `Created online order #${newOrder.id} for ${customerName}`
    });

    res.status(201).json(newOrder);
  } catch (err) {
    console.error('Error creating online order:', err.message);
    res.status(500).json({ message: 'Error creating online order: ' + err.message });
  }
});

// Update online order status (Admin, Staff)
router.put('/:id/status', authenticateToken, authorizeRole(['admin', 'staff']), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // Expected: 'Paid', 'Shipped', 'Completed', 'Canceled'

  if (!['Pending', 'Paid', 'Shipped', 'Completed', 'Canceled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid order status' });
  }

  try {
    const { data: order, error: fetchError } = await supabase
      .from('online_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status === 'Canceled' && status !== 'Canceled') {
      return res.status(400).json({ message: 'Cannot update a canceled order' });
    }

    if (order.status === 'Completed' && status !== 'Completed') {
      return res.status(400).json({ message: 'Cannot change status of a completed order' });
    }

    let paymentStatus = order.payment_status;
    if (status === 'Paid' || status === 'Completed') {
      paymentStatus = 'Paid';
    }
    if (status === 'Canceled') {
      paymentStatus = 'Unpaid';
    }

    // Handle 'Completed' status differently
    if (status === 'Completed' && order.status !== 'Completed') {
      // Create an associated sale record if it doesn't exist
      const { data: existingSale, error: saleCheckError } = await supabase
        .from('sales')
        .select('id')
        .eq('id', id) // Assuming online order ID directly maps to sale ID for 'Online System' sales
        .single();
      
      if (saleCheckError && saleCheckError.code !== 'PGRST116') throw saleCheckError; // Not found is okay

      if (!existingSale) {
        // Fetch order items to calculate VATable, VAT
        const { data: orderItems, error: itemsFetchError } = await supabase
          .from('order_items')
          .select('product_name, product_price, quantity')
          .eq('order_id', order.id);
        if (itemsFetchError) throw itemsFetchError;

        const vatable = order.total_amount / 1.12;
        const vat = order.total_amount - vatable;

        await supabase
          .from('sales')
          .insert({
            id: order.id,
            sale_date: new Date().toISOString(),
            subtotal: order.total_amount,
            discount_label: 'None',
            discount_amount: 0,
            vatable_amount: vatable,
            vat_amount: vat,
            total_amount: order.total_amount,
            cashier_id: null, // No specific cashier for online sales
            payment_method: order.payment_method,
            amount_tendered: order.total_amount,
            change_amount: 0,
            status: 'Completed'
          });
      }
    }

    // Handle 'Canceled' status: return stock
    if (status === 'Canceled' && order.status !== 'Canceled') {
      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select('product_id, quantity')
        .eq('order_id', id);

      if (itemsError) throw itemsError;

      for (const item of orderItems) {
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
      // If an associated sale existed and was 'Completed', mark it as 'Refunded'
      await supabase
        .from('sales')
        .update({ status: 'Refunded', refund_date: new Date().toISOString() })
        .eq('id', id);
    }

    const { data: updatedOrder, error } = await supabase
      .from('online_orders')
      .update({ status, payment_status: paymentStatus })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: req.user.id,
      username: req.user.username,
      user_role: req.user.role,
      action: 'UPDATE_ORDER_STATUS',
      details: `Updated online order #${id} status to ${status}`
    });

    res.status(200).json(updatedOrder);
  } catch (err) {
    console.error('Error updating order status:', err.message);
    res.status(500).json({ message: 'Error updating order status: ' + err.message });
  }
});

module.exports = router;