/**
 * Promotional banners for the medicine store home slider.
 *
 * Wire into index.js:
 *   const bannerRoutes = require("./bannerRoutes");
 *   bannerRoutes(app, { auth, adminOnly, upload, uploadToCloudinary });
 */
const Banner = require("./models/Banner");

module.exports = function bannerRoutes(app, deps) {
  const { auth, adminOnly, upload, uploadToCloudinary } = deps;

  /**
   * GET /api/banners — active banners for the app, respecting any
   * scheduling window. Public: no auth, since these are shown on the
   * store's front page.
   */
  app.get("/api/banners", async (req, res) => {
    try {
      const now = new Date();
      const banners = await Banner.find({
        isActive: true,
        // A null start/end means "no bound on that side" — a banner with
        // neither is simply always live while active.
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        ],
      }).sort({ sortOrder: 1, createdAt: -1 });
      res.json(banners);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/admin/banners — all banners, including inactive/expired. */
  app.get("/api/admin/banners", auth, adminOnly, async (req, res) => {
    try {
      const banners = await Banner.find().sort({ sortOrder: 1, createdAt: -1 });
      res.json(banners);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** POST /api/admin/banners — create, with the image uploaded in the same request. */
  app.post("/api/admin/banners", auth, adminOnly, upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "A banner image is required" });
      const imageUrl = await uploadToCloudinary(req.file.buffer, "banners");

      const { title, titleBangla, linkType, linkValue, sortOrder, startsAt, endsAt } = req.body;
      const banner = await new Banner({
        imageUrl,
        title: title || "",
        titleBangla: titleBangla || "",
        linkType: linkType || "none",
        linkValue: linkValue || null,
        sortOrder: Number(sortOrder) || 0,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      }).save();
      res.status(201).json(banner);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/admin/banners/:id — edit fields (not the image). */
  app.patch("/api/admin/banners/:id", auth, adminOnly, async (req, res) => {
    try {
      const allowed = ["title", "titleBangla", "linkType", "linkValue", "isActive", "sortOrder", "startsAt", "endsAt"];
      const update = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) update[key] = req.body[key];
      }
      if (update.startsAt) update.startsAt = new Date(update.startsAt);
      if (update.endsAt) update.endsAt = new Date(update.endsAt);
      if (update.sortOrder !== undefined) update.sortOrder = Number(update.sortOrder) || 0;

      const banner = await Banner.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!banner) return res.status(404).json({ error: "Banner not found" });
      res.json(banner);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** DELETE /api/admin/banners/:id */
  app.delete("/api/admin/banners/:id", auth, adminOnly, async (req, res) => {
    try {
      await Banner.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};