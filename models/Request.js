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
        "no_show",
      ],
      default: "searching",
    },
    // Human-readable location, captured at request time.
    // "address" is precise (street-level) — only shown to the helper
    // AFTER they accept. "roughArea" is coarse (neighborhood/city) —
    // shown before accept, so a caregiver can judge the job without
    // seeing the patient's exact address until they commit.
    address: { type: String, default: null },
    roughArea: { type: String, default: null },

    // Cancellation / no-show accountability
    cancelledBy: { type: String, enum: ["patient", "helper", null], default: null },
    cancelReason: { type: String, default: null },
    noShowReportedBy: { type: String, enum: ["patient", "helper", null], default: null },
    noShowReason: { type: String, default: null },
    endedAt: { type: Date, default: null },

    // Earnings & commission tracking
    helpingStartedAt: { type: Date, default: null }, // when status -> "helping"
    finalAmount: { type: Number, default: null },     // computed at completion
    commissionAmount: { type: Number, default: null }, // platform's cut of finalAmount
    commissionPercentApplied: { type: Number, default: null },
    // "app"    -> created through the normal browse-and-choose flow.
    // "manual" -> created by an admin after a "call for price" conversation
    //             (WhatsApp/phone). Price and commission are set once, at
    //             creation, not recomputed at completion — see
    //             finalizeJobEarnings for why this matters.
    bookingSource: { type: String, enum: ["app", "manual"], default: "app" },

    location: {
      type: {
        type: String,
        enum: ["Point"],
      },
      coordinates: {
        type: [Number],
        default: undefined, // see RiderProfile.js for why this line matters
        // Not required: a manually-booked (WhatsApp/phone) request has no
        // app-based location share. Every app-created request still always
        // supplies real coordinates in code — this only relaxes the
        // schema-level constraint for the one path that genuinely can't.
      },
    },
  },
  { timestamps: true }
);

// Geospatial index — required for $near queries on requestss
requestSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Request", requestSchema);