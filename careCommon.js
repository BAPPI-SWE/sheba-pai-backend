/**
 * Shared rules for the caregiver directory — used by careRoutes.js (app)
 * and careAdminRoutes.js (admin panel), so "who is listed", "what a
 * caregiver card shows" and "how a booking is validated" are defined once.
 */
const crypto = require("crypto");
const mongoose = require("mongoose");
const HelperProfile = require("./models/HelperProfile");
const CareCategory = require("./models/CareCategory");
const CareBooking = require("./models/CareBooking");
const Rating = require("./models/Rating");
const User = require("./models/User");
const { resolveDistrict, resolveDivision, GEO } = require("./bdGeo");

const TIERS = ["attendant", "trained", "nurse"];
const SHIFTS = ["day8", "day12", "night12", "live24"];
const RATE_KEYS = ["day8", "day12", "night12", "live24", "month"];
const tierRank = (t) => Math.max(0, TIERS.indexOf(t));

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || "")) && String(v).length === 24;

/** 01XXXXXXXXX, accepting +880 / 880 prefixes and spaces or dashes. */
function normalizeBdMobile(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+88")) d = d.slice(3);
  else if (d.startsWith("88") && d.length === 13) d = d.slice(2);
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}

/** Trimmed string or null, capped at `max` characters. */
function clean(v, max = 200) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/* ----------------------------- standard care types ----------------------------- */

// Seeded by Admin → Caregivers → Care types → "Add standard care types".
// Prices are deliberately left empty: set your own "from" prices in the admin panel.
const STANDARD_CATEGORIES = [
  { slug: "stroke-paralysis", iconKey: "stroke", name: "Stroke & paralysis", nameBangla: "স্ট্রোক ও প্যারালাইসিস",
    description: "Help with moving, feeding, hygiene, exercises and medicines after a stroke.",
    descriptionBangla: "স্ট্রোকের পর চলাফেরা, খাওয়ানো, পরিচ্ছন্নতা, ব্যায়াম ও ওষুধ খাওয়ানোয় সাহায্য।",
    keywords: ["stroke", "paralysis", "প্যারালাইসিস", "স্ট্রোক", "অবশ"], minTier: "attendant" },
  { slug: "bedridden", iconKey: "bedridden", name: "Bedridden patient", nameBangla: "শয্যাশায়ী রোগী",
    description: "Turning, bed bath, diaper change, bedsore prevention and feeding.",
    descriptionBangla: "পাশ ফেরানো, বিছানায় গোসল, ডায়াপার বদল, বেডসোর প্রতিরোধ ও খাওয়ানো।",
    keywords: ["bedridden", "bed", "শয্যাশায়ী", "বেডসোর"], minTier: "attendant" },
  { slug: "dementia", iconKey: "dementia", name: "Dementia & Alzheimer's", nameBangla: "ডিমেনশিয়া ও আলঝেইমার",
    description: "Patient, calm supervision, routines and safety for memory loss.",
    descriptionBangla: "স্মৃতিভ্রংশ রোগীর জন্য ধৈর্যশীল দেখাশোনা, নিয়মিত রুটিন ও নিরাপত্তা।",
    keywords: ["dementia", "alzheimer", "memory", "ডিমেনশিয়া", "স্মৃতি"], minTier: "trained" },
  { slug: "after-surgery", iconKey: "postop", name: "After surgery", nameBangla: "অপারেশন পরবর্তী",
    description: "Recovery support at home after an operation or hospital stay.",
    descriptionBangla: "অপারেশন বা হাসপাতাল থেকে ফেরার পর বাড়িতে সুস্থ হয়ে ওঠায় সহায়তা।",
    keywords: ["surgery", "operation", "discharge", "অপারেশন", "সার্জারি"], minTier: "attendant" },
  { slug: "newborn-mother", iconKey: "newborn", name: "Newborn & mother", nameBangla: "নবজাতক ও মা",
    description: "Baby bathing, feeding support and care for the new mother.",
    descriptionBangla: "নবজাতকের গোসল, খাওয়ানোয় সহায়তা ও প্রসূতি মায়ের যত্ন।",
    keywords: ["baby", "newborn", "mother", "নবজাতক", "শিশু", "প্রসূতি"], minTier: "trained" },
  { slug: "elderly-companion", iconKey: "elderly", name: "Elderly care", nameBangla: "বয়স্কদের দেখাশোনা",
    description: "Daily help, company, walks and medicine reminders for older parents.",
    descriptionBangla: "বয়স্ক মা-বাবার দৈনন্দিন সাহায্য, সঙ্গ, হাঁটা ও ওষুধের কথা মনে করানো।",
    keywords: ["elderly", "old", "companion", "বয়স্ক", "বৃদ্ধ"], minTier: "attendant" },
  { slug: "night-attendant", iconKey: "night", name: "Night attendant", nameBangla: "রাতের অ্যাটেনডেন্ট",
    description: "Someone awake through the night so the family can rest.",
    descriptionBangla: "রাতভর জেগে রোগীর পাশে থাকা, যাতে পরিবার বিশ্রাম নিতে পারে।",
    keywords: ["night", "রাত"], minTier: "attendant" },
  { slug: "hospital-attendant", iconKey: "hospital", name: "Hospital attendant", nameBangla: "হাসপাতালে সঙ্গী",
    description: "Stays with the patient in hospital — food, hygiene, errands.",
    descriptionBangla: "হাসপাতালে রোগীর পাশে থাকা — খাবার, পরিচ্ছন্নতা ও প্রয়োজনীয় কাজ।",
    keywords: ["hospital", "হাসপাতাল", "ক্লিনিক"], minTier: "attendant" },
  { slug: "nursing-procedures", iconKey: "nursing", name: "Nursing care", nameBangla: "নার্সিং সেবা",
    description: "Injection, catheter, NG tube, wound dressing — by registered nurses only.",
    descriptionBangla: "ইনজেকশন, ক্যাথেটার, এনজি টিউব, ড্রেসিং — শুধুমাত্র নিবন্ধিত নার্সদের মাধ্যমে।",
    keywords: ["nurse", "injection", "catheter", "ng tube", "dressing", "নার্স", "ইনজেকশন", "ড্রেসিং"], minTier: "nurse" },
];

/* --------------------------------- listing --------------------------------- */

/** Base filter for "this caregiver is visible to families". */
function listedFilter() {
  return {
    verificationStatus: "approved",
    "care.adminHidden": { $ne: true },
    "care.code": { $type: "string" },
    "care.gender": { $in: ["female", "male"] },
    "care.districts.0": { $exists: true },
    "care.categories.0": { $exists: true },
    "care.shifts.0": { $exists: true },
  };
}

/** What is still missing before a caregiver can be listed (empty = complete). */
function missingCareFields(care = {}) {
  const missing = [];
  if (!["female", "male"].includes(care.gender)) missing.push("gender");
  if (!care.districts?.length) missing.push("districts");
  if (!care.categories?.length) missing.push("categories");
  if (!care.shifts?.length) missing.push("shifts");
  return missing;
}

function isListed(profile) {
  const care = profile.care || {};
  return profile.verificationStatus === "approved" && !care.adminHidden && !!care.code && missingCareFields(care).length === 0;
}

/** Lowest of the caregiver's shift rates → { fromPrice, fromUnit }, else the category's. */
function fromPriceOf(care = {}, category = null) {
  let best = null;
  for (const k of SHIFTS) {
    const v = care.rates?.[k];
    if (v != null && v > 0 && (best == null || v < best.fromPrice)) best = { fromPrice: v, fromUnit: k };
  }
  if (!best && care.rates?.month) best = { fromPrice: care.rates.month, fromUnit: "month" };
  if (!best && category?.fromPrice != null) best = { fromPrice: category.fromPrice, fromUnit: category.priceUnit || "shift12" };
  return best || { fromPrice: null, fromUnit: null };
}

function publicCategory(c) {
  if (!c || !c._id) return null;
  return { _id: c._id, name: c.name, nameBangla: c.nameBangla, slug: c.slug, iconKey: c.iconKey || "general" };
}

/**
 * A caregiver as families see them. Never includes the phone number, NID or
 * documents — families contact Sheba Pai, not the caregiver directly.
 */
function publicCaregiver(p, { category = null, detail = false } = {}) {
  const care = p.care || {};
  const cats = (care.categories || []).filter((c) => c && c._id).map(publicCategory);
  const out = {
    code: care.code,
    name: p.user?.name || "",
    photoUrl: care.photoUrl || null,
    gender: care.gender,
    tier: care.tier || "attendant",
    yearsExperience: care.yearsExperience || 0,
    ratingAvg: Math.round((p.ratingAvg || 0) * 10) / 10,
    ratingCount: p.ratingCount || 0,
    completedBookings: care.completedBookings || 0,
    districts: care.districts || [],
    categories: cats,
    shifts: care.shifts || [],
    available: care.available !== false,
    featured: !!care.featured,
    badges: {
      nid: !!p.nidFrontUrl || p.verificationStatus === "approved",
      police: !!p.policeClearanceUrl,
      certified: (p.certificateUrls || []).length > 0 || care.tier === "nurse",
    },
    ...fromPriceOf(care, category),
  };
  if (detail) {
    out.bio = care.bio || null;
    out.rates = care.rates || {};
    out.memberSince = p.createdAt;
  }
  return out;
}

/** Build the Mongo filter for the public caregiver list from query params. */
async function caregiverQuery(q) {
  const filter = listedFilter();
  let category = null;

  if (q.category) {
    category = isId(q.category)
      ? await CareCategory.findOne({ _id: q.category, isActive: true }).lean()
      : await CareCategory.findOne({ slug: String(q.category), isActive: true }).lean();
    if (!category) return { filter: null, category: null };
    filter["care.categories"] = category._id;
  }

  const district = q.district ? resolveDistrict(q.district) : null;
  if (district) filter["care.districts"] = district.name;
  else if (q.division) {
    const dv = resolveDivision(q.division);
    const names = dv ? (GEO.find((g) => g.name === dv.name)?.districts || []).map((d) => d.name) : [];
    if (names.length) filter["care.districts"] = { $in: names };
  }

  if (["female", "male"].includes(q.gender)) filter["care.gender"] = q.gender;
  if (TIERS.includes(q.tier)) filter["care.tier"] = { $in: TIERS.slice(TIERS.indexOf(q.tier)) }; // "trained" = trained or nurse
  if (SHIFTS.includes(q.shift)) filter["care.shifts"] = q.shift;
  if (q.available === "1" || q.available === "true") filter["care.available"] = { $ne: false };

  const text = String(q.q || "").trim();
  if (text.length >= 2) {
    const rx = new RegExp(escapeRegex(text), "i");
    const users = await User.find({ role: "helper", name: rx }).select("_id").limit(200).lean();
    filter.$or = [{ "care.code": new RegExp(`^${escapeRegex(text)}$`, "i") }, { user: { $in: users.map((u) => u._id) } }];
  }
  return { filter, category };
}

const LIST_SORT = { "care.featured": -1, "care.available": -1, ratingAvg: -1, "care.completedBookings": -1, "care.yearsExperience": -1, _id: 1 };

/* --------------------------------- codes --------------------------------- */

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L — easy to read out on the phone

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

async function newBookingCode() {
  for (let i = 0; i < 10; i++) {
    const code = `SP-${randomCode(6)}`;
    if (!(await CareBooking.exists({ code }))) return code;
  }
  throw new Error("Could not create a booking code, please try again");
}

/** Caregiver IDs like "SP1024" — short enough to say on the phone. */
async function newCaregiverCode() {
  for (let i = 0; i < 30; i++) {
    const digits = i < 20 ? 4 : 5;
    const n = crypto.randomInt(10 ** (digits - 1), 10 ** digits);
    const code = `SP${n}`;
    if (!(await HelperProfile.exists({ "care.code": code }))) return code;
  }
  throw new Error("Could not create a caregiver ID, please try again");
}

/* ------------------------------ care profile ------------------------------ */

/**
 * Validate + apply care-profile fields onto profile.care. Used by the
 * caregiver (app) and the admin team (panel). Returns an error string or null.
 * `asAdmin` additionally allows adminHidden / featured.
 */
async function applyCareFields(profile, body, { asAdmin = false } = {}) {
  if (!profile.care) profile.care = {};
  const care = profile.care;

  if (body.gender !== undefined) {
    if (body.gender !== null && !["female", "male"].includes(body.gender)) return "Please choose female or male";
    care.gender = body.gender;
  }
  if (body.tier !== undefined) {
    if (!TIERS.includes(body.tier)) return "Please choose your caregiver level";
    care.tier = body.tier;
  }
  if (body.bnmcNumber !== undefined) care.bnmcNumber = clean(body.bnmcNumber, 40);
  if (body.yearsExperience !== undefined) {
    const n = Math.floor(Number(body.yearsExperience));
    if (!Number.isFinite(n) || n < 0 || n > 60) return "Years of experience must be between 0 and 60";
    care.yearsExperience = n;
  }
  if (body.bio !== undefined) care.bio = clean(body.bio, 600);
  if (body.available !== undefined) care.available = !!body.available;

  if (body.districts !== undefined) {
    if (!Array.isArray(body.districts)) return "Districts must be a list";
    const names = [];
    for (const raw of body.districts) {
      const d = resolveDistrict(raw);
      if (!d) return `Unknown district: ${raw}`;
      if (!names.includes(d.name)) names.push(d.name);
    }
    care.districts = names;
  }

  if (body.shifts !== undefined) {
    if (!Array.isArray(body.shifts) || body.shifts.some((s) => !SHIFTS.includes(s))) return "Unknown shift";
    care.shifts = SHIFTS.filter((s) => body.shifts.includes(s)); // stable order, no duplicates
  }

  if (body.rates !== undefined) {
    const rates = {};
    for (const k of RATE_KEYS) {
      const v = body.rates?.[k];
      if (v === null || v === undefined || v === "") { rates[k] = null; continue; }
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 500000) return "Rates must be numbers in taka";
      rates[k] = n || null;
    }
    care.rates = rates;
  }

  // Care types are checked against the caregiver level AFTER tier is applied.
  if (body.categories !== undefined || body.tier !== undefined) {
    const ids = body.categories !== undefined ? body.categories : (care.categories || []).map(String);
    if (!Array.isArray(ids) || ids.some((id) => !isId(id))) return "Unknown care type";
    const cats = await CareCategory.find({ _id: { $in: ids } }).lean();
    const allowed = [];
    for (const c of cats) {
      if (tierRank(care.tier) < tierRank(c.minTier)) {
        if (body.categories !== undefined) {
          const need = c.minTier === "nurse" ? "a registered nurse" : "a trained caregiver";
          return `"${c.name}" can only be offered by ${need}`;
        }
        continue; // tier was lowered: silently drop types it no longer allows
      }
      allowed.push(c._id);
    }
    care.categories = allowed;
  }

  if (asAdmin) {
    if (body.adminHidden !== undefined) care.adminHidden = !!body.adminHidden;
    if (body.featured !== undefined) care.featured = !!body.featured;
  }

  if (!care.code) care.code = await newCaregiverCode();
  care.updatedAt = new Date();
  profile.markModified("care");
  return null;
}

/* --------------------------------- booking --------------------------------- */

/**
 * Validate a booking request body into clean fields. Every rule lives here
 * on the server; the app checks the same for a friendlier experience.
 * Returns { error } or { fields }.
 */
async function validateBooking(b) {
  const contactName = clean(b.contactName, 80);
  if (!contactName || contactName.length < 2) return { error: "Please enter the contact person's name" };
  const contactPhone = normalizeBdMobile(b.contactPhone);
  if (!contactPhone) return { error: "Please enter a valid 11-digit mobile number (01XXXXXXXXX)" };
  const district = resolveDistrict(b.district);
  if (!district) return { error: "Please choose the district where care is needed" };

  const shift = b.shift || "day12";
  if (!SHIFTS.includes(shift)) return { error: "Please choose a shift" };
  const planType = b.planType || "short";
  if (!["short", "regular"].includes(planType)) return { error: "Please choose how long you need care" };

  let startDate = null;
  if (b.startDate) {
    const d = new Date(b.startDate);
    if (isNaN(d.getTime())) return { error: "Invalid start date" };
    const dayAgo = Date.now() - 36 * 3600 * 1000;
    if (d.getTime() < dayAgo) return { error: "The start date can't be in the past" };
    startDate = d;
  }

  let durationDays = null;
  if (b.durationDays !== undefined && b.durationDays !== null && b.durationDays !== "") {
    const n = Math.floor(Number(b.durationDays));
    if (!Number.isFinite(n) || n < 1 || n > 365) return { error: "Number of days must be between 1 and 365" };
    durationDays = n;
  }

  let patientAge = null;
  if (b.patientAge !== undefined && b.patientAge !== null && b.patientAge !== "") {
    const n = Math.floor(Number(b.patientAge));
    if (!Number.isFinite(n) || n < 0 || n > 120) return { error: "Please enter a valid age" };
    patientAge = n;
  }

  let category = null;
  if (b.category) {
    category = isId(b.category)
      ? await CareCategory.findById(b.category).lean()
      : await CareCategory.findOne({ slug: String(b.category) }).lean();
    if (!category) return { error: "Unknown care type" };
  }

  let requested = null;
  if (b.caregiverCode) {
    const p = await HelperProfile.findOne({ ...listedFilter(), "care.code": String(b.caregiverCode).toUpperCase() })
      .populate("user", "name").lean();
    if (p) requested = p; // an unlisted / unknown code is ignored rather than blocking the request
  }

  return {
    fields: {
      contactName, contactPhone,
      district: district.name, division: district.division,
      area: clean(b.area, 120), address: clean(b.address, 300),
      shift, planType, startDate, durationDays,
      patientName: clean(b.patientName, 80), patientAge,
      patientGender: ["female", "male"].includes(b.patientGender) ? b.patientGender : null,
      conditionNote: clean(b.conditionNote, 1000),
      preferredGender: ["female", "male"].includes(b.preferredGender) ? b.preferredGender : "any",
      note: clean(b.note, 1000),
      category: category?._id || null,
      categoryName: category?.name || null,
      categoryNameBangla: category?.nameBangla || null,
      requestedCaregiver: requested?.user?._id || null,
      requestedCaregiverCode: requested?.care?.code || null,
      requestedCaregiverName: requested?.user?.name || null,
    },
  };
}

/* --------------------------------- ratings --------------------------------- */

/**
 * Recompute a caregiver's rating from BOTH sources — ratings from the live
 * dispatch system and reviews on directory bookings — so switching modes
 * never resets anyone's reputation.
 */
async function recomputeCaregiverRating(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const [a] = await Rating.aggregate([
    { $match: { ratee: uid, rateeRole: "helper" } },
    { $group: { _id: null, sum: { $sum: "$stars" }, n: { $sum: 1 } } },
  ]);
  const [b] = await CareBooking.aggregate([
    { $match: { assignedCaregiver: uid, "review.stars": { $gte: 1 } } },
    { $group: { _id: null, sum: { $sum: "$review.stars" }, n: { $sum: 1 } } },
  ]);
  const n = (a?.n || 0) + (b?.n || 0);
  const avg = n ? Math.round((((a?.sum || 0) + (b?.sum || 0)) / n) * 10) / 10 : 0;
  await HelperProfile.updateOne({ user: uid }, { ratingAvg: avg, ratingCount: n });
  await User.updateOne({ _id: uid }, { ratingAvg: avg, ratingCount: n });
  return { ratingAvg: avg, ratingCount: n };
}

/** Most recent written reviews for a caregiver, first names only. */
async function recentReviews(userId, limit = 10) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const [care, live] = await Promise.all([
    CareBooking.find({ assignedCaregiver: uid, "review.stars": { $gte: 1 } })
      .select("review contactName categoryName categoryNameBangla").sort({ "review.at": -1 }).limit(limit).lean(),
    Rating.find({ ratee: uid, rateeRole: "helper" }).populate("rater", "name")
      .select("stars comment createdAt rater").sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  return [
    ...care.map((r) => ({ stars: r.review.stars, comment: r.review.comment || null, at: r.review.at, by: first(r.contactName),
      categoryName: r.categoryName, categoryNameBangla: r.categoryNameBangla })),
    ...live.map((r) => ({ stars: r.stars, comment: r.comment || null, at: r.createdAt, by: first(r.rater?.name) })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, limit);
}

module.exports = {
  TIERS, SHIFTS, RATE_KEYS, tierRank, STANDARD_CATEGORIES,
  escapeRegex, isId, normalizeBdMobile, clean,
  listedFilter, missingCareFields, isListed, fromPriceOf, publicCaregiver, publicCategory, caregiverQuery, LIST_SORT,
  newBookingCode, newCaregiverCode, applyCareFields, validateBooking,
  recomputeCaregiverRating, recentReviews,
};
