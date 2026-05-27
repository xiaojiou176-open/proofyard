# CLI Guide

The canonical public mainline is `just run`.

If you want the direct command behind that wrapper, use:

```bash
pnpm uiq run --profile pr --target web.local
```

`just run-legacy` is a manual workshop path for lower-level troubleshooting.
It is not the canonical public mainline.

`just run-legacy` should only be used when you need to inspect helper-path
behavior that is lower level than the default storefront path.

Internal automation surfaces that expose `run` should resolve to the same orchestrator-first path rather than helper-path commands.

Use the CLI surfaces in this order:

1. `just setup`
2. `just run`
3. `pnpm uiq run --profile pr --target web.local`
4. `just run-legacy` only when you are intentionally debugging the manual workshop path
