/**
 * main.js — single entrypoint for the whole Nomos Super Admin load test suite.
 *
 * Run it with:
 *   k6 run main.js
 *   k6 run -e PROFILE=load main.js
 *   k6 run -e PROFILE=stress -e BASE_URL=https://api.nomos-dev.weuno.co main.js
 *   k6 run -e HARDCODED_CLIENT_ID=xxxx-xxxx main.js
 *
 * PROFILE controls the load shape (see buildScenarios below):
 *   smoke  — 1 VU,  1 iteration each   -> "does the flow still work at all"
 *   load   — steady realistic traffic  -> "normal expected load"
 *   stress — ramps well past normal    -> "where does it start to degrade"
 *   spike  — sudden burst              -> "does it survive a traffic spike"
 *   soak   — long steady duration      -> "does it leak/degrade over time"
 *
 * Every profile runs all three flows every iteration:
 *   1. auth.scenario.js             — login/refresh/logout + negative auth cases
 *   2. client-creation.scenario.js  — the full 15-step real UI flow, unique data each run
 *   3. client-management.scenario.js— reads/updates against the hardcoded fixture client
 */
import { ENV } from './config/environment.js';
import { runAuthScenario } from './scenarios/auth.scenario.js';
import { runClientCreationScenario } from './scenarios/client-creation.flow.js';
import { runClientManagementScenario } from './scenarios/client-management.scenario.js';
import { buildReportRows, toCsv, metricValue, round } from './lib/report-utils.js';

function buildScenarios(profile) {
  switch (profile) {
    case 'load':
      return {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '30s', target: ENV.VUS },
          { duration: ENV.DURATION, target: ENV.VUS },
          { duration: '30s', target: 0 },
        ],
        gracefulRampDown: '10s',
      };
    case 'stress':
      return {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '1m', target: ENV.VUS },
          { duration: '2m', target: ENV.VUS * 2 },
          { duration: '2m', target: ENV.VUS * 4 },
          { duration: '1m', target: 0 },
        ],
        gracefulRampDown: '15s',
      };
    case 'spike':
      return {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '10s', target: ENV.VUS },
          { duration: '10s', target: ENV.VUS * 10 },
          { duration: '30s', target: ENV.VUS * 10 },
          { duration: '10s', target: ENV.VUS },
          { duration: '20s', target: 0 },
        ],
        gracefulRampDown: '10s',
      };
    case 'soak':
      return {
        executor: 'constant-vus',
        vus: ENV.VUS,
        duration: ENV.DURATION, // pass -e DURATION=1h (or longer) for a real soak
      };
    case 'smoke':
    default:
      return {
        executor: 'per-vu-iterations',
        vus: 1,          // exactly 1 VU → exactly 1 iteration → exactly 1 client created
        iterations: 1,
        maxDuration: '2m',
      };
  }
}

export const options = {
  scenarios: {
    nomos_super_admin: buildScenarios(ENV.PROFILE),
  },
  thresholds: ENV.THRESHOLDS,
  discardResponseBodies: false,
};

function reportNameFromSource(sourceName) {
  return sourceName.replace(/^report-/, 'nomos-report-').replace(/\.json$/i, '');
}

function latestReportName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `report-${ENV.PROFILE}-Nomos-${stamp}.json`;
}

function buildSummaryCsvs(data, sourceName) {
  const rows = buildReportRows(data);
  const baseName = reportNameFromSource(sourceName);
  const generatedAt = new Date().toISOString();
  const metrics = data.metrics || {};

  return {
    [`reports/${sourceName}`]: JSON.stringify(data, null, 2),
    [`reports/${baseName}-overview.csv`]: toCsv([
      ['Metric', 'Value'],
      ['Report Type', 'Nomos Load Test Report'],
      ['Source JSON', sourceName],
      ['Generated At', generatedAt],
      ['Test Name', baseName.replace(/^Nomos-report-/, '')],
      ['Total Requests', metricValue(metrics.http_reqs, 'count')],
      ['Failed Request %', round(metricValue(metrics.http_req_failed, 'rate') * 100, 4)],
      ['Checks Passed %', round(metricValue(metrics.checks, 'rate') * 100, 2)],
      ['Iterations', metricValue(metrics.iterations, 'count')],
    ]),
    [`reports/${baseName}-summary.csv`]: toCsv([
      ['Label', '# Samples', 'Average', 'Min', 'Max', 'Std. Dev.', 'Error %', 'Throughput', 'Received KB/sec', 'Sent KB/sec', 'Avg. Bytes'],
      ...rows.metrics.map((row) => [
        row.label,
        row.samples,
        row.average,
        row.min,
        row.max,
        row.stddev,
        row.errorRate,
        row.throughput,
        row.receivedKbSec,
        row.sentKbSec,
        row.avgBytes,
      ]),
    ]),
    [`reports/${baseName}-aggregate.csv`]: toCsv([
      ['Label', '# Samples', 'Average', 'Median', '90% Line', '95% Line', '99% Line', 'Min', 'Max', 'Error %', 'Throughput', 'Received KB/sec', 'Sent KB/sec'],
      ...rows.metrics.map((row) => [
        row.label,
        row.samples,
        row.average,
        row.median,
        row.p90,
        row.p95,
        row.p99,
        row.min,
        row.max,
        row.errorRate,
        row.throughput,
        row.receivedKbSec,
        row.sentKbSec,
      ]),
    ]),
    [`reports/${baseName}-checks.csv`]: toCsv([
      ['Group', 'Check', 'Passes', 'Fails', 'Pass %'],
      ...rows.checks.map((row) => [row.group, row.check, row.passes, row.fails, row.passRate]),
    ]),
  };
}

/**
 * One full iteration = one "virtual super admin session" exercising
 * all three flows. Order matters: auth negative/positive checks first
 * (cheap, self-contained), then the full real client-creation flow
 * (creates a brand-new, unique client every iteration), then
 * client-management reads/updates against the fixed hardcoded client.
 */
export default function () {
  runAuthScenario();
  runClientCreationScenario(__VU, __ITER);
  runClientManagementScenario();
}

export function handleSummary(data) {
  const sourceName = latestReportName();
  return buildSummaryCsvs(data, sourceName);
}
