/**
 * Sends push notifications through Expo's push service.
 * No SDK needed — it's a simple HTTPS POST, which keeps our
 * dependencies light and avoids version drift.
 */
const User = require("./models/User");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Send a push to one or more userIds.
 * Silently skips users with no token. Never throws — a failed
 * notification must never break the request that triggered it.
 *
 * @param {Array|string} userIds
 * @param {{title: string, body: string, data?: object}} message
 */
async function sendPush(userIds, message) {
  try {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    if (ids.length === 0) return;

    const users = await User.find({
      _id: { $in: ids },
      pushToken: { $ne: null },
    }).select("pushToken");

    const messages = users
      .filter((u) => u.pushToken)
      .map((u) => ({
        to: u.pushToken,
        sound: "default",
        channelId: "jobs",
        priority: "high",
        title: message.title,
        body: message.body,
        data: message.data || {},
      }));

    if (messages.length === 0) return;

    // Expo accepts up to 100 messages per request
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
    }
  } catch (err) {
    console.error("Push send failed:", err.message);
  }
}

module.exports = { sendPush };