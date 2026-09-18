const mongoose = require("mongoose");

/**
 * Promotional banners for the medicine store's home slider.
 *
 * `link` is deliberately a loose, optional descriptor rather than a hard
 * reference: a banner might point at a category, a specific medicine, or
 * nothing at all (a pure announcement). Storing the type + value keeps
 * that flexible without needing separate nullable refs for every
 * possible destination.
 */
const bannerSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true },
    title: { type: String, default: "" },        // optional — image may carry its own text
    titleBangla: { type: String, default: "" },

    // Where tapping it goes. "none" = not tappable, just a visual.
    linkType: { type: String, enum: ["none", "category", "medicine", "deals"], default: "none" },
    linkValue: { type: String, default: null },  // category slug, medicine slug, etc.

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },

    // Optional scheduling — a banner outside its window is simply not
    // served, so a seasonal campaign can be set up ahead of time and
    // expire on its own without anyone remembering to take it down.
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Banner", bannerSchema);