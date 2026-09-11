/**
 * Phone OTP verification — required before an account can be created.
 * The actual SMS-sending call is isolated in one function
 * (sendOtpSms) so switching providers later (BulkSMSBD, SSL Wireless,
 * etc.) only ever means editing that one function — nothing about OTP
 * generation, expiry, hashing, or rate-limiting needs to change.
 *
 * DEV MODE: if SMS_API_KEY isn't set in the environment, the OTP is
 * logged to the server console instead of actually being sent — so the
 * whole flow can be tested end-to-end before signing up with any SMS
 * provider at all.
 *
 * Wire into index.js:
 *   const otpRoutes = require("./otpRoutes");
 *   otpRoutes(app, {});
 */
const bcrypt = require("bcryptjs");
const OtpVerification = require("./models/OtpVerification");

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends to the same phone
const MAX_VERIFY_ATTEMPTS = 5;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits, never starts with 0
}

/**
 * The one function to edit when you choose an SMS provider. Alpha SMS
 * (sms.net.bd) is used here as a concrete working default — a simple
 * GET/POST with an API key, common to most Bangladeshi providers.
 */
async function sendOtpSms(phone, otp) {
  const apiKey = process.env.SMS_API_KEY;
  const message = `আপনার সেবা পাই ভেরিফিকেশন কোড: ${otp}। ৫ মিনিটের জন্য কার্যকর। কারও সাথে শেয়ার করবেন না।`;

  if (!apiKey) {
    // No provider configured yet — safe to test with, unsafe to ship.
    console.warn(`⚠️  SMS_API_KEY not set. OTP for ${phone}: ${otp}  (visible only in server logs, not sent by SMS)`);
    return;
  }

  const url = new URL("https://api.sms.net.bd/sendsms");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("msg", message);
  url.searchParams.set("to", phone);
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SMS provider request failed: ${res.status} ${body}`);
  }
}

module.exports = function otpRoutes(app) {
  /** POST /api/auth/send-otp — body: { phone } */
  app.post("/api/auth/send-otp", async (req, res) => {
    try {
      const phone = (req.body.phone || "").trim();
      if (!phone) return res.status(400).json({ error: "Phone number is required" });

      const existing = await OtpVerification.findOne({ phone });
      if (existing && Date.now() - existing.updatedAt.getTime() < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.updatedAt.getTime())) / 1000);
        return res.status(429).json({ error: `Please wait ${waitSec}s before requesting another code` });
      }

      const otp = generateOtp();
      const otpHash = await bcrypt.hash(otp, 10);
      await OtpVerification.findOneAndUpdate(
        { phone },
        { otpHash, expiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0, verified: false, verifiedAt: null },
        { upsert: true }
      );

      await sendOtpSms(phone, otp);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/auth/verify-otp — body: { phone, otp } */
  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const phone = (req.body.phone || "").trim();
      const otp = (req.body.otp || "").trim();
      if (!phone || !otp) return res.status(400).json({ error: "Phone and code are required" });

      const record = await OtpVerification.findOne({ phone });
      if (!record) return res.status(400).json({ error: "Request a code first" });
      if (record.expiresAt < new Date()) return res.status(400).json({ error: "This code has expired — request a new one" });
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        return res.status(429).json({ error: "Too many incorrect attempts — request a new code" });
      }

      const matches = await bcrypt.compare(otp, record.otpHash);
      if (!matches) {
        record.attempts += 1;
        await record.save();
        return res.status(400).json({ error: "Incorrect code" });
      }

      record.verified = true;
      record.verifiedAt = new Date();
      await record.save();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};