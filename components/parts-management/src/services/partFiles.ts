/**
 * A part's photos, documents and links.
 *
 * Uploads go straight from the browser to the file store (services/storage):
 *   1. startUpload: the shop says what it's sending; a PENDING record and a
 *      short-lived upload URL come back.
 *   2. The browser PUTs the bytes to that URL.
 *   3. completeUpload: the store is checked, the file becomes READY. The
 *      first photo becomes the part's main photo.
 * Links (a maker's datasheet, a fitting video) are just saved.
 */
import { PartFile, Shop } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { logger } from '../utils/logger';
import { Db } from '../utils/prisma';
import { filePatch, linkInput, uploadInput } from '../validation';
import { fileStore } from './storage';
import { Actor, audit } from './staff';

const MB = 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DOC_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
];
export const LIMITS = { image: 10 * MB, document: 25 * MB };

async function partOf(db: Db, shopId: string, partId: string) {
  const p = await db.part.findFirst({ where: { id: partId, shopId }, select: { id: true, name: true } });
  if (!p) throw notFound('Part');
  return p;
}

async function fileOf(db: Db, shopId: string, partId: string, fileId: string) {
  await partOf(db, shopId, partId);
  const f = await db.partFile.findFirst({ where: { id: fileId, partId } });
  if (!f) throw notFound('File');
  return f;
}

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(-100) || 'file';

export async function addLink(db: Db, shop: Shop, actor: Actor, partId: string, data: z.infer<typeof linkInput>) {
  const part = await partOf(db, shop.id, partId);
  const hasPhoto = data.kind === 'IMAGE' && (await db.partFile.count({ where: { partId, kind: 'IMAGE', primary: true } })) > 0;
  const f = await db.partFile.create({ data: { partId, kind: data.kind, name: data.name, url: data.url, primary: data.kind === 'IMAGE' && !hasPhoto, byName: actor.name } });
  await audit(db, shop.id, actor, 'catalogue.file', `Added a link to ${part.name}: ${data.name}`, { entity: 'part', entityId: partId });
  return f;
}

export async function startUpload(db: Db, shop: Shop, actor: Actor, partId: string, data: z.infer<typeof uploadInput>) {
  await partOf(db, shop.id, partId);
  const ct = data.contentType.toLowerCase();
  const image = IMAGE_TYPES.includes(ct);
  if (!image && !DOC_TYPES.includes(ct)) throw new DomainError(422, 'Upload a photo (JPEG, PNG, WebP, GIF) or a document (PDF, Word, Excel, text, zip)');
  const max = image ? LIMITS.image : LIMITS.document;
  if (data.size > max) throw new DomainError(422, `That file is too big: up to ${max / MB} MB for ${image ? 'photos' : 'documents'}`);
  const f = await db.partFile.create({ data: { partId, kind: image ? 'IMAGE' : 'DOCUMENT', status: 'PENDING', name: data.name, contentType: ct, size: data.size, byName: actor.name } });
  const key = `parts/${shop.id}/${partId}/${f.id}/${safeName(data.name)}`;
  await db.partFile.update({ where: { id: f.id }, data: { storageKey: key } });
  return { file: { ...f, storageKey: key }, upload: await fileStore().uploadUrl(key, ct, data.size) };
}

export async function completeUpload(db: Db, shop: Shop, actor: Actor, partId: string, fileId: string) {
  const f = await fileOf(db, shop.id, partId, fileId);
  if (f.status === 'READY') return f;
  const stored = f.storageKey ? await fileStore().head(f.storageKey) : null;
  if (!stored) throw conflict("The file didn't arrive: try uploading it again");
  const firstPhoto = f.kind === 'IMAGE' && (await db.partFile.count({ where: { partId, kind: 'IMAGE', status: 'READY', primary: true } })) === 0;
  const done = await db.partFile.update({ where: { id: fileId }, data: { status: 'READY', size: stored.size, primary: firstPhoto } });
  const part = await partOf(db, shop.id, partId);
  await audit(db, shop.id, actor, 'catalogue.file', `Uploaded ${f.kind === 'IMAGE' ? 'a photo' : 'a document'} to ${part.name}: ${f.name}`, { entity: 'part', entityId: partId });
  return done;
}

export async function updateFile(db: Db, shop: Shop, partId: string, fileId: string, data: z.infer<typeof filePatch>) {
  const f = await fileOf(db, shop.id, partId, fileId);
  if (data.primary && f.kind !== 'IMAGE') throw new DomainError(422, 'Only a photo can be the main picture');
  if (data.primary) await db.partFile.updateMany({ where: { partId, primary: true }, data: { primary: false } });
  return db.partFile.update({ where: { id: fileId }, data: { ...(data.name ? { name: data.name } : {}), ...(data.primary ? { primary: true } : {}) } });
}

export async function removeFile(db: Db, shop: Shop, actor: Actor, partId: string, fileId: string) {
  const f = await fileOf(db, shop.id, partId, fileId);
  await db.partFile.delete({ where: { id: fileId } });
  if (f.primary) {
    const next = await db.partFile.findFirst({ where: { partId, kind: 'IMAGE', status: 'READY' }, orderBy: { createdAt: 'asc' } });
    if (next) await db.partFile.update({ where: { id: next.id }, data: { primary: true } });
  }
  if (f.storageKey) {
    try {
      await fileStore().remove(f.storageKey);
    } catch (err) {
      logger.warn(`Could not delete ${f.storageKey} from the file store: ${(err as Error).message}`);
    }
  }
  const part = await partOf(db, shop.id, partId);
  await audit(db, shop.id, actor, 'catalogue.file', `Removed ${f.name} from ${part.name}`, { entity: 'part', entityId: partId });
}

/** A file as the app shows it: links as given, stored files through a short-lived URL. */
export async function presentFile(f: PartFile) {
  return {
    id: f.id,
    kind: f.kind,
    status: f.status,
    name: f.name,
    url: f.kind === 'LINK' || f.url ? f.url : f.storageKey && f.status === 'READY' ? await fileStore().downloadUrl(f.storageKey, f.contentType, f.name) : null,
    contentType: f.contentType,
    size: f.size,
    primary: f.primary,
    byName: f.byName,
    createdAt: f.createdAt,
  };
}
