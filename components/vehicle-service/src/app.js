require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ready } = require("./db");

const authRouter = require("./routes/auth");
const vehiclesRouter = require("./routes/vehicles");

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/vehicles", vehiclesRouter);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "vehicle-service" }));

ready.then(() => {
  app.listen(PORT, () => console.log(`[vehicle-service] Listening on port ${PORT}`));
}).catch((err) => {
  console.error("[vehicle-service] Failed to start:", err.message);
  process.exit(1);
});
