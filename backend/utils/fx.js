// Live USD -> <currency> exchange rates, used to convert the USD prices
// stored in the product database into whatever currency a checkout is
// billed in (Midtrans specifically also only ever settles in IDR).
// Uses api.frankfurter.dev — free, no API key, updated daily on ECB rates —
// the same public source the frontend's checkout page uses, so the number
// quoted to a shopper and the number actually charged/stored agree.
//
// Cached per currency in memory for CACHE_MS so a burst of checkouts
// doesn't hammer the external API on every single order. Falls back to
// the last known-good rate for that currency (or a hardcoded fallback if
// we've never fetched it successfully) if the external API is temporarily
// unreachable — an order should still be able to complete even if the FX
// provider has a bad moment.

const CACHE_MS = 10 * 60 * 1000; // 10 minutes

// Used only if the live API has never once succeeded for that currency
// since the server started. Update occasionally so a first-ever cold-start
// failure doesn't wildly undercharge or overcharge a customer. Rough
// mid-2026 ballpark figures — being slightly off for a few minutes on a
// cold start is far better than the un-converted (raw USD number) bug
// this replaces.
const FALLBACK_RATES = {
  USD: 1,
  IDR: 16300,
  AUD: 1.52,
  CAD: 1.38,
  DKK: 6.9,
  EUR: 0.92,
  HKD: 7.8,
  JPY: 150,
  NZD: 1.65,
  NOK: 10.6,
  QAR: 3.64,
  SAR: 3.75,
  SGD: 1.34,
  KRW: 1370,
  SEK: 10.3,
  CHF: 0.88,
  AED: 3.67,
  GBP: 0.78
};

const cache = {}; // { [currency]: { rate, cachedAt } }

async function getUsdToCurrencyRate(currency){
  const code = (currency || 'USD').toUpperCase();

  if(code === 'USD') return 1;

  const now = Date.now();
  const entry = cache[code];
  if(entry && (now - entry.cachedAt) < CACHE_MS){
    return entry.rate;
  }

  try{
    const res = await fetch(`https://api.frankfurter.dev/v2/rate/USD/${code}`);
    if(!res.ok) throw new Error('FX API returned ' + res.status);

    const data = await res.json();
    if(!data || typeof data.rate !== 'number' || data.rate <= 0){
      throw new Error('Invalid exchange-rate response.');
    }

    cache[code] = { rate: data.rate, cachedAt: now };
    return data.rate;

  }catch(err){
    console.error(`Could not fetch live USD->${code} rate, falling back:`, err.message);
    // Serve the last good rate even if it's a bit stale, rather than the
    // hardcoded fallback, as long as we've fetched successfully before.
    if(entry) return entry.rate;
    return FALLBACK_RATES[code] || 1;
  }
}

// Currencies with no minor unit in everyday practice — round to a whole
// number instead of two decimal places.
const ZERO_DECIMAL_CURRENCIES = new Set(['IDR', 'JPY', 'KRW']);

function roundForCurrency(amount, currency){
  const code = (currency || 'USD').toUpperCase();
  if(ZERO_DECIMAL_CURRENCIES.has(code)){
    return Math.round(amount);
  }
  return Math.round(amount * 100) / 100;
}

// Backwards-compatible name used elsewhere.
async function getUsdToIdrRate(){
  return getUsdToCurrencyRate('IDR');
}

module.exports = { getUsdToCurrencyRate, getUsdToIdrRate, roundForCurrency };
