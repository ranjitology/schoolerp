import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const SLUG = __ENV.SCHOOL_SLUG || 'green-valley';
const EMAIL = __ENV.EMAIL || 'admin@greenvalley.edu.np';
const PASSWORD = __ENV.PASSWORD || 'SchoolAdmin#2026';

export default function () {
  const login = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ schoolSlug: SLUG, email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  check(login, { 'login 200': (r) => r.status === 200 });
  const token = login.json('data.accessToken');
  if (!token) {
    sleep(1);
    return;
  }
  const auth = { headers: { Authorization: `Bearer ${token}` }, tags: { name: 'dashboard' } };
  const dashboard = http.get(`${BASE}/dashboard`, auth);
  check(dashboard, { 'dashboard 200': (r) => r.status === 200 });
  sleep(1);
}
