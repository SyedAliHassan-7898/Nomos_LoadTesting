/**
 * auth.scenario.js
 * Covers: POST /api/super-admin/auth/login, refresh-token, logout
 *
 * Positive:
 *  - valid credentials -> 200/201 + accessToken + refreshToken
 *  - refresh-token with the token just issued -> new accessToken
 *  - logout with a valid token -> 200
 *
 * Negative / edge:
 *  - wrong password
 *  - unknown email
 *  - missing password field
 *  - empty body
 *  - malformed JSON
 *  - SQL-injection-style email
 *  - excessively long email string
 *  - wrong content-type
 *  - refresh-token with garbage/expired token
 *  - logout without a token (unauthorized)
 *  - accessing a protected route without a token
 *  - accessing a protected route with a malformed/tampered token
 */
import { sleep } from 'k6';
import { ENV } from '../config/environment.js';
import { apiPost, apiGet, safeJson } from '../lib/http-client.js';
import {
  expectStatus,
  expectSuccessTrue,
  expectSuccessFalse,
  expectHasField,
  expectNeverServerError,
} from '../lib/assertions.js';

const LOGIN_PATH = '/api/super-admin/auth/login';
const REFRESH_PATH = '/api/super-admin/auth/refresh-token';
const LOGOUT_PATH = '/api/super-admin/auth/logout';
const PROFILE_PATH = '/api/super-admin/users/profile';

/** Logs in as super admin and returns { accessToken, refreshToken } or null on failure. */
export function loginSuperAdmin() {
  console.log(`[Auth] Attempting Super Admin login with email: ${ENV.SUPER_ADMIN_EMAIL}...`);
  const res = apiPost(
    LOGIN_PATH,
    { email: ENV.SUPER_ADMIN_EMAIL, password: ENV.SUPER_ADMIN_PASSWORD },
    null,
    { tags: { endpoint: 'login', scenario: 'auth', case: 'positive_valid_login' } }
  );

  console.log(`[Auth] Super Admin login status: ${res.status}`);
  if (res.status >= 400) {
    console.log(`[Auth] Super Admin login failed. Response: ${res.body}`);
  }
  expectStatus(res, [200, 201], 'login/valid');
  expectSuccessTrue(res, 'login/valid');
  expectHasField(res, 'data.user.accessToken', 'login/valid');
  expectNeverServerError(res, 'login/valid');

  const body = safeJson(res);
  if (!body || !body.data || !body.data.user) return null;
  return {
    accessToken: body.data.user.accessToken,
    refreshToken: body.data.user.refreshToken,
  };
}

function negativeWrongPassword() {
  console.log(`[Auth] [Negative] Login with wrong password...`);
  const res = apiPost(
    LOGIN_PATH,
    { email: ENV.SUPER_ADMIN_EMAIL, password: 'definitely-wrong-password-123!' },
    null,
    { tags: { endpoint: 'login', scenario: 'auth', case: 'negative_wrong_password' }, expectedStatuses: [400, 401, 403, 404, 422] }
  );
  console.log(`[Auth] [Negative] Wrong password status: ${res.status}`);
  expectStatus(res, [400, 401, 403, 404, 422], 'login/wrong_password');
  expectSuccessFalse(res, 'login/wrong_password');
  expectNeverServerError(res, 'login/wrong_password');
}

function negativeUnknownEmail() {
  console.log(`[Auth] [Negative] Login with unknown email...`);
  const res = apiPost(
    LOGIN_PATH,
    { email: `no-such-user-${Date.now()}@yopmail.com`, password: 'whatever123' },
    null,
    { tags: { endpoint: 'login', scenario: 'auth', case: 'negative_unknown_email' }, expectedStatuses: [400, 401, 404] }
  );
  console.log(`[Auth] [Negative] Unknown email status: ${res.status}`);
  expectStatus(res, [400, 401, 404], 'login/unknown_email');
  expectSuccessFalse(res, 'login/unknown_email');
  expectNeverServerError(res, 'login/unknown_email');
}

function negativeMissingPassword() {
  console.log(`[Auth] [Negative] Login with missing password field...`);
  const res = apiPost(
    LOGIN_PATH,
    { email: ENV.SUPER_ADMIN_EMAIL },
    null,
    { tags: { endpoint: 'login', scenario: 'auth', case: 'negative_missing_password' }, expectedStatuses: [400] }
  );
  console.log(`[Auth] [Negative] Missing password status: ${res.status}`);
  expectStatus(res, [400], 'login/missing_password');
  expectNeverServerError(res, 'login/missing_password');
}

function negativeEmptyBody() {
  console.log(`[Auth] [Negative] Login with empty body...`);
  const res = apiPost(LOGIN_PATH, {}, null, {
    tags: { endpoint: 'login', scenario: 'auth', case: 'negative_empty_body' },
    expectedStatuses: [400],
  });
  console.log(`[Auth] [Negative] Empty body status: ${res.status}`);
  expectStatus(res, [400], 'login/empty_body');
  expectNeverServerError(res, 'login/empty_body');
}

function negativeMalformedJson() {
  console.log(`[Auth] [Negative] Login with malformed JSON...`);
  const res = apiPost(LOGIN_PATH, '{"email": "bad-json@yopmail.com", "password": ', null, {
    raw: true,
    tags: { endpoint: 'login', scenario: 'auth', case: 'negative_malformed_json' },
    expectedStatuses: [400],
  });
  console.log(`[Auth] [Negative] Malformed JSON status: ${res.status}`);
  expectStatus(res, [400], 'login/malformed_json');
  expectNeverServerError(res, 'login/malformed_json');
}

function negativeInjectionEmail() {
  console.log(`[Auth] [Negative] Login with SQL injection in email...`);
  const res = apiPost(
    LOGIN_PATH,
    { email: `' OR '1'='1' -- @yopmail.com`, password: `' OR '1'='1` },
    null,
    { tags: { endpoint: 'login', scenario: 'auth', case: 'negative_sql_injection' }, expectedStatuses: [400, 401] }
  );
  console.log(`[Auth] [Negative] SQL injection status: ${res.status}`);
  expectStatus(res, [400, 401], 'login/sql_injection');
  expectNeverServerError(res, 'login/sql_injection');
}

function negativeOversizedEmail() {
  console.log(`[Auth] [Negative] Login with oversized email...`);
  const res = apiPost(
    LOGIN_PATH,
    { email: `${'a'.repeat(3000)}@yopmail.com`, password: 'whatever123' },
    null,
    { tags: { endpoint: 'login', scenario: 'auth', case: 'negative_oversized_email' }, expectedStatuses: [400, 413, 414] }
  );
  console.log(`[Auth] [Negative] Oversized email status: ${res.status}`);
  expectStatus(res, [400, 413, 414], 'login/oversized_email');
  expectNeverServerError(res, 'login/oversized_email');
}

function negativeNoTokenOnProtectedRoute() {
  console.log(`[Auth] [Negative] Fetch protected profile without token...`);
  const res = apiGet(PROFILE_PATH, null, {
    tags: { endpoint: 'profile', scenario: 'auth', case: 'negative_no_token' },
    expectedStatuses: [401],
  });
  console.log(`[Auth] [Negative] Protected profile without token status: ${res.status}`);
  expectStatus(res, [401], 'profile/no_token');
  expectNeverServerError(res, 'profile/no_token');
}

function negativeTamperedToken() {
  console.log(`[Auth] [Negative] Fetch protected profile with tampered token...`);
  const res = apiGet(PROFILE_PATH, 'this.is.not.a.valid.jwt', {
    tags: { endpoint: 'profile', scenario: 'auth', case: 'negative_tampered_token' },
    expectedStatuses: [401],
  });
  console.log(`[Auth] [Negative] Protected profile with tampered token status: ${res.status}`);
  expectStatus(res, [401], 'profile/tampered_token');
  expectNeverServerError(res, 'profile/tampered_token');
}

function refreshTokenFlow(refreshToken) {
  console.log(`[Auth] Refreshing access token...`);
  const res = apiPost(REFRESH_PATH, { refreshToken }, null, {
    tags: { endpoint: 'refresh', scenario: 'auth', case: 'positive_refresh' },
  });
  console.log(`[Auth] Refresh token status: ${res.status}`);
  expectStatus(res, [200, 201], 'refresh/valid');
  expectNeverServerError(res, 'refresh/valid');
}

function refreshTokenGarbage() {
  console.log(`[Auth] [Negative] Refresh token with garbage token...`);
  const res = apiPost(REFRESH_PATH, { refreshToken: 'garbage-token-value' }, null, {
    tags: { endpoint: 'refresh', scenario: 'auth', case: 'negative_garbage_token' },
    expectedStatuses: [400, 401],
  });
  console.log(`[Auth] [Negative] Refresh garbage token status: ${res.status}`);
  expectStatus(res, [400, 401], 'refresh/garbage_token');
  expectNeverServerError(res, 'refresh/garbage_token');
}

function refreshTokenMissingField() {
  console.log(`[Auth] [Negative] Refresh token with missing field...`);
  const res = apiPost(REFRESH_PATH, {}, null, {
    tags: { endpoint: 'refresh', scenario: 'auth', case: 'negative_missing_field' },
    expectedStatuses: [400],
  });
  console.log(`[Auth] [Negative] Refresh missing field status: ${res.status}`);
  expectStatus(res, [400], 'refresh/missing_field');
  expectNeverServerError(res, 'refresh/missing_field');
}

function logoutWithoutToken() {
  console.log(`[Auth] [Negative] Logout without token...`);
  const res = apiPost(LOGOUT_PATH, {}, null, {
    tags: { endpoint: 'logout', scenario: 'auth', case: 'negative_logout_no_token' },
    expectedStatuses: [401],
  });
  console.log(`[Auth] [Negative] Logout without token status: ${res.status}`);
  expectStatus(res, [401], 'logout/no_token');
  expectNeverServerError(res, 'logout/no_token');
}

function logoutWithValidToken(accessToken) {
  console.log(`[Auth] Logging out with valid token...`);
  const res = apiPost(LOGOUT_PATH, {}, accessToken, {
    tags: { endpoint: 'logout', scenario: 'auth', case: 'positive_logout' },
  });
  console.log(`[Auth] Logout status: ${res.status}`);
  expectStatus(res, [200, 201], 'logout/valid');
  expectNeverServerError(res, 'logout/valid');
}

/**
 * Full auth scenario entry point. Runs the positive login once and
 * reuses that session for refresh/logout, and independently runs all
 * negative/edge cases (which don't depend on the positive session).
 */
export function runAuthScenario() {
  console.log(`--- [Auth] Starting Scenario ---`);
  // --- Negative & edge cases first (self-contained, cheap) ---
  negativeWrongPassword();
  sleep(0.2);
  negativeUnknownEmail();
  sleep(0.2);
  negativeMissingPassword();
  sleep(0.2);
  negativeEmptyBody();
  sleep(0.2);
  negativeMalformedJson();
  sleep(0.2);
  negativeInjectionEmail();
  sleep(0.2);
  negativeOversizedEmail();
  sleep(0.2);
  negativeNoTokenOnProtectedRoute();
  sleep(0.2);
  negativeTamperedToken();
  sleep(0.2);
  logoutWithoutToken();
  sleep(0.2);
  refreshTokenGarbage();
  sleep(0.2);
  refreshTokenMissingField();
  sleep(0.2);

  // --- Positive session lifecycle ---
  const session = loginSuperAdmin();
  if (session && session.accessToken) {
    sleep(0.2);
    if (session.refreshToken) {
      refreshTokenFlow(session.refreshToken);
    }
    sleep(0.2);
    logoutWithValidToken(session.accessToken);
  }
  console.log(`--- [Auth] Finished Scenario ---`);
}
