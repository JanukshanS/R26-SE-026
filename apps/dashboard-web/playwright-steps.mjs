import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE = "http://localhost:3000";
const SCREENSHOTS = "/tmp/step1-whatif.png";
const SCREENSHOTS2 = "/tmp/step2-motorway-accident.png";
const SCREENSHOTS3 = "/tmp/step3-incident-panel.png";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // Navigate and wait for data to load
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector('text="Kaduna.lk Geo-Intelligence"', { timeout: 10000 });
  await page.waitForTimeout(3000); // Wait for JSON fetch

  // Step 1: Click WHAT-IF tab
  await page.click('button:has-text("What-If")');
  await page.waitForTimeout(500);
  const buf1 = await page.screenshot({ path: SCREENSHOTS });
  writeFileSync(SCREENSHOTS, buf1);
  console.log("Step 1 screenshot saved:", SCREENSHOTS);

  // Step 2: Change road type to motorway, incident type to accident major (sidebar selects)
  await page.selectOption('aside select >> nth=0', "motorway"); // Road Type
  await page.selectOption('aside select >> nth=1', "accident_major"); // Incident
  await page.waitForTimeout(500);
  const buf2 = await page.screenshot({ path: SCREENSHOTS2 });
  writeFileSync(SCREENSHOTS2, buf2);
  console.log("Step 2 screenshot saved:", SCREENSHOTS2);

  // Step 3: Click on an incident marker (Leaflet circleMarker renders as SVG path)
  const overlayPane = page.locator('.leaflet-overlay-pane');
  const paths = overlayPane.locator('svg path');
  const count = await paths.count();
  if (count > 0) {
    const idx = Math.min(10, count - 1);
    await paths.nth(idx).click({ force: true });
    await page.waitForTimeout(1000); // Wait for incident panel to appear
  }
  const buf3 = await page.screenshot({ path: SCREENSHOTS3 });
  writeFileSync(SCREENSHOTS3, buf3);
  console.log("Step 3 screenshot saved:", SCREENSHOTS3);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
