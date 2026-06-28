import { Response } from "express";

export function ok(res: Response, data: unknown, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
  });
}

export function fail(res: Response, status: number, error: string) {
  return res.status(status).json({
    success: false,
    data: null,
    error,
    timestamp: new Date().toISOString(),
  });
}
