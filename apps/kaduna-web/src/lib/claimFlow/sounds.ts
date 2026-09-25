"use client";

/**
 * Short UI sound cues (shutter click, record start/stop) synthesized with the
 * Web Audio API rather than shipped as audio files — no asset to source/host,
 * and a couple of oscillator blips is all these need. Every call is
 * user-gesture-triggered (tapping Take Photo / Start Recording), so autoplay
 * restrictions don't block it.
 */

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

function tone(ctx: AudioContext, freq: number, startTime: number, duration: number, peakGain: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/** Brief camera-shutter click — a fast, high, decaying two-blip. */
export function playShutterSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(ctx, 1800, now, 0.03, 0.25);
  tone(ctx, 1200, now + 0.03, 0.05, 0.2);
}

/** Short rising two-tone beep — recording started. */
export function playRecordStartSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(ctx, 600, now, 0.09, 0.2);
  tone(ctx, 900, now + 0.1, 0.12, 0.2);
}

/** Short falling two-tone beep — recording stopped. */
export function playRecordStopSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(ctx, 900, now, 0.09, 0.2);
  tone(ctx, 600, now + 0.1, 0.12, 0.2);
}
