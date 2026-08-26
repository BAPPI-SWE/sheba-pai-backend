/**
 * Medicine orders — checkout, order history, admin fulfilment.
 *
 * Wire into index.js:
 *   const orderRoutes = require("./orderRoutes");
 *   orderRoutes(app, { auth, adminOnly, upload, uploadToCloudinary });
 */
const mongoose = require("mongoose");
const Medicine = require("./models/Medicine");
const Order = require("./models/Order");
const ShopStock = require("./models/ShopStock");
const Shop = require("./models/Shop");
const RiderProfile = require("./models/RiderProfile");
const { priceInfo } = require("./pricing");
const { decideFulfillment, generatePickupCode, getSettings } = require("./deliveryRouting");
const { sendPush } = require("./pushService");

/** Notify online, approved riders near the matched shop about a new job. */
async function notifyNearbyRiders(io, shop, order) {
  try {
    const settings = await getSettings();
    const riders = await RiderProfile.find({
      verificationStatus: "approved",
      isAvailable: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: shop.location.coordinates },
          $maxDistance: settings.riderMatchRadiusKm * 1000,
        },
      },
    }).select("user");

    if (riders.length === 0) return;
    const riderUserIds = riders.map((r) => r.user);

    if (io) riderUserIds.forEach((uid) => io.to(uid.toString()).emit("newDeliveryJob", { orderId: order._id }));

    sendPush(riderUserIds, {
      title: "নতুন ডেলিভারি অর্ডার",
      body: `${shop.name} থেকে ওষুধ সংগ্রহ করে ডেলিভারি দিন`,
      data: { type: "new_delivery_job", orderId: String(order._id) },
    });
  } catch (err) {
    console.error("Rider notification failed:", err.message);
  }
}

module.exports = function orderRoutes(app, deps) {
  const { auth, adminOnly, upload, uploadToCloudinary, shopOnly } = deps;

  /**
   * POST /api/orders — place an order.
   * body: { items: [{ medicineId, quantity }], address, longitude, latitude,
   *         contactPhone, paymentMethod }
   *
   * Stock is checked and decremented ATOMICALLY per item (findOneAndUpdate
   * with a stock >= quantity guard) so two simultaneous checkouts can never
   * both succeed on the last unit — one will correctly fail with "out of
   * stock" instead of silently overselling.
   */
  /**
   * POST /api/orders/quote — the real delivery fee, computed BEFORE the
   * customer commits, using the exact same routing logic checkout itself
   * uses. Pure read: never reserves stock or creates anything, so it's
   * safe to call every time the delivery address changes.
   */
  app.post("/api/orders/quote", auth, async (req, res) => {
    try {
      let { items, longitude, latitude } = req.body;
      if (typeof items === "string") items = JSON.parse(items);
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      if (longitude == null || latitude == null) {
        return res.status(400).json({ error: "Delivery location is required" });
      }

      let subtotal = 0;
      const routingItems = [];
      for (const line of items) {
        const qty = Math.max(1, parseInt(line.quantity) || 1);
        const medicine = await Medicine.findOne({ _id: line.medicineId, isActive: true, isDiscontinued: false });
        if (!medicine) continue; // quote skips unavailable items rather than failing the whole preview
        const { effectivePrice } = priceInfo(medicine);
        subtotal += Math.round(effectivePrice * qty * 100) / 100;
        routingItems.push({ medicineId: medicine._id, quantity: qty });
      }

      const routing = await decideFulfillment(Number(latitude), Number(longitude), routingItems);
      res.json({
        subtotal,
        deliveryFee: routing.deliveryFee,
        total: subtotal + routing.deliveryFee,
        fulfillmentType: routing.fulfillmentType,
      });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post("/api/orders", auth, upload.single("prescription"), async (req, res) => {
    const decremented = []; // { pool: "central"|"shop", id, qty } — for rollback on failure
    try {
      let { items, address, longitude, latitude, contactPhone } = req.body;
      if (typeof items === "string") items = JSON.parse(items); // multipart sends items as a JSON string

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      if (!contactPhone) return res.status(400).json({ error: "Contact phone is required" });
      if (!longitude || !latitude) return res.status(400).json({ error: "Delivery location is required" });

      // --- Pass 1: read-only. Get product info to build the order and
      // price it — routing/stock decisions happen separately below, since
      // we don't yet know whether this ships from a local shop or central
      // stock, and that decision needs the medicine IDs + quantities first.
      const orderItems = [];
      let subtotal = 0;
      let needsPrescription = false;
      const routingItems = []; // [{ medicineId, quantity }] for decideFulfillment

      for (const line of items) {
        const qty = Math.max(1, parseInt(line.quantity) || 1);
        const medicine = await Medicine.findOne({ _id: line.medicineId, isActive: true, isDiscontinued: false });
        if (!medicine) return res.status(400).json({ error: "One of the items in your cart is no longer available" });

        if (medicine.prescriptionRequired) needsPrescription = true;
        const { effectivePrice } = priceInfo(medicine);
        const lineTotal = Math.round(effectivePrice * qty * 100) / 100;
        subtotal += lineTotal;
        orderItems.push({
          medicine: medicine._id, brandName: medicine.brandName, strength: medicine.strength,
          quantity: qty, unitPrice: effectivePrice, lineTotal, prescriptionRequired: medicine.prescriptionRequired,
        });
        routingItems.push({ medicineId: medicine._id, quantity: qty });
      }

      // --- Decide fulfillment ONCE, here, from real-time shop stock and
      // the delivery coordinates. This is the only place that decision is
      // made — the fee it returns is final and never recalculated later.
      let routing = await decideFulfillment(Number(latitude), Number(longitude), routingItems);

      // --- Pass 2: reserve the actual stock, from whichever pool routing
      // chose. If a local reservation loses a race (another order took the
      // last unit between the read and now), we don't fail the checkout —
      // we gracefully fall back to central fulfillment instead.
      async function reserveFromShop(shop) {
        for (const item of routingItems) {
          const stockDoc = await ShopStock.findOneAndUpdate(
            { shop: shop._id, medicine: item.medicineId, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { new: true }
          );
          if (!stockDoc) {
            for (const d of decremented) {
              if (d.pool === "shop") await ShopStock.updateOne({ shop: d.shopId, medicine: d.id }, { $inc: { stock: d.qty } });
            }
            decremented.length = 0;
            return false;
          }
          decremented.push({ pool: "shop", id: item.medicineId, qty: item.quantity, shopId: shop._id });
        }
        return true;
      }
      async function reserveFromCentral() {
        for (const item of routingItems) {
          const medicine = await Medicine.findOneAndUpdate(
            { _id: item.medicineId, stock: { $gte: item.quantity }, isActive: true, isDiscontinued: false },
            { $inc: { stock: -item.quantity, salesCount: item.quantity } },
            { new: true }
          );
          if (!medicine) {
            for (const d of decremented) {
              if (d.pool === "central") await Medicine.updateOne({ _id: d.id }, { $inc: { stock: d.qty, salesCount: -d.qty } });
            }
            decremented.length = 0;
            return false;
          }
          decremented.push({ pool: "central", id: item.medicineId, qty: item.quantity });
        }
        return true;
      }

      if (routing.fulfillmentType === "local") {
        const reserved = await reserveFromShop(routing.matchedShop);
        if (!reserved) {
          // The shop match didn't hold — fall back to central rather than
          // fail the customer's checkout over a timing race.
          const settings = await getSettings();
          routing = {
            fulfillmentType: "central",
            isInsideDhaka: routing.isInsideDhaka,
            deliveryFee: routing.isInsideDhaka ? settings.courierFeeInsideDhaka : settings.courierFeeOutsideDhaka,
            matchedShop: null,
            routingNote: "A matching shop was found, but lost the stock to another order at the last moment.",
          };
        }
      }
      if (routing.fulfillmentType === "central") {
        const reserved = await reserveFromCentral();
        if (!reserved) {
          return res.status(409).json({ error: "Not enough stock for one of the items in your cart. Please review your cart." });
        }
      }

      let prescriptionUrl = null;
      if (needsPrescription) {
        if (!req.file) {
          for (const d of decremented) {
            if (d.pool === "shop") await ShopStock.updateOne({ shop: d.shopId, medicine: d.id }, { $inc: { stock: d.qty } });
            else await Medicine.updateOne({ _id: d.id }, { $inc: { stock: d.qty, salesCount: -d.qty } });
          }
          return res.status(400).json({ error: "A prescription photo is required for one or more items in your cart" });
        }
        prescriptionUrl = await uploadToCloudinary(req.file.buffer, "prescriptions");
      }

      const pickupCode = routing.fulfillmentType === "local" ? generatePickupCode() : null;

      const order = await new Order({
        patient: req.user.id,
        items: orderItems,
        subtotal, deliveryFee: routing.deliveryFee, total: subtotal + routing.deliveryFee,
        address: address || null,
        location: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
        contactPhone,
        prescriptionUrl,
        fulfillmentType: routing.fulfillmentType,
        isInsideDhaka: routing.isInsideDhaka,
        matchedShop: routing.matchedShop ? routing.matchedShop._id : null,
        pickupCode,
        routingNote: routing.routingNote || null,
        statusHistory: [{ status: "pending", by: req.user.id }],
      }).save();

      if (routing.fulfillmentType === "local") {
        notifyNearbyRiders(req.app.get("io"), routing.matchedShop, order);
      }

      res.status(201).json(order);
    } catch (err) {
      // Best-effort rollback if something unexpected failed mid-way —
      // route back to whichever pool each item actually came from.
      for (const d of decremented) {
        if (d.pool === "shop") {
          await ShopStock.updateOne({ shop: d.shopId, medicine: d.id }, { $inc: { stock: d.qty } }).catch(() => {});
        } else {
          await Medicine.updateOne({ _id: d.id }, { $inc: { stock: d.qty, salesCount: -d.qty } }).catch(() => {});
        }
      }
      res.status(400).json({ error: err.message });
    }
  });

  // ============ SHOP: view and confirm pickups ============

  /** GET /api/shop/orders — everything currently relevant to my shop. */
  app.get("/api/shop/orders", auth, shopOnly, async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.user.id });
      if (!shop) return res.status(404).json({ error: "No shop profile found for this account" });

      const orders = await Order.find({
        matchedShop: shop._id,
        status: { $in: ["pending", "rider_assigned", "picked_up"] },
      })
        .populate("assignedRider", "name phone")
        .sort({ createdAt: -1 });
      res.json(orders);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /**
   * PATCH /api/shop/orders/:id/confirm-pickup — the shop verifies the
   * rider's pickup code before releasing the medicine. This is a pure
   * handoff confirmation — stock was already reserved at checkout, so
   * this step never touches inventory, only the order's status.
   */
  app.patch("/api/shop/orders/:id/confirm-pickup", auth, shopOnly, async (req, res) => {
    try {
      const { pickupCode } = req.body;
      const shop = await Shop.findOne({ owner: req.user.id });
      if (!shop) return res.status(404).json({ error: "No shop profile found for this account" });

      const order = await Order.findOne({ _id: req.params.id, matchedShop: shop._id });
      if (!order) return res.status(404).json({ error: "Order not found for this shop" });
      if (order.status !== "rider_assigned") {
        return res.status(409).json({ error: "This order isn't awaiting pickup right now" });
      }
      if (!pickupCode || pickupCode !== order.pickupCode) {
        return res.status(400).json({ error: "That pickup code doesn't match" });
      }

      order.status = "picked_up";
      order.pickupVerifiedAt = new Date();
      order.statusHistory.push({ status: "picked_up", by: req.user.id });
      await order.save();

      const io = req.app.get("io");
      if (order.assignedRider) io.to(order.assignedRider.toString()).emit("pickupConfirmed", { orderId: order._id });
      io.to(order.patient.toString()).emit("orderUpdated", order);

      res.json(order);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/orders — the logged-in patient's own order history. */
  app.get("/api/orders", auth, async (req, res) => {
    try {
      const orders = await Order.find({ patient: req.user.id })
        .select("-pickupCode")
        .populate("matchedShop", "name")
        .sort({ createdAt: -1 }).limit(50);
      res.json(orders);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/orders/:id — a single order (must belong to the requester, unless admin). */
  app.get("/api/orders/:id", auth, async (req, res) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate("patient", "name phone")
        .populate("matchedShop", "name address contactPhone location")
        .populate("assignedRider", "name phone");
      if (!order) return res.status(404).json({ error: "Not found" });
      if (order.patient._id.toString() !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not your order" });
      }
      // The pickup code is a shop/rider handoff detail — the patient never needs it.
      const obj = order.toObject();
      delete obj.pickupCode;
      res.json(obj);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/orders/:id/cancel — patient cancels their own order, only while still pending. */
  app.patch("/api/orders/:id/cancel", auth, async (req, res) => {
    try {
      const order = await Order.findOne({ _id: req.params.id, patient: req.user.id });
      if (!order) return res.status(404).json({ error: "Not found" });
      if (order.status !== "pending") {
        return res.status(409).json({ error: "This order can no longer be cancelled" });
      }
      // Restock everything in the cancelled order.
      for (const item of order.items) {
        await Medicine.updateOne({ _id: item.medicine }, { $inc: { stock: item.quantity, salesCount: -item.quantity } });
      }
      order.status = "cancelled";
      order.cancelReason = req.body.reason || null;
      order.statusHistory.push({ status: "cancelled", by: req.user.id });
      await order.save();
      res.json(order);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ============ ADMIN: fulfilment ============

  /** GET /api/admin/orders?status=pending — the fulfilment queue. */
  app.get("/api/admin/orders", auth, adminOnly, async (req, res) => {
    try {
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      const orders = await Order.find(filter).populate("patient", "name phone").sort({ createdAt: -1 }).limit(100);
      res.json(orders);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** PATCH /api/admin/orders/:id/status — advance an order through fulfilment. */
  app.patch("/api/admin/orders/:id/status", auth, adminOnly, async (req, res) => {
    try {
      const { status } = req.body;
      const valid = ["confirmed", "out_for_delivery", "delivered", "cancelled"];
      if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ error: "Not found" });

      // If admin cancels, restock (mirrors the patient-cancel path).
      if (status === "cancelled" && order.status !== "cancelled") {
        for (const item of order.items) {
          await Medicine.updateOne({ _id: item.medicine }, { $inc: { stock: item.quantity, salesCount: -item.quantity } });
        }
      }

      order.status = status;
      order.statusHistory.push({ status, by: req.user.id });
      await order.save();
      res.json(order);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
};