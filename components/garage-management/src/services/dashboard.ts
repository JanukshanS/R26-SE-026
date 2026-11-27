/** The numbers a garage owner glances at first thing in the morning. */
import { JobStatus } from '@prisma/client';

import { config } from '../config';
import { Db, prisma } from '../utils/prisma';
import { presentPart } from './presenters';

const OPEN_STATUSES: JobStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'];

/** Start of "today" and "this month" on the garages' clock (Sri Lanka by default), as UTC instants. */
function localBoundaries(now = new Date()) {
  const offsetMs = config.timeZoneOffsetMinutes * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs;
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - offsetMs;
  return { dayStart: new Date(dayStart), dayEnd: new Date(dayStart + 86_400_000), monthStart: new Date(monthStart) };
}

export async function dashboard(db: Db, garageId: string) {
  const { dayStart, dayEnd, monthStart } = localBoundaries();
  const [byStatus, dueToday, revenue, unpaid, lowStock] = await Promise.all([
    db.jobCard.groupBy({ by: ['status'], where: { garageId }, _count: { _all: true } }),
    db.jobCard.count({ where: { garageId, status: { in: OPEN_STATUSES }, promisedAt: { gte: dayStart, lt: dayEnd } } }),
    db.invoice.aggregate({ where: { garageId, status: 'PAID', paidAt: { gte: monthStart } }, _sum: { total: true } }),
    db.invoice.aggregate({ where: { garageId, status: 'UNPAID' }, _sum: { total: true } }),
    db.part.findMany({
      where: { garageId, active: true, stockQty: { lte: prisma.part.fields.reorderLevel } },
      orderBy: { name: 'asc' },
      take: 20,
    }),
  ]);
  const jobsByStatus = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  return {
    jobsByStatus,
    openJobs: OPEN_STATUSES.reduce((n, s) => n + (jobsByStatus[s] ?? 0), 0),
    jobsDueToday: dueToday,
    revenueThisMonth: revenue._sum.total?.toNumber() ?? 0,
    unpaidTotal: unpaid._sum.total?.toNumber() ?? 0,
    lowStockParts: lowStock.map(presentPart),
  };
}
