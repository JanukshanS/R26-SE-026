const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const requireAuth = require("../middleware/auth");

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

// POST /auth/register
router.post("/register", (req, res) => {
  try {
    const { name, email, password, phone, location } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "name, email and password are required" });

    if (User.findByEmail(email))
      return res.status(409).json({ error: "Email already registered" });

    const user = User.create({ name, email, password, phone, location });
    res.status(201).json({ token: signToken(user), user: User.safe(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    const user = User.findByEmail(email);
    if (!user || !User.comparePassword(password, user.password))
      return res.status(401).json({ error: "Invalid email or password" });

    res.json({ token: signToken(user), user: User.safe(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me
router.get("/me", requireAuth, (req, res) => {
  try {
    const user = User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(User.safe(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /auth/me
router.put("/me", requireAuth, (req, res) => {
  try {
    const { name, phone, location } = req.body;
    const user = User.update(req.user.id, { name, phone, location });
    res.json(User.safe(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
