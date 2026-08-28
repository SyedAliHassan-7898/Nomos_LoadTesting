/**
 * environment.js
 * ------------------------------------------------------------------
 * Single source of truth for every environment-specific value the
 * load test needs. Nothing else in the project should hardcode a
 * URL, credential, or ID — always import it from here.
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
 * client we just created — we use this pre-existing, already
 * verified client whose ID is fixed below. Swap this value whenever
 * that fixture client changes.
 * ------------------------------------------------------------------
 */

export const ENV = {
  // ---- Hosts -------------------------------------------------------
  BASE_URL: __ENV.BASE_URL || 'https://api.nomos-dev.weuno.co',
  PORTAL_ORIGIN: __ENV.PORTAL_ORIGIN || 'https://superadmin-nomos-dev.weuno.co',

  // ---- Super Admin credentials (Dev) --------------------------------
  SUPER_ADMIN_EMAIL: __ENV.SUPER_ADMIN_EMAIL || 'superadmin@nomos-tech.com',
  SUPER_ADMIN_PASSWORD: __ENV.SUPER_ADMIN_PASSWORD || 'Ue8yz4j3W9CKL3yJ',

  // ---- Fixed / fixture client used for all "act on an existing
  // client" scenarios so we never touch a freshly-created, captcha-
  // gated client. Override via -e HARDCODED_CLIENT_ID=... per environment.
  HARDCODED_CLIENT_ID: __ENV.HARDCODED_CLIENT_ID || '59b3c7d4-43ca-4b1d-bd59-0b7cf1e09440',

  // ---- Client-portal admin login (from HAR capture) -----------------
  // Credentials for the "script" client portal's admin user — a real,
  // already-verified account. Used to exercise POST /api/admin/auth/login
  // immediately after a new client is created each iteration, mirroring
  // exactly what the front-end does (HAR entries 1 + 2).
  // The HAR showed the API first returns "activeSession" when the device
  // is already logged in; the client retries with forceLogin:true to
  // evict the old session and obtain a fresh token.
  // Override via -e CLIENT_PORTAL_ORIGIN=... etc. for a different env.
  CLIENT_PORTAL_ORIGIN: __ENV.CLIENT_PORTAL_ORIGIN || 'https://script.admin-nomos-dev.weuno.co',
  CLIENT_ADMIN_EMAIL: __ENV.CLIENT_ADMIN_EMAIL || 'script@yopmail.com',
  CLIENT_ADMIN_PASSWORD: __ENV.CLIENT_ADMIN_PASSWORD || 'Test@123',
  CLIENT_ADMIN_DEVICE_ID: __ENV.CLIENT_ADMIN_DEVICE_ID || '50e115bf-aee4-4692-9dc0-f11564b7d05a',

  // ---- Static assets used for multipart file-upload requests -------
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
    // Reused for the course-content (module) thumbnail upload — matches the
    // "new1..." storage key seen in the HAR capture for /api/files-upload/courseModule.
    courseModuleThumb: 'assets/new1.jpg',
  },

  // ---- Common headers seen on real traffic (from HAR capture) -------
  COMMON_HEADERS: {
    'ngrok-skip-browser-warning': 'true',
  },

  // ---- Load shape knobs (all overridable with -e) -------------------
  PROFILE: __ENV.PROFILE || 'smoke', // smoke | load | stress | spike | soak
  VUS: Number(__ENV.VUS || 5),
  DURATION: __ENV.DURATION || '1m',

  // Upload contract. Keep these configurable because the API may enforce a
  // different image-size limit per environment, but do not silently accept
  // invalid/unauthenticated uploads in the test suite.
  MAX_UPLOAD_BYTES: Number(__ENV.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
  ALLOW_STATIC_CATEGORY_MODULE_FALLBACK: String(__ENV.ALLOW_STATIC_CATEGORY_MODULE_FALLBACK || 'false') === 'true',

  // ---- Thresholds (SLOs) --------------------------------------------
  THRESHOLDS: {
    http_req_failed: ['rate<0.05'],           // <5% hard failures
    http_req_duration: ['p(95)<2000'],        // 95% of requests under 2s
    'http_req_duration{endpoint:login}': ['p(95)<1500'],
    'http_req_duration{endpoint:create_customer}': ['p(95)<3000'],
    'http_req_duration{endpoint:file_upload}': ['p(95)<3000'],
    checks: ['rate>0.95'],
  },
};

export default ENV;