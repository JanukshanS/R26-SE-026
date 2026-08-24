import assert from "node:assert/strict";
import { test } from "node:test";

import { areasFor, roleHome, type Profile, type Role } from "./areas.ts";

function profile(role: Role, provider_id: string | null = null): Profile {
  return { id: "u1", name: null, role, provider_id };
}

const hrefs = (p: Profile | null) => areasFor(p).map((a) => a.href);

test("a driver sees only the driver areas", () => {
  assert.deepEqual(hrefs(profile("driver")), ["/app", "/report"]);
  assert.equal(roleHome(profile("driver")), "/app");
});

test("ops sees everything and lands on the dashboard", () => {
  assert.deepEqual(hrefs(profile("ops")), [
    "/app",
    "/report",
    "/provider",
    "/dashboard",
    "/admin",
  ]);
  assert.equal(roleHome(profile("ops")), "/dashboard");
});

test("a linked provider_id grants the provider area even while the role is driver", () => {
  // How mobile onboarding actually leaves an account: provider_id is
  // client-writable, role is not, so it stays "driver" until admin_set_role.
  const linked = profile("driver", "prov-1");
  assert.deepEqual(hrefs(linked), ["/app", "/report", "/provider"]);
  assert.equal(roleHome(linked), "/provider");
});

test("an ops account keeps the dashboard even when linked to a provider", () => {
  assert.equal(roleHome(profile("ops", "prov-1")), "/dashboard");
});

test("no profile yet is treated as a plain driver, never as an operator", () => {
  assert.deepEqual(hrefs(null), ["/app", "/report"]);
  assert.equal(roleHome(null), "/app");
  assert.equal(roleHome(undefined), "/app");
});
