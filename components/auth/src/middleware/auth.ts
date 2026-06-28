import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/tokens";
import { fail } from "../utils/http";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return fail(res, 401, "Missing or invalid Authorization header");
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return fail(res, 401, "Token expired or invalid");
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return fail(res, 401, "Authentication required");
    }
    if (!roles.includes(req.user.role)) {
      return fail(res, 403, "Insufficient role");
    }
    next();
  };
}
