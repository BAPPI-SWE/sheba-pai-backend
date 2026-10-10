/**
 * Caregiver directory — the admin side (Admin panel → Caregivers).
 *
 *   Requests:    every booking request (app, phone, WhatsApp) in one inbox.
 *                Call the family, assign a caregiver, agree the price, move it
 *                through new → contacted → confirmed → ongoing → completed.
 *   Caregivers:  who is listed, edit their care profile, hide / feature them.
 *   Care types:  the condition-based categories families browse by.
 *
 * Wire into index.js:
 *   const careAdminRoutes = require("./careAdminRoutes");
 *   careAdminRoutes(app, { auth, adminOnly });
 */
const HelperProfile = require("./models/HelperProfile");
const CareCategory = require("./models/CareCategory");
const CareBooking = require("./models/CareBooking");
const User = require("./models/User");
const { sendPush } = require("./pushService");
const { slugify } = require("./bdGeo");
const {
  STANDARD_CATEGORIES, TIERS, escapeRegex, isId, clean,
  listedFilter, missingCareFields, isListed, applyCareFields, validateBooking, newBookingCode, recomputeCaregiverRating,
} = require("./careCommon");

const STATUSES = CareBooking.STATUSES;
const OPEN = ["new", "contacted", "confirmed", "ongoing"];

// What the family's phone says when the team moves their booking along.
const PATIENT_PUSH = {
  contacted: { title: "আপনার অনুরোধ দেখা হয়েছে", body: "সেবা পাই টিম আপনার কেয়ারগিভার অনুরোধ নিয়ে কাজ করছে।" },
  confirmed: { title: "কেয়ারগিভার নিশ্চিত হয়েছে ✅", body: "আপনার জন্য একজন কেয়ারগিভার নির্ধারণ করা হয়েছে। বিস্তারিত দেখতে অ্যাপ খুলুন।" },
  ongoing: { title: "সেবা শুরু হয়েছে", body: "আপনার কেয়ারগিভার সেবা শুরু করেছেন। কোনো সমস্যা হলে আমাদের কল করুন।" },
  completed: { title: "সেবা সম্পন্ন হয়েছে", body: "সেবা কেমন ছিল? অ্যাপে রিভিউ দিয়ে অন্য পরিবারকে সাহায্য করুন।" },
  cancelled: { title: "অনুরোধ বাতিল হয়েছে", body: "আপনার কেয়ারগিভার অনুরোধটি বাতিল করা হয়েছে। প্রশ্ন থাকলে আমাদের কল করুন।" },
};

function adminCaregiverRow(p) {
  const care = p.care || {};
  return {
    profileId: p._id,
    userId: p.user?._id,
    name: p.user?.name || "",
    phone: p.user?.phone || "",
    verificationStatus: p.verificationStatus,
    hasCertificate: (p.certificateUrls || []).length > 0,
    hasPoliceClearance: !!p.policeClearanceUrl,
    ratingAvg: p.ratingAvg || 0,
    ratingCount: p.ratingCount || 0,
    listed: isListed(p),
    missing: missingCareFields(care),
    care: { ...care, categories: (care.categories || []).map((c) => (c && c._id ? { _id: c._id, name: c.name, nameBangla: c.nameBangla } : c)) },
  };
}

module.exports = function careAdminRoutes(app, deps) {
  const { auth, adminOnly } = deps;
  const guard = [auth, adminOnly];

  /* ================================ REQUESTS ================================ */

  app.get("/api/admin/care/bookings/counts", ...guard, async (req, res) => {
    try {
      const rows = await CareBooking.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
      const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      rows.forEach((r) => { counts[r._id] = r.n; });
      counts.open = OPEN.reduce((a, s) => a + counts[s], 0);
      res.json(counts);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/admin/care/bookings?status=new|open|...|all&q=&district=&page= */
  app.get("/api/admin/care/bookings", ...guard, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = 30;
      const filter = {};
      const st = req.query.status || "open";
      if (st === "open") filter.status = { $in: OPEN };
      else if (STATUSES.includes(st)) filter.status = st;
      if (req.query.district) filter.district = req.query.district;
      const q = String(req.query.q || "").trim();
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        const digits = q.replace(/\D/g, "");
        filter.$or = [{ code: rx }, { contactName: rx }, { patientName: rx }, { area: rx }];
        if (digits.length >= 3) filter.$or.push({ contactPhone: new RegExp(escapeRegex(digits.replace(/^880?/, "0").replace(/^00/, "0"))) });
      }
      const [rows, total] = await Promise.all([
        CareBooking.find(filter)
          .populate("assignedCaregiver", "name phone")
          .populate("requestedCaregiver", "name phone")
          .populate("patient", "name phone")
          .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        CareBooking.countDocuments(filter),
      ]);
      res.json({ bookings: rows, total, page, hasMore: page * limit < total });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** A booking taken over the phone / WhatsApp. Linked to the family's account when the number matches. */
  app.post("/api/admin/care/bookings", ...guard, async (req, res) => {
    try {
      const v = await validateBooking(req.body);
      if (v.error) return res.status(400).json({ error: v.error });
      const source = ["phone", "whatsapp", "admin"].includes(req.body.source) ? req.body.source : "phone";
      const patient = await User.findOne({ role: "patient", phone: v.fields.contactPhone, isDeleted: { $ne: true } }).select("_id").lean();
      const booking = await new CareBooking({
        ...v.fields,
        code: await newBookingCode(),
        patient: patient?._id || null,
        source,
        status: "new",
        adminNotes: clean(req.body.adminNotes, 2000),
        history: [{ status: "new", by: "admin", note: `Recorded by admin (${source})` }],
      }).save();
      res.status(201).json(booking);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/admin/care/bookings/:id", ...guard, async (req, res) => {
    try {
      const b = await CareBooking.findById(req.params.id);
      if (!b) return res.status(404).json({ error: "Booking not found" });
      const body = req.body || {};
      const prevStatus = b.status;
      const prevCaregiver = b.assignedCaregiver ? String(b.assignedCaregiver) : null;

      // Editable request details (the family often corrects things on the call).
      const detailKeys = ["contactName", "contactPhone", "district", "area", "address", "shift", "planType", "startDate",
        "durationDays", "patientName", "patientAge", "patientGender", "conditionNote", "preferredGender", "note", "category"];
      if (detailKeys.some((k) => body[k] !== undefined)) {
        const merged = { ...b.toObject(), ...body, caregiverCode: undefined };
        if (merged.category && merged.category._id) merged.category = merged.category._id;
        const v = await validateBooking({ ...merged, startDate: body.startDate !== undefined ? body.startDate : null });
        if (v.error) return res.status(400).json({ error: v.error });
        const f = v.fields;
        for (const k of detailKeys.filter((k) => k !== "category")) if (body[k] !== undefined) b[k] = f[k];
        if (body.district !== undefined) b.division = f.division;
        if (body.category !== undefined) { b.category = f.category; b.categoryName = f.categoryName; b.categoryNameBangla = f.categoryNameBangla; }
      }

      if (body.assignedCaregiver !== undefined) {
        if (body.assignedCaregiver === null || body.assignedCaregiver === "") b.assignedCaregiver = null;
        else {
          if (!isId(body.assignedCaregiver)) return res.status(400).json({ error: "Unknown caregiver" });
          const p = await HelperProfile.findOne({ user: body.assignedCaregiver, verificationStatus: "approved" }).lean();
          if (!p) return res.status(400).json({ error: "This caregiver is not verified" });
          b.assignedCaregiver = body.assignedCaregiver;
        }
      }
      if (body.agreedPrice !== undefined) {
        if (body.agreedPrice === null || body.agreedPrice === "") b.agreedPrice = null;
        else {
          const n = Math.round(Number(body.agreedPrice));
          if (!Number.isFinite(n) || n < 0 || n > 10000000) return res.status(400).json({ error: "Price must be a number in taka" });
          b.agreedPrice = n;
        }
      }
      if (body.priceNote !== undefined) b.priceNote = clean(body.priceNote, 120);
      if (body.adminNotes !== undefined) b.adminNotes = clean(body.adminNotes, 4000);

      if (body.status !== undefined && body.status !== b.status) {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ error: "Unknown status" });
        if (["confirmed", "ongoing", "completed"].includes(body.status) && !b.assignedCaregiver) {
          return res.status(400).json({ error: "Assign a caregiver first" });
        }
        b.status = body.status;
        if (body.status === "cancelled") {
          b.cancelledBy = "admin";
          b.cancelReason = clean(body.cancelReason, 300) || b.cancelReason;
        }
        b.history.push({ status: body.status, by: "admin", note: clean(body.statusNote, 300) });
      }
      await b.save();

      // Completed-jobs counter on the caregiver's profile.
      const nowCaregiver = b.assignedCaregiver ? String(b.assignedCaregiver) : null;
      if (prevStatus !== "completed" && b.status === "completed" && nowCaregiver) {
        await HelperProfile.updateOne({ user: nowCaregiver }, { $inc: { "care.completedBookings": 1 } });
      } else if (prevStatus === "completed" && b.status !== "completed" && prevCaregiver) {
        await HelperProfile.updateOne({ user: prevCaregiver, "care.completedBookings": { $gt: 0 } }, { $inc: { "care.completedBookings": -1 } });
      }
      // A review already given follows the booking if the caregiver is changed.
      if (b.review?.stars && prevCaregiver !== nowCaregiver) {
        if (prevCaregiver) await recomputeCaregiverRating(prevCaregiver);
        if (nowCaregiver) await recomputeCaregiverRating(nowCaregiver);
      }

      // Notifications — never block the response.
      if (b.patient && prevStatus !== b.status && PATIENT_PUSH[b.status]) {
        sendPush([b.patient], { ...PATIENT_PUSH[b.status], data: { type: "care_booking", bookingId: String(b._id) } });
      }
      if (nowCaregiver && nowCaregiver !== prevCaregiver && ["contacted", "confirmed", "ongoing"].includes(b.status)) {
        sendPush([nowCaregiver], {
          title: "নতুন কাজ নির্ধারিত হয়েছে",
          body: `${b.categoryNameBangla || "কেয়ারগিভার সেবা"} — ${b.area ? b.area + ", " : ""}${b.district}`,
          data: { type: "care_assignment", bookingId: String(b._id) },
        });
      }

      const out = await CareBooking.findById(b._id)
        .populate("assignedCaregiver", "name phone").populate("requestedCaregiver", "name phone").populate("patient", "name phone").lean();
      res.json(out);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* ================================ CAREGIVERS ================================ */

  /** GET /api/admin/care/caregivers?status=listed|incomplete|hidden|pending|all&q=&district=&category=&page= */
  app.get("/api/admin/care/caregivers", ...guard, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, parseInt(req.query.limit) || 30);
      const status = req.query.status || "listed";
      let filter;
      if (status === "listed") filter = listedFilter();
      else if (status === "hidden") filter = { verificationStatus: "approved", "care.adminHidden": true };
      else if (status === "pending") filter = { verificationStatus: "pending" };
      else if (status === "incomplete") {
        filter = {
          verificationStatus: "approved", "care.adminHidden": { $ne: true },
          $or: [{ "care.gender": { $nin: ["female", "male"] } }, { "care.districts.0": { $exists: false } },
            { "care.categories.0": { $exists: false } }, { "care.shifts.0": { $exists: false } }, { "care.code": { $not: { $type: "string" } } }],
        };
      } else filter = { verificationStatus: { $in: ["approved", "pending"] } };

      if (req.query.district) filter["care.districts"] = req.query.district;
      if (isId(req.query.category)) filter["care.categories"] = req.query.category;
      const q = String(req.query.q || "").trim();
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        const users = await User.find({ role: "helper", $or: [{ name: rx }, { phone: rx }] }).select("_id").limit(300).lean();
        const or = [{ "care.code": rx }, { user: { $in: users.map((u) => u._id) } }];
        filter = filter.$or ? { $and: [filter, { $or: or }] } : { ...filter, $or: or };
      }

      const [rows, total] = await Promise.all([
        HelperProfile.find(filter).populate("user", "name phone").populate("care.categories", "name nameBangla")
          .sort({ "care.featured": -1, ratingAvg: -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        HelperProfile.countDocuments(filter),
      ]);
      res.json({ caregivers: rows.map(adminCaregiverRow), total, page, hasMore: page * limit < total });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Edit a caregiver's care profile, or hide / feature them. Keyed by the caregiver's USER id. */
  app.patch("/api/admin/care/caregivers/:userId", ...guard, async (req, res) => {
    try {
      if (!isId(req.params.userId)) return res.status(404).json({ error: "Caregiver not found" });
      const profile = await HelperProfile.findOne({ user: req.params.userId });
      if (!profile) return res.status(404).json({ error: "Caregiver not found" });
      const error = await applyCareFields(profile, req.body, { asAdmin: true });
      if (error) return res.status(400).json({ error });
      await profile.save();
      const p = await HelperProfile.findById(profile._id).populate("user", "name phone").populate("care.categories", "name nameBangla").lean();
      res.json(adminCaregiverRow(p));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* ================================ CARE TYPES ================================ */

  app.get("/api/admin/care/categories", ...guard, async (req, res) => {
    try {
      const [cats, counts] = await Promise.all([
        CareCategory.find().sort({ sortOrder: 1, name: 1 }).lean(),
        HelperProfile.aggregate([{ $match: listedFilter() }, { $unwind: "$care.categories" }, { $group: { _id: "$care.categories", n: { $sum: 1 } } }]),
      ]);
      const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
      res.json(cats.map((c) => ({ ...c, caregiverCount: map[String(c._id)] || 0 })));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  function categoryFields(body, existing) {
    const out = {};
    if (body.name !== undefined) { out.name = clean(body.name, 120); if (!out.name) throw new Error("English name is required"); }
    if (body.nameBangla !== undefined) { out.nameBangla = clean(body.nameBangla, 160); if (!out.nameBangla) throw new Error("Bangla name is required"); }
    if (body.iconKey !== undefined) out.iconKey = clean(body.iconKey, 40) || "general";
    if (body.description !== undefined) out.description = clean(body.description, 400);
    if (body.descriptionBangla !== undefined) out.descriptionBangla = clean(body.descriptionBangla, 400);
    if (body.fromPrice !== undefined) {
      if (body.fromPrice === null || body.fromPrice === "") out.fromPrice = null;
      else {
        const n = Math.round(Number(body.fromPrice));
        if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new Error("Price must be a number in taka");
        out.fromPrice = n;
      }
    }
    if (body.priceUnit !== undefined) {
      if (!["day8", "shift12", "live24", "month", "visit"].includes(body.priceUnit)) throw new Error("Unknown price unit");
      out.priceUnit = body.priceUnit;
    }
    if (body.minTier !== undefined) {
      if (!TIERS.includes(body.minTier)) throw new Error("Unknown caregiver level");
      out.minTier = body.minTier;
    }
    if (body.keywords !== undefined) {
      const list = Array.isArray(body.keywords) ? body.keywords : String(body.keywords || "").split(",");
      out.keywords = list.map((k) => String(k).trim()).filter(Boolean).slice(0, 30);
    }
    if (body.sortOrder !== undefined) out.sortOrder = Number(body.sortOrder) || 0;
    if (body.isActive !== undefined) out.isActive = !!body.isActive;
    if (!existing && !out.slug) out.slug = slugify(body.slug || out.name || "");
    return out;
  }

  app.post("/api/admin/care/categories", ...guard, async (req, res) => {
    try {
      const f = categoryFields(req.body, null);
      if (!f.name || !f.nameBangla) return res.status(400).json({ error: "English and Bangla names are required" });
      if (!f.slug) return res.status(400).json({ error: "Please use English letters in the English name" });
      if (await CareCategory.exists({ slug: f.slug })) return res.status(409).json({ error: "A care type with this name already exists" });
      res.status(201).json(await new CareCategory(f).save());
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/admin/care/categories/:id", ...guard, async (req, res) => {
    try {
      const c = await CareCategory.findById(req.params.id);
      if (!c) return res.status(404).json({ error: "Care type not found" });
      Object.assign(c, categoryFields(req.body, c));
      await c.save();
      res.json(c);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/admin/care/categories/:id", ...guard, async (req, res) => {
    try {
      const used = await HelperProfile.countDocuments({ "care.categories": req.params.id });
      if (used > 0) {
        return res.status(409).json({ error: `${used} caregiver(s) offer this care type. Hide it instead (untick "Shown in app") so their profiles stay intact.` });
      }
      await CareCategory.deleteOne({ _id: req.params.id });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Adds any of the standard condition-based care types that don't exist yet. Never overwrites edits. */
  app.post("/api/admin/care/categories/seed", ...guard, async (req, res) => {
    try {
      let added = 0;
      for (const [i, c] of STANDARD_CATEGORIES.entries()) {
        if (await CareCategory.exists({ slug: c.slug })) continue;
        await new CareCategory({ ...c, sortOrder: (i + 1) * 10 }).save();
        added++;
      }
      res.json({ added, total: await CareCategory.countDocuments() });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};

