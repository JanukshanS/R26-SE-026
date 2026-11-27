/**
 * Where uploaded part files (photos, datasheets) are kept. Two stores, chosen
 * with FILES_DRIVER:
 *
 *   local  (default) files on this service's disk (FILES_DIR), uploaded and
 *          downloaded through short-lived signed URLs it serves itself at
 *          /api/v1/files/<token>. Good for development and a single server
 *          with a volume.
 *   s3     an S3 bucket, or anything S3-compatible (Cloudflare R2, MinIO,
 *          DigitalOcean Spaces) via S3_ENDPOINT. The browser uploads and
 *          downloads directly with presigned URLs (AWS Signature V4); the
 *          bucket stays private.
 *
 * Either way the browser does the same thing: ask for an upload URL, PUT the
 * bytes there, then confirm. Nothing else in the service knows which store
 * is in use.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { Request, Response, Router } from 'express';

import { config } from '../config';
import { logger } from '../utils/logger';

export interface Upload {
  url: string;
  method: 'PUT';
  /** Send these headers with the PUT. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface FileStore {
  readonly kind: 'local' | 's3';
  uploadUrl(key: string, contentType: string, size: number): Promise<Upload>;
  downloadUrl(key: string, contentType: string | null, filename: string): Promise<string>;
  /** The stored object's size, or null when it isn't there. */
  head(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
}

const UPLOAD_SECONDS = 15 * 60;
const DOWNLOAD_SECONDS = 60 * 60;
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

// ─── Local disk ─────────────────────────────────────────────────────────────

type Grant = { k: string; m: 'GET' | 'PUT'; ct?: string | null; max?: number; fn?: string; exp: number };

let devSecret: string | null = null;
function localSecret() {
  if (config.filesSecret) return config.filesSecret;
  if (config.internalToken) return config.internalToken;
  if (!devSecret) {
    devSecret = randomBytes(32).toString('hex');
    logger.warn('FILES_SECRET is not set: file links stop working when the service restarts');
  }
  return devSecret;
}

const signGrant = (g: Grant) => {
  const body = b64url(JSON.stringify(g));
  return `${body}.${b64url(createHmac('sha256', localSecret()).update(body).digest())}`;
};

function readGrant(token: string): Grant | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', localSecret()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const g = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Grant;
    return g.exp * 1000 > Date.now() ? g : null;
  } catch {
    return null;
  }
}

function safePath(key: string) {
  const root = path.resolve(config.filesDir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Bad file key');
  return full;
}

const localStore: FileStore = {
  kind: 'local',
  async uploadUrl(key, contentType, size) {
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_SECONDS;
    return { url: `${config.publicUrl}/api/v1/files/${signGrant({ k: key, m: 'PUT', ct: contentType, max: size, exp })}`, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(exp * 1000).toISOString() };
  },
  async downloadUrl(key, contentType, filename) {
    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_SECONDS;
    return `${config.publicUrl}/api/v1/files/${signGrant({ k: key, m: 'GET', ct: contentType, fn: filename, exp })}`;
  },
  async head(key) {
    try {
      return { size: (await stat(safePath(key))).size };
    } catch {
      return null;
    }
  },
  async remove(key) {
    await rm(safePath(key), { force: true });
  },
};

/** The local store's own upload and download endpoints (no sign-in: the signed token is the permission). */
export const localFilesRouter = Router();

localFilesRouter.put('/:token', async (req: Request, res: Response) => {
  const g = readGrant(req.params.token);
  if (!g || g.m !== 'PUT') {
    res.status(403).json({ success: false, error: 'This upload link is not valid or has expired', timestamp: new Date().toISOString() });
    return;
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (g.max && declared > g.max) {
    res.status(413).json({ success: false, error: 'The file is bigger than declared', timestamp: new Date().toISOString() });
    return;
  }
  const file = safePath(g.k);
  await mkdir(path.dirname(file), { recursive: true });
  let seen = 0;
  req.on('data', (chunk: Buffer) => {
    seen += chunk.length;
    if (g.max && seen > g.max) req.destroy(new Error('too big'));
  });
  try {
    await pipeline(req, createWriteStream(file));
    res.status(200).json({ success: true, data: { size: seen }, timestamp: new Date().toISOString() });
  } catch {
    await rm(file, { force: true });
    if (!res.headersSent) res.status(413).json({ success: false, error: 'The upload failed or was too big', timestamp: new Date().toISOString() });
  }
});

localFilesRouter.get('/:token', async (req: Request, res: Response) => {
  const g = readGrant(req.params.token);
  if (!g || g.m !== 'GET') {
    res.status(403).json({ success: false, error: 'This link is not valid or has expired', timestamp: new Date().toISOString() });
    return;
  }
  const file = safePath(g.k);
  try {
    const st = await stat(file);
    res.setHeader('Content-Type', g.ct || 'application/octet-stream');
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Content-Disposition', `inline; filename="${(g.fn ?? 'file').replace(/["\\\r\n]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // The web app shows these images from another origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    await pipeline(createReadStream(file), res);
  } catch {
    if (!res.headersSent) res.status(404).json({ success: false, error: 'File not found', timestamp: new Date().toISOString() });
  }
});

// ─── S3 (and S3-compatible) ─────────────────────────────────────────────────

/** RFC 3986 encoding, as Signature V4 wants it. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (key: string) => key.split('/').map(enc).join('/');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

export type S3Settings = { bucket: string; region: string; endpoint?: string | null; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean };

/** A presigned S3 URL (AWS Signature V4, query string, host header only, unsigned payload). */
export function presignS3(s: S3Settings, method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', key: string, expiresSeconds: number, now = new Date(), extra: Record<string, string> = {}) {
  const base = s.endpoint ? new URL(s.endpoint) : new URL(`https://s3.${s.region}.amazonaws.com`);
  const pathStyle = s.forcePathStyle ?? Boolean(s.endpoint);
  const host = pathStyle ? base.host : `${s.bucket}.${base.host}`;
  const uri = pathStyle ? `/${enc(s.bucket)}/${encPath(key)}` : `/${encPath(key)}`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${s.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    ...extra,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${s.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  const canonical = [method, uri, query, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key4 = hmac(hmac(hmac(hmac(`AWS4${s.secretAccessKey}`, date), s.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key4).update(toSign).digest('hex');
  return `${base.protocol}//${host}${uri}?${query}&X-Amz-Signature=${signature}`;
}

function s3Store(s: S3Settings): FileStore {
  return {
    kind: 's3',
    async uploadUrl(key, contentType) {
      return { url: presignS3(s, 'PUT', key, UPLOAD_SECONDS), method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(Date.now() + UPLOAD_SECONDS * 1000).toISOString() };
    },
    async downloadUrl(key, contentType, filename) {
      return presignS3(s, 'GET', key, DOWNLOAD_SECONDS, new Date(), {
        'response-content-disposition': `inline; filename="${filename.replace(/["\\\r\n]/g, '_')}"`,
        ...(contentType ? { 'response-content-type': contentType } : {}),
      });
    },
    async head(key) {
      const r = await fetch(presignS3(s, 'HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      if (r.status === 404 || r.status === 403) return null;
      if (!r.ok) throw new Error(`S3 HEAD ${r.status}`);
      return { size: Number(r.headers.get('content-length') ?? 0) };
    },
    async remove(key) {
      const r = await fetch(presignS3(s, 'DELETE', key, 60), { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
      if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${r.status}`);
    },
  };
}

let store: FileStore | null = null;

export function fileStore(): FileStore {
  if (store) return store;
  if (config.files.driver === 's3') {
    const { bucket, region, accessKeyId, secretAccessKey } = config.files.s3;
    if (!bucket || !accessKeyId || !secretAccessKey) throw new Error('FILES_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    store = s3Store({ ...config.files.s3, bucket, region: region || 'us-east-1', accessKeyId, secretAccessKey });
  } else store = localStore;
  return store;
}

/** For tests: use a different store. */
export const setFileStore = (s: FileStore | null) => (store = s);
