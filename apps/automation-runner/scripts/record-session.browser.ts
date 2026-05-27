import { createInterface } from "node:readline/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Page } from "playwright"
import type { MidsceneDriverModule, MidsceneTakeoverContext } from "./record-session.shared.js"

export function buildAutomationRecorderInitScript(captureInputPlaintext: boolean): string {
  return `
    (() => {
      const capturePlaintextInput = ${captureInputPlaintext ? "true" : "false"};
      const recorder = { events: [] };
      const toCssPath = (el) => {
        if (!(el instanceof Element)) return "unknown";
        const segments = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 6) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector += "#" + current.id;
            segments.unshift(selector);
            break;
          }
          const className = String(current.className || "").trim();
          if (className) {
            selector += "." + className.split(/\\s+/).slice(0, 2).join(".");
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
            if (siblings.length > 1) {
              selector += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
            }
          }
          segments.unshift(selector);
          current = parent;
        }
        return segments.join(" > ");
      };
      const targetMeta = (target) => {
        const element = target instanceof Element ? target : null;
        if (!element) {
          return {
            tag: "unknown",
            id: null,
            name: null,
            type: null,
            role: null,
            text: null,
            classes: [],
            cssPath: "unknown"
          };
        }
        const textContent = (element.textContent || "").trim();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          name: element.getAttribute("name"),
          type: element.getAttribute("type"),
          role: element.getAttribute("role"),
          text: textContent ? textContent.slice(0, 120) : null,
          classes: Array.from(element.classList).slice(0, 5),
          cssPath: toCssPath(element),
        };
      };
      const push = (type, event, extra = {}) => {
        recorder.events.push({
          ts: new Date().toISOString(),
          type,
          url: window.location.href,
          target: targetMeta(event.target),
          ...extra,
        });
      };
      document.addEventListener("click", (event) => push("click", event), true);
      document.addEventListener("input", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          push("type", event, { value: capturePlaintextInput ? target.value.slice(0, 256) : "__redacted__" });
        }
      }, true);
      document.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
          push("change", event, { value: capturePlaintextInput ? String(target.value).slice(0, 256) : "__redacted__" });
        }
      }, true);
      document.addEventListener("submit", (event) => push("submit", event), true);
      document.addEventListener("keydown", (event) => push("keydown", event, { key: event.key }), true);
      window.addEventListener("beforeunload", () => {
        recorder.events.push({
          ts: new Date().toISOString(),
          type: "navigate",
          url: window.location.href,
          target: {
            tag: "window",
            id: null,
            name: null,
            type: null,
            role: null,
            text: null,
            classes: [],
            cssPath: "window"
          },
        });
      });
      window.__automationRecorder = recorder;
    })();
  `
}

export async function waitForManualConfirmation(
  page: Page,
  successSelector: string
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const selectorLabel = successSelector.trim() ? successSelector : "(skip success selector check)"
    process.stdout.write(
      [
        "[manual] Browser opened for hand recording.",
        "[manual] Please complete the flow manually in the opened browser window.",
        `[manual] Success selector: ${selectorLabel}`,
        "[manual] Press Enter here after you complete your flow.",
      ].join("\n") + "\n"
    )
    await rl.question("")
  } finally {
    rl.close()
  }

  if (successSelector.trim()) {
    await page.waitForSelector(successSelector, { timeout: 30_000 })
  }
}

export async function runMidsceneTakeover(
  page: Page,
  context: Omit<MidsceneTakeoverContext, "page">,
  driverPath: string
): Promise<void> {
  const moduleUrl = pathToFileURL(driverPath).href
  const loaded = (await import(moduleUrl)) as Partial<MidsceneDriverModule>
  if (typeof loaded.runMidsceneTakeover !== "function") {
    throw new Error(`midscene driver must export async runMidsceneTakeover(): ${driverPath}`)
  }

  await loaded.runMidsceneTakeover({
    page,
    ...context,
  })
}

export function isExecutedAsScript(currentModuleUrl: string = import.meta.url): boolean {
  for (const arg of process.argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue
    try {
      if (pathToFileURL(path.resolve(arg)).href === currentModuleUrl) {
        return true
      }
    } catch {
      continue
    }
  }
  return false
}
