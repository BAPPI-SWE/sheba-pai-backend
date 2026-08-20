const mongoose = require("mongoose");

/**
 * A branded medicine — the thing we actually sell (e.g. "Napa 500mg" by
 * Beximco, whose generic is Paracetamol).
 *
 * Carries both the commerce fields (price, stock, Rx status) and its own
 * indexable identity. A search for "Napa 500" should land here; the page
 * then pulls the full clinical content from the linked Generic.
 */
const medicineSchema = new mongoose.Schema(
  {
    brandName: { type: String, required: true, trim: true, index: true },
    brandNameBangla: { type: String, default: null },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },

    generic: { type: mongoose.Schema.Types.ObjectId, ref: "Generic", required: true, index: true },
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", index: true }],
    manufacturer: { type: mongoose.Schema.Types.ObjectId, ref: "Manufacturer", required: true, index: true },

    strength: { type: String, default: null },        // "500 mg"
    dosageForm: { type: String, default: null },       // Tablet, Syrup, Capsule, Injection
    dosageFormBangla: { type: String, default: null },

    // --- Pricing ---
    // In Bangladesh most medicine has a government-set MRP printed on the
    // pack. We store it so any discount we offer is provably real, and so
    // we can never accidentally sell above MRP.
    mrp: { type: Number, required: true, min: 0 },     // printed price for one sell-unit
    price: { type: Number, required: true, min: 0 },   // our selling price
    sellUnit: {
      type: String,
      enum: ["piece", "strip", "bottle", "box", "tube", "pack"],
      default: "strip",
    },
    unitsPerSellUnit: { type: Number, default: 1 },     // e.g. 10 tablets per strip
    packSizeLabel: { type: String, default: null },     // "10 x 10", "100 ml"

    // --- Regulatory ---
    prescriptionRequired: { type: Boolean, default: false, index: true },
    isControlled: { type: Boolean, default: false },    // extra-restricted drugs

    // --- Inventory (we hold our own stock) ---
    sku: { type: String, default: null, index: true },
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    isAvailable: { type: Boolean, default: true },
    isDiscontinued: { type: Boolean, default: false },

    images: [{ type: String }],

    // --- Merchandising / ranking ---
    searchKeywords: [{ type: String }],   // common misspellings, Bangla spellings
    salesCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },

    // --- SEO ---
    metaTitle: { type: String, default: null },
    metaDescription: { type: String, default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Weighted text search — a brand-name match should always beat a keyword match.
medicineSchema.index(
  { brandName: "text", brandNameBangla: "text", searchKeywords: "text" },
  { weights: { brandName: 10, brandNameBangla: 10, searchKeywords: 3 }, name: "medicine_search" }
);

// True if we can actually fulfil an order right now.
medicineSchema.virtual("inStock").get(function () {
  return this.isActive && this.isAvailable && !this.isDiscontinued && this.stock > 0;
});
medicineSchema.set("toJSON", { virtuals: true });
medicineSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Medicine", medicineSchema);