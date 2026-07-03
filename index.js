require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Service = require("./models/Service");
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");
const auth = require("./middleware/auth");

const app = express();
const PORT = 3000;

app.use(express.json());

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

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
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
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

// --- DISPATCH: find nearby available helpers ---
// Patient sends their location + the role they need.
// Returns available helpers with that role, within 2km, nearest first.
app.get("/api/helpers/nearby", auth, async (req, res) => {
  try {
    // Query params come in as strings — convert coords to numbers
    const longitude = parseFloat(req.query.longitude);
    const latitude = parseFloat(req.query.latitude);
    const role = req.query.role;

    if (isNaN(longitude) || isNaN(latitude) || !role) {
      return res
        .status(400)
        .json({ error: "longitude, latitude and role are required" });
    }

    const helpers = await HelperProfile.find({
      isAvailable: true,
      roles: role, // matches if this role is in the helper's roles array
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: 2000, // 2 km, in meters
        },
      },
    }).populate("user", "name phone"); // pull in the helper's name + phone

    res.json(helpers);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});