/**
 * The vehicle owner's side of the garage system. A Kaduna member's cars are
 * matched to garages' records by plate (see kadunaVehicles.ts), so the moment
 * any garage opens a job card or a booking for one of their plates, it shows
 * in their dashboard: status, timeline, approvals, invoice, through the job's
 * tracking link. Nothing has to be linked by hand.
 *
 * Privacy: open jobs and upcoming bookings show whenever the plate is theirs
 * now; finished jobs only if they ended after the member registered the car,
 * so a previous owner's history stays private.
 *
 * Members can also find garages that take online bookings (and haven't turned
 * off "show in the Kaduna app") and book a slot for one of their cars. The
 * same list is the public garage directory on kaduna.lk.
 */
import { Prisma } from '@prisma/client';

import { notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { readSettings } from './booking';
import { FINISHED } from './jobCards';
import { OwnedVehicle } from './kadunaVehicles';

const HISTORY_DAYS = 365;
const DAY_MS = 86_400_000;

const firstName = (name: string | null | undefined) => (name ? name.trim().split(/\s+/)[0] : null);

const garageCard = { select: { id: true, name: true, phone: true, address: true, logoUrl: true, brandColor: true } } as const;

/** Garage vehicle ids whose plate (compared on letters and digits) is one of these. */
async function vehicleIdsFor(db: Db, plates: string[]) {
  if (!plates.length) return new Map<string, string>();
  const rows = await db.$queryRaw<{ id: string; compact: string }[]>`
    SELECT "id", regexp_replace(upper("plate"), '[^A-Z0-9]', '', 'g') AS compact
    FROM "vehicles"
    WHERE "plate" IS NOT NULL AND regexp_replace(upper("plate"), '[^A-Z0-9]', '', 'g') = ANY(${plates}::text[])`;
  return new Map(rows.map((r) => [r.id, r.compact]));
}

export async function visitsFor(db: Db, owned: OwnedVehicle[], now = new Date()) {
  const plates = owned.map((v) => v.plate);
  const since = new Map(owned.map((v) => [v.plate, v.since]));
  const byVehicle = await vehicleIdsFor(db, plates);
  const vehicleIds = [...byVehicle.keys()];
  const historyFrom = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);

  const jobs = vehicleIds.length
    ? await db.jobCard.findMany({
        where: {
          vehicleId: { in: vehicleIds },
          OR: [{ status: { notIn: FINISHED } }, { status: 'CLOSED', closedAt: { gte: historyFrom } }],
        },
        include: {
          garage: garageCard,
          vehicle: { select: { plate: true, make: true, model: true, year: true } },
          mechanic: { select: { name: true } },
          updates: { where: { public: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          inspection: { select: { status: true, items: { select: { approval: true } } } },
          invoices: { where: { status: { not: 'VOID' } }, orderBy: { issuedAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    : [];

  const repairs = jobs
    .filter((j) => {
      if (!FINISHED.includes(j.status)) return true;
      const s = since.get(byVehicle.get(j.vehicleId!) ?? '');
      return !s || (j.closedAt ?? j.updatedAt) >= s;
    })
    .map((j) => ({
      id: j.id,
      garage: j.garage,
      jobNumber: j.number,
      status: j.status,
      source: j.source,
      incidentId: j.dispatchIncidentId,
      plate: j.vehicle?.plate ?? null,
      vehicle: j.vehicle,
      complaint: j.complaint,
      mechanicName: firstName(j.mechanic?.name),
      promisedAt: j.promisedAt,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      closedAt: j.closedAt,
      lastUpdate: j.updates[0] ? { status: j.updates[0].status, note: j.updates[0].note, createdAt: j.updates[0].createdAt } : null,
      approvalsWaiting: j.inspection?.status === 'SENT' ? j.inspection.items.filter((i) => i.approval === 'PENDING').length : 0,
      invoice: j.invoices[0] ? { status: j.invoices[0].status, total: j.invoices[0].total.toNumber() } : null,
      trackingToken: j.trackingToken,
    }));

  // Bookings carry the plate as typed (online) or through their vehicle (staff).
  const from = new Date(now.getTime() - DAY_MS / 2);
  const bookingIds = plates.length
    ? (
        await db.$queryRaw<{ id: string }[]>`
          SELECT a."id" FROM "appointments" a
          LEFT JOIN "vehicles" v ON v."id" = a."vehicle_id"
          WHERE a."status"::text IN ('BOOKED', 'CONFIRMED') AND a."starts_at" >= ${from}
            AND regexp_replace(upper(coalesce(v."plate", a."plate", '')), '[^A-Z0-9]', '', 'g') = ANY(${plates}::text[])
          ORDER BY a."starts_at" ASC
          LIMIT 30`
      ).map((r) => r.id)
    : [];
  const appointments = bookingIds.length
    ? await db.appointment.findMany({ where: { id: { in: bookingIds } }, include: { garage: garageCard, vehicle: { select: { plate: true } } }, orderBy: { startsAt: 'asc' } })
    : [];
  const bookings = appointments.map((a) => ({
    id: a.id,
    garage: a.garage,
    service: a.service,
    startsAt: a.startsAt,
    durationMin: a.durationMin,
    status: a.status,
    plate: a.vehicle?.plate ?? a.plate,
    source: a.source,
    // Online bookings can be viewed or cancelled with their own link.
    manageToken: a.source === 'ONLINE' ? a.publicToken : null,
    cancellable: a.source === 'ONLINE' && a.startsAt > now,
  }));

  return { repairs, bookings };
}

// ─── Finding a garage to book ───────────────────────────────────────────────

export const isListed = (g: { bookingToken: string | null; bookingSettings: Prisma.JsonValue }) => {
  if (!g.bookingToken) return false;
  const s = readSettings(g);
  return s.enabled && s.listed;
};

export async function garageDirectory(db: Db, q?: string) {
  const contains = q ? { contains: q, mode: 'insensitive' as const } : undefined;
  const garages = await db.garage.findMany({
    where: { bookingToken: { not: null }, ...(contains ? { OR: [{ name: contains }, { address: contains }] } : {}) },
    orderBy: { name: 'asc' },
    take: 500,
  });
  return garages.filter(isListed).map((g) => {
    const s = readSettings(g);
    // The booking token is already the garage's public link (/book?g=…); listed garages chose to be found.
    return { id: g.id, name: g.name, phone: g.phone, address: g.address, logoUrl: g.logoUrl, brandColor: g.brandColor, services: s.services, note: s.note ?? null, bookingToken: g.bookingToken! };
  });
}

/** A garage a member may book with: listed and taking bookings. */
export async function bookableGarage(db: Db, id: string) {
  const g = await db.garage.findUnique({ where: { id } });
  if (!g || !isListed(g)) throw notFound('Garage');
  return g;
}
