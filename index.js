require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Service = require("./models/Service");
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");
const Request = require("./models/Request");
const auth = require("./middleware/auth");

const app = express();

// Wrap Express in a raw HTTP server so Socket.IO can share it
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // allow the mobile app to connect
});

const PORT = 3000;

app.use(express.json());

// Make `io` reachable inside routes via req.app.get("io")
app.set("io", io);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// --- SOCKET.IO CONNECTION HANDLING ---
io.on("connection", (socket) => {
  console.log("🔌 A device connected:", socket.id);

  // The app tells us who it is; we put them in a room named by their userId
  socket.on("register", (userId) => {
    if (userId) {
      socket.join(userId);
      console.log(`   ↳ joined room: ${userId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ A device disconnected:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("Sheba Pai server is alive!");
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

app.post("/api/services", async (req, res) => {
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
    if (!user) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }
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
function helperOnly(req, res, next) {
  if (req.user.role !== "helper") {
    return res.status(403).json({ error: "Helpers only" });
  }
  next();
}

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

app.patch("/api/helper/location", auth, helperOnly, async (req, res) => {
  try {
    const { longitude, latitude, isAvailable } = req.body;
    const profile = await HelperProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        isAvailable,
        location: { type: "Point", coordinates: [longitude, latitude] },
      },
      { new: true }
    );
    if (!profile) {
      return res.status(404).json({ error: "Create a helper profile first" });
    }
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/helper/requests", auth, helperOnly, async (req, res) => {
  try {
    const profile = await HelperProfile.findOne({ user: req.user.id });
    if (!profile) {
      return res.status(404).json({ error: "Create a helper profile first" });
    }
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
app.post("/api/requests", auth, async (req, res) => {
  try {
    const { role, longitude, latitude } = req.body;
    if (!role || longitude === undefined || latitude === undefined) {
      return res.status(400).json({ error: "role, longitude and latitude are required" });
    }

    const request = new Request({
      patient: req.user.id,
      role,
      location: { type: "Point", coordinates: [longitude, latitude] },
    });
    const savedRequest = await request.save();

    const nearbyHelpers = await HelperProfile.find({
      isAvailable: true,
      roles: role,
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
      // PUSH the new request to each nearby helper's room (instant, no polling)
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

    // PUSH to the patient's room: "your helper accepted!"
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
    const validFrom = Object.keys(transitions).find((from) => transitions[from] === nextStatus);
    if (!validFrom) {
      return res.status(400).json({ error: `Cannot transition to '${nextStatus}'` });
    }
    const updated = await Request.findOneAndUpdate(
      { _id: requestId, status: validFrom, helper: req.user.id },
      { status: nextStatus },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ error: `Request is not in '${validFrom}' state, or is not yours` });
    }

    // PUSH the status change to the patient
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

// NOTE: we now start `server`, not `app` — Socket.IO rides on `server`
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});