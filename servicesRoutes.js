/**
 * Phase 3 routes: services (main + sub), requirements, submissions,
 * helper service offerings, and eligibility.
 *
 * Wire this into index.js with:
 *     const servicesRoutes = require("./servicesRoutes");
 *     servicesRoutes(app, { auth, adminOnly, helperOnly, upload, uploadToCloudinary });
 */
const Service = require("./models/Service");
const Requirement = require("./models/Requirement");
const RequirementSubmission = require("./models/RequirementSubmission");
const HelperService = require("./models/HelperService");
const HelperProfile = require("./models/HelperProfile");
const { checkEligibility, getRequirementsWithStatus } = require("./eligibility");

module.exports = function servicesRoutes(app, deps) {
  const { auth, adminOnly, helperOnly, upload, uploadToCloudinary } = deps;

  // Save the helper's chosen profession (role) + optional alt phone.
  // Also mirrors profession into roles[] so existing matching keeps working.
  app.patch("/api/helper/profession", auth, helperOnly, async (req, res) => {
    try {
      const { profession, altPhone } = req.body;
      if (!profession) return res.status(400).json({ error: "profession is required" });
      const profile = await HelperProfile.findOneAndUpdate(
        { user: req.user.id },
        { profession, altPhone: altPhone || null, roles: [profession] },
        { new: true, upsert: true }
      );
      res.json(profile);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- SERVICES ----------------

  // All main services (optionally filtered by role), each with its sub-services.
  app.get("/api/services/tree", async (req, res) => {
    try {
      const { role } = req.query;
      const mainQuery = { parent: null, isActive: true };
      if (role) mainQuery.helperRoles = role;

      const mains = await Service.find(mainQuery).sort({ sortOrder: 1, name: 1 });
      const subs = await Service.find({
        parent: { $in: mains.map((m) => m._id) },
        isActive: true,
      }).sort({ sortOrder: 1, name: 1 });

      const tree = mains.map((m) => ({
        ...m.toObject(),
        subServices: subs.filter((s) => s.parent.toString() === m._id.toString()),
      }));
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/services", auth, adminOnly, async (req, res) => {
    try {
      const { name, nameBangla, parent, helperRoles, description, sortOrder } = req.body;

      // Enforce two levels only: a sub-service's parent must be a main service
      if (parent) {
        const p = await Service.findById(parent);
        if (!p) return res.status(400).json({ error: "Parent service not found" });
        if (p.parent) return res.status(400).json({ error: "Only two levels allowed" });
      }

      const saved = await new Service({
        name, nameBangla,
        parent: parent || null,
        helperRoles: helperRoles || [],
        chargeType: req.body.chargeType || "hourly",
        pricingMode: req.body.pricingMode || "helper_flexible",
        adminAmount: req.body.adminAmount != null ? req.body.adminAmount : null,
        description,
        sortOrder: sortOrder || 0,
      }).save();
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/services/:id", auth, adminOnly, async (req, res) => {
    try {
      const updated = await Service.findByIdAndUpdate(req.params.id, req.body, {
        new: true, runValidators: true,
      });
      if (!updated) return res.status(404).json({ error: "Service not found" });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/services/:id", auth, adminOnly, async (req, res) => {
    try {
      const subs = await Service.countDocuments({ parent: req.params.id });
      if (subs > 0) {
        return res.status(400).json({ error: "Delete or move its sub-services first" });
      }
      const deleted = await Service.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Service not found" });
      await Requirement.deleteMany({ service: req.params.id });
      res.json({ message: "Service deleted", id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- REQUIREMENTS ----------------

  app.get("/api/services/:id/requirements", async (req, res) => {
    try {
      const list = await Requirement.find({ service: req.params.id, isActive: true })
        .sort({ forWhom: 1, createdAt: 1 });
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/requirements", auth, adminOnly, async (req, res) => {
    try {
      const { service, forWhom, title, titleBangla, hint, hintBangla,
              isMandatory, maxPhotos } = req.body;
      const svc = await Service.findById(service);
      if (!svc) return res.status(400).json({ error: "Service not found" });

      const saved = await new Requirement({
        service, forWhom, title, titleBangla, hint, hintBangla,
        isMandatory: isMandatory !== false,
        maxPhotos: Math.min(maxPhotos || 3, 3),
      }).save();
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/requirements/:id", auth, adminOnly, async (req, res) => {
    try {
      const allowed = ["title", "titleBangla", "hint", "hintBangla", "isMandatory", "maxPhotos", "forWhom", "isActive"];
      const update = {};
      allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
      if (update.maxPhotos) update.maxPhotos = Math.min(update.maxPhotos, 3);
      const updated = await Requirement.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
      if (!updated) return res.status(404).json({ error: "Requirement not found" });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/requirements/:id", auth, adminOnly, async (req, res) => {
    try {
      const deleted = await Requirement.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Requirement not found" });
      await RequirementSubmission.deleteMany({ requirement: req.params.id });
      res.json({ message: "Requirement deleted", id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- ELIGIBILITY & REQUIREMENT STATUS ----------------

  // What do I still need for this service?
  app.get("/api/services/:id/my-requirements", auth, async (req, res) => {
    try {
      const forWhom = req.user.role === "helper" ? "helper" : "patient";
      const list = await getRequirementsWithStatus(req.user.id, req.params.id, forWhom);
      const elig = await checkEligibility(req.user.id, req.params.id, forWhom);
      res.json({ eligible: elig.eligible, items: list });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Upload one photo toward a requirement (max photos enforced)
  app.post(
    "/api/requirements/:id/upload",
    auth, upload.single("image"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No image provided" });
        const requirement = await Requirement.findById(req.params.id);
        if (!requirement) return res.status(404).json({ error: "Requirement not found" });

        let sub = await RequirementSubmission.findOne({
          user: req.user.id, requirement: requirement._id,
        });
        if (!sub) {
          sub = new RequirementSubmission({
            user: req.user.id,
            requirement: requirement._id,
            service: requirement.service,
            imageUrls: [],
          });
        }
        if (sub.imageUrls.length >= requirement.maxPhotos) {
          return res.status(400).json({
            error: `Maximum ${requirement.maxPhotos} photos for this requirement`,
          });
        }

        const url = await uploadToCloudinary(
          req.file.buffer,
          `sheba-pai/requirements/${req.user.id}`
        );
        sub.imageUrls.push(url);
        sub.status = "pending";
        sub.rejectionReason = null;
        await sub.save();

        res.status(201).json(sub);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // ---------------- HELPER SERVICE OFFERINGS ----------------

  // Helper offers a sub-service with their own price
  app.post("/api/helper/services", auth, helperOnly, async (req, res) => {
    try {
      const { service, chargeType, amount, experienceNote, yearsExperience } = req.body;
      const svc = await Service.findById(service);
      if (!svc) return res.status(400).json({ error: "Service not found" });
      if (!svc.parent) {
        return res.status(400).json({ error: "Choose a sub-service, not a main service" });
      }

      const saved = await HelperService.findOneAndUpdate(
        { helper: req.user.id, service },
        {
          helper: req.user.id, service,
          chargeType: chargeType || "hourly",
          amount, experienceNote, yearsExperience: yearsExperience || 0,
          isActive: true,
        },
        { new: true, upsert: true }
      );
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/helper/services", auth, helperOnly, async (req, res) => {
    try {
      const list = await HelperService.find({ helper: req.user.id })
        .populate("service", "name nameBangla parent");

      // Attach live eligibility for each offering
      const withStatus = [];
      for (const hs of list) {
        const elig = await checkEligibility(req.user.id, hs.service._id, "helper");
        withStatus.push({
          ...hs.toObject(),
          eligible: elig.eligible,
          missingCount: elig.missing.length,
          pendingCount: elig.pending.length,
        });
      }
      res.json(withStatus);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/helper/services/:id", auth, helperOnly, async (req, res) => {
    try {
      const deleted = await HelperService.findOneAndDelete({
        _id: req.params.id, helper: req.user.id,
      });
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.json({ message: "Removed", id: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------------- ADMIN: review requirement submissions ----------------

  app.get("/api/admin/submissions", auth, adminOnly, async (req, res) => {
    try {
      const status = req.query.status || "pending";
      const list = await RequirementSubmission.find({ status })
        .populate("user", "name phone role")
        .populate("requirement", "title titleBangla forWhom isMandatory")
        .populate("service", "name nameBangla")
        .sort({ updatedAt: -1 });
      res.json(list);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/admin/submissions/:id", auth, adminOnly, async (req, res) => {
    try {
      const { decision, rejectionReason } = req.body;
      if (!["approve", "reject"].includes(decision)) {
        return res.status(400).json({ error: "decision must be approve or reject" });
      }
      const update = decision === "approve"
        ? { status: "approved", rejectionReason: null, reviewedAt: new Date() }
        : {
            status: "rejected",
            rejectionReason: rejectionReason || "Not acceptable",
            reviewedAt: new Date(),
          };
      const updated = await RequirementSubmission.findByIdAndUpdate(req.params.id, update, { new: true })
        .populate("user", "name phone")
        .populate("requirement", "title titleBangla");
      if (!updated) return res.status(404).json({ error: "Submission not found" });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};