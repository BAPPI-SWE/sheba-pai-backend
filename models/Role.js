const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    // English name, also used as the identifier in services/helpers (e.g. "Nurse")
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    // Bangla display name (e.g. "নার্স")
    nameBangla: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Role", roleSchema);