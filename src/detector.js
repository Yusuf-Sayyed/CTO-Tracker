import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import config from "./config.js";

const SEEN_FILE = join(config.dataDir, "seen_tokens.json");

// ── In-memory seen set ──────────────────────────────────────────────
let seenTokens = {};

/**
 * Build a unique key for a token.
 */
function tokenKey(chainId, tokenAddress) {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

/**
 * Load the seen tokens set from disk.
 */
export function loadSeenTokens() {
  try {
    if (existsSync(SEEN_FILE)) {
      const raw = readFileSync(SEEN_FILE, "utf-8");
      seenTokens = JSON.parse(raw);
      const count = Object.keys(seenTokens).length;
      console.log(`📂  Loaded ${count} previously seen tokens`);
    } else {
      seenTokens = {};
      console.log("📂  No previous data found — starting fresh");
    }
  } catch (err) {
    console.warn("⚠️  Error reading seen tokens, starting fresh:", err.message);
    seenTokens = {};
  }
}

/**
 * Persist the seen tokens set to disk.
 */
function saveSeenTokens() {
  try {
    const dir = config.dataDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(SEEN_FILE, JSON.stringify(seenTokens, null, 2), "utf-8");
  } catch (err) {
    console.error("❌  Failed to save seen tokens:", err.message);
  }
}

/**
 * CTO-related keywords to scan for in descriptions.
 */
const CTO_KEYWORDS = [
  "cto",
  "community takeover",
  "community-takeover",
  "community driven",
  "community-driven",
  "taken over",
  "dev rugged",
  "dev abandoned",
  "community led",
  "community-led",
];

/**
 * Check if a token's description contains CTO-related keywords.
 */
export function hasCTOKeywords(description = "") {
  const lower = description.toLowerCase();
  return CTO_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Given the latest CTO list from DexScreener, detect new tokens
 * that haven't been seen before.
 *
 * @param {Array} ctoList — raw array from the API
 * @returns {Array} — new tokens only
 */
export function detectNewCTOs(ctoList) {
  const newTokens = [];

  for (const token of ctoList) {
    const key = tokenKey(token.chainId, token.tokenAddress);

    if (!seenTokens[key]) {
      newTokens.push(token);
      // Mark as seen immediately
      seenTokens[key] = {
        firstSeen: new Date().toISOString(),
        claimDate: token.claimDate || null,
        hasCTOKeywords: hasCTOKeywords(token.description),
      };
    }
  }

  if (newTokens.length > 0) {
    saveSeenTokens();
  }

  return newTokens;
}

/**
 * Seed the seen set with current CTO tokens WITHOUT alerting.
 * Used on first boot so we only alert on genuinely new tokens going forward.
 */
export function seedSeenTokens(ctoList) {
  let seeded = 0;
  for (const token of ctoList) {
    const key = tokenKey(token.chainId, token.tokenAddress);
    if (!seenTokens[key]) {
      seenTokens[key] = {
        firstSeen: new Date().toISOString(),
        claimDate: token.claimDate || null,
        seeded: true,
      };
      seeded++;
    }
  }
  if (seeded > 0) {
    saveSeenTokens();
    console.log(`🌱  Seeded ${seeded} existing CTO tokens (no alerts sent)`);
  }
}

/**
 * Get stats about the seen tokens store.
 */
export function getStats() {
  const total = Object.keys(seenTokens).length;
  return { total };
}
