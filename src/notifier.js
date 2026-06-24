import TelegramBot from "node-telegram-bot-api";
import config from "./config.js";

let bot = null;


export async function initBot() {

  bot = new TelegramBot(config.telegram.botToken, { polling: false });


  try {
    const me = await bot.getMe();
    console.log(`🤖  Telegram bot initialized: @${me.username} (${me.first_name})`);
  } catch (err) {
    if (err.code === "EFATAL" || err.message?.includes("AggregateError") || err.message?.includes("ENOTFOUND") || err.message?.includes("ETIMEDOUT")) {
      console.error("❌  Cannot connect to Telegram API (api.telegram.org)!");
      console.error("   This is a NETWORK issue, not a token issue.");
      console.error("   Possible causes:");
      console.error("     • Telegram API is blocked by your ISP/country");
      console.error("     • Firewall or antivirus is blocking the connection");
      console.error("     • No internet connection");
      console.error("   Fix: Try using a VPN or proxy.");
    } else {
      console.error("❌  Invalid Telegram bot token! Check your TELEGRAM_BOT_TOKEN in .env");
    }
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // Validate chat ID by trying to send a test action
  try {
    await bot.sendChatAction(config.telegram.chatId, "typing");
  } catch (err) {
    console.error(`❌  Cannot reach chat ID ${config.telegram.chatId}!`);
    console.error(`   Make sure the bot is added to the chat/group and the TELEGRAM_CHAT_ID is correct.`);
    console.error(`   Tip: Send /chatid to the bot in a DM to find your user chat ID.`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // Now enable polling for receiving commands
  bot.startPolling();

  // Handle polling errors gracefully (suppress noisy logs)
  bot.on("polling_error", (err) => {
    // Only log once per unique error, not every retry
    if (err.code === "EFATAL") {
      console.warn("⚠️  Telegram polling error (will retry automatically):", err.message);
    }
  });

  return bot;
}

/**
 * Get the bot instance (must call initBot first).
 */
export function getBot() {
  return bot;
}

/**
 * Send an HTML message to the configured chat.
 * Handles errors gracefully and respects Telegram rate limits.
 *
 * @param {string} html — HTML-formatted message
 * @returns {Promise<Object|null>} — Sent message object if successful, else null
 */
export async function sendAlert(html) {
  if (!bot) {
    console.error("❌  Bot not initialized");
    return null;
  }

  try {
    const sentMsg = await bot.sendMessage(config.telegram.chatId, html, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });
    return sentMsg;
  } catch (err) {
    // Handle Telegram rate limiting (429)
    if (err.response?.statusCode === 429) {
      const retryAfter = err.response?.body?.parameters?.retry_after || 5;
      console.warn(`⏳  Rate limited by Telegram. Retrying in ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      try {
        const sentMsg = await bot.sendMessage(config.telegram.chatId, html, {
          parse_mode: "HTML",
          disable_web_page_preview: false,
        });
        return sentMsg;
      } catch (retryErr) {
        console.error("❌  Failed to send alert after retry:", retryErr.message);
        return null;
      }
    }

    console.error("❌  Failed to send Telegram alert:", err.message);
    return null;
  }
}

/**
 * Send an HTML reply to a specific message ID.
 *
 * @param {number} messageId — The ID of the original message to reply to
 * @param {string} html — HTML-formatted message
 * @returns {Promise<Object|null>} — Sent message object if successful, else null
 */
export async function sendReply(messageId, html) {
  if (!bot) {
    console.error("❌  Bot not initialized");
    return null;
  }

  try {
    const sentMsg = await bot.sendMessage(config.telegram.chatId, html, {
      parse_mode: "HTML",
      disable_web_page_preview: false,
      reply_to_message_id: messageId,
    });
    return sentMsg;
  } catch (err) {
    // Handle Telegram rate limiting (429)
    if (err.response?.statusCode === 429) {
      const retryAfter = err.response?.body?.parameters?.retry_after || 5;
      console.warn(`⏳  Rate limited by Telegram. Retrying in ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      try {
        const sentMsg = await bot.sendMessage(config.telegram.chatId, html, {
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_to_message_id: messageId,
        });
        return sentMsg;
      } catch (retryErr) {
        console.error("❌  Failed to send reply after retry:", retryErr.message);
        return null;
      }
    }

    console.error("❌  Failed to send Telegram reply:", err.message);
    return null;
  }
}

/**
 * Send multiple alerts with a small delay between them
 * to avoid hitting Telegram rate limits.
 *
 * @param {Array<{html: string, onSent: Function}>} messages — array of message requests
 */
export async function sendAlertBatch(messages) {
  let sent = 0;
  for (const msgReq of messages) {
    const sentMsg = await sendAlert(msgReq.html);
    if (sentMsg) {
      sent++;
      if (msgReq.onSent) {
        msgReq.onSent(sentMsg);
      }
    }

    if (messages.length > 1) {
      await sleep(350);
    }
  }
  console.log(`📤  Sent ${sent}/${messages.length} alerts`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
