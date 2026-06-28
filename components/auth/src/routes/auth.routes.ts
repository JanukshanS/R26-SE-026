import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma";
import { config } from "../config";
import { ok, fail } from "../utils/http";
import { safeUser } from "../utils/serialize";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../services/tokens";

export const authRouter = Router();

const SELF_REGISTER_ROLES = ["driver", "provider"];

authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, role } = req.body ?? {};
    if (!name || !email || !password) {
      return fail(res, 400, "name, email and password are required");
    }

    const requestedRole =
      typeof role === "string" && SELF_REGISTER_ROLES.includes(role)
        ? role
        : "driver";

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return fail(res, 409, "Email already registered");
    }

    const passwordHash = bcrypt.hashSync(password, config.bcryptRounds);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone ?? null,
        passwordHash,
        role: requestedRole,
      },
    });

    const tokens = await issueTokenPair(user.id, user.role);
    return ok(res, { user: safeUser(user), ...tokens }, 201);
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return fail(res, 400, "email and password are required");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return fail(res, 401, "Invalid email or password");
    }

    const tokens = await issueTokenPair(user.id, user.role);
    return ok(res, { user: safeUser(user), ...tokens });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return fail(res, 400, "refreshToken is required");
    }

    const tokens = await rotateRefreshToken(refreshToken);
    return ok(res, tokens);
  } catch {
    return fail(res, 401, "Invalid, revoked, or expired refresh token");
  }
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });
    if (!user) {
      return fail(res, 404, "User not found");
    }
    return ok(res, { user: safeUser(user) });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

authRouter.patch("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const { providerId, name, phone } = req.body ?? {};

    const data: { providerId?: string | null; name?: string; phone?: string | null } = {};
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (phone !== undefined) data.phone = phone;

    // providerId links this account to a dispatch provider record, so it is an
    // authorization-bearing field — not freely self-assignable. Only provider
    // accounts may link, and a provider profile may belong to at most one account.
    if (providerId !== undefined) {
      if (req.user!.role !== "provider") {
        return fail(res, 403, "Only provider accounts can link a provider profile");
      }
      if (providerId !== null) {
        const claimed = await prisma.user.findFirst({
          where: { providerId, NOT: { id: req.user!.id } },
          select: { id: true },
        });
        if (claimed) {
          return fail(res, 409, "That provider profile is already linked to another account");
        }
      }
      data.providerId = providerId;
    }

    if (Object.keys(data).length === 0) {
      return fail(res, 400, "No updatable fields provided");
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data,
    });
    return ok(res, { user: safeUser(user) });
  } catch (err: any) {
    // Unique constraint race on providerId -> 409 rather than a 500.
    if (err?.code === "P2002") {
      return fail(res, 409, "That provider profile is already linked to another account");
    }
    return fail(res, 500, (err as Error).message);
  }
});

authRouter.post("/logout", requireAuth, async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return fail(res, 400, "refreshToken is required");
    }
    await revokeRefreshToken(refreshToken, req.user!.id);
    return ok(res, { revoked: true });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

export const adminRouter = Router();

adminRouter.get(
  "/users",
  requireAuth,
  requireRole("ops"),
  async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return ok(res, { users });
  }
);
