import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3002", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://kaduna:kaduna_dev@localhost:5432/kaduna_auth?schema=public",

  jwtSecret: process.env.JWT_SECRET || "change_this_to_a_long_random_secret",

  accessTtl: process.env.ACCESS_TTL || "15m",
  refreshTtl: process.env.REFRESH_TTL || "30d",

  bcryptRounds: 10,
} as const;
