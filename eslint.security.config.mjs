import security from "eslint-plugin-security";

export default [
  { ignores: ["node_modules/**", "output/**", ".quality/**"] },
  security.configs.recommended,
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },
];
