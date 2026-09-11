const mongoose = require("mongoose");

/**
 * A short-lived OTP record, one per phone number at a time (upserted on
 * every new send, not accumulated) — signup checks this collection for a
 * recent, successful verification before allowing an account to be
 * created. The OTP itself is hashed, same as passwords, not stored plain:
 * even though it's single-use and short-lived, hashing it costs nothing
 * and is the safer default.
 */
const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 }, // failed verify attempts against this code
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OtpVerification", otpSchema);