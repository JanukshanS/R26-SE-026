import { Router, Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { ok, fail } from "../utils/http";
import { requireAuth } from "../middleware/auth";

export const vehicleRouter = Router();

vehicleRouter.use(requireAuth);

vehicleRouter.get("/", async (req: Request, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return ok(res, { vehicles });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

vehicleRouter.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      nickname,
      make,
      model,
      year,
      plateNumber,
      color,
      currentMileage,
      fuelType,
      isDefault,
    } = req.body ?? {};

    if (!make || !model || !plateNumber) {
      return fail(res, 400, "make, model and plateNumber are required");
    }

    const existingCount = await prisma.vehicle.count({ where: { userId } });
    const makeDefault = Boolean(isDefault) || existingCount === 0;

    const vehicle = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.vehicle.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }
      return tx.vehicle.create({
        data: {
          userId,
          nickname: nickname ?? null,
          make,
          model,
          year: year ?? null,
          plateNumber,
          color: color ?? null,
          currentMileage: currentMileage ?? 0,
          fuelType: fuelType ?? "petrol",
          isDefault: makeDefault,
        },
      });
    });

    return ok(res, { vehicle }, 201);
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

vehicleRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.vehicle.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return fail(res, 404, "Vehicle not found");
    }

    const {
      nickname,
      make,
      model,
      year,
      plateNumber,
      color,
      currentMileage,
      fuelType,
      isDefault,
    } = req.body ?? {};

    const vehicle = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.vehicle.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }
      return tx.vehicle.update({
        where: { id },
        data: {
          nickname: nickname ?? existing.nickname,
          make: make ?? existing.make,
          model: model ?? existing.model,
          year: year ?? existing.year,
          plateNumber: plateNumber ?? existing.plateNumber,
          color: color ?? existing.color,
          currentMileage: currentMileage ?? existing.currentMileage,
          fuelType: fuelType ?? existing.fuelType,
          isDefault:
            isDefault != null ? Boolean(isDefault) : existing.isDefault,
        },
      });
    });

    return ok(res, { vehicle });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

vehicleRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.vehicle.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return fail(res, 404, "Vehicle not found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.vehicle.delete({ where: { id } });
      if (existing.isDefault) {
        const next = await tx.vehicle.findFirst({
          where: { userId },
          orderBy: { createdAt: "asc" },
        });
        if (next) {
          await tx.vehicle.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return ok(res, { deleted: true, id });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});

vehicleRouter.post("/:id/set-default", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const existing = await prisma.vehicle.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return fail(res, 404, "Vehicle not found");
    }

    const vehicle = await prisma.$transaction(async (tx) => {
      await tx.vehicle.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
      return tx.vehicle.update({
        where: { id },
        data: { isDefault: true },
      });
    });

    return ok(res, { vehicle });
  } catch (err) {
    return fail(res, 500, (err as Error).message);
  }
});
