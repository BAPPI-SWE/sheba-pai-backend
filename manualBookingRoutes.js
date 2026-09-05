/**
 * The "call for price" flow's admin-side half: after a patient (or family
 * member) reaches out over WhatsApp/phone, an admin looks them up, picks
 * a caregiver, and manually creates the booking with a negotiated price.
 * From that point on it behaves exactly like an app-created request —
 * same tracking, same profiles, same commission bookkeeping — the only
 * difference is HOW it was created (see Request.bookingSource).
 *
 * Wire into index.js:
 *   const manualBookingRoutes = require("./manualBookingRoutes");
 *   manualBookingRoutes(app, { auth, adminOnly });
 */
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");
const Service = require("./models/Service");
const Request = require("./models/Request");
const { sendPush } = require("./pushService");

module.exports = function manualBookingRoutes(app, deps) {
  const { auth, adminOnly } = deps;

  /** GET /api/admin/patients/search?phone=... — find a patient to book for. */
  app.get("/api/admin/patients/search", auth, adminOnly, async (req, res) => {
    try {
      const q = (req.query.phone || "").trim();
      if (q.length < 3) return res.json([]);
      const patients = await User.find({ role: "patient", phone: new RegExp(q) })
        .select("name phone savedAddresses")
        .limit(10);
      res.json(patients);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/admin/helpers/search?q=... — find an approved caregiver to assign. */
  app.get("/api/admin/helpers/search", auth, adminOnly, async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      if (q.length < 2) return res.json([]);
      const users = await User.find({
        role: "helper",
        $or: [{ name: new RegExp(q, "i") }, { phone: new RegExp(q) }],
      }).select("name phone").limit(15);

      const profiles = await HelperProfile.find({
        user: { $in: users.map((u) => u._id) },
        verificationStatus: "approved",
      }).select("user");
      const approvedIds = new Set(profiles.map((p) => p.user.toString()));

      res.json(users.filter((u) => approvedIds.has(u._id.toString())));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * POST /api/admin/manual-bookings — create the booking after the
   * WhatsApp/phone conversation.
   *
   * This does NOT pre-accept the job on the caregiver's behalf — it's
   * created as a normal "searching" request targeted at just this one
   * caregiver, using the exact same targeted-request mechanism as a
   * regular browse-and-choose booking. The caregiver still sees it in
   * their incoming requests and explicitly accepts or ignores it, same
   * as always — admin picking them doesn't remove their say in it.
   *
   * Coordinates are required, not optional: the incoming-requests feed
   * finds nearby jobs with a geospatial query, so a request with no
   * location would silently never reach the caregiver at all, no matter
   * how correctly everything else was set up.
   */
  app.post("/api/admin/manual-bookings", auth, adminOnly, async (req, res) => {
    try {
      const { patientId, helperId, subServiceId, serviceName, price, commissionPercent, address, longitude, latitude } = req.body;

      if (!patientId || !helperId || !serviceName || price == null) {
        return res.status(400).json({ error: "Patient, caregiver, service name, and price are all required" });
      }
      if (longitude == null || latitude == null) {
        return res.status(400).json({ error: "A location is required — without it, the caregiver's app can't find this job at all" });
      }

      const patient = await User.findOne({ _id: patientId, role: "patient" });
      if (!patient) return res.status(404).json({ error: "Patient not found" });

      const helperProfile = await HelperProfile.findOne({ user: helperId, verificationStatus: "approved" });
      if (!helperProfile) return res.status(404).json({ error: "Caregiver not found or not approved" });

      let subService = null;
      let roleList = [];
      if (subServiceId) {
        subService = await Service.findById(subServiceId);
        if (subService) {
          const main = await Service.findById(subService.parent);
          roleList = main?.helperRoles || [];
        }
      }

      const finalAmount = Math.round(Number(price) * 100) / 100;
      const percent = Math.max(0, Math.min(100, Number(commissionPercent) || 0));
      const commissionAmount = Math.round(finalAmount * (percent / 100) * 100) / 100;

      const request = await new Request({
        patient: patient._id,
        role: roleList[0] || "any",
        acceptedRoles: roleList,
        serviceName,
        subService: subService ? subService._id : null,
        targetedHelpers: [helperId], // seen only by this caregiver, exactly like a normal targeted request
        status: "searching", // caregiver still has to actually accept it
        address: address || null,
        roughArea: address || null,
        location: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
        bookingSource: "manual",
        // Price/commission are set now, at creation (already negotiated),
        // not left to be computed at completion the normal way — see
        // finalizeJobEarnings for how this is honored later.
        finalAmount,
        commissionAmount,
        commissionPercentApplied: percent,
      }).save();

      sendPush([helperId], {
        title: "নতুন অনুরোধ",
        body: `${serviceName} — একটি নতুন কাজের অনুরোধ এসেছে`,
        data: { type: "new_request", requestId: String(request._id) },
      });

      res.status(201).json(request);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};