const mongoose = require("mongoose");

/**
 * A helper offering a specific SUB-SERVICE, with their own price.
 * Whether they're actually eligible is computed from their requirement
 * submissions — this record is the offer + pricing, not the approval.
 */
const helperServiceSchema = new mongoose.Schema(
  {
    helper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },

    chargeType: {
      type: String,
      enum: ["hourly", "fixed"],
      default: "hourly",
    },
    amount: { type: Number, required: true, min: 0 },

    // Helper's own words about their experience with this service
    experienceNote: { type: String, default: null },
    yearsExperience: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

helperServiceSchema.index({ helper: 1, service: 1 }, { unique: true });
helperServiceSchema.index({ service: 1 });

module.exports = mongoose.model("HelperService", helperServiceSchema);