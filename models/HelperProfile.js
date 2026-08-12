const mongoose = require("mongoose");

const helperProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    roles: { type: [String], required: true },

    // NEW: single chosen profession (one of the admin-defined role names).
    // Drives which services this helper can offer.
    profession: { type: String, default: null },

    // Optional second contact number
    altPhone: { type: String, default: null },

    // Rating aggregate (recomputed on each new rating)
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    // Accountability counters (admin reviews patterns)
    cancelCount: { type: Number, default: 0 },
    noShowCount: { type: Number, default: 0 },

    // Commission / earnings tracking
    totalEarned: { type: Number, default: 0 },          // lifetime gross earnings
    commissionBalance: { type: Number, default: 0 },    // currently owed to platform
    oldestUnpaidDueDate: { type: Date, default: null },  // earliest unpaid commission's due date
    isRestricted: { type: Boolean, default: false },     // manually/derived: blocked from going online

    isAvailable: { type: Boolean, default: false },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // --- IDENTITY VERIFICATION (unchanged) ---
    verificationStatus: {
      type: String,
      enum: ["unsubmitted", "pending", "approved", "rejected"],
      default: "unsubmitted",
    },
    nidFrontUrl: { type: String, default: null },
    nidBackUrl: { type: String, default: null },
    selfieUrls: { type: [String], default: [] },
    certificateUrls: { type: [String], default: [] },
    policeClearanceUrl: { type: String, default: null },
    fullName: { type: String, default: null },
    nidNumber: { type: String, default: null },
    consentAccepted: { type: Boolean, default: false },
    consentAcceptedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

helperProfileSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("HelperProfile", helperProfileSchema);