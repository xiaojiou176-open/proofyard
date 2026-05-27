#!/usr/bin/env python3
import os
import random
import time
import urllib.error
import urllib.request


def _float_env(
    primary: str,
    fallback: str,
    default: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    value = os.environ.get(primary) or os.environ.get(fallback, default)
    try:
        parsed = float(value)
    except ValueError as exc:
        raise SystemExit(f"{primary} must be a float, got: {value!r}") from exc
    if minimum is not None and parsed < minimum:
        raise SystemExit(f"{primary} must be >= {minimum}, got: {parsed}")
    if maximum is not None and parsed > maximum:
        raise SystemExit(f"{primary} must be <= {maximum}, got: {parsed}")
    return parsed


host = os.environ["INPUT_HOST"]
port = os.environ["INPUT_PORT"]
configured_health_url = os.environ.get("INPUT_HEALTH_URL", "").strip()
url = configured_health_url or f"http://{host}:{port}/health/"

timeout_sec = _float_env("INPUT_READY_TIMEOUT_SEC", "UIQ_READY_TIMEOUT_SEC", "20", minimum=0.1)
initial_delay_sec = _float_env(
    "INPUT_READY_INITIAL_DELAY_SEC", "UIQ_READY_INITIAL_DELAY_SEC", "0.25", minimum=0.0
)
max_delay_sec = _float_env("INPUT_READY_MAX_DELAY_SEC", "UIQ_READY_MAX_DELAY_SEC", "2", minimum=0.0)
jitter_ratio = _float_env(
    "INPUT_READY_JITTER_RATIO", "UIQ_READY_JITTER_RATIO", "0.2", minimum=0.0, maximum=1.0
)
if max_delay_sec < initial_delay_sec:
    raise SystemExit(
        "INPUT_READY_MAX_DELAY_SEC must be >= INPUT_READY_INITIAL_DELAY_SEC "
        f"(got {max_delay_sec} < {initial_delay_sec})"
    )

deadline = time.monotonic() + timeout_sec
attempt = 0
last_error = "none"

while True:
    try:
        request_timeout = max(0.2, min(deadline - time.monotonic(), 1.5))
        with urllib.request.urlopen(url, timeout=request_timeout) as response:
            if response.status < 400:
                print(f"backend ready: {url}")
                break
        last_error = f"http_status={response.status}"
    except urllib.error.HTTPError as exc:
        last_error = f"http_error={exc.code}"
    except urllib.error.URLError as exc:
        last_error = f"url_error={exc.reason}"
    except TimeoutError:
        last_error = "timeout_error"

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SystemExit(
            f"backend did not become ready at {url} within {timeout_sec}s "
            f"(attempts={attempt + 1}, last_error={last_error})"
        )

    attempt += 1
    delay = min(initial_delay_sec * (2 ** (attempt - 1)), max_delay_sec)
    jitter_low = max(0.0, delay * (1.0 - jitter_ratio))
    jitter_high = delay * (1.0 + jitter_ratio)
    sleep_for = min(random.uniform(jitter_low, jitter_high), remaining)
    time.sleep(sleep_for)
