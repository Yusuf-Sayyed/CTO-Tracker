import config from "./config.js";

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "DexScreener-CTO-Monitor/1.0",
};

/**
 * Fetch the latest community-takeover tokens from DexScreener.
 * Returns an array of CTO token objects.
 */
export async function fetchLatestCTOs() {
  const res = await fetch(config.dexscreener.ctoEndpoint, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`DexScreener CTO API responded ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error("Unexpected CTO API response format (expected array)");
  }

  return data;
}

/**
 * Fetch token pair data (price, market cap, liquidity) for a given token.
 * Returns the first pair object, or null if none found.
 */
export async function fetchTokenPairs(chainId, tokenAddress) {
  const url = `${config.dexscreener.pairsEndpoint}/${chainId}/${tokenAddress}`;

  try {
    const res = await fetch(url, { headers: HEADERS });

    if (!res.ok) {
      console.warn(`⚠️  Pairs API ${res.status} for ${chainId}/${tokenAddress}`);
      return { bestPair: null, allPairs: [] };
    }

    const data = await res.json();

    // The pairs endpoint returns either a plain array or { pairs: [...] }
    const pairs = Array.isArray(data) ? data : data?.pairs || [];

    if (pairs.length > 0) {
      const sorted = [...pairs].sort(
        (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
      );
      // Return both the best pair (for display) and all pairs (for bonding check)
      return { bestPair: sorted[0], allPairs: pairs };
    }

    return { bestPair: null, allPairs: [] };
  } catch (err) {
    console.warn(`⚠️  Failed to fetch pairs for ${chainId}/${tokenAddress}:`, err.message);
    return { bestPair: null, allPairs: [] };
  }
}

/**
 * Fetch orders and boosts data for a given token.
 * Used to check the number of active boosts.
 */
export async function fetchOrders(chainId, tokenAddress) {
  const url = `${config.dexscreener.ordersEndpoint}/${chainId}/${tokenAddress}`;

  try {
    const res = await fetch(url, { headers: HEADERS });

    if (!res.ok) {
      console.warn(`⚠️  Orders API ${res.status} for ${chainId}/${tokenAddress}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn(`⚠️  Failed to fetch orders for ${chainId}/${tokenAddress}:`, err.message);
    return null;
  }
}
