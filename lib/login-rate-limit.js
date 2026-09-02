import { sleep } from 'k6';

// Nomos applies the login limit to the request identity (user/IP/device).
// Keep one limiter shared by Super Admin and Client Admin login flows.
const MAX_LOGIN_REQUESTS = 5;
const LOGIN_WINDOW_SECONDS = 60;
let windowStartedAt = 0;
let requestsInWindow = 0;

export function waitForLoginRateLimit(label = 'login') {
  const now = Date.now() / 1000;
  if (!windowStartedAt || now - windowStartedAt >= LOGIN_WINDOW_SECONDS) {
    windowStartedAt = now;
    requestsInWindow = 0;
  }

  if (requestsInWindow >= MAX_LOGIN_REQUESTS) {
    const elapsed = now - windowStartedAt;
    const waitSeconds = Math.max(1, LOGIN_WINDOW_SECONDS - elapsed + 1);
    console.log(`[${label}] Login rate limit reached (${MAX_LOGIN_REQUESTS}/${LOGIN_WINDOW_SECONDS}s). Waiting ${Math.ceil(waitSeconds)}s...`);
    sleep(waitSeconds);
    windowStartedAt = Date.now() / 1000;
    requestsInWindow = 0;
  }

  requestsInWindow += 1;
}
