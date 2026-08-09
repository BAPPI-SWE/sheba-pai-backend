const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Primary role (first of the accepted roles) — kept for compatibility
    role: {
      type: String,
      required: true,
    },
    // All helper roles that may fulfill this request (from the service mapping)
    acceptedRoles: {
      type: [String],
      default: [],
    },
    // The service the patient chose (Bangla display), e.g. "ওষুধ কিনতে চাই"
    serviceName: {
      type: String,
    },
    helper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Browse-and-choose: the specific helpers this request was sent to.
    // Empty = broadcast (old auto-dispatch). Non-empty = only these helpers see it.
    targetedHelpers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    // The specific sub-service requested (drives eligibility gating at accept).
    subService: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      default: null,
    },
    status: {
      type: String,
      enum: [
        "searching",
        "accepted",
        "on_the_way",
        "helping",
        "completed",
        "cancelled",
        "no_helper_found",
      ],
      default: "searching",
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
  },
  { timestamps: true }
);

// Geospatial index — required for $near queries on requestss
requestSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Request", requestSchema);