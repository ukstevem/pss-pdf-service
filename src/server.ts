/**
 * pss-pdf-service — input-agnostic HTML → PDF rendering.
 *
 * One job: accept self-contained HTML, return PDF bytes. No database, no
 * filing, no domain knowledge. Callers: pss-document-service (/api/file-html
 * filing path) and apps needing ephemeral previews.
 *
 * Design (pss-purchase-order bead 9bq.2, agreed 2026-07-05):
 *  - Pooled Chromium (one browser, fresh context per render)
 *  - External resource fetches BLOCKED — HTML must be self-contained
 *    (inline CSS, data-URI images/fonts); determinism + no SSRF
 *  - Service-owned footer furniture: left/right text from the caller,
 *    "Page X of Y" centre, consistent across every PSS document
 *  - API-key gated (X-Api-Key), payload cap, per-render timeout
 */

import express from "express";
import { chromium, type Browser } from "playwright";

const PORT = Number(process.env.PORT ?? 8017);
const API_KEY = process.env.PDF_SERVICE_API_KEY ?? "";
const MAX_HTML_BYTES = Number(process.env.MAX_HTML_BYTES ?? 2_000_000);
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 30_000);

interface RenderRequest {
  html: string;
  footer?: { left?: string; right?: string };
  page?: {
    format?: "A4" | "A3" | "Letter";
    orientation?: "portrait" | "landscape";
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
  };
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  return browser;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Service-owned footer: consistent furniture on every PSS document. */
function footerTemplate(left: string, right: string): string {
  const cell = "font-size:8px; color:rgb(6,27,55); font-family:Arial,Helvetica,sans-serif;";
  return `
    <div style="width:100%; padding:0 15mm; display:flex; justify-content:space-between; align-items:baseline;">
      <span style="${cell} text-align:left;">${escapeHtml(left)}</span>
      <span style="${cell} text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      <span style="${cell} text-align:right;">${escapeHtml(right)}</span>
    </div>`;
}

async function renderPdf(req: RenderRequest): Promise<Buffer> {
  const b = await getBrowser();
  const context = await b.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();

    // Self-contained HTML only: block every network fetch. setContent itself
    // is not a navigation fetch, so the document still loads.
    await context.route("**/*", (route) => route.abort());

    await page.setContent(req.html, {
      waitUntil: "load",
      timeout: RENDER_TIMEOUT_MS,
    });

    const today = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    }).format(new Date());

    const pdf = await page.pdf({
      format: req.page?.format ?? "A4",
      landscape: req.page?.orientation === "landscape",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footerTemplate(req.footer?.left ?? "", req.footer?.right ?? `Printed: ${today}`),
      margin: {
        top: req.page?.margin?.top ?? "12mm",
        right: req.page?.margin?.right ?? "12mm",
        bottom: req.page?.margin?.bottom ?? "18mm",
        left: req.page?.margin?.left ?? "12mm",
      },
    });
    return Buffer.from(pdf);
  } finally {
    await context.close();
  }
}

const app = express();
app.use(express.json({ limit: MAX_HTML_BYTES }));

app.get("/healthz", async (_req, res) => {
  try {
    await getBrowser();
    res.json({ ok: true, browser: "up" });
  } catch (e) {
    res.status(503).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/render", async (req, res) => {
  if (!API_KEY || req.header("x-api-key") !== API_KEY) {
    res.status(401).json({ error: "invalid or missing X-Api-Key" });
    return;
  }
  const body = req.body as RenderRequest;
  if (!body?.html || typeof body.html !== "string") {
    res.status(400).json({ error: "body.html (string) is required" });
    return;
  }
  if (Buffer.byteLength(body.html, "utf8") > MAX_HTML_BYTES) {
    res.status(413).json({ error: `html exceeds ${MAX_HTML_BYTES} bytes` });
    return;
  }

  const started = Date.now();
  try {
    const pdf = await Promise.race([
      renderPdf(body),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("render timeout")), RENDER_TIMEOUT_MS)
      ),
    ]);
    res
      .status(200)
      .type("application/pdf")
      .setHeader("X-Render-Ms", String(Date.now() - started))
      .send(pdf);
  } catch (e) {
    console.error("[pdf-service] render failed:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`pss-pdf-service listening on :${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await browser?.close().catch(() => {});
    process.exit(0);
  });
}
