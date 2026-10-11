/**
 * Caregiver directory — the app side.
 *
 *   Public (no login):  care types, the caregiver list (filter by district,
 *                       care type, gender, level, shift) and caregiver profiles.
 *   Families (login):   send a booking request, see their requests, cancel,
 *                       review the caregiver afterwards.
 *   Caregivers (login): edit their care profile (districts they work in,
 *                       care types, shifts, rates, photo) and see the jobs the
 *                       admin team has assigned to them.
 *
 * Wire into index.js:
 *   const careRoutes = require("./careRoutes");
 *   careRoutes(app, { auth, helperOnly, upload, uploadToCloudinary });
 */
const HelperProfile = require("./models/HelperProfile");
const CareCategory = require("./models/CareCategory");
const CareBooking = require("./models/CareBooking");
const CareOffer = require("./models/CareOffer");
const User = require("./models/User");
const { resolveDistrict } = require("./bdGeo");
const {
  listedFilter, missingCareFields, isListed, publicCaregiver, publicCategory, caregiverQuery, LIST_SORT,
  newBookingCode, applyCareFields, validateBooking, recomputeCaregiverRating, recentReviews, clean,
  normalizeBdMobile, publicOffer, isId,
} = require("./careCommon");

const OPEN_STATUSES = ["new", "contacted", "confirmed", "ongoing"];

/** Category list with how many listed caregivers offer each (optionally in one district). */
async function categoriesWithCounts(districtName) {
  const match = listedFilter();
  if (districtName) match["care.districts"] = districtName;
  const [cats, counts] = await Promise.all([
    CareCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    HelperProfile.aggregate([
      { $match: match },
      { $unwind: "$care.categories" },
      { $group: { _id: "$care.categories", n: { $sum: 1 } } },
    ]),
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  return cats.map((c) => ({
    ...publicCategory(c),
    description: c.description, descriptionBangla: c.descriptionBangla,
    fromPrice: c.fromPrice, priceUnit: c.priceUnit, minTier: c.minTier,
    caregiverCount: map[String(c._id)] || 0,
  }));
}

/** Booking as the family sees it (their own data + the assigned caregiver's public card). */
async function bookingForPatient(b) {
  let caregiver = null;
  if (b.assignedCaregiver) {
    const p = await HelperProfile.findOne({ user: b.assignedCaregiver._id || b.assignedCaregiver })
      .populate("user", "name").populate("care.categories", "name nameBangla slug iconKey").lean();
    if (p) caregiver = publicCaregiver(p);
  }
  const { adminNotes, ...rest } = b; // internal notes stay internal
  return { ...rest, assignedCaregiver: undefined, caregiver };
}

module.exports = function careRoutes(app, deps) {
  const { auth, helperOnly, upload, uploadToCloudinary } = deps;

  const patientOnly = (req, res, next) =>
    req.user.role === "patient" ? next() : res.status(403).json({ error: "Please sign in with a family / patient account to book" });

  /* ================================ PUBLIC ================================ */

  app.get("/api/care/categories", async (req, res) => {
    try { res.json(await categoriesWithCounts(null)); } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Everything the caregiver home screen needs in one request. */
  app.get("/api/care/home", async (req, res) => {
    try {
      const { filter } = await caregiverQuery({ district: req.query.district, division: req.query.division });
      const [categories, featured, total] = await Promise.all([
        categoriesWithCounts(resolveDistrict(req.query.district)?.name || null),
        HelperProfile.find(filter).sort(LIST_SORT).limit(6)
          .populate("user", "name").populate("care.categories", "name nameBangla slug iconKey").lean(),
        HelperProfile.countDocuments(filter),
      ]);
      res.json({ categories, caregivers: featured.map((p) => publicCaregiver(p)), total });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * GET /api/care/caregivers?category=&district=&division=&gender=&tier=&shift=&available=&q=&page=&limit=
   */
  app.get("/api/care/caregivers", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(5, parseInt(req.query.limit) || 20));
      const { filter, category } = await caregiverQuery(req.query);
      if (!filter) return res.json({ caregivers: [], total: 0, hasMore: false, category: null });
      const [rows, total] = await Promise.all([
        HelperProfile.find(filter).sort(LIST_SORT).skip((page - 1) * limit).limit(limit)
          .populate("user", "name").populate("care.categories", "name nameBangla slug iconKey").lean(),
        HelperProfile.countDocuments(filter),
      ]);
      res.json({
        caregivers: rows.map((p) => publicCaregiver(p, { category })),
        total, page, hasMore: page * limit < total,
        category: category ? { ...publicCategory(category), fromPrice: category.fromPrice, priceUnit: category.priceUnit,
          description: category.description, descriptionBangla: category.descriptionBangla } : null,
      });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** One caregiver's public profile, with recent reviews. */
  app.get("/api/care/caregivers/:code", async (req, res) => {
    try {
      const p = await HelperProfile.findOne({ ...listedFilter(), "care.code": String(req.params.code).toUpperCase() })
        .populate("user", "name").populate("care.categories", "name nameBangla slug iconKey").lean();
      if (!p) return res.status(404).json({ error: "This caregiver is not available any more" });
      res.json({ ...publicCaregiver(p, { detail: true }), reviews: await recentReviews(p.user._id, 10) });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** One-tap services (kind=urgent) or monthly packages (kind=package), with prices. */
  app.get("/api/care/offers", async (req, res) => {
    try {
      const filter = { isActive: true };
      if (["urgent", "package"].includes(req.query.kind)) filter.kind = req.query.kind;
      const rows = await CareOffer.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
      res.json(rows.map(publicOffer));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * Signed in or not: a token is used when present (so the request shows in
   * the family's Activity tab), and a missing / expired one simply means guest.
   */
  const maybeAuth = (req, res, next) => {
    if (!req.headers.authorization) return next();
    const asGuest = { status: () => ({ json: () => { req.user = undefined; next(); } }) };
    auth(req, asGuest, next);
  };

  /**
   * POST /api/care/quick-request — the one-tap booking: name + phone, plus
   * what was tapped (a service / package, a caregiver, or nothing). The team
   * calls back, agrees the details and assigns a caregiver.
   *   body: { contactName, contactPhone, offerId?, caregiverCode?, district?, note? }
   */
  app.post("/api/care/quick-request", maybeAuth, async (req, res) => {
    try {
      const b = req.body || {};
      const contactName = clean(b.contactName, 80);
      if (!contactName || contactName.length < 2) return res.status(400).json({ error: "Please enter your name" });
      const contactPhone = normalizeBdMobile(b.contactPhone);
      if (!contactPhone) return res.status(400).json({ error: "Please enter a valid 11-digit mobile number (01XXXXXXXXX)" });

      let offer = null;
      if (b.offerId) {
        if (!isId(b.offerId)) return res.status(400).json({ error: "Unknown service" });
        offer = await CareOffer.findOne({ _id: b.offerId, isActive: true }).lean();
        if (!offer) return res.status(400).json({ error: "This service is no longer available" });
      }
      let caregiver = null;
      if (b.caregiverCode) {
        caregiver = await HelperProfile.findOne({ ...listedFilter(), "care.code": String(b.caregiverCode).toUpperCase() })
          .populate("user", "name").lean();
      }
      const district = b.district ? resolveDistrict(b.district) : null;

      // A double tap returns the request already sent instead of making two.
      const recent = await CareBooking.findOne({
        contactPhone, status: "new", offer: offer?._id || null,
        requestedCaregiver: caregiver?.user?._id || null,
        createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
      }).lean();
      if (recent) return res.status(200).json(await bookingForPatient(recent));

      // Guard against spam, not a business limit.
      const open = await CareBooking.countDocuments({ contactPhone, status: { $in: ["new", "contacted"] } });
      if (open >= 5) {
        return res.status(429).json({ error: "You already have 5 requests waiting. Our team will call you soon — or call us directly." });
      }

      // Signed-in family → their account. Otherwise link by phone number if they have one.
      let patientId = null;
      if (req.user?.role === "patient") patientId = req.user.id;
      else if (!req.user) {
        const u = await User.findOne({ role: "patient", phone: contactPhone, isDeleted: { $ne: true } }).select("_id").lean();
        patientId = u?._id || null;
      }

      const kind = offer ? offer.kind : caregiver ? "caregiver" : "general";
      const booking = await new CareBooking({
        code: await newBookingCode(),
        patient: patientId,
        source: "app",
        kind,
        offer: offer?._id || null,
        offerName: offer?.name || null,
        offerNameBangla: offer?.nameBangla || null,
        offerPrice: offer?.price ?? null,
        offerPriceUnit: offer?.priceUnit || null,
        planType: offer?.kind === "package" ? "regular" : "short",
        shift: "day12",
        requestedCaregiver: caregiver?.user?._id || null,
        requestedCaregiverCode: caregiver?.care?.code || null,
        requestedCaregiverName: caregiver?.user?.name || null,
        district: district?.name || null,
        division: district?.division || null,
        contactName,
        contactPhone,
        note: clean(b.note, 500),
        status: "new",
        history: [{ status: "new", by: "patient" }],
      }).save();
      res.status(201).json(await bookingForPatient(booking.toObject()));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* ================================ FAMILIES ================================ */

  app.post("/api/care/bookings", auth, patientOnly, async (req, res) => {
    try {
      // A guard against accidental repeat taps / spam, not a business limit.
      const open = await CareBooking.countDocuments({ patient: req.user.id, status: { $in: ["new", "contacted"] } });
      if (open >= 5) {
        return res.status(429).json({ error: "You already have 5 requests waiting. Our team will call you soon — or call us directly." });
      }
      const v = await validateBooking(req.body);
      if (v.error) return res.status(400).json({ error: v.error });

      const booking = await new CareBooking({
        ...v.fields,
        code: await newBookingCode(),
        patient: req.user.id,
        source: "app",
        status: "new",
        history: [{ status: "new", by: "patient" }],
      }).save();

      res.status(201).json(await bookingForPatient(booking.toObject()));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get("/api/care/bookings/mine", auth, async (req, res) => {
    try {
      const rows = await CareBooking.find({ patient: req.user.id })
        .populate("category", "name nameBangla slug iconKey")
        .sort({ createdAt: -1 }).limit(50).lean();
      res.json(await Promise.all(rows.map(bookingForPatient)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get("/api/care/bookings/:id", auth, async (req, res) => {
    try {
      const b = await CareBooking.findOne({ _id: req.params.id, patient: req.user.id })
        .populate("category", "name nameBangla slug iconKey").lean();
      if (!b) return res.status(404).json({ error: "Booking not found" });
      res.json(await bookingForPatient(b));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** A family can cancel until the booking is confirmed; after that they call us. */
  app.post("/api/care/bookings/:id/cancel", auth, async (req, res) => {
    try {
      const b = await CareBooking.findOne({ _id: req.params.id, patient: req.user.id });
      if (!b) return res.status(404).json({ error: "Booking not found" });
      if (!["new", "contacted"].includes(b.status)) {
        return res.status(400).json({ error: "This booking is already confirmed. Please call us to change or cancel it." });
      }
      b.status = "cancelled";
      b.cancelledBy = "patient";
      b.cancelReason = clean(req.body.reason, 300);
      b.history.push({ status: "cancelled", by: "patient", note: b.cancelReason });
      await b.save();
      res.json(await bookingForPatient(b.toObject()));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post("/api/care/bookings/:id/review", auth, async (req, res) => {
    try {
      const b = await CareBooking.findOne({ _id: req.params.id, patient: req.user.id });
      if (!b) return res.status(404).json({ error: "Booking not found" });
      if (b.status !== "completed" || !b.assignedCaregiver) return res.status(400).json({ error: "You can review once the care is completed" });
      if (b.review?.stars) return res.status(400).json({ error: "You have already reviewed this booking" });
      const stars = Math.round(Number(req.body.stars));
      if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: "Please choose 1 to 5 stars" });
      b.review = { stars, comment: clean(req.body.comment, 500), at: new Date() };
      await b.save();
      await recomputeCaregiverRating(b.assignedCaregiver);
      res.json(await bookingForPatient(b.toObject()));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* ================================ CAREGIVERS ================================ */

  async function myProfileResponse(userId) {
    const p = await HelperProfile.findOne({ user: userId }).populate("user", "name phone").lean();
    if (!p) return { care: null, complete: false, listed: false, missing: ["gender", "districts", "categories", "shifts"], verificationStatus: "unsubmitted" };
    const care = p.care || {};
    return {
      care: { ...care, categories: (care.categories || []).map(String) },
      name: p.user?.name,
      missing: missingCareFields(care),
      complete: missingCareFields(care).length === 0,
      listed: isListed(p),
      verificationStatus: p.verificationStatus,
      hasCertificate: (p.certificateUrls || []).length > 0,
      hasPoliceClearance: !!p.policeClearanceUrl,
      ratingAvg: p.ratingAvg || 0,
      ratingCount: p.ratingCount || 0,
      preview: p.care?.code ? publicCaregiver({ ...p, care: { ...care, categories: [] } }) : null,
    };
  }

  app.get("/api/care/my-profile", auth, helperOnly, async (req, res) => {
    try { res.json(await myProfileResponse(req.user.id)); } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.put("/api/care/my-profile", auth, helperOnly, async (req, res) => {
    try {
      let profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile) profile = new HelperProfile({ user: req.user.id, roles: [] });
      const error = await applyCareFields(profile, req.body, { asAdmin: false });
      if (error) return res.status(400).json({ error });
      await profile.save();
      res.json(await myProfileResponse(req.user.id));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Public profile photo (separate from the private verification selfies). */
  app.post("/api/care/my-profile/photo", auth, helperOnly, upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      let profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile) profile = new HelperProfile({ user: req.user.id, roles: [] });
      const url = await uploadToCloudinary(req.file.buffer, `sheba-pai/care-photos/${req.user.id}`);
      if (!profile.care) profile.care = {};
      profile.care.photoUrl = url;
      profile.markModified("care");
      await profile.save();
      res.status(201).json({ photoUrl: url });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Jobs the admin team has assigned to this caregiver. */
  app.get("/api/care/my-assignments", auth, helperOnly, async (req, res) => {
    try {
      const rows = await CareBooking.find({ assignedCaregiver: req.user.id, status: { $in: ["confirmed", "ongoing", "completed"] } })
        .sort({ updatedAt: -1 }).limit(30).lean();
      res.json(rows.map((b) => ({
        _id: b._id, code: b.code, status: b.status,
        categoryName: b.categoryName, categoryNameBangla: b.categoryNameBangla,
        kind: b.kind, offerName: b.offerName, offerNameBangla: b.offerNameBangla,
        shift: b.shift, planType: b.planType, startDate: b.startDate, durationDays: b.durationDays,
        patientName: b.patientName, patientAge: b.patientAge, patientGender: b.patientGender, conditionNote: b.conditionNote,
        district: b.district, area: b.area,
        // Exact address and phone only while the job is live.
        address: OPEN_STATUSES.includes(b.status) ? b.address : null,
        contactName: OPEN_STATUSES.includes(b.status) ? b.contactName : null,
        contactPhone: OPEN_STATUSES.includes(b.status) ? b.contactPhone : null,
        agreedPrice: b.agreedPrice, priceNote: b.priceNote,
        review: b.review?.stars ? b.review : null,
      })));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};

module.exports.OPEN_STATUSES = OPEN_STATUSES;
