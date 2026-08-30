#!/usr/bin/env node
/**
 * Cross-checks translation keys against the catalogues, for both apps.
 *
 * Twelve agents wrote these catalogues independently, so the failure this
 * guards against is a typo'd key: t("driver.home.greetng") renders the key
 * itself on screen and nothing else notices. It also finds the reverse —
 * entries nobody calls — and any key English has that Sinhala or Tamil lacks.
 *
 *   node scripts/check-i18n.mjs           report
 *   node scripts/check-i18n.mjs --strict  also fail on orphans / missing translations
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const STRICT = process.argv.includes("--strict");

const APPS = [
  { name: "mobile", src: ["apps/mobile/app", "apps/mobile/components", "apps/mobile/features", "apps/mobile/lib", "apps/mobile/hooks"], locales: "apps/mobile/locales" },
  { name: "web", src: ["apps/kaduna-web/src"], locales: "apps/kaduna-web/src/locales" },
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && name !== "locales") walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/^i18n\.tsx?$/.test(name)) {
      // The runtime itself documents the API with example keys in comments.
      out.push(full);
    }
  }
  return out;
}

/** Every `t("...")` literal. Dynamic keys (t(step.titleKey)) are invisible here
 *  by design — they are checked from the data side instead, below. */
const CALL = /\bt\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
/** Keys parked in data for a later t(): `labelKey: "emergency.steps.engine"`. */
const DATA_KEY = /\b\w*[Kk]ey\s*:\s*["']([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)["']/g;

function catalogueOf(dir, locale) {
  const out = new Map();
  let files;
  try { files = readdirSync(join(dir, locale)); } catch { return out; }
  for (const f of files) {
    if (f === "index.ts" || !f.endsWith(".ts")) continue;
    const src = readFileSync(join(dir, locale, f), "utf8");
    for (const m of src.matchAll(/["']([A-Za-z0-9_.]+)["']\s*:\s*(["'`])/g)) out.set(m[1], f);
  }
  return out;
}

let failed = false;
for (const app of APPS) {
  const used = new Map();
  for (const d of app.src) {
    for (const file of walk(join(ROOT, d))) {
      const src = readFileSync(file, "utf8");
      for (const rx of [CALL, DATA_KEY]) {
        for (const m of src.matchAll(rx)) {
          if (!used.has(m[1])) used.set(m[1], relative(ROOT, file));
        }
      }
    }
  }
  const en = catalogueOf(join(ROOT, app.locales), "en");
  // A key called with { count } resolves to key_one / key_other and never
  // exists under its bare name, so satisfying either form counts.
  const satisfied = (k) => en.has(k) || (en.has(`${k}_one`) && en.has(`${k}_other`));
  const missing = [...used].filter(([k]) => !satisfied(k));
  const orphans = [...en.keys()].filter((k) => !used.has(k) && !/_(one|other)$/.test(k));

  const pluralBase = new Set([...en.keys()].filter((k) => /_(one|other)$/.test(k)).map((k) => k.replace(/_(one|other)$/, "")));
  const halfPlurals = [...pluralBase].filter((b) => !(en.has(`${b}_one`) && en.has(`${b}_other`)));

  console.log(`\n── ${app.name} ─────────────────────────────`);
  console.log(`  keys used in code : ${used.size}`);
  console.log(`  keys in en        : ${en.size}`);

  if (missing.length) {
    failed = true;
    console.log(`  ✗ ${missing.length} key(s) used but NOT in the en catalogue:`);
    for (const [k, f] of missing.slice(0, 25)) console.log(`      ${k}   (${f})`);
    if (missing.length > 25) console.log(`      …and ${missing.length - 25} more`);
  } else console.log("  ✓ every key used in code exists in en");

  if (halfPlurals.length) {
    failed = true;
    console.log(`  ✗ ${halfPlurals.length} plural(s) missing a _one or _other half: ${halfPlurals.join(", ")}`);
  }

  for (const loc of ["si", "ta"]) {
    const cat = catalogueOf(join(ROOT, app.locales), loc);
    const gaps = [...en.keys()].filter((k) => !cat.has(k));
    const extra = [...cat.keys()].filter((k) => !en.has(k));
    const mark = gaps.length ? (STRICT ? "✗" : "!") : "✓";
    console.log(`  ${mark} ${loc}: ${cat.size}/${en.size} translated${gaps.length ? `, ${gaps.length} falling back to English` : ""}${extra.length ? `, ${extra.length} key(s) not in en` : ""}`);
    if (gaps.length && STRICT) failed = true;
    if (gaps.length && gaps.length <= 15) for (const k of gaps) console.log(`      ${k}`);
  }

  if (orphans.length) {
    console.log(`  ! ${orphans.length} orphan(s) in en with no caller${STRICT ? " (strict: failing)" : ""}`);
    for (const k of orphans.slice(0, 15)) console.log(`      ${k}`);
    if (STRICT) failed = true;
  }
}

console.log("");
process.exit(failed ? 1 : 0);
