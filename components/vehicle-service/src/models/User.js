const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");

function toJs(row) {
  if (!row) return null;
  return { ...row };
}

const User = {
  create({ name, email, password, phone, location }) {
    const hash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();
    const id = randomUUID();
    db.run(
      `INSERT INTO users (id, name, email, password, phone, location, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, hash, phone ?? null, location ?? null, now, now]
    );
    return this.findById(id);
  },

  findByEmail(email) {
    return toJs(db.get("SELECT * FROM users WHERE email = ?", [email]));
  },

  findById(id) {
    return toJs(db.get("SELECT * FROM users WHERE id = ?", [id]));
  },

  update(id, { name, phone, location }) {
    const now = new Date().toISOString();
    const user = this.findById(id);
    db.run(
      `UPDATE users SET name = ?, phone = ?, location = ?, updated_at = ? WHERE id = ?`,
      [name ?? user.name, phone ?? user.phone, location ?? user.location, now, id]
    );
    return this.findById(id);
  },

  safe(user) {
    if (!user) return null;
    const { password, ...rest } = user;
    return rest;
  },

  comparePassword(plain, hash) {
    return bcrypt.compareSync(plain, hash);
  },
};

module.exports = User;
