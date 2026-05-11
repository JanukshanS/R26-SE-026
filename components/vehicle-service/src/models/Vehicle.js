const { randomUUID } = require("crypto");
const db = require("../db");

function toJs(row) {
  if (!row) return null;
  return {
    ...row,
    isDefault: row.is_default === 1,
    plateNumber: row.plate_number,
    userId: row.user_id,
    currentMileage: row.current_mileage,
    fuelType: row.fuel_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const Vehicle = {
  findAllByUser(userId) {
    return db
      .all("SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_default DESC, created_at ASC", [userId])
      .map(toJs);
  },

  findOne(id, userId) {
    return toJs(db.get("SELECT * FROM vehicles WHERE id = ? AND user_id = ?", [id, userId]));
  },

  countByUser(userId) {
    const row = db.get("SELECT COUNT(*) as n FROM vehicles WHERE user_id = ?", [userId]);
    return row ? row.n : 0;
  },

  create(userId, { nickname, make, model, year, plateNumber, color, currentMileage, fuelType, vin, isDefault }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const makeDefault = isDefault ? 1 : (this.countByUser(userId) === 0 ? 1 : 0);

    if (makeDefault) {
      db.run("UPDATE vehicles SET is_default = 0 WHERE user_id = ?", [userId]);
    }

    db.run(
      `INSERT INTO vehicles
         (id, user_id, nickname, make, model, year, plate_number, color,
          current_mileage, fuel_type, vin, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, nickname ?? null, make, model, year ?? null,
       plateNumber, color ?? null, currentMileage ?? 0,
       fuelType ?? "petrol", vin ?? null, makeDefault, now, now]
    );
    return this.findOne(id, userId);
  },

  update(id, userId, fields) {
    const existing = this.findOne(id, userId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const { nickname, make, model, year, plateNumber, color, currentMileage, fuelType, vin, isDefault } = fields;

    if (isDefault) {
      db.run("UPDATE vehicles SET is_default = 0 WHERE user_id = ?", [userId]);
    }

    db.run(
      `UPDATE vehicles SET
         nickname = ?, make = ?, model = ?, year = ?, plate_number = ?,
         color = ?, current_mileage = ?, fuel_type = ?, vin = ?,
         is_default = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        nickname ?? existing.nickname, make ?? existing.make, model ?? existing.model,
        year ?? existing.year, plateNumber ?? existing.plateNumber,
        color ?? existing.color, currentMileage ?? existing.currentMileage,
        fuelType ?? existing.fuelType, vin ?? existing.vin,
        isDefault != null ? (isDefault ? 1 : 0) : (existing.isDefault ? 1 : 0),
        now, id, userId,
      ]
    );
    return this.findOne(id, userId);
  },

  delete(id, userId) {
    const vehicle = this.findOne(id, userId);
    if (!vehicle) return null;
    db.run("DELETE FROM vehicles WHERE id = ? AND user_id = ?", [id, userId]);

    if (vehicle.isDefault) {
      const next = db.get("SELECT id FROM vehicles WHERE user_id = ? ORDER BY created_at ASC LIMIT 1", [userId]);
      if (next) db.run("UPDATE vehicles SET is_default = 1 WHERE id = ?", [next.id]);
    }
    return vehicle;
  },

  setDefault(id, userId) {
    db.run("UPDATE vehicles SET is_default = 0 WHERE user_id = ?", [userId]);
    db.run(
      "UPDATE vehicles SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?",
      [new Date().toISOString(), id, userId]
    );
    return this.findOne(id, userId);
  },
};

module.exports = Vehicle;
