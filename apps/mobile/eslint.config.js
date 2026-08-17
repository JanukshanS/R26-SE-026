// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Deno runtime code (Supabase Edge Functions) — separate toolchain, uses `Deno`
    // globals and `npm:`/`jsr:` specifiers this project's ESLint/TS setup doesn't know.
    ignores: ['dist/*', 'supabase/functions/**'],
  },
]);
