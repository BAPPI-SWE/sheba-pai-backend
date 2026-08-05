const mongoose = require("mongoose");

/**
 * A service the platform offers.
 * Two levels only:
 *   - Main service:  parent = null
 *   - Sub-service:   parent = <main service id>
 *
 * Roles are set on the MAIN service. A helper who picks a profession (role)
 * only sees main services matching that role, and the sub-services under them.
 */
const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },        // English
    nameBangla: { type: String, required: true },  // Bangla

    // null = this is a main service; otherwise it's a sub-service
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      default: null,
    },

    // Which helper roles can perform this. Set on main services.
    helperRoles: { type: [String], default: [] },

    // Optional guidance for pricing (helpers set their own rate within these)
    suggestedMinRate: { type: Number, default: null },
    suggestedMaxRate: { type: Number, default: null },

    description: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

serviceSchema.index({ parent: 1 });

module.exports = mongoose.model("Service", serviceSchema);