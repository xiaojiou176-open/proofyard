# Computer Use - Gemini Only

This directory standardizes on the **google-genai SDK** for Gemini Computer Use.
It no longer depends on OpenAI or LangChain wrappers.

## Current implementation

| Item | Value |
|------|-------|
| **Provider** | Google Gemini |
| **Default model** | `models/gemini-3.1-pro-preview` |
| **Primary entrypoint** | `gemini-computer-use.py` |
| **API method** | `client.models.generate_content()` |
| **Required environment variable** | `GEMINI_API_KEY` |

## Install

```bash
cd scripts/computer-use
pip install -r requirements.txt
```

## Environment variables

- `GEMINI_API_KEY`
- `GEMINI_MODEL_PRIMARY` (default: `models/gemini-3.1-pro-preview`)
- `COMPUTER_USE_TASK` (optional custom task prompt)

## Usage

```bash
export GEMINI_API_KEY="xxx"
export GEMINI_MODEL_PRIMARY="models/gemini-3.1-pro-preview"   # optional
export GEMINI_THINKING_LEVEL="high"                           # optional
# High-risk action confirmation gate (delete/pay/send/purchase/submit are denied by default)
export COMPUTER_USE_CONFIRM_HIGH_RISK="true"
python3 gemini-computer-use.py "Analyze the current screen, find the sign-in button, and click it"
```

### High-risk action confirmation gate

- At runtime, the tool checks whether the action name contains `delete/pay/send/purchase/submit`.
- Those actions are blocked by default and return an observable denial result.
- They are allowed only when `COMPUTER_USE_CONFIRM_HIGH_RISK=true` is explicitly set.

## How it works

```text
┌─────────────────────────────────────────────────────┐
│                  Your desktop screen                │
│                                                     │
│   ┌─────────────────────────────────────────────┐   │
│   │      Chrome (a normal user browser)         │   │
│   │                                             │   │
│   │   ┌─────────────────────────────────────┐   │   │
│   │   │       Stripe payment page           │   │   │
│   │   │                                     │   │   │
│   │   │   Looks like a real user session    │   │   │
│   │   │                                     │   │   │
│   │   └─────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│   PyAutoGUI controls mouse and keyboard at the OS   │
│   level                                             │
│   ↑                                                 │
│   AI inspects screenshots and decides the next step │
└─────────────────────────────────────────────────────┘
```

**Why it is harder to detect**

1. **No WebDriver** - it is not Playwright/Selenium
2. **No CDP connection** - it is not using the DevTools Protocol
3. **Real mouse movement** - PyAutoGUI emits OS-level events
4. **Real keyboard input** - every keystroke is sent as a real event
5. **No automation markers** - the browser launches like a normal session

## Safety notes

- **Emergency stop**: move the mouse to the top-left corner of the screen
- Do not move or resize the target window while the script is running
- Make sure the target window is visible and in the foreground
