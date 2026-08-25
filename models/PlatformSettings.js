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

  // --- Medicine delivery routing & fees ---
  // How far from the delivery address we look for a shop that can fully
  // cover an order, and how far from that shop we look for a rider.
  shopMatchRadiusKm: { type: Number, default: 5, min: 1, max: 50 },
  riderMatchRadiusKm: { type: Number, default: 5, min: 1, max: 50 },

  // Flat delivery fee when a local shop+rider fulfil the order — the same
  // fee everywhere, since a nearby rider costs the same regardless of city.
  localDeliveryFee: { type: Number, default: 80, min: 0 },
  // Courier fees only apply when NO local shop match exists at all —
  // decided instantly at checkout, never changed after the fact.
  courierFeeInsideDhaka: { type: Number, default: 80, min: 0 },
  courierFeeOutsideDhaka: { type: Number, default: 130, min: 0 },
  // What a rider is paid per completed delivery (platform keeps the
  // difference between this and what the customer paid as margin).
  riderPayoutPerDelivery: { type: Number, default: 50, min: 0 },

  // "Inside Dhaka" is computed from coordinates, never asked as a form —
  // any delivery point within this radius of the center counts as Dhaka.
  dhakaCenterLat: { type: Number, default: 23.7104 },
  dhakaCenterLng: { type: Number, default: 90.4074 },
  dhakaRadiusKm: { type: Number, default: 25, min: 1 },
});

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);