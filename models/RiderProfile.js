const mongoose = require("mongoose");

/**
 * A delivery rider — deliberately lightweight compared to HelperProfile.
 * A rider needs identity verification and nothing else: no profession
 * catalog, no per-service documents. That asymmetry is the whole reason
 * this is a separate model rather than reusing the caregiver system.
 */
const riderProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    fullName: { type: String, default: null },
    nidNumber: { type: String, default: null },
    nidFrontUrl: { type: String, default: null },
    nidBackUrl: { type: String, default: null },
    selfieUrl: { type: String, default: null },
    vehicleType: { type: String, enum: ["bicycle", "motorcycle", "on_foot"], default: "motorcycle" },
    vehiclePlateNumber: { type: String, default: null },

    verificationStatus: { type: String, enum: ["unsubmitted", "pending", "approved", "rejected"], default: "unsubmitted" },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    isAvailable: { type: Boolean, default: false },
    // No default on `type` — a rider has no location at all when their
    // profile is first created (that only comes later, when they go
    // online). If `type` defaulted to "Point", Mongoose would create a
    // half-formed { type: "Point" } with no coordinates — invalid GeoJSON
    // that crashes the 2dsphere index.
    //
    // `default: undefined` on `coordinates` is NOT optional decoration —
    // Mongoose auto-defaults ALL array-type fields to [] unless told
    // otherwise. Without this, an untouched location becomes
    // { coordinates: [] } instead of fully absent — still invalid
    // GeoJSON, just a different broken shape. Removing this line was
    // exactly what caused the second crash after the first fix.
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined },
    },

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    totalDeliveries: { type: Number, default: 0 },

    // Payout — the platform pays the rider (opposite direction from
    // caregiver commission, where the helper owes the platform).
    totalEarned: { type: Number, default: 0 },
    pendingPayout: { type: Number, default: 0 },
  },
  { timestamps: true }
);

riderProfileSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("RiderProfile", riderProfileSchema);