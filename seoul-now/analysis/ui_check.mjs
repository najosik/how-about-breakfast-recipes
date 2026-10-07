// 1회 진단: 실제 사이트에서 번역 버튼을 눌러 콘솔·보안정책(CSP) 위반·요청 실패·위젯 상태를 기록한다(읽기 전용).
import { chromium } from "playwright";
const url = process.argv[2] || "https://how-about-breakfast.com/seoul-now/?lang=ko";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const log = (...a) => console.log(...a);
p.on("console", (m) => log(`[console.${m.type()}]`, m.text().slice(0, 1200)));
p.on("pageerror", (e) => log("[pageerror]", e.message.slice(0, 300)));
p.on("requestfailed", (r) => log("[requestfailed]", r.url().slice(0, 160), r.failure()?.errorText));
p.on("response", (r) => { const u = r.url(); if (!u.startsWith(new URL(url).origin) && !u.includes("culture.seoul.go.kr")) log("[response]", r.status(), u.slice(0, 160)); });
await p.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) =>
  console.log(`CSP-VIOLATION directive=${e.violatedDirective} blocked=${String(e.blockedURI).slice(0, 120)}`)));
await p.goto(url, { waitUntil: "networkidle" });
log("[step] page loaded; gt-btn visible:", await p.locator("#gt-btn").isVisible());
await p.click("#gt-btn");
await p.waitForTimeout(10000);
log("[state] gt-btn hidden:", await p.locator("#gt-btn").isHidden());
log("[state] box html:", (await p.locator("#google_translate_element").evaluate((e) => e.outerHTML)).slice(0, 1500));
log("[state] select visible:", await p.locator("select.goog-te-combo").isVisible().catch(() => false),
  "options:", await p.locator("select.goog-te-combo option").count().catch(() => 0));
log("[state] select computed:", await p.locator("select.goog-te-combo").evaluate((e) => { const c = getComputedStyle(e); return `${c.display} ${c.visibility} ${e.offsetWidth}x${e.offsetHeight}`; }).catch(() => "none"));
if (await p.locator("select.goog-te-combo option").count().catch(() => 0) > 1) {
  await p.selectOption("select.goog-te-combo", "ja");
  await p.waitForTimeout(6000);
  log("[translate] html class:", await p.evaluate(() => document.documentElement.className));
  log("[translate] sample:", (await p.locator("#count").innerText().catch(() => "")).slice(0, 80), "|", (await p.locator(".card .title").first().innerText().catch(() => "")).slice(0, 80));
}
await p.screenshot({ path: "ui-check.png" });
await b.close();
