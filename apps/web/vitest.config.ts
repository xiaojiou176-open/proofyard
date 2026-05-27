import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(__dirname, "../../node_modules/react"),
      "react-dom": resolve(__dirname, "../../node_modules/react-dom"),
      "react/jsx-runtime": resolve(__dirname, "../../node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": resolve(__dirname, "../../node_modules/react/jsx-dev-runtime.js"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**"],
    forbidOnly: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./.runtime-cache/coverage/apps-web-unit",
      all: true,
      include: ["src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
      exclude: [
        "src/api-gen/**",
        "src/**/*.d.ts",
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/__tests__/**",
        "src/**/__mocks__/**",
        "src/**/mocks/**",
        "src/**/test-utils/**",
        "src/testing/**",
        "src/features/command-center/types.ts",
        "../../packages/ui/src/**/*.d.ts",
        "../../packages/ui/src/**/*.{test,spec}.{ts,tsx}",
      ],
      thresholds: {
        lines: 95,
        branches: 95,
      },
    },
  },
})
