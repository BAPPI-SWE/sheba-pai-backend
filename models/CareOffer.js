const mongoose = require("mongoose");

/**
 * What families can book in one tap, with a transparent price:
 *
 *   kind "urgent"  — quick home-visit jobs (injection, wound dressing,
 *                    saline, catheter…). Shown on "জরুরি / তাৎক্ষণিক সেবা".
 *   kind "package" — monthly caregiver packages. Shown on "মাসিক প্যাকেজ",
 *                    each with a list of what is included.
 *
 * Tapping one sends the family's name + phone to the admin team, who call
 * back and assign a caregiver. Managed in Admin → Caregivers → Services & packages.
 */
const careOfferSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["urgent", "package"], required: true },
    name: { type: String, required: true, trim: true },
    nameBangla: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    descriptionBangla: { type: String, default: null },

    // Picture: assets/icons/care/<iconKey>.png in the app (see careIcons.js).
    iconKey: { type: String, default: "general" },

    price: { type: Number, default: null, min: 0 }, // null = "price on call"
    priceUnit: { type: String, enum: ["visit", "day", "shift12", "month"], default: "visit" },
    // Small print under the price, e.g. "ওষুধ আলাদা" / "Medicine not included".
    priceNote: { type: String, default: null },
    priceNoteBangla: { type: String, default: null },

    // Packages: what is included, one line each.
    features: { type: [String], default: [] },
    featuresBangla: { type: [String], default: [] },

    // Optional ribbon, e.g. "জনপ্রিয়" / "Popular".
    badge: { type: String, default: null },
    badgeBangla: { type: String, default: null },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

careOfferSchema.index({ kind: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("CareOffer", careOfferSchema);
