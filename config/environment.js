/**
 * environment.js
 * ------------------------------------------------------------------
 * Single source of truth for every environment-specific value the
 * load test needs. Nothing else in the project should hardcode a URL,
 * credential, or ID - always import it from here.
 *
 * Values can be overridden at run time without touching this file,
 * e.g.:
 *   k6 run -e BASE_URL=https://api.nomos-staging.weuno.co main.js
 *   k6 run -e HARDCODED_CLIENT_ID=xxxx-xxxx main.js
 *
 * WHY A "HARDCODED_CLIENT_ID" EXISTS:
 * Every load test run creates a brand-new client portal (unique name/
 * domain/email per iteration) to exercise the real onboarding flow.
 * But that new client triggers a real verification email and its
 * "first login" is guarded by captcha in the real product, which a
 * script cannot solve. So for ANY scenario that needs to act "on a
 * client" after creation (get details, change status, verify,
 * update theme, fetch by id, etc.) we deliberately do NOT use the
 * client we just created - we use this pre-existing, already verified
 * client whose ID is fixed below.
 * ------------------------------------------------------------------
 */

function parseDotEnv(text) {
  const result = {};
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    });
  return result;
}

function readTextFile(path) {
  try {
    return open(path);
  } catch (e) {
    return '';
  }
}

let fileEnv = {};
try {
  fileEnv = parseDotEnv(readTextFile('../.env'));
} catch (e) {
  fileEnv = {};
}

function pick(key, fallback = '') {
  if (__ENV[key] != null && __ENV[key] !== '') return __ENV[key];
  if (fileEnv[key] != null && fileEnv[key] !== '') return fileEnv[key];
  return fallback;
}

function pickNumber(key, fallback) {
  const raw = pick(key, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredPick(key) {
  const value = pick(key, '');
  if (value) return value;
  throw new Error(`Missing required environment value: ${key}`);
}

function pickBoolean(key, fallback = false) {
  const raw = pick(key, '');
  if (raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

export const ENV = {
  BASE_URL: requiredPick('BASE_URL'),
  PORTAL_ORIGIN: requiredPick('PORTAL_ORIGIN'),

  SUPER_ADMIN_EMAIL: requiredPick('SUPER_ADMIN_EMAIL'),
  SUPER_ADMIN_PASSWORD: requiredPick('SUPER_ADMIN_PASSWORD'),

  HARDCODED_CLIENT_ID: requiredPick('HARDCODED_CLIENT_ID'),

  CLIENT_PORTAL_ORIGIN: requiredPick('CLIENT_PORTAL_ORIGIN'),
  CLIENT_ADMIN_EMAIL: requiredPick('CLIENT_ADMIN_EMAIL'),
  CLIENT_ADMIN_PASSWORD: requiredPick('CLIENT_ADMIN_PASSWORD'),
  CLIENT_ADMIN_DEVICE_ID: requiredPick('CLIENT_ADMIN_DEVICE_ID'),

  ASSETS: {
    profile: 'assets/b.png',
    bg: 'assets/bg4.jpg',
    emailLogo: 'assets/images.jpg',
    favicon: 'assets/images (1).jpg',
    loginLogo: 'assets/images (2).jpg',
    sidebarLogo: 'assets/images (3).jpg',
    welcome: 'assets/images (4).jpg',
    invalidType: 'assets/invalid-type.txt',
    oversized: 'assets/oversized.jpg',
    feedImage: 'assets/new.jpg',
    courseModuleThumb: 'assets/new1.jpg',
  },

  COMMON_HEADERS: {
    'ngrok-skip-browser-warning': 'true',
  },

  PROFILE: pick('PROFILE', 'smoke'),
  VUS: pickNumber('VUS', 5),
  DURATION: pick('DURATION', '1m'),

  MAX_UPLOAD_BYTES: pickNumber('MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
  ALLOW_STATIC_CATEGORY_MODULE_FALLBACK: pickBoolean('ALLOW_STATIC_CATEGORY_MODULE_FALLBACK', false),

  THRESHOLDS: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    'http_req_duration{endpoint:login}': ['p(95)<1500'],
    'http_req_duration{endpoint:create_customer}': ['p(95)<3000'],
    'http_req_duration{endpoint:file_upload}': ['p(95)<3000'],
    checks: ['rate>0.95'],
  },
};

export default ENV;
