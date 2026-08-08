const mongoose = require("mongoose");

/**
 * One rating from one user about another, tied to a specific completed job.
 * Either direction:
 *   - patient rating the helper
 *   - helper rating the patient
 *
 * Individual ratings are stored (not just an average) so they can be
 * recomputed, moderated, and shown as recent reviews later.
 */
const ratingSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true },
    rater: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ratee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // who the ratee is, so we can filter helper-ratings vs patient-ratings
    rateeRole: { type: String, enum: ["helper", "patient"], required: true },

    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

// One rating per rater per job (can't rate the same job twice)
ratingSchema.index({ request: 1, rater: 1 }, { unique: true });
ratingSchema.index({ ratee: 1 });

module.exports = mongoose.model("Rating", ratingSchema);