# Nomos Super Admin — k6 Load Testing Suite

This version hardens the load-test implementation around the failures found in the supplied 27-Aug-2026 run. It does **not** pretend to fix server-side defects that cannot be changed from a k6 client.

Load tests the Nomos Super Admin portal API (`api.nomos-dev.weuno.co`),
reproducing the **exact real onboarding flow** captured from the browser
(HAR) plus a full positive/negative/edge-case matrix derived from the
Swagger spec.

## Requirements
## Fixes included in this version

- Exact k6 expected-status handling: status lists are no longer converted into broad numeric ranges.
- Custom request headers are merged with generated headers, so adding `x-base-origin` no longer drops the Authorization header.
- Portal image uploads validate that all seven explicit theme fields return distinct storage keys.
- Added the missing `invalid-type.txt` test asset and a real 7.8 MB valid JPEG for oversized-file testing.
- Unauthenticated, invalid-type, and oversized upload tests now require the intended negative statuses instead of accepting `201`.
- Category module IDs are resolved from `GET /api/category/get-category-modules` by module name; static fallback is disabled by default.
- Category creation resolves the exact requested category name instead of blindly reusing the first category returned.
- Category responses are checked for the correct module name and module ID.
- Concurrent category creation can recover from `409` by re-fetching the exact category.
- Challenge creation sends `rewards: []`, `resources: []`, and `judges: []` when no entries are supplied, matching the successful API shape observed in the supplied response.
- Forum topic creation never uses a category ID as a forum ID. It first resolves an actual forum whose `categoryId` matches the selected Forum category.
- The stale `/api/badge` route is replaced by the verified `/api/admin/user-badges/display` route.
- The customer `limit=-10` regression is asserted as a required `400`, so a server `500` remains visible instead of being hidden by a permissive assertion.

## Important server-side findings

The supplied run still demonstrates server-side defects that this client-side test project cannot directly patch: unauthenticated/invalid/oversized uploads returned `201`, `limit=-10` returned `500`, and the hardcoded client's theme-settings update returned `404`. The fixed suite deliberately keeps these as failing checks until the API is corrected. The source run also recorded a successful challenge creation response with `201` and empty `rewards`, `resources`, and `judges` arrays.


- [k6](https://k6.io/docs/get-started/installation/) v0.5+ installed locally
  (`brew install k6`, or download a binary from the
  [releases page](https://github.com/grafana/k6/releases))
- Network access to `https://api.nomos-dev.weuno.co`

No npm install needed — the suite has **zero external CDN/package
dependencies** so it runs fully offline aside from hitting the target API
(deliberately avoided `jslib.k6.io` imports, which corporate proxies often
block).

## Project layout

```
loadtest/
├── main.js                          # entrypoint: wires scenarios + load profile + thresholds
├── config/
│   └── environment.js               # SINGLE SOURCE OF TRUTH: URLs, creds, hardcoded client ID, assets
├── lib/
│   ├── http-client.js               # thin wrapper over k6/http with consistent headers + tags
│   ├── data-generator.js            # unique payload builders (valid + every negative/edge shape)
│   └── assertions.js                # reusable check() helpers, incl. the "never a 5xx" contract
├── scenarios/
│   ├── auth.scenario.js             # login / refresh / logout — positive + negative + edge
│   ├── client-creation.scenario.js  # the exact 15-step HAR flow, unique client every run
│   └── client-management.scenario.js# reads/updates against the fixed HARDCODED_CLIENT_ID
├── assets/                          # real + intentionally-bad files used for multipart upload tests
└── scripts/                         # one-liner wrappers for each load profile
```

## Why a "hardcoded client ID"?

Every run creates a **brand-new client** (unique portal name, subdomain,
email, username) to genuinely exercise the create-customer flow, exactly
like a real admin onboarding a new customer. But that new client:

- triggers a real verification email, and
- is captcha-gated on its very first login,

...so a script can never log into it. Any scenario that needs to act
**on an existing client** (fetch by id, view/update theme settings, list
all tenants, etc.) instead targets `ENV.HARDCODED_CLIENT_ID` — one fixed,
already-verified fixture client you configure once.

**Before your first real run**, open `config/environment.js` and set
`HARDCODED_CLIENT_ID` to a real, already-verified client ID from the dev
environment (a placeholder UUID ships by default and will 404).

## Quick start

```bash
cd loadtest

# 1. Sanity check — 2 VUs, 1 iteration each, fails fast on anything broken
npm run smoke
# or: k6 run -e PROFILE=smoke main.js

# 2. Steady realistic load
npm run load
# or: k6 run -e PROFILE=load -e VUS=10 -e DURATION=2m main.js

# 3. Stress — ramps to 4x VUS to find the breaking point
npm run stress

# 4. Spike — sudden 10x burst then back down
npm run spike

# 5. Soak — long steady duration to catch leaks/degradation
DURATION=1h npm run soak
```

Every profile runs **all three scenarios every iteration**: auth checks,
the full client-creation flow, then client-management checks.

## Overriding config at run time

Nothing needs to be edited to point at a different environment — every
value in `config/environment.js` can be overridden with `-e`:

```bash
k6 run \
  -e BASE_URL=https://api.nomos-staging.weuno.co \
  -e SUPER_ADMIN_EMAIL=someone@nomos-tech.com \
  -e SUPER_ADMIN_PASSWORD='...' \
  -e HARDCODED_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  -e VUS=20 -e DURATION=5m \
  main.js
```

## What's covered

### Auth (`auth.scenario.js`)
Login, refresh-token, logout. Positive session lifecycle plus: wrong
password, unknown email, missing/empty body, malformed JSON, SQL-injection
probe, oversized email, unauthenticated/tampered-token access to a
protected route, garbage refresh token.

### Client creation (`client-creation.scenario.js`)
The **exact 15-step sequence** reconstructed from the HAR capture:

1. `POST /api/super-admin/auth/login`
2. `GET /api/super-admin/users/profile`
3. `GET /api/super-admin/portals/get-counts-for-dashboard`
4. `GET /api/super-admin/users/profile` (UI re-fetches)
5. `GET /api/super-admin/customers?page=1&limit=10&isActive=true`
6. `GET /api/super-admin/domains/custom-domain/available`
7–13. `POST /api/files-upload/client-portal` ×7 (profile, bg, email logo,
   favicon, login logo, sidebar logo, welcome image)
14. `POST /api/super-admin/customers` — **unique** name/subdomain/email/username every run
15. `GET /api/super-admin/customers?...` — verify the new client appears

Interleaved negative/edge cases: unauthenticated create, empty payload,
invalid types/enums, oversized field values, SQL-injection/XSS strings in
free-text fields, duplicate portal name (second create of the same
payload), invalid file type upload, oversized file upload, unauthenticated
upload, and pagination edge cases (page=0, negative page/limit, huge
limit, non-numeric, SQL-injection in `search`, invalid boolean).

### Client management (`client-management.scenario.js`)
Everything that acts on an **existing** client, always via
`HARDCODED_CLIENT_ID`: fetch by id, list all tenants, fetch/update theme
settings. Negative/edge: non-existent id (404), malformed id, unauthenticated,
tampered token, invalid color value on theme update, change-status /
verify-customer probed against a non-existent id (route-existence + "never
5xx" checks only — see the comment in that file for why the mutating
positive calls against the real fixture client are opt-in via
`-e RUN_MUTATING_STATUS_CHECKS=true`).

## Safety contract

Every negative/edge check asserts **the API never returns a 5xx**, even
under intentionally malformed, adversarial, or oversized input. That's the
one non-negotiable pass/fail bar across the whole suite — everything else
(exact status code, exact validation message) is a secondary check.

## Metrics & thresholds

Every request is tagged (`endpoint`, `scenario`, `case`) so you can slice
results in the summary or in Grafana/InfluxDB by endpoint or by
positive/negative case. Thresholds live in `config/environment.js`:

- `http_req_failed` rate < 5%
- `http_req_duration` p95 < 2000ms overall, with tighter per-endpoint
  budgets for `login`, `create_customer`, and `file_upload`
- `checks` pass rate > 95%

Add `--summary-export=summary.json` (already wired into the `scripts/`
wrappers) to get a machine-readable report for CI/dashboards.

## Notes / things to double-check before a big run

- **`HARDCODED_CLIENT_ID`** must be a real, verified client in whichever
  environment you point at, or every client-management check will 404.
- **File uploads** use the placeholder assets in `assets/`. Swap in
  representative real images if the "positive" upload assertions need to
  reflect realistic file sizes.
- **Rate limits**: the dev API returned `x-ratelimit-limit: 2000` per
  window in the captured HAR. High VU counts on `stress`/`spike` profiles
  may hit that — if you see a wall of 429s, that's the app's rate limiter
  working as intended, not a bug in the script.
