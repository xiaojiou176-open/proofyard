import js from "@eslint/js"
import jestPlugin from "eslint-plugin-jest"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".cache", ".cache/**", "**/.cache/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}"],
    plugins: {
      jest: jestPlugin,
    },
    rules: {
      "jest/expect-expect": "error",
      "jest/no-conditional-expect": "error",
      "jest/valid-expect-in-promise": "error",
      "jest/no-commented-out-tests": "error",
      "jest/no-disabled-tests": "error",
      "jest/no-focused-tests": "error",
      "jest/no-identical-title": "error",
      "jest/valid-title": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(IfStatement, ConditionalExpression, LogicalExpression, SwitchCase) CallExpression[callee.name='expect']",
          message:
            "Do not place expect() behind conditionals; assertions must execute deterministically.",
        },
        {
          selector:
            "CallExpression[callee.name=/^(it|test)$/] > :matches(FunctionExpression, ArrowFunctionExpression):not(:has(CallExpression[callee.name='expect'])):not(:has(CallExpression[callee.object.name='expect'][callee.property.name='hasAssertions'])):not(:has(CallExpression[callee.object.name='expect'][callee.property.name='assertions']))",
          message:
            "Each test block must contain at least one assertion or explicit expect.hasAssertions()/expect.assertions().",
        },
        {
          selector: "CallExpression[callee.property.name='toBeDefined']",
          message:
            "toBeDefined() is disallowed by default. Use precise assertions. If truly required, add an explicit eslint-disable with rationale.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual)$/][callee.object.callee.name='expect'][callee.object.arguments.0.value=true][arguments.0.value=true]",
          message: "Trivial assertion detected: expect(true).toX(true).",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual)$/][callee.object.callee.name='expect'][callee.object.arguments.0.value=false][arguments.0.value=false]",
          message: "Trivial assertion detected: expect(false).toX(false).",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual)$/][callee.object.callee.name='expect'][callee.object.arguments.0.value=null][arguments.0.value=null]",
          message: "Trivial assertion detected: expect(null).toX(null).",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual)$/][callee.object.callee.name='expect'][callee.object.arguments.0.type='Identifier'][callee.object.arguments.0.name='undefined'][arguments.0.type='Identifier'][arguments.0.name='undefined']",
          message: "Trivial assertion detected: expect(undefined).toX(undefined).",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  }
)
