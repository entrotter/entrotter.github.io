import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", ".venv/**", "output/**", ".quality/**"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },

    rules: {
      ...js.configs.recommended.rules,
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["app.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  { files: ["**/*.mjs"], languageOptions: { globals: globals.node } },
  {
    files: ["scripts/check_accessibility.mjs"],
    languageOptions: { globals: { ...globals.browser, axe: "readonly" } },
  },
];
