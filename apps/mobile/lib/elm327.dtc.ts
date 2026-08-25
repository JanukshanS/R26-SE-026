/**
 * Reading diagnostic trouble codes from an ELM327.
 *
 * WHY THIS IS SEPARATE FROM THE PID PATH. Live PIDs are polled continuously
 * during a trip; codes are read once per trip, at the end. They also fail
 * differently: a PID that does not answer is one missing number, while a code
 * read that does not answer is indistinguishable from a car with nothing
 * wrong. That difference is the whole reason `readOk` exists below, and it is
 * important enough to keep out of the hot polling loop.
 *
 * The parser mirrors app/services/dtc.py on the server byte for byte. It runs
 * on the phone so the upload carries codes rather than raw hex, but the server
 * re-derives nothing and trusts nothing structural: it looks each code up in
 * its own catalogue.
 */

export type DtcStatus = "confirmed" | "pending" | "permanent";

export interface DtcReading {
  code: string;
  status: DtcStatus;
}

export interface DtcScan {
  codes: DtcReading[];
  /**
   * TRUE ONLY WHEN THE ADAPTER ACTUALLY ANSWERED mode 03.
   *
   * An empty `codes` array means one of two completely different things: the
   * car has no faults, or we could not ask. The server refuses to close any
   * existing fault unless this is true, because treating a failed read as "all
   * clear" would wipe a live fault off the driver's screen and tell them
   * everything was fine.
   */
  readOk: boolean;
  milOn?: boolean;
  /** What the ECU says it has stored, which may exceed what mode 03 returned. */
  storedCount?: number;
}

/** Mode request -> the byte that opens its positive response. */
const MODE_RESPONSE: Record<string, number> = { "03": 0x43, "07": 0x47, "0A": 0x4a };

const SYSTEM = ["P", "C", "B", "U"] as const;

const NON_PAYLOAD = /NO\s*DATA|SEARCHING|UNABLE\s*TO\s*CONNECT|BUS\s*INIT|STOPPED|ERROR|\?/i;

/** A frame number at the start of a line in a multi-frame CAN reply. */
const FRAME_PREFIX = /^[ \t]*[0-9A-Fa-f][ \t]*:/gm;

/**
 * Strip a raw reply down to bare hex, and report whether it was framed.
 *
 * Adapters end lines with CR, not LF, so the line anchors have to be
 * normalised before the frame numbers can be recognised at all - otherwise
 * `0:` and `1:` survive into the payload and shift every byte after them.
 */
function clean(raw: string): { hex: string; multiframe: boolean } {
  let text = raw.replace(/>/g, " ").replace(/\r/g, "\n");

  FRAME_PREFIX.lastIndex = 0;
  let multiframe = FRAME_PREFIX.test(text);
  FRAME_PREFIX.lastIndex = 0;
  text = text.replace(FRAME_PREFIX, " ");
  text = text.replace(/\n+/g, " ");

  let tokens = text
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NON_PAYLOAD.test(t) && /^[0-9A-Fa-f]+$/.test(t))
    .map((t) => t.toUpperCase());

  // A multi-frame reply is preceded by an odd-length total-length header such
  // as "009". Its oddness is how it is told apart from a data byte.
  if (tokens.length > 0 && tokens[0].length % 2 === 1) {
    multiframe = true;
    tokens = tokens.slice(1);
  }

  let hex = tokens.join("");
  if (hex.length % 2 === 1) hex = hex.slice(1);
  return { hex, multiframe };
}

/**
 * Two bytes into a code such as `P0301`.
 *
 * `0000` is padding rather than a code - older protocols pad every reply to a
 * fixed length, so it is the most common value on the wire.
 */
export function decodeDtc(b1: number, b2: number): string | null {
  if (b1 === 0 && b2 === 0) return null;
  const system = SYSTEM[(b1 >> 6) & 0b11];
  const first = (b1 >> 4) & 0b11;
  const hex = (n: number) => n.toString(16).toUpperCase();
  return `${system}${first}${hex(b1 & 0x0f)}${hex(b2 >> 4)}${hex(b2 & 0x0f)}`;
}

/**
 * Every code in one adapter reply.
 *
 * Returns [] for "no codes", for an unreadable reply, and for a reply to a
 * different mode. Callers must never read [] as proof the car is fault-free -
 * that is what `readOk` is for.
 */
export function parseDtcResponse(raw: string, mode: string = "03"): string[] {
  const header = MODE_RESPONSE[mode.toUpperCase().trim()];
  if (header === undefined) return [];

  const { hex, multiframe } = clean(raw);
  if (hex.length < 2) return [];

  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(value)) return [];
    bytes.push(value);
  }

  const start = bytes.indexOf(header);
  if (start === -1) return [];

  let payload = bytes.slice(start + 1);

  // Is the first byte a DTC count, or half of a code? Two signals, because
  // neither is sufficient alone. A framed reply is CAN, and CAN always sends
  // the count. An unframed reply is decided arithmetically: with a count byte
  // the payload is 1 + 2n and therefore odd. Arithmetic alone is wrong for
  // framed replies, where ISO-TP pads the last frame back to even.
  if (multiframe || payload.length % 2 === 1) payload = payload.slice(1);

  const codes: string[] = [];
  for (let i = 0; i + 1 < payload.length; i += 2) {
    const code = decodeDtc(payload[i], payload[i + 1]);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Mode 01 PID 01: dashboard lamp state and how many codes are stored. */
export function parseMilStatus(raw: string): { milOn: boolean; dtcCount: number } | null {
  const { hex } = clean(raw);
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(value)) return null;
    bytes.push(value);
  }
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0x41 && bytes[i + 1] === 0x01) {
      const a = bytes[i + 2];
      return { milOn: (a & 0x80) !== 0, dtcCount: a & 0x7f };
    }
  }
  return null;
}

type SendCommandFn = (cmd: string) => Promise<string>;

/**
 * Read confirmed and pending codes.
 *
 * Order matters. Mode 03 is asked first and decides `readOk`, because it is
 * the mode every OBD-II vehicle must support - if it does not answer, nothing
 * about this scan can be trusted. Mode 07 is best effort on top: plenty of
 * adapters and vehicles answer 03 and ignore 07, and losing pending codes is a
 * far smaller loss than falsely reporting a clean scan.
 *
 * Never sends mode 04. Clearing codes destroys the freeze frame a mechanic
 * needs and resets the readiness monitors an emissions test depends on, so it
 * is deliberately absent from the driver app entirely.
 */
export async function scanDtcs(
  sendCommand: SendCommandFn,
  logTag: string = "[ELM327:DTC]"
): Promise<DtcScan> {
  const scan: DtcScan = { codes: [], readOk: false };

  let confirmedRaw: string;
  try {
    confirmedRaw = await sendCommand("03");
  } catch (err) {
    console.log(`${logTag} mode 03 failed, reporting scan as not performed:`, err);
    return scan;
  }

  // "NO DATA" is a real answer meaning nothing is stored, and is the normal
  // reply from a healthy car. It counts as a successful read - which is the
  // whole point, since that is what lets the server close resolved faults.
  const answered = /NO\s*DATA/i.test(confirmedRaw) || /4[37A]/i.test(confirmedRaw);
  if (!answered) {
    console.log(`${logTag} mode 03 gave no usable answer; scan not trusted`);
    return scan;
  }
  scan.readOk = true;

  for (const code of parseDtcResponse(confirmedRaw, "03")) {
    scan.codes.push({ code, status: "confirmed" });
  }

  try {
    const pendingRaw = await sendCommand("07");
    for (const code of parseDtcResponse(pendingRaw, "07")) {
      // A code that is already confirmed must not be listed twice at the
      // weaker status - confirmed is the more serious of the two.
      if (!scan.codes.some((c) => c.code === code)) {
        scan.codes.push({ code, status: "pending" });
      }
    }
  } catch {
    /* pending codes are a bonus; a confirmed scan already succeeded */
  }

  try {
    const mil = parseMilStatus(await sendCommand("0101"));
    if (mil) {
      scan.milOn = mil.milOn;
      scan.storedCount = mil.dtcCount;
    }
  } catch {
    /* lamp state is decoration next to the codes themselves */
  }

  console.log(
    `${logTag} scan complete: ${scan.codes.length} code(s), MIL=${scan.milOn ?? "?"}`
  );
  return scan;
}
