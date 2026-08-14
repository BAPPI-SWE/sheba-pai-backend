const mongoose = require("mongoose");

/**
 * Single-document global platform settings (singleton pattern).
 * All platform-wide tunable numbers live here so admin can adjust
 * operating rules without a code change.
 */
const platformSettingsSchema = new mongoose.Schema({
  key: { type: String, default: "global", unique: true },

  // Commission
  commissionGraceDays: { type: Number, default: 3, min: 1 },

  // How many jobs one caregiver may hold at the same time.
  maxConcurrentJobs: { type: Number, default: 3, min: 1, max: 20 },

  // How far out patients search for caregivers (km).
  searchRadiusKm: { type: Number, default: 20, min: 1, max: 100 },

  // How many caregivers a patient sees per page when browsing.
  browsePageSize: { type: Number, default: 10, min: 3, max: 50 },
});

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);