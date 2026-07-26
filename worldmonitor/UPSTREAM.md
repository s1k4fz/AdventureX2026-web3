# Upstream provenance

This tree is a vendored snapshot of [koala73/worldmonitor](https://github.com/koala73/worldmonitor),
imported into the lemma-ai monorepo (not a git submodule).

| Field | Value |
|-------|-------|
| Upstream | https://github.com/koala73/worldmonitor.git |
| Imported commit | `5ae49cf04fbd8adb8dd32289569ea1ec51571bbf` |
| Upstream branch | `main` |
| Imported at | 2026-07-24T22:27:38+08:00 |

Local lemma wiring lives in:

- `docker-compose.override.yml` — minimal stack ports + `WORLDMONITOR_VALID_KEYS`
- `../backend/ai/worldmonitor/` — HTTP client + `LOCAL.md`
- Root `README.md` — full startup procedure

Secrets stay in `.env` (gitignored). See upstream `SELF_HOSTING.md` for general self-host docs.

## Lemma trim (2026-07-25)

Removed from the vendored tree (not required for lemma minimal Docker stack
`redis` + `redis-rest` + `worldmonitor`):

- `blog-site/` — upstream blog SPA **removed**; kept `blog-site/src/data/glossary.ts` only (Docker `build:crawlable-corpus` imports it)
- `e2e/` — Playwright end-to-end tests
- `convex/` — Convex backend **removed** except compile stubs: `convex/_generated/*`, type-only `convex/followedCountries.ts`
- `pro-test/` — pro variant test harness
- `.github/` — upstream CI/workflows
- `cli/` — standalone CLI package
- `sdk/` — client SDK
- `playwright.config.ts` — Playwright config (e2e removed)

Kept `src-tauri/sidecar/` (`local-api-server.mjs`, `package.json`) — Dockerfile
`COPY --from=builder` depends on these paths. Rest of `src-tauri/` (Tauri desktop
app) retained to avoid risky partial deletion; not used by lemma Docker build.

Reference audit (Docker + lemma seed scripts): no hits for deleted paths in
`Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`, or
`scripts/seed-{fear-greed,prediction-markets,market-quotes,commodity-quotes,economy}.mjs`.
`package.json` still lists upstream scripts referencing removed dirs; Docker uses
`npm ci --ignore-scripts` and build steps that omit blog/pro/e2e.
