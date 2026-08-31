# Nomos k6 Live Monitoring

Standalone Grafana + InfluxDB stack for k6 monitoring.

## Start

```powershell
cd monitoring
docker compose up -d
```

## Grafana

- URL: `http://localhost:3001`
- Username: `admin`
- Password: `admin`

## InfluxDB

- URL: `http://localhost:8087`
- k6 database: `k6`

## Run k6 with live metrics

From the repo root:

```powershell
k6 run -e PROFILE=smoke --out influxdb=http://localhost:8087/k6 main.js
```

Or use the profile scripts in the root repo and just swap the `--out` target to `http://localhost:8087/k6`.
