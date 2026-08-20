const mongoose = require("mongoose");

/**
 * Consumer-facing shopping category — "Baby & Mom", "Diabetic Care", etc.
 * Deliberately separate from DrugClass (the clinical/SEO taxonomy).
 * This is what a patient actually browses by; DrugClass stays a quiet
 * SEO layer on generic pages. Conflating the two is what makes some
 * competitor apps feel complicated.
 */
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    nameBangla: { type: String, default: null },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },

    // Ionicons name + a tone from the app's existing palette (primary/
    // accent/helper/warning/success) — matches the Home hub's icon-circle
    // system instead of a raster image, so it feels native to the app.
    icon: { type: String, default: "medkit" },
    tone: { type: String, enum: ["primary", "accent", "helper", "warning", "success"], default: "primary" },

    sortOrder: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false }, // shows in the compact home-screen row
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Category", categorySchema);