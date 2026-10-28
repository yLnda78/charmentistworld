// CHARMENTIST — single place to point the site at the backend API.
// ---------------------------------------------------------------------
// Every page loads this BEFORE products.js / auth.js / store.js, so
// setting CHARM_API_BASE here is enough for the whole site — you do NOT
// need to edit any other .html or .js file.
//
// WHILE DEVELOPING ON YOUR OWN COMPUTER (backend running via
// `npm run dev` inside /backend, frontend opened straight from disk or
// via a local server like VS Code "Live Server"):
//   Leave this as-is. 'http://localhost:4000/api' is correct.
//
// ONCE YOU DEPLOY:
//   1. Deploy /backend somewhere that can run Node.js 18+ (Railway,
//      Render, a VPS, etc). That gives you a public URL, e.g.
//      https://charmentist-api.up.railway.app
//   2. Replace the URL below with that address + '/api', e.g.
//      window.CHARM_API_BASE = 'https://charmentist-api.up.railway.app/api';
//   3. Re-upload/redeploy the frontend files (this one included).
//
// If this still points at localhost after the site is deployed, EVERY
// network feature will fail silently for visitors — login, register,
// checkout, cart sync, order history, admin dashboard — because their
// browser will try to reach a server on their own computer, which
// doesn't exist. This is the single most common cause of "login
// doesn't work" once a Charmentist site goes live.
// ---------------------------------------------------------------------

window.CHARM_API_BASE = 'http://localhost:4000/api';
