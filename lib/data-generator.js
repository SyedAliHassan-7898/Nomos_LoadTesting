/**
 * data-generator.js
 * Produces unique, realistic payloads for every VU/iteration so
 * "create client" never collides with a prior run (unique portalName,
 * unique subdomain, unique email/username) — exactly like a real
 * onboarding test would.
 */
/**
 * Local randomString implementation (no external CDN dependency —
 * jslib.k6.io can be blocked by corporate proxies/firewalls, and this
 * suite should run fully offline aside from the target API itself).
 */
function randomString(length, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return out;
}

const COUNTRIES = ['Pakistan', 'United States', 'United Kingdom', 'Canada', 'Germany', 'United Arab Emirates', 'American Samoa'];
const PORTAL_TYPES = ['web2', 'web3'];
const DOMAIN_KINDS = ['Nomos', 'Edgistra', 'Buzzmint'];

export function uniqueSuffix(vu, iter) {
  // VU + iteration + timestamp + short random -> collision-proof across parallel VUs
  return `${vu}${iter}${Date.now()}${randomString(4, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
}

export function randomCountry() {
  return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
}

export function randomPortalType() {
  return PORTAL_TYPES[Math.floor(Math.random() * PORTAL_TYPES.length)];
}

export function randomDomainKind() {
  return DOMAIN_KINDS[Math.floor(Math.random() * DOMAIN_KINDS.length)];
}

/**
 * Builds a fully valid, unique "create customer" payload.
 * Mirrors the exact shape captured from the real UI flow (HAR).
 */
export function buildValidCustomerPayload(vu, iter) {
  const suffix = uniqueSuffix(vu, iter);
  const portalName = `loadtest-${suffix}`;
  return {
    customer: {
      firstName: 'LoadTest',
      lastName: `QA-${suffix}`,
      country: randomCountry(),
      email: `loadtest.${suffix}@yopmail.com`,
      username: `loadtest_${suffix}`,
      portalType: randomPortalType(),
    },
    domain: {
      portalName,
      kind: 'Nomos',
    },
    themeSettings: {
      cardTextColor: '#2f3e46',
      cardBgColor: '#edf6f9',
      loginBoxColor: '#d0f0f5',
      pageBgColor: '#f4f8fb',
      panelBgColor: '#e1ecf4',
      fontColor: '#0f6391',
      themeColor: '#3aafa9',
      buttonFontColor: '#000000',
      panelFontColor: '#0f6391',
      loginInputColor: '#000000',
      cardTextColorDark: '#94a3b8',
      cardBgColorDark: '#212e3e',
      loginBoxColorDark: '#38bdf8',
      pageBgColorDark: '#1e293b',
      panelBgColorDark: '#2a3340',
      fontColorDark: '#e2e8f0',
      themeColorDark: '#2c9c9f',
      buttonFontColorDark: '#2f3e46',
      panelFontColorDark: '#ebebeb',
      loginInputColorDark: '#ffffff',
      tncLink: 'https://secure.buzzmint.io/partner-apps',
      termsCopyright: `<p>LoadTest ${suffix}</p>`,
      // adminProfilePicture / bgImage / emailLogo / favIcon / loginPageLogo /
      // sidebarNavigationLogo / welcomeImage are injected after the
      // files-upload calls return their S3 keys (see client-creation scenario).
    },
  };
}

/** A payload that is missing every required field -> expects 400s */
export function buildEmptyCustomerPayload() {
  return { customer: {}, domain: {}, themeSettings: {} };
}

/** A payload with an invalid enum + wrong types -> expects 400 validation error */
export function buildInvalidTypeCustomerPayload(vu, iter) {
  const suffix = uniqueSuffix(vu, iter);
  return {
    customer: {
      firstName: 12345, // wrong type (should be string)
      lastName: 'Invalid',
      country: 'Neverland',
      email: 'not-an-email', // invalid email format
      username: `bad_${suffix}`,
      portalType: 'not-a-real-portal-type', // invalid enum-ish value
    },
    domain: {
      portalName: `bad-${suffix}`,
      kind: 'NotAKind', // invalid enum value
    },
    themeSettings: {},
  };
}

/** Extremely long strings to probe field-length validation / DB column limits */
export function buildOversizedFieldsPayload(vu, iter) {
  const suffix = uniqueSuffix(vu, iter);
  const longString = 'A'.repeat(5000);
  return {
    customer: {
      firstName: longString,
      lastName: longString,
      country: 'Pakistan',
      email: `oversized.${suffix}@yopmail.com`,
      username: `oversized_${suffix}`,
      portalType: 'web3',
    },
    domain: {
      portalName: `oversized-${suffix}`.slice(0, 63), // subdomains still need to be resolvable
      kind: 'Nomos',
    },
    themeSettings: {
      termsCopyright: longString,
    },
  };
}

/** Basic SQL-injection / XSS probes in free-text fields (should be safely rejected or sanitized, never 500) */
export function buildInjectionPayload(vu, iter) {
  const suffix = uniqueSuffix(vu, iter);
  return {
    customer: {
      firstName: `<script>alert(1)</script>`,
      lastName: `' OR '1'='1`,
      country: 'Pakistan',
      email: `inject.${suffix}@yopmail.com`,
      username: `inject_${suffix}`,
      portalType: 'web3',
    },
    domain: {
      portalName: `inject-${suffix}`,
      kind: 'Nomos',
    },
    themeSettings: {
      termsCopyright: `"; DROP TABLE customers; --`,
    },
  };
}
