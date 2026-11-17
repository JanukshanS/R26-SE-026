/**
 * The real sign-in middleware, without Supabase: it must fail closed.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { config } from '../src/config';

describe('authenticate', () => {
  it('refuses to serve when Supabase is not configured', async () => {
    // Not relying on the environment: a developer's .env may well configure Supabase.
    const saved = { supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey };
    Object.assign(config, { supabaseUrl: '', supabaseAnonKey: '' });
    try {
      const res = await request(createApp()).get('/api/v1/garage');
      expect(res.status).toBe(503);
    } finally {
      Object.assign(config, saved);
    }
  });

  it('asks for a bearer token', async () => {
    Object.assign(config, { supabaseUrl: 'http://127.0.0.1:9', supabaseAnonKey: 'anon' });
    try {
      const res = await request(createApp()).get('/api/v1/garage');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      const bad = await request(createApp()).get('/api/v1/garage').set('Authorization', 'Bearer not-a-jwt');
      expect(bad.status).toBe(401);
    } finally {
      Object.assign(config, { supabaseUrl: '', supabaseAnonKey: '' });
    }
  });

  it('keeps /health public', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('connected');
  });
});
