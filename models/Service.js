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

    // Platform commission taken from the helper's earnings on this service.
    commissionPercent: { type: Number, default: 0, min: 0, max: 100 },

    // "instant"  -> normal flow: browse caregivers, see prices, request directly.
    // "quote"    -> no price is shown at all. The app shows a "Call for
    //               price" button that opens WhatsApp instead of a booking
    //               flow. The actual price/caregiver/commission for each
    //               case is then set manually by an admin after the
    //               conversation, via the manual-booking endpoint — this
    //               is deliberately for services too varied or negotiated
    //               to price upfront (long-term packages, complex cases).
    bookingMode: { type: String, enum: ["instant", "quote"], default: "instant" },

    description: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

serviceSchema.index({ parent: 1 });

module.exports = mongoose.model("Service", serviceSchema);