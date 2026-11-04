import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Morning-peak attendance burst.
 *
 * Target from the brief: 500 concurrent users, bulk attendance under 2s.
 *
 * Requires a seeded class/section and its student ids:
 *   CLASS_ID=... SECTION_ID=... STUDENT_IDS=uuid,uuid,... \
 *   k6 run -e BASE_URL=http://localhost:4000/api/v1 tests/load/attendance-burst.js
 */
const bulkLatency = new Trend('bulk_attendance_latency', true);

export const options = {
  scenarios: {
    morning_peak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },
        { duration: '3m', target: 500 },
        { duration: '5m', target: 500 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    'http_req_duration{name:bulk_attendance}': ['p(95)<2000'],
    bulk_attendance_latency: ['p(95)<2000'],
    checks: ['rate>0.995'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const SLUG = __ENV.SCHOOL_SLUG || 'green-valley';
const EMAIL = __ENV.EMAIL || 'teacher@greenvalley.edu.np';
const PASSWORD = __ENV.PASSWORD || 'Teacher#2026';

export function setup() {
  const classId = __ENV.CLASS_ID;
  const sectionId = __ENV.SECTION_ID;
  const studentIds = (__ENV.STUDENT_IDS ?? '').split(',').filter(Boolean);
  if (!classId || !sectionId || studentIds.length === 0) {
    fail('CLASS_ID, SECTION_ID and STUDENT_IDS are required (see the script header).');
  }

  const login = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ schoolSlug: SLUG, email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(login, { 'teacher login 200': (r) => r.status === 200 });
  const token = login.json('data.accessToken');
  if (!token) fail('Teacher login failed; check the seeded credentials.');

  return { token, classId, sectionId, studentIds };
}

export default function (data) {
  const today = new Date().toISOString().slice(0, 10);
  const records = data.studentIds.map((studentId) => ({
    studentId,
    status: Math.random() < 0.92 ? 'PRESENT' : 'ABSENT',
  }));

  const response = http.post(
    `${BASE}/attendance/bulk`,
    JSON.stringify({
      date: today,
      classId: data.classId,
      sectionId: data.sectionId,
      period: 0,
      records,
      idempotencyKey: `k6-${__VU}-${__ITER}`,
      clientTimestamp: new Date().toISOString(),
    }),
    {
      headers: {
        Authorization: `Bearer ${data.token}`,
        'Content-Type': 'application/json',
      },
      tags: { name: 'bulk_attendance' },
    },
  );
  bulkLatency.add(response.timings.duration);
  check(response, { 'bulk attendance accepted': (r) => r.status === 200 || r.status === 201 });
}
