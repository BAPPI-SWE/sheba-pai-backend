const mongoose = require("mongoose");

/**
 * A medical specialty — "Neurology", "Cardiology". Doctors belong to
 * exactly one specialty; diseases map onto specialties through
 * `keywords` (migraine → Neurology), so a patient searching a symptom
 * still lands in the right place without a doctor being listed twice.
 */
const specialtySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },   // "Neurology"
    nameBangla: { type: String, default: "" },                          // "নিউরোলজি"
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },

    // Plain-language subtitle so non-medical users understand the tile:
    // "Headache, stroke, seizures" / "মাথাব্যথা, স্ট্রোক, খিঁচুনি"
    description: { type: String, default: "" },
    descriptionBangla: { type: String, default: "" },

    // Symptom / disease words that should find this specialty in search.
    keywords: { type: [String], default: [] },

    // Same icon system as medicine categories: Ionicons + palette tone,
    // with an optional uploaded image that takes priority when present.
    icon: { type: String, default: "medkit" },
    tone: { type: String, enum: ["primary", "accent", "helper", "warning", "success"], default: "helper" },
    imageUrl: { type: String, default: null },

    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Specialty", specialtySchema);