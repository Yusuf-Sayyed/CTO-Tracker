/**
 * CTO Quality Filters
 *
 * Filters to reduce noise and only alert on high-quality CTO tokens:
 * 1. PumpFun only — token address must end in "pump"
 * 2. Must be bonded — must have graduated to Raydium (has Raydium pairs)
 * 3. Age filter — claimDate must be within the last 2 days
 * 4. Socials required — must have at least one social link (twitter/telegram/website)
 * 5. Boost cap — exclude tokens with more than 100 total boosts
 */

// ── Filter: PumpFun only ────────────────────────────────────────────

/**
 * Check if a token is a PumpFun token (address ends with "pump").
 */
export function isPumpFunToken(tokenAddress) {
  return tokenAddress?.toLowerCase().endsWith("pump");
}

/**
 * Check if a PumpFun token is bonded by verifying it has graduated.
 * A bonded token has graduated from PumpFun's bonding curve.
 * PumpFun originally graduated to Raydium, but now graduates to PumpSwap.
 *
 * @param {Array} allPairs — full array of pairs from the pairs API
 * @returns {boolean}
 */
const BONDED_DEXES = ["raydium", "pumpswap"];

export function isBonded(allPairs) {
  if (!allPairs || allPairs.length === 0) return false;
  // Check if ANY pair is on a graduated DEX (Raydium or PumpSwap)
  return allPairs.some((pair) => {
    const dexId = (pair.dexId || "").toLowerCase();
    return BONDED_DEXES.some((bonded) => dexId.includes(bonded));
  });
}

// ── Filter: Token age ───────────────────────────────────────────────

const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in ms

/**
 * Check if a token's CTO claim is within the last 2 days.
 *
 * @param {string} claimDate — ISO date string from the CTO API
 * @returns {boolean} — true if within 2 days
 */
export function isWithinMaxAge(claimDate) {
  if (!claimDate) return false;
  const claimTime = new Date(claimDate).getTime();
  const age = Date.now() - claimTime;
  return age >= 0 && age <= MAX_AGE_MS;
}

/**
 * Check if the token pair itself was created within the last 2 days.
 *
 * @param {Object|null} pairData — pair data from pairs API
 * @returns {boolean} — true if within 2 days
 */
export function isTokenWithinMaxAge(pairData) {
  if (!pairData || !pairData.pairCreatedAt) return false;
  const age = Date.now() - pairData.pairCreatedAt;
  return age >= 0 && age <= MAX_AGE_MS;
}

// ── Filter: Socials required ────────────────────────────────────────

const SOCIAL_TYPES = ["twitter", "telegram", "discord"];
const SOCIAL_LABELS = ["website", "twitter", "telegram"];

/**
 * Check if a token has at least one meaningful social link.
 *
 * @param {Array} links — links array from the CTO API
 * @returns {boolean}
 */
export function hasSocials(links = []) {
  if (links.length === 0) return false;

  return links.some((link) => {
    const type = (link.type || "").toLowerCase();
    const label = (link.label || "").toLowerCase();
    // Must have at least one social: twitter, telegram, discord, or a website
    return (
      SOCIAL_TYPES.includes(type) ||
      SOCIAL_LABELS.includes(label) ||
      link.url?.includes("twitter.com") ||
      link.url?.includes("x.com") ||
      link.url?.includes("t.me")
    );
  });
}

// ── Filter: Boost cap ───────────────────────────────────────────────

const MAX_BOOSTS = 100;

/**
 * Get the total active boosts for a token.
 * Reads from pairData.boosts.active (primary) with fallback to ordersData.
 *
 * @param {Object|null} pairData — pair data from pairs API
 * @param {Object|null} ordersData — orders data from /orders/v1 endpoint
 * @returns {number}
 */
export function getTotalBoosts(pairData, ordersData) {
  // Primary: read from pair data (most accurate for live active boosts)
  const pairBoosts = pairData?.boosts?.active;
  if (pairBoosts != null && pairBoosts > 0) {
    return pairBoosts;
  }

  // Fallback: count approved orders from the /orders/v1 endpoint
  if (Array.isArray(ordersData)) {
    return ordersData.filter((o) => o.status === "approved").length;
  }

  return 0;
}

/**
 * Check if a token's total boost amount is within the allowed limit.
 * Tokens with excessive boosts (>100) are excluded.
 *
 * @param {Object|null} pairData — pair data from pairs API
 * @param {Object|null} ordersData — orders data from /orders/v1 endpoint
 * @returns {boolean} — true if within limit (OK to alert)
 */
export function isWithinBoostLimit(pairData, ordersData) {
  return getTotalBoosts(pairData, ordersData) <= MAX_BOOSTS;
}

// ── Run all filters ─────────────────────────────────────────────────

/**
 * Run all filters on a CTO token and return a result object.
 *
 * @param {Object} token — CTO token from DexScreener API
 * @param {Object|null} pairData — best pair data from pairs API (for display)
 * @param {Array} allPairs — all pairs from pairs API (for bonding check)
 * @param {Object|null} ordersData — orders data from orders API
 * @returns {{ passed: boolean, reasons: string[] }}
 */
export function applyFilters(token, pairData, allPairs, ordersData) {
  const reasons = [];

  // 1. PumpFun only
  if (!isPumpFunToken(token.tokenAddress)) {
    reasons.push("Not a PumpFun token");
  }

  // 2. Must be bonded (check ALL pairs for a Raydium dex)
  if (!isBonded(allPairs)) {
    reasons.push("Not bonded (no Raydium/PumpSwap pair)");
  }

  // 3a. Age filter (max 2 days for CTO claim)
  if (!isWithinMaxAge(token.claimDate)) {
    reasons.push("CTO claim older than 2 days");
  }

  // 3b. Age filter (max 2 days for token creation)
  if (!isTokenWithinMaxAge(pairData)) {
    reasons.push("Token is older than 2 days");
  }

  // 4. Socials required
  if (!hasSocials(token.links)) {
    reasons.push("No social links");
  }

  // 5. Boost cap
  if (!isWithinBoostLimit(pairData, ordersData)) {
    const total = getTotalBoosts(pairData, ordersData);
    reasons.push(`Boost too high: ${total}x (max ${MAX_BOOSTS})`);
  }

  // 6. Market cap ceiling (exclude coins over $80K)
  const mcap = pairData?.marketCap ?? null;
  if (mcap != null && mcap > 80000) {
    reasons.push(`MC too high: $${(mcap / 1000).toFixed(1)}K (max $80K)`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
