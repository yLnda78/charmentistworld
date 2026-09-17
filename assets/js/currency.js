// CHARMENTIST — automatic currency display
// ---------------------------------------------------------------------
// Every price in products.js / the database is stored as a plain USD
// number (see the note in products.js and backend/README.md). This file
// converts that USD number into whatever currency fits the person looking
// at the page, using their IP address to guess their country — no action
// needed from them:
//   - Visitor in Indonesia  → IDR, at today's reference rate
//   - Visitor in France     → EUR, at today's reference rate
//   - Visitor anywhere else on the supported list → their own currency
//   - Unknown / lookup failed → USD (the original behavior), so a price
//     never breaks or shows something wrong
//
// This mirrors the exact currency system already used at checkout (see
// the CURRENCY / FX blocks in checkout.html) so a shopper sees the same
// currency from browsing through to the order summary. It is a DISPLAY
// layer only — it never changes the underlying USD numbers in
// products.js/the database, and never touches what actually gets
// charged at checkout (Midtrans settles in IDR — see backend/README.md).
//
// Every other page just needs this file loaded (see config.js — same
// idea) and then calls CharmData.formatPrice(usdAmount) as before;
// products.js has been updated to route through here automatically.

(function(){

  const CURRENCY_INFO = {
    AUD:{symbol:'A$'}, CAD:{symbol:'C$'}, DKK:{symbol:'kr'}, EUR:{symbol:'€'},
    HKD:{symbol:'HK$'}, IDR:{symbol:'Rp', decimals:0}, JPY:{symbol:'¥', decimals:0},
    NZD:{symbol:'NZ$'}, NOK:{symbol:'kr'}, QAR:{symbol:'QR'}, SAR:{symbol:'SR'},
    SGD:{symbol:'S$'}, KRW:{symbol:'₩', decimals:0}, SEK:{symbol:'kr'},
    CHF:{symbol:'CHF'}, AED:{symbol:'AED'}, GBP:{symbol:'£'}, USD:{symbol:'$'}
  };

  // IP-lookup country codes (ISO 3166-1 alpha-2) → currency. Same set of
  // currencies checkout.html already supports, so a visitor sees one
  // consistent currency everywhere on the site. Anything not listed here
  // (lookup unsupported country, or the lookup itself failing) quietly
  // falls back to USD rather than guessing.
  const COUNTRY_CURRENCIES = {
    AU:'AUD', CA:'CAD', DK:'DKK',
    FR:'EUR', DE:'EUR', IT:'EUR', NL:'EUR', ES:'EUR', PT:'EUR', IE:'EUR',
    BE:'EUR', AT:'EUR', FI:'EUR', GR:'EUR', LU:'EUR',
    HK:'HKD', ID:'IDR', JP:'JPY', NZ:'NZD', NO:'NOK', QA:'QAR', SA:'SAR',
    SG:'SGD', KR:'KRW', SE:'SEK', CH:'CHF', AE:'AED', GB:'GBP', US:'USD'
  };

  const GEO_CACHE_KEY = 'charm_geo_cache_v1';
  const GEO_TTL_MS = 24 * 60 * 60 * 1000; // re-check location once a day
  const FX_TTL_MS = 6 * 60 * 60 * 1000;   // refresh the rate every 6 hours

  const STATE = { currency:'USD', rate:1, ready:false };

  function readCache(){
    try{
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      if(!raw) return null;
      const data = JSON.parse(raw);
      if(!data || typeof data.currency !== 'string' || typeof data.rate !== 'number') return null;
      return data;
    }catch(e){ return null; }
  }

  function writeCache(data){
    try{ localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(data)); }catch(e){ /* private mode etc — fine to skip */ }
  }

  // Hydrate synchronously from any cached result BEFORE the first render
  // on the page, so a returning visitor never sees a flash of USD that
  // then jumps to their real currency a second later.
  (function hydrateFromCache(){
    const cached = readCache();
    if(cached && (Date.now() - cached.ts) < FX_TTL_MS){
      STATE.currency = cached.currency;
      STATE.rate = cached.rate;
    }
  })();

  function withTimeout(promise, ms){
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
  }

  async function detectCountryCode(){
    // Two providers, in case one is down/rate-limited — both are free,
    // no API key, and CORS-enabled for browser calls.
    try{
      const res = await withTimeout(fetch('https://ipapi.co/json/', { cache:'no-store' }), 4000);
      const data = await res.json();
      if(data && data.country_code) return String(data.country_code).toUpperCase();
    }catch(e){ /* fall through to the backup provider */ }

    try{
      const res = await withTimeout(fetch('https://ipwho.is/', { cache:'no-store' }), 4000);
      const data = await res.json();
      if(data && data.success !== false && data.country_code) return String(data.country_code).toUpperCase();
    }catch(e){ /* both failed — caller falls back to USD */ }

    return null;
  }

  async function fetchRate(currency){
    if(currency === 'USD') return 1;
    try{
      const res = await withTimeout(fetch(`https://api.frankfurter.dev/v2/rate/USD/${currency}`, { cache:'no-store' }), 4000);
      if(!res.ok) throw new Error('FX request failed');
      const data = await res.json();
      if(!data || typeof data.rate !== 'number') throw new Error('Invalid FX response');
      return data.rate;
    }catch(e){
      return null;
    }
  }

  async function init(){
    const cached = readCache();
    const geoFresh = cached && (Date.now() - cached.ts) < GEO_TTL_MS;
    const fxFresh = cached && (Date.now() - cached.ts) < FX_TTL_MS;

    if(cached && geoFresh && fxFresh){
      STATE.currency = cached.currency;
      STATE.rate = cached.rate;
      STATE.ready = true;
      document.dispatchEvent(new Event('charm:currency-ready'));
      return;
    }

    let currency = (cached && geoFresh) ? cached.currency : null;

    if(!currency){
      const country = await detectCountryCode();
      currency = (country && COUNTRY_CURRENCIES[country]) || 'USD';
    }

    const rate = await fetchRate(currency);

    if(typeof rate === 'number'){
      STATE.currency = currency;
      STATE.rate = rate;
      writeCache({ currency, rate, ts: Date.now() });
    }else if(cached){
      // Live rate failed this time — keep using the last good cached one
      // rather than dropping back to USD for no reason.
      STATE.currency = cached.currency;
      STATE.rate = cached.rate;
    } // else: stays USD/1, the safe default already set at hydration

    STATE.ready = true;
    document.dispatchEvent(new Event('charm:currency-ready'));
  }

  function format(usdAmount){
    const info = CURRENCY_INFO[STATE.currency] || CURRENCY_INFO.USD;
    const decimals = typeof info.decimals === 'number' ? info.decimals : 2;
    const converted = Number(usdAmount) * (STATE.currency === 'USD' ? 1 : STATE.rate);
    const formatted = converted.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return info.symbol + formatted;
  }

  // For the few pages that still have prices written straight into the
  // HTML (e.g. "$18,700") instead of rendered from products.js — call
  // this once the page's markup is in place, and again whenever
  // 'charm:currency-ready' fires. It remembers each element's original
  // USD value in data-usd the first time, so later calls always convert
  // from the true source amount instead of re-parsing an already-
  // converted string.
  function convertStaticPrices(selector){
    document.querySelectorAll(selector || '.price').forEach(el => {
      if(!el.dataset.usd){
        const digits = el.textContent.replace(/[^0-9.]/g, '');
        if(!digits) return;
        el.dataset.usd = digits;
      }
      el.textContent = format(Number(el.dataset.usd));
    });
  }

  window.CharmCurrency = {
    format,
    convertStaticPrices,
    isReady: () => STATE.ready,
    currentCurrency: () => STATE.currency
  };

  init();

})();
