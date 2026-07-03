require("dotenv").config();
const User = require("./models/User");
const bcrypt = require("bcryptjs");
const Service = require("./models/Service");
const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());
const PORT = 3000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

app.get("/", (req, res) => {
  res.send("Sheba Pai server is alive!");
});

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




app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});