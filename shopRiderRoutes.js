/**
 * Self-service profile submission for shops and riders, plus admin
 * verification — the same pattern as caregiver identity verification.
 *
 * Wire into index.js:
 *   const shopRiderRoutes = require("./shopRiderRoutes");
 *   shopRiderRoutes(app, { auth, adminOnly, shopOnly, riderOnly, upload, uploadToCloudinary });
 */
const Shop = require("./models/Shop");
const RiderProfile = require("./models/RiderProfile");
const ShopStock = require("./models/ShopStock");
const Medicine = require("./models/Medicine");

module.exports = function shopRiderRoutes(app, deps) {
  const { auth, adminOnly, shopOnly, riderOnly, upload, uploadToCloudinary } = deps;

  // ============ SHOP: self-service profile ============

  /** Get my own shop profile (or null if not yet created). */
  app.get("/api/shop/profile", auth, shopOnly, async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.user.id });
      res.json(shop || null);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Create or update my shop's details. Submitting resets verification to "pending". */
  app.post("/api/shop/profile", auth, shopOnly, async (req, res) => {
    try {
      const { name, address, longitude, latitude, contactPhone } = req.body;
      if (!name || !address || !contactPhone || longitude == null || latitude == null) {
        return res.status(400).json({ error: "Name, address, phone, and location are all required" });
      }
      const shop = await Shop.findOneAndUpdate(
        { owner: req.user.id },
        {
          owner: req.user.id, name, address, contactPhone,
          location: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
          verificationStatus: "pending", rejectionReason: null,
        },
        { new: true, upsert: true }
      );
      res.status(201).json(shop);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Upload the trade/pharmacy license photo. */
  app.post("/api/shop/license", auth, shopOnly, upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const url = await uploadToCloudinary(req.file.buffer, "shop_licenses");
      const shop = await Shop.findOneAndUpdate(
        { owner: req.user.id },
        { licenseUrl: url, verificationStatus: "pending", rejectionReason: null },
        { new: true }
      );
      if (!shop) return res.status(404).json({ error: "Create your shop profile first" });
      res.json(shop);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Toggle open/closed for business (only meaningful once approved). */
  app.patch("/api/shop/open", auth, shopOnly, async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.user.id });
      if (!shop) return res.status(404).json({ error: "No shop profile found" });
      if (req.body.isOpen && shop.verificationStatus !== "approved") {
        return res.status(403).json({ error: "Your shop is not verified yet" });
      }
      shop.isOpen = !!req.body.isOpen;
      await shop.save();
      res.json(shop);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ SHOP: my own stock ============

  /** GET /api/shop/stock — everything my shop currently carries. */
  app.get("/api/shop/stock", auth, shopOnly, async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.user.id });
      if (!shop) return res.status(404).json({ error: "Create your shop profile first" });
      const stock = await ShopStock.find({ shop: shop._id })
        .populate("medicine", "brandName brandNameBangla strength dosageForm price mrp slug")
        .sort({ updatedAt: -1 });
      res.json(stock);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** POST /api/shop/stock — add or update how much of one medicine I have. */
  app.post("/api/shop/stock", auth, shopOnly, async (req, res) => {
    try {
      const { medicineId, stock } = req.body;
      if (!medicineId || stock == null) return res.status(400).json({ error: "medicineId and stock are required" });
      const shop = await Shop.findOne({ owner: req.user.id });
      if (!shop) return res.status(404).json({ error: "Create your shop profile first" });

      const medicine = await Medicine.findById(medicineId).select("brandName brandNameBangla strength dosageForm price mrp slug");
      if (!medicine) return res.status(404).json({ error: "Medicine not found" });

      const entry = await ShopStock.findOneAndUpdate(
        { shop: shop._id, medicine: medicineId },
        { stock: Math.max(0, Number(stock)) },
        { new: true, upsert: true }
      );
      res.status(201).json({ ...entry.toObject(), medicine });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** DELETE /api/shop/stock/:medicineId — stop carrying this medicine. */
  app.delete("/api/shop/stock/:medicineId", auth, shopOnly, async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.user.id });
      if (!shop) return res.status(404).json({ error: "Create your shop profile first" });
      await ShopStock.deleteOne({ shop: shop._id, medicine: req.params.medicineId });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ RIDER: self-service profile ============

  app.get("/api/rider/profile", auth, riderOnly, async (req, res) => {
    try {
      const profile = await RiderProfile.findOne({ user: req.user.id });
      res.json(profile || null);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Submit identity details. Submitting resets verification to "pending". */
  app.post("/api/rider/profile", auth, riderOnly, async (req, res) => {
    try {
      const { fullName, nidNumber, vehicleType, vehiclePlateNumber } = req.body;
      if (!fullName || !nidNumber) return res.status(400).json({ error: "Full name and NID number are required" });
      const profile = await RiderProfile.findOneAndUpdate(
        { user: req.user.id },
        {
          user: req.user.id, fullName, nidNumber, vehicleType: vehicleType || "motorcycle", vehiclePlateNumber,
          verificationStatus: "pending", rejectionReason: null,
        },
        { new: true, upsert: true }
      );
      res.status(201).json(profile);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Upload one of nidFront / nidBack / selfie. */
  app.post("/api/rider/documents", auth, riderOnly, upload.single("image"), async (req, res) => {
    try {
      const { docType } = req.body; // "nidFront" | "nidBack" | "selfie"
      const fieldMap = { nidFront: "nidFrontUrl", nidBack: "nidBackUrl", selfie: "selfieUrl" };
      if (!fieldMap[docType]) return res.status(400).json({ error: "Invalid document type" });
      if (!req.file) return res.status(400).json({ error: "No image provided" });

      const url = await uploadToCloudinary(req.file.buffer, "rider_documents");
      const profile = await RiderProfile.findOneAndUpdate(
        { user: req.user.id },
        { [fieldMap[docType]]: url, verificationStatus: "pending", rejectionReason: null },
        { new: true }
      );
      if (!profile) return res.status(404).json({ error: "Create your rider profile first" });
      res.json(profile);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ ADMIN: verification queues ============

  app.get("/api/admin/shops", auth, adminOnly, async (req, res) => {
    try {
      const status = req.query.status || "pending";
      const shops = await Shop.find({ verificationStatus: status }).populate("owner", "name phone").sort({ updatedAt: -1 });
      res.json(shops);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/admin/shops/:id/verify", auth, adminOnly, async (req, res) => {
    try {
      const { decision, rejectionReason } = req.body;
      const update = decision === "approve"
        ? { verificationStatus: "approved", rejectionReason: null, reviewedAt: new Date(), reviewedBy: req.user.id }
        : { verificationStatus: "rejected", rejectionReason: rejectionReason || "Documents not acceptable", reviewedAt: new Date(), reviewedBy: req.user.id };
      const shop = await Shop.findByIdAndUpdate(req.params.id, update, { new: true }).populate("owner", "name phone");
      if (!shop) return res.status(404).json({ error: "Not found" });
      res.json(shop);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get("/api/admin/riders", auth, adminOnly, async (req, res) => {
    try {
      const status = req.query.status || "pending";
      const riders = await RiderProfile.find({ verificationStatus: status }).populate("user", "name phone").sort({ updatedAt: -1 });
      res.json(riders);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/admin/riders/:id/verify", auth, adminOnly, async (req, res) => {
    try {
      const { decision, rejectionReason } = req.body;
      const update = decision === "approve"
        ? { verificationStatus: "approved", rejectionReason: null, reviewedAt: new Date(), reviewedBy: req.user.id }
        : { verificationStatus: "rejected", rejectionReason: rejectionReason || "Documents not acceptable", reviewedAt: new Date(), reviewedBy: req.user.id };
      const rider = await RiderProfile.findByIdAndUpdate(req.params.id, update, { new: true }).populate("user", "name phone");
      if (!rider) return res.status(404).json({ error: "Not found" });
      res.json(rider);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};