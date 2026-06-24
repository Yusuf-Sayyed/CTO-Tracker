import { hasCTOKeywords } from "./detector.js";

// ── Chain display names ─────────────────────────────────────────────
const CHAIN_NAMES = {
  solana: "Solana",
  ethereum: "Ethereum",
  base: "Base",
  bsc: "BSC",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  avalanche: "Avalanche",
  optimism: "Optimism",
};

// ── Link type emoji map ─────────────────────────────────────────────
const LINK_EMOJI = {
  website: "🌐",
  twitter: "🐦",
  telegram: "💬",
  discord: "🎮",
  reddit: "📣",
  tiktok: "🎵",
  instagram: "📸",
  medium: "📝",
};

/**
 * Format a number as a compact dollar string.
 * e.g. 1234567 → "$1.23M"
 */
export function formatUSD(value) {
  if (value == null || isNaN(value)) return "N/A";
  const num = Number(value);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.0001) return `$${num.toFixed(6)}`;
  return `$${num.toExponential(2)}`;
}

/**
 * Truncate a string to a max length, appending "…" if truncated.
 */
function truncate(str, maxLen = 200) {
  if (!str) return "";
  const cleaned = str.replace(/\n+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen) + "…";
}

/**
 * Format links from a CTO token into a readable list.
 */
function formatLinks(links = []) {
  if (links.length === 0) return "";

  const lines = links.map((link) => {
    const type = link.type || link.label?.toLowerCase() || "link";
    const emoji = LINK_EMOJI[type] || "🔗";
    const label = link.label || type.charAt(0).toUpperCase() + type.slice(1);
    return `  ${emoji} <a href="${escapeHtml(link.url)}">${escapeHtml(label)}</a>`;
  });

  return "\n🔗 <b>Links:</b>\n" + lines.join("\n");
}

/**
 * Escape HTML special characters for Telegram HTML parse mode.
 */
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format a single CTO token alert message.
 *
 * @param {Object} token — CTO token from DexScreener API
 * @param {Object|null} pairData — enrichment data from pairs API
 * @param {Object|null} ordersData — orders data for boosts
 * @returns {string} — HTML-formatted Telegram message
 */
export function formatCTOAlert(token, pairData = null, ordersData = null) {
  // 1. Banner Image (Zero-width space link trick for Telegram link preview)
  const imageUrl = token.header || token.icon || token.url;
  let msg = `<a href="${escapeHtml(imageUrl)}">&#8205;</a>`;

  // 2. Token Name & Symbol
  const tokenName = pairData?.baseToken?.name || token.name || "Unknown";
  const tokenSymbol = pairData?.baseToken?.symbol || token.symbol || "";
  msg += `<b>${escapeHtml(tokenName)}</b>  ($${escapeHtml(tokenSymbol)} )\n`;

  // 3. Contract Address
  msg += `<code>${escapeHtml(token.tokenAddress)}</code>\n\n`;

  // 4. Metrics
  const mcap = pairData?.marketCap ? formatUSD(pairData.marketCap) : "N/A";
  const lp = pairData?.liquidity?.usd ? formatUSD(pairData.liquidity.usd) : "N/A";
  const vol = pairData?.volume?.h24 ? formatUSD(pairData.volume.h24) : "N/A";

  msg += `💎 MC  —  ${mcap}\n`;
  msg += `💧 LP  —  ${lp}\n`;
  msg += `📊 Vol  —  ${vol}\n`;

  // 5. Age
  let ageStr = "Unknown";
  if (pairData?.pairCreatedAt) {
    const diffMs = Date.now() - pairData.pairCreatedAt;
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diffMs / 1000 / 60) % 60);
    if (d > 0) ageStr = `${d}d ${h}h`;
    else if (h > 0) ageStr = `${h}h ${m}m`;
    else ageStr = `${m}m`;
  } else if (token.claimDate) {
    const diffMs = Date.now() - new Date(token.claimDate).getTime();
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    ageStr = `${d}d ${h}h`;
  }
  msg += `🕐 Age  —  ${ageStr}\n`;

  // 6. Boosts — strictly read from pairData for live active boosts
  const boosts = pairData?.boosts?.active || 0;
  msg += `⚡ Boosts  —  ${boosts}\n\n`;

  // 7. Socials
  const socialIcons = [];
  if (token.links && token.links.length > 0) {
    token.links.forEach(link => {
      const t = (link.type || link.label || "").toLowerCase();
      const u = (link.url || "").toLowerCase();
      if (t.includes("twitter") || u.includes("twitter.com") || u.includes("x.com")) {
        socialIcons.push(`<a href="${escapeHtml(link.url)}">𝕏</a>`);
      } else if (t.includes("telegram") || u.includes("t.me")) {
        socialIcons.push(`<a href="${escapeHtml(link.url)}">✈️</a>`);
      } else {
        socialIcons.push(`<a href="${escapeHtml(link.url)}">🌐</a>`);
      }
    });
  }

  if (socialIcons.length > 0) {
    // deduplicate icons based on content
    const uniqueIcons = [...new Set(socialIcons)];
    msg += `🔗 Socials: ${uniqueIcons.join(" ")}\n`;
  } else {
    msg += `🔗 Socials: None\n`;
  }

  return msg;
}

/**
 * Format a status message for the /status command.
 */
export function formatStatusMessage(stats, uptime) {
  const uptimeStr = formatUptime(uptime);
  return (
    `📊 <b>CTO Monitor Status</b>\n\n` +
    `⏱️ Uptime: <b>${uptimeStr}</b>\n` +
    `👁️ Tokens tracked: <b>${stats.total}</b>\n` +
    `✅ Bot is running and monitoring`
  );
}

/**
 * Format uptime in seconds to a human-readable string.
 */
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Format a gain/loss percentage with emoji indicator.
 */
function formatGain(percent) {
  if (percent == null) return "N/A";
  const sign = percent >= 0 ? "+" : "";
  let emoji;
  if (percent >= 100) emoji = "🚀";
  else if (percent >= 50) emoji = "🔥";
  else if (percent >= 10) emoji = "📈";
  else if (percent >= 0) emoji = "↗️";
  else if (percent > -20) emoji = "📉";
  else if (percent > -50) emoji = "⬇️";
  else emoji = "💀";
  return `${emoji} ${sign}${percent.toFixed(1)}%`;
}

/**
 * Format time elapsed since a given ISO timestamp.
 */
function timeSince(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m ago`;
  return `${Math.floor(diff / 86400)}d ${Math.floor((diff % 86400) / 3600)}h ago`;
}

/**
 * Format a single token's periodic tracking update.
 * This is sent as a reply to the original alert message.
 *
 * @param {Object} token — tracked token update object
 * @returns {string} — HTML-formatted Telegram message
 */
export function formatTokenUpdate(token) {
  const symbol = escapeHtml(token.tokenSymbol);

  const initialMc = token.initial?.marketCap != null ? formatUSD(token.initial.marketCap) : "N/A";
  const currentMc = token.latest?.marketCap != null ? formatUSD(token.latest.marketCap) : "N/A";
  const elapsed = timeSince(token.alertedAt);

  // Fallback to "Update" if no milestone is provided, though we only call it on milestones now
  const milestoneText = token.milestone ? `is ${token.milestone}x up` : `Update`;

  return `$${symbol}  — ${milestoneText} \nMC: ${initialMc} → ${currentMc} | 🕰️ ${elapsed}`;
}

/**
 * Format a single token's tracking detail (for /track command).
 */
export function formatTokenDetail(token) {
  const name = escapeHtml(token.tokenName);
  const symbol = escapeHtml(token.tokenSymbol);
  const chain = CHAIN_NAMES[token.chainId] || token.chainId;

  let msg = `📌 <b>${name}</b> (<code>${symbol}</code>)\n`;
  msg += `⛓️ ${chain}\n\n`;

  msg += `<b>At Alert Time:</b>\n`;
  if (token.initial?.priceUsd != null) msg += `  💰 Price: ${formatUSD(token.initial.priceUsd)}\n`;
  if (token.initial?.marketCap != null) msg += `  📊 MCap: ${formatUSD(token.initial.marketCap)}\n`;
  if (token.initial?.liquidity != null) msg += `  💧 Liq: ${formatUSD(token.initial.liquidity)}\n`;

  if (token.latest) {
    msg += `\n<b>Current:</b>\n`;
    if (token.latest.priceUsd != null) {
      msg += `  💰 Price: ${formatUSD(token.latest.priceUsd)}`;
      if (token.gains?.priceChangePercent != null) msg += ` (${formatGain(token.gains.priceChangePercent)})`;
      msg += `\n`;
    }
    if (token.latest.marketCap != null) {
      msg += `  📊 MCap: ${formatUSD(token.latest.marketCap)}`;
      if (token.gains?.mcapChangePercent != null) msg += ` (${formatGain(token.gains.mcapChangePercent)})`;
      msg += `\n`;
    }
    if (token.latest.liquidity != null) msg += `  💧 Liq: ${formatUSD(token.latest.liquidity)}\n`;
  }

  msg += `\n⏰ Alerted: ${timeSince(token.alertedAt)}\n`;
  msg += `📋 CA: <code>${escapeHtml(token.tokenAddress)}</code>\n`;


  return msg;
}

