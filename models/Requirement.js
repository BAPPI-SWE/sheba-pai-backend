const mongoose = require("mongoose");

/**
 * A document/proof a service demands.
 *
 * forWhom:
 *   "helper"  -> the caregiver must provide it to offer this service
 *   "patient" -> the patient must provide it to request this service
 *
 * Attached to a MAIN service  = common requirement for everything under it.
 * Attached to a SUB-service   = specific requirement for that sub-service.
 */
const requirementSchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },

    forWhom: {
      type: String,
      enum: ["helper", "patient"],
      required: true,
    },

    title: { type: String, required: true },        // e.g. "Nursing certificate"
    titleBangla: { type: String, required: true },  // e.g. "নার্সিং সনদ"

    // Shown as guidance while uploading
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