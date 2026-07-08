const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    helper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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

// Geospatial index — REQUIRED for $near queries on requests
// (this is what was missing, causing the "unable to find index" error)
requestSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Request", requestSchema);