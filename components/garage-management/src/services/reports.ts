/**
 * Business reports for a date range, in the garage's own days (Sri Lanka time
 * by default). Revenue counts paid invoices by the day they were paid. Labour
 * and parts come from the invoice line snapshots, so a report never changes
 * because a price was edited later. Parts cost covers the jobs whose invoices
 * were paid in the range, at the cost recorded when each part went onto the
 * job (today's cost for older movements), so profit compares like with like.
 */
import { config } from '../config';
import { DomainError } from '../utils/http';
import { Db } from '../utils/prisma';

const DAY_MS = 86_400_000;
const offsetMs = () => config.timeZoneOffsetMinutes * 60_000;
const localDay = (d: Date) => new Date(d.getTime() + offsetMs()).toISOString().slice(0, 10);
const dayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - offsetMs());
const round2 = (n: number) => Math.round(n * 100) / 100;

type Line = { kind: 'LABOUR' | 'PART'; description: string; quantity: number; lineTotal: number };

export function resolveRange(from?: string, to?: string) {
  const end = to ?? localDay(new Date());
  const start = from ?? localDay(new Date(dayStart(end).getTime() - 29 * DAY_MS));
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) throw new DomainError(422, 'Use real dates, YYYY-MM-DD');
  if (start > end) throw new DomainError(422, '`from` must be on or before `to`');
  if ((Date.parse(end) - Date.parse(start)) / DAY_MS > 366) throw new DomainError(422, 'Choose a range of a year or less');
  return { from: start, to: end, gte: dayStart(start), lt: new Date(dayStart(end).getTime() + DAY_MS) };
}

function topBy<T>(rows: Map<string, T>, key: (t: T) => number, n: number) {
  return [...rows.values()].sort((a, b) => key(b) - key(a)).slice(0, n);
}

export async function report(db: Db, garageId: string, range: ReturnType<typeof resolveRange>) {
  const within = { gte: range.gte, lt: range.lt };
  const [invoices, partMoves, opened, closed, staff, inspectionItems, newCustomers, appointments] = await Promise.all([
    db.invoice.findMany({
      where: { garageId, status: 'PAID', paidAt: within },
      select: { lines: true, subtotal: true, tax: true, total: true, paymentMethod: true, paidAt: true, jobCard: { select: { mechanicId: true } } },
    }),
    // Parts on the jobs those invoices paid for, so cost matches the revenue it earned
    // (parts on jobs still in the workshop aren't a cost of this period's sales yet).
    db.stockMovement.findMany({
      where: { garageId, reason: { in: ['JOB_USE', 'RETURN'] }, jobCard: { invoices: { some: { status: 'PAID', paidAt: within } } } },
      select: { quantityChange: true, unitCost: true, part: { select: { unitCost: true } } },
    }),
    db.jobCard.groupBy({ by: ['source'], where: { garageId, createdAt: within }, _count: { _all: true } }),
    db.jobCard.findMany({ where: { garageId, status: 'CLOSED', closedAt: within }, select: { createdAt: true, closedAt: true, mechanicId: true } }),
    db.staffMember.findMany({ where: { garageId }, select: { id: true, name: true } }),
    db.inspectionItem.findMany({
      where: { inspection: { garageId, sentAt: within }, approval: { not: null } },
      select: { approval: true, estimate: true },
    }),
    db.customer.count({ where: { garageId, createdAt: within } }),
    db.appointment.groupBy({ by: ['status'], where: { garageId, startsAt: within }, _count: { _all: true } }),
  ]);

  // Every day in the range, so a chart shows quiet days as zero rather than skipping them.
  const days = new Map<string, { date: string; labour: number; parts: number; total: number }>();
  for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.set(date, { date, labour: 0, parts: 0, total: 0 });
  }
  const methods = new Map<string, { method: string; count: number; total: number }>();
  const services = new Map<string, { description: string; count: number; revenue: number }>();
  const partsSold = new Map<string, { description: string; quantity: number; revenue: number }>();
  const labourByMechanic = new Map<string | null, number>();
  let labour = 0;
  let parts = 0;
  let net = 0;
  let tax = 0;
  let revenue = 0;

  for (const inv of invoices) {
    const day = days.get(localDay(inv.paidAt!));
    net += inv.subtotal.toNumber();
    tax += inv.tax.toNumber();
    revenue += inv.total.toNumber();
    const method = inv.paymentMethod ?? 'OTHER';
    const m = methods.get(method) ?? { method, count: 0, total: 0 };
    m.count += 1;
    m.total += inv.total.toNumber();
    methods.set(method, m);
    if (day) day.total += inv.total.toNumber();

    for (const line of (inv.lines as unknown as Line[]) ?? []) {
      const key = line.description.trim().toLowerCase();
      if (line.kind === 'LABOUR') {
        labour += line.lineTotal;
        if (day) day.labour += line.lineTotal;
        const s = services.get(key) ?? { description: line.description.trim(), count: 0, revenue: 0 };
        s.count += 1;
        s.revenue += line.lineTotal;
        services.set(key, s);
        const mech = inv.jobCard?.mechanicId ?? null;
        labourByMechanic.set(mech, (labourByMechanic.get(mech) ?? 0) + line.lineTotal);
      } else {
        parts += line.lineTotal;
        if (day) day.parts += line.lineTotal;
        const p = partsSold.get(key) ?? { description: line.description.trim(), quantity: 0, revenue: 0 };
        p.quantity += line.quantity;
        p.revenue += line.lineTotal;
        partsSold.set(key, p);
      }
    }
  }

  // JOB_USE is negative and RETURN positive, so this nets out parts put back.
  const partsCost = partMoves.reduce((sum, m) => sum - m.quantityChange.toNumber() * (m.unitCost ?? m.part.unitCost).toNumber(), 0);

  const closedByMechanic = new Map<string | null, number>();
  let turnaroundMs = 0;
  for (const job of closed) {
    closedByMechanic.set(job.mechanicId, (closedByMechanic.get(job.mechanicId) ?? 0) + 1);
    turnaroundMs += job.closedAt!.getTime() - job.createdAt.getTime();
  }
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const mechanicIds = new Set<string | null>([...closedByMechanic.keys(), ...labourByMechanic.keys()]);
  const mechanics = [...mechanicIds]
    .map((id) => ({
      mechanicId: id,
      name: id ? names.get(id) ?? null : null,
      jobsClosed: closedByMechanic.get(id) ?? 0,
      labour: round2(labourByMechanic.get(id) ?? 0),
    }))
    .sort((a, b) => b.labour - a.labour || b.jobsClosed - a.jobsClosed);

  const sourceCount = (s: string) => opened.find((o) => o.source === s)?._count._all ?? 0;
  const apptCount = (s: string) => appointments.find((a) => a.status === s)?._count._all ?? 0;
  const value = (approval: string) =>
    round2(inspectionItems.filter((i) => i.approval === approval).reduce((sum, i) => sum + (i.estimate?.toNumber() ?? 0), 0));

  return {
    from: range.from,
    to: range.to,
    totals: {
      revenue: round2(revenue),
      net: round2(net),
      tax: round2(tax),
      invoices: invoices.length,
      averageInvoice: invoices.length ? round2(revenue / invoices.length) : 0,
      labour: round2(labour),
      parts: round2(parts),
      partsCost: round2(partsCost),
      grossProfit: round2(net - partsCost),
    },
    days: [...days.values()].map((d) => ({ ...d, labour: round2(d.labour), parts: round2(d.parts), total: round2(d.total) })),
    paymentMethods: [...methods.values()].map((m) => ({ ...m, total: round2(m.total) })),
    jobs: {
      opened: sourceCount('WALK_IN') + sourceCount('KADUNA_DISPATCH'),
      walkIn: sourceCount('WALK_IN'),
      kaduna: sourceCount('KADUNA_DISPATCH'),
      closed: closed.length,
      averageTurnaroundHours: closed.length ? Math.round((turnaroundMs / closed.length / 3_600_000) * 10) / 10 : null,
    },
    mechanics,
    topServices: topBy(services, (s) => s.revenue, 8).map((s) => ({ ...s, revenue: round2(s.revenue) })),
    topParts: topBy(partsSold, (p) => p.revenue, 8).map((p) => ({ ...p, revenue: round2(p.revenue) })),
    inspections: {
      recommended: inspectionItems.length,
      approved: inspectionItems.filter((i) => i.approval === 'APPROVED').length,
      declined: inspectionItems.filter((i) => i.approval === 'DECLINED').length,
      pending: inspectionItems.filter((i) => i.approval === 'PENDING').length,
      approvedValue: value('APPROVED'),
      declinedValue: value('DECLINED'),
    },
    customers: { new: newCustomers },
    appointments: {
      total: appointments.reduce((n, a) => n + a._count._all, 0),
      arrived: apptCount('ARRIVED'),
      noShow: apptCount('NO_SHOW'),
      cancelled: apptCount('CANCELLED'),
    },
  };
}
