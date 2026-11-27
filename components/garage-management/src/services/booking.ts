/**
 * Online booking. The owner shares a link (/book?g=<bookingToken>); customers
 * see the garage's free slots and book one, with no account.
 *
 *   Slots come from the garage's opening hours, cut into slotMinutes pieces,
 *   in the garage's own time zone (Sri Lanka by default). A slot is free while
 *   fewer than `capacity` live appointments (booked, confirmed or checked in)
 *   overlap it, it starts at least leadHours from now, and it's within
 *   daysAhead. Staff bookings count too, so the diary and the link never
 *   double-book each other.
 *
 *   Booking locks the garage row first (SELECT … FOR UPDATE) and re-checks the
 *   slot inside the transaction, so two customers racing for the last place
 *   in a slot can't both get it.
 *
 * The booking token is the only key, like the tracking link, and the owner
 * can reset it. Each online booking gets its own token so the customer can
 * look at or cancel it later.
 */
import { AppointmentStatus, Garage, Prisma } from '@prisma/client';
import { z } from 'zod';

import { config } from '../config';
import { conflict, DomainError, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { bookingSettingsInput, publicBookingInput, weekdays } from '../validation';
import { emit, newTrackingToken, normalisePlate } from './shared';

export type BookingSettings = z.infer<typeof bookingSettingsInput>;

const LIVE: AppointmentStatus[] = ['BOOKED', 'CONFIRMED', 'ARRIVED'];
const DAY_MS = 86_400_000;
/** Online bookings one phone number may hold at a garage at once. */
const MAX_PER_PHONE = 3;

export const DEFAULT_SETTINGS: BookingSettings = {
  enabled: false,
  listed: true,
  slotMinutes: 60,
  capacity: 2,
  leadHours: 2,
  daysAhead: 14,
  hours: {
    mon: { open: '08:00', close: '17:00' },
    tue: { open: '08:00', close: '17:00' },
    wed: { open: '08:00', close: '17:00' },
    thu: { open: '08:00', close: '17:00' },
    fri: { open: '08:00', close: '17:00' },
    sat: { open: '08:00', close: '13:00' },
    sun: null,
  },
  services: ['Full service', 'Oil change', 'Brake check', 'AC service', 'Wheel alignment', 'Diagnosis'],
  note: null,
};

export function readSettings(garage: Pick<Garage, 'bookingSettings'>): BookingSettings {
  const parsed = bookingSettingsInput.safeParse(garage.bookingSettings);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

// ─── Garage time ───────────────────────────────────────────────────────────

const offsetMs = () => config.timeZoneOffsetMinutes * 60_000;
const localDay = (d: Date) => new Date(d.getTime() + offsetMs()).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** "2026-11-16" + "08:30" in garage time → the UTC instant. */
const at = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00Z`) - offsetMs());
const weekdayOf = (day: string) => weekdays[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
const clockOf = (d: Date) => new Date(d.getTime() + offsetMs()).toISOString().slice(11, 16);

export interface DaySlots {
  date: string;
  weekday: (typeof weekdays)[number];
  open: boolean;
  slots: { startsAt: string; time: string; free: number }[];
}

/** Free slots for `days` days from `fromDay` (today when left out), against the live appointments in that window. */
export async function computeSlots(db: Db, garage: Garage, settings: BookingSettings, fromDay: string | undefined, days: number, now = new Date()): Promise<DaySlots[]> {
  const today = localDay(now);
  const lastDay = addDays(today, settings.daysAhead - 1);
  const first = !fromDay || fromDay < today ? today : fromDay;
  const span = Array.from({ length: days }, (_, i) => addDays(first, i)).filter((d) => d <= lastDay);
  if (span.length === 0) return [];

  const windowStart = at(span[0], '00:00');
  const windowEnd = at(addDays(span[span.length - 1], 1), '00:00');
  // Starts up to 12 h before the window catch long jobs that run into it.
  const busy = await db.appointment.findMany({
    where: { garageId: garage.id, status: { in: LIVE }, startsAt: { gte: new Date(windowStart.getTime() - 12 * 3_600_000), lt: windowEnd } },
    select: { startsAt: true, durationMin: true },
  });
  const earliest = now.getTime() + settings.leadHours * 3_600_000;
  const step = settings.slotMinutes * 60_000;

  return span.map((date) => {
    const weekday = weekdayOf(date);
    const hours = settings.hours[weekday];
    const slots: DaySlots['slots'] = [];
    if (hours) {
      const close = at(date, hours.close).getTime();
      for (let t = at(date, hours.open).getTime(); t + step <= close; t += step) {
        if (t < earliest) continue;
        const end = t + step;
        const taken = busy.filter((a) => a.startsAt.getTime() < end && a.startsAt.getTime() + a.durationMin * 60_000 > t).length;
        slots.push({ startsAt: new Date(t).toISOString(), time: clockOf(new Date(t)), free: Math.max(0, settings.capacity - taken) });
      }
    }
    return { date, weekday, open: Boolean(hours), slots };
  });
}

// ─── Owner ─────────────────────────────────────────────────────────────────

export async function saveSettings(db: Db, garage: Garage, settings: BookingSettings) {
  return db.garage.update({
    where: { id: garage.id },
    data: { bookingSettings: settings as unknown as Prisma.InputJsonObject, bookingToken: garage.bookingToken ?? newTrackingToken() },
  });
}

export function resetLink(db: Db, garage: Garage) {
  return db.garage.update({ where: { id: garage.id }, data: { bookingToken: newTrackingToken() } });
}

// ─── Customers ─────────────────────────────────────────────────────────────

export async function garageByBookingToken(db: Db, token: string) {
  const garage = await db.garage.findUnique({ where: { bookingToken: token } });
  if (!garage) throw notFound('Booking page');
  return garage;
}

export function presentBookingPage(garage: Garage) {
  const s = readSettings(garage);
  return {
    garage: { name: garage.name, phone: garage.phone, address: garage.address, logoUrl: garage.logoUrl, brandColor: garage.brandColor },
    enabled: s.enabled,
    slotMinutes: s.slotMinutes,
    daysAhead: s.daysAhead,
    hours: s.hours,
    services: s.services,
    note: s.note ?? null,
    timeZoneOffsetMinutes: config.timeZoneOffsetMinutes,
  };
}

export async function book(db: Prisma.TransactionClient, garage: Garage, input: z.infer<typeof publicBookingInput>, now = new Date()) {
  const settings = readSettings(garage);
  if (!settings.enabled) throw new DomainError(409, 'This garage is not taking online bookings right now');
  if (settings.services.length && !settings.services.includes(input.service)) throw new DomainError(422, 'Choose one of the services offered');

  // One booking at a time per garage, so the check below can't go stale.
  await db.$queryRaw`SELECT id FROM "garages" WHERE id = ${garage.id} FOR UPDATE`;

  const startsAt = new Date(input.startsAt);
  const day = localDay(startsAt);
  const [slots] = await computeSlots(db, garage, settings, day, 1, now);
  const slot = slots?.slots.find((s) => s.startsAt === startsAt.toISOString());
  if (!slot) throw new DomainError(422, 'That time is not available. Please pick one of the times shown');
  if (slot.free <= 0) throw conflict('Sorry, that time was just taken. Please pick another');

  const phone = input.phone.replace(/[^\d+]/g, '');
  const held = await db.appointment.count({
    where: { garageId: garage.id, source: 'ONLINE', phone, status: { in: ['BOOKED', 'CONFIRMED'] }, startsAt: { gte: now } },
  });
  if (held >= MAX_PER_PHONE) throw conflict(`You already have ${held} upcoming bookings here. Call the garage to book more`);

  const appointment = await db.appointment.create({
    data: {
      garageId: garage.id,
      customerName: input.name,
      phone,
      plate: normalisePlate(input.plate),
      service: input.service,
      notes: [input.vehicle ? `Vehicle: ${input.vehicle}` : null, input.notes].filter(Boolean).join('\n') || null,
      startsAt,
      durationMin: settings.slotMinutes,
      source: 'ONLINE',
      publicToken: newTrackingToken(),
    },
  });
  await emit(db, garage.id, 'appointment.booked', { appointmentId: appointment.id, startsAt: startsAt.toISOString(), source: 'ONLINE' });
  return appointment;
}

export async function appointmentByToken(db: Db, token: string) {
  const appointment = await db.appointment.findUnique({ where: { publicToken: token }, include: { garage: true } });
  if (!appointment) throw notFound('Booking');
  return appointment;
}

export function presentPublicAppointment(a: Awaited<ReturnType<typeof appointmentByToken>>, now = new Date()) {
  return {
    garage: { name: a.garage.name, phone: a.garage.phone, address: a.garage.address, logoUrl: a.garage.logoUrl, brandColor: a.garage.brandColor },
    service: a.service,
    startsAt: a.startsAt,
    durationMin: a.durationMin,
    status: a.status,
    name: a.customerName,
    plate: a.plate,
    cancellable: (a.status === 'BOOKED' || a.status === 'CONFIRMED') && a.startsAt > now,
  };
}

export async function cancelByToken(db: Prisma.TransactionClient, token: string, now = new Date()) {
  const a = await appointmentByToken(db, token);
  if (a.status === 'CANCELLED') return a;
  if (!presentPublicAppointment(a, now).cancellable) throw conflict('This booking can no longer be cancelled online. Please call the garage');
  await db.appointment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
  await emit(db, a.garageId, 'appointment.cancelled', { appointmentId: a.id, by: 'customer' });
  return appointmentByToken(db, token);
}
