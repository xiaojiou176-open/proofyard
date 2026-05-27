import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:8000";

export const options = {
  scenarios: {
    health_ramp: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "30s", target: 25 },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1200", "p(99)<2000"],
  },
};

export default function () {
  const health = http.get(`${baseUrl}/health/`, {
    headers: {
      Accept: "application/json",
    },
    tags: { endpoint: "health" },
  });
  check(health, {
    "health status 200": (response) => response.status === 200,
  });

  sleep(0.4);
}
