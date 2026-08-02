const mongoose = require("mongoose");

const helperProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    roles: { type: [String], required: true },
    isAvailable: { type: Boolean, default: false },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // --- VERIFICATION ---
    verificationStatus: {
      type: String,
      enum: ["unsubmitted", "pending", "approved", "rejected"],
      default: "unsubmitted",
    },

    // Cloudinary URLs
    nidFrontUrl: { type: String, default: null },
    nidBackUrl: { type: String, default: null },
    selfieUrls: { type: [String], default: [] },
    certificateUrls: { type: [String], default: [] },  // up to 10
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