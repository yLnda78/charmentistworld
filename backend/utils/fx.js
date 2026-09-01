// Live USD -> IDR exchange rate, used when creating a Midtrans transaction
// (Midtrans only settles in IDR; the product database stores USD prices).
// Uses the same public source as the frontend's checkout page
// (api.frankfurter.dev — free, no API key, updated daily on ECB rates) so
// the number quoted to a shopper and the number charged by Midtrans agree.
//
// Cached in memory for CACHE_MS so a burst of checkouts doesn't hammer the
// external API on every single order. Falls back to the last known-good
// rate (or FALLBACK_RATE if we've never fetched successfully) if the
// external API is temporarily unreachable — an order should still be able
// to complete even if the FX provider has a bad moment.

const CACHE_MS = 10 * 60 * 1000; // 10 minutes
// Used only if the live API has never once succeeded since the server
// started. Update this occasionally so a first-ever cold-start failure
// doesn't wildly undercharge or overcharge a customer.
const FALLBACK_RATE = 16300;

let cachedRate = null;
let cachedAt = 0;

async function getUsdToIdrRate(){
  const now = Date.now();
  if(cachedRate && (now - cachedAt) < CACHE_MS){
    return cachedRate;
  }

  try{
    const res = await fetch('https://api.frankfurter.dev/v2/rate/USD/IDR');
    if(!res.ok) throw new Error('FX API returned ' + res.status);

    const data = await res.json();
    if(!data || typeof data.rate !== 'number' || data.rate <= 0){
      throw new Error('Invalid exchange-rate response.');
    }

    cachedRate = data.rate;
    cachedAt = now;
    return cachedRate;

  }catch(err){
    console.error('Could not fetch live USD->IDR rate, falling back:', err.message);
    // Serve the last good rate even if it's a bit stale, rather than the
    // hardcoded fallback, as long as we've fetched successfully before.
    if(cachedRate) return cachedRate;
    return FALLBACK_RATE;
  }
}

module.exports = { getUsdToIdrRate };
