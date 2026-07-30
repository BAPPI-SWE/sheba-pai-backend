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
const auth = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.set("io", io);

// Multer: keep uploaded files in memory as buffers (we stream them to Cloudinary)
const upload = multer({ storage: multer.memoryStorage() });

// Helper: upload an in-memory file buffer to Cloudinary, return the secure URL
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

// --- SOCKET.IO ---
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

// --- GUARDS ---
function helperOnly(req, res, next) {
  if (req.user.role !== "helper") {
    return res.status(403).json({ error: "Helpers only" });
  }
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }
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
app.post("/api/roles", auth, adminOnly, async (req, res) => {
  try {
    const { name, nameBangla } = req.body;
    const role = new Role({ name, nameBangla });
    const saved = await role.save();
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

// --- SERVICES ---
app.get("/api/services", async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/services", auth, adminOnly, async (req, res) => {
  try {
    const newService = new Service({
      name: req.body.name,
      nameBangla: req.body.nameBangla,
      helperRoles: req.body.helperRoles,
    });
    const savedService = await newService.save();
    res.status(201).json(savedService);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.put("/api/services/:id", auth, adminOnly, async (req, res) => {
  try {
    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      {
        name: req.body.name,
        nameBangla: req.body.nameBangla,
        helperRoles: req.body.helperRoles,
      },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: "Service not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.delete("/api/services/:id", auth, adminOnly, async (req, res) => {
  try {
    const deleted = await Service.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Service not found" });
    res.json({ message: "Service deleted", id: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- AUTH ---
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(409).json({ error: "Phone already registered" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, phone, password: hashedPassword, role });
    const savedUser = await user.save();
    res.status(201).json({
      id: savedUser._id,
      name: savedUser.name,
      phone: savedUser.phone,
      role: savedUser.role,
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
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      token,
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
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

// Get my own helper profile (to know verification status, etc.)
app.get("/api/helper/profile", auth, helperOnly, async (req, res) => {
  try {
    const profile = await HelperProfile.findOne({ user: req.user.id });
    res.json(profile || null);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- VERIFICATION: upload a single document image ---
// The app sends one image (multipart/form-data) with a "docType" field:
// "nid" | "certificate" | "selfie"
app.post(
  "/api/helper/verification/upload",
  auth,
  helperOnly,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const docType = req.body.docType;
      if (!["nid", "certificate", "selfie"].includes(docType)) {
        return res.status(400).json({ error: "Invalid docType" });
      }

      // Upload the file buffer to Cloudinary
      const url = await uploadToCloudinary(
        req.file.buffer,
        `sheba-pai/verification/${req.user.id}`
      );

      // Ensure a profile exists
      let profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile) {
        profile = new HelperProfile({ user: req.user.id, roles: [] });
      }

      // Save the URL onto the right field
      if (docType === "nid") profile.nidImageUrl = url;
      else if (docType === "certificate") profile.certificateUrl = url;
      else if (docType === "selfie") profile.selfieUrls.push(url);

      await profile.save();
      res.status(201).json({ url, docType });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// --- VERIFICATION: submit for admin review ---
app.post("/api/helper/verification/submit", auth, helperOnly, async (req, res) => {
  try {
    const { fullName, nidNumber } = req.body;
    const profile = await HelperProfile.findOne({ user: req.user.id });
    if (!profile) return res.status(404).json({ error: "Create a profile first" });

    if (!profile.nidImageUrl || profile.selfieUrls.length === 0) {
      return res
        .status(400)
        .json({ error: "NID photo and at least one selfie are required" });
    }

    profile.fullName = fullName || profile.fullName;
    profile.nidNumber = nidNumber || profile.nidNumber;
    profile.verificationStatus = "pending";
    profile.rejectionReason = null;
    await profile.save();

    res.json({ message: "Submitted for review", status: "pending" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- ADMIN: list helpers pending review ---
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

// --- ADMIN: approve or reject a helper ---
app.patch("/api/admin/verifications/:id", auth, adminOnly, async (req, res) => {
  try {
    const { decision, rejectionReason } = req.body; // decision: "approve" | "reject"
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approve or reject" });
    }
    const update =
      decision === "approve"
        ? { verificationStatus: "approved", rejectionReason: null, reviewedAt: new Date() }
        : {
            verificationStatus: "rejected",
            rejectionReason: rejectionReason || "Documents not acceptable",
            reviewedAt: new Date(),
          };

    const profile = await HelperProfile.findByIdAndUpdate(req.params.id, update, {
      new: true,
    }).populate("user", "name phone");

    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/helper/location", auth, helperOnly, async (req, res) => {
  try {
    const { longitude, latitude, isAvailable } = req.body;

    // ENFORCEMENT: only approved helpers may go online
    if (isAvailable) {
      const profile = await HelperProfile.findOne({ user: req.user.id });
      if (!profile || profile.verificationStatus !== "approved") {
        return res
          .status(403)
          .json({ error: "আপনার অ্যাকাউন্ট এখনো যাচাই করা হয়নি" });
      }
    }

    const profile = await HelperProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        isAvailable,
        location: { type: "Point", coordinates: [longitude, latitude] },
      },
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
    const requests = await Request.find({
      status: "searching",
      role: { $in: profile.roles },
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: profile.location.coordinates },
          $maxDistance: 2000,
        },
      },
    });
    res.json(requests);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- DISPATCH ---
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
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: 2000,
        },
      },
    }).populate("user", "name phone");
    res.json(helpers);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- REQUESTS ---
app.get("/api/requests/active", auth, async (req, res) => {
  try {
    const activeStates = ["searching", "accepted", "on_the_way", "helping"];
    const query =
      req.user.role === "helper"
        ? { helper: req.user.id, status: { $in: activeStates } }
        : { patient: req.user.id, status: { $in: activeStates } };
    const request = await Request.findOne(query)
      .sort({ createdAt: -1 })
      .populate("helper", "name phone");
    res.json({ request: request || null });
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
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: 2000,
        },
      },
    }).populate("user", "name phone");

    if (nearbyHelpers.length === 0) {
      savedRequest.status = "no_helper_found";
      await savedRequest.save();
    } else {
      const io = req.app.get("io");
      nearbyHelpers.forEach((h) => {
        io.to(h.user._id.toString()).emit("newRequest", savedRequest);
      });
    }

    res.status(201).json({
      request: savedRequest,
      candidateHelpers: nearbyHelpers.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/requests/:id/accept", auth, helperOnly, async (req, res) => {
  try {
    const requestId = req.params.id;
    const updated = await Request.findOneAndUpdate(
      { _id: requestId, status: "searching" },
      { status: "accepted", helper: req.user.id },
      { new: true }
    ).populate("helper", "name phone");
    if (!updated) {
      return res.status(409).json({ error: "This request was already taken or does not exist" });
    }
    const io = req.app.get("io");
    io.to(updated.patient.toString()).emit("requestAccepted", updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const transitions = {
  accepted: "on_the_way",
  on_the_way: "helping",
  helping: "completed",
};
app.patch("/api/requests/:id/status", auth, helperOnly, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { nextStatus } = req.body;
    const validFrom = Object.keys(transitions).find((f) => transitions[f] === nextStatus);
    if (!validFrom) return res.status(400).json({ error: `Cannot transition to '${nextStatus}'` });
    const updated = await Request.findOneAndUpdate(
      { _id: requestId, status: validFrom, helper: req.user.id },
      { status: nextStatus },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ error: `Request is not in '${validFrom}' state, or is not yours` });
    }
    const io = req.app.get("io");
    io.to(updated.patient.toString()).emit("requestUpdated", updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/requests/:id/cancel", auth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const activeStates = ["searching", "accepted", "on_the_way", "helping"];
    const updated = await Request.findOneAndUpdate(
      { _id: requestId, status: { $in: activeStates } },
      { status: "cancelled" },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ error: "Request cannot be cancelled (already finished?)" });
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});