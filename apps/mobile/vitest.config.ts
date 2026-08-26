import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors compilerOptions.paths in tsconfig.json — vitest resolves modules
    // itself and does not read them. "@/" is last: vite takes the first
    // matching prefix, so it must not shadow "@lib/" and friends.
    alias: [
      { find: /^@app\//, replacement: dir("./app/") },
      { find: /^@features\//, replacement: dir("./features/") },
      { find: /^@components\//, replacement: dir("./components/") },
      { find: /^@hooks\//, replacement: dir("./hooks/") },
      { find: /^@lib\//, replacement: dir("./lib/") },
      { find: /^@services\//, replacement: dir("./services/") },
      { find: /^@store\//, replacement: dir("./store/") },
      { find: /^@constants\//, replacement: dir("./constants/") },
      { find: /^@theme\//, replacement: dir("./theme/") },
      { find: /^@assets\//, replacement: dir("./assets/") },
      { find: /^@\//, replacement: dir("./") },
    ],
  },
  test: {
    globals: true,
    include: ["__tests__/**/*.test.{ts,tsx}"],
  },
});
