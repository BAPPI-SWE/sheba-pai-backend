const mongoose = require("mongoose");

/**
 * A generic drug (e.g. "Paracetamol", "Omeprazole").
 *
 * THIS IS THE SEO ENGINE. Every field here becomes indexable content on a
 * dedicated page. When someone searches "নাপা এর কাজ কি" or "omeprazole
 * side effects", this is what we rank with — and unlike a pure directory,
 * our page also carries the brands and a Buy button.
 *
 * Bangla fields exist alongside English deliberately: a large share of
 * Bangladeshi medicine searches are in Bangla, and almost nobody serves
 * that well.
 */
const genericSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    nameBangla: { type: String, default: null },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },

    drugClasses: [{ type: mongoose.Schema.Types.ObjectId, ref: "DrugClass" }],

    // --- Clinical content (the ranking material) ---
    indications: { type: String, default: null },          // what it's used for
    indicationsBangla: { type: String, default: null },
    pharmacology: { type: String, default: null },          // how it works
    pharmacologyBangla: { type: String, default: null },
    dosage: { type: String, default: null },
    dosageBangla: { type: String, default: null },
    administration: { type: String, default: null },
    interaction: { type: String, default: null },
    contraindications: { type: String, default: null },
    contraindicationsBangla: { type: String, default: null },
    sideEffects: { type: String, default: null },
    sideEffectsBangla: { type: String, default: null },
    pregnancyAndLactation: { type: String, default: null },
    precautions: { type: String, default: null },
    precautionsBangla: { type: String, default: null },
    overdoseEffects: { type: String, default: null },
    storageConditions: { type: String, default: null },

    // Plain-language summary for patients — our differentiator over
    // clinical directories written for doctors.
    simpleSummary: { type: String, default: null },
    simpleSummaryBangla: { type: String, default: null },

    // --- SEO metadata ---
    metaTitle: { type: String, default: null },
    metaDescription: { type: String, default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Full-text search across the names and the most-searched clinical fields.
genericSchema.index({
  name: "text",
  nameBangla: "text",
  indications: "text",
  indicationsBangla: "text",
});

module.exports = mongoose.model("Generic", genericSchema);