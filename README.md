# pss-pdf-service

Input-agnostic **HTML → PDF** rendering for the PSS platform. One job: accept
self-contained HTML, return PDF bytes. No database, no filing, no domain
knowledge.

Born from the purchase-order migration (pss-purchase-order bead `9bq.2`):
`pss-document-service` gains a thin `/api/file-html` route that calls this
service then files the result through its existing pipeline. Apps call this
service directly only for ephemeral previews. Other PDF producers migrate
here gradually (or never).

## API

`POST /render` — header `X-Api-Key: <key>`, JSON body:

```jsonc
{
  "html": "<style>…</style><h1>…</h1>",   // REQUIRED, self-contained
  "footer": { "left": "PO 007062 • Rev 1", "right": "" },  // optional; right defaults to "Printed: <date>"
  "page": { "format": "A4", "orientation": "portrait", "margin": {} }  // optional
}
```

Returns `200 application/pdf` (header `X-Render-Ms`), or `400/401/413/500` JSON errors.

`GET /healthz` — `{ ok: true }` when the pooled browser is up.

## Rules callers must know

- **HTML must be self-contained** — every external fetch is blocked during
  render. Inline your CSS; embed images/fonts as `data:` URIs. Montserrat is
  installed in the image and usable via `font-family`.
- **JavaScript is disabled** in the render context.
- The **centre footer (Page X of Y) is service-owned** and appears on every
  document; callers control only the left/right footer text.
- Payload cap 2 MB, render timeout 30 s (env-tunable).

## Run locally

```bash
docker compose -f docker-compose.local.yml up --build -d
curl -s -X POST localhost:8017/render -H "X-Api-Key: localdev" \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Hello</h1>","footer":{"left":"TEST"}}' -o out.pdf
```

## Deployment

Internal-only service — **no gateway route**. Target host: the Orin
(10.0.0.74) alongside pss-document-service, port **8017** (see
platform-portal `docs/PORTS.md` external services table). ARM64 image via
the multi-arch Playwright base.

## Issue tracking

Uses beads (`bd ready`).
