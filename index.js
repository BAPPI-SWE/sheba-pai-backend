require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cloudinary = require("./cloudinary");

const Service = require("./models/Service");
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");
const Request = require("./models/Request");
const Role = require("./models/Role");
const Requirement = require("./models/Requirement");
const RequirementSubmission = require("./models/RequirementSubmission");
const HelperService = require("./models/HelperService");
const servicesRoutes = require("./servicesRoutes");
const ratingsRoutes = require("./ratingsRoutes");
const browseRoutes = require("./browseRoutes");
const commissionRoutes = require("./commissionRoutes");
const reportsRoutes = require("./reportsRoutes");
const medicineRoutes = require("./medicineRoutes");
const medicineAdminRoutes = require("./medicineAdminRoutes");
const orderRoutes = require("./orderRoutes");
const { sendPush } = require("./pushService");
const { finalizeJobEarnings, isHelperRestricted, getSettings } = require("./commissionRoutes");
const { isHelperClearedForService } = require("./eligibility");
const auth = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.set("io", io);

const upload = multer({ storage: multer.memoryStorage() });

function uploadToCloudinary(fileBuffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
}

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

io.on("connection", (socket) => {
  console.log("🔌 A device connected:", socket.id);
  socket.on("register", (userId) => {
    if (userId) {
      socket.join(userId);
      console.log(`   ↳ joined room: ${userId}`);
    }
  });
  socket.on("helperLocationUpdate", (data) => {
    if (data?.patientId) {
      io.to(data.patientId).emit("helperLocation", {
        requestId: data.requestId,
        latitude: data.latitude,
        longitude: data.longitude,
      });
    }
  });
  socket.on("disconnect", () => {
    console.log("❌ A device disconnected:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("Sheba Pai server is alive!");
});

function helperOnly(req, res, next) {
  if (req.user.role !== "helper") return res.status(403).json({ error: "Helpers only" });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admins only" });
  next();
}

// --- ROLES ---
app.get("/api/roles", async (req, res) => {
  try {
    const roles = await Role.find().sort({ name: 1 });
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// --- ADMIN ACCOUNT MANAGEMENT ---
// Creating an admin is intentionally NOT possible through public signup.
// Only an already-authenticated admin can create another one here.
app.get("/api/admin/admins", auth, adminOnly, async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" }).select("name phone createdAt").sort({ createdAt: 1 });
    res.json(admins);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/admin/admins", auth, adminOnly, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: "Name, phone, and password are required" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const existing = await User.findOne({ phone });
    if (existing) return res.status(409).json({ error: "Phone already registered" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const saved = await new User({ name, phone, password: hashedPassword, role: "admin" }).save();
    res.status(201).json({ id: saved._id, name: saved.name, phone: saved.phone });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove an admin's access. An admin can never delete themselves this way
// (avoids accidentally locking everyone out).
app.delete("/api/admin/admins/:id", auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot remove your own admin access" });
    }
    const target = await User.findById(req.params.id);
    if (!target || target.role !== "admin") return res.status(404).json({ error: "Admin not found" });
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/roles", auth, adminOnly, async (req, res) => {
  try {
    const { name, nameBangla } = req.body;
    const saved = await new Role({ name, nameBangla }).save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.delete("/api/roles/:id", auth, adminOnly, async (req, res) => {
  try {
    const deleted = await Role.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Role not found" });
    res.json({ message: "Role deleted", id: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- AUTH ---
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    // SECURITY: public signup may only ever create a patient or helper.
    // "admin" must never be settable from an unauthenticated request —
    // admin accounts are created exclusively through the protected
    // /api/admin/admins endpoint by an already-logged-in admin.
    if (!["patient", "helper"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const existing = await User.findOne({ phone });
    if (existing) return res.status(409).json({ error: "Phone already registered" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const savedUser = await new User({ name, phone, password: hashedPassword, role }).save();
    res.status(201).json({
      id: savedUser._id, name: savedUser.name, phone: savedUser.phone, role: savedUser.role,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(401).json({ error: "Invalid phone or password" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid phone or password" });
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/me", auth, async (req, res) => {
  try {
    res.json(await User.findById(req.user.id).select("-password"));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save or clear this user's Expo push token.
app.patch("/api/me/push-token", auth, async (req, res) => {
  try {
    const { pushToken } = req.body;
    await User.findByIdAndUpdate(req.user.id, { pushToken: pushToken || null });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update the current user's own name.
app.patch("/api/me", auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Name cannot be empty" });
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name: name.trim() },
      { new: true }
    ).select("-password");
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add a saved address.
app.post("/api/me/addresses", auth, async (req, res) => {
  try {
    const { label, address, longitude, latitude } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: "Label required" });
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $push: { savedAddresses: { label: label.trim(), address: address || "", longitude: longitude ?? null, latitude: latitude ?? null } } },
      { new: true }
    ).select("-password");
    res.status(201).json(user.savedAddresses);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a saved address by its subdocument id.
app.delete("/api/me/addresses/:addrId", auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { savedAddresses: { _id: req.params.addrId } } },
      { new: true }
    ).select("-password");
    res.json(user.savedAddresses);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- HELPER PROFILE ---
app.post("/api/helper/profile", auth, helperOnly, async (req, res) => {
  try {
    const { roles } = req.body;
    const profile = await HelperProfile.findOneAndUpdate(
      { user: req.user.id },
      { user: req.user.id, roles },
      { new: true, upsert: true }
    );
    res.status(201).json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/helper/profile", auth, helperOnly, async (req, res) => {
  try {
    res.json((await HelperProfile.findOne({ user: req.user.id })) || null);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- VERIFICATION: upload one document ---
app.post(
  "/api/helper/verification/upload",
  auth, helperOnly, upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const docType = req.body.docType;
      const allowed = [
        "nid_front", "nid_back", "selfie", "certificate", "police_clearance",
      ];
      if (!allowed.includes(docType)) {
        return res.status(400).json({ error: "Invalid docType: " + docType });
      }

      let profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile) profile = new HelperProfile({ user: req.user.id, roles: [] });

      // Cap certificates at 10 BEFORE uploading
      if (docType === "certificate" && profile.certificateUrls.length >= 10) {
        return res.status(400).json({ error: "Maximum 10 certificates allowed" });
      }

      const url = await uploadToCloudinary(
        req.file.buffer,
        `sheba-pai/verification/${req.user.id}`
      );

      if (docType === "nid_front") profile.nidFrontUrl = url;
      else if (docType === "nid_back") profile.nidBackUrl = url;
      else if (docType === "police_clearance") profile.policeClearanceUrl = url;
      else if (docType === "certificate") profile.certificateUrls.push(url);
      else if (docType === "selfie") profile.selfieUrls.push(url);

      await profile.save();
      res.status(201).json({ url, docType });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// --- VERIFICATION: submit for review ---
app.post("/api/helper/verification/submit", auth, helperOnly, async (req, res) => {
  try {
    const { fullName, nidNumber, consentAccepted } = req.body;
    const profile = await HelperProfile.findOne({ user: req.user.id });
    if (!profile) return res.status(404).json({ error: "Create a profile first" });

    if (!profile.nidFrontUrl || !profile.nidBackUrl) {
      return res.status(400).json({ error: "Both sides of NID are required" });
    }
    if (profile.selfieUrls.length === 0) {
      return res.status(400).json({ error: "At least one selfie is required" });
    }
    if (!consentAccepted) {
      return res.status(400).json({ error: "You must accept the terms to continue" });
    }

    profile.fullName = fullName || profile.fullName;
    profile.nidNumber = nidNumber || profile.nidNumber;
    profile.consentAccepted = true;
    profile.consentAcceptedAt = new Date();
    profile.verificationStatus = "pending";
    profile.rejectionReason = null;
    await profile.save();

    res.json({ message: "Submitted for review", status: "pending" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- ADMIN: verifications ---
app.get("/api/admin/verifications", auth, adminOnly, async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const profiles = await HelperProfile.find({ verificationStatus: status })
      .populate("user", "name phone")
      .sort({ updatedAt: -1 });
    res.json(profiles);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.patch("/api/admin/verifications/:id", auth, adminOnly, async (req, res) => {
  try {
    const { decision, rejectionReason } = req.body;
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approve or reject" });
    }
    const update = decision === "approve"
      ? { verificationStatus: "approved", rejectionReason: null, reviewedAt: new Date(), reviewedBy: req.user.id }
      : { verificationStatus: "rejected", rejectionReason: rejectionReason || "Documents not acceptable", reviewedAt: new Date(), reviewedBy: req.user.id };
    const profile = await HelperProfile.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate("user", "name phone");
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/helper/location", auth, helperOnly, async (req, res) => {
  try {
    const { longitude, latitude, isAvailable } = req.body;
    if (isAvailable) {
      const profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile || profile.verificationStatus !== "approved") {
        return res.status(403).json({ error: "আপনার অ্যাকাউন্ট এখনো যাচাই করা হয়নি" });
      }
      if (await isHelperRestricted(req.user.id)) {
        return res.status(403).json({
          error: "Your account is restricted due to unpaid commission. Please pay to continue.",
          restricted: true,
        });
      }
    }
    const profile = await HelperProfile.findOneAndUpdate(
      { user: req.user.id },
      { isAvailable, location: { type: "Point", coordinates: [longitude, latitude] } },
      { new: true }
    );
    if (!profile) return res.status(404).json({ error: "Create a helper profile first" });
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/helper/requests", auth, helperOnly, async (req, res) => {
  try {
    const profile = await HelperProfile.findOne({ user: req.user.id });
    if (!profile) return res.status(404).json({ error: "Create a helper profile first" });
    const helperId = req.user.id;
    // Requests still searching that are either:
    //   - targeted specifically at this helper, OR
    //   - broadcast (no targetedHelpers) matching this helper's roles
    const requests = await Request.find({
      status: "searching",
      $or: [
        { targetedHelpers: helperId },
        { targetedHelpers: { $size: 0 }, role: { $in: profile.roles } },
      ],
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: profile.location.coordinates },
          $maxDistance: 20000,
        },
      },
    }).populate("patient", "name");

    // Gate: hide requests whose sub-service this helper isn't cleared for.
    // (Identity is checked inside isHelperClearedForService too.)
    const visible = [];
    for (const r of requests) {
      let allowed = false;
      if (r.subService) {
        const clearance = await isHelperClearedForService(req.user.id, r.subService);
        allowed = clearance.cleared;
      } else {
        // Legacy/broadcast request: require approved identity at minimum
        allowed = profile.verificationStatus === "approved";
      }
      if (!allowed) continue;

      // Attach how far this job is from the caregiver, so they can make an
      // informed decision instead of accepting blind.
      const obj = r.toObject();
      const [hLng, hLat] = profile.location.coordinates;
      const [pLng, pLat] = r.location.coordinates;
      const R = 6371;
      const dLat = ((pLat - hLat) * Math.PI) / 180;
      const dLng = ((pLng - hLng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((hLat * Math.PI) / 180) * Math.cos((pLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      obj.distanceKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;

      // PRIVACY: before the caregiver accepts, they see only the distance
      // and a rough area (neighborhood/city) — never the exact coordinates
      // or full address. Those are revealed only once they've committed to
      // the job (via the accept response and the active-jobs endpoint).
      delete obj.location;
      delete obj.address;

      // EARNINGS TRANSPARENCY: show what this job actually pays, before
      // the caregiver commits — their own rate for this service, the
      // platform's commission on it, and what they'd net. Real numbers,
      // not something they have to work out themselves.
      if (r.subService) {
        const offering = await HelperService.findOne({ helper: req.user.id, service: r.subService });
        const svc = await Service.findById(r.subService).select("commissionPercent");
        if (offering && svc) {
          const commissionPercent = svc.commissionPercent || 0;
          const grossRate = offering.amount;
          const netRate = Math.round(grossRate * (1 - commissionPercent / 100) * 100) / 100;
          obj.pricing = { chargeType: offering.chargeType, grossRate, commissionPercent, netRate };
        }
      }

      visible.push(obj);
    }
    res.json(visible);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/helpers/nearby", auth, async (req, res) => {
  try {
    const longitude = parseFloat(req.query.longitude);
    const latitude = parseFloat(req.query.latitude);
    const role = req.query.role;
    if (isNaN(longitude) || isNaN(latitude) || !role) {
      return res.status(400).json({ error: "longitude, latitude and role are required" });
    }
    const helpers = await HelperProfile.find({
      isAvailable: true,
      verificationStatus: "approved",
      roles: role,
      location: {
        $near: { $geometry: { type: "Point", coordinates: [longitude, latitude] }, $maxDistance: 2000 },
      },
    }).populate("user", "name phone");
    res.json(helpers);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/requests/active", auth, async (req, res) => {
  try {
    const activeStates = ["accepted", "on_the_way", "helping"];
    if (req.user.role === "helper") {
      // Multi-job: a helper can have several active jobs at once
      const requests = await Request.find({
        helper: req.user.id,
        status: { $in: activeStates },
      }).sort({ createdAt: -1 }).populate("patient", "name phone");
      return res.json({ requests, request: requests[0] || null });
    }
    // Patient: still one active request at a time
    const request = await Request.findOne({
      patient: req.user.id,
      status: { $in: [...activeStates, "searching"] },
    }).sort({ createdAt: -1 }).populate("helper", "name phone");
    res.json({ request: request || null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patient booking history — active + past requests, newest first.
app.get("/api/requests/history", auth, async (req, res) => {
  try {
    const requests = await Request.find({ patient: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("helper", "name phone")
      .lean();

    const activeStates = ["searching", "accepted", "on_the_way", "helping"];
    const active = requests.filter((r) => activeStates.includes(r.status));
    const past = requests.filter((r) => !activeStates.includes(r.status));

    res.json({ active, past });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/requests", auth, async (req, res) => {
  try {
    const { role, roles, serviceName, longitude, latitude } = req.body;
    let roleList = [];
    if (Array.isArray(roles) && roles.length > 0) roleList = roles;
    else if (role) roleList = [role];
    if (roleList.length === 0 || longitude === undefined || latitude === undefined) {
      return res.status(400).json({ error: "roles (or role), longitude and latitude are required" });
    }
    const request = new Request({
      patient: req.user.id,
      role: roleList[0],
      acceptedRoles: roleList,
      serviceName: serviceName || roleList[0],
      location: { type: "Point", coordinates: [longitude, latitude] },
    });
    const savedRequest = await request.save();

    const nearbyHelpers = await HelperProfile.find({
      isAvailable: true,
      verificationStatus: "approved",
      roles: { $in: roleList },
      location: {
        $near: { $geometry: { type: "Point", coordinates: [longitude, latitude] }, $maxDistance: 2000 },
      },
    }).populate("user", "name phone");

    if (nearbyHelpers.length === 0) {
      savedRequest.status = "no_helper_found";
      await savedRequest.save();
    } else {
      const io = req.app.get("io");
      nearbyHelpers.forEach((h) => io.to(h.user._id.toString()).emit("newRequest", savedRequest));
    }
    res.status(201).json({ request: savedRequest, candidateHelpers: nearbyHelpers.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/requests/:id/accept", auth, helperOnly, async (req, res) => {
  try {
    // Safety gate: identity approved AND service requirements approved.
    const reqDoc = await Request.findById(req.params.id);
    if (!reqDoc) return res.status(404).json({ error: "Request not found" });
    if (reqDoc.subService) {
      const clearance = await isHelperClearedForService(req.user.id, reqDoc.subService);
      if (!clearance.cleared) {
        return res.status(403).json({ error: "You are not verified for this service yet", reason: clearance.reason });
      }
    } else {
      // Legacy/broadcast request without a sub-service: at least require approved identity
      const profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile || profile.verificationStatus !== "approved") {
        return res.status(403).json({ error: "Your account is not verified yet" });
      }
    }

    // Concurrency gate: how many jobs may one caregiver hold at once?
    // Set platform-wide by admin in Settings.
    const settings = await getSettings();
    const activeCount = await Request.countDocuments({
      helper: req.user.id,
      status: { $in: ["accepted", "on_the_way", "helping"] },
    });
    if (activeCount >= settings.maxConcurrentJobs) {
      return res.status(409).json({
        error: `You can only handle ${settings.maxConcurrentJobs} job(s) at a time. Finish one before accepting another.`,
        atJobLimit: true,
        limit: settings.maxConcurrentJobs,
      });
    }

    const updated = await Request.findOneAndUpdate(
      { _id: req.params.id, status: "searching" },
      { status: "accepted", helper: req.user.id },
      { new: true }
    ).populate("helper", "name phone");
    if (!updated) return res.status(409).json({ error: "This request was already taken or does not exist" });
    req.app.get("io").to(updated.patient.toString()).emit("requestAccepted", updated);
    sendPush(updated.patient, {
      title: "সাহায্যকারী পাওয়া গেছে",
      body: `${updated.helper?.name || "একজন সাহায্যকারী"} আপনার অনুরোধ গ্রহণ করেছেন`,
      data: { type: "accepted", requestId: String(updated._id) },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const transitions = { accepted: "on_the_way", on_the_way: "helping", helping: "completed" };
app.patch("/api/requests/:id/status", auth, helperOnly, async (req, res) => {
  try {
    const { nextStatus } = req.body;
    const validFrom = Object.keys(transitions).find((f) => transitions[f] === nextStatus);
    if (!validFrom) return res.status(400).json({ error: `Cannot transition to '${nextStatus}'` });

    // Capture the moment service actually starts, for hourly-rate earnings.
    const extraFields = {};
    if (nextStatus === "helping") extraFields.helpingStartedAt = new Date();

    const updated = await Request.findOneAndUpdate(
      { _id: req.params.id, status: validFrom, helper: req.user.id },
      { status: nextStatus, ...extraFields },
      { new: true }
    );
    if (!updated) return res.status(409).json({ error: `Request is not in '${validFrom}' state, or is not yours` });

    // On completion, compute the final amount + commission owed.
    if (nextStatus === "completed") {
      await finalizeJobEarnings(updated);
    }

    req.app.get("io").to(updated.patient.toString()).emit("requestUpdated", updated);

    const statusMessages = {
      on_the_way: "আপনার সাহায্যকারী রওনা দিয়েছেন",
      helping: "সেবা শুরু হয়েছে",
      completed: "সেবা সম্পন্ন হয়েছে",
    };
    if (statusMessages[nextStatus]) {
      sendPush(updated.patient, {
        title: "সেবা পাই",
        body: statusMessages[nextStatus],
        data: { type: "status", status: nextStatus, requestId: String(updated._id) },
      });
    }

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/requests/:id/cancel", auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const activeStates = ["searching", "accepted", "on_the_way", "helping"];
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (!activeStates.includes(request.status)) {
      return res.status(409).json({ error: "Request cannot be cancelled (already finished?)" });
    }

    // Who is cancelling?
    const meId = req.user.id;
    const isPatient = request.patient?.toString() === meId;
    const isHelper = request.helper?.toString() === meId;
    if (!isPatient && !isHelper) {
      return res.status(403).json({ error: "You are not part of this request" });
    }
    const by = isPatient ? "patient" : "helper";

    request.status = "cancelled";
    request.cancelledBy = by;
    request.cancelReason = reason || null;
    request.endedAt = new Date();
    await request.save();

    // Accountability: count a cancellation only if a helper had already accepted
    // (cancelling an un-accepted search is blameless).
    const wasAccepted = request.helper != null;
    if (wasAccepted) {
      if (by === "patient") {
        await User.findByIdAndUpdate(request.patient, { $inc: { cancelCount: 1 } });
      } else {
        await HelperProfile.findOneAndUpdate({ user: request.helper }, { $inc: { cancelCount: 1 } });
      }
    }

    // Notify the other party
    const io = req.app.get("io");
    const otherId = isPatient ? request.helper : request.patient;
    if (otherId) io.to(otherId.toString()).emit("requestUpdated", request);

    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- NO-SHOW: either party reports the other didn't show ---
app.patch("/api/requests/:id/no-show", auth, async (req, res) => {
  try {
    const { reason } = req.body;
    // Only meaningful once accepted and before service actually started
    const reportableStates = ["accepted", "on_the_way"];
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (!reportableStates.includes(request.status)) {
      return res.status(409).json({ error: "No-show can only be reported before the service starts" });
    }

    const meId = req.user.id;
    const isPatient = request.patient?.toString() === meId;
    const isHelper = request.helper?.toString() === meId;
    if (!isPatient && !isHelper) {
      return res.status(403).json({ error: "You are not part of this request" });
    }
    const reporter = isPatient ? "patient" : "helper";

    request.status = "no_show";
    request.noShowReportedBy = reporter;
    request.noShowReason = reason || null;
    request.endedAt = new Date();
    await request.save();

    // Increment the REPORTED person's no-show counter (the other party)
    if (isPatient) {
      await HelperProfile.findOneAndUpdate({ user: request.helper }, { $inc: { noShowCount: 1 } });
    } else {
      await User.findByIdAndUpdate(request.patient, { $inc: { noShowCount: 1 } });
    }

    const io = req.app.get("io");
    const otherId = isPatient ? request.helper : request.patient;
    if (otherId) io.to(otherId.toString()).emit("requestUpdated", request);

    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- PHASE 3: services tree, requirements, submissions, helper offerings ---
servicesRoutes(app, { auth, adminOnly, helperOnly, upload, uploadToCloudinary });

// --- RATINGS: rate a completed job (both directions), read summaries ---
ratingsRoutes(app, { auth });

// --- BROWSE-AND-CHOOSE: paginated nearby helpers, request specific helpers ---
browseRoutes(app, { auth });

// --- COMMISSION & EARNINGS: helper earnings, payments, admin review ---
commissionRoutes(app, { auth, adminOnly, helperOnly });

// --- REPORTS: admin accountability + commission overview ---
reportsRoutes(app, { auth, adminOnly });

// --- MEDICINE CATALOGUE: search, browse, product + generic pages ---
medicineRoutes(app, { auth, adminOnly });
medicineAdminRoutes(app, { auth, adminOnly });
orderRoutes(app, { auth, adminOnly, upload, uploadToCloudinary });

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});