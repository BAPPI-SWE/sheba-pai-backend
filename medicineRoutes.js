/**
 * Medicine catalogue — public read APIs.
 *
 * Designed content-first: every response carries enough clinical detail to
 * render a page worth ranking, not just a price tag. The same endpoints
 * serve the mobile app today and the Next.js website later.
 *
 * Wire into index.js:
 *   const medicineRoutes = require("./medicineRoutes");
 *   medicineRoutes(app, { auth, adminOnly });
 */
const Medicine = require("./models/Medicine");
const Generic = require("./models/Generic");
const Manufacturer = require("./models/Manufacturer");
const DrugClass = require("./models/DrugClass");
const { priceInfo } = require("./pricing");
const Category = require("./models/Category");

// Attach { onSale, effectivePrice, discountPercent } onto each medicine in
// a list — the same calculation checkout uses, so display and charge can
// never disagree.
function withPricing(list) {
  return list.map((m) => Object.assign(m, priceInfo(m)));
}

// Escape user input before putting it in a regex, so a stray "(" or "*"
// can't break the query or be used to craft an expensive one.
function safeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = function medicineRoutes(app, deps) {
  const { auth, adminOnly } = deps;

  /**
   * GET /api/medicines/search?q=nap&limit=20
   *
   * Prefix-first search: typing "nap" must surface "Napa" immediately.
   * MongoDB's text index only matches whole words, so we lead with an
   * anchored regex (index-backed) and fall back to a broader contains
   * match, then fill out with generic-name matches.
   */
  app.get("/api/medicines/search", async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      if (q.length < 2) return res.json({ medicines: [], generics: [] });

      const rx = safeRegex(q);
      const startsWith = new RegExp("^" + rx, "i");
      const contains = new RegExp(rx, "i");

      const baseFilter = { isActive: true, isDiscontinued: false };
      const projection = "brandName brandNameBangla slug strength dosageForm mrp price sellUnit packSizeLabel prescriptionRequired stock isAvailable images discountPercent discountStartsAt discountEndsAt";
      const populate = [
        { path: "generic", select: "name nameBangla slug" },
        { path: "manufacturer", select: "name slug" },
      ];

      // 1. Brands starting with the query — the strongest signal.
      const starts = await Medicine.find({
        ...baseFilter,
        $or: [{ brandName: startsWith }, { brandNameBangla: startsWith }],
      })
        .select(projection).populate(populate)
        .sort({ salesCount: -1 }).limit(limit).lean();

      // 2. Brands merely containing it, excluding ones already found.
      let results = starts;
      if (results.length < limit) {
        const more = await Medicine.find({
          ...baseFilter,
          _id: { $nin: results.map((m) => m._id) },
          $or: [{ brandName: contains }, { brandNameBangla: contains }, { searchKeywords: contains }],
        })
          .select(projection).populate(populate)
          .sort({ salesCount: -1 }).limit(limit - results.length).lean();
        results = results.concat(more);
      }

      // 3. Brands whose GENERIC matches — someone searching "paracetamol"
      //    wants every brand of it, not nothing.
      const matchedGenerics = await Generic.find({
        isActive: true,
        $or: [{ name: contains }, { nameBangla: contains }],
      }).select("name nameBangla slug").limit(10).lean();

      if (results.length < limit && matchedGenerics.length) {
        const byGeneric = await Medicine.find({
          ...baseFilter,
          _id: { $nin: results.map((m) => m._id) },
          generic: { $in: matchedGenerics.map((g) => g._id) },
        })
          .select(projection).populate(populate)
          .sort({ salesCount: -1 }).limit(limit - results.length).lean();
        results = results.concat(byGeneric);
      }

      res.json({ medicines: withPricing(results), generics: matchedGenerics });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/medicines — browse with filters and pagination.
   * Filters: genericSlug, manufacturerSlug, drugClassSlug, prescriptionRequired, inStock
   * Sort: popular | price_asc | price_desc | name
   */
  app.get("/api/medicines", async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const filter = { isActive: true, isDiscontinued: false };

      if (req.query.genericSlug) {
        const g = await Generic.findOne({ slug: req.query.genericSlug }).select("_id");
        if (!g) return res.json({ medicines: [], total: 0, page, hasMore: false });
        filter.generic = g._id;
      }
      if (req.query.manufacturerSlug) {
        const m = await Manufacturer.findOne({ slug: req.query.manufacturerSlug }).select("_id");
        if (!m) return res.json({ medicines: [], total: 0, page, hasMore: false });
        filter.manufacturer = m._id;
      }
      if (req.query.drugClassSlug) {
        const dc = await DrugClass.findOne({ slug: req.query.drugClassSlug }).select("_id");
        if (!dc) return res.json({ medicines: [], total: 0, page, hasMore: false });
        const generics = await Generic.find({ drugClasses: dc._id }).select("_id");
        filter.generic = { $in: generics.map((g) => g._id) };
      }
      if (req.query.categorySlug) {
        const cat = await Category.findOne({ slug: req.query.categorySlug }).select("_id");
        if (!cat) return res.json({ medicines: [], total: 0, page, hasMore: false });
        filter.categories = cat._id;
      }
      if (req.query.prescriptionRequired !== undefined) {
        filter.prescriptionRequired = req.query.prescriptionRequired === "true";
      }
      if (req.query.inStock === "true") {
        filter.stock = { $gt: 0 };
        filter.isAvailable = true;
      }
      if (req.query.onSale === "true") {
        filter.discountPercent = { $gt: 0 };
        filter.$or = [
          { discountStartsAt: null }, { discountStartsAt: { $lte: new Date() } },
        ];
        filter.$and = [
          { $or: [{ discountEndsAt: null }, { discountEndsAt: { $gte: new Date() } }] },
        ];
      }

      const sortMap = {
        popular: { salesCount: -1 },
        price_asc: { price: 1 },
        price_desc: { price: -1 },
        name: { brandName: 1 },
      };
      const sort = sortMap[req.query.sort] || sortMap.popular;

      const [medicines, total] = await Promise.all([
        Medicine.find(filter)
          .select("brandName brandNameBangla slug strength dosageForm mrp price sellUnit packSizeLabel prescriptionRequired stock isAvailable images discountPercent discountStartsAt discountEndsAt")
          .populate("generic", "name nameBangla slug")
          .populate("manufacturer", "name slug")
          .sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        Medicine.countDocuments(filter),
      ]);

      res.json({ medicines: withPricing(medicines), total, page, hasMore: page * limit < total });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/medicines/sitemap — every public medicine and generic address,
   * for the website's sitemap.xml (so Google can find each product page).
   * Slugs and dates only; registered before /:slug so "sitemap" isn't read as a slug.
   */
  app.get("/api/medicines/sitemap", async (req, res) => {
    try {
      const [medicines, generics] = await Promise.all([
        Medicine.find({ isActive: true, isDiscontinued: false }).select("slug updatedAt").lean(),
        Generic.find({ isActive: true }).select("slug updatedAt").lean(),
      ]);
      res.set("Cache-Control", "public, max-age=3600");
      res.json({
        medicines: medicines.map((m) => ({ slug: m.slug, updatedAt: m.updatedAt })),
        generics: generics.map((g) => ({ slug: g.slug, updatedAt: g.updatedAt })),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/medicines/:slug — full product page.
   * Returns the brand, its complete clinical content (via the generic),
   * and cheaper alternative brands of the same generic.
   */
  app.get("/api/medicines/:slug", async (req, res) => {
    try {
      const medicine = await Medicine.findOne({ slug: req.params.slug, isActive: true })
        .populate({
          path: "generic",
          populate: { path: "drugClasses", select: "name nameBangla slug" },
        })
        .populate("manufacturer", "name nameBangla slug logoUrl");
      if (!medicine) return res.status(404).json({ error: "Medicine not found" });

      // Same generic, different brands — sorted cheapest first. This is a
      // genuinely useful feature in Bangladesh, where the same molecule can
      // vary several-fold in price between companies.
      const alternatives = await Medicine.find({
        generic: medicine.generic._id,
        _id: { $ne: medicine._id },
        isActive: true,
        isDiscontinued: false,
      })
        .select("brandName slug strength dosageForm price mrp sellUnit stock isAvailable discountPercent discountStartsAt discountEndsAt")
        .populate("manufacturer", "name slug")
        .sort({ price: 1 })
        .limit(20)
        .lean();

      // Fire-and-forget popularity signal; never block the response on it.
      Medicine.updateOne({ _id: medicine._id }, { $inc: { viewCount: 1 } }).catch(() => {});

      res.json({ medicine: withPricing([medicine.toObject()])[0], alternatives: withPricing(alternatives) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/generics/:slug — the generic information page.
   * This is the page most likely to rank for "what is X / X এর কাজ কি".
   */
  app.get("/api/generics/:slug", async (req, res) => {
    try {
      const generic = await Generic.findOne({ slug: req.params.slug, isActive: true })
        .populate("drugClasses", "name nameBangla slug");
      if (!generic) return res.status(404).json({ error: "Generic not found" });

      const brands = await Medicine.find({
        generic: generic._id, isActive: true, isDiscontinued: false,
      })
        .select("brandName brandNameBangla slug strength dosageForm price mrp sellUnit packSizeLabel stock isAvailable prescriptionRequired images discountPercent discountStartsAt discountEndsAt")
        .populate("manufacturer", "name slug")
        .sort({ price: 1 })
        .lean();

      res.json({ generic, brands: withPricing(brands), brandCount: brands.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/generics — A-Z index (browse + sitemap source). */
  app.get("/api/generics", async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const filter = { isActive: true };
      if (req.query.letter) filter.name = new RegExp("^" + safeRegex(req.query.letter), "i");

      const [generics, total] = await Promise.all([
        Generic.find(filter).select("name nameBangla slug").sort({ name: 1 })
          .skip((page - 1) * limit).limit(limit).lean(),
        Generic.countDocuments(filter),
      ]);
      res.json({ generics, total, page, hasMore: page * limit < total });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/manufacturers — company index. */
  app.get("/api/manufacturers", async (req, res) => {
    try {
      const manufacturers = await Manufacturer.find({ isActive: true })
        .select("name nameBangla slug logoUrl").sort({ name: 1 }).lean();
      res.json(manufacturers);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/categories — consumer shopping categories, for the store's grid. */
  app.get("/api/categories", async (req, res) => {
    try {
      const filter = { isActive: true };
      if (req.query.featured === "true") filter.isFeatured = true;
      const categories = await Category.find(filter)
        .select("name nameBangla slug icon tone isFeatured")
        .sort({ sortOrder: 1, name: 1 });
      res.json(categories);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/drug-classes — therapeutic class index. */
  app.get("/api/drug-classes", async (req, res) => {
    try {
      const classes = await DrugClass.find({ isActive: true })
        .select("name nameBangla slug description").sort({ name: 1 }).lean();
      res.json(classes);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};