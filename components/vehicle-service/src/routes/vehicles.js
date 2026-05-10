const express = require("express");
const Vehicle = require("../models/Vehicle");
const requireAuth = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

// GET /vehicles
router.get("/", (req, res) => {
  try {
    res.json(Vehicle.findAllByUser(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /vehicles
router.post("/", (req, res) => {
  try {
    const { make, model, plateNumber } = req.body;
    if (!make || !model || !plateNumber)
      return res.status(400).json({ error: "make, model and plateNumber are required" });

    const vehicle = Vehicle.create(req.user.id, req.body);
    res.status(201).json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /vehicles/:id
router.get("/:id", (req, res) => {
  try {
    const vehicle = Vehicle.findOne(req.params.id, req.user.id);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    res.json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /vehicles/:id
router.put("/:id", (req, res) => {
  try {
    const vehicle = Vehicle.update(req.params.id, req.user.id, req.body);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    res.json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /vehicles/:id
router.delete("/:id", (req, res) => {
  try {
    const vehicle = Vehicle.delete(req.params.id, req.user.id);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    res.json({ message: "Vehicle deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /vehicles/:id/set-default
router.post("/:id/set-default", (req, res) => {
  try {
    const vehicle = Vehicle.setDefault(req.params.id, req.user.id);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    res.json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
