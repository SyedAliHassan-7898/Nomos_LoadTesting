/**
 * client-management.scenario.js
 *
 * Covers every "act on an EXISTING client" endpoint discovered in the
 * Swagger export. These deliberately NEVER touch the client that was
 * just created in client-creation.scenario.js (that client is fresh,
 * unverified, and its first login is captcha-gated + tied to a real
 * verification email). Instead every call here targets
 * ENV.HARDCODED_CLIENT_ID — a fixed, already-verified fixture client
 * you configure once in config/environment.js.
 *
 * Endpoints covered (from netnestlab_js_export.txt / Swagger):
 *   GET   /api/super-admin/customers/get-customer/{id}
 *   GET   /api/super-admin/customers/theme-settings          (current admin's own, via token)
 *   PUT   /api/super-admin/customers/{id}/theme-settings
 *   PATCH /api/super-admin/customers/{id}/change-status
 *   PATCH /api/super-admin/customers/{id}/verify-customer
 *   GET   /api/super-admin/customers/all-tenants
 *
 * Positive:
 *  - fetch the hardcoded client by id -> 200 + matching id in body
 *  - fetch all-tenants list -> 200
 *  - fetch the hardcoded client's theme settings -> 200
 *  - update the hardcoded client's theme settings with a harmless,
 *    reversible color tweak -> 200 (never touches identity/domain fields)
 *
 * Negative / edge:
 *  - fetch by a well-formed but non-existent UUID -> 404
 *  - fetch by a malformed id (not a UUID) -> 400/404, never 500
 *  - fetch/update without a token -> 401
 *  - fetch/update with a tampered token -> 401
 *  - change-status / verify-customer on a non-existent id -> 404, never 500
 *  - update theme-settings with an invalid hex color -> 400 or sanitized, never 500
 *  - update theme-settings on a non-existent id -> 404, never 500
 *
 * NOTE ON change-status / verify-customer:
 * The Swagger export renders these DTOs with no visible properties
 * (a common NestJS/Swagger decorator quirk), so the exact body shape
 * isn't confirmed from spec alone and wasn't present in the captured
 * HAR (which only covers the create flow). We deliberately do NOT
 * fire the "positive" change-status/verify-customer calls against the
 * real hardcoded client on every run (that would flip a fixture
 * client's real status on every load-test iteration). We only probe
 * them with invalid ids to confirm the route exists and never 5xx's.
 * Flip RUN_MUTATING_STATUS_CHECKS=true once the exact body is
 * confirmed against a disposable fixture if you want full coverage.
 */
import { sleep } from 'k6';
import { ENV } from '../config/environment.js';
import { apiGet, apiPut, apiPatch, safeJson } from '../lib/http-client.js';
import {
  expectStatus,
  expectSuccessTrue,
  expectHasField,
  expectNeverServerError,
  expectCondition,
} from '../lib/assertions.js';
import { loginSuperAdmin } from './auth.scenario.js';

const GET_CUSTOMER_PATH = (id) => `/api/super-admin/customers/get-customer/${id}`;
const ALL_TENANTS_PATH = '/api/super-admin/customers/all-tenants';
const OWN_THEME_SETTINGS_PATH = '/api/super-admin/customers/theme-settings';
const CLIENT_THEME_SETTINGS_PATH = (id) => `/api/super-admin/customers/${id}/theme-settings`;
const CHANGE_STATUS_PATH = (id) => `/api/super-admin/customers/${id}/change-status`;
const VERIFY_CUSTOMER_PATH = (id) => `/api/super-admin/customers/${id}/verify-customer`;

const NON_EXISTENT_UUID = '00000000-0000-4000-8000-000000000000';
const MALFORMED_ID = 'not-a-uuid-!!!';

const RUN_MUTATING_STATUS_CHECKS = String(__ENV.RUN_MUTATING_STATUS_CHECKS || 'false') === 'true';

function getHardcodedClient(token) {
  const id = ENV.HARDCODED_CLIENT_ID;
  console.log(`[Client Management] Fetching hardcoded client details for ID: ${id}...`);
  const res = apiGet(GET_CUSTOMER_PATH(id), token, {
    tags: { endpoint: 'get_customer', scenario: 'client_mgmt', case: 'positive_get_hardcoded_client' },
  });
  console.log(`[Client Management] Get hardcoded client status: ${res.status}`);
  if (res.status >= 400) {
    console.log(`[Client Management] Get hardcoded client failed. Response: ${res.body}`);
  }
  expectStatus(res, [200], 'get_customer/hardcoded');
  expectSuccessTrue(res, 'get_customer/hardcoded');
  expectNeverServerError(res, 'get_customer/hardcoded');
  const body = safeJson(res);
  console.log(`[Client Management] Hardcoded Client ID: ${id}`);
  console.log(`[Client Management] Client Data: ${JSON.stringify(body)}`);

  // Regression coverage for Portal Images: the API must expose each saved
  // image under its own explicit themeSettings property. This catches field
  // swapping/cross-population even when the UI happens to render an image.
  [
    'adminProfilePicture',
    'bgImage',
    'loginPageLogo',
    'sidebarNavigationLogo',
    'favIcon',
    'welcomeImage',
    'emailLogo',
  ].forEach((field) => expectHasField(res, `data.customer.themeSettings.${field}`, `theme_settings/${field}`));

  const theme = body && body.data && body.data.customer && body.data.customer.themeSettings;
  if (theme) {
    const imageValues = [
      theme.adminProfilePicture,
      theme.bgImage,
      theme.loginPageLogo,
      theme.sidebarNavigationLogo,
      theme.favIcon,
      theme.welcomeImage,
      theme.emailLogo,
    ].filter(Boolean);
    expectCondition(new Set(imageValues).size === imageValues.length, 'theme_settings: portal image values are not duplicated across fields');
  }
  return body;
}

function getAllTenants(token) {
  console.log(`[Client Management] Fetching all tenants...`);
  const res = apiGet(ALL_TENANTS_PATH, token, {
    tags: { endpoint: 'all_tenants', scenario: 'client_mgmt', case: 'positive_all_tenants' },
  });
  console.log(`[Client Management] Get all tenants status: ${res.status}`);
  expectStatus(res, [200], 'all_tenants/list');
  expectNeverServerError(res, 'all_tenants/list');
}

function getUserBadges(token) {
  // The supplied run proved /api/badge is a stale/non-existent route (404),
  // while the actual tenant endpoint returns 200 from /api/admin/user-badges/display.
  const res = apiGet('/api/admin/user-badges/display?page=1&limit=10&isActive=true', token, {
    tags: { endpoint: 'user_badges', scenario: 'client_mgmt', case: 'positive_user_badges' },
  });
  console.log(`[Client Management] User badges status: ${res.status}`);
  expectStatus(res, [200], 'user_badges/list');
  expectSuccessTrue(res, 'user_badges/list');
  expectNeverServerError(res, 'user_badges/list');
}

function getOwnThemeSettings(token) {
  console.log(`[Client Management] Fetching own theme settings...`);
  const res = apiGet(OWN_THEME_SETTINGS_PATH, token, {
    params: {
      headers: {
        'x-base-origin': 'nomos.io',
      },
    },
    tags: { endpoint: 'theme_settings', scenario: 'client_mgmt', case: 'positive_own_theme_settings' },
  });
  console.log(`[Client Management] Fetch own theme settings status: ${res.status}`);
  if (res.status >= 400) {
    console.log(`[Client Management] Fetch own theme settings failed. Response: ${res.body}`);
  }
  expectStatus(res, [200], 'theme_settings/own');
  expectSuccessTrue(res, 'theme_settings/own');
  expectNeverServerError(res, 'theme_settings/own');
}

function updateHardcodedClientTheme(token) {
  const id = ENV.HARDCODED_CLIENT_ID;
  console.log(`[Client Management] Updating hardcoded client theme color for ID: ${id}...`);
  const res = apiPut(
    CLIENT_THEME_SETTINGS_PATH(id),
    { themeColor: '#3aafa9' },
    token,
    {
      params: {
        headers: {
          'x-base-origin': 'nomos.io',
        },
      },
      tags: { endpoint: 'theme_settings', scenario: 'client_mgmt', case: 'positive_update_theme' },
    }
  );
  console.log(`[Client Management] Update client theme status: ${res.status}`);
  if (res.status >= 400) {
    console.log(`[Client Management] Update client theme failed. Response: ${res.body}`);
  }
  expectStatus(res, [200], 'theme_settings/update_hardcoded');
  expectSuccessTrue(res, 'theme_settings/update_hardcoded');
  expectNeverServerError(res, 'theme_settings/update_hardcoded');
}

function updateThemeInvalidColor(token) {
  const id = ENV.HARDCODED_CLIENT_ID;
  console.log(`[Client Management] [Negative] Updating theme settings with invalid color...`);
  const res = apiPut(
    CLIENT_THEME_SETTINGS_PATH(id),
    { themeColor: 'not-a-hex-color' },
    token,
    {
      params: {
        headers: {
          'x-base-origin': 'nomos.io',
        },
      },
      tags: { endpoint: 'theme_settings', scenario: 'client_mgmt', case: 'negative_invalid_color' },
    }
  );
  console.log(`[Client Management] [Negative] Update theme invalid color status: ${res.status}`);
  if (res.status >= 400) {
    console.log(`[Client Management] Update theme invalid color failed. Response: ${res.body}`);
  }
  expectStatus(res, [400, 422], 'theme_settings/invalid_color');
  expectNeverServerError(res, 'theme_settings/invalid_color');
}

function updateThemeNonExistentId(token) {
  console.log(`[Client Management] [Negative] Updating theme settings on non-existent UUID...`);
  const res = apiPut(
    CLIENT_THEME_SETTINGS_PATH(NON_EXISTENT_UUID),
    { themeColor: '#000000' },
    token,
    {
      params: {
        headers: {
          'x-base-origin': 'nomos.io',
        },
      },
      tags: { endpoint: 'theme_settings', scenario: 'client_mgmt', case: 'negative_nonexistent_id' },
    }
  );
  console.log(`[Client Management] [Negative] Update theme non-existent ID status: ${res.status}`);
  if (res.status >= 400) {
    console.log(`[Client Management] Update theme non-existent ID failed. Response: ${res.body}`);
  }
  expectStatus(res, [404], 'theme_settings/nonexistent_id');
  expectNeverServerError(res, 'theme_settings/nonexistent_id');
}

function getCustomerNonExistent(token) {
  console.log(`[Client Management] [Negative] Fetching customer with non-existent UUID...`);
  const res = apiGet(GET_CUSTOMER_PATH(NON_EXISTENT_UUID), token, {
    tags: { endpoint: 'get_customer', scenario: 'client_mgmt', case: 'negative_nonexistent_id' },
  });
  console.log(`[Client Management] [Negative] Get non-existent customer status: ${res.status}`);
  expectStatus(res, [404], 'get_customer/nonexistent_id');
  expectNeverServerError(res, 'get_customer/nonexistent_id');
}

function getCustomerMalformedId(token) {
  console.log(`[Client Management] [Negative] Fetching customer with malformed ID...`);
  const res = apiGet(GET_CUSTOMER_PATH(MALFORMED_ID), token, {
    tags: { endpoint: 'get_customer', scenario: 'client_mgmt', case: 'negative_malformed_id' },
  });
  console.log(`[Client Management] [Negative] Get malformed customer status: ${res.status}`);
  expectStatus(res, [400, 404], 'get_customer/malformed_id');
  expectNeverServerError(res, 'get_customer/malformed_id');
}

function getCustomerUnauthenticated() {
  console.log(`[Client Management] [Negative] Fetching hardcoded customer unauthenticated...`);
  const res = apiGet(GET_CUSTOMER_PATH(ENV.HARDCODED_CLIENT_ID), null, {
    tags: { endpoint: 'get_customer', scenario: 'client_mgmt', case: 'negative_unauthenticated' },
  });
  console.log(`[Client Management] [Negative] Get unauthenticated customer status: ${res.status}`);
  expectStatus(res, [401], 'get_customer/unauthenticated');
  expectNeverServerError(res, 'get_customer/unauthenticated');
}

function getCustomerTamperedToken() {
  console.log(`[Client Management] [Negative] Fetching hardcoded customer with tampered token...`);
  const res = apiGet(GET_CUSTOMER_PATH(ENV.HARDCODED_CLIENT_ID), 'tampered.jwt.token', {
    tags: { endpoint: 'get_customer', scenario: 'client_mgmt', case: 'negative_tampered_token' },
  });
  console.log(`[Client Management] [Negative] Get customer tampered token status: ${res.status}`);
  expectStatus(res, [401], 'get_customer/tampered_token');
  expectNeverServerError(res, 'get_customer/tampered_token');
}

function changeStatusNonExistent(token) {
  console.log(`[Client Management] [Negative] Changing status of non-existent customer...`);
  const res = apiPatch(CHANGE_STATUS_PATH(NON_EXISTENT_UUID), { isActive: true }, token, {
    tags: { endpoint: 'change_status', scenario: 'client_mgmt', case: 'negative_nonexistent_id' },
  });
  console.log(`[Client Management] [Negative] Change status non-existent status: ${res.status}`);
  expectStatus(res, [400, 404], 'change_status/nonexistent_id');
  expectNeverServerError(res, 'change_status/nonexistent_id');
}

function verifyCustomerNonExistent(token) {
  console.log(`[Client Management] [Negative] Verifying non-existent customer...`);
  const res = apiPatch(VERIFY_CUSTOMER_PATH(NON_EXISTENT_UUID), {}, token, {
    tags: { endpoint: 'verify_customer', scenario: 'client_mgmt', case: 'negative_nonexistent_id' },
  });
  console.log(`[Client Management] [Negative] Verify customer non-existent status: ${res.status}`);
  expectStatus(res, [400, 404], 'verify_customer/nonexistent_id');
  expectNeverServerError(res, 'verify_customer/nonexistent_id');
}

function changeStatusOnHardcodedClient(token) {
  const id = ENV.HARDCODED_CLIENT_ID;
  console.log(`[Client Management] Changing status of hardcoded client for ID: ${id}...`);
  const res = apiPatch(CHANGE_STATUS_PATH(id), { isActive: true }, token, {
    tags: { endpoint: 'change_status', scenario: 'client_mgmt', case: 'positive_change_status_hardcoded' },
  });
  console.log(`[Client Management] Change status hardcoded status: ${res.status}`);
  expectStatus(res, [200], 'change_status/hardcoded');
  expectNeverServerError(res, 'change_status/hardcoded');
}

/**
 * Full client-management scenario entry point. Independent of
 * client-creation.scenario.js — can run standalone or interleaved.
 */
export function runClientManagementScenario() {
  console.log(`--- [Client Management] Starting Scenario ---`);
  // --- Negative/edge cases that don't need a session ---
  getCustomerUnauthenticated();
  sleep(0.1);
  getCustomerTamperedToken();
  sleep(0.2);

  const session = loginSuperAdmin();
  if (!session || !session.accessToken) {
    console.log(`[Client Management] Super Admin login failed!`);
    return;
  }
  const token = session.accessToken;

  // --- Positive reads against the fixed, pre-verified fixture client ---
  getHardcodedClient(token);
  sleep(0.2);
  getAllTenants(token);
  sleep(0.2);
  getUserBadges(token);
  sleep(0.2);
  getOwnThemeSettings(token);
  sleep(0.2);
  updateHardcodedClientTheme(token);
  sleep(0.2);

  // --- Negative / edge cases against real routes ---
  getCustomerNonExistent(token);
  sleep(0.1);
  getCustomerMalformedId(token);
  sleep(0.1);
  updateThemeInvalidColor(token);
  sleep(0.1);
  updateThemeNonExistentId(token);
  sleep(0.1);
  changeStatusNonExistent(token);
  sleep(0.1);
  verifyCustomerNonExistent(token);
  sleep(0.2);

  if (RUN_MUTATING_STATUS_CHECKS) {
    changeStatusOnHardcodedClient(token);
  }
  console.log(`--- [Client Management] Finished Scenario ---`);
}
