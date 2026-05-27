import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:8000";

export const options = {
  scenarios: {
    health_smoke: {
      executor: "constant-vus",
      vus: 3,
      duration: "8s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function () {
  const health = http.get(`${baseUrl}/health/`, {
    headers: { Accept: "application/json" },
    tags: { endpoint: "health-smoke" },
  });
  check(health, {
    "health status 200": (response) => response.status === 200,
  });
  sleep(0.2);
}
