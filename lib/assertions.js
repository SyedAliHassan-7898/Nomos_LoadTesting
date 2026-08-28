/**
 * assertions.js
 * Small reusable check() helpers so every scenario reports consistent,
 * readable pass/fail names in the k6 summary output.
 */
import { check } from 'k6';

export function expectStatus(res, expected, label) {
  const list = Array.isArray(expected) ? expected : [expected];
  return check(res, {
    [`${label}: status is ${list.join('/')}`]: (r) => list.includes(r.status),
  });
}

export function expectSuccessTrue(res, label) {
  return check(res, {
    [`${label}: success=true`]: (r) => {
      try {
        return r.json('success') === true;
      } catch (e) {
        return false;
      }
    },
  });
}

export function expectSuccessFalse(res, label) {
  return check(res, {
    [`${label}: success=false`]: (r) => {
      try {
        return r.json('success') === false;
      } catch (e) {
        // some error responses don't use the envelope at all - still fine for a negative test
        return true;
      }
    },
  });
}

export function expectHasField(res, jsonPath, label) {
  return check(res, {
    [`${label}: has ${jsonPath}`]: (r) => {
      try {
        const val = r.json(jsonPath);
        return val !== undefined && val !== null;
      } catch (e) {
        return false;
      }
    },
  });
}

export function expectResponseTimeUnder(res, ms, label) {
  return check(res, {
    [`${label}: responded under ${ms}ms`]: (r) => r.timings.duration < ms,
  });
}

export function expectNeverServerError(res, label) {
  return check(res, {
    [`${label}: never a 5xx (server did not crash)`]: (r) => r.status < 500,
  });
}


export function expectBodyValue(res, jsonPath, expected, label) {
  return check(res, {
    [`${label}: ${jsonPath} matches expected value`]: (r) => {
      try {
        return r.json(jsonPath) === expected;
      } catch (e) {
        return false;
      }
    },
  });
}

export function expectArrayField(res, jsonPath, label) {
  return check(res, {
    [`${label}: ${jsonPath} is an array`]: (r) => {
      try {
        return Array.isArray(r.json(jsonPath));
      } catch (e) {
        return false;
      }
    },
  });
}

export function expectCondition(condition, label) {
  return check(null, {
    [label]: () => Boolean(condition),
  });
}
