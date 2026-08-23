import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://localhost:8081/home", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);

await page.getByText("Pair OBD-II", { exact: true }).click();
await page.waitForTimeout(1000);
await page.getByText("Record a Trip", { exact: true }).click();
await page.waitForTimeout(1000);
console.log("At:", page.url());

// let the (dev-mode, 30s) OBD interval fire at least once
await page.waitForTimeout(5000);
await page.screenshot({ path: "_verify_ble_active_trip.png" });

// End the trip (Playwright auto-dismisses window.alert via dialog handler)
page.on("dialog", async (dialog) => {
  const buttons = dialog.type();
  await dialog.accept(); // React Native Web Alert isn't a real dialog; no-op safeguard
});
await page.getByText("End Trip", { exact: true }).click();
await page.waitForTimeout(1000);
// RN-web Alert renders as an actual overlay with buttons, not a native dialog
const endSave = page.getByText("End & Save", { exact: true });
if (await endSave.count()) {
  await endSave.click();
}
await page.waitForTimeout(2500);
console.log("Final URL:", page.url());
await page.screenshot({ path: "_verify_ble_after_end.png" });

console.log("ERRORS:", JSON.stringify(errors, null, 2));
await browser.close();
