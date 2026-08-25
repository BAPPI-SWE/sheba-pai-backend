const mongoose = require("mongoose");

/**
 * How much of ONE medicine ONE shop currently has. The platform's central
 * Medicine.stock is untouched by this — shops have their own separate pool.
 * Product identity (name, generic, price) always comes from Medicine;
 * this record is purely "does this shop have it, and how much."
 */
const shopStockSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true, index: true },
    stock: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

shopStockSchema.index({ shop: 1, medicine: 1 }, { unique: true });

module.exports = mongoose.model("ShopStock", shopStockSchema);