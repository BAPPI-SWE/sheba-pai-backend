const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["patient", "helper", "admin"],
      default: "patient",
    },
    language: { type: String, default: "bn" },

    // Rating aggregate (recomputed on each new rating this user receives).
    // Used so patients can be rated by helpers too.
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    // Accountability counters (admin reviews patterns)
    cancelCount: { type: Number, default: 0 },
    noShowCount: { type: Number, default: 0 },

    // Expo push token for this user's device (null when logged out)
    pushToken: { type: String, default: null },

    // Saved addresses (patient convenience: Home, Hospital, etc.)
    savedAddresses: [
      {
        label: { type: String, required: true },      // "Home", "Hospital"...
        address: { type: String, default: "" },        // human-readable text
        longitude: { type: Number, default: null },
        latitude: { type: Number, default: null },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);