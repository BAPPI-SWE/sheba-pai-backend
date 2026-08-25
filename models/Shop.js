const mongoose = require("mongoose");

/**
 * A partner pharmacy shop — the local fulfillment source for orders.
 * Tied to a User account (role: "shop") so the shop can log into its own
 * dashboard, manage stock, and confirm pickups.
 */
const shopSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    name: { type: String, required: true, trim: true },
    address: { type: String, required: true },
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined, required: true }, // [lng, lat]
    },
    contactPhone: { type: String, required: true },

    // Verification — same pattern as caregiver identity checks.
    verificationStatus: { type: String, enum: ["unsubmitted", "pending", "approved", "rejected"], default: "unsubmitted" },
    licenseUrl: { type: String, default: null }, // trade/pharmacy license photo
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    // Open for business toggle — an approved shop can still go offline
    // (closed for the day, out of couriers to hand off to, etc.)
    isOpen: { type: Boolean, default: false },

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    totalFulfilled: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shopSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Shop", shopSchema);