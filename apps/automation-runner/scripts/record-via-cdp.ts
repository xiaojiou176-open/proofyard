/**
 * Record user actions by connecting to an existing Chrome instance via CDP.
 * This approach leaves NO automation fingerprints - the browser is started normally by the user.
 * We only LISTEN to events, never control the browser.
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { chromium } from "playwright"

type CapturedEvent = {
  ts: string
  type: "navigate" | "click" | "input" | "change" | "submit" | "keydown"
  url: string
  target: {
    tag: string
    id: string | null
    name: string | null
    type: string | null
    text: string | null
    selector: string
  }
  value?: string
  key?: string
}

function envEnabled(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

function eventLooksSensitive(event: CapturedEvent): boolean {
  const blob =
    `${event.target.name ?? ""} ${event.target.type ?? ""} ${event.target.id ?? ""} ${event.target.selector ?? ""}`.toLowerCase()
  return /(password|passwd|secret|token|otp|verification|auth|code|cvc|cvv|card|cc-|exp|postal|zip)/i.test(
    blob
  )
}

function redactEventsForPersist(
  events: CapturedEvent[],
  allowSensitiveInputValues: boolean
): CapturedEvent[] {
  return events.map((event) => {
    const sensitive = eventLooksSensitive(event)
    return {
      ...event,
      target: {
        ...event.target,
        text: sensitive ? "__redacted__" : event.target.text,
      },
      value:
        event.value === undefined
          ? undefined
          : allowSensitiveInputValues && !sensitive
            ? event.value
            : "__redacted__",
    }
  })
}

function createSessionId(): string {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function parseUrlOrThrow(raw: string, allowedProtocols: readonly string[], label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid ${label}: ${raw}`)
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `Invalid ${label} protocol: ${parsed.protocol}. Expected one of ${allowedProtocols.join(", ")}`
    )
  }
  return parsed
}

async function main(): Promise<void> {
  // Auto-discover the WebSocket URL from Chrome's DevTools endpoint
  const cdpHttpUrl = process.env.CDP_HTTP_URL ?? "http://localhost:9222"
  const cdpHttpEndpoint = parseUrlOrThrow(cdpHttpUrl, ["http:", "https:"], "CDP_HTTP_URL")
  let cdpUrl = process.env.CDP_URL

  if (!cdpUrl) {
    const discoverTimeoutMs = Math.max(1_000, Number(process.env.CDP_DISCOVERY_TIMEOUT_MS ?? "5000"))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), discoverTimeoutMs)
    try {
      const resp = await fetch(new URL("/json/version", cdpHttpEndpoint), { signal: controller.signal })
      if (!resp.ok) {
        throw new Error(`CDP discovery endpoint returned HTTP ${resp.status}`)
      }
      const info = (await resp.json()) as { webSocketDebuggerUrl?: string }
      cdpUrl = info.webSocketDebuggerUrl ?? cdpHttpUrl
      console.log(`[cdp-record] Discovered WebSocket URL: ${cdpUrl}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[cdp-record] CDP discovery failed (${reason}), falling back to ${cdpHttpUrl}`)
      cdpUrl = cdpHttpUrl
    } finally {
      clearTimeout(timeout)
    }
  }
  parseUrlOrThrow(cdpUrl, ["ws:", "wss:", "http:", "https:"], "CDP_URL")
  const runtimeRoot =
    process.env.RUNTIME_ROOT ?? path.resolve(process.cwd(), "../../.runtime-cache/automation")
  const allowSensitiveCapture = envEnabled("FLOW_ALLOW_SENSITIVE_CAPTURE")
  const allowSensitiveInputValues =
    allowSensitiveCapture && envEnabled("FLOW_ALLOW_SENSITIVE_INPUT_VALUES")
  const sessionId = process.env.SESSION_ID ?? createSessionId()
  const sessionDir = path.join(runtimeRoot, sessionId)
  const eventsPath = path.join(sessionDir, "events.json")
  const metaPath = path.join(sessionDir, "session-meta.json")

  await mkdir(sessionDir, { recursive: true })

  console.log(`[cdp-record] Connecting to Chrome at ${cdpUrl}...`)

  let browser
  try {
    browser = await chromium.connectOverCDP(cdpUrl)
  } catch {
    console.error(
      `[cdp-record] Failed to connect. Make sure Chrome is running with --remote-debugging-port=9222`
    )
    console.error(`[cdp-record] Start Chrome with:`)
    console.error(
      `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --incognito`
    )
    process.exit(1)
  }

  console.log("[cdp-record] Connected")

  const contexts = browser.contexts()
  if (contexts.length === 0) {
    console.error(`[cdp-record] No browser contexts found. Open a tab first.`)
    process.exit(1)
  }

  const context = contexts[0]
  const pages = context.pages()
  if (pages.length === 0) {
    console.error(`[cdp-record] No pages found. Open a tab first.`)
    process.exit(1)
  }

  const page = pages[0]
  const events: CapturedEvent[] = []

  console.log("[cdp-record] Recording page attached")
  console.log(`[cdp-record] Perform your actions in Chrome. Press Enter here when done.\n`)

  // Inject event listener script using addInitScript to avoid tsx mangling
  const injectionScript = `(function() {
    if (window.__cdpRecorder) return;

    var recorder = { events: [] };

    function getSelector(el) {
      if (el.id) return '#' + el.id;
      if (el.getAttribute && el.getAttribute('name')) return '[name="' + el.getAttribute('name') + '"]';
      if (el.getAttribute && el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';

      var tag = el.tagName.toLowerCase();
      var text = (el.textContent || '').trim().slice(0, 30);
      if (text && ['button', 'a', 'label'].indexOf(tag) >= 0) {
        return tag + ':has-text("' + text.replace(/"/g, '\\\\"') + '")';
      }

      var segments = [];
      var current = el;
      while (current && current !== document.body) {
        var selector = current.tagName.toLowerCase();
        if (current.id) {
          segments.unshift('#' + current.id);
          break;
        }
        var parent = current.parentElement;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
          if (siblings.length > 1) {
            selector += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
          }
        }
        segments.unshift(selector);
        current = parent;
      }
      return segments.join(' > ');
    }

    function targetMeta(target) {
      var el = target instanceof Element ? target : null;
      if (!el) return { tag: 'unknown', id: null, name: null, type: null, text: null, selector: 'unknown' };
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute ? el.getAttribute('name') : null,
        type: el.getAttribute ? el.getAttribute('type') : null,
        text: (el.textContent || '').trim().slice(0, 100) || null,
        selector: getSelector(el),
      };
    }

    function pushEvent(type, event, extra) {
      var data = {
        ts: new Date().toISOString(),
        type: type,
        url: window.location.href,
        target: targetMeta(event.target),
      };
      if (extra) {
        for (var k in extra) data[k] = extra[k];
      }
      recorder.events.push(data);
    }

    document.addEventListener('click', function(e) { pushEvent('click', e); }, true);
    document.addEventListener('input', function(e) {
      var target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        pushEvent('input', e, { value: ${allowSensitiveInputValues ? "target.value.slice(0, 256)" : "'__redacted__'"} });
      }
    }, true);
    document.addEventListener('change', function(e) {
      var target = e.target;
      pushEvent('change', e, { value: ${allowSensitiveInputValues ? "String(target.value).slice(0, 256)" : "'__redacted__'"} });
    }, true);
    document.addEventListener('submit', function(e) { pushEvent('submit', e); }, true);
    document.addEventListener('keydown', function(e) {
      if (['Enter', 'Tab', 'Escape'].indexOf(e.key) >= 0) {
        pushEvent('keydown', e, { key: e.key });
      }
    }, true);

    window.__cdpRecorder = recorder;
  })();`

  await page.evaluate(injectionScript)

  // Also inject on navigation
  page.on("load", async () => {
    console.log(`[cdp-record] Page navigated to: ${page.url()}`)
    try {
      await page.evaluate(injectionScript)
    } catch {
      // Page might be navigating, ignore
    }
  })

  // Record navigation events
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      events.push({
        ts: new Date().toISOString(),
        type: "navigate",
        url: frame.url(),
        target: { tag: "window", id: null, name: null, type: null, text: null, selector: "window" },
      })
    }
  })

  // Wait for user to finish
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  await rl.question("")
  rl.close()

  // Collect events from page
  try {
    const pageEvents = await page.evaluate(
      `window.__cdpRecorder ? window.__cdpRecorder.events : []`
    )
    if (Array.isArray(pageEvents)) {
      events.push(...pageEvents)
    }
  } catch {
    console.log(`[cdp-record] Could not collect events from page (might have navigated away)`)
  }

  const persistedEvents = redactEventsForPersist(events, allowSensitiveInputValues)

  // Save results
  const metadata = {
    sessionId,
    mode: "cdp-passive",
    startUrl: page.url(),
    eventCount: persistedEvents.length,
    capturePolicy: {
      allowSensitiveCapture,
      allowSensitiveInputValues,
    },
    outputDir: sessionDir,
    createdAt: new Date().toISOString(),
  }

  await writeFile(eventsPath, JSON.stringify(persistedEvents, null, 2), "utf-8")
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8")

  console.log(`\n[cdp-record] Recording complete!`)
  console.log(`[cdp-record] Captured ${events.length} events`)
  console.log("[cdp-record] Session artifacts written")
  console.log("[cdp-record] - events.json")
  console.log("[cdp-record] - session-meta.json")

  // Don't close the browser - user might still be using it
  // Just disconnect
  browser.close()
}

main().catch((err) => {
  console.error("record-via-cdp failed:", err.message)
  process.exit(1)
})
