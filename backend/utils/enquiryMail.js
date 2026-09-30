// Emails sent during the Concierge / Assisted Checkout flow.
// Every message is written in the Maison's voice and never contains
// bank details unless the Concierge typed them into the admin panel
// (payment_instruction) — nothing about payment is ever auto-generated.
const { sendMail } = require('./mail');

const BRAND = 'CHARMENTIST';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function shell(title, bodyHtml){
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:32px 24px;line-height:1.7;">
    <div style="letter-spacing:.32em;font-size:14px;margin-bottom:28px;">${BRAND}</div>
    <h2 style="font-weight:400;font-size:20px;margin:0 0 18px;">${esc(title)}</h2>
    ${bodyHtml}
    <p style="margin-top:32px;font-size:13px;color:#666;">Private Concierge · ${BRAND}<br>Reply to this email or contact us on WhatsApp — a person will answer.</p>
  </div>`;
}

function itemsList(items){
  return '<ul style="padding-left:18px;margin:12px 0;">' + items.map(i =>
    `<li>${esc(i.name)}${i.size ? ' — ring size ' + esc(i.size) : ''}${i.qty > 1 ? ' × ' + i.qty : ''}</li>`
  ).join('') + '</ul>';
}

function requestReceived(e, items){
  return {
    subject: `Your CHARMENTIST request ${e.reference}`,
    html: shell('We have received your request', `
      <p>Dear ${esc(e.customer_name)},</p>
      <p>Thank you. Your request <strong>${esc(e.reference)}</strong> has reached our Private Concierge:</p>
      ${itemsList(items)}
      <p>A Concierge will contact you personally to confirm the details of your order, availability, final pricing and payment method.
      <strong>No payment is requested or required at this stage.</strong></p>
      <p>Please note: CHARMENTIST will only ever send payment instructions in writing from this address or from our official WhatsApp Concierge, and only after your order has been confirmed with you.</p>`)
  };
}

function adminNotice(e, items){
  return {
    subject: `New concierge request ${e.reference} — ${e.customer_name}`,
    html: `<p><strong>${esc(e.reference)}</strong> from ${esc(e.customer_name)} (${esc(e.customer_email)}, ${esc(e.customer_phone || 'no phone')}), ${esc(e.city || '')} ${esc(e.country || '')}.<br>
      Preferred channel: ${esc(e.preferred_channel)}.</p>${itemsList(items)}
      <p>Indicative total (USD): ${e.indicative_usd}</p><p>${esc(e.notes || '')}</p>`
  };
}

function statusUpdate(e, items){
  const name = esc(e.customer_name);
  switch(e.status){
    case 'confirmed':
      return { subject: `Order details confirmed — ${e.reference}`, html: shell('Your order details are confirmed', `
        <p>Dear ${name},</p><p>Your Concierge has confirmed the following pieces${e.confirmed_amount ? ' at <strong>' + esc(e.confirmed_amount) + '</strong>' : ''}:</p>
        ${itemsList(items)}<p>Payment instructions will follow in a separate message.</p>`) };
    case 'payment_instructed':
      return { subject: `Payment instructions — ${e.reference}`, html: shell('Your payment instructions', `
        <p>Dear ${name},</p><p>Thank you for confirming your order <strong>${esc(e.reference)}</strong>.</p>
        ${e.confirmed_amount ? `<p>Confirmed amount: <strong>${esc(e.confirmed_amount)}</strong></p>` : ''}
        <div style="border:1px solid #ddd;padding:14px 16px;white-space:pre-wrap;">${esc(e.payment_instruction || 'Your Concierge will share payment instructions with you directly.')}</div>
        ${e.payment_due ? `<p>Please complete payment by: <strong>${esc(e.payment_due)}</strong></p>` : ''}
        <p>If anything in these instructions differs from what your Concierge told you, please contact us before paying.</p>`) };
    case 'paid':
      return { subject: `Payment received — ${e.reference}`, html: shell('Payment received', `
        <p>Dear ${name},</p><p>We have received your payment for <strong>${esc(e.reference)}</strong>. Your order now enters production.</p>`) };
    case 'in_production':
      return { subject: `In production — ${e.reference}`, html: shell('Your piece is in production', `
        <p>Dear ${name},</p><p>Your order <strong>${esc(e.reference)}</strong> is now in production. We will write to you again once it has passed final inspection and is ready to be dispatched.</p>`) };
    case 'dispatched':
      return { subject: `Dispatched — ${e.reference}`, html: shell('Your order has been dispatched', `
        <p>Dear ${name},</p><p>Your order <strong>${esc(e.reference)}</strong> has left the atelier.</p>
        ${e.tracking_info ? `<div style="border:1px solid #ddd;padding:14px 16px;white-space:pre-wrap;">${esc(e.tracking_info)}</div>` : ''}`) };
    case 'delivered':
      return { subject: `Delivered — ${e.reference}`, html: shell('Delivered', `
        <p>Dear ${name},</p><p>Our records show that order <strong>${esc(e.reference)}</strong> has been delivered. We hope it brings you many years of pleasure. Your Concierge remains available for care, resizing and any question.</p>`) };
    case 'cancelled':
      return { subject: `Request ${e.reference} closed`, html: shell('Your request has been closed', `
        <p>Dear ${name},</p><p>Request <strong>${esc(e.reference)}</strong> has been closed. If this is unexpected, please reply to this message.</p>`) };
    default:
      return null;
  }
}

async function safeSend(msg, to){
  if(!msg || !to) return;
  try{ await sendMail({ to, subject: msg.subject, html: msg.html }); }
  catch(err){ console.error('Enquiry email failed:', err.message); }
}

module.exports = { requestReceived, adminNotice, statusUpdate, safeSend };
