/**
 * Navigation reachability over the whole app.
 *
 * The revamp moved the questionnaire's routing out of 13 hardcoded
 * `router.push` calls and into lib/emergencyFlow.ts, so a grep for route
 * strings no longer sees those edges. This walks both: literal route strings
 * anywhere in app/ + components/ + features/, plus the ordered steps the flow
 * module can reach.
 *
 * Catches what a manual walkthrough can't: a screen nothing links to, or a
 * link to a screen that no longer exists.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowSteps, stepPath, type FlowState, type Q1MLIntent } from "../lib/emergencyFlow";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Every file that could contain a navigation target. */
const SOURCES = ["app", "components", "features", "lib", "hooks"]
  .map((d) => join(ROOT, d))
  .flatMap((d) => walk(d));

/** Route slugs the router actually serves, derived from the files in app/. */
function routeSlugs(): Set<string> {
  const out = new Set<string>();
  for (const f of walk(join(ROOT, "app"))) {
    if (f.endsWith("_layout.tsx")) continue;
    const rel = f.slice(join(ROOT, "app").length).replace(/\.tsx?$/, "");
    out.add(rel.endsWith("/index") ? rel.slice(0, -"/index".length) || "/" : rel);
  }
  return out;
}

/** Any string literal in the codebase that looks like an in-app route. */
function literalTargets(): Map<string, Set<string>> {
  const byFile = new Map<string, Set<string>>();
  for (const f of SOURCES) {
    const hits = new Set<string>();
    for (const m of readFileSync(f, "utf8").matchAll(/["'`](\/(?:\([a-z-]+\)|[a-z])[^"'`\s]*)["'`]/g)) {
      // Skip template placeholders like `/(emergency)/${route}` - those are the
      // flow module building a path, not a link to a literal screen.
      if (m[1].includes("${")) continue;
      hits.add(m[1].split("?")[0].replace(/\/$/, ""));
    }
    if (hits.size) byFile.set(f, hits);
  }
  return byFile;
}

const SLUGS = routeSlugs();
const LITERALS = literalTargets();
const ALL_LITERALS = new Set([...LITERALS.values()].flatMap((s) => [...s]));

/** Everything the questionnaire can navigate to, across all branches. */
function flowReachable(): Set<string> {
  const intents: Q1MLIntent[] = [
    "WONT_START", "ENGINE_PROBLEM", "WEIRD_BEHAVIOR", "BRAKE_ISSUE", "GEAR_ISSUE",
  ];
  const engine = [null, "STARTS_NORMAL", "STARTS_BUT_ISSUE", "CRANKS_NO_START", "NO_CRANK"];
  const running = [null, "OVERHEATING", "NOISE", "SMOKE", "NO_POWER", "STALLING"];
  const out = new Set<string>();
  for (const q1Intent of intents)
    for (const engineState of engine)
      for (const runningIssue of running)
        for (const step of flowSteps({ q1Intent, engineState, runningIssue } as FlowState))
          if (step.route !== "whats-wrong") out.add(stepPath(step.route as never));
  return out;
}

describe("navigation graph", () => {
  const reachable = new Set([...ALL_LITERALS, ...flowReachable()]);

  it("never links to a route that does not exist", () => {
    const broken = [...ALL_LITERALS].filter(
      (t) => t.startsWith("/(") && !SLUGS.has(t)
    );
    expect(broken, `dangling route links: ${broken.join(", ")}`).toEqual([]);
  });

  it("leaves no screen that nothing can navigate to", () => {
    // "/" is the app entry, so nothing links to it by design.
    const orphans = [...SLUGS].filter((s) => s !== "/" && !reachable.has(s));
    expect(orphans, `orphaned screens: ${orphans.join(", ")}`).toEqual([]);
  });

  it("reaches every question screen through the flow module, not hardcoded pushes", () => {
    const questions = [...SLUGS].filter(
      (s) => s.startsWith("/(emergency)/") &&
        !["/(emergency)/whats-wrong", "/(emergency)/safety-check",
          "/(emergency)/quick-dispatch", "/(emergency)/connected",
          "/(emergency)/diagnosis-result"].includes(s)
    );
    const viaFlow = flowReachable();
    for (const q of questions) {
      expect(viaFlow.has(q), `${q} is not reachable from emergencyFlow`).toBe(true);
    }

    // And no question screen should still be hardcoding a sibling push.
    for (const [file, targets] of LITERALS) {
      if (!file.includes("/(emergency)/")) continue;
      const siblings = [...targets].filter((t) => questions.includes(t));
      expect(siblings, `${file.slice(ROOT.length)} hardcodes ${siblings.join(", ")}`).toEqual([]);
    }
  });

  it("gives every emergency question screen a way out that is not the back button", () => {
    // QuestionScreen renders the skip; every question route must go through it.
    for (const f of SOURCES) {
      if (!f.includes("/(emergency)/")) continue;
      const slug = f.slice(join(ROOT, "app").length).replace(/\.tsx?$/, "");
      if (!flowReachable().has(slug)) continue;
      expect(readFileSync(f, "utf8"), `${slug} does not use QuestionScreen`)
        .toContain("QuestionScreen");
    }
  });
});
