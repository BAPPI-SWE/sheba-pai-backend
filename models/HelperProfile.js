const mongoose = require("mongoose");

const helperProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    roles: {
      type: [String],
      required: true,
    },
    isAvailable: {
      type: Boolean,
      default: false,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },

    // --- VERIFICATION ---

    // Gate: unsubmitted -> pending -> approved / rejected.
    // Only "approved" helpers can go online or be matched to patients.
    verificationStatus: {
      type: String,
      enum: ["unsubmitted", "pending", "approved", "rejected"],
      default: "unsubmitted",
    },

    // Cloudinary URLs (strings)
    nidImageUrl: { type: String, default: null },       // government ID photo
    certificateUrl: { type: String, default: null },    // optional credential
    selfieUrls: { type: [String], default: [] },        // multi-angle live selfies

    // Info submitted with documents
    fullName: { type: String, default: null },
    nidNumber: { type: String, default: null },

    // Admin review fields
    rejectionReason: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

helperProfileSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("HelperProfile", helperProfileSchema);