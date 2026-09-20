import security from "eslint-plugin-security";

export default [
  { ignores: ["node_modules/**", ".venv/**", "output/**", ".quality/**"] },
  security.configs.recommended,
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },
];
