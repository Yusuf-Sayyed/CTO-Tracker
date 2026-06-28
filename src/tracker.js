import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import config from "./config.js";
import { fetchTokenPairs } from "./dexscreener.js";
import { sendReply } from "./notifier.js";
import { formatUSD, formatTokenUpdate, formatDownsideAlert } from "./formatter.js";

const TRACKED_FILE = join(config.dataDir, "tracked_tokens.json");

// ── In-memory tracked tokens ────────────────────────────────────────
// Key: "chainId:tokenAddress" → { initial data at alert time + token metadata }
let trackedTokens = {};

/**
 * Load tracked tokens from disk.
 */
export function loadTrackedTokens() {
  try {
    if (existsSync(TRACKED_FILE)) {
      const raw = readFileSync(TRACKED_FILE, "utf-8");
      trackedTokens = JSON.parse(raw);
      const count = Object.keys(trackedTokens).length;
      console.log(`📈  Loaded ${count} tracked CTO tokens`);
    } else {
      trackedTokens = {};
    }
  } catch (err) {
    console.warn("⚠️  Error reading tracked tokens:", err.message);
    trackedTokens = {};
  }
}

/**
 * Save tracked tokens to disk.
 */
function saveTrackedTokens() {
  try {
    const dir = config.dataDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(TRACKED_FILE, JSON.stringify(trackedTokens, null, 2), "utf-8");
  } catch (err) {
    console.error("❌  Failed to save tracked tokens:", err.message);
  }
}

/**
 * Build a unique key for a token.
 */
function tokenKey(chainId, tokenAddress) {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

/**
 * Add a new token to the tracker with its initial snapshot.
 *
 * @param {Object} token — CTO token from DexScreener API
 * @param {Object|null} pairData — initial pair data at alert time
 * @param {number} messageId — ID of the original Telegram message
 */
export function trackToken(token, pairData, messageId) {
  const key = tokenKey(token.chainId, token.tokenAddress);

  trackedTokens[key] = {
    chainId: token.chainId,
    tokenAddress: token.tokenAddress,
    url: token.url,
    alertedAt: new Date().toISOString(),
    tokenName: pairData?.baseToken?.name || "Unknown",
    tokenSymbol: pairData?.baseToken?.symbol || "???",
    messageId,
    lastMilestone: 1,
    // Downside alert tracking
    peakMultiple: 1,           // highest MC multiple ever reached
    downsideAlerted: false,    // true after a -30% downside alert has been sent
    immuneToDownside: false,   // true if token ever reached 3x (winner, no downside alerts)
    // Initial snapshot at alert time
    initial: {
      priceUsd: pairData?.priceUsd ? parseFloat(pairData.priceUsd) : null,
      marketCap: pairData?.marketCap ?? null,
      fdv: pairData?.fdv ?? null,
      liquidity: pairData?.liquidity?.usd ?? null,
    },
    // Latest snapshot (updated on each tracking cycle)
    latest: null,
    // Track update count
    updateCount: 0,
  };

  saveTrackedTokens();
  console.log(`📌  Now tracking: ${trackedTokens[key].tokenName} (${token.chainId})`);
}

/**
 * Fetch current data for all tracked tokens, compute gains,
 * and send individual reply updates to each token's original alert message.
 * Returns the number of tokens successfully updated.
 */
export async function refreshTrackedTokens() {
  const keys = Object.keys(trackedTokens);
  if (keys.length === 0) return 0;

  let updatedCount = 0;

  for (const key of keys) {
    const entry = trackedTokens[key];

    try {
      const { bestPair } = await fetchTokenPairs(entry.chainId, entry.tokenAddress);

      // Small delay to respect rate limits
      await sleep(250);

      if (!bestPair) continue;

      const currentPrice = bestPair.priceUsd ? parseFloat(bestPair.priceUsd) : null;
      const currentMcap = bestPair.marketCap ?? null;
      const currentFdv = bestPair.fdv ?? null;
      const currentLiq = bestPair.liquidity?.usd ?? null;

      // Compute gains
      const priceChange = computeChange(entry.initial.priceUsd, currentPrice);
      const mcapChange = computeChange(entry.initial.marketCap, currentMcap);

      // Update latest snapshot
      entry.latest = {
        priceUsd: currentPrice,
        marketCap: currentMcap,
        fdv: currentFdv,
        liquidity: currentLiq,
        priceChange1h: bestPair.priceChange?.h1 ?? null,
        priceChange24h: bestPair.priceChange?.h24 ?? null,
        updatedAt: new Date().toISOString(),
      };

      entry.gains = {
        priceChangePercent: priceChange,
        mcapChangePercent: mcapChange,
      };

      entry.updateCount++;

      // Check milestones (2x, 3x, 4x, 5x alerts)
      if (entry.messageId && currentMcap != null && entry.initial.marketCap > 0) {
        const multiple = currentMcap / entry.initial.marketCap;
        const hitMilestone = Math.floor(multiple);

        // ── Update peak multiple (highest ever seen) ────────────────
        const currentPeak = entry.peakMultiple || 1;
        if (multiple > currentPeak) {
          entry.peakMultiple = multiple;
        }

        // ── 3x immunity: if peak ever reached 3x, no more downside alerts
        if ((entry.peakMultiple || 1) >= 3) {
          entry.immuneToDownside = true;
        }

        // ── Milestone alerts (upside) ───────────────────────────────
        if (hitMilestone >= 2 && hitMilestone > (entry.lastMilestone || 1)) {
          entry.lastMilestone = hitMilestone;
          
          const updateMsg = formatTokenUpdate({ ...entry, key, milestone: hitMilestone });
          await sendReply(entry.messageId, updateMsg);
          await sleep(350); // Respect Telegram rate limits between replies
          
          updatedCount++;
          
          if (hitMilestone >= 5) {
            console.log(`🎉 ${entry.tokenName} reached 5x! Stopping tracking.`);
            untrackToken(entry.chainId, entry.tokenAddress);
            continue; // Skip saving updates below, as the token is now untracked
          }
        }

        // ── Downside alert (-30% from call price) ───────────────────
        // Rules:
        //   1. If token ever hit 3x → immune, never alert downside
        //   2. Only ONE downside alert per token, ever
        //   3. Alert when MC drops to ≤70% of initial MC (-30%)
        //   4. After downside alert, re-arm milestones for recovery pumps
        if (
          !entry.immuneToDownside &&
          !entry.downsideAlerted &&
          entry.initial.marketCap > 0
        ) {
          const dropPercent = ((entry.initial.marketCap - currentMcap) / entry.initial.marketCap) * 100;

          // Alert only if drop is between 30% and 40%. 
          if (dropPercent >= 30 && dropPercent <= 40) {
            console.log(`⚠️  ${entry.tokenName} dropped -${dropPercent.toFixed(1)}% from call — sending downside alert`);

            const downsideMsg = formatDownsideAlert(entry, currentMcap, dropPercent);
            await sendReply(entry.messageId, downsideMsg);
            await sleep(350);

            entry.downsideAlerted = true;
            // Re-arm milestones so recovery pumps (2x, 3x, etc.) will alert again
            entry.lastMilestone = 0;

            updatedCount++;
          } else if (dropPercent > 40) {
            // It dropped more than 40% (e.g. instantly rugged 80%).
            // Permanently untrack it so we stop checking its price and save memory/time.
            console.log(`🗑️  ${entry.tokenName} dropped >40% — untracking permanently.`);
            untrackToken(entry.chainId, entry.tokenAddress);
            continue; // Skip saving updates below, as the token is now untracked
          }
        }
      }

      updatedCount++;
    } catch (err) {
      console.warn(`⚠️  Failed to refresh ${entry.tokenName}:`, err.message);
    }
  }

  if (updatedCount > 0) {
    saveTrackedTokens();
  }

  return updatedCount;
}

/**
 * Compute percentage change from initial to current value.
 */
function computeChange(initial, current) {
  if (initial == null || current == null || initial === 0) return null;
  return ((current - initial) / initial) * 100;
}

/**
 * Remove a token from tracking (e.g. if it's been rugged or too old).
 */
export function untrackToken(chainId, tokenAddress) {
  const key = tokenKey(chainId, tokenAddress);
  if (trackedTokens[key]) {
    const name = trackedTokens[key].tokenName;
    delete trackedTokens[key];
    saveTrackedTokens();
    console.log(`🗑️  Untracked: ${name}`);
    return true;
  }
  return false;
}

/**
 * Get all currently tracked tokens.
 */
export function getTrackedTokens() {
  return { ...trackedTokens };
}

/**
 * Get count of tracked tokens.
 */
export function getTrackedCount() {
  return Object.keys(trackedTokens).length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimeElapsed(isoStr) {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const m = Math.floor((diffMs / 1000 / 60) % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
