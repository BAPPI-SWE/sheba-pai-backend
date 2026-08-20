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
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    contactPhone: { type: String, required: true },

    paymentMethod: { type: String, enum: ["cod"], default: "cod" }, // more methods later
    prescriptionUrl: { type: String, default: null }, // required if any item needs Rx

    status: {
      type: String,
      enum: ["pending", "confirmed", "out_for_delivery", "delivered", "cancelled"],
      default: "pending",
      index: true,
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