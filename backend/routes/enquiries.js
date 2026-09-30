// Concierge / Assisted Checkout — public + client-facing endpoints.
//
//   POST /api/enquiries            create a Request (guest or signed-in)
//   POST /api/enquiries/track      look up a request by reference + email
//   GET  /api/enquiries            the signed-in client's own requests
//   POST /api/enquiries/inner-circle   private-invitation list sign-up
//
// No payment is taken here. Payment instructions are written by the
// Concierge in the admin dashboard and delivered to the client.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const mailer = require('../utils/enquiryMail');

const router = express.Router();

const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests from this connection. Please contact the Concierge directly.' } });
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

function generateReference(){
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  for(let i = 0; i < 8; i++){
    const ref = `CHM-${d}-${Math.floor(Math.random() * 9000 + 1000)}`;
    if(!db.prepare('SELECT 1 FROM enquiries WHERE reference = ?').get(ref)) return ref;
  }
  return `CHM-${d}-${Date.now().toString().slice(-6)}`;
}

// What a client may see — never internal admin notes.
function publicView(e){
  const showPayment = ['payment_instructed', 'paid', 'in_production', 'dispatched', 'delivered'].includes(e.status);
  return {
    reference: e.reference,
    status: e.status,
    items: JSON.parse(e.items_json),
    confirmedAmount: e.confirmed_amount || null,
    paymentInstruction: showPayment ? (e.payment_instruction || null) : null,
    paymentDue: showPayment ? (e.payment_due || null) : null,
    trackingInfo: ['dispatched', 'delivered'].includes(e.status) ? (e.tracking_info || null) : null,
    createdAt: e.created_at,
    updatedAt: e.updated_at
  };
}

router.post('/',
  createLimiter,
  optionalAuth,
  body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Please enter your name.'),
  body('email').trim().isEmail().withMessage('Please enter a valid email address.').isLength({ max: 200 }),
  body('phone').trim().matches(/^\+?[0-9 ()\-]{7,20}$/).withMessage('Please enter a valid phone / WhatsApp number.'),
  body('country').trim().isLength({ min: 2, max: 80 }).withMessage('Please select your country.'),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('preferredChannel').optional().isIn(['whatsapp', 'email']),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('items').isArray({ min: 1, max: 10 }).withMessage('Please select at least one piece.'),
  body('items.*.id').isString().isLength({ max: 100 }),
  body('items.*.qty').isInt({ min: 1, max: 5 }),
  body('items.*.size').optional({ values: 'falsy' }).isString().isLength({ max: 10 }),
  (req, res) => {
    // Honeypot: real people never fill this hidden field.
    if(req.body.website) return res.status(201).json({ ok: true, reference: 'CHM-000000-0000' });

    const errors = validationResult(req);
    if(!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, email, phone, country, city, notes } = req.body;
    const channel = req.body.preferredChannel === 'email' ? 'email' : 'whatsapp';

    // Build the item list from the DATABASE, never from browser-supplied prices.
    const items = [];
    let indicativeUsd = 0;
    for(const raw of req.body.items){
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(raw.id);
      if(!p) return res.status(400).json({ error: 'One of the selected pieces is no longer available. Please refresh your selection.' });
      if(p.stock <= 0){
        return res.status(409).json({ error: `${p.name} has completed its production allocation and is permanently retired.`, code: 'RETIRED' });
      }
      if(p.type === 'ring' && !raw.size){
        return res.status(400).json({ error: `Please choose a ring size for ${p.name}, or tell your Concierge you would like help with sizing.` });
      }
      items.push({ id: p.id, name: p.name, collection: p.collection, type: p.type, size: raw.size || null, qty: raw.qty, unitUsd: p.price });
      indicativeUsd += p.price * raw.qty;
    }

    const reference = generateReference();
    db.prepare(`
      INSERT INTO enquiries (reference, user_id, customer_name, customer_email, customer_phone, country, city,
                             preferred_channel, items_json, indicative_usd, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reference, req.user ? req.user.id : null, name, email.toLowerCase(), phone, country, city || null,
           channel, JSON.stringify(items), indicativeUsd, notes || null);

    const e = db.prepare('SELECT * FROM enquiries WHERE reference = ?').get(reference);
    mailer.safeSend(mailer.requestReceived(e, items), e.customer_email);
    if(process.env.ADMIN_EMAIL) mailer.safeSend(mailer.adminNotice(e, items), process.env.ADMIN_EMAIL);

    res.status(201).json({ ok: true, reference, status: e.status });
  }
);

router.post('/track', lookupLimiter,
  body('reference').trim().isLength({ min: 6, max: 40 }),
  body('email').trim().isEmail(),
  (req, res) => {
    const errors = validationResult(req);
    if(!errors.isEmpty()) return res.status(400).json({ error: 'Please enter your reference and the email you used.' });
    const e = db.prepare('SELECT * FROM enquiries WHERE reference = ? AND customer_email = ?')
      .get(req.body.reference.toUpperCase(), req.body.email.toLowerCase());
    // Same message whether the reference or the email is wrong — don't leak which exists.
    if(!e) return res.status(404).json({ error: 'We could not find a request matching those details.' });
    res.json({ enquiry: publicView(e) });
  }
);

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM enquiries WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ enquiries: rows.map(publicView) });
});

router.post('/inner-circle', lookupLimiter,
  body('email').trim().isEmail().isLength({ max: 200 }),
  (req, res) => {
    const errors = validationResult(req);
    if(!errors.isEmpty()) return res.status(400).json({ error: 'Please enter a valid email address.' });
    db.prepare('INSERT OR IGNORE INTO inner_circle (email) VALUES (?)').run(req.body.email.toLowerCase());
    res.status(201).json({ ok: true });
  }
);

module.exports = router;
