import config from "./config.js";
import { fetchLatestCTOs, fetchTokenPairs, fetchOrders } from "./dexscreener.js";
import { applyFilters, isPumpFunToken } from "./filters.js";
import { loadSeenTokens, detectNewCTOs, seedSeenTokens, getStats } from "./detector.js";
import { formatCTOAlert, formatStatusMessage, formatTokenDetail } from "./formatter.js";
import { initBot, getBot, sendAlert, sendAlertBatch } from "./notifier.js";
import { loadTrackedTokens, trackToken, refreshTrackedTokens, getTrackedTokens, getTrackedCount } from "./tracker.js";

// ── State ───────────────────────────────────────────────────────────
const startTime = Date.now();
let pollCount = 0;
let totalAlertsSent = 0;
let isFirstRun = true;
let pollTimer = null;
let trackTimer = null;



async function poll() {
  pollCount++;
  const label = `Poll #${pollCount}`;

  try {
    console.log(`\n🔄  ${label} — Fetching latest CTOs...`);
    const rawList = await fetchLatestCTOs();

    const ctoList = rawList.filter((t) => isPumpFunToken(t.tokenAddress));
    console.log(`   📋  Got ${rawList.length} tokens from DexScreener, ${ctoList.length} are PumpFun`);


    if (isFirstRun) {
      seedSeenTokens(ctoList);
      isFirstRun = false;
      console.log(`   ✅  Initial seed complete. Monitoring for new CTOs...`);
      return;
    }

    // Detect new tokens
    const newTokens = detectNewCTOs(ctoList);

    if (newTokens.length === 0) {
      console.log(`   ✅  No new CTOs detected`);
      return;
    }

    console.log(`   🚨  ${newTokens.length} NEW CTO(s) detected!`);

    // Enrich with pair data and format messages
    const messages = [];

    for (const token of newTokens) {
      // Fetch price/market data
      const { bestPair, allPairs } = await fetchTokenPairs(token.chainId, token.tokenAddress);

      // Fetch orders/boosts data
      const ordersData = await fetchOrders(token.chainId, token.tokenAddress);

      // Apply quality filters (allPairs is used for bonding check)
      const filterResult = applyFilters(token, bestPair, allPairs, ordersData);
      if (!filterResult.passed) {
        console.log(`   ⏭️  Skipped ${token.tokenAddress} — ${filterResult.reasons.join(", ")}`);
        continue;
      }

      // Small delay to respect rate limits
      await sleep(200);

      const msg = formatCTOAlert(token, bestPair, ordersData);
      messages.push({
        html: msg,
        onSent: (sentMsg) => {
          // Start tracking this token
          trackToken(token, bestPair, sentMsg.message_id);
        }
      });
    }

    // Send all alerts
    await sendAlertBatch(messages);
    totalAlertsSent += messages.length;

    console.log(`   📤  ${messages.length} alert(s) sent (total: ${totalAlertsSent})`);
  } catch (err) {
    console.error(`   ❌  ${label} failed:`, err.message);

    // If it's a network error, don't crash — just try again next cycle
    if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
      console.log(`   🔁  Will retry on next poll cycle`);
    }
  }
}

// Tracking update loop

async function trackingUpdate() {
  const trackedCount = getTrackedCount();
  if (trackedCount === 0) {
    console.log(`\n📈  Tracking update — No tokens to track yet`);
    return;
  }

  try {
    console.log(`\n📈  Tracking update — Refreshing ${trackedCount} token(s)...`);
    const updatedCount = await refreshTrackedTokens();
    console.log(`   ✅  Tracking update sent for ${updatedCount} token(s)`);
  } catch (err) {
    console.error(`   ❌  Tracking update failed:`, err.message);
  }
}

// Bot commands

function registerCommands() {
  const bot = getBot();

  // /start — Welcome message
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `🚀 <b>DexScreener CTO Monitor</b>\n\n` +
        `I monitor DexScreener for new Community Takeover (CTO) tokens and send real-time alerts.\n\n` +
        `<b>Commands:</b>\n` +
        `/status — Check bot status\n` +
        `/check — Force a poll right now\n` +
        `/tracked — View all tracked tokens\n` +
        `/update — Force a tracking update now\n` +
        `/chatid — Get this chat's ID\n\n` +
        `Alerts are sent to the configured chat ID: <code>${config.telegram.chatId}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // /status — Current bot status
  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const uptimeSeconds = (Date.now() - startTime) / 1000;
    const stats = getStats();
    const statusMsg = formatStatusMessage(stats, uptimeSeconds);
    const trackedCount = getTrackedCount();
    const extra =
      `\n\n🔄 Polls completed: <b>${pollCount}</b>\n` +
      `📤 Alerts sent: <b>${totalAlertsSent}</b>\n` +
      `📌 Tokens tracked: <b>${trackedCount}</b>\n` +
      `⏱️ Poll interval: <b>${config.pollIntervalMs / 1000}s</b>\n` +
      `📈 Track interval: <b>${config.trackIntervalMs / 1000}s</b>`;
    bot.sendMessage(chatId, statusMsg + extra, { parse_mode: "HTML" });
  });

  // /check — Force an immediate poll
  bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🔍 Running manual check...", { parse_mode: "HTML" });
    await poll();
    bot.sendMessage(chatId, "✅ Manual check complete.", { parse_mode: "HTML" });
  });

  // /tracked — Show all tracked tokens with current data
  bot.onText(/\/tracked/, async (msg) => {
    const chatId = msg.chat.id;
    const tracked = getTrackedTokens();
    const keys = Object.keys(tracked);

    if (keys.length === 0) {
      bot.sendMessage(chatId, "📌 No tokens being tracked yet. New CTO alerts will be automatically tracked.", {
        parse_mode: "HTML",
      });
      return;
    }

    // Send individual detail messages for each tracked token
    for (const key of keys) {
      const detail = formatTokenDetail(tracked[key]);
      await bot.sendMessage(chatId, detail, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      await sleep(300);
    }
  });

  // /update — Force an immediate tracking update
  bot.onText(/\/update/, async (msg) => {
    const chatId = msg.chat.id;
    const trackedCount = getTrackedCount();
    if (trackedCount === 0) {
      bot.sendMessage(chatId, "📌 No tokens being tracked yet.", { parse_mode: "HTML" });
      return;
    }
    bot.sendMessage(chatId, `📈 Refreshing ${trackedCount} tracked token(s)...`, { parse_mode: "HTML" });
    await trackingUpdate();
  });

  // /chatid — Utility to get chat ID
  bot.onText(/\/chatid/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Your chat ID is: <code>${chatId}</code>`, {
      parse_mode: "HTML",
    });
  });

  console.log("📝  Bot commands registered: /start, /status, /check, /tracked, /update, /chatid");
}

// ── Startup ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  🔍  DexScreener CTO Monitor");
  console.log("  📡  Poll interval:", config.pollIntervalMs / 1000, "seconds");
  console.log("  📈  Track interval:", config.trackIntervalMs / 1000, "seconds");
  console.log("  💬  Alert chat ID:", config.telegram.chatId);
  console.log("═══════════════════════════════════════════════\n");

  // Load persisted state
  loadSeenTokens();
  loadTrackedTokens();

  // Initialize Telegram bot
  const bot = await initBot();
  registerCommands();

  // Send startup notification
  const trackedCount = getTrackedCount();
  await sendAlert(
    `🟢 <b>CTO Monitor Started</b>\n\n` +
      `📡 Polling every ${config.pollIntervalMs / 1000}s\n` +
      `📈 Tracking updates every ${config.trackIntervalMs / 1000}s\n` +
      `👁️ ${getStats().total} known tokens | 📌 ${trackedCount} tracked\n` +
      `⏰ Started at ${new Date().toUTCString()}`
  );

  // Run first poll immediately
  await poll();

  // Start polling loop
  pollTimer = setInterval(poll, config.pollIntervalMs);
  console.log(`\n⏰  Poll loop started (every ${config.pollIntervalMs / 1000}s)`);

  // Start tracking update loop
  trackTimer = setInterval(trackingUpdate, config.trackIntervalMs);
  console.log(`📈  Track loop started (every ${config.trackIntervalMs / 1000}s)`);

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n🛑  Received ${signal}. Shutting down...`);

    if (pollTimer) clearInterval(pollTimer);
    if (trackTimer) clearInterval(trackTimer);

    try {
      await sendAlert(
        `🔴 <b>CTO Monitor Stopped</b>\n` +
          `📊 Total alerts sent: ${totalAlertsSent}\n` +
          `📌 Tokens tracked: ${getTrackedCount()}\n` +
          `⏱️ Uptime: ${Math.floor((Date.now() - startTime) / 1000)}s`
      );
    } catch {
      // Ignore errors during shutdown
    }

    await bot.stopPolling();
    console.log("👋  Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("💥  Fatal error:", err);
  process.exit(1);
});
