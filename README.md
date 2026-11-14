# Lunar Landing Site Navigator

NASA Space Apps 2026. Rank lunar landing sites and dates by sunlight, Earth
visibility and terrain, and see why on a 3D Moon with terrain-true shadows.

Work in progress. See `docs/CONTRACTS.md` for the architecture and data formats.

## Deploy

One Cloudflare Worker (`worker/`, config in `wrangler.toml`) serves the built web app
(`web/dist/`) as static assets and handles `POST /api/parse` (natural-language query
parsing via OpenRouter) and `GET /api/health`.

**Data** (`web/public/data/`, ~1 GB) is not in git. It is published as assets of the GitHub
release tagged `data-latest`:

```sh
scripts/package-data.sh            # tar + split into dist-data/ (dry run)
scripts/package-data.sh --upload   # same, then gh release create/upload data-latest
scripts/fetch-data.sh              # download, reassemble, extract into web/public/data/
```

**Build:** `scripts/build.sh` (wasm-pack build of `engine/`, then `npm ci && npm run build`
in `web/`; `SKIP_WASM=1` skips the wasm step).

**CI:** `.github/workflows/deploy.yml` runs on push to `main` (and manually): fetch data,
build, deploy with `cloudflare/wrangler-action`. Required repo secrets: `CLOUDFLARE_API_TOKEN`
(Workers edit permission), `CLOUDFLARE_ACCOUNT_ID`, `OPENROUTER_API_KEY`. Without
`CLOUDFLARE_API_TOKEN` the deploy step is skipped with a notice. `pr-build.yml` builds
without data on pull requests.

**Local Worker test:** from `worker/`, `npm install`, then `npm run dev` (needs `web/dist/`).
Offline: `npx wrangler dev --config ../wrangler.toml --var PARSE_MOCK:1`. Real model: put
`OPENROUTER_API_KEY=...` in `.dev.vars` at the repo root (git-ignored) and run `npm run dev`.
