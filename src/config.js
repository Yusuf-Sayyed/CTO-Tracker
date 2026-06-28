import "dotenv/config";

const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS, 10) || 30_000,
  trackIntervalMs: parseInt(process.env.TRACK_INTERVAL_MS, 10) || 5 * 60_000, // 5 min default
  dexscreener: {
    ctoEndpoint: "https://api.dexscreener.com/community-takeovers/latest/v1",
    pairsEndpoint: "https://api.dexscreener.com/token-pairs/v1",
    ordersEndpoint: "https://api.dexscreener.com/orders/v1",
  },
  dataDir: new URL("../data", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
};

// ── Validation ──────────────────────────────────────────────────────
const required = [
  ["TELEGRAM_BOT_TOKEN", config.telegram.botToken],
  ["TELEGRAM_CHAT_ID", config.telegram.chatId],
];

for (const [name, value] of required) {
  if (!value || value.includes("your_")) {
    console.error(`❌  Missing or placeholder value for ${name}. Set it in .env`);
    process.exit(1);
  }
}

export default config;
