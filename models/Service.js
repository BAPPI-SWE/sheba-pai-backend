const mongoose = require("mongoose");

/**
 * A service the platform offers. Two levels only:
 *   - Main service: parent = null
 *   - Sub-service:  parent = <main service id>
 *
 * Editing a service's fields reflects everywhere automatically, because
 * everything else references it by id (never copies its data).
 */
const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    nameBangla: { type: String, required: true },

    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      default: null,
    },

    // Roles set on MAIN services; sub-services inherit context from parent.
    helperRoles: { type: [String], default: [] },

    // ---- PRICING (sub-services) ----
    // How the charge is structured — admin's structural choice:
    chargeType: {
      type: String,
      enum: ["hourly", "fixed"],
      default: "hourly",
    },
    // Who controls the AMOUNT:
    //   "admin_fixed"      -> admin sets amount, helper cannot change
    //   "admin_default"    -> admin sets a starting amount, helper may edit
    //   "helper_flexible"  -> helper sets their own amount
    pricingMode: {
      type: String,
      enum: ["admin_fixed", "admin_default", "helper_flexible"],
      default: "helper_flexible",
    },
    // Amount used by admin_fixed / admin_default modes
    adminAmount: { type: Number, default: null },

    // Patient-side gating for sensitive services:
    //   "none"     -> no patient requirements (default; one-tap request)
    //   "submit"   -> patient must upload docs before requesting (approval can follow)
    //   "approved" -> patient must be fully approved before requesting
    patientVerificationMode: {
      type: String,
      enum: ["none", "submit", "approved"],
      default: "none",
    },

    description: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

serviceSchema.index({ parent: 1 });

module.exports = mongoose.model("Service", serviceSchema);