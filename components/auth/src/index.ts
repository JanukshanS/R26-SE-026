import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { config } from "./config";
import { prisma } from "./utils/prisma";
import { authRouter, adminRouter } from "./routes/auth.routes";
import { vehicleRouter } from "./routes/vehicle.routes";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      data: {
        service: "auth-service",
        status: "healthy",
        version: "1.0.0",
        uptime: process.uptime(),
        database: "connected",
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      success: false,
      data: null,
      error: "Database connection failed",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/v1/vehicles", vehicleRouter);
app.use("/api/v1/admin", adminRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    data: null,
    error: "Endpoint not found",
    timestamp: new Date().toISOString(),
  });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    success: false,
    data: null,
    error: config.nodeEnv === "development" ? err.message : "Internal server error",
    timestamp: new Date().toISOString(),
  });
});

async function main() {
  try {
    await prisma.$connect();
    console.log("Database connected");
    app.listen(config.port, () => {
      console.log(`Auth Service running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
      console.log(`Health check: http://localhost:${config.port}/health`);
      console.log(`API base: http://localhost:${config.port}/api`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

main();

export default app;
