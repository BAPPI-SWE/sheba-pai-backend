/**
 * Bangladesh administrative geography — the single source of truth for
 * every location filter in the app. 8 divisions, 64 districts.
 *
 * Locations are NEVER free text anywhere in the system: the Excel import,
 * the admin form and the app filter all resolve through this file. That's
 * what stops "Chittagong" and "Chattogram" silently becoming two different
 * places that each only show half the doctors.
 *
 * Canonical names follow the current official English spellings
 * (Chattogram, Cumilla, Jashore, Bogura, Barishal). Older spellings that
 * people still type are accepted through ALIASES and mapped to canonical.
 */

const DIVISIONS = [
  {
    name: "Barishal", bn: "বরিশাল",
    districts: [
      ["Barguna", "বরগুনা"], ["Barishal", "বরিশাল"], ["Bhola", "ভোলা"],
      ["Jhalokati", "ঝালকাঠি"], ["Patuakhali", "পটুয়াখালী"], ["Pirojpur", "পিরোজপুর"],
    ],
  },
  {
    name: "Chattogram", bn: "চট্টগ্রাম",
    districts: [
      ["Bandarban", "বান্দরবান"], ["Brahmanbaria", "ব্রাহ্মণবাড়িয়া"], ["Chandpur", "চাঁদপুর"],
      ["Chattogram", "চট্টগ্রাম"], ["Cox's Bazar", "কক্সবাজার"], ["Cumilla", "কুমিল্লা"],
      ["Feni", "ফেনী"], ["Khagrachhari", "খাগড়াছড়ি"], ["Lakshmipur", "লক্ষ্মীপুর"],
      ["Noakhali", "নোয়াখালী"], ["Rangamati", "রাঙ্গামাটি"],
    ],
  },
  {
    name: "Dhaka", bn: "ঢাকা",
    districts: [
      ["Dhaka", "ঢাকা"], ["Faridpur", "ফরিদপুর"], ["Gazipur", "গাজীপুর"],
      ["Gopalganj", "গোপালগঞ্জ"], ["Kishoreganj", "কিশোরগঞ্জ"], ["Madaripur", "মাদারীপুর"],
      ["Manikganj", "মানিকগঞ্জ"], ["Munshiganj", "মুন্সীগঞ্জ"], ["Narayanganj", "নারায়ণগঞ্জ"],
      ["Narsingdi", "নরসিংদী"], ["Rajbari", "রাজবাড়ী"], ["Shariatpur", "শরীয়তপুর"],
      ["Tangail", "টাঙ্গাইল"],
    ],
  },
  {
    name: "Khulna", bn: "খুলনা",
    districts: [
      ["Bagerhat", "বাগেরহাট"], ["Chuadanga", "চুয়াডাঙ্গা"], ["Jashore", "যশোর"],
      ["Jhenaidah", "ঝিনাইদহ"], ["Khulna", "খুলনা"], ["Kushtia", "কুষ্টিয়া"],
      ["Magura", "মাগুরা"], ["Meherpur", "মেহেরপুর"], ["Narail", "নড়াইল"],
      ["Satkhira", "সাতক্ষীরা"],
    ],
  },
  {
    name: "Mymensingh", bn: "ময়মনসিংহ",
    districts: [
      ["Jamalpur", "জামালপুর"], ["Mymensingh", "ময়মনসিংহ"], ["Netrokona", "নেত্রকোণা"],
      ["Sherpur", "শেরপুর"],
    ],
  },
  {
    name: "Rajshahi", bn: "রাজশাহী",
    districts: [
      ["Bogura", "বগুড়া"], ["Chapainawabganj", "চাঁপাইনবাবগঞ্জ"], ["Joypurhat", "জয়পুরহাট"],
      ["Naogaon", "নওগাঁ"], ["Natore", "নাটোর"], ["Pabna", "পাবনা"],
      ["Rajshahi", "রাজশাহী"], ["Sirajganj", "সিরাজগঞ্জ"],
    ],
  },
  {
    name: "Rangpur", bn: "রংপুর",
    districts: [
      ["Dinajpur", "দিনাজপুর"], ["Gaibandha", "গাইবান্ধা"], ["Kurigram", "কুড়িগ্রাম"],
      ["Lalmonirhat", "লালমনিরহাট"], ["Nilphamari", "নীলফামারী"], ["Panchagarh", "পঞ্চগড়"],
      ["Rangpur", "রংপুর"], ["Thakurgaon", "ঠাকুরগাঁও"],
    ],
  },
  {
    name: "Sylhet", bn: "সিলেট",
    districts: [
      ["Habiganj", "হবিগঞ্জ"], ["Moulvibazar", "মৌলভীবাজার"], ["Sunamganj", "সুনামগঞ্জ"],
      ["Sylhet", "সিলেট"],
    ],
  },
];

// Older / alternative spellings people still type → canonical name.
// Keys are already normalized (see norm()).
const ALIASES = {
  chittagong: "Chattogram", ctg: "Chattogram",
  comilla: "Cumilla", coxsbazar: "Cox's Bazar", coxbazar: "Cox's Bazar",
  khagrachari: "Khagrachhari", laxmipur: "Lakshmipur", lakshmipur: "Lakshmipur",
  barisal: "Barishal", jhalakathi: "Jhalokati", jhalokathi: "Jhalokati",
  jessore: "Jashore", jashor: "Jashore", jhenaidaha: "Jhenaidah",
  bogra: "Bogura", nawabganj: "Chapainawabganj", chapainawabgonj: "Chapainawabganj",
  netrakona: "Netrokona", moulvibazaar: "Moulvibazar", maulvibazar: "Moulvibazar",
  narshingdi: "Narsingdi", narsinghdi: "Narsingdi", munshigonj: "Munshiganj",
  kishorgonj: "Kishoreganj", kishoregonj: "Kishoreganj", gopalgonj: "Gopalganj",
  narayangonj: "Narayanganj", manikgonj: "Manikganj", sirajgonj: "Sirajganj",
  habigonj: "Habiganj", sunamgonj: "Sunamganj",
};

/** Lowercase, drop everything that isn't a letter (English or Bangla). */
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z\u0980-\u09ff]/g, "");
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

// Build lookup tables once at startup.
const districtIndex = {}; // norm(name | bn | slug | alias) → district record
const divisionIndex = {}; // norm(name | bn | slug) → division record
const GEO = DIVISIONS.map((dv) => {
  const division = { name: dv.name, bn: dv.bn, slug: slugify(dv.name) };
  const districts = dv.districts.map(([name, bn]) => {
    const d = { name, bn, slug: slugify(name), division: dv.name, divisionBn: dv.bn, divisionSlug: division.slug };
    [name, bn, d.slug].forEach((k) => { districtIndex[norm(k)] = d; });
    return d;
  });
  [dv.name, dv.bn, division.slug].forEach((k) => { divisionIndex[norm(k)] = division; });
  return { ...division, districts };
});
Object.entries(ALIASES).forEach(([alias, canonical]) => {
  const d = districtIndex[norm(canonical)];
  if (d) districtIndex[alias] = d;
  // A few aliases are also division names (Chittagong, Barisal).
  const dv = divisionIndex[norm(canonical)];
  if (dv) divisionIndex[alias] = dv;
});

/** Any spelling / Bangla name / slug → canonical district record, or null. */
function resolveDistrict(input) {
  return districtIndex[norm(input)] || null;
}

/** Any spelling / Bangla name / slug → canonical division record, or null. */
function resolveDivision(input) {
  return divisionIndex[norm(input)] || null;
}

module.exports = { GEO, resolveDistrict, resolveDivision, slugify };