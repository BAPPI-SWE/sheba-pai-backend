const mongoose = require("mongoose");

/**
 * One doctor AT ONE CHAMBER. A doctor who sits at two chambers (common in
 * Bangladesh) is two documents — each shows up in its own district's
 * filter, and the detail screen links them together as "other chambers"
 * (matched by BMDC number, or by name + specialty when BMDC is missing).
 *
 * `slug` is unique and URL-safe on purpose: the future public website
 * will serve each of these as its own indexable page
 * (/doctors/<slug>), which is what ranks in Google.
 */
const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameBangla: { type: String, default: "" },
    slug: { type: String, required: true, unique: true, index: true },

    specialty: { type: mongoose.Schema.Types.ObjectId, ref: "Specialty", required: true, index: true },
    degrees: { type: String, default: "" },        // "MBBS, FCPS (Medicine)"
    designation: { type: String, default: "" },    // "Associate Professor"
    workplace: { type: String, default: "" },      // "Dhaka Medical College Hospital"
    gender: { type: String, enum: ["male", "female", ""], default: "" },
    photoUrl: { type: String, default: null },
    bmdcNumber: { type: String, default: "", index: true },

    // Chamber — canonical names only (resolved through bdGeo.js)
    chamberName: { type: String, default: "" },
    chamberAddress: { type: String, default: "" },
    division: { type: String, required: true, index: true },
    district: { type: String, required: true, index: true },
    area: { type: String, default: "" },           // "Dhanmondi", upazila, etc.

    phones: { type: [String], default: [] },       // serial / appointment numbers
    visitingDays: { type: String, default: "" },   // "Sat–Thu"
    visitingHours: { type: String, default: "" },  // "5 PM – 9 PM"

    // Fees. A returning patient within `followUpWithinDays` of their last
    // visit pays `followUpFee` instead of `newPatientFee`. Every field is
    // optional because not every doctor publishes fees.
    newPatientFee: { type: Number, default: null },
    followUpFee: { type: Number, default: null },
    followUpWithinDays: { type: Number, default: null },

    onlineConsultation: { type: Boolean, default: false },

    priority: { type: Number, default: 0 },        // higher = listed first
    isActive: { type: Boolean, default: true },
    reportCount: { type: Number, default: 0 },     // open "incorrect info" reports
  },
  { timestamps: true }
);

// The app's main query: active doctors of one specialty in one district.
doctorSchema.index({ specialty: 1, district: 1, isActive: 1, priority: -1 });

module.exports = mongoose.model("Doctor", doctorSchema);