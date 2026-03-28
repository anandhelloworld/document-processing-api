/**
 * k6 load test for doc-processing-api
 *
 * Prerequisites:
 *   - API running (e.g. npm run start:dev) with DB, Redis, S3 reachable
 *   - Throttling: AppModule uses ThrottlerGuard (default ~10 req / 60s per IP).
 *     For meaningful load, raise THROTTLE_LIMIT (and optionally THROTTLE_TTL_MS) in .env
 *     while testing, or you will see HTTP 429.
 *
 * Run:
 *   k6 run k6/doc-processing-load.js
 *   BASE_URL=http://localhost:3000 k6 run k6/doc-processing-load.js
 *   BASE_URL=https://api.example.com FILE_URL=https://example.com/small.pdf k6 run k6/doc-processing-load.js
 *
 * Env:
 *   BASE_URL     - API origin (default http://localhost:3000)
 *   FILE_URL     - Public URL used for POST /api/jobs/submit (default: small W3C dummy PDF)
 *   SEED_JOBS    - Jobs created in setup() for GET /api/jobs/:id (default 3)
 *   VUS / DURATION - override via CLI: k6 run --vus 20 --duration 2m k6/doc-processing-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errors = new Rate('errors');

export const options = {
  // Override with: k6 run --vus N --duration T
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.3'],
    http_req_duration: ['p(95)<5000'],
    errors: ['rate<0.25'],
  },
};

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FILE_URL =
  __ENV.FILE_URL ||
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
const SEED_JOBS = Math.max(0, parseInt(__ENV.SEED_JOBS || '3', 10) || 0);

const jsonHeaders = { 'Content-Type': 'application/json' };

export function setup() {
  const jobIds = [];
  for (let i = 0; i < SEED_JOBS; i++) {
    const res = http.post(
      `${BASE_URL}/api/jobs/submit`,
      JSON.stringify({ fileUrl: FILE_URL }),
      { headers: jsonHeaders, tags: { name: 'POST_submit_seed' } },
    );
    if (res.status !== 200 && res.status !== 201) {
      continue;
    }
    try {
      const body = JSON.parse(res.body);
      if (body.jobId) {
        jobIds.push(body.jobId);
      }
    } catch {
      // ignore parse errors
    }
  }
  return { jobIds };
}

export default function (data) {
  const jobIds = data.jobIds || [];
  const r = Math.random();

  if (r < 0.2) {
    const res = http.get(`${BASE_URL}/`, { tags: { name: 'GET_' } });
    const ok = check(res, { 'GET / status 200': (x) => x.status === 200 });
    if (!ok) {
      errors.add(1);
    }
  } else if (r < 0.65) {
    const res = http.get(`${BASE_URL}/api/jobs`, { tags: { name: 'GET_api_jobs' } });
    const ok = check(res, { 'GET /api/jobs status 200': (x) => x.status === 200 });
    if (!ok) {
      errors.add(1);
    }
  } else if (jobIds.length > 0 && r < 0.9) {
    const id = jobIds[Math.floor(Math.random() * jobIds.length)];
    const res = http.get(`${BASE_URL}/api/jobs/${id}`, {
      tags: { name: 'GET_api_jobs_id' },
    });
    const ok = check(res, { 'GET job status 200': (x) => x.status === 200 });
    if (!ok) {
      errors.add(1);
    }
  } else {
    const res = http.post(
      `${BASE_URL}/api/jobs/submit`,
      JSON.stringify({ fileUrl: FILE_URL }),
      { headers: jsonHeaders, tags: { name: 'POST_submit' } },
    );
    const ok = check(res, {
      'POST submit accepted': (x) => x.status === 200 || x.status === 201,
    });
    if (!ok) {
      errors.add(1);
    }
  }

  sleep(0.5 + Math.random() * 1.5);
}
