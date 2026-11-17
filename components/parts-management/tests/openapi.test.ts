/**
 * The published contract must match the code, and must list every route the
 * app actually serves.
 */
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CONTRACT_PATH, render } from '../scripts/export-openapi';
import { buildOpenApi } from '../src/openapi';
import { app } from './helpers';

type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle: { stack?: Layer[] }; regexp?: RegExp };

/** Every METHOD /path the express app serves, read from its router stack. */
function servedRoutes(): string[] {
  const out: string[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${(prefix + layer.route.path).replace(/\/$/, '') || '/'}`);
      } else if (layer.handle.stack) {
        // Mount paths aren't kept as strings in express 4; recover them from the regexp source.
        const src = layer.regexp?.source ?? '';
        const match = src.match(/^\^\\\/([^?\\]+(?:\\\/[^?\\]+)*)/);
        const mount = match ? '/' + match[1].replace(/\\\//g, '/') : '';
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, '');
  return out.map((r) => r.replace(/:(\w+)/g, '{$1}')).sort();
}

describe('openapi contract', () => {
  it('documents exactly the routes the app serves', () => {
    const spec = buildOpenApi();
    const documented = Object.entries(spec.paths)
      .flatMap(([p, ops]) => Object.keys(ops as object).map((m) => `${m.toUpperCase()} ${p}`))
      .sort();
    expect(documented).toEqual(servedRoutes());
  });

  it('is up to date in contracts/ (run `npm run openapi` if this fails)', () => {
    expect(existsSync(CONTRACT_PATH)).toBe(true);
    expect(readFileSync(CONTRACT_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(render());
  });
});
