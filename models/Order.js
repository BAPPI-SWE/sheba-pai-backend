const mongoose = require("mongoose");

/**
 * A medicine order. Line items snapshot the price/name at order time —
 * prices can change later, but a placed order must always show what the
 * customer actually agreed to pay.
 */
const orderItemSchema = new mongoose.Schema(
  {
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
    brandName: { type: String, required: true },
    strength: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
    prescriptionRequired: { type: Boolean, default: false },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], required: true, validate: (v) => v.length > 0 },

    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, required: true },

    // Delivery destination — same shape as caregiver requests, reusing
    // the location system already built (map pin / saved address / GPS).
    address: { type: String, default: null },
    // Same defensive fix as RiderProfile: no default on `type`, so an
    // Order created by some future path without coordinates yet stays
    // fully unset rather than becoming a half-formed, index-crashing
    // GeoJSON point. Today's checkout always supplies real coordinates
    // before save, but that shouldn't be the only thing standing between
    // this schema and the same crash.
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number] }, // [lng, lat]
    },
    contactPhone: { type: String, required: true },

    paymentMethod: { type: String, enum: ["cod"], default: "cod" }, // more methods later
    prescriptionUrl: { type: String, default: null }, // required if any item needs Rx

    // "confirmed" is used only in the central-courier path (admin manually
    // confirms before dispatch). "rider_assigned" / "picked_up" only exist
    // in the local-shop path. Both paths converge on "out_for_delivery"
    // and "delivered", so patient-facing tracking UI doesn't need to know
    // which path an order took to show a coherent progress view.
    status: {
      type: String,
      enum: ["pending", "confirmed", "rider_assigned", "picked_up", "out_for_delivery", "delivered", "cancelled"],
      default: "pending",
      index: true,
    },

    // --- Fulfillment routing (decided once, at checkout, never changed) ---
    fulfillmentType: { type: String, enum: ["local", "central"], default: "central" },
    isInsideDhaka: { type: Boolean, default: true },

    // --- Local-shop-and-rider fulfillment ---
    matchedShop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },
    assignedRider: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    pickupCode: { type: String, default: null }, // short code the shop verifies before releasing goods to the rider
    pickupVerifiedAt: { type: Date, default: null },
    riderEtaMinutes: { type: Number, default: null }, // set by the rider once en route
    deliveredAt: { type: Date, default: null },
    // Not 2dsphere-indexed today, but same defensive fix for consistency —
    // no default on `type` so an untouched riderLocation stays fully
    // unset instead of a half-formed GeoJSON point.
    riderLocation: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number] },
    },
    cancelReason: { type: String, default: null },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      },
    ],
  },
  { timestamps: true }
);

orderSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Order", orderSchema);