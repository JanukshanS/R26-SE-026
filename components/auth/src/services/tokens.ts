import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../utils/prisma";

export interface AccessPayload {
  sub: string;
  role: string;
}

export function signAccessToken(userId: string, role: string): string {
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: config.accessTtl as SignOptions["expiresIn"],
  };
  return jwt.sign({ sub: userId, role } as AccessPayload, config.jwtSecret, options);
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"],
  }) as jwt.JwtPayload;
  return { sub: String(decoded.sub), role: String(decoded.role) };
}

function refreshExpiry(): Date {
  const ttl = config.refreshTtl;
  const days = ttl.endsWith("d") ? parseInt(ttl, 10) : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: { userId, token, expiresAt: refreshExpiry() },
  });
  return token;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export async function issueTokenPair(
  userId: string,
  role: string
): Promise<IssuedTokens> {
  const accessToken = signAccessToken(userId, role);
  const refreshToken = await issueRefreshToken(userId);
  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(
  presentedToken: string
): Promise<IssuedTokens> {
  const existing = await prisma.refreshToken.findUnique({
    where: { token: presentedToken },
    include: { user: true },
  });

  if (
    !existing ||
    existing.revoked ||
    existing.expiresAt.getTime() < Date.now()
  ) {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revoked: true },
  });

  return issueTokenPair(existing.userId, existing.user.role);
}

export async function revokeRefreshToken(
  presentedToken: string,
  userId: string
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { token: presentedToken, userId },
    data: { revoked: true },
  });
}
