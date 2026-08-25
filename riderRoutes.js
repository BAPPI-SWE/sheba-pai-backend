/**
 * Rider job feed and delivery lifecycle — a rider's counterpart to the
 * caregiver's accept/track/complete flow, but for medicine deliveries.
 *
 * Wire into index.js:
 *   const riderRoutes = require("./riderRoutes");
 *   riderRoutes(app, { auth, riderOnly, adminOnly });
 */
const Order = require("./models/Order");
const Shop = require("./models/Shop");
const RiderProfile = require("./models/RiderProfile");
const { getSettings, haversineKm } = require("./deliveryRouting");
const { sendPush } = require("./pushService");

module.exports = function riderRoutes(app, deps) {
  const { auth, riderOnly, adminOnly } = deps;

  /** Go online/offline and update current location — same shape as the caregiver toggle. */
  app.patch("/api/rider/location", auth, riderOnly, async (req, res) => {
    try {
      const { longitude, latitude, isAvailable } = req.body;
      if (isAvailable) {
        const profile = await RiderProfile.findOne({ user: req.user.id });
        if (!profile || profile.verificationStatus !== "approved") {
          return res.status(403).json({ error: "Your account is not verified yet" });
        }
      }
      const update = { isAvailable: !!isAvailable };
      if (longitude != null && latitude != null) {
        update.location = { type: "Point", coordinates: [Number(longitude), Number(latitude)] };
      }
      const profile = await RiderProfile.findOneAndUpdate({ user: req.user.id }, update, { new: true, upsert: false });
      if (!profile) return res.status(404).json({ error: "Rider profile not found" });
      res.json(profile);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * GET /api/rider/jobs — local delivery jobs awaiting a rider, near me.
   * Pre-accept privacy: shop address is shown in full (a rider needs it to
   * navigate and it isn't sensitive the way a patient's home is), but the
   * PATIENT's exact address is withheld until accepted — same principle
   * used for caregiver dispatch.
   */
  app.get("/api/rider/jobs", auth, riderOnly, async (req, res) => {
    try {
      const profile = await RiderProfile.findOne({ user: req.user.id });
      if (!profile || !profile.location?.coordinates) return res.json([]);

      const settings = await getSettings();
      const [myLng, myLat] = profile.location.coordinates;

      const jobs = await Order.find({
        fulfillmentType: "local",
        status: "pending",
        assignedRider: null,
      }).populate("matchedShop", "name address location");

      const nearby = jobs
        .filter((j) => j.matchedShop)
        .map((j) => {
          const [shopLng, shopLat] = j.matchedShop.location.coordinates;
          const distanceKm = Math.round(haversineKm(myLat, myLng, shopLat, shopLng) * 10) / 10;
          return { job: j, distanceKm };
        })
        .filter((x) => x.distanceKm <= settings.riderMatchRadiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map(({ job, distanceKm }) => ({
          orderId: job._id,
          shop: { name: job.matchedShop.name, address: job.matchedShop.address, location: job.matchedShop.location },
          items: job.items.map((i) => ({ brandName: i.brandName, strength: i.strength, quantity: i.quantity })),
          distanceKm,
          deliveryFeeEarned: settings.riderPayoutPerDelivery,
          // rough area only — not the exact address, until accepted
          roughArea: job.address ? job.address.split(",").slice(-2).join(",").trim() : null,
        }));

      res.json(nearby);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/rider/jobs/:id/accept — atomic first-accept-wins, same pattern as caregiver requests. */
  app.patch("/api/rider/jobs/:id/accept", auth, riderOnly, async (req, res) => {
    try {
      const profile = await RiderProfile.findOne({ user: req.user.id });
      if (!profile || profile.verificationStatus !== "approved") {
        return res.status(403).json({ error: "Your account is not verified yet" });
      }

      const order = await Order.findOneAndUpdate(
        { _id: req.params.id, status: "pending", fulfillmentType: "local", assignedRider: null },
        { status: "rider_assigned", assignedRider: req.user.id, $push: { statusHistory: { status: "rider_assigned", by: req.user.id } } },
        { new: true }
      ).populate("matchedShop", "name address contactPhone location");

      if (!order) return res.status(409).json({ error: "This job was just taken by another rider" });

      const io = req.app.get("io");
      io.to(order.patient.toString()).emit("orderUpdated", order);

      res.json(order);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/rider/active — this rider's current job(s), full detail (patient address now visible). */
  app.get("/api/rider/active", auth, riderOnly, async (req, res) => {
    try {
      const orders = await Order.find({
        assignedRider: req.user.id,
        status: { $in: ["rider_assigned", "picked_up", "out_for_delivery"] },
      }).populate("patient", "name phone").populate("matchedShop", "name address contactPhone location");
      res.json(orders);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/rider/jobs/:id/eta — rider sets/updates an estimated delivery time. */
  app.patch("/api/rider/jobs/:id/eta", auth, riderOnly, async (req, res) => {
    try {
      const { minutes } = req.body;
      const order = await Order.findOneAndUpdate(
        { _id: req.params.id, assignedRider: req.user.id },
        { riderEtaMinutes: Math.max(1, parseInt(minutes) || 15) },
        { new: true }
      );
      if (!order) return res.status(404).json({ error: "Not found" });
      req.app.get("io").to(order.patient.toString()).emit("orderUpdated", order);
      res.json(order);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/rider/jobs/:id/status — advance out_for_delivery -> delivered, with live location updates along the way. */
  app.patch("/api/rider/jobs/:id/status", auth, riderOnly, async (req, res) => {
    try {
      const { status, longitude, latitude } = req.body;
      const valid = ["out_for_delivery", "delivered"];
      if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

      const order = await Order.findOne({ _id: req.params.id, assignedRider: req.user.id });
      if (!order) return res.status(404).json({ error: "Not found" });
      if (status === "out_for_delivery" && order.status !== "picked_up") {
        return res.status(409).json({ error: "Must confirm pickup at the shop before heading out" });
      }
      if (status === "delivered" && order.status !== "out_for_delivery") {
        return res.status(409).json({ error: "Order must be out for delivery first" });
      }

      order.status = status;
      if (longitude != null && latitude != null) {
        order.riderLocation = { type: "Point", coordinates: [Number(longitude), Number(latitude)] };
      }
      order.statusHistory.push({ status, by: req.user.id });
      if (status === "delivered") {
        order.deliveredAt = new Date();
        await RiderProfile.findOneAndUpdate(
          { user: req.user.id },
          { $inc: { totalDeliveries: 1, totalEarned: order.deliveryFee, pendingPayout: order.deliveryFee } }
        );
      }
      await order.save();

      req.app.get("io").to(order.patient.toString()).emit("orderUpdated", order);
      res.json(order);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/rider/location-ping — stream live location while a job is active (same pattern as caregiver tracking). */
  app.patch("/api/rider/location-ping", auth, riderOnly, async (req, res) => {
    try {
      const { orderId, longitude, latitude } = req.body;
      const order = await Order.findOne({ _id: orderId, assignedRider: req.user.id });
      if (!order) return res.status(404).json({ error: "Not found" });
      order.riderLocation = { type: "Point", coordinates: [Number(longitude), Number(latitude)] };
      await order.save();
      req.app.get("io").to(order.patient.toString()).emit("riderLocation", {
        orderId: order._id, latitude: Number(latitude), longitude: Number(longitude),
      });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};