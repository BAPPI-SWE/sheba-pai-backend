/**
 * Doctor directory — public, read-only endpoints.
 *
 * Deliberately built so the future public WEBSITE can use the exact same
 * endpoints as the app. Every doctor, specialty, division and district has
 * a stable URL slug, so the site can serve crawlable pages like:
 *   /doctors/neurology                 (specialty, all districts)
 *   /doctors/neurology/dhaka           (specialty + district)
 *   /doctor/dr-rahim-uddin-popular-dhanmondi   (one doctor, one chamber)
 * and GET /api/doctors/sitemap lists every one of those URLs.
 *
 * Wire into index.js:
 *   const doctorRoutes = require("./doctorRoutes");
 *   doctorRoutes(app, { auth });
 */
const Doctor = require("./models/Doctor");
const Specialty = require("./models/Specialty");
const DoctorReport = require("./models/DoctorReport");
const { GEO, resolveDistrict, resolveDivision } = require("./bdGeo");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What the list screen needs — keeps responses small on slow connections.
const LIST_FIELDS =
  "name nameBangla slug specialty degrees designation workplace gender photoUrl " +
  "chamberName district division area phones visitingDays visitingHours " +
  "newPatientFee followUpFee followUpWithinDays onlineConsultation";

module.exports = function doctorRoutes(app, deps) {
  const { auth } = deps;

  /** All 8 divisions with their districts (English, Bangla, slug). */
  app.get("/api/doctors/geo", (req, res) => {
    res.json(GEO);
  });

  /** Active specialties, each with how many active doctors it has. */
  app.get("/api/specialties", async (req, res) => {
    try {
      const [specialties, counts] = await Promise.all([
        Specialty.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean(),
        Doctor.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: "$specialty", count: { $sum: 1 } } },
        ]),
      ]);
      const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
      res.json(specialties.map((s) => ({ ...s, doctorCount: countMap[String(s._id)] || 0 })));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * Search box on the doctor home screen. Matches specialties by name,
   * Bangla name or symptom keyword ("migraine" → Neurology), and doctors
   * by name, workplace or chamber.
   */
  app.get("/api/doctors/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) return res.json({ specialties: [], doctors: [] });
      const rx = new RegExp(escapeRegex(q), "i");

      const [specialties, doctors] = await Promise.all([
        Specialty.find({
          isActive: true,
          $or: [{ name: rx }, { nameBangla: rx }, { keywords: rx }, { description: rx }, { descriptionBangla: rx }],
        }).sort({ sortOrder: 1 }).limit(8).lean(),
        Doctor.find({
          isActive: true,
          $or: [{ name: rx }, { nameBangla: rx }, { workplace: rx }, { chamberName: rx }],
        })
          .select(LIST_FIELDS)
          .populate("specialty", "name nameBangla slug")
          .sort({ priority: -1, name: 1 })
          .limit(20)
          .lean(),
      ]);
      res.json({ specialties, doctors });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * Every public URL the future website should expose, for its sitemap.
   * Only specialty+district combinations that actually have doctors are
   * listed — thin/empty pages hurt search ranking.
   */
  app.get("/api/doctors/sitemap", async (req, res) => {
    try {
      const [doctors, combos, specialties] = await Promise.all([
        Doctor.find({ isActive: true }).select("slug updatedAt").lean(),
        Doctor.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: { specialty: "$specialty", district: "$district" }, count: { $sum: 1 } } },
        ]),
        Specialty.find({ isActive: true }).select("slug").lean(),
      ]);
      const specSlug = Object.fromEntries(specialties.map((s) => [String(s._id), s.slug]));
      res.json({
        doctors: doctors.map((d) => ({ slug: d.slug, updatedAt: d.updatedAt })),
        specialties: specialties.map((s) => s.slug),
        specialtyDistricts: combos
          .filter((c) => specSlug[String(c._id.specialty)])
          .map((c) => ({
            specialty: specSlug[String(c._id.specialty)],
            district: resolveDistrict(c._id.district)?.slug,
            count: c.count,
          }))
          .filter((c) => c.district),
      });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * Paginated list. Query: specialty (slug), division, district (any
   * spelling/slug/Bangla — resolved to canonical), q, page, limit.
   */
  app.get("/api/doctors", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
      const filter = { isActive: true };

      if (req.query.specialty) {
        const spec = await Specialty.findOne({ slug: req.query.specialty }).select("_id");
        if (!spec) return res.json({ doctors: [], total: 0, page, hasMore: false });
        filter.specialty = spec._id;
      }
      if (req.query.district) {
        const d = resolveDistrict(req.query.district);
        if (!d) return res.json({ doctors: [], total: 0, page, hasMore: false });
        filter.district = d.name;
      } else if (req.query.division) {
        const dv = resolveDivision(req.query.division);
        if (!dv) return res.json({ doctors: [], total: 0, page, hasMore: false });
        filter.division = dv.name;
      }
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
        filter.$or = [{ name: rx }, { nameBangla: rx }, { workplace: rx }, { chamberName: rx }, { area: rx }];
      }

      const [doctors, total] = await Promise.all([
        Doctor.find(filter)
          .select(LIST_FIELDS)
          .populate("specialty", "name nameBangla slug")
          .sort({ priority: -1, name: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Doctor.countDocuments(filter),
      ]);
      res.json({ doctors, total, page, hasMore: page * limit < total });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** One doctor, plus the same doctor's other chambers. */
  app.get("/api/doctors/:slug", async (req, res) => {
    try {
      const doctor = await Doctor.findOne({ slug: req.params.slug, isActive: true })
        .populate("specialty", "name nameBangla slug icon tone")
        .lean();
      if (!doctor) return res.status(404).json({ error: "Doctor not found" });

      // Same person at other chambers: BMDC number is the reliable key;
      // without it, fall back to exact name + same specialty.
      const sameDoctor = doctor.bmdcNumber
        ? { bmdcNumber: doctor.bmdcNumber }
        : { name: doctor.name, specialty: doctor.specialty?._id };
      const otherChambers = await Doctor.find({ ...sameDoctor, isActive: true, _id: { $ne: doctor._id } })
        .select("slug chamberName chamberAddress district area visitingDays visitingHours newPatientFee")
        .lean();

      res.json({ ...doctor, otherChambers });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Patient reports incorrect information on a doctor's page. */
  app.post("/api/doctors/:id/report", auth, async (req, res) => {
    try {
      const { reason, note } = req.body;
      const doctor = await Doctor.findById(req.params.id).select("_id");
      if (!doctor) return res.status(404).json({ error: "Doctor not found" });

      // One open report per person per doctor — a single user tapping
      // "report" five times shouldn't look like five separate problems.
      const already = await DoctorReport.exists({ doctor: doctor._id, reportedBy: req.user.id, status: "open" });
      if (already) return res.json({ ok: true, duplicate: true });

      await new DoctorReport({ doctor: doctor._id, reason, note: String(note || "").slice(0, 500), reportedBy: req.user.id }).save();
      await Doctor.updateOne({ _id: doctor._id }, { $inc: { reportCount: 1 } });
      res.status(201).json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};