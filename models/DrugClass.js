const mongoose = require("mongoose");

/**
 * Therapeutic / drug class (e.g. "Analgesics", "Proton Pump Inhibitors").
 * Exists as its own model because each class becomes an indexable browse
 * page on the website — a real SEO surface, not just a filter.
 */
const drugClassSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    nameBangla: { type: String, default: null },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    description: { type: String, default: null },
    descriptionBangla: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DrugClass", drugClassSchema);