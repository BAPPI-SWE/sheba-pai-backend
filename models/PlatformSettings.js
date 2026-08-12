const mongoose = require("mongoose");

/**
 * Single-document global platform settings (singleton pattern).
 * Currently: commission payment grace period.
 */
const platformSettingsSchema = new mongoose.Schema({
  key: { type: String, default: "global", unique: true },
  commissionGraceDays: { type: Number, default: 3, min: 1 },
});

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);