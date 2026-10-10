const mongoose = require("mongoose");

/**
 * A type of care patients can look for — organized by the PATIENT'S
 * CONDITION ("stroke & paralysis", "newborn & mother"), because that is
 * how families think about it, rather than by job title.
 *
 * Caregivers tick the categories they can handle on their care profile;
 * patients filter caregivers by them. Managed in Admin → Caregivers → Care types.
 */
const careCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameBangla: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },

    // Picks the picture in the app: assets/icons/care/<iconKey>.png
    // (see careIcons.js in the app). Unknown keys fall back to "general".
    iconKey: { type: String, default: "general" },

    description: { type: String, default: null },
    descriptionBangla: { type: String, default: null },

    // Transparent "from" price shown to families, e.g. "from ৳900 / 12-hour shift".
    // Leave empty to show no price for this type.
    fromPrice: { type: Number, default: null, min: 0 },
    priceUnit: { type: String, enum: ["day8", "shift12", "live24", "month", "visit"], default: "shift12" },

    // The lowest caregiver level allowed to offer this type. Clinical work
    // (catheter, NG tube, injections) should be "nurse" only.
    minTier: { type: String, enum: ["attendant", "trained", "nurse"], default: "attendant" },

    // Extra search words (English or Bangla) — e.g. "paralysis, প্যারালাইসিস".
    keywords: { type: [String], default: [] },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CareCategory", careCategorySchema);
