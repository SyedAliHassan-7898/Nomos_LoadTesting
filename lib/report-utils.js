function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function metricValue(metric, key, fallback = 0) {
  return metric && metric.values && Number.isFinite(metric.values[key]) ? metric.values[key] : fallback;
}

function extractLabel(metricName) {
  const match = metricName.match(/^http_req_duration\{([^}]+)\}$/);
  if (!match) return null;
  const tags = Object.fromEntries(
    match[1].split(',').map((part) => {
      const [key, value] = part.split(':');
      return [key, value];
    })
  );
  return tags.name || tags.endpoint || tags.scenario || match[1];
}

function requestRows(data) {
  const metrics = data.metrics || {};
  const durationSeconds = Math.max(metricValue(metrics.iteration_duration, 'avg') / 1000, 1);
  const totalDataReceived = metricValue(metrics.data_received, 'count');
  const totalDataSent = metricValue(metrics.data_sent, 'count') || metricValue(metrics.sent_bytes, 'count');
  const globalRequests = metricValue(metrics.http_reqs, 'count') || 1;
  const globalFailures = metricValue(metrics.http_req_failed, 'rate');

  return Object.entries(metrics)
    .map(([name, metric]) => ({ label: extractLabel(name), metric }))
    .filter((row) => row.label)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ label, metric }) => {
      const samples = Math.round(metricValue(metric, 'count', globalRequests));
      const share = samples / globalRequests;
      const throughput = samples / durationSeconds;
      const receivedKbSec = (totalDataReceived * share) / 1024 / durationSeconds;
      const sentKbSec = (totalDataSent * share) / 1024 / durationSeconds;
      const avgBytes = samples ? (totalDataReceived * share) / samples : 0;
      return {
        label,
        samples,
        average: round(metricValue(metric, 'avg')),
        median: round(metricValue(metric, 'med')),
        p90: round(metricValue(metric, 'p(90)')),
        p95: round(metricValue(metric, 'p(95)')),
        p99: round(metricValue(metric, 'p(99)')),
        min: round(metricValue(metric, 'min')),
        max: round(metricValue(metric, 'max')),
        stddev: round(metricValue(metric, 'stddev')),
        errorRate: round(globalFailures * 100, 4),
        throughput: round(throughput, 5),
        receivedKbSec: round(receivedKbSec, 2),
        sentKbSec: round(sentKbSec, 2),
        avgBytes: round(avgBytes, 1),
      };
    });
}

function checkRows(data) {
  const rows = [];
  function collectChecks(group, prefix = '') {
    const groupName = group.name && group.name !== '' ? `${prefix}${group.name}` : prefix;
    for (const check of group.checks || []) {
      rows.push({
        group: groupName || 'default',
        check: check.name,
        passes: check.passes || 0,
        fails: check.fails || 0,
        passRate: round(((check.passes || 0) / Math.max((check.passes || 0) + (check.fails || 0), 1)) * 100, 2),
      });
    }
    for (const nested of group.groups || []) {
      collectChecks(nested, groupName ? `${groupName} / ` : '');
    }
  }
  collectChecks(data.root_group || {});
  return rows;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

function buildReportRows(data) {
  return {
    metrics: requestRows(data),
    checks: checkRows(data),
  };
}

export { round, metricValue, extractLabel, requestRows, checkRows, csvEscape, toCsv, buildReportRows };
