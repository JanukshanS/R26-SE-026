import { Prisma, PrismaClient } from '@prisma/client';

// One client per process; hot reload in development would otherwise open a new pool each time.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Either the client or the handle inside prisma.$transaction, so services work in both. */
export type Db = PrismaClient | Prisma.TransactionClient;
