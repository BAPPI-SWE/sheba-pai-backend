const mongoose = require("mongoose");

const helperProfileSchema = new mongoose.Schema(
  {
    // Links back to the User document (the helper's identity)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one profile per user
    },

    // Which service roles this helper can fulfill, e.g. ["Nurse", "Attendant"]
    roles: {
      type: [String],
      required: true,
    },

    // Is the helper currently available to receive requests?
    isAvailable: {
      type: Boolean,
      default: false,
    },

    // Helper's live location in GeoJSON format.
    // IMPORTANT: coordinates are [longitude, latitude] — longitude FIRST.
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0], // [lng, lat]
      },
    },
  },
  { timestamps: true }
);

// This special index makes geospatial "find nearby" queries possible + fast.
helperProfileSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("HelperProfile", helperProfileSchema);