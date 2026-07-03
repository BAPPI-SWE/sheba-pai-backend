require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Service = require("./models/Service");
const User = require("./models/User");

const app = express();
const PORT = 3000;

// Middleware: lets Express read JSON bodies from incoming requests
app.use(express.json());

// Connect to MongoDB Atlas
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// --- Health check ---
app.get("/", (req, res) => {
  res.send("Sheba Pai server is alive!");
});

// --- SERVICES ---

// GET all services (reads from DB)
app.get("/api/services", async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a service
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

// POST signup: create a new user with a hashed password
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, phone, password, role } = req.body;

    // Reject duplicate phone numbers
    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(409).json({ error: "Phone already registered" });
    }

    // Hash the password before storing (never store plain text)
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({ name, phone, password: hashedPassword, role });
    const savedUser = await user.save();

    // Never send the password back
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

// POST login: verify credentials, return a JWT token
app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Find the user by phone
    const user = await User.findOne({ phone });
    if (!user) {
      // Same vague message whether phone or password is wrong (don't leak which)
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    // Compare the typed password against the stored hash
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    // Credentials good — create a signed token carrying the user's id and role
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // token valid for 7 days
    );

    res.json({
      token,
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});