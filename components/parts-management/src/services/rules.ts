/**
 * Return rules: what can come back, by part category, with a default for
 * every category without its own rule. A rule can say "not returnable"
 * (fitted electrical parts, opened oil), set a time limit in days, and keep
 * back a restocking fee.
 *
 * Breaking a rule isn't impossible, just deliberate: the owner or a manager
 * overrides it (a cashier needs their PIN, as for any refund), and the
 * return is marked as overridden.
 */
import { Prisma, ReturnRule } from '@prisma/client';
import { z } from 'zod';

import { DomainError } from '../utils/http';
import { Db } from '../utils/prisma';
import { returnRulesInput } from '../validation';
import { D } from './shared';

export const listRules = (db: Db, shopId: string) => db.returnRule.findMany({ where: { shopId }, orderBy: [{ category: { sort: 'asc', nulls: 'first' } }] });

export async function setRules(db: Prisma.TransactionClient, shopId: string, data: z.infer<typeof returnRulesInput>) {
  const keys = data.rules.map((r) => (r.category ?? '').toLowerCase());
  if (new Set(keys).size !== keys.length) throw new DomainError(422, 'One rule per category (and one default)');
  await db.returnRule.deleteMany({ where: { shopId } });
  await db.returnRule.createMany({
    data: data.rules.map((r) => ({ shopId, category: r.category ?? null, returnable: r.returnable, days: r.days ?? null, feePct: D(r.feePct), note: r.note ?? null })),
  });
  return listRules(db, shopId);
}

export type RuleCheck = { problems: string[]; feePct: Map<string, Prisma.Decimal> };

/**
 * Checks returning these lines of a sale against the rules. Returns what's
 * broken (to override) and each line's fee percent.
 */
export async function checkReturn(db: Db, shopId: string, soldAt: Date, lines: { saleItemId: string; description: string; partId: string | null }[], now = new Date()): Promise<RuleCheck> {
  const rules = await listRules(db, shopId);
  const out: RuleCheck = { problems: [], feePct: new Map() };
  if (!rules.length) return out;
  const fallback = rules.find((r) => r.category == null) ?? null;
  const byCat = new Map(rules.filter((r) => r.category).map((r) => [r.category!.toLowerCase(), r]));
  const ids = lines.map((l) => l.partId).filter((x): x is string => Boolean(x));
  const cats = new Map((await db.part.findMany({ where: { id: { in: ids } }, select: { id: true, category: true } })).map((p) => [p.id, p.category]));
  const days = Math.floor((now.getTime() - soldAt.getTime()) / 86_400_000);
  for (const l of lines) {
    const cat = l.partId ? cats.get(l.partId) : null;
    const rule: ReturnRule | null = (cat ? byCat.get(cat.toLowerCase()) : undefined) ?? fallback;
    if (!rule) continue;
    if (!rule.returnable) out.problems.push(`${l.description} can't be returned${rule.note ? ` (${rule.note})` : ''}`);
    else if (rule.days != null && days > rule.days) out.problems.push(`${l.description}: returns within ${rule.days} days only (sold ${days} days ago)`);
    if (rule.feePct.gt(0)) out.feePct.set(l.saleItemId, rule.feePct);
  }
  return out;
}
