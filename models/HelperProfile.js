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

    // --- CARE DIRECTORY PROFILE (directory / "manual" booking mode) ---
    // What families see when they browse caregivers. Filled in by the
    // caregiver in the app (Care profile), editable by the admin team.
    // A caregiver is listed when identity is approved, this profile is
    // complete (gender, >=1 district, >=1 care type, >=1 shift) and the
    // admin has not hidden them.
    care: {
      // Public caregiver ID families can quote on the phone, e.g. "SP1024".
      // Assigned the first time the care profile is saved.
      code: { type: String },
      gender: { type: String, enum: ["female", "male", null], default: null },
      // attendant = caregiver / attendant, trained = has a caregiving
      // certificate, nurse = registered nurse (diploma / BSc, BNMC).
      tier: { type: String, enum: ["attendant", "trained", "nurse"], default: "attendant" },
      bnmcNumber: { type: String, default: null },
      yearsExperience: { type: Number, default: 0, min: 0, max: 60 },
      bio: { type: String, default: null, maxlength: 600 },
      photoUrl: { type: String, default: null }, // public profile photo (NOT the verification selfie)
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "CareCategory" }],
      // Canonical district names from bdGeo.js — the districts they will work in.
      districts: { type: [String], default: [] },
      shifts: { type: [String], enum: ["day8", "day12", "night12", "live24"], default: [] },
      // Their usual rates in taka (optional; the final price is agreed by phone).
      rates: {
        day8: { type: Number, default: null, min: 0 },
        day12: { type: Number, default: null, min: 0 },
        night12: { type: Number, default: null, min: 0 },
        live24: { type: Number, default: null, min: 0 },
        month: { type: Number, default: null, min: 0 },
      },
      available: { type: Boolean, default: true }, // "taking new work right now"
      adminHidden: { type: Boolean, default: false },
      featured: { type: Boolean, default: false },
      completedBookings: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
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
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

helperProfileSchema.index({ location: "2dsphere" });
helperProfileSchema.index({ "care.districts": 1 });
helperProfileSchema.index({ "care.categories": 1 });
helperProfileSchema.index({ "care.code": 1 }, { unique: true, partialFilterExpression: { "care.code": { $type: "string" } } });

module.exports = mongoose.model("HelperProfile", helperProfileSchema);