/**
 * Commission & earnings system.
 *   - Computes final job amount + commission at completion (hooked from index.js).
 *   - Restriction check: a helper with overdue unpaid commission cannot go online.
 *   - Helper: view earnings/balance, submit a bKash/Nagad/Rocket payment.
 *   - Admin: set per-service commission %, set grace period, review payments.
 *
 * Wire into index.js:
 *   const commissionRoutes = require("./commissionRoutes");
 *   commissionRoutes(app, { auth, adminOnly, helperOnly });
 *   const { finalizeJobEarnings, isHelperRestricted } = require("./commissionRoutes");
 */
const HelperProfile = require("./models/HelperProfile");
const HelperService = require("./models/HelperService");
const Service = require("./models/Service");
const Request = require("./models/Request");
const PaymentSubmission = require("./models/PaymentSubmission");
const PlatformSettings = require("./models/PlatformSettings");

async function getSettings() {
  let s = await PlatformSettings.findOne({ key: "global" });
  if (!s) s = await PlatformSettings.create({ key: "global" });
  return s;
}

/**
 * Called when a job transitions to "completed".
 * Computes the final amount (hourly: duration × rate; fixed: the set price),
 * the commission owed, updates the request, and adds to the helper's balance
 * with a due date based on the grace period.
 */
async function finalizeJobEarnings(request) {
  // Manually-booked (call-for-price) jobs already have their price and
  // commission set — by the admin, at creation, after a WhatsApp/phone
  // negotiation. There's no HelperService listing to look up (the whole
  // point is this job isn't in the normal price catalog), so the usual
  // computation would find nothing and silently skip crediting the
  // caregiver at all. Credit exactly what was already agreed instead.
  if (request.bookingSource === "manual" && request.finalAmount != null) {
    await creditHelperEarnings(request.helper, request.finalAmount, request.commissionAmount || 0);
    return;
  }

  const offering = await HelperService.findOne({ helper: request.helper, service: request.subService });
  const service = request.subService ? await Service.findById(request.subService) : null;
  if (!offering || !service) return; // legacy/broadcast request with no priced sub-service — skip

  let finalAmount = 0;
  if (offering.chargeType === "hourly") {
    const start = request.helpingStartedAt ? new Date(request.helpingStartedAt) : null;
    const end = new Date();
    const hours = start ? Math.max((end - start) / 3600000, 0) : 0;
    finalAmount = Math.round(hours * offering.amount * 100) / 100;
  } else {
    finalAmount = offering.amount;
  }

  const percent = service.commissionPercent || 0;
  const commissionAmount = Math.round(finalAmount * (percent / 100) * 100) / 100;

  request.finalAmount = finalAmount;
  request.commissionAmount = commissionAmount;
  request.commissionPercentApplied = percent;
  await request.save();

  await creditHelperEarnings(request.helper, finalAmount, commissionAmount);
}

/** Shared by both the normal and manual-booking paths — the actual payout bookkeeping. */
async function creditHelperEarnings(helperId, finalAmount, commissionAmount) {
  if (commissionAmount > 0) {
    const settings = await getSettings();
    const dueDate = new Date(Date.now() + settings.commissionGraceDays * 86400000);
    const profile = await HelperProfile.findOne({ user: helperId });
    if (profile) {
      profile.totalEarned = (profile.totalEarned || 0) + finalAmount;
      profile.commissionBalance = (profile.commissionBalance || 0) + commissionAmount;
      // Only start a payment clock once the balance actually goes POSITIVE —
      // a helper who's in credit should have that credit absorb new
      // commission first, without a due date appearing while they still
      // owe nothing.
      if (profile.commissionBalance > 0 && !profile.oldestUnpaidDueDate) {
        profile.oldestUnpaidDueDate = dueDate;
      }
      await profile.save();
    }
  } else {
    // Even a zero-commission manual job should still count toward totalEarned.
    const profile = await HelperProfile.findOne({ user: helperId });
    if (profile) {
      profile.totalEarned = (profile.totalEarned || 0) + finalAmount;
      await profile.save();
    }
  }
}

/** Lazily computed: true if the helper has overdue unpaid commission. */
async function isHelperRestricted(userId) {
  const profile = await HelperProfile.findOne({ user: userId });
  if (!profile) return false;
  if (profile.commissionBalance <= 0) return false;
  if (!profile.oldestUnpaidDueDate) return false;
  return new Date() > new Date(profile.oldestUnpaidDueDate);
}

module.exports = function commissionRoutes(app, deps) {
  const { auth, adminOnly, helperOnly } = deps;

  // --- HELPER: view earnings + balance + restriction status ---
  app.get("/api/helper/earnings", auth, helperOnly, async (req, res) => {
    try {
      const profile = await HelperProfile.findOne({ user: req.user.id });
      const restricted = await isHelperRestricted(req.user.id);
      const settings = await getSettings();
      const pendingPayments = await PaymentSubmission.find({ helper: req.user.id, status: "pending" });
      res.json({
        totalEarned: profile?.totalEarned || 0,
        commissionBalance: profile?.commissionBalance || 0,
        dueDate: profile?.oldestUnpaidDueDate || null,
        isRestricted: restricted,
        graceDays: settings.commissionGraceDays,
        pendingPaymentsTotal: pendingPayments.reduce((sum, p) => sum + p.amount, 0),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- HELPER: submit a bKash/Nagad/Rocket payment ---
  app.post("/api/helper/payments", auth, helperOnly, async (req, res) => {
    try {
      const { method, senderPhone, transactionId, amount } = req.body;
      if (!["bkash", "nagad", "rocket"].includes(method)) return res.status(400).json({ error: "Invalid payment method" });
      if (!senderPhone || !transactionId) return res.status(400).json({ error: "Phone and transaction ID required" });
      if (!amount || amount <= 0) return res.status(400).json({ error: "Enter a valid amount" });

      const submission = await PaymentSubmission.create({
        helper: req.user.id, method, senderPhone: senderPhone.trim(),
        transactionId: transactionId.trim(), amount,
      });
      res.status(201).json(submission);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- HELPER: per-job earnings statement (the auditable breakdown) ---
  app.get("/api/helper/earnings-history", auth, helperOnly, async (req, res) => {
    try {
      const jobs = await Request.find({
        helper: req.user.id,
        status: "completed",
        finalAmount: { $ne: null },
      })
        .sort({ endedAt: -1 })
        .limit(50)
        .populate("patient", "name")
        .select("serviceName finalAmount commissionAmount commissionPercentApplied endedAt patient chargeType")
        .lean();

      const history = jobs.map((j) => ({
        id: j._id,
        serviceName: j.serviceName,
        patientName: j.patient?.name || null,
        date: j.endedAt,
        gross: j.finalAmount,
        commissionPercent: j.commissionPercentApplied || 0,
        commission: j.commissionAmount || 0,
        net: Math.round((j.finalAmount - (j.commissionAmount || 0)) * 100) / 100,
      }));

      res.json(history);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- HELPER: my payment history ---
  app.get("/api/helper/payments", auth, helperOnly, async (req, res) => {
    try {
      const payments = await PaymentSubmission.find({ helper: req.user.id }).sort({ createdAt: -1 });
      res.json(payments);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- ADMIN: platform settings (grace period) ---
  app.get("/api/admin/settings", auth, adminOnly, async (req, res) => {
    try { res.json(await getSettings()); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.patch("/api/admin/settings", auth, adminOnly, async (req, res) => {
    try {
      const { commissionGraceDays, maxConcurrentJobs, searchRadiusKm, browsePageSize, supportWhatsAppNumber, emergencyContactNumber, privacyPolicyUrl, termsUrl, accountDeletionUrl } = req.body;
      const settings = await getSettings();

      // Links must be real web addresses — a typo here would put a dead link
      // inside the app, which is exactly what a Play reviewer clicks first.
      const cleanUrl = (v) => {
        const s = String(v || "").trim();
        if (!s) return null;
        if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(s)) throw new Error(`"${s}" is not a valid web address (it must start with https://)`);
        return s;
      };

      // Each is clamped to a sane range so a typo can't break the platform.
      if (commissionGraceDays !== undefined) {
        settings.commissionGraceDays = Math.max(1, Number(commissionGraceDays) || 3);
      }
      if (maxConcurrentJobs !== undefined) {
        settings.maxConcurrentJobs = Math.min(20, Math.max(1, Number(maxConcurrentJobs) || 3));
      }
      if (searchRadiusKm !== undefined) {
        settings.searchRadiusKm = Math.min(100, Math.max(1, Number(searchRadiusKm) || 20));
      }
      if (browsePageSize !== undefined) {
        settings.browsePageSize = Math.min(50, Math.max(3, Number(browsePageSize) || 10));
      }
      if (supportWhatsAppNumber !== undefined) {
        settings.supportWhatsAppNumber = supportWhatsAppNumber || null;
      }
      if (emergencyContactNumber !== undefined) {
        settings.emergencyContactNumber = emergencyContactNumber || null;
      }
      if (privacyPolicyUrl !== undefined) settings.privacyPolicyUrl = cleanUrl(privacyPolicyUrl);
      if (termsUrl !== undefined) settings.termsUrl = cleanUrl(termsUrl);
      if (accountDeletionUrl !== undefined) settings.accountDeletionUrl = cleanUrl(accountDeletionUrl);

      await settings.save();
      res.json(settings);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/settings/public — the small subset of settings the APP needs
   * and is safe to expose without a login (currently just the WhatsApp
   * number "Call for price" buttons open). Deliberately not the full
   * settings object — radius/fee/grace-period numbers stay admin-only.
   */
  app.get("/api/settings/public", async (req, res) => {
    try {
      const settings = await getSettings();
      res.json({
        supportWhatsAppNumber: settings.supportWhatsAppNumber || null,
        emergencyContactNumber: settings.emergencyContactNumber || null,
        privacyPolicyUrl: settings.privacyPolicyUrl || null,
        termsUrl: settings.termsUrl || null,
        accountDeletionUrl: settings.accountDeletionUrl || null,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- ADMIN: list payment submissions (default: pending) ---
  app.get("/api/admin/payments", auth, adminOnly, async (req, res) => {
    try {
      const status = req.query.status || "pending";
      const payments = await PaymentSubmission.find({ status }).sort({ createdAt: -1 }).populate("helper", "name phone");
      res.json(payments);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- ADMIN: approve/reject a payment submission ---
  app.patch("/api/admin/payments/:id", auth, adminOnly, async (req, res) => {
    try {
      const { decision, rejectionReason } = req.body; // "approve" | "reject"
      const submission = await PaymentSubmission.findById(req.params.id);
      if (!submission) return res.status(404).json({ error: "Not found" });
      if (submission.status !== "pending") return res.status(409).json({ error: "Already reviewed" });

      submission.status = decision === "approve" ? "approved" : "rejected";
      submission.rejectionReason = decision === "approve" ? null : (rejectionReason || null);
      submission.reviewedBy = req.user.id;
      submission.reviewedAt = new Date();
      await submission.save();

      if (decision === "approve") {
        const profile = await HelperProfile.findOne({ user: submission.helper });
        if (profile) {
          profile.commissionBalance = (profile.commissionBalance || 0) - submission.amount;
          // Overpaying is allowed on purpose: the excess becomes CREDIT
          // (a negative balance) that automatically offsets the helper's
          // next commission, instead of being clamped away and lost.
          if (profile.commissionBalance <= 0) {
            profile.oldestUnpaidDueDate = null; // nothing currently owed — paid up or in credit
          }
          // Note: if partially paid, oldestUnpaidDueDate intentionally stays as-is
          // (the remaining balance is still tied to the original due date).
          await profile.save();
        }
      }

      res.json(submission);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};

module.exports.getSettings = getSettings;
module.exports.finalizeJobEarnings = finalizeJobEarnings;
module.exports.isHelperRestricted = isHelperRestricted;