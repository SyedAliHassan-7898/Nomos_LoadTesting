/**
 * http-client.js
 * A thin wrapper around k6's http so every request in every scenario
 * gets consistent headers, consistent tagging (for threshold/metric
 * breakdowns), and a single place to change behavior later.
 */
import http from 'k6/http';
import { ENV } from '../config/environment.js';

function buildHeaders(token, extra = {}, isMultipart = false) {
  const headers = {
    ...ENV.COMMON_HEADERS,
    ...extra,
  };
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function apiGet(path, token, { tags = {}, params = {} } = {}) {
  const url = `${ENV.BASE_URL}${path}`;
  const headers = buildHeaders(token, params.headers || {});
  return http.get(url, {
    ...params,
    headers,
    tags,
  });
}

function withExpectedResponse(params = {}, expectedStatuses) {
  if (expectedStatuses == null || (Array.isArray(expectedStatuses) && expectedStatuses.length === 0)) {
    return params;
  }

  // k6 expects expectedStatuses() as a variadic list, not an array.
  // Passing the array directly causes: `argument number 1 ... was neither
  // an integer nor an object`. A plain JS callback is also unsupported by
  // k6 Params.responseCallback. Convert the scenario's exact-status array
  // into the supported k6 callback object. This keeps intentional 4xx/409
  // negative cases out of http_req_failed while expectStatus() still enforces
  // the exact response contract.
  const statuses = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  return {
    ...params,
    responseCallback: http.expectedStatuses(...statuses),
  };
}

export function apiPost(path, body, token, { tags = {}, isMultipart = false, raw = false, params = {}, expectedStatuses = null } = {}) {
  const url = `${ENV.BASE_URL}${path}`;
  const payload = isMultipart || raw ? body : JSON.stringify(body);
  const requestParams = {
    ...params,
    headers: buildHeaders(token, params.headers || {}, isMultipart),
    tags,
  };
  return http.post(url, payload, withExpectedResponse(requestParams, expectedStatuses));
}

export function apiPut(path, body, token, { tags = {}, params = {}, expectedStatuses = null } = {}) {
  const url = `${ENV.BASE_URL}${path}`;
  const requestParams = {
    ...params,
    headers: buildHeaders(token, params.headers || {}),
    tags,
  };
  return http.put(url, JSON.stringify(body), withExpectedResponse(requestParams, expectedStatuses));
}

export function apiPatch(path, body, token, { tags = {}, params = {}, expectedStatuses = null } = {}) {
  const url = `${ENV.BASE_URL}${path}`;
  const requestParams = {
    ...params,
    headers: buildHeaders(token, params.headers || {}),
    tags,
  };
  return http.patch(url, body ? JSON.stringify(body) : undefined, withExpectedResponse(requestParams, expectedStatuses));
}

export function apiDelete(path, token, { tags = {}, params = {}, expectedStatuses = null } = {}) {
  const url = `${ENV.BASE_URL}${path}`;
  const requestParams = {
    ...params,
    headers: buildHeaders(token, params.headers || {}),
    tags,
  };
  return http.del(url, null, withExpectedResponse(requestParams, expectedStatuses));
}

export function safeJson(res) {
  try {
    return res.json();
  } catch (e) {
    return null;
  }
}
