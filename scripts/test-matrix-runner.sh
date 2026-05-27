#!/usr/bin/env bash

is_long_suite() {
  case "$1" in
    apps-web-e2e|frontend-e2e|backend-pytest|integration-tests|automation-check) return 0 ;;
    *) return 1 ;;
  esac
}

maybe_wrap_long_suite_cmd() {
  local suite_name="$1"
  local suite_cmd="$2"
  if is_long_suite "$suite_name"; then
    printf '%q %q %q %q %q' "bash" "scripts/ci/with-heartbeat.sh" "$HEARTBEAT_INTERVAL_SEC" "$suite_name" "$suite_cmd"
    return
  fi
  echo "$suite_cmd"
}

register_suite_phase() {
  local suite_name="$1"
  local idx="$2"
  if is_long_suite "$suite_name"; then
    phase_long_indices+=("$idx")
  else
    phase_short_indices+=("$idx")
  fi
}

classify_failure_log() {
  local log_file="$1"
  if [[ ! -f "$log_file" ]]; then
    echo "unknown (missing-log)"
    return
  fi
  if grep -Eqi 'timed? out|timeout|ETIMEDOUT|ERR_TEST_TIMEOUT|TimeoutError|exceeded timeout' "$log_file"; then
    echo "network-or-timeout"
    return
  fi
  if grep -Eqi 'ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network error|socket hang up|TLS|fetch failed|connection reset' "$log_file"; then
    echo "network-or-timeout"
    return
  fi
  echo "logic-or-assertion"
}

print_failure_hint() {
  local suite_name="$1"
  local log_file="$2"
  local category
  category="$(classify_failure_log "$log_file")"
  echo "[hint] $suite_name failure category: $category (log: $log_file)"
  if [[ "$category" == "network-or-timeout" ]]; then
    echo "[hint] prioritize checking network reachability/retries/timeout budgets before code logic"
  else
    echo "[hint] prioritize checking assertion changes, fixtures, and behavior regressions"
  fi
}

run_serial_phase() {
  local -a phase_indices=("$@")
  local started_epoch
  local idx
  local name
  local cmd
  local log_file
  for idx in "${phase_indices[@]}"; do
    name="${suite_names[$idx]}"
    cmd="${suite_cmds[$idx]}"
    log_file="${suite_logs[$idx]}"
    started_epoch="$(date +%s)"
    echo "[run] $name"
    if bash -lc "$cmd" >"$log_file" 2>&1; then
      echo "[pass] $name (log: $log_file)"
      append_suite_duration "$name" "$started_epoch" "pass"
    else
      echo "[fail] $name (log: $log_file)"
      print_failure_hint "$name" "$log_file"
      append_suite_duration "$name" "$started_epoch" "fail"
      failed=1
      failed_name="${failed_name:-$name}"
      return 1
    fi
  done
}

run_parallel_phase() {
  local -a phase_indices=("$@")
  local pids=()
  local pgids=()
  local statuses=()
  local suite_idx_by_slot=()
  local start_epochs=()
  local can_isolate_process_group=0
  local isolate_with_python=0
  local remaining
  local idx
  local name
  local cmd
  local log_file
  local pid
  local pgid
  local progress

  if command -v setsid >/dev/null 2>&1; then
    can_isolate_process_group=1
  elif command -v python3 >/dev/null 2>&1; then
    can_isolate_process_group=1
    isolate_with_python=1
  fi

  is_pid_alive() {
    local check_pid="$1"
    kill -0 "$check_pid" >/dev/null 2>&1
  }

  is_pgid_alive() {
    local check_pgid="$1"
    [[ -n "$check_pgid" ]] || return 1
    kill -0 -- "-$check_pgid" >/dev/null 2>&1
  }

  kill_suite_group() {
    local sig="$1"
    local target_pid="$2"
    local target_pgid="$3"
    local slot="$4"
    local suite_index="${suite_idx_by_slot[$slot]}"
    local suite_name="${suite_names[$suite_index]}"
    if [[ -n "$target_pgid" ]]; then
      kill "-$sig" -- "-$target_pgid" >/dev/null 2>&1 || true
      echo "[$(echo "$sig" | tr '[:upper:]' '[:lower:]')] $suite_name (pid=$target_pid pgid=$target_pgid)"
      return
    fi
    kill "-$sig" "$target_pid" >/dev/null 2>&1 || true
    echo "[$(echo "$sig" | tr '[:upper:]' '[:lower:]')] $suite_name (pid=$target_pid)"
  }

  wait_suite_exit() {
    local target_pid="$1"
    local target_pgid="$2"
    local max_ticks="$3"
    local ticks=0
    while (( ticks < max_ticks )); do
      local pid_alive=1
      local pgid_alive=1
      if is_pid_alive "$target_pid"; then pid_alive=0; fi
      if is_pgid_alive "$target_pgid"; then pgid_alive=0; fi
      if (( pid_alive == 1 && pgid_alive == 1 )); then
        return 0
      fi
      sleep 0.1
      ticks=$((ticks + 1))
    done
    return 1
  }

  fail_fast_cleanup() {
    local slot
    local grace_ticks=$((FAILFAST_TERM_GRACE_SEC * 10))
    for slot in "${!pids[@]}"; do
      if [[ "${statuses[slot]}" != "running" ]]; then
        continue
      fi
      kill_suite_group "TERM" "${pids[$slot]}" "${pgids[$slot]}" "$slot"
      statuses[slot]="terminating"
    done

    for slot in "${!pids[@]}"; do
      if [[ "${statuses[slot]}" != "terminating" ]]; then
        continue
      fi
      if ! wait_suite_exit "${pids[$slot]}" "${pgids[$slot]}" "$grace_ticks"; then
        kill_suite_group "KILL" "${pids[$slot]}" "${pgids[$slot]}" "$slot"
      fi
      wait "${pids[$slot]}" >/dev/null 2>&1 || true
      statuses[slot]="stopped"
      remaining=$((remaining - 1))
      idx="${suite_idx_by_slot[$slot]}"
      append_suite_duration "${suite_names[$idx]}" "${start_epochs[$slot]}" "terminated"
      echo "[stop] ${suite_names[$idx]} (log: ${suite_logs[$idx]})"
    done
  }

  for idx in "${phase_indices[@]}"; do
    name="${suite_names[$idx]}"
    cmd="${suite_cmds[$idx]}"
    log_file="${suite_logs[$idx]}"
    echo "[spawn] $name"
    if [[ "$isolate_with_python" == "1" ]]; then
      python3 -c 'import os,sys; os.setsid(); os.execvp("bash", ["bash", "-lc", sys.argv[1]])' "$cmd" >"$log_file" 2>&1 &
    elif [[ "$can_isolate_process_group" == "1" ]]; then
      setsid bash -lc "$cmd" >"$log_file" 2>&1 &
    else
      bash -lc "$cmd" >"$log_file" 2>&1 &
    fi
    pid="$!"
    pids+=("$pid")
    if [[ "$can_isolate_process_group" == "1" ]]; then
      pgid="$pid"
    else
      pgid=""
    fi
    pgids+=("$pgid")
    statuses+=("running")
    suite_idx_by_slot+=("$idx")
    start_epochs+=("$(date +%s)")
  done

  remaining="${#pids[@]}"
  while [[ "$remaining" -gt 0 ]]; do
    progress=0
    for slot in "${!pids[@]}"; do
      if [[ "${statuses[slot]}" != "running" ]]; then
        continue
      fi
      pid="${pids[$slot]}"
      if is_pid_alive "$pid"; then
        continue
      fi

      progress=1
      remaining=$((remaining - 1))
      idx="${suite_idx_by_slot[$slot]}"
      name="${suite_names[$idx]}"
      log_file="${suite_logs[$idx]}"

      if wait "$pid"; then
        statuses[slot]="passed"
        echo "[pass] $name (log: $log_file)"
        append_suite_duration "$name" "${start_epochs[$slot]}" "pass"
      else
        statuses[slot]="failed"
        echo "[fail] $name (log: $log_file)"
        print_failure_hint "$name" "$log_file"
        append_suite_duration "$name" "${start_epochs[$slot]}" "fail"
        failed=1
        failed_name="${failed_name:-$name}"
      fi
    done

    if [[ "$failed" -ne 0 ]]; then
      fail_fast_cleanup
      return 1
    fi

    if [[ "$progress" -eq 0 ]]; then
      sleep 0.2
    fi
  done
}
