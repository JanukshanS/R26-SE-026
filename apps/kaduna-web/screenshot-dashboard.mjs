import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE = "http://localhost:3000";
const OUT = "/tmp/dashboard-screenshot.png";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector('text="Kaduna.lk Geo-Intelligence"', { timeout: 10000 });
  await page.waitForTimeout(3500); // Wait for JSON fetch

  // Ensure Statistics tab is active
  await page.click('button:has-text("Statistics")');
  await page.waitForTimeout(300);

  // Scroll sidebar down to reveal "Avg Score by Incident Type" and "Hourly Impact Profile"
  const sidebar = page.locator('aside .overflow-y-auto');
  await sidebar.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(500);

  const buf = await page.screenshot({ path: OUT });
  writeFileSync(OUT, buf);
  console.log("Screenshot saved:", OUT);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
