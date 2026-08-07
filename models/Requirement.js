const mongoose = require("mongoose");

/**
 * A document/proof a service demands, editable in place.
 * Editing reflects everywhere because submissions reference it by id.
 */
const requirementSchema = new mongoose.Schema(
  {
    service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    forWhom: { type: String, enum: ["helper", "patient"], required: true },

    title: { type: String, required: true },
    titleBangla: { type: String, required: true },
    hint: { type: String, default: null },
    hintBangla: { type: String, default: null },

    isMandatory: { type: Boolean, default: true },
    maxPhotos: { type: Number, default: 3, min: 1, max: 3 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

requirementSchema.index({ service: 1, forWhom: 1 });

module.exports = mongoose.model("Requirement", requirementSchema);