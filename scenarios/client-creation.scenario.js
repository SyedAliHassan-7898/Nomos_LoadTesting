/**
 * client-creation.scenario.js
 * Reproduces the EXACT real front-end flow captured in the HAR file,
 * end to end, for every iteration/VU, with fresh unique data each run:
 *
 *   1.  POST /api/super-admin/auth/login
 *   2.  GET  /api/super-admin/users/profile
 *   3.  GET  /api/super-admin/portals/get-counts-for-dashboard
 *   4.  GET  /api/super-admin/users/profile              (UI re-fetches)
 *   5.  GET  /api/super-admin/customers?page=1&limit=10&isActive=true
 *   6.  GET  /api/super-admin/domains/custom-domain/available
 *   7-13. POST /api/files-upload/client-portal  (x7, one file per call:
 *        b.png, bg4.jpg, images.jpg, images (1).jpg, images (2).jpg,
 *        images (3).jpg, images (4).jpg)
 *   14. POST /api/super-admin/customers  (create client — UNIQUE name/domain/email every run)
 *   15. POST /api/admin/auth/login       (log in to the client portal as the HAR fixture user;
 *        two-step: initial attempt then forceLogin:true if an activeSession is detected —
 *        mirrors exactly entries 1 + 2 of script_admin-login-nomos-dev_weuno_co.har)
 *   16. GET  /api/super-admin/customers?page=1&limit=10&isActive=true (verify client appears)
 *
 * NOTE: The client login in step 15 uses ENV.CLIENT_ADMIN_EMAIL / CLIENT_ADMIN_PASSWORD —
 * a pre-verified HAR fixture account. The client created in step 14 is a brand-new portal
 * and its very first login is captcha-gated; that new-client first-login is out of scope.
 *
 * Negative / edge cases included:
 *  - create customer unauthenticated -> 401
 *  - create customer with empty payload -> 400
 *  - create customer with invalid types/enums -> 400
 *  - create customer with oversized field values -> 400 (or accepted+truncated, either way no 5xx)
 *  - create customer with SQL/XSS-style injection strings -> sanitized, never 500
 *  - duplicate portalName (create the same domain twice in the same iteration) -> second call 400/409
 *  - file upload with an invalid file type -> 400 (or graceful accept, never 500)
 *  - file upload with an oversized file -> 400/413 (or graceful accept, never 500)
 *  - pagination edge cases on the customers list (page=0, huge limit, negative limit)
 */
import { sleep } from 'k6';
import http from 'k6/http';
import { ENV } from '../config/environment.js';
import { apiGet, apiPost, safeJson } from '../lib/http-client.js';
import {
  expectStatus,
  expectSuccessTrue,
  expectHasField,
  expectNeverServerError,
  expectCondition,
} from '../lib/assertions.js';
import { loginSuperAdmin } from './auth.scenario.js';
import {
  buildValidCustomerPayload,
  buildEmptyCustomerPayload,
  buildInvalidTypeCustomerPayload,
  buildOversizedFieldsPayload,
  buildInjectionPayload,
} from '../lib/data-generator.js';

const CUSTOMERS_PATH = '/api/super-admin/customers';
const AVAILABLE_DOMAINS_PATH = '/api/super-admin/domains/custom-domain/available';
const DASHBOARD_COUNTS_PATH = '/api/super-admin/portals/get-counts-for-dashboard';
const PROFILE_PATH = '/api/super-admin/users/profile';
const UPLOAD_PATH = '/api/files-upload/client-portal';
const CATEGORY_SEED_PATH = '/api/category/categories-seed';
const CATEGORY_MODULES_PATH = '/api/category/get-category-modules';
const CATEGORY_GET_ALL_PATH = (moduleId) => `/api/category/get-all?moduleId=${moduleId}&page=1&limit=100`;
const CATEGORY_ADD_PATH = (moduleId) => `/api/category/add/${moduleId}`;
const CHALLENGE_UPLOAD_PATH = '/api/files-upload/event';
const CHALLENGE_ADD_PATH = '/api/admin/challenges/admin/add-challenge';
const FORUM_UPLOAD_PATH = '/api/files-upload/topic';
const FORUM_LIST_PATH = '/api/forums/get-all?page=1&limit=10';
const FORUM_TOPIC_ADD_PATH = (forumId) => `/api/topic/add-topic/${forumId}`;
const FORUM_TOPIC_LIST_PATH = (forumId) => `/api/topic/get-all-topic-with-forum/${forumId}?page=1&limit=10&forumId=${forumId}&filter=latest`;
// Real Event/Course item creation (HAR-verified: /api/files-upload/event + /api/files-upload/course,
// followed by /api/events/add-event/{categoryId} + /api/course/add-course/{categoryId}). Actually
// creating the item (not just the category) is what exercises the exact code path that puts an
// image on a real Course/Event card in the admin UI.
const EVENT_UPLOAD_PATH = '/api/files-upload/event';
const EVENT_ADD_PATH = (categoryId) => `/api/events/add-event/${categoryId}`;
const COURSE_UPLOAD_PATH = '/api/files-upload/course';
const COURSE_ADD_PATH = (categoryId) => `/api/course/add-course/${categoryId}`;
const COURSE_LIST_PATH = '/api/course/get-all-courses?page=1&limit=12';
const EVENT_LIST_PATH = '/api/events/search-with-filter?page=1&limit=12&isActive=true';
// Fallback IDs are only used if the module endpoint cannot be parsed. The
// preferred path is always to resolve IDs by module name from the API.
const FALLBACK_CATEGORY_MODULE_IDS = {
  News: '62418b65-6f03-4770-8bc7-88be73f82d61',
  Events: '8862e877-daf3-482a-8fbe-daf7584f2a71',
  Forum: '77a3b7cf-7c2e-4973-b667-985d3ad2f63a',
  Courses: '6222aa5b-883f-484f-8dcd-573823825559',
  Challenges: '47ca9ce0-13e9-4d8f-9db9-2ef51b449249',
};

/**
 * IMPORTANT — k6 lifecycle constraint:
 * open() is ONLY legal in the init stage (top-level module scope,
 * executed once per VU before any iteration runs). Calling it inside a
 * function that fires during runClientCreationScenario() throws
 * "the open function is only available in the init stage".
 * So every file this suite ever uploads is opened exactly once, here,
 * at module load time, and every VU iteration just re-wraps the same
 * already-loaded bytes with http.file() (which IS legal at runtime).
 */
const ASSET_BINS = {
  profile: open(`../${ENV.ASSETS.profile}`, 'b'),
  bg: open(`../${ENV.ASSETS.bg}`, 'b'),
  emailLogo: open(`../${ENV.ASSETS.emailLogo}`, 'b'),
  favicon: open(`../${ENV.ASSETS.favicon}`, 'b'),
  loginLogo: open(`../${ENV.ASSETS.loginLogo}`, 'b'),
  sidebarLogo: open(`../${ENV.ASSETS.sidebarLogo}`, 'b'),
  welcome: open(`../${ENV.ASSETS.welcome}`, 'b'),
  invalidType: open(`../${ENV.ASSETS.invalidType}`, 'b'),
  oversized: open(`../${ENV.ASSETS.oversized}`, 'b'),
  feedImage: open(`../${ENV.ASSETS.feedImage}`, 'b'),
};

/** Builds a fresh multipart form from a pre-loaded (init-stage) binary. Safe to call at any point during a VU iteration. */
function buildMultipart(assetKey, fileName) {
  return { files: http.file(ASSET_BINS[assetKey], fileName) };
}

function extractSubdomain(url) {
  try {
    const withoutProtocol = url.replace(/https?:\/\//, '');
    const parts = withoutProtocol.split('.');
    return parts[0];
  } catch (e) {
    return 'script';
  }
}

function uploadThemeAssets(token) {
  const uploads = [
    { key: 'adminProfilePicture', assetKey: 'profile', fileName: 'b.png', label: 'profile' },
    { key: 'bgImage', assetKey: 'bg', fileName: 'bg4.jpg', label: 'bg' },
    { key: 'emailLogo', assetKey: 'emailLogo', fileName: 'images.jpg', label: 'email_logo' },
    { key: 'favIcon', assetKey: 'favicon', fileName: 'images (1).jpg', label: 'favicon' },
    { key: 'loginPageLogo', assetKey: 'loginLogo', fileName: 'images (2).jpg', label: 'login_logo' },
    { key: 'sidebarNavigationLogo', assetKey: 'sidebarLogo', fileName: 'images (3).jpg', label: 'sidebar_logo' },
    { key: 'welcomeImage', assetKey: 'welcome', fileName: 'images (4).jpg', label: 'welcome' },
  ];

  const uploadedKeys = {};

  uploads.forEach(({ key, assetKey, fileName, label }) => {
    console.log(`[Client Creation] Uploading asset: ${label} (${fileName})...`);
    const res = apiPost(UPLOAD_PATH, buildMultipart(assetKey, fileName), token, {
      isMultipart: true,
      tags: { endpoint: 'file_upload', scenario: 'client_creation', case: `positive_upload_${label}` },
    });
    console.log(`[Client Creation] Asset ${label} status: ${res.status}`);
    expectStatus(res, [200, 201], `upload/${label}`);
    expectNeverServerError(res, `upload/${label}`);
    expectSuccessTrue(res, `upload/${label}`);
    const body = safeJson(res);
    const returnedKey = (body && body.data && Array.isArray(body.data.files) && body.data.files[0]) ||
      (body && Array.isArray(body.files) && body.files[0]) || '';
    expectCondition(Boolean(returnedKey), `upload/${label}: file key returned`);
    if (returnedKey) uploadedKeys[key] = returnedKey;
    sleep(0.1);
  });

  const keys = Object.values(uploadedKeys);
  expectCondition(Object.keys(uploadedKeys).length === uploads.length, 'upload/theme_assets: all seven image fields returned keys');
  expectCondition(new Set(keys).size === keys.length, 'upload/theme_assets: each image field received a distinct storage key');
  return uploadedKeys;
}

function unwrapData(body) {
  return body && body.data ? body.data : body;
}

function extractCategories(body) {
  const root = unwrapData(body) || {};
  if (Array.isArray(root.categories)) return root.categories;
  if (root.categories && Array.isArray(root.categories.data)) return root.categories.data;
  if (root.categories && Array.isArray(root.categories.categories)) return root.categories.categories;
  if (root.category) return [root.category];
  return [];
}

function extractModules(body) {
  const root = unwrapData(body) || {};
  if (Array.isArray(root)) return root;
  if (Array.isArray(root.modules)) return root.modules;
  if (root.modules && Array.isArray(root.modules.data)) return root.modules.data;
  if (root.modules && Array.isArray(root.modules.modules)) return root.modules.modules;
  if (Array.isArray(root.categoryModules)) return root.categoryModules;
  return [];
}

function extractCategoryId(body) {
  const categories = extractCategories(body);
  return categories[0] && categories[0].id ? categories[0].id : '';
}

function findCategoryByName(body, expectedName) {
  const wanted = String(expectedName || '').trim().toLowerCase();
  return extractCategories(body).find((category) =>
    category && String(category.name || '').trim().toLowerCase() === wanted && category.id
  ) || null;
}

function assertCategoryModule(category, expectedModuleName, expectedModuleId, label) {
  const module = category && category.module;
  expectCondition(Boolean(module), `${label}: category has module association`);
  if (!module) return;
  expectCondition(
    String(module.name || '').trim().toLowerCase() === String(expectedModuleName).trim().toLowerCase(),
    `${label}: category module is ${expectedModuleName}`
  );
  if (expectedModuleId) {
    expectCondition(module.id === expectedModuleId, `${label}: category module id matches selected module`);
  }
}

function resolveCategoryModuleIds(token, modulesResponseBody) {
  const resolved = {};
  const modules = extractModules(modulesResponseBody);
  modules.forEach((module) => {
    if (!module || !module.id || !module.name) return;
    const name = String(module.name).trim();
    resolved[name] = module.id;
  });

  const required = ['News', 'Events', 'Forum', 'Courses', 'Challenges'];
  required.forEach((name) => {
    if (!resolved[name] && ENV.ALLOW_STATIC_CATEGORY_MODULE_FALLBACK) {
      resolved[name] = FALLBACK_CATEGORY_MODULE_IDS[name];
    }
    expectCondition(Boolean(resolved[name]), `category/modules: ${name} module id resolved from API`);
  });
  return resolved;
}

function ensureCategory(token, moduleIds, moduleName, name, description, isSharedToChildren = false) {
  const moduleId = moduleIds[moduleName];
  expectCondition(Boolean(moduleId), `category/${moduleName.toLowerCase()}: module id is available`);
  if (!moduleId) return '';

  console.log(`[Category Flow] Fetching categories for ${moduleName} module (${moduleId})...`);
  const resList = apiGet(CATEGORY_GET_ALL_PATH(moduleId), token, {
    tags: { endpoint: 'get_categories', scenario: 'tenant_admin', case: `list_${moduleName.toLowerCase()}` },
  });
  console.log(`[Category Flow] ${moduleName} categories list status: ${resList.status}`);
  expectStatus(resList, [200], `category/list_${moduleName.toLowerCase()}`);
  expectNeverServerError(resList, `category/list_${moduleName.toLowerCase()}`);

  const listBody = safeJson(resList);
  const existing = findCategoryByName(listBody, name);
  if (existing) {
    console.log(`[Category Flow] ${moduleName} category '${name}' already exists: ${existing.id}`);
    assertCategoryModule(existing, moduleName, moduleId, `category/${moduleName.toLowerCase()}/existing`);
    return existing.id;
  }

  console.log(`[Category Flow] Creating ${moduleName} category: ${name}...`);
  const createRes = apiPost(CATEGORY_ADD_PATH(moduleId), {
    name,
    description,
    isSharedToChildren,
  }, token, {
    tags: { endpoint: 'create_category', scenario: 'tenant_admin', case: `create_${moduleName.toLowerCase()}` },
    expectedStatuses: [201, 400, 409],
  });
  console.log(`[Category Flow] ${moduleName} category create status: ${createRes.status}`);
  expectNeverServerError(createRes, `category/create_${moduleName.toLowerCase()}`);

  if (createRes.status === 201) {
    const createBody = safeJson(createRes);
    const created = findCategoryByName(createBody, name);
    if (created) {
      assertCategoryModule(created, moduleName, moduleId, `category/${moduleName.toLowerCase()}/created`);
      return created.id;
    }
  }

  // Concurrent VUs can race to create the same category. A 409 is acceptable
  // only when the exact category can subsequently be resolved from this module.
  if (createRes.status === 409) {
    console.log(`[Category Flow] ${moduleName} category already exists after concurrent create; re-fetching.`);
  } else if (createRes.status !== 201) {
    console.log(`[Category Flow] ${moduleName} category creation failed: ${createRes.body}`);
    expectStatus(createRes, [201], `category/create_${moduleName.toLowerCase()}`);
    return '';
  }

  const verifyRes = apiGet(CATEGORY_GET_ALL_PATH(moduleId), token, {
    tags: { endpoint: 'get_categories', scenario: 'tenant_admin', case: `verify_${moduleName.toLowerCase()}` },
  });
  expectStatus(verifyRes, [200], `category/verify_${moduleName.toLowerCase()}`);
  expectNeverServerError(verifyRes, `category/verify_${moduleName.toLowerCase()}`);
  const verifyBody = safeJson(verifyRes);
  const verified = findCategoryByName(verifyBody, name);
  if (verified) {
    assertCategoryModule(verified, moduleName, moduleId, `category/${moduleName.toLowerCase()}/verified`);
    return verified.id;
  }

  expectCondition(false, `category/${moduleName.toLowerCase()}: created category '${name}' is retrievable`);
  return '';
}

function createChallengeFlow(token, categoryId, vu, iter) {
  expectCondition(Boolean(categoryId), 'category/challenge: valid Challenges category id is available');
  if (!categoryId) return;

  console.log(`[Category Flow] Uploading challenge image...`);
  const uploadRes = apiPost(CHALLENGE_UPLOAD_PATH, buildMultipart('bg', 'bg4.jpg'), null, {
    isMultipart: true,
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN, true) },
    tags: { endpoint: 'challenge_file_upload', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Challenge image upload status: ${uploadRes.status}`);
  expectStatus(uploadRes, [200, 201], 'category/challenge_upload');
  expectNeverServerError(uploadRes, 'category/challenge_upload');
  const uploadBody = safeJson(uploadRes);
  const imageKey = (uploadBody && Array.isArray(uploadBody.files) && uploadBody.files[0]) ||
    (uploadBody && uploadBody.data && Array.isArray(uploadBody.data.files) && uploadBody.data.files[0]) || '';
  expectCondition(Boolean(imageKey), 'category/challenge_upload: response contains image key');

  const suffix = `${vu}-${iter}-${Date.now()}`;
  // IMPORTANT: rewards/resources/judges must be empty arrays when there are no
  // entries. Never send placeholder objects with empty labels or numeric reward
  // values; the API DTO rejects those shapes (observed 400 in the supplied run).
  const payload = {
    title: `Script Challenge ${suffix}`,
    difficulty: 'easy',
    description: '<h3>Create Challenge</h3><p><br></p>',
    image: imageKey || 'event/default.png',
    rewards: [],
    resources: [],
    rewardPoints: 10,
    participantLimit: 5,
    deadline: null,
    judges: [],
    status: 'published',
    isActive: true,
    categoryId,
  };

  console.log(`[Category Flow] Creating challenge: "${payload.title}"...`);
  const challengeRes = apiPost(CHALLENGE_ADD_PATH, payload, token, {
    tags: { endpoint: 'add_challenge', scenario: 'tenant_admin' },
    expectedStatuses: [201, 400],
  });
  console.log(`[Category Flow] Add challenge status: ${challengeRes.status}`);
  if (challengeRes.status >= 400) console.log(`[Category Flow] Add challenge failed: ${challengeRes.body}`);
  expectStatus(challengeRes, [201], 'category/add_challenge');
  expectNeverServerError(challengeRes, 'category/add_challenge');

  if (challengeRes.status === 201) {
    const body = safeJson(challengeRes);
    const challenge = body && body.data && body.data.challenge;
    expectCondition(Boolean(challenge && challenge.id), 'category/add_challenge: challenge id returned');
    if (challenge) {
      expectCondition(challenge.category && challenge.category.id === categoryId, 'category/add_challenge: category association is correct');
    }
  }
}

function createForumFlow(token, forumCategoryId) {
  expectCondition(Boolean(forumCategoryId), 'forum: valid Forum category id is available');
  if (!forumCategoryId) return;

  console.log(`[Category Flow] Fetching forums list...`);
  const resForums = apiGet(FORUM_LIST_PATH, token, {
    tags: { endpoint: 'get_forums', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Forums list status: ${resForums.status}`);
  expectStatus(resForums, [200], 'forum/list');
  expectNeverServerError(resForums, 'forum/list');
  const forumsBody = safeJson(resForums);
  const root = unwrapData(forumsBody) || {};
  const forumRows = root.forums && Array.isArray(root.forums.forum) ? root.forums.forum : [];
  const forum = forumRows.find((item) => item && item.categoryId === forumCategoryId) || null;
  const forumId = forum && forum.id ? forum.id : '';

  // A category UUID is NOT a forum UUID. The previous implementation used the
  // category ID as a fallback, which could send a valid UUID to the wrong
  // resource and make the topic test meaningless. If forum creation is not
  // available in the captured API contract, fail the chain instead of guessing.
  expectCondition(Boolean(forumId), 'forum: forum exists for selected Forum category');
  if (!forumId) {
    console.log(`[Category Flow] No forum exists for category ${forumCategoryId}; topic creation stopped intentionally.`);
    return;
  }

  expectCondition(forum.categoryId === forumCategoryId, 'forum: forum.categoryId matches selected Forum category');

  console.log(`[Category Flow] Uploading forum topic banner...`);
  const uploadRes = apiPost(FORUM_UPLOAD_PATH, buildMultipart('welcome', 'images (4).jpg'), null, {
    isMultipart: true,
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN, true) },
    tags: { endpoint: 'forum_file_upload', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Forum banner upload status: ${uploadRes.status}`);
  expectStatus(uploadRes, [200, 201], 'forum/upload_banner');
  expectNeverServerError(uploadRes, 'forum/upload_banner');
  const uploadBody = safeJson(uploadRes);
  const bannerKey = (uploadBody && Array.isArray(uploadBody.files) && uploadBody.files[0]) ||
    (uploadBody && uploadBody.data && Array.isArray(uploadBody.data.files) && uploadBody.data.files[0]) || '';
  expectCondition(Boolean(bannerKey), 'forum/upload_banner: response contains banner key');

  console.log(`[Category Flow] Creating forum topic against forum ${forumId}...`);
  const topicRes = apiPost(FORUM_TOPIC_ADD_PATH(forumId), {
    title: 'Forum Creation',
    content: 'Automated QA topic for forum discussion, topic rendering, and banner validation.',
    topicBanner: bannerKey || 'topic/default.png',
    topicImage: null,
    forumId,
  }, token, {
    tags: { endpoint: 'add_topic', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Add topic status: ${topicRes.status}`);
  expectStatus(topicRes, [200, 201], 'forum/add_topic');
  expectNeverServerError(topicRes, 'forum/add_topic');

  const topicBody = safeJson(topicRes);
  const topic = topicBody && topicBody.data && topicBody.data.topic;
  const topicId = (topic && topic.id) || (topicBody && topicBody.topic && topicBody.topic.id) || '';
  expectCondition(Boolean(topicId), 'forum/add_topic: topic id returned');

  const verifyTopicRes = apiGet(FORUM_TOPIC_LIST_PATH(forumId), token, {
    tags: { endpoint: 'get_topics', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Forum topics list status: ${verifyTopicRes.status}`);
  expectStatus(verifyTopicRes, [200], 'forum/list_topics');
  expectNeverServerError(verifyTopicRes, 'forum/list_topics');
}

/**
 * Real Event item creation (HAR-verified). Previously this script only ever
 * created the *category* an Event would live under and never actually created
 * an Event, so the "broken image on Events page" bug had zero automated
 * coverage. This uploads a real image, creates the event with that key, then
 * re-fetches the events list and asserts the returned image field is the
 * exact key we uploaded (not empty, not a default/placeholder path) — the
 * same check a human does by eyeballing whether the picture loads.
 */
function createEventFlow(token, categoryId, vu, iter) {
  expectCondition(Boolean(categoryId), 'event: valid Events category id is available');
  if (!categoryId) return;

  console.log(`[Event Flow] Uploading event image...`);
  const uploadRes = apiPost(EVENT_UPLOAD_PATH, buildMultipart('bg', 'bg4.jpg'), null, {
    isMultipart: true,
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN, true) },
    tags: { endpoint: 'event_file_upload', scenario: 'tenant_admin' },
  });
  console.log(`[Event Flow] Event image upload status: ${uploadRes.status}`);
  expectStatus(uploadRes, [200, 201], 'event/upload');
  expectNeverServerError(uploadRes, 'event/upload');
  const uploadBody = safeJson(uploadRes);
  const imageKey = (uploadBody && Array.isArray(uploadBody.files) && uploadBody.files[0]) ||
    (uploadBody && uploadBody.data && Array.isArray(uploadBody.data.files) && uploadBody.data.files[0]) || '';
  expectCondition(Boolean(imageKey), 'event/upload: response contains image key');
  if (!imageKey) {
    console.log('[Event Flow] Aborting event creation: no image key from upload.');
    return;
  }

  const suffix = `${vu}-${iter}-${Date.now()}`;
  const payload = {
    title: `Script Event ${suffix}`,
    description: '<h3>Create Event</h3><p><br></p>',
    eventType: 'Online',
    eventLink: 'https://www.google.com/search?q=google',
    recurrenceType: 'daily',
    duration: '3 month',
    maxAttendees: 10,
    image: imageKey,
    time: '16:44',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    categoryId,
    isActive: true,
  };

  console.log(`[Event Flow] Creating event: "${payload.title}"...`);
  const createRes = apiPost(EVENT_ADD_PATH(categoryId), payload, null, {
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN) },
    tags: { endpoint: 'add_event', scenario: 'tenant_admin' },
    expectedStatuses: [201, 400],
  });
  console.log(`[Event Flow] Add event status: ${createRes.status}`);
  if (createRes.status >= 400) console.log(`[Event Flow] Add event failed: ${createRes.body}`);
  expectStatus(createRes, [201], 'event/add_event');
  expectNeverServerError(createRes, 'event/add_event');
  if (createRes.status !== 201) return;

  const created = safeJson(createRes);
  const event = created && created.data && created.data.event;
  expectCondition(Boolean(event && event.id), 'event/add_event: event id returned');
  expectCondition(Boolean(event && event.image), 'event/add_event: response event has non-empty image field');
  if (event) {
    expectCondition(event.image === imageKey, 'event/add_event: stored image key matches uploaded key');
  }

  console.log(`[Event Flow] Verifying event image in list...`);
  const listRes = apiGet(EVENT_LIST_PATH, null, {
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN) },
    tags: { endpoint: 'get_events', scenario: 'tenant_admin' },
  });
  expectStatus(listRes, [200], 'event/list');
  const listBody = safeJson(listRes);
  const root = unwrapData(listBody) || {};
  const rows = Array.isArray(root.events) ? root.events
    : (root.events && Array.isArray(root.events.events)) ? root.events.events
    : (Array.isArray(root.data) ? root.data : []);
  const found = rows.find((row) => row && row.id === (event && event.id));
  expectCondition(Boolean(found), 'event/list: newly created event is retrievable');
  if (found) {
    expectCondition(Boolean(found.image), 'event/list: listed event has a non-empty image field');
    expectCondition(found.image === imageKey, 'event/list: listed event image matches the uploaded key (no default/broken fallback)');
  }
}

/**
 * Real Course item creation (HAR-verified). Same rationale as createEventFlow —
 * this script previously never created an actual Course, only the category.
 */
function createCourseFlow(token, categoryId, vu, iter) {
  expectCondition(Boolean(categoryId), 'course: valid Courses category id is available');
  if (!categoryId) return;

  console.log(`[Course Flow] Uploading course image...`);
  const uploadRes = apiPost(COURSE_UPLOAD_PATH, buildMultipart('profile', 'b.png'), null, {
    isMultipart: true,
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN, true) },
    tags: { endpoint: 'course_file_upload', scenario: 'tenant_admin' },
  });
  console.log(`[Course Flow] Course image upload status: ${uploadRes.status}`);
  expectStatus(uploadRes, [200, 201], 'course/upload');
  expectNeverServerError(uploadRes, 'course/upload');
  const uploadBody = safeJson(uploadRes);
  const imageKey = (uploadBody && Array.isArray(uploadBody.files) && uploadBody.files[0]) ||
    (uploadBody && uploadBody.data && Array.isArray(uploadBody.data.files) && uploadBody.data.files[0]) || '';
  expectCondition(Boolean(imageKey), 'course/upload: response contains image key');
  if (!imageKey) {
    console.log('[Course Flow] Aborting course creation: no image key from upload.');
    return;
  }

  const suffix = `${vu}-${iter}-${Date.now()}`;
  const payload = {
    title: `Script Course ${suffix}`,
    description: '<p>Course Description</p>',
    courseQualification: 'Course tester',
    imageUrl: imageKey,
    duration: '3 month',
    maxEnrollmentType: 'limited',
    maxEnrolled: 5,
    maxEnrollType: 'limited',
    unlockType: 'sequential',
    resources: [],
    categoryId,
  };

  console.log(`[Course Flow] Creating course: "${payload.title}"...`);
  const createRes = apiPost(COURSE_ADD_PATH(categoryId), payload, null, {
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN) },
    tags: { endpoint: 'add_course', scenario: 'tenant_admin' },
    expectedStatuses: [201, 400],
  });
  console.log(`[Course Flow] Add course status: ${createRes.status}`);
  if (createRes.status >= 400) console.log(`[Course Flow] Add course failed: ${createRes.body}`);
  expectStatus(createRes, [201], 'course/add_course');
  expectNeverServerError(createRes, 'course/add_course');
  if (createRes.status !== 201) return;

  const created = safeJson(createRes);
  const course = created && created.data && created.data.course;
  expectCondition(Boolean(course && course.id), 'course/add_course: course id returned');
  expectCondition(Boolean(course && course.imageUrl), 'course/add_course: response course has non-empty imageUrl field');
  if (course) {
    expectCondition(course.imageUrl === imageKey, 'course/add_course: stored imageUrl matches uploaded key');
  }

  console.log(`[Course Flow] Verifying course image in list...`);
  const listRes = apiGet(COURSE_LIST_PATH, null, {
    params: { headers: getTenantHeaders(token, ENV.CLIENT_PORTAL_ORIGIN) },
    tags: { endpoint: 'get_courses', scenario: 'tenant_admin' },
  });
  expectStatus(listRes, [200], 'course/list');
  const listBody = safeJson(listRes);
  const root = unwrapData(listBody) || {};
  const rows = Array.isArray(root.course) ? root.course : (Array.isArray(root.courses) ? root.courses : []);
  const found = rows.find((row) => row && row.id === (course && course.id));
  expectCondition(Boolean(found), 'course/list: newly created course is retrievable');
  if (found) {
    expectCondition(Boolean(found.imageUrl), 'course/list: listed course has a non-empty imageUrl field');
    expectCondition(found.imageUrl === imageKey, 'course/list: listed course imageUrl matches the uploaded key (no default/broken fallback)');
  }
}

function runCategoryAdminFlow(token, vu = 0, iter = 0) {
  console.log(`--- [Category Flow] Starting category ecosystem ---`);
  const runTag = `${vu}-${iter}-${Date.now()}`;
  const seedRes = apiPost(CATEGORY_SEED_PATH, {}, token, {
    tags: { endpoint: 'categories_seed', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Categories seed status: ${seedRes.status}`);
  expectStatus(seedRes, [200, 201], 'category/seed');
  expectNeverServerError(seedRes, 'category/seed');

  const modulesRes = apiGet(CATEGORY_MODULES_PATH, token, {
    tags: { endpoint: 'get_category_modules', scenario: 'tenant_admin' },
  });
  console.log(`[Category Flow] Category modules list status: ${modulesRes.status}`);
  expectStatus(modulesRes, [200], 'category/modules');
  expectNeverServerError(modulesRes, 'category/modules');
  const moduleIds = resolveCategoryModuleIds(token, safeJson(modulesRes));

  // "Nomos" is the pre-seeded system category and will already exist after
  // categories-seed, so resolving it alone never proves the News module's
  // "Add Category" endpoint actually works — ensureCategory() just returns the
  // existing row without ever calling POST /api/category/add/{newsModuleId}.
  // We resolve it for the sidebar/isolation check, AND separately force a
  // brand-new News category (a name that can't already exist) through the
  // exact same ensureCategory() path used by every other module below, so a
  // broken/no-op News "Add Category" button fails loudly here instead of only
  // being caught by a human clicking the UI.
  const newsCategoryId = ensureCategory(token, moduleIds, 'News', 'Nomos', 'System-generated category for news articles', true);
  const newsNewCategoryName = `Script News ${runTag}`;
  const eventsCategoryName = `Script Test ${runTag}`;
  const forumCategoryName = `Script Testing ${runTag}`;
  const coursesCategoryName = `Script Test ${runTag}`;
  const challengesCategoryName = `Script ${runTag}`;

  console.log(`[Category Flow] Creating/resolving unique categories for run ${runTag}...`);
  // isSharedToChildren = true across every module: the "share to sub-portals"
  // toggle in the Add Category form is meant to be available/on the same way
  // in News, Events, Forum, Courses, and Challenges — not just News/Courses.
  const newsNewCategoryId = ensureCategory(token, moduleIds, 'News', newsNewCategoryName, 'Load Testing News Category Creation', true);
  const eventsCategoryId = ensureCategory(token, moduleIds, 'Events', eventsCategoryName, 'Load Testing Script Categories Creation', true);
  const forumCategoryId = ensureCategory(token, moduleIds, 'Forum', forumCategoryName, 'Load Testing forum Category Creation', true);
  const coursesCategoryId = ensureCategory(token, moduleIds, 'Courses', coursesCategoryName, 'Load Testing Courses Category Creation', true);
  const challengesCategoryId = ensureCategory(token, moduleIds, 'Challenges', challengesCategoryName, 'Load Testing Challenges Category Creation', true);

  // Explicitly verify that each resolved category belongs to the intended module.
  [
    ['News', newsCategoryId],
    ['News (new create)', newsNewCategoryId],
    ['Events', eventsCategoryId],
    ['Forum', forumCategoryId],
    ['Courses', coursesCategoryId],
    ['Challenges', challengesCategoryId],
  ].forEach(([name, id]) => expectCondition(Boolean(id), `category/isolation: ${name} category id resolved`));

  createChallengeFlow(token, challengesCategoryId, vu, iter);
  createForumFlow(token, forumCategoryId);
  createEventFlow(token, eventsCategoryId, vu, iter);
  createCourseFlow(token, coursesCategoryId, vu, iter);

  console.log(`--- [Category Flow] Finished category ecosystem ---`);
}


function negativeUploadInvalidType(token) {
  const res = apiPost(UPLOAD_PATH, buildMultipart('invalidType', 'invalid-type.txt'), token, {
    isMultipart: true,
    tags: { endpoint: 'file_upload', scenario: 'client_creation', case: 'negative_invalid_file_type' },
    expectedStatuses: [400, 415],
  });
  console.log(`[Client Creation] [Negative] Invalid file type upload status: ${res.status}`);
  expectStatus(res, [400, 415], 'upload/invalid_type');
  expectNeverServerError(res, 'upload/invalid_type');
}

function negativeUploadOversized(token) {
  const res = apiPost(UPLOAD_PATH, buildMultipart('oversized', 'oversized.jpg'), token, {
    isMultipart: true,
    tags: { endpoint: 'file_upload', scenario: 'client_creation', case: 'negative_oversized_file' },
    expectedStatuses: [400, 413],
    params: { timeout: '30s' },
  });
  console.log(`[Client Creation] [Negative] Oversized file upload status: ${res.status}`);
  expectStatus(res, [400, 413], 'upload/oversized');
  expectNeverServerError(res, 'upload/oversized');
}

function negativeUploadUnauthenticated() {
  const res = apiPost(UPLOAD_PATH, buildMultipart('profile', 'b.png'), null, {
    isMultipart: true,
    tags: { endpoint: 'file_upload', scenario: 'client_creation', case: 'negative_unauthenticated' },
    expectedStatuses: [401],
  });
  console.log(`[Client Creation] [Negative] Unauthenticated file upload status: ${res.status}`);
  expectStatus(res, [401], 'upload/unauthenticated');
  expectNeverServerError(res, 'upload/unauthenticated');
}

function createCustomer(token, payload, caseLabel, expectedStatuses) {
  const res = apiPost(CUSTOMERS_PATH, payload, token, {
    tags: { endpoint: 'create_customer', scenario: 'client_creation', case: caseLabel },
    expectedStatuses: expectedStatuses,
  });
  console.log(`[Client Creation] Create customer (${caseLabel}) status: ${res.status}`);
  if (res.status >= 500) {
    console.log(`[Client Creation] Create customer (${caseLabel}) server error response: ${res.body}`);
  }
  expectStatus(res, expectedStatuses, `create_customer/${caseLabel}`);
  expectNeverServerError(res, `create_customer/${caseLabel}`);
  return res;
}

/**
 * loginCreatedClient — mirrors the exact two-step client-portal login
 * captured in the HAR file (script_admin-login-nomos-dev_weuno_co.har):
 *
 *   Step 1: POST /api/admin/auth/login  (no forceLogin)
 *     → If the device is already logged in the server returns 201 with
 *       data.user.activeSession = true and no accessToken. This is
 *       normal; the front-end then immediately retries with forceLogin.
 *     → If no active session, this step already returns the token.
 *
 *   Step 2 (only when step 1 signals activeSession): POST /api/admin/auth/login
 *     with forceLogin: true — evicts the old session and returns the
 *     real accessToken + refreshToken.
 *
 * The Origin header must match the client portal (not the super-admin
 * portal) because the backend uses it to scope the JWT audience.
 *
 * @param {string} portalOrigin  e.g. "https://script.admin-nomos-dev.weuno.co"
 * @returns {{ accessToken, refreshToken } | null}
 */
function loginCreatedClient(portalOrigin) {
  const CLIENT_LOGIN_PATH = '/api/admin/auth/login';
  const subdomain = extractSubdomain(portalOrigin);
  const basePayload = {
    email: ENV.CLIENT_ADMIN_EMAIL,
    password: ENV.CLIENT_ADMIN_PASSWORD,
    deviceId: ENV.CLIENT_ADMIN_DEVICE_ID,
  };

  console.log(`[Client Login] Step 1: POST ${CLIENT_LOGIN_PATH} for tenant: ${subdomain}`);
  // Step 1 — initial attempt (matches HAR entry 1)
  const res1 = apiPost(CLIENT_LOGIN_PATH, basePayload, null, {
    tags: { endpoint: 'client_login', scenario: 'client_creation', case: 'positive_client_login_step1' },
    params: {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        Origin: portalOrigin,
        Referer: `${portalOrigin}/`,
        'x-base-origin': 'nomos.io',
        'x-origin': subdomain,
        'x-portal-type': 'web3',
        'x-timezone': 'Asia/Karachi',
      },
    },
  });
  console.log(`[Client Login] Step 1 status: ${res1.status}`);
  if (res1.status >= 400) {
    console.log(`[Client Login] Step 1 failed. Response: ${res1.body}`);
  }
  expectStatus(res1, [200, 201], 'client_login/step1');
  expectNeverServerError(res1, 'client_login/step1');

  const body1 = safeJson(res1);
  // If the device has an active session the response contains
  // data.user.activeSession === true with no accessToken.
  const hasActiveSession =
    body1 &&
    body1.data &&
    body1.data.user &&
    body1.data.user.activeSession === true;

  if (!hasActiveSession) {
    // No session conflict — token is already here.
    if (body1 && body1.data && body1.data.user && body1.data.user.accessToken) {
      console.log(`[Client Login] Step 1 succeeded directly. Token acquired.`);
      return {
        accessToken: body1.data.user.accessToken,
        refreshToken: body1.data.user.refreshToken,
      };
    }
    return null;
  }

  // Step 2 — force-login to evict the stale session (matches HAR entry 2)
  sleep(0.2);
  console.log(`[Client Login] Step 2 (Force Login): POST ${CLIENT_LOGIN_PATH}`);
  const res2 = apiPost(CLIENT_LOGIN_PATH, { ...basePayload, forceLogin: true }, null, {
    tags: { endpoint: 'client_login', scenario: 'client_creation', case: 'positive_client_login_step2_force' },
    params: {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        Origin: portalOrigin,
        Referer: `${portalOrigin}/`,
        'x-base-origin': 'nomos.io',
        'x-origin': subdomain,
        'x-portal-type': 'web3',
        'x-timezone': 'Asia/Karachi',
      },
    },
  });
  console.log(`[Client Login] Step 2 status: ${res2.status}`);
  if (res2.status >= 400) {
    console.log(`[Client Login] Step 2 failed. Response: ${res2.body}`);
  }
  expectStatus(res2, [200, 201], 'client_login/step2_force');
  expectNeverServerError(res2, 'client_login/step2_force');

  const body2 = safeJson(res2);
  if (body2 && body2.data && body2.data.user && body2.data.user.accessToken) {
    console.log(`[Client Login] Step 2 succeeded. Token acquired.`);
    return {
      accessToken: body2.data.user.accessToken,
      refreshToken: body2.data.user.refreshToken,
    };
  }
  return null;
}

function getTenantHeaders(token, portalOrigin, isMultipart = false) {
  const subdomain = extractSubdomain(portalOrigin);
  const headers = {
    'ngrok-skip-browser-warning': 'true',
    Origin: portalOrigin,
    Referer: `${portalOrigin}/`,
    'x-base-origin': 'nomos.io',
    'x-origin': subdomain,
    'x-portal-type': 'web3',
    'x-timezone': 'Asia/Karachi',
  };
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function runTenantAdminPostLoginFlow(clientTokens, portalOrigin) {
  console.log(`--- [Tenant Admin Flow] Starting post-login activity ---`);
  let token = clientTokens.accessToken;
  let refreshToken = clientTokens.refreshToken;
  const headers = getTenantHeaders(token, portalOrigin);
  const multipartHeaders = getTenantHeaders(token, portalOrigin, true);

  function refreshTenantToken(rToken, pOrigin) {
    console.log(`[Tenant Admin Flow] Access token expired or close to expiry. Refreshing token...`);
    const rHeaders = getTenantHeaders(null, pOrigin);
    const res = apiPost('/api/admin/auth/refresh-token', { refreshToken: rToken }, null, {
      params: { headers: rHeaders },
      tags: { endpoint: 'client_refresh', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Refresh token status: ${res.status}`);
    if (res.status >= 400) {
      console.log(`[Tenant Admin Flow] Refresh token failed. Response: ${res.body}`);
    }
    if (res.status === 401) {
      console.log(`[Tenant Admin Flow] Refresh token expired too. Re-logging in to get fresh tokens...`);
      const freshTokens = loginCreatedClient(pOrigin);
      if (freshTokens) {
        return freshTokens;
      }
    }
    if (res.status === 200 || res.status === 201) {
      const body = safeJson(res);
      if (body && body.data && body.data.user && body.data.user.accessToken) {
        return {
          accessToken: body.data.user.accessToken,
          refreshToken: body.data.user.refreshToken || rToken
        };
      }
    }
    return null;
  }

  // 1. Sidebar menu
  console.log(`[Tenant Admin Flow] Fetching sidebar menu...`);
  const resSidebar = apiGet('/api/admin/custom-modules/get-login-user-sidebar', null, {
    params: { headers },
    tags: { endpoint: 'get_sidebar', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Sidebar status: ${resSidebar.status}`);
  expectStatus(resSidebar, [200], 'tenant_admin/sidebar');

  // 2. Notification modules
  console.log(`[Tenant Admin Flow] Fetching notification modules...`);
  const resNotifMods = apiGet('/api/notification/get-notification-modules', null, {
    params: { headers },
    tags: { endpoint: 'get_notification_modules', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Notification modules status: ${resNotifMods.status}`);
  expectStatus(resNotifMods, [200], 'tenant_admin/notification_modules');

  // 3. Key bundle
  console.log(`[Tenant Admin Flow] Fetching key bundle...`);
  const resKeyBundle = apiGet('/api/admin/key-bundle/my', null, {
    params: { headers },
    tags: { endpoint: 'get_key_bundle', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Key bundle status: ${resKeyBundle.status}`);
  expectStatus(resKeyBundle, [200], 'tenant_admin/key_bundle');

  // 4. User profile
  console.log(`[Tenant Admin Flow] Fetching profile...`);
  const resProfile = apiGet('/api/admin/users/profile', null, {
    params: { headers },
    tags: { endpoint: 'get_profile', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Profile status: ${resProfile.status}`);
  expectStatus(resProfile, [200], 'tenant_admin/profile');

  // 5. Notifications list
  console.log(`[Tenant Admin Flow] Fetching notifications list...`);
  const resNotifList = apiGet('/api/notification?page=1&limit=10', null, {
    params: { headers },
    tags: { endpoint: 'get_notifications', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Notifications list status: ${resNotifList.status}`);
  expectStatus(resNotifList, [200], 'tenant_admin/notifications_list');

  // 6. Home data
  console.log(`[Tenant Admin Flow] Fetching dashboard home data...`);
  const resHome = apiGet('/api/admin/home', null, {
    params: { headers },
    tags: { endpoint: 'get_home', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Home status: ${resHome.status}`);
  expectStatus(resHome, [200], 'tenant_admin/home');

  // 7. Get posts
  console.log(`[Tenant Admin Flow] Fetching posts...`);
  const resPosts = apiGet('/api/post?page=1&limit=4', null, {
    params: { headers },
    tags: { endpoint: 'get_posts', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Get posts status: ${resPosts.status}`);
  expectStatus(resPosts, [200], 'tenant_admin/get_posts');

  // 8. Upload feed file
  console.log(`[Tenant Admin Flow] Uploading feed image...`);
  const resUpload = apiPost('/api/files-upload/feed', buildMultipart('feedImage', 'new.jpg'), null, {
    isMultipart: true,
    params: { headers: multipartHeaders },
    tags: { endpoint: 'feed_file_upload', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Feed image upload status: ${resUpload.status}`);
  expectStatus(resUpload, [200, 201], 'tenant_admin/feed_upload');

  const uploadBody = safeJson(resUpload);
  let imageKey = '';
  if (uploadBody && Array.isArray(uploadBody.files) && uploadBody.files[0]) {
    imageKey = uploadBody.files[0];
  } else if (uploadBody && uploadBody.data && Array.isArray(uploadBody.data.files) && uploadBody.data.files[0]) {
    imageKey = uploadBody.data.files[0];
  }

  // 9. Add post
  console.log(`[Tenant Admin Flow] Creating feed post...`);
  const postPayload = {
    title: 'Script Test Post',
    description: '<p>Automated load test feed post verification.</p>',
    imageKey: imageKey || 'feed/default.png',
    canComment: true
  };
  const resPost = apiPost('/api/post/add-post', postPayload, null, {
    params: { headers },
    tags: { endpoint: 'create_post', scenario: 'tenant_admin' }
  });
  console.log(`[Tenant Admin Flow] Create post status: ${resPost.status}`);
  expectStatus(resPost, [200, 201], 'tenant_admin/create_post');

  const postBody = safeJson(resPost);
  const postId = postBody && postBody.post ? postBody.post.id : (postBody && postBody.data && postBody.data.post ? postBody.data.post.id : null);

  if (postId) {
    // 10. Toggle like
    console.log(`[Tenant Admin Flow] Toggling like on post: ${postId}...`);
    const resLike = apiPost(`/api/likes/toggle-like/${postId}?targetType=post`, {}, null, {
      params: { headers },
      tags: { endpoint: 'toggle_like', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Toggle like status: ${resLike.status}`);
    expectStatus(resLike, [200, 201], 'tenant_admin/toggle_like');

    // 11. Add a comment
    console.log(`[Tenant Admin Flow] Adding comment on post: ${postId}...`);
    const commentPayload = {
      content: 'testing ',
      commentableId: postId,
      commentableType: 'post'
    };
    const resAddComment = apiPost('/api/comments/add-comment', commentPayload, null, {
      params: { headers },
      tags: { endpoint: 'add_comment', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Add comment status: ${resAddComment.status}`);
    expectStatus(resAddComment, [200, 201], 'tenant_admin/add_comment');

    // 12. Get comments
    console.log(`[Tenant Admin Flow] Fetching comments for post: ${postId}...`);
    const resComments = apiGet(`/api/comments/get-comment-by-type/${postId}?limit=2&page=1&type=post`, null, {
      params: { headers },
      tags: { endpoint: 'get_comments', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Get comments status: ${resComments.status}`);
    expectStatus(resComments, [200], 'tenant_admin/get_comments');

    // 13. Fetch categories for the content module
    console.log(`[Tenant Admin Flow] Fetching content categories...`);
    const resCategories = apiGet('/api/category/module/62418b65-6f03-4770-8bc7-88be73f82d61', null, {
      params: { headers },
      tags: { endpoint: 'get_categories', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Fetch content categories status: ${resCategories.status}`);
    expectStatus(resCategories, [200], 'tenant_admin/get_categories');

    const catBody = safeJson(resCategories);
    let categoryId = '';
    if (catBody && Array.isArray(catBody.categories) && catBody.categories[0]) {
      categoryId = catBody.categories[0].id;
    } else if (catBody && catBody.data && Array.isArray(catBody.data.categories) && catBody.data.categories[0]) {
      categoryId = catBody.data.categories[0].id;
    }

    // 14. Fetch labels for the content module
    console.log(`[Tenant Admin Flow] Fetching content labels...`);
    const resLabels = apiGet('/api/label/module/c142bab2-12e3-4262-bfe1-c2ff270d61d2', null, {
      params: { headers },
      tags: { endpoint: 'get_labels', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Fetch content labels status: ${resLabels.status}`);
    expectStatus(resLabels, [200], 'tenant_admin/get_labels');

    // 15. Fetch items list initially
    console.log(`[Tenant Admin Flow] Fetching items list (initial)...`);
    const resNewsInitial = apiGet('/api/admin/news?page=1&limit=12&categoryId=&labelId=', null, {
      params: { headers },
      tags: { endpoint: 'get_news', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Fetch items list (initial) status: ${resNewsInitial.status}`);
    expectStatus(resNewsInitial, [200], 'tenant_admin/get_news');

    // 16. Run news feed sync
    console.log(`[Tenant Admin Flow] Running news feed sync...`);
    const resRunFeed = apiPost('/api/admin/news/run-feed', {}, null, {
      params: { headers },
      tags: { endpoint: 'run_news_feed', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Run news feed status: ${resRunFeed.status}`);
    expectStatus(resRunFeed, [200, 201], 'tenant_admin/run_news_feed');

    const refreshed = refreshTenantToken(refreshToken, portalOrigin);
    if (refreshed) {
      token = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      headers['Authorization'] = `Bearer ${token}`;
      multipartHeaders['Authorization'] = `Bearer ${token}`;
    }

    // 17. Fetch items filtered by category
    if (categoryId) {
      console.log(`[Tenant Admin Flow] Fetching items filtered by category: ${categoryId}...`);
      const resNewsFiltered = apiGet(`/api/admin/news?page=1&limit=12&categoryId=${categoryId}&labelId=`, null, {
        params: { headers },
        tags: { endpoint: 'get_news', scenario: 'tenant_admin' }
      });
      console.log(`[Tenant Admin Flow] Fetch items filtered status: ${resNewsFiltered.status}`);
      expectStatus(resNewsFiltered, [200], 'tenant_admin/get_news');
    }

    // 18. Upload content image
    console.log(`[Tenant Admin Flow] Uploading content image...`);
    const resNewsUpload = apiPost('/api/files-upload/news', buildMultipart('feedImage', 'new1.jpg'), null, {
      isMultipart: true,
      params: { headers: multipartHeaders },
      tags: { endpoint: 'news_file_upload', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Content image upload status: ${resNewsUpload.status}`);
    expectStatus(resNewsUpload, [200, 201], 'tenant_admin/news_upload');

    const newsUploadBody = safeJson(resNewsUpload);
    let newsImageKey = '';
    if (newsUploadBody && Array.isArray(newsUploadBody.files) && newsUploadBody.files[0]) {
      newsImageKey = newsUploadBody.files[0];
    } else if (newsUploadBody && newsUploadBody.data && Array.isArray(newsUploadBody.data.files) && newsUploadBody.data.files[0]) {
      newsImageKey = newsUploadBody.data.files[0];
    }

    // 19. Add content item
    console.log(`[Tenant Admin Flow] Adding content item...`);
    const newsPayload = {
      title: 'New Features & Performance Enhancements',
      pinned: true,
      author: 'Test QA Script ',
      body: '<p><strong>Content:</strong> We are excited to announce our latest platform updates!</p>',
      image: newsImageKey || 'news/default.png',
      categoryIds: categoryId ? [categoryId] : []
    };
    const resAddNews = apiPost('/api/admin/add-news', newsPayload, null, {
      params: { headers },
      tags: { endpoint: 'add_news', scenario: 'tenant_admin' }
    });
    console.log(`[Tenant Admin Flow] Add content status: ${resAddNews.status}`);
    if (resAddNews.status >= 400) {
      console.log(`[Tenant Admin Flow] Add content failed. Response: ${resAddNews.body}`);
    }
    expectStatus(resAddNews, [200, 201], 'tenant_admin/add_news');

    // 20. Fetch items list again to verify inclusion
    if (categoryId) {
      console.log(`[Tenant Admin Flow] Fetching items list after creation...`);
      const resNewsFinal = apiGet(`/api/admin/news?page=1&limit=12&categoryId=${categoryId}&labelId=`, null, {
        params: { headers },
        tags: { endpoint: 'get_news', scenario: 'tenant_admin' }
      });
      console.log(`[Tenant Admin Flow] Fetch items list final status: ${resNewsFinal.status}`);
      expectStatus(resNewsFinal, [200], 'tenant_admin/get_news_final');
    }

    runCategoryAdminFlow(token, __VU, __ITER);
  }

  console.log(`--- [Tenant Admin Flow] Finished post-login activity ---`);
}

function verifyCustomerAppears(token, expectedUsername) {
  const res = apiGet(`${CUSTOMERS_PATH}?page=1&limit=10&isActive=true`, token, {
    tags: { endpoint: 'list_customers', scenario: 'client_creation', case: 'positive_verify_after_create' },
  });
  console.log(`[Client Creation] Verify customer appears list status: ${res.status}`);
  expectStatus(res, [200], 'list_customers/verify_after_create');
  expectSuccessTrue(res, 'list_customers/verify_after_create');
  expectNeverServerError(res, 'list_customers/verify_after_create');
}

function paginationEdgeCases(token) {
  const cases = [
    { qs: 'page=0&limit=10', label: 'page_zero' },
    { qs: 'page=1&limit=0', label: 'limit_zero' },
    { qs: 'page=1&limit=100000', label: 'huge_limit' },
    { qs: 'page=-1&limit=10', label: 'negative_page' },
    { qs: 'page=1&limit=-10', label: 'negative_limit' },
    { qs: 'page=abc&limit=xyz', label: 'non_numeric' },
    { qs: 'page=1&limit=10&search=%27%20OR%20%271%27%3D%271', label: 'search_sql_injection' },
    { qs: 'page=1&limit=10&isActive=notabool', label: 'invalid_boolean' },
  ];
  cases.forEach(({ qs, label }) => {
    console.log(`[Client Creation] [Pagination Edge Case] Checking ${label} (query: ${qs})...`);
    const res = apiGet(`${CUSTOMERS_PATH}?${qs}`, token, {
      tags: { endpoint: 'list_customers', scenario: 'client_creation', case: `edge_${label}` },
        expectedStatuses: label === 'negative_limit' ? [400] : [200, 400],
    });
    console.log(`[Client Creation] [Pagination Edge Case] ${label} status: ${res.status}`);
    if (res.status >= 500) {
      console.log(`[Client Creation] [Pagination Edge Case] ${label} returned server error: ${res.body}`);
    }
    expectNeverServerError(res, `list_customers/${label}`);
    sleep(0.1);
  });
}

/**
 * Full positive flow, exactly mirroring the captured HAR sequence,
 * plus interleaved negative/edge checks. Called once per VU iteration.
 */
export function runClientCreationScenario(vu, iter) {
  console.log(`--- [Client Creation] Starting VU ${vu}, Iteration ${iter} ---`);
  const session = loginSuperAdmin();
  if (!session || !session.accessToken) {
    console.log(`[Client Creation] Super Admin login failed!`);
    return; // login itself already asserted/failed in loginSuperAdmin()
  }
  const token = session.accessToken;
  console.log(`[Client Creation] Super Admin login successful.`);
  sleep(0.2);

  console.log(`[Client Creation] Fetching Super Admin profile...`);
  const pRes1 = apiGet(PROFILE_PATH, token, { tags: { endpoint: 'profile', scenario: 'client_creation', case: 'positive_profile' } });
  console.log(`[Client Creation] Profile status: ${pRes1.status}`);
  sleep(0.2);

  console.log(`[Client Creation] Fetching dashboard counts...`);
  const dashRes = apiGet(DASHBOARD_COUNTS_PATH, token, {
    tags: { endpoint: 'dashboard_counts', scenario: 'client_creation', case: 'positive_dashboard' },
  });
  console.log(`[Client Creation] Dashboard counts status: ${dashRes.status}`);
  expectStatus(dashRes, [200], 'dashboard/counts');
  expectHasField(dashRes, 'data.dashboard.totalCustomers', 'dashboard/counts');
  sleep(0.2);

  console.log(`[Client Creation] Re-fetching profile...`);
  const pRes2 = apiGet(PROFILE_PATH, token, { tags: { endpoint: 'profile', scenario: 'client_creation', case: 'positive_profile_refetch' } });
  console.log(`[Client Creation] Profile refetch status: ${pRes2.status}`);
  sleep(0.2);

  console.log(`[Client Creation] Fetching customers list...`);
  const listRes = apiGet(`${CUSTOMERS_PATH}?page=1&limit=10&isActive=true`, token, {
    tags: { endpoint: 'list_customers', scenario: 'client_creation', case: 'positive_list_before_create' },
  });
  console.log(`[Client Creation] Customers list status: ${listRes.status}`);
  sleep(0.2);

  console.log(`[Client Creation] Checking domain availability...`);
  const dRes = apiGet(AVAILABLE_DOMAINS_PATH, token, {
    tags: { endpoint: 'available_domains', scenario: 'client_creation', case: 'positive_available_domains' },
  });
  console.log(`[Client Creation] Domain availability status: ${dRes.status}`);
  sleep(0.2);

  // --- Negative/edge cases that don't need real uploaded assets ---
  console.log(`[Client Creation] Running negative upload checks...`);
  negativeUploadUnauthenticated();
  sleep(0.1);
  negativeUploadInvalidType(token);
  sleep(0.1);
  negativeUploadOversized(token);
  sleep(0.2);

  // --- Real 7-file upload sequence, exactly like the UI ---
  console.log(`[Client Creation] Uploading theme assets...`);
  const uploadedAssetKeys = uploadThemeAssets(token);

  // --- Build the unique, valid payload and merge in uploaded asset keys ---
  const validPayload = buildValidCustomerPayload(vu, iter);
  validPayload.themeSettings = { ...validPayload.themeSettings, ...uploadedAssetKeys };

  // --- Negative create-customer cases (independent, don't pollute the real create) ---
  console.log(`[Client Creation] Running negative customer creation checks...`);
  createCustomer(token, buildEmptyCustomerPayload(), 'negative_empty_payload', [400]);
  sleep(0.1);
  createCustomer(token, buildInvalidTypeCustomerPayload(vu, iter), 'negative_invalid_types', [400]);
  sleep(0.1);
  createCustomer(token, buildOversizedFieldsPayload(vu, iter), 'negative_oversized_fields', [200, 201, 400]);
  sleep(0.1);
  createCustomer(token, buildInjectionPayload(vu, iter), 'negative_injection_strings', [200, 201, 400]);
  sleep(0.1);
  createCustomer(null, validPayload, 'negative_unauthenticated_create', [401]);
  sleep(0.2);

  // --- The real, positive create — unique client every run ---
  console.log(`[Client Creation] Creating valid customer: ${validPayload.customer.username}...`);
  const createRes = createCustomer(token, validPayload, 'positive_create_client', [200, 201]);
  sleep(0.2);

  // --- Log in to the newly-created client's portal immediately after creation ---
  console.log(`[Client Creation] Performing client admin portal login...`);
  const clientTokens = loginCreatedClient(ENV.CLIENT_PORTAL_ORIGIN);
  if (clientTokens && clientTokens.accessToken) {
    runTenantAdminPostLoginFlow(clientTokens, ENV.CLIENT_PORTAL_ORIGIN);
  } else {
    console.log(`[Client Creation] Client admin login failed, skipping tenant admin flow.`);
  }
  sleep(0.2);

  // --- Duplicate portalName should now be rejected ---
  console.log(`[Client Creation] Checking duplicate portalName rejection...`);
  createCustomer(token, validPayload, 'negative_duplicate_portal_name', [400, 409]);
  sleep(0.2);

  // --- Verify it shows up in the list ---
  console.log(`[Client Creation] Verifying customer in list...`);
  verifyCustomerAppears(token, validPayload.customer.username);
  sleep(0.2);

  // --- Pagination / query-param edge cases on the list endpoint ---
  console.log(`[Client Creation] Checking pagination edge cases...`);
  paginationEdgeCases(token);

  console.log(`--- [Client Creation] Finished VU ${vu}, Iteration ${iter} ---`);
  return createRes;
}
