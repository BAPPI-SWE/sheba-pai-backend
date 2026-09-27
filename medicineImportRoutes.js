/**
 * Bulk medicine import via spreadsheet (.xlsx or .csv).
 *
 * Two-step, safe-by-default flow:
 *   1. POST /import/preview  — parse + validate every row, commit NOTHING.
 *      Returns which rows are ready and exactly why any row failed.
 *   2. POST /import/commit   — takes the ALREADY-VALIDATED rows from step 1
 *      (sent back as JSON, not re-uploading the file) and creates/updates
 *      the actual Medicine documents.
 *
 * A bad spreadsheet can never partially corrupt the catalogue — nothing is
 * written until the admin has seen and confirmed the preview.
 *
 * Optional behaviours:
 *   - autoCreate: missing generics/manufacturers are created (name only)
 *     at commit time instead of failing the row. Essential on a fresh
 *     system, where none exist yet. The preview lists exactly which ones
 *     will be created, so nothing is created silently.
 *   - categories column: comma-separated shopping category names, so
 *     imported medicines actually appear under the store's category tiles.
 *
 * Wire into index.js:
 *   const medicineImportRoutes = require("./medicineImportRoutes");
 *   medicineImportRoutes(app, { auth, adminOnly, upload });
 */
const XLSX = require("xlsx");
const Medicine = require("./models/Medicine");
const Generic = require("./models/Generic");
const Manufacturer = require("./models/Manufacturer");
const Category = require("./models/Category");

const TEMPLATE_COLUMNS = [
  "brandName", "brandNameBangla", "genericName", "manufacturerName",
  "strength", "dosageForm", "mrp", "price", "sellUnit",
  "unitsPerSellUnit", "packSizeLabel", "prescriptionRequired", "stock", "categories",
];

function slugify(str) {
  return str.toString().trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
async function uniqueSlug(Model, base, excludeId) {
  const root = slugify(base) || "item";
  let candidate = root, n = 2;
  while (await Model.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    candidate = `${root}-${n++}`;
  }
  return candidate;
}
// Names like "Paracetamol + Caffeine" contain regex symbols — they MUST be
// escaped, or the lookup silently never matches combination generics.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactNameRx = (name) => new RegExp(`^${escapeRegex(name.trim())}$`, "i");

function truthy(v) {
  const s = String(v || "").trim().toLowerCase();
  return ["true", "yes", "1", "y"].includes(s);
}

/** Case-insensitive lookup of category names / Bangla names / slugs. */
async function buildCategoryLookup() {
  const all = await Category.find().select("_id name nameBangla slug").lean();
  const map = {};
  all.forEach((c) => [c.name, c.nameBangla, c.slug].filter(Boolean).forEach((k) => { map[k.trim().toLowerCase()] = c; }));
  return (text) => map[String(text).trim().toLowerCase()] || null;
}

/** Validate + resolve one spreadsheet row. Never writes to the database. */
async function validateRow(raw, rowNum, ctx) {
  const { genericCache, manufacturerCache, categoryLookup, autoCreate } = ctx;
  const errors = [];
  const get = (k) => (raw[k] !== undefined && raw[k] !== null ? String(raw[k]).trim() : "");

  const brandName = get("brandName");
  const genericName = get("genericName");
  const manufacturerName = get("manufacturerName");
  const mrp = parseFloat(get("mrp"));
  const price = parseFloat(get("price"));

  if (!brandName) errors.push("brandName is required");
  if (!genericName) errors.push("genericName is required");
  if (!manufacturerName) errors.push("manufacturerName is required");
  if (isNaN(mrp)) errors.push("mrp must be a number");
  if (isNaN(price)) errors.push("price must be a number");
  if (!isNaN(mrp) && !isNaN(price) && price > mrp) errors.push("price cannot exceed mrp");

  let genericId = null, manufacturerId = null;
  if (genericName) {
    const key = genericName.toLowerCase();
    if (!(key in genericCache)) {
      const found = await Generic.findOne({ name: exactNameRx(genericName) }).select("_id");
      genericCache[key] = found ? found._id : null;
    }
    genericId = genericCache[key];
    if (!genericId && !autoCreate) errors.push(`generic "${genericName}" not found — add it in the Generics tab first, or tick "create missing"`);
  }
  if (manufacturerName) {
    const key = manufacturerName.toLowerCase();
    if (!(key in manufacturerCache)) {
      const found = await Manufacturer.findOne({ name: exactNameRx(manufacturerName) }).select("_id");
      manufacturerCache[key] = found ? found._id : null;
    }
    manufacturerId = manufacturerCache[key];
    if (!manufacturerId && !autoCreate) errors.push(`manufacturer "${manufacturerName}" not found — add it in the Manufacturers tab first, or tick "create missing"`);
  }

  // Categories are optional, but every name given must exist — a typo
  // would otherwise silently leave the medicine out of that category.
  // Some category names contain commas themselves ("Cold, Cough & Allergy"),
  // so a plain split would break them apart. Instead, at each position take
  // the LONGEST run of comma-separated pieces that forms a known category.
  const categoryIds = [], categoryNames = [];
  const parts = get("categories").split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; ) {
    let matched = null, end = i;
    for (let j = parts.length - 1; j >= i && !matched; j--) {
      const cat = categoryLookup(parts.slice(i, j + 1).join(", "));
      if (cat) { matched = cat; end = j; }
    }
    if (matched) {
      if (!categoryIds.some((id) => String(id) === String(matched._id))) {
        categoryIds.push(matched._id); categoryNames.push(matched.name);
      }
      i = end + 1;
    } else {
      errors.push(`category "${parts[i]}" not found — add it in the Categories tab first`);
      i++;
    }
  }

  if (errors.length > 0) return { rowNum, ok: false, errors, raw };

  return {
    rowNum, ok: true, raw,
    resolved: {
      brandName, brandNameBangla: get("brandNameBangla") || null,
      generic: genericId, manufacturer: manufacturerId,
      genericName, manufacturerName,           // used to create missing ones at commit
      strength: get("strength") || null,
      dosageForm: get("dosageForm") || "Tablet",
      mrp, price,
      sellUnit: get("sellUnit") || "strip",
      unitsPerSellUnit: parseInt(get("unitsPerSellUnit")) || 1,
      packSizeLabel: get("packSizeLabel") || null,
      prescriptionRequired: truthy(get("prescriptionRequired")),
      stock: parseInt(get("stock")) || 0,
      categories: categoryIds,
      categoryNames,
    },
  };
}

module.exports = function medicineImportRoutes(app, deps) {
  const { auth, adminOnly, upload } = deps;

  /** Downloadable starter spreadsheet with the exact expected columns. */
  app.get("/api/admin/medicines/import/template", auth, adminOnly, async (req, res) => {
    try {
      const example = {
        brandName: "Napa", brandNameBangla: "নাপা", genericName: "Paracetamol", manufacturerName: "Beximco Pharmaceuticals",
        strength: "500 mg", dosageForm: "Tablet", mrp: 12, price: 12,
        sellUnit: "strip", unitsPerSellUnit: 10, packSizeLabel: "10 tablets", prescriptionRequired: "FALSE", stock: 500,
        categories: "Fever & Pain",
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([example], { header: TEMPLATE_COLUMNS }), "Medicines");
      const cats = await Category.find().sort({ sortOrder: 1, name: 1 }).select("name nameBangla").lean();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(cats.length ? cats.map((c) => ({ category: c.name, bangla: c.nameBangla })) : [{ category: "(add categories first)", bangla: "" }]),
        "Categories (valid values)"
      );
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", "attachment; filename=medicine_import_template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** Parse + validate every row. Commits NOTHING to the database. */
  app.post("/api/admin/medicines/import/preview", auth, adminOnly, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (rows.length === 0) return res.status(400).json({ error: "The spreadsheet has no data rows" });
      if (rows.length > 2000) return res.status(400).json({ error: "Please import at most 2000 rows at a time" });

      const ctx = {
        genericCache: {}, manufacturerCache: {},
        categoryLookup: await buildCategoryLookup(),
        autoCreate: truthy(req.body.autoCreate),
      };
      const results = [];
      for (let i = 0; i < rows.length; i++) {
        results.push(await validateRow(rows[i], i + 2, ctx)); // +2: header row + 1-index
      }

      const valid = results.filter((r) => r.ok).map((r) => ({ rowNum: r.rowNum, ...r.resolved }));
      const invalid = results.filter((r) => !r.ok).map((r) => ({ rowNum: r.rowNum, brandName: r.raw.brandName, errors: r.errors }));

      // Tell the admin exactly what will be created — nothing is created silently.
      const uniq = (arr) => [...new Map(arr.map((n) => [n.toLowerCase(), n])).values()];
      const willCreate = {
        generics: uniq(valid.filter((r) => !r.generic).map((r) => r.genericName)),
        manufacturers: uniq(valid.filter((r) => !r.manufacturer).map((r) => r.manufacturerName)),
      };

      res.json({ totalRows: rows.length, validCount: valid.length, invalidCount: invalid.length, valid, invalid, willCreate });
    } catch (err) {
      res.status(400).json({ error: "Could not read that file — is it a valid .xlsx or .csv? (" + err.message + ")" });
    }
  });

  /**
   * Create or update medicines from ALREADY-VALIDATED rows (from /preview).
   * Matches an existing medicine by brandName + strength + manufacturer;
   * if found, updates it (price/stock/etc.) rather than duplicating it.
   */
  app.post("/api/admin/medicines/import/commit", auth, adminOnly, async (req, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "No rows to import" });
      }

      let created = 0, updated = 0, genericsCreated = 0, manufacturersCreated = 0;
      const errors = [];
      const genericIds = {}, manufacturerIds = {};

      // Find-or-create by exact (case-insensitive) name — re-checks the DB,
      // so two rows sharing a new generic create it exactly once.
      async function ensure(Model, name, cache, onCreate) {
        const key = name.trim().toLowerCase();
        if (cache[key]) return cache[key];
        let doc = await Model.findOne({ name: exactNameRx(name) }).select("_id");
        if (!doc) {
          doc = await new Model({ name: name.trim(), slug: await uniqueSlug(Model, name) }).save();
          onCreate();
        }
        cache[key] = doc._id;
        return doc._id;
      }

      for (const row of rows) {
        try {
          const { rowNum, genericName, manufacturerName, categoryNames, ...data } = row;
          if (!data.generic) data.generic = await ensure(Generic, genericName, genericIds, () => genericsCreated++);
          if (!data.manufacturer) data.manufacturer = await ensure(Manufacturer, manufacturerName, manufacturerIds, () => manufacturersCreated++);

          const existing = await Medicine.findOne({
            brandName: data.brandName, strength: data.strength, manufacturer: data.manufacturer,
          });

          if (existing) {
            existing.brandNameBangla = data.brandNameBangla;
            existing.generic = data.generic;
            existing.dosageForm = data.dosageForm;
            existing.mrp = data.mrp;
            existing.price = data.price;
            existing.sellUnit = data.sellUnit;
            existing.unitsPerSellUnit = data.unitsPerSellUnit;
            existing.packSizeLabel = data.packSizeLabel;
            existing.prescriptionRequired = data.prescriptionRequired;
            existing.stock = data.stock;
            // Only touch categories when the sheet specifies some, so an
            // older sheet without the column can't wipe assignments.
            if (data.categories?.length) existing.categories = data.categories;
            existing.isActive = true;
            existing.isDiscontinued = false;
            await existing.save();
            updated++;
          } else {
            const slug = await uniqueSlug(Medicine, `${data.brandName}-${data.strength || ""}`);
            await new Medicine({ ...data, slug }).save();
            created++;
          }
        } catch (rowErr) {
          errors.push({ rowNum: row.rowNum, brandName: row.brandName, error: rowErr.message });
        }
      }

      res.json({ created, updated, genericsCreated, manufacturersCreated, errors });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};

// Exposed for unit testing only.
module.exports._test = { validateRow, escapeRegex };