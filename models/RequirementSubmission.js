const mongoose = require("mongoose");

/**
 * One person's uploaded proof for one requirement.
 *
 * Eligibility is COMPUTED, never stored as a flag:
 *   a person can offer/request a service only if every mandatory requirement
 *   (of the sub-service AND its parent) has an APPROVED submission from them.
 *
 * So when an admin adds a new mandatory requirement, everyone automatically
 * becomes ineligible until they submit it — no batch updates, no stale state.
 */
const requirementSubmissionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requirement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Requirement",
      required: true,
    },
    // Denormalised for fast lookups (which service this proof belongs to)
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },

    imageUrls: { type: [String], default: [] }, // up to requirement.maxPhotos

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One submission per person per requirement
requirementSubmissionSchema.index({ user: 1, requirement: 1 }, { unique: true });

module.exports = mongoose.model("RequirementSubmission", requirementSubmissionSchema);