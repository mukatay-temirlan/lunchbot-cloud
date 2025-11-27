// lunch_bot.js
// Telegram Lunch Bot in pure Node.js (no external libraries)
// - Sends poll Mon–Fri at 08:00
// - Voting open until 10:30
// - No voting on Saturday or Sunday

const https = require("https");

// 1) Put your bot token here
const BOT_TOKEN = "8362935035:AAEk4BqHyr1yu3XN6qaXw_5zAXcdOcsXHEw";
const API_HOST = "api.telegram.org";
const API_BASE_PATH = `/bot${BOT_TOKEN}/`;

// 2) Put your group chat ID here (we'll fill this after /chatid)
const TARGET_CHAT_ID = -1003197836887;

// 3) Time window in UTC so that it matches 08:30–10:30 in Kazakhstan (UTC+5)
const OPEN_HOUR = 3;   // 03:30 UTC = 08:30 KZ
const OPEN_MINUTE = 30;
const CLOSE_HOUR = 5;  // 05:30 UTC = 10:30 KZ
const CLOSE_MINUTE = 30;


// Votes storage
const votes = {};
let updateOffset = 0;
let votingOpen = false;
let lastVotingDate = null; // YYYY-MM-DD

// Tiny HTTP server just for Render's port check
const http = require("http");

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Lunch bot is running\n");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });


function callTelegram(method, params) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(params || {}).toString();

    const options = {
      hostname: API_HOST,
      path: API_BASE_PATH + method,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (!json.ok) return reject(json);
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function getDisplayName(from) {
  if (!from) return "Unknown";
  const parts = [];
  if (from.first_name) parts.push(from.first_name);
  if (from.last_name) parts.push(from.last_name);
  if (parts.length > 0) return parts.join(" ");
  if (from.username) return "@" + from.username;
  return String(from.id);
}

function ensureChatVotes(chatId) {
  if (!votes[chatId]) {
    votes[chatId] = { yes: new Set(), no: new Set() };
  }
}

function buildKeyboard() {
  return JSON.stringify({
    inline_keyboard: [
      [
        { text: "🍽 Yes", callback_data: "yes" },
        { text: "🚫 No", callback_data: "no" },
      ],
    ],
  });
}

async function sendText(chatId, text, withKeyboard = false) {
  const params = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (withKeyboard) params.reply_markup = buildKeyboard();
  return callTelegram("sendMessage", params);
}

function buildSummaryText(chatId) {
  ensureChatVotes(chatId);
  const yesArr = [...votes[chatId].yes];
  const noArr = [...votes[chatId].no];
  return (
    `🍽 *Lunch votes*\n\n` +
    `✅ Going (${yesArr.length}): ${yesArr.length ? yesArr.join(", ") : "—"}\n` +
    `🚫 Not going (${noArr.length}): ${noArr.length ? noArr.join(", ") : "—"}`
  );
}

// ---------------- DAILY LOGIC ------------------

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isWeekend() {
  const day = new Date().getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

async function startDailyVoting() {
  if (isWeekend()) {
    console.log("Weekend - no lunch poll today.");
    return;
  }

  const today = todayKey();
  if (lastVotingDate === today) return;

  lastVotingDate = today;
  votingOpen = true;

  ensureChatVotes(TARGET_CHAT_ID);
  votes[TARGET_CHAT_ID].yes.clear();
  votes[TARGET_CHAT_ID].no.clear();

  console.log(`[${new Date().toString()}] Starting lunch poll`);
  await sendText(
    TARGET_CHAT_ID,
    "🍽 *Lunch check*\n\nWho is going to lunch today?\nTap a button below:",
    true
  );
}

function closeVoting() {
  if (!votingOpen) return;
  votingOpen = false;

  console.log(`[${new Date().toString()}] Voting closed`);
  const summary = buildSummaryText(TARGET_CHAT_ID);
  sendText(TARGET_CHAT_ID, "⏰ Voting is now closed.\n\n" + summary);
}

function getNextOpenTime() {
  const now = new Date();
  const openTime = new Date(now);
  openTime.setHours(OPEN_HOUR, OPEN_MINUTE, 0, 0);

  if (openTime <= now) openTime.setDate(openTime.getDate() + 1);
  return openTime;
}

function scheduleDailyVoting() {
  const nextOpen = getNextOpenTime();
  console.log("Next poll at:", nextOpen.toString());

  const msUntilOpen = nextOpen - new Date();

  setTimeout(async () => {
    await startDailyVoting();

    const now = new Date();
    const closeTime = new Date(now);
    closeTime.setHours(CLOSE_HOUR, CLOSE_MINUTE, 0, 0);
    let msUntilClose = closeTime - now;
    if (msUntilClose < 0) msUntilClose = 0;

    setTimeout(() => closeVoting(), msUntilClose);

    scheduleDailyVoting();
  }, msUntilOpen);
}

// ---------------- HANDLERS ------------------

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text === "/start") {
    await sendText(
      chatId,
      "Hi! I’m the lunch bot.\n" +
        "I ask lunch questions Mon–Fri between 08:30 and 10:30.\n" +
        "/summary – show today's votes\n" +
        "/chatid – show chat ID"
    );
  }

  if (text === "/chatid") {
    await sendText(chatId, "`" + chatId + "`");
  }

  if (text === "/summary") {
    await sendText(chatId, buildSummaryText(chatId));
  }
}

async function handleCallbackQuery(cb) {
  const chatId = cb.message.chat.id;

  if (!votingOpen) {
    await callTelegram("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "Voting is closed for today 🕒",
      show_alert: true,
    });
    return;
  }

  ensureChatVotes(chatId);
  const name = getDisplayName(cb.from);

  if (cb.data === "yes") {
    votes[chatId].yes.add(name);
    votes[chatId].no.delete(name);
  } else {
    votes[chatId].no.add(name);
    votes[chatId].yes.delete(name);
  }

  const newText = buildSummaryText(chatId);

  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: cb.message.message_id,
    text: newText,
    parse_mode: "Markdown",
    reply_markup: buildKeyboard(),
  });

  await callTelegram("answerCallbackQuery", {
    callback_query_id: cb.id,
  });
}

// ---------------- POLLING LOOP ------------------

async function pollUpdates() {
  try {
    const updates = await callTelegram("getUpdates", {
      timeout: 25,
      offset: updateOffset,
    });

    for (const update of updates) {
      updateOffset = update.update_id + 1;
      if (update.message) await handleMessage(update.message);
      if (update.callback_query) await handleCallbackQuery(update.callback_query);
    }
  } catch (e) {
    console.error("Polling error:", e);
  } finally {
    setImmediate(pollUpdates);
  }
}

// ---------------- START BOT ------------------

async function main() {
  console.log("Lunch bot starting…");
  console.log("Make sure webhook is disabled:");
  console.log(
    `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`
  );

  scheduleDailyVoting();
  pollUpdates();
}

main();

