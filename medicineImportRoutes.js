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
 * This means a bad spreadsheet can never partially corrupt the catalogue —
 * nothing is written until the admin has seen and confirmed the preview.
 *
 * Wire into index.js:
 *   const medicineImportRoutes = require("./medicineImportRoutes");
 *   medicineImportRoutes(app, { auth, adminOnly, upload });
 */
const XLSX = require("xlsx");
const Medicine = require("./models/Medicine");
const Generic = require("./models/Generic");
const Manufacturer = require("./models/Manufacturer");

const TEMPLATE_COLUMNS = [
  "brandName", "brandNameBangla", "genericName", "manufacturerName",
  "strength", "dosageForm", "mrp", "price", "sellUnit",
  "unitsPerSellUnit", "packSizeLabel", "prescriptionRequired", "stock",
];

function slugify(str) {
  return str.toString().trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
async function uniqueSlug(base, excludeId) {
  let slug = slugify(base) || "item";
  let candidate = slug, n = 2;
  while (await Medicine.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    candidate = `${slug}-${n++}`;
  }
  return candidate;
}
function truthy(v) {
  const s = String(v || "").trim().toLowerCase();
  return ["true", "yes", "1", "y"].includes(s);
}

/** Validate + resolve one spreadsheet row. Never touches the database. */
async function validateRow(raw, rowNum, genericCache, manufacturerCache) {
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
      const found = await Generic.findOne({ name: new RegExp(`^${genericName}$`, "i") }).select("_id");
      genericCache[key] = found ? found._id : null;
    }
    genericId = genericCache[key];
    if (!genericId) errors.push(`generic "${genericName}" not found — add it in the Generics tab first`);
  }
  if (manufacturerName) {
    const key = manufacturerName.toLowerCase();
    if (!(key in manufacturerCache)) {
      const found = await Manufacturer.findOne({ name: new RegExp(`^${manufacturerName}$`, "i") }).select("_id");
      manufacturerCache[key] = found ? found._id : null;
    }
    manufacturerId = manufacturerCache[key];
    if (!manufacturerId) errors.push(`manufacturer "${manufacturerName}" not found — add it in the Manufacturers tab first`);
  }

  if (errors.length > 0) {
    return { rowNum, ok: false, errors, raw };
  }

  return {
    rowNum, ok: true, raw,
    resolved: {
      brandName, brandNameBangla: get("brandNameBangla") || null,
      generic: genericId, manufacturer: manufacturerId,
      strength: get("strength") || null,
      dosageForm: get("dosageForm") || "Tablet",
      mrp, price,
      sellUnit: get("sellUnit") || "strip",
      unitsPerSellUnit: parseInt(get("unitsPerSellUnit")) || 1,
      packSizeLabel: get("packSizeLabel") || null,
      prescriptionRequired: truthy(get("prescriptionRequired")),
      stock: parseInt(get("stock")) || 0,
    },
  };
}

module.exports = function medicineImportRoutes(app, deps) {
  const { auth, adminOnly, upload } = deps;

  /** Downloadable starter spreadsheet with the exact expected columns. */
  app.get("/api/admin/medicines/import/template", auth, adminOnly, (req, res) => {
    const example = {
      brandName: "Napa", brandNameBangla: "নাপা", genericName: "Paracetamol", manufacturerName: "Beximco Pharmaceuticals",
      strength: "500 mg", dosageForm: "Tablet", mrp: 1.2, price: 1.2,
      sellUnit: "strip", unitsPerSellUnit: 10, packSizeLabel: "10 x 10", prescriptionRequired: "FALSE", stock: 500,
    };
    const ws = XLSX.utils.json_to_sheet([example], { header: TEMPLATE_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Medicines");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", "attachment; filename=medicine_import_template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  });

  /** Parse + validate every row. Commits NOTHING to the database. */
  app.post("/api/admin/medicines/import/preview", auth, adminOnly, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (rows.length === 0) return res.status(400).json({ error: "The spreadsheet has no data rows" });
      if (rows.length > 2000) return res.status(400).json({ error: "Please import at most 2000 rows at a time" });

      const genericCache = {}, manufacturerCache = {};
      const results = [];
      for (let i = 0; i < rows.length; i++) {
        results.push(await validateRow(rows[i], i + 2, genericCache, manufacturerCache)); // +2: header row + 1-index
      }

      const valid = results.filter((r) => r.ok).map((r) => ({ rowNum: r.rowNum, ...r.resolved }));
      const invalid = results.filter((r) => !r.ok).map((r) => ({ rowNum: r.rowNum, brandName: r.raw.brandName, errors: r.errors }));

      res.json({ totalRows: rows.length, validCount: valid.length, invalidCount: invalid.length, valid, invalid });
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

      let created = 0, updated = 0;
      const errors = [];

      for (const row of rows) {
        try {
          const existing = await Medicine.findOne({
            brandName: row.brandName, strength: row.strength, manufacturer: row.manufacturer,
          });

          if (existing) {
            existing.brandNameBangla = row.brandNameBangla;
            existing.generic = row.generic;
            existing.dosageForm = row.dosageForm;
            existing.mrp = row.mrp;
            existing.price = row.price;
            existing.sellUnit = row.sellUnit;
            existing.unitsPerSellUnit = row.unitsPerSellUnit;
            existing.packSizeLabel = row.packSizeLabel;
            existing.prescriptionRequired = row.prescriptionRequired;
            existing.stock = row.stock;
            existing.isActive = true;
            existing.isDiscontinued = false;
            await existing.save();
            updated++;
          } else {
            const slug = await uniqueSlug(`${row.brandName}-${row.strength || ""}`);
            await new Medicine({ ...row, slug }).save();
            created++;
          }
        } catch (rowErr) {
          errors.push({ rowNum: row.rowNum, brandName: row.brandName, error: rowErr.message });
        }
      }

      res.json({ created, updated, errors });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};