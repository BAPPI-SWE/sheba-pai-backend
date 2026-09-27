/**
 * Doctor directory — admin endpoints.
 *
 *   Specialties: CRUD, image upload, one-click default list
 *   Doctors:     list/search, create, edit, activate/deactivate, delete
 *   Import:      template → preview (validates, saves nothing) → commit
 *   Reports:     "incorrect info" queue from patients
 *
 * Wire into index.js:
 *   const doctorAdminRoutes = require("./doctorAdminRoutes");
 *   doctorAdminRoutes(app, { auth, adminOnly, upload, uploadToCloudinary });
 */
const XLSX = require("xlsx");
const Doctor = require("./models/Doctor");
const Specialty = require("./models/Specialty");
const DoctorReport = require("./models/DoctorReport");
const { GEO, resolveDistrict, resolveDivision, slugify } = require("./bdGeo");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------------ */
/* Default specialties — a sensible starting set for Bangladesh, with  */
/* Bangla names and the symptom words patients actually search for.   */
/* ------------------------------------------------------------------ */
const DEFAULT_SPECIALTIES = [
  ["Medicine", "মেডিসিন", "Fever, diabetes, blood pressure", "জ্বর, ডায়াবেটিস, প্রেশার", "medkit", "primary",
    ["fever", "জ্বর", "diabetes", "ডায়াবেটিস", "blood pressure", "প্রেশার", "general physician", "weakness", "দুর্বলতা"]],
  ["Cardiology", "হৃদরোগ", "Heart disease, chest pain", "হার্টের রোগ, বুকে ব্যথা", "heart", "accent",
    ["heart", "হার্ট", "হৃদরোগ", "chest pain", "বুকে ব্যথা", "palpitation", "বুক ধড়ফড়"]],
  ["Neurology", "নিউরোলজি", "Headache, migraine, stroke, seizures", "মাথাব্যথা, মাইগ্রেন, স্ট্রোক, খিঁচুনি", "pulse", "helper",
    ["migraine", "মাইগ্রেন", "headache", "মাথাব্যথা", "stroke", "স্ট্রোক", "epilepsy", "খিঁচুনি", "nerve", "স্নায়ু", "paralysis"]],
  ["Gynecology & Obstetrics", "গাইনি ও প্রসূতি", "Pregnancy, women's health", "গর্ভাবস্থা, নারী স্বাস্থ্য", "female", "accent",
    ["pregnancy", "গর্ভাবস্থা", "period", "মাসিক", "gynae", "গাইনি", "delivery", "প্রসূতি"]],
  ["Pediatrics", "শিশু রোগ", "Children's health", "শিশুদের স্বাস্থ্য", "happy", "warning",
    ["child", "শিশু", "baby", "বাচ্চা", "newborn", "নবজাতক"]],
  ["Orthopedics", "অর্থোপেডিক্স", "Bones, joints, back pain", "হাড়, জয়েন্ট, কোমর ব্যথা", "body", "helper",
    ["bone", "হাড়", "joint pain", "জয়েন্ট", "back pain", "কোমর ব্যথা", "fracture", "হাড় ভাঙা", "knee", "হাঁটু"]],
  ["Dermatology", "চর্ম ও যৌন", "Skin, hair, allergy", "চর্ম, চুল, এলার্জি", "hand-left", "success",
    ["skin", "চর্ম", "চামড়া", "hair fall", "চুল পড়া", "allergy", "এলার্জি", "acne", "ব্রণ", "itching", "চুলকানি"]],
  ["ENT", "নাক, কান ও গলা", "Ear, nose, throat, sinus", "নাক, কান, গলা, সাইনাস", "ear", "primary",
    ["ear", "কান", "nose", "নাক", "throat", "গলা", "sinus", "সাইনাস", "tonsil", "টনসিল"]],
  ["Ophthalmology", "চক্ষু", "Eye problems", "চোখের সমস্যা", "eye", "primary",
    ["eye", "চোখ", "vision", "দৃষ্টি", "cataract", "ছানি"]],
  ["Gastroenterology", "পেট ও লিভার", "Stomach, gastric, liver", "পেট, গ্যাস্ট্রিক, লিভার", "nutrition", "warning",
    ["gastric", "গ্যাস্ট্রিক", "stomach", "পেট ব্যথা", "liver", "লিভার", "jaundice", "জন্ডিস", "ulcer", "আলসার"]],
  ["Nephrology", "কিডনি রোগ", "Kidney disease", "কিডনির রোগ", "water", "helper",
    ["kidney", "কিডনি", "dialysis", "ডায়ালাইসিস", "creatinine"]],
  ["Urology", "ইউরোলজি", "Urinary problems, stones", "প্রস্রাবের সমস্যা, পাথর", "beaker", "helper",
    ["urine", "প্রস্রাব", "stone", "পাথর", "prostate", "প্রোস্টেট"]],
  ["Psychiatry", "মানসিক রোগ", "Depression, anxiety, sleep", "বিষণ্ণতা, দুশ্চিন্তা, ঘুম", "chatbubbles", "success",
    ["depression", "বিষণ্ণতা", "anxiety", "দুশ্চিন্তা", "sleep", "ঘুম", "mental", "মানসিক"]],
  ["Chest & Respiratory", "বক্ষব্যাধি", "Asthma, cough, breathing", "হাঁপানি, কাশি, শ্বাসকষ্ট", "leaf", "primary",
    ["asthma", "হাঁপানি", "cough", "কাশি", "breathing", "শ্বাসকষ্ট", "lung", "ফুসফুস", "tb", "যক্ষ্মা"]],
  ["Endocrinology", "হরমোন ও ডায়াবেটিস", "Diabetes, thyroid, hormones", "ডায়াবেটিস, থাইরয়েড, হরমোন", "flask", "warning",
    ["diabetes", "ডায়াবেটিস", "thyroid", "থাইরয়েড", "hormone", "হরমোন"]],
  ["Oncology", "ক্যান্সার", "Cancer care", "ক্যান্সার চিকিৎসা", "ribbon", "accent",
    ["cancer", "ক্যান্সার", "tumor", "টিউমার", "chemotherapy", "কেমোথেরাপি"]],
  ["Dentistry", "দন্ত", "Teeth and gums", "দাঁত ও মাড়ি", "sparkles", "success",
    ["teeth", "দাঁত", "tooth pain", "দাঁত ব্যথা", "gum", "মাড়ি", "dental"]],
  ["General Surgery", "জেনারেল সার্জারি", "Operations, hernia, appendix", "অপারেশন, হার্নিয়া, অ্যাপেন্ডিক্স", "cut", "helper",
    ["surgery", "অপারেশন", "hernia", "হার্নিয়া", "appendix", "অ্যাপেন্ডিক্স", "piles", "পাইলস"]],
  ["Rheumatology", "বাত রোগ", "Arthritis, joint inflammation", "বাত, জয়েন্টে প্রদাহ", "walk", "warning",
    ["arthritis", "বাত", "gout", "গেঁটে বাত", "joint swelling"]],
  ["Physical Medicine", "ফিজিক্যাল মেডিসিন", "Physiotherapy, rehabilitation", "ফিজিওথেরাপি, পুনর্বাসন", "accessibility", "success",
    ["physiotherapy", "ফিজিওথেরাপি", "paralysis", "প্যারালাইসিস", "neck pain", "ঘাড় ব্যথা"]],
];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
async function uniqueSlug(Model, base, excludeId) {
  const root = slugify(base) || "item";
  let candidate = root, n = 2;
  while (await Model.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    candidate = `${root}-${n++}`;
  }
  return candidate;
}

function truthy(v) {
  return ["true", "yes", "1", "y", "হ্যাঁ"].includes(String(v || "").trim().toLowerCase());
}

/**
 * Split "01711-223344, 01811223344 / 02-9661234" into clean numbers.
 * Also repairs the classic Excel mistake: a mobile number typed into a
 * NUMBER cell loses its leading zero (01712345678 → 1712345678).
 */
function parsePhones(raw) {
  return String(raw || "")
    .split(/[,/;|\n]+/)
    .map((p) => p.replace(/[^\d+]/g, ""))
    .map((p) => (/^1\d{9}$/.test(p) ? "0" + p : p))
    .filter(Boolean);
}
function validPhone(p) {
  const digits = p.replace(/\D/g, "");
  return digits.length >= 5 && digits.length <= 15;
}

function parseGender(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["male", "m", "পুরুষ"].includes(s)) return "male";
  if (["female", "f", "মহিলা", "নারী"].includes(s)) return "female";
  return "";
}

function optionalNumber(v) {
  if (v === "" || v === null || v === undefined) return { value: null, ok: true };
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return isNaN(n) || n < 0 ? { value: null, ok: false } : { value: n, ok: true };
}

/**
 * Shared validation for the Excel import AND the admin form, so both
 * enforce exactly the same rules. Never touches the database except to
 * look up the specialty (via the passed-in cache).
 */
function validateDoctorInput(get, specialtyLookup) {
  const errors = [];
  const name = get("name");
  if (!name) errors.push("name is required");

  const specialtyText = get("specialty");
  const specialty = specialtyText ? specialtyLookup(specialtyText) : null;
  if (!specialtyText) errors.push("specialty is required");
  else if (!specialty) errors.push(`specialty "${specialtyText}" not found — add it in the Specialties tab first`);

  const districtText = get("district");
  const district = districtText ? resolveDistrict(districtText) : null;
  if (!districtText) errors.push("district is required");
  else if (!district) errors.push(`district "${districtText}" is not a Bangladesh district — check the spelling`);

  // Division is optional (filled from the district), but if it's given
  // it must agree — catches rows where a column got shifted.
  const divisionText = get("division");
  if (divisionText && district) {
    const dv = resolveDivision(divisionText);
    if (!dv) errors.push(`division "${divisionText}" is not recognized`);
    else if (dv.name !== district.division) errors.push(`${district.name} is in ${district.division} division, not ${dv.name}`);
  }

  const phones = parsePhones(get("phones"));
  if (phones.length === 0) errors.push("at least one appointment phone number is required");
  phones.filter((p) => !validPhone(p)).forEach((p) => errors.push(`phone "${p}" doesn't look valid`));

  const newFee = optionalNumber(get("newPatientFee"));
  const followFee = optionalNumber(get("followUpFee"));
  const followDays = optionalNumber(get("followUpWithinDays"));
  if (!newFee.ok) errors.push("newPatientFee must be a number");
  if (!followFee.ok) errors.push("followUpFee must be a number");
  if (!followDays.ok) errors.push("followUpWithinDays must be a number of days");
  if (followFee.value != null && followDays.value == null) {
    errors.push("followUpWithinDays is required when followUpFee is set (e.g. 14)");
  }
  if (newFee.value != null && followFee.value != null && followFee.value > newFee.value) {
    errors.push("followUpFee is higher than newPatientFee — are the two columns swapped?");
  }

  return {
    errors,
    resolved: {
      name,
      nameBangla: get("nameBangla"),
      specialty: specialty?._id,
      specialtyName: specialty?.name,
      degrees: get("degrees"),
      designation: get("designation"),
      workplace: get("workplace"),
      gender: parseGender(get("gender")),
      bmdcNumber: get("bmdcNumber"),
      photoUrl: get("photoUrl") || null,
      chamberName: get("chamberName"),
      chamberAddress: get("chamberAddress"),
      division: district?.division,
      district: district?.name,
      area: get("area"),
      phones,
      visitingDays: get("visitingDays"),
      visitingHours: get("visitingHours"),
      newPatientFee: newFee.value,
      followUpFee: followFee.value,
      followUpWithinDays: followDays.value,
      onlineConsultation: truthy(get("onlineConsultation")),
    },
  };
}

/** Case-insensitive specialty lookup by name, Bangla name or slug. */
async function buildSpecialtyLookup() {
  const all = await Specialty.find().select("_id name nameBangla slug").lean();
  const map = {};
  all.forEach((s) => [s.name, s.nameBangla, s.slug].filter(Boolean).forEach((k) => { map[k.trim().toLowerCase()] = s; }));
  return (text) => map[String(text).trim().toLowerCase()] || null;
}

/** Existing-record match for import updates: same person, same chamber. */
function sameChamberQuery(r) {
  const chamber = { chamberName: r.chamberName, district: r.district };
  return r.bmdcNumber
    ? { bmdcNumber: r.bmdcNumber, ...chamber }
    : { name: r.name, specialty: r.specialty, ...chamber };
}

const doctorSlugBase = (r) => `${r.name} ${r.chamberName || r.workplace || ""} ${r.district}`;

const TEMPLATE_COLUMNS = [
  "name", "nameBangla", "specialty", "degrees", "designation", "workplace", "gender", "bmdcNumber",
  "chamberName", "chamberAddress", "division", "district", "area", "phones",
  "visitingDays", "visitingHours", "newPatientFee", "followUpFee", "followUpWithinDays",
  "onlineConsultation", "photoUrl",
];

module.exports = function doctorAdminRoutes(app, deps) {
  const { auth, adminOnly, upload, uploadToCloudinary } = deps;

  /* ============================ SPECIALTIES ============================ */

  app.get("/api/admin/specialties", auth, adminOnly, async (req, res) => {
    try {
      const [list, counts] = await Promise.all([
        Specialty.find().sort({ sortOrder: 1, name: 1 }).lean(),
        Doctor.aggregate([{ $group: { _id: "$specialty", count: { $sum: 1 } } }]),
      ]);
      const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
      res.json(list.map((s) => ({ ...s, doctorCount: countMap[String(s._id)] || 0 })));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  function specialtyBody(b) {
    return {
      name: String(b.name || "").trim(),
      nameBangla: String(b.nameBangla || "").trim(),
      description: String(b.description || "").trim(),
      descriptionBangla: String(b.descriptionBangla || "").trim(),
      keywords: (Array.isArray(b.keywords) ? b.keywords : String(b.keywords || "").split(","))
        .map((k) => String(k).trim().toLowerCase()).filter(Boolean),
      icon: b.icon || "medkit",
      tone: b.tone || "helper",
      sortOrder: Number(b.sortOrder) || 0,
      isActive: b.isActive !== false,
    };
  }

  app.post("/api/admin/specialties", auth, adminOnly, async (req, res) => {
    try {
      const body = specialtyBody(req.body);
      if (!body.name) return res.status(400).json({ error: "Name is required" });
      const saved = await new Specialty({ ...body, slug: await uniqueSlug(Specialty, body.name) }).save();
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err.code === 11000 ? "A specialty with that name already exists" : err.message });
    }
  });

  app.put("/api/admin/specialties/:id", auth, adminOnly, async (req, res) => {
    try {
      const body = specialtyBody(req.body);
      if (!body.name) return res.status(400).json({ error: "Name is required" });
      // The slug is deliberately NOT regenerated on rename: it's a public
      // URL, and changing it would break links and search rankings.
      const saved = await Specialty.findByIdAndUpdate(req.params.id, body, { new: true });
      if (!saved) return res.status(404).json({ error: "Specialty not found" });
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err.code === 11000 ? "A specialty with that name already exists" : err.message });
    }
  });

  app.delete("/api/admin/specialties/:id", auth, adminOnly, async (req, res) => {
    try {
      const inUse = await Doctor.countDocuments({ specialty: req.params.id });
      if (inUse > 0) {
        return res.status(400).json({ error: `${inUse} doctor(s) use this specialty — move or delete them first, or just deactivate it` });
      }
      await Specialty.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post("/api/admin/specialties/:id/image", auth, adminOnly, upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image uploaded" });
      const imageUrl = await uploadToCloudinary(req.file.buffer, "specialties");
      const saved = await Specialty.findByIdAndUpdate(req.params.id, { imageUrl }, { new: true });
      res.json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/admin/specialties/:id/image", auth, adminOnly, async (req, res) => {
    try {
      const saved = await Specialty.findByIdAndUpdate(req.params.id, { imageUrl: null }, { new: true });
      res.json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Adds any of the standard specialties that don't exist yet. Safe to re-run. */
  app.post("/api/admin/specialties/seed-defaults", auth, adminOnly, async (req, res) => {
    try {
      let created = 0;
      for (let i = 0; i < DEFAULT_SPECIALTIES.length; i++) {
        const [name, nameBangla, description, descriptionBangla, icon, tone, keywords] = DEFAULT_SPECIALTIES[i];
        const exists = await Specialty.exists({ name: new RegExp(`^${escapeRegex(name)}$`, "i") });
        if (exists) continue;
        await new Specialty({
          name, nameBangla, description, descriptionBangla, icon, tone, keywords,
          sortOrder: (i + 1) * 10, slug: await uniqueSlug(Specialty, name),
        }).save();
        created++;
      }
      res.json({ created, skipped: DEFAULT_SPECIALTIES.length - created });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* ============================== DOCTORS ============================== */

  app.get("/api/admin/doctors", auth, adminOnly, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = 30;
      const filter = {};
      if (req.query.specialty) filter.specialty = req.query.specialty;
      if (req.query.district) {
        const d = resolveDistrict(req.query.district);
        if (d) filter.district = d.name;
      }
      if (req.query.status === "active") filter.isActive = true;
      if (req.query.status === "inactive") filter.isActive = false;
      if (req.query.status === "reported") filter.reportCount = { $gt: 0 };
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
        filter.$or = [{ name: rx }, { nameBangla: rx }, { chamberName: rx }, { workplace: rx }, { bmdcNumber: rx }, { phones: rx }];
      }
      const [doctors, total] = await Promise.all([
        Doctor.find(filter).populate("specialty", "name").sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Doctor.countDocuments(filter),
      ]);
      res.json({ doctors, total, page, hasMore: page * limit < total });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** The admin form sends the same field names as the Excel columns. */
  async function validateForm(body) {
    const lookup = await buildSpecialtyLookup();
    const get = (k) => {
      const v = body[k];
      if (k === "phones" && Array.isArray(v)) return v.join(",");
      return v === undefined || v === null ? "" : String(v).trim();
    };
    return validateDoctorInput(get, lookup);
  }

  app.post("/api/admin/doctors", auth, adminOnly, async (req, res) => {
    try {
      const { errors, resolved } = await validateForm(req.body);
      if (errors.length) return res.status(400).json({ error: errors.join("; ") });
      delete resolved.specialtyName;
      const saved = await new Doctor({
        ...resolved,
        priority: Number(req.body.priority) || 0,
        slug: await uniqueSlug(Doctor, doctorSlugBase(resolved)),
      }).save();
      res.status(201).json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.put("/api/admin/doctors/:id", auth, adminOnly, async (req, res) => {
    try {
      const { errors, resolved } = await validateForm(req.body);
      if (errors.length) return res.status(400).json({ error: errors.join("; ") });
      delete resolved.specialtyName;
      // Slug kept stable on edit — it's a public URL.
      const saved = await Doctor.findByIdAndUpdate(
        req.params.id,
        { ...resolved, priority: Number(req.body.priority) || 0, isActive: req.body.isActive !== false },
        { new: true }
      );
      if (!saved) return res.status(404).json({ error: "Doctor not found" });
      res.json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/admin/doctors/:id/active", auth, adminOnly, async (req, res) => {
    try {
      const saved = await Doctor.findByIdAndUpdate(req.params.id, { isActive: !!req.body.isActive }, { new: true });
      if (!saved) return res.status(404).json({ error: "Doctor not found" });
      res.json(saved);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete("/api/admin/doctors/:id", auth, adminOnly, async (req, res) => {
    try {
      await Doctor.findByIdAndDelete(req.params.id);
      await DoctorReport.deleteMany({ doctor: req.params.id });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* =============================== IMPORT =============================== */

  /**
   * Template with three sheets: the doctor sheet to fill in, plus the
   * exact current specialty names and all 64 districts — so the data
   * team copies valid values instead of guessing spellings.
   */
  app.get("/api/admin/doctors/import/template", auth, adminOnly, async (req, res) => {
    try {
      const example = {
        name: "Dr. Rahim Uddin", nameBangla: "ডা. রহিম উদ্দিন", specialty: "Neurology",
        degrees: "MBBS, FCPS (Medicine), MD (Neurology)", designation: "Associate Professor",
        workplace: "Dhaka Medical College Hospital", gender: "male", bmdcNumber: "A-12345",
        chamberName: "Popular Diagnostic Centre", chamberAddress: "House 16, Road 2, Dhanmondi",
        division: "Dhaka", district: "Dhaka", area: "Dhanmondi", phones: "01711000000, 09613787801",
        visitingDays: "Sat–Wed", visitingHours: "5 PM – 9 PM",
        newPatientFee: 1000, followUpFee: 500, followUpWithinDays: 14,
        onlineConsultation: "no", photoUrl: "",
      };
      const doctorsSheet = XLSX.utils.json_to_sheet([example], { header: TEMPLATE_COLUMNS });
      // Force the phones column to text so Excel doesn't strip leading zeros.
      const phoneCol = XLSX.utils.encode_col(TEMPLATE_COLUMNS.indexOf("phones"));
      if (doctorsSheet[`${phoneCol}2`]) doctorsSheet[`${phoneCol}2`].t = "s";

      const specialties = await Specialty.find().sort({ sortOrder: 1, name: 1 }).select("name nameBangla").lean();
      const specSheet = XLSX.utils.json_to_sheet(
        specialties.length ? specialties.map((s) => ({ specialty: s.name, bangla: s.nameBangla })) : [{ specialty: "(add specialties in the admin panel first)", bangla: "" }]
      );
      const geoSheet = XLSX.utils.json_to_sheet(
        GEO.flatMap((dv) => dv.districts.map((d) => ({ division: dv.name, district: d.name, districtBangla: d.bn })))
      );

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, doctorsSheet, "Doctors");
      XLSX.utils.book_append_sheet(wb, specSheet, "Specialties (valid values)");
      XLSX.utils.book_append_sheet(wb, geoSheet, "Districts (valid values)");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", "attachment; filename=doctor_import_template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Parse + validate every row of the FIRST sheet. Saves nothing. */
  app.post("/api/admin/doctors/import/preview", auth, adminOnly, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
      if (rows.length === 0) return res.status(400).json({ error: "The spreadsheet has no data rows" });
      if (rows.length > 3000) return res.status(400).json({ error: "Please import at most 3000 rows at a time" });

      const lookup = await buildSpecialtyLookup();
      const seen = new Set();
      const valid = [], invalid = [];

      rows.forEach((raw, i) => {
        const rowNum = i + 2; // header row + 1-indexed
        const get = (k) => (raw[k] !== undefined && raw[k] !== null ? String(raw[k]).trim() : "");
        const { errors, resolved } = validateDoctorInput(get, lookup);

        // Same doctor + same chamber twice in one file is almost always a
        // copy-paste mistake — flag the second occurrence.
        const key = [resolved.bmdcNumber || resolved.name, resolved.chamberName, resolved.district].join("|").toLowerCase();
        if (!errors.length && seen.has(key)) errors.push("duplicate of an earlier row (same doctor, chamber and district)");
        seen.add(key);

        if (errors.length) invalid.push({ rowNum, name: get("name"), errors });
        else valid.push({ rowNum, ...resolved });
      });

      res.json({ totalRows: rows.length, validCount: valid.length, invalidCount: invalid.length, valid, invalid });
    } catch (err) {
      res.status(400).json({ error: "Could not read that file — is it a valid .xlsx or .csv? (" + err.message + ")" });
    }
  });

  /**
   * Save ALREADY-VALIDATED rows from /preview. A row matching an existing
   * doctor at the same chamber updates that record (so re-importing a
   * corrected sheet fixes data instead of creating duplicates).
   */
  app.post("/api/admin/doctors/import/commit", auth, adminOnly, async (req, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows to import" });

      let created = 0, updated = 0;
      const errors = [];
      for (const row of rows) {
        try {
          const { rowNum, specialtyName, ...data } = row;
          const existing = await Doctor.findOne(sameChamberQuery(data));
          if (existing) {
            Object.assign(existing, data, { isActive: true });
            await existing.save();
            updated++;
          } else {
            await new Doctor({ ...data, slug: await uniqueSlug(Doctor, doctorSlugBase(data)) }).save();
            created++;
          }
        } catch (rowErr) {
          errors.push({ rowNum: row.rowNum, name: row.name, error: rowErr.message });
        }
      }
      res.json({ created, updated, errors });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /* =============================== REPORTS ============================== */

  app.get("/api/admin/doctor-reports", auth, adminOnly, async (req, res) => {
    try {
      const status = req.query.status === "resolved" ? "resolved" : "open";
      const reports = await DoctorReport.find({ status })
        .populate({ path: "doctor", select: "name chamberName district phones slug specialty", populate: { path: "specialty", select: "name" } })
        .populate("reportedBy", "name phone")
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      res.json(reports);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.patch("/api/admin/doctor-reports/:id/resolve", auth, adminOnly, async (req, res) => {
    try {
      const report = await DoctorReport.findById(req.params.id);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (report.status === "open") {
        report.status = "resolved";
        report.resolvedAt = new Date();
        await report.save();
        await Doctor.updateOne({ _id: report.doctor, reportCount: { $gt: 0 } }, { $inc: { reportCount: -1 } });
      }
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};

// Exposed for unit testing only.
module.exports._test = { validateDoctorInput, parsePhones };