/**
 * Medicine catalogue — admin CRUD.
 * Everything here is adminOnly. Public reads live in medicineRoutes.js.
 *
 * Wire into index.js:
 *   const medicineAdminRoutes = require("./medicineAdminRoutes");
 *   medicineAdminRoutes(app, { auth, adminOnly });
 */
const Medicine = require("./models/Medicine");
const Generic = require("./models/Generic");
const Manufacturer = require("./models/Manufacturer");
const DrugClass = require("./models/DrugClass");
const Category = require("./models/Category");

function slugify(str) {
  return str
    .toString().trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Ensure a slug is unique for the given model, appending -2, -3... if not. */
async function uniqueSlug(Model, base, excludeId) {
  let slug = slugify(base);
  if (!slug) slug = "item";
  let candidate = slug;
  let n = 2;
  while (await Model.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    candidate = `${slug}-${n++}`;
  }
  return candidate;
}

module.exports = function medicineAdminRoutes(app, deps) {
  const { auth, adminOnly, upload, uploadToCloudinary } = deps;

  // ============ MANUFACTURERS ============
  app.get("/api/admin/manufacturers", auth, adminOnly, async (req, res) => {
    try {
      const list = await Manufacturer.find().sort({ name: 1 });
      res.json(list);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post("/api/admin/manufacturers", auth, adminOnly, async (req, res) => {
    try {
      const { name, nameBangla, description, established, headquarters, website, logoUrl } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const slug = await uniqueSlug(Manufacturer, name);
      const saved = await new Manufacturer({ name, nameBangla, slug, description, established, headquarters, website, logoUrl }).save();
      res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.put("/api/admin/manufacturers/:id", auth, adminOnly, async (req, res) => {
    try {
      const updated = await Manufacturer.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.delete("/api/admin/manufacturers/:id", auth, adminOnly, async (req, res) => {
    try {
      const inUse = await Medicine.exists({ manufacturer: req.params.id });
      if (inUse) return res.status(409).json({ error: "Cannot delete — medicines exist under this manufacturer" });
      await Manufacturer.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ DRUG CLASSES ============
  app.get("/api/admin/drug-classes", auth, adminOnly, async (req, res) => {
    try {
      const list = await DrugClass.find().sort({ name: 1 });
      res.json(list);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post("/api/admin/drug-classes", auth, adminOnly, async (req, res) => {
    try {
      const { name, nameBangla, description, descriptionBangla } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const slug = await uniqueSlug(DrugClass, name);
      const saved = await new DrugClass({ name, nameBangla, slug, description, descriptionBangla }).save();
      res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.put("/api/admin/drug-classes/:id", auth, adminOnly, async (req, res) => {
    try {
      const updated = await DrugClass.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.delete("/api/admin/drug-classes/:id", auth, adminOnly, async (req, res) => {
    try {
      const inUse = await Generic.exists({ drugClasses: req.params.id });
      if (inUse) return res.status(409).json({ error: "Cannot delete — generics are assigned to this class" });
      await DrugClass.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ CATEGORIES (consumer-facing shopping grid) ============
  app.get("/api/admin/categories", auth, adminOnly, async (req, res) => {
    try {
      const list = await Category.find().sort({ sortOrder: 1, name: 1 });
      res.json(list);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post("/api/admin/categories", auth, adminOnly, async (req, res) => {
    try {
      const { name, nameBangla, icon, tone, sortOrder, isFeatured } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const slug = await uniqueSlug(Category, name);
      const saved = await new Category({ name, nameBangla, slug, icon, tone, sortOrder, isFeatured }).save();
      res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.put("/api/admin/categories/:id", auth, adminOnly, async (req, res) => {
    try {
      const body = { ...req.body };
      delete body.slug;
      const updated = await Category.findByIdAndUpdate(req.params.id, body, { new: true });
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.delete("/api/admin/categories/:id", auth, adminOnly, async (req, res) => {
    try {
      const inUse = await Medicine.exists({ categories: req.params.id });
      if (inUse) return res.status(409).json({ error: "Cannot delete — medicines are assigned to this category" });
      await Category.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ GENERICS (the clinical content) ============
  app.get("/api/admin/generics", auth, adminOnly, async (req, res) => {
    try {
      const q = req.query.q;
      const filter = q ? { $or: [{ name: new RegExp(q, "i") }, { nameBangla: new RegExp(q, "i") }] } : {};
      const list = await Generic.find(filter).populate("drugClasses", "name").sort({ name: 1 }).limit(100);
      res.json(list);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post("/api/admin/generics", auth, adminOnly, async (req, res) => {
    try {
      const body = req.body;
      if (!body.name) return res.status(400).json({ error: "Name is required" });
      const slug = await uniqueSlug(Generic, body.name);
      const saved = await new Generic({ ...body, slug }).save();
      res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.put("/api/admin/generics/:id", auth, adminOnly, async (req, res) => {
    try {
      const body = { ...req.body };
      delete body.slug; // slug is set once at creation; editing name doesn't silently break existing links/URLs
      const updated = await Generic.findByIdAndUpdate(req.params.id, body, { new: true });
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.delete("/api/admin/generics/:id", auth, adminOnly, async (req, res) => {
    try {
      const inUse = await Medicine.exists({ generic: req.params.id });
      if (inUse) return res.status(409).json({ error: "Cannot delete — brand medicines use this generic" });
      await Generic.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ MEDICINES (brand products + inventory) ============
  app.get("/api/admin/medicines", auth, adminOnly, async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 30, 100);
      const filter = {};
      if (req.query.q) filter.brandName = new RegExp(req.query.q, "i");
      if (req.query.lowStock === "true") filter.$expr = { $lte: ["$stock", "$lowStockThreshold"] };

      const [medicines, total] = await Promise.all([
        Medicine.find(filter)
          .populate("generic", "name").populate("manufacturer", "name").populate("categories", "name")
          .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Medicine.countDocuments(filter),
      ]);
      res.json({ medicines, total, page, hasMore: page * limit < total });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post("/api/admin/medicines", auth, adminOnly, async (req, res) => {
    try {
      const body = req.body;
      if (!body.brandName || !body.generic || !body.manufacturer || body.mrp == null || body.price == null) {
        return res.status(400).json({ error: "Brand name, generic, manufacturer, MRP, and price are required" });
      }
      if (body.price > body.mrp) {
        return res.status(400).json({ error: "Selling price cannot exceed MRP" });
      }
      const slugBase = `${body.brandName}-${body.strength || ""}`;
      const slug = await uniqueSlug(Medicine, slugBase);
      const saved = await new Medicine({ ...body, slug }).save();
      res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.put("/api/admin/medicines/:id", auth, adminOnly, async (req, res) => {
    try {
      const body = { ...req.body };
      delete body.slug;
      if (body.price != null && body.mrp != null && body.price > body.mrp) {
        return res.status(400).json({ error: "Selling price cannot exceed MRP" });
      }
      const updated = await Medicine.findByIdAndUpdate(req.params.id, body, { new: true })
        .populate("generic", "name").populate("manufacturer", "name");
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  /** Dedicated stock-adjustment endpoint — clearer audit trail than a generic PUT. */
  app.patch("/api/admin/medicines/:id/stock", auth, adminOnly, async (req, res) => {
    try {
      const { delta, setTo } = req.body; // delta: +/- change, OR setTo: absolute value
      const medicine = await Medicine.findById(req.params.id);
      if (!medicine) return res.status(404).json({ error: "Not found" });
      if (setTo != null) medicine.stock = Math.max(0, Number(setTo));
      else medicine.stock = Math.max(0, medicine.stock + Number(delta || 0));
      await medicine.save();
      res.json(medicine);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  /** Upload a product photo. First upload becomes the primary image. */
  app.post("/api/admin/medicines/:id/images", auth, adminOnly, upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const medicine = await Medicine.findById(req.params.id);
      if (!medicine) return res.status(404).json({ error: "Not found" });

      const url = await uploadToCloudinary(req.file.buffer, "medicines");
      medicine.images.push(url);
      await medicine.save();
      res.status(201).json({ images: medicine.images });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Remove one image by URL (order matters: the first remaining image becomes primary). */
  app.delete("/api/admin/medicines/:id/images", auth, adminOnly, async (req, res) => {
    try {
      const { url } = req.body;
      const medicine = await Medicine.findByIdAndUpdate(
        req.params.id,
        { $pull: { images: url } },
        { new: true }
      );
      if (!medicine) return res.status(404).json({ error: "Not found" });
      res.json({ images: medicine.images });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/admin/medicines/:id", auth, adminOnly, async (req, res) => {
    try {
      await Medicine.findByIdAndUpdate(req.params.id, { isActive: false, isDiscontinued: true });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};