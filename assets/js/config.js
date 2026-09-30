window.CHARM_API_BASE = 'https://charmentistworld-production.up.railway.app/api';

// ---------------------------------------------------------------------
// CHARMENTIST — single place for contact details used across the site
// (Concierge WhatsApp, email, Instagram/Pinterest/TikTok). Every page
// that shows one of these now reads it from here instead of having the
// number/address hard-coded in five different files — change it once,
// it updates everywhere (footer, contact page, appointment, checkout
// success screen, track-order).
//
// WhatsApp number must be in international format with NO leading "+"
// and no spaces/dashes.
// ---------------------------------------------------------------------
window.CHARM_CONTACT = {
  whatsapp: '6282379983844',
  email: 'concierge@charmentist.com',
  instagram: 'https://instagram.com/theworldofcharmentist',
  pinterest: 'https://pinterest.com/theworldofcharmentist',
  tiktok: 'https://tiktok.com/@theworldofcharmentist'
};
