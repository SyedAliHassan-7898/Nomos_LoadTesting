# Nomos Super Admin - k6 Load Testing Suite

This repository contains the load-test suite for the Nomos Super Admin portal API. It focuses on reproducible API flows, cleanly split scenarios, and file-based report generation.

## What this repo does

- Tests the Nomos Super Admin API at `api.nomos-dev.weuno.co`
- Replays the real onboarding flow captured from the browser
- Covers auth, client creation, client management, and related sub-flows
- Generates local summary reports in `reports/`
- Keeps live monitoring in a separate `monitoring/` folder

## Current Structure

```text
loadtest-nomos/
├── main.js
├── config/
│   └── environment.js
├── lib/
├── scenarios/
│   ├── auth.scenario.js
│   ├── client-management.scenario.js
│   ├── client-creation.scenario.js
│   ├── client-creation.flow.js
│   ├── category.scenario.js
│   ├── challenge.scenario.js
│   ├── course.scenario.js
│   ├── event.scenario.js
│   ├── forum.scenario.js
│   ├── news-feed.scenario.js
│   ├── reward.scenario.js
│   └── tenant-admin.scenario.js
├── assets/
├── scripts/
├── monitoring/
├── reports/
├── .env
└── .env.example
```

## Environment

- Keep local secrets in `.env`
- Use `.env.example` as the committed template
- `config/environment.js` reads values from `.env` first, then from `-e` overrides
- Required values:
  - `BASE_URL`
  - `PORTAL_ORIGIN`
  - `SUPER_ADMIN_EMAIL`
  - `SUPER_ADMIN_PASSWORD`
  - `HARDCODED_CLIENT_ID`
  - `CLIENT_PORTAL_ORIGIN`
  - `CLIENT_ADMIN_EMAIL`
  - `CLIENT_ADMIN_PASSWORD`
  - `CLIENT_ADMIN_DEVICE_ID`

## How It Runs

The root scripts run the suite with local summary output only:

```bash
npm run smoke
npm run load
npm run stress
npm run spike
npm run soak
```

Each profile runs the same scenario bundle:

- auth checks
- client creation flow
- client management checks

## What Each Scenario Covers

### Auth

- login
- refresh token
- logout
- negative auth cases

### Client Creation

- login
- profile checks
- dashboard counts
- customer listing
- domain availability
- portal asset uploads
- client creation
- client login to the new portal
- post-create verification

### Split Flows

The client-creation workflow is split into reusable sub-files for cleaner maintenance:

- category
- reward
- challenge
- forum
- event
- course
- tenant admin feed/news flow

These are still behaviorally the same flow, just split for clarity and easier updates.

### Client Management

- fetch hardcoded client
- list tenants
- update theme settings
- negative/edge checks

## Monitoring

Live monitoring is not part of the root suite anymore. It lives separately under `monitoring/`.

Use that folder if you want Grafana + InfluxDB for live dashboards:

```powershell
cd monitoring
docker compose up -d
```

Then run k6 from the repo root with the monitoring output pointed to the monitoring stack:

```powershell
k6 run -e PROFILE=smoke --out influxdb=http://localhost:8087/k6 main.js
```

Grafana:
- `http://localhost:3001`
- `admin` / `admin`

## Reports

Every run writes JSON/CSV summaries into `reports/`.

- `summary-*.json` from `k6 --summary-export`
- `report-*.json` from `handleSummary()`
- CSV report files for overview, metrics, and checks

## Notes

- `HARDCODED_CLIENT_ID` must point to a real verified client for existing-client flows
- File uploads use assets in `assets/`
- Thresholds live in `config/environment.js`
- The suite does not require npm dependencies beyond the repo itself

