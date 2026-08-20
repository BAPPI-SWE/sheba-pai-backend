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

module.exports = function orderRoutes(app, deps) {
  const { auth, adminOnly, upload, uploadToCloudinary } = deps;

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
  app.post("/api/orders", auth, upload.single("prescription"), async (req, res) => {
    const decremented = []; // track what we've already deducted, to roll back on failure
    try {
      let { items, address, longitude, latitude, contactPhone } = req.body;
      if (typeof items === "string") items = JSON.parse(items); // multipart sends items as a JSON string

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      if (!contactPhone) return res.status(400).json({ error: "Contact phone is required" });

      const orderItems = [];
      let subtotal = 0;
      let needsPrescription = false;

      for (const line of items) {
        const qty = Math.max(1, parseInt(line.quantity) || 1);
        // Atomic: only succeeds if enough stock exists RIGHT NOW.
        const medicine = await Medicine.findOneAndUpdate(
          { _id: line.medicineId, stock: { $gte: qty }, isActive: true, isDiscontinued: false },
          { $inc: { stock: -qty, salesCount: qty } },
          { new: true }
        );
        if (!medicine) {
          // Roll back everything we already decremented in this same order.
          for (const d of decremented) {
            await Medicine.updateOne({ _id: d.id }, { $inc: { stock: d.qty, salesCount: -d.qty } });
          }
          return res.status(409).json({ error: `Not enough stock for one of the items in your cart. Please review your cart.` });
        }
        decremented.push({ id: medicine._id, qty });

        if (medicine.prescriptionRequired) needsPrescription = true;
        const lineTotal = medicine.price * qty;
        subtotal += lineTotal;
        orderItems.push({
          medicine: medicine._id, brandName: medicine.brandName, strength: medicine.strength,
          quantity: qty, unitPrice: medicine.price, lineTotal, prescriptionRequired: medicine.prescriptionRequired,
        });
      }

      let prescriptionUrl = null;
      if (needsPrescription) {
        if (!req.file) {
          for (const d of decremented) await Medicine.updateOne({ _id: d.id }, { $inc: { stock: d.qty, salesCount: -d.qty } });
          return res.status(400).json({ error: "A prescription photo is required for one or more items in your cart" });
        }
        prescriptionUrl = await uploadToCloudinary(req.file.buffer, "prescriptions");
      }

      const deliveryFee = 0; // flat/free for now — real logic (distance-based) can replace this later
      const order = await new Order({
        patient: req.user.id,
        items: orderItems,
        subtotal, deliveryFee, total: subtotal + deliveryFee,
        address: address || null,
        location: (longitude && latitude) ? { type: "Point", coordinates: [Number(longitude), Number(latitude)] } : undefined,
        contactPhone,
        prescriptionUrl,
        statusHistory: [{ status: "pending", by: req.user.id }],
      }).save();

      res.status(201).json(order);
    } catch (err) {
      // Best-effort rollback if something unexpected failed mid-way.
      for (const d of decremented) {
        await Medicine.updateOne({ _id: d.id }, { $inc: { stock: d.qty, salesCount: -d.qty } }).catch(() => {});
      }
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/orders — the logged-in patient's own order history. */
  app.get("/api/orders", auth, async (req, res) => {
    try {
      const orders = await Order.find({ patient: req.user.id }).sort({ createdAt: -1 }).limit(50);
      res.json(orders);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  /** GET /api/orders/:id — a single order (must belong to the requester, unless admin). */
  app.get("/api/orders/:id", auth, async (req, res) => {
    try {
      const order = await Order.findById(req.params.id).populate("patient", "name phone");
      if (!order) return res.status(404).json({ error: "Not found" });
      if (order.patient._id.toString() !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not your order" });
      }
      res.json(order);
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