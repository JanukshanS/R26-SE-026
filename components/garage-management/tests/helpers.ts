import { randomUUID } from 'node:crypto';

import express from 'express';
import request from 'supertest';

import { createApp } from '../src/app';

/**
 * The real app, with sign-in replaced: the caller comes from test headers.
 * x-test-provider makes them a provider (a garage owner); without it they are
 * a plain Kaduna account (x-test-user), such as a mechanic.
 */
export const app: express.Express = createApp({
  authenticate: (req, _res, next) => {
    const provider = req.header('x-test-provider') || undefined;
    req.userId = req.header('x-test-user') ?? `user-${provider}`;
    req.providerId = provider;
    next();
  },
});

function client(headers: Record<string, string>) {
  const withAuth = (t: request.Test) => {
    for (const [k, v] of Object.entries(headers)) t.set(k, v);
    return t.set('Authorization', 'Bearer test-token');
  };
  return {
    get: (url: string) => withAuth(request(app).get(url)),
    post: (url: string, body?: object) => withAuth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body?: object) => withAuth(request(app).put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => withAuth(request(app).patch(url)).send(body ?? {}),
    delete: (url: string) => withAuth(request(app).delete(url)),
  };
}

/** A caller acting for one provider. */
export const as = (providerId: string) => client({ 'x-test-provider': providerId });

/** A signed-in account with no provider link, for example a mechanic. */
export const asUser = (userId: string) => client({ 'x-test-user': userId });

/** The public, signed-out web (customer tracking links). */
export const anonymous = () => ({
  get: (url: string) => request(app).get(url),
  post: (url: string, body?: object) => request(app).post(url).send(body ?? {}),
});

/** A new provider with a garage already set up. */
export async function newGarage(overrides: Record<string, unknown> = {}) {
  const providerId = `prov-${randomUUID()}`;
  const owner = as(providerId);
  const res = await owner.put('/api/v1/garage', { name: 'Test Motors', labourRate: 2500, taxRate: 0, ...overrides });
  if (res.status !== 201) throw new Error(`garage setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { providerId, client: owner, garage: res.body.data };
}

/** A mechanic in the given garage who has already joined with their invite code. */
export async function newMechanic(owner: ReturnType<typeof as>, name = 'Kasun Silva') {
  const member = (await owner.post('/api/v1/staff', { name })).body.data;
  const userId = `user-${randomUUID()}`;
  const mechanic = asUser(userId);
  const joined = await mechanic.post('/api/v1/staff/join', { code: member.inviteCode });
  if (joined.status !== 200) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
  return { member, userId, client: mechanic };
}
