// Admin endpoints — managing products and viewing orders from a small
// internal dashboard (see /admin.html). Protected by requireAdmin below: a
// simple shared-secret header, good enough while it's just you running the
// shop. If you bring on staff, swap this for a proper `role` column on
// users + normal login.
const express = require('express');
const midtransClient = require('midtrans-client');
const db = require('../db');
const { sendMail } = require('../utils/mail');
const mailer = require('../utils/enquiryMail');

const router = express.Router();

const core = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

function requireAdmin(req, res, next){
  const key = req.headers['x-admin-key'];
  if(!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY){
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}
router.use(requireAdmin);

// GET /api/admin/products — list everything, including deactivated items
// (the public /api/products only returns active ones).
router.get('/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json({ products: rows.map(r => ({ ...r, images: JSON.parse(r.images || '[]'), is_active: !!r.is_active })) });
});

// POST /api/admin/products — create a new product
router.post('/products', (req, res) => {
  const p = req.body;
  if(!p.id || !p.name || !p.price){
    return res.status(400).json({ error: 'id, name, and price are required.' });
  }
  db.prepare(`
    INSERT INTO products (id, name, collection, type, price, description, material, gemstones, dimensions, weight, images, stock, is_active)
    VALUES (@id, @name, @collection, @type, @price, @description, @material, @gemstones, @dimensions, @weight, @images, @stock, @is_active)
  `).run({
    id: p.id, name: p.name, collection: p.collection || null, type: p.type || null,
    price: p.price, description: p.description || '',
    material: p.material || '', gemstones: p.gemstones || '', dimensions: p.dimensions || '', weight: p.weight || '',
    images: JSON.stringify(p.images || []),
    stock: p.stock ?? 0, is_active: p.is_active === false ? 0 : 1
  });
  res.status(201).json({ ok: true });
});

// PATCH /api/admin/products/:id — update price, stock, description, active state, etc.
router.patch('/products/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if(!existing) return res.status(404).json({ error: 'Product not found.' });

  const fields = ['name', 'collection', 'type', 'price', 'description', 'material', 'gemstones', 'dimensions', 'weight', 'stock', 'is_active'];
  const updates = [];
  const params = {};
  for(const f of fields){
    if(req.body[f] !== undefined){ updates.push(`${f} = @${f}`); params[f] = req.body[f]; }
  }
  if(req.body.images !== undefined){ updates.push('images = @images'); params.images = JSON.stringify(req.body.images); }
  if(updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.id = req.params.id;
  db.prepare(`UPDATE products SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(params);
  res.json({ ok: true });
});

// DELETE /api/admin/products/:id — soft-delete (hides from storefront, keeps order history intact)
router.delete('/products/:id', (req, res) => {
  const info = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
  if(info.changes === 0) return res.status(404).json({ error: 'Product not found.' });
  res.json({ ok: true });
});

// GET /api/admin/orders?status=pending
router.get('/orders', (req, res) => {
  let sql = 'SELECT * FROM orders';
  const params = [];
  if(req.query.status){ sql += ' WHERE status = ?'; params.push(req.query.status); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ orders: rows.map(o => ({ ...o, items: JSON.parse(o.items_json) })) });
});

// PATCH /api/admin/orders/:id  { status, markPaid? }  — e.g. mark as shipped
//
// Guard: moving an order into a "fulfillment" status (processing/shipped/
// completed) while payment_status isn't 'paid' used to be silently
// allowed — that's how an order could show "Completed" in the Status
// column while the Payment column still read "UNPAID". Now that's
// blocked unless the admin explicitly confirms via markPaid:true (for
// manual payments — cash, bank transfer confirmed by WhatsApp, etc. —
// that never went through Midtrans).
router.patch('/orders/:id', (req, res) => {
  const { status, markPaid } = req.body;
  const allowed = ['pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled'];
  if(!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if(!order) return res.status(404).json({ error: 'Order not found.' });

  const requiresPayment = ['processing', 'shipped', 'completed'];
  if(requiresPayment.includes(status) && order.payment_status !== 'paid' && !markPaid){
    return res.status(409).json({
      error: 'This order is still UNPAID. Confirm payment was received before moving it to this status.',
      code: 'PAYMENT_NOT_CONFIRMED'
    });
  }

  if(markPaid && order.payment_status !== 'paid'){
    db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(order.id);
  }

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/orders/:id/cancel-refund
// Cancels an unpaid Midtrans transaction, or refunds a paid one, then
// marks the order accordingly. Midtrans only allows a straight "cancel"
// before settlement and "refund" after — this picks the right call based
// on the order's current payment_status so you don't have to know which.
router.post('/orders/:id/cancel-refund', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if(!order) return res.status(404).json({ error: 'Order not found.' });

  try{
    if(!order.midtrans_order_id){
      // No real Midtrans transaction ever got created for this order
      // (e.g. it was confirmed manually via WhatsApp/bank transfer, or
      // the Midtrans call failed at checkout time) — nothing to
      // cancel/refund on Midtrans's side, just update our own records.
      db.prepare("UPDATE orders SET payment_status = 'failed', status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
        .run(order.id);
    }else if(order.payment_status === 'paid'){
      await core.transaction.refund(order.midtrans_order_id, {
        reason: req.body.reason || 'Refunded by store admin'
      });
      db.prepare("UPDATE orders SET payment_status = 'refunded', status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
        .run(order.id);
    }else{
      await core.transaction.cancel(order.midtrans_order_id);
      db.prepare("UPDATE orders SET payment_status = 'failed', status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
        .run(order.id);
    }
    // Orders decrement stock at creation time (see routes/orders.js) — put
    // it back now that the sale isn't going through.
    const items = JSON.parse(order.items_json);
    const restock = db.transaction((items) => {
      for(const i of items) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.id);
    });
    restock(items);

    sendMail({
      to: order.customer_email,
      subject: `Order ${order.order_number} cancelled`,
      html: `<p>Hi ${order.customer_name}, your order <strong>${order.order_number}</strong> has been cancelled${order.payment_status === 'refunded' ? ' and refunded' : ''}. Contact us if you have any questions.</p>`
    }).catch(err => console.error('Cancellation email failed:', err.message));

    res.json({ ok: true });
  }catch(err){
    console.error('Midtrans cancel/refund failed:', err.message);
    res.status(502).json({ error: 'Midtrans could not process this — it may already be settled/cancelled. Check the Midtrans dashboard directly.' });
  }
});

// ============================================================
// CONCIERGE ENQUIRIES (Assisted Checkout)
// ============================================================
const ENQUIRY_STATUSES = ['requested', 'in_conversation', 'confirmed', 'payment_instructed', 'paid', 'in_production', 'dispatched', 'delivered', 'cancelled'];
// Statuses that mean the pieces are committed against the design's production allocation.
const ALLOCATED_FROM = ['confirmed', 'payment_instructed', 'paid', 'in_production', 'dispatched', 'delivered'];

// GET /api/admin/enquiries?status=requested
router.get('/enquiries', (req, res) => {
  let sql = 'SELECT * FROM enquiries';
  const params = [];
  if(req.query.status){ sql += ' WHERE status = ?'; params.push(req.query.status); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ enquiries: rows.map(e => ({ ...e, items: JSON.parse(e.items_json), allocated: !!e.allocated })) });
});

// PATCH /api/admin/enquiries/:id
// { status?, confirmedAmount?, paymentInstruction?, paymentDue?, trackingInfo?, adminNotes?, notify? }
// - Moving to "confirmed" (or later) deducts each piece from that design's
//   production allocation (products.stock). If any design lacks enough
//   allocation the change is refused, so a design can never be over-sold.
// - Moving to "cancelled" gives allocated pieces back.
// - "payment_instructed" requires the payment instruction text to be filled in.
// - notify (default true) emails the client for status changes that have a template.
router.patch('/enquiries/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(req.params.id);
  if(!e) return res.status(404).json({ error: 'Request not found.' });

  const b = req.body || {};
  const next = b.status !== undefined ? b.status : e.status;
  if(!ENQUIRY_STATUSES.includes(next)) return res.status(400).json({ error: `status must be one of: ${ENQUIRY_STATUSES.join(', ')}` });

  const confirmedAmount = b.confirmedAmount !== undefined ? String(b.confirmedAmount).slice(0, 200) : e.confirmed_amount;
  const paymentInstruction = b.paymentInstruction !== undefined ? String(b.paymentInstruction).slice(0, 4000) : e.payment_instruction;
  const paymentDue = b.paymentDue !== undefined ? String(b.paymentDue).slice(0, 100) : e.payment_due;
  const trackingInfo = b.trackingInfo !== undefined ? String(b.trackingInfo).slice(0, 1000) : e.tracking_info;
  const adminNotes = b.adminNotes !== undefined ? String(b.adminNotes).slice(0, 4000) : e.admin_notes;

  if(next === 'payment_instructed' && !(paymentInstruction || '').trim()){
    return res.status(400).json({ error: 'Write the payment instruction before sending it to the client.', code: 'INSTRUCTION_REQUIRED' });
  }
  if(['paid', 'in_production', 'dispatched', 'delivered'].includes(next) && !['payment_instructed', 'paid', 'in_production', 'dispatched', 'delivered'].includes(e.status)){
    return res.status(409).json({ error: 'Payment instructions must be issued before this request can be marked paid or fulfilled.', code: 'SEQUENCE' });
  }

  const items = JSON.parse(e.items_json);
  let allocated = e.allocated;
  try{
    db.transaction(() => {
      if(ALLOCATED_FROM.includes(next) && !allocated){
        for(const i of items){
          const p = db.prepare('SELECT name, stock FROM products WHERE id = ?').get(i.id);
          if(!p || p.stock < i.qty){
            const err = new Error(`Not enough production allocation left for ${p ? p.name : i.id}.`);
            err.code = 'ALLOCATION'; throw err;
          }
        }
        for(const i of items) db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ?").run(i.qty, i.id);
        allocated = 1;
      }
      if(next === 'cancelled' && allocated){
        for(const i of items) db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?").run(i.qty, i.id);
        allocated = 0;
      }
      db.prepare(`UPDATE enquiries SET status = ?, allocated = ?, confirmed_amount = ?, payment_instruction = ?, payment_due = ?,
                  tracking_info = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(next, allocated, confirmedAmount || null, paymentInstruction || null, paymentDue || null, trackingInfo || null, adminNotes || null, e.id);
    })();
  }catch(err){
    if(err.code === 'ALLOCATION') return res.status(409).json({ error: err.message, code: 'ALLOCATION' });
    console.error(err);
    return res.status(500).json({ error: 'Could not update this request.' });
  }

  const statusChanged = next !== e.status;
  if(statusChanged && b.notify !== false){
    const fresh = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(e.id);
    mailer.safeSend(mailer.statusUpdate(fresh, items), fresh.customer_email);
  }
  res.json({ ok: true, status: next, allocated: !!allocated });
});

// GET /api/admin/inner-circle — private-invitation list
router.get('/inner-circle', (req, res) => {
  res.json({ subscribers: db.prepare('SELECT email, created_at FROM inner_circle ORDER BY created_at DESC').all() });
});

module.exports = router;
