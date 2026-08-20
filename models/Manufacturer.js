const mongoose = require("mongoose");

/**
 * Pharmaceutical company (Square, Beximco, Incepta...).
 * Each gets its own browsable, indexable page listing their brands.
 */
const manufacturerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    nameBangla: { type: String, default: null },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    logoUrl: { type: String, default: null },
    description: { type: String, default: null },
    established: { type: String, default: null },
    headquarters: { type: String, default: null },
    website: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Manufacturer", manufacturerSchema);