import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  test: { environment: "node", globals: true, include: ["tests/**/*.test.ts", "src/**/*.test.ts"], testTimeout: 15000 },
  resolve: {
    alias: {
      "@contracts/geo-service-mapping": path.resolve(__dirname, "../../contracts/geo-service-mapping.ts"),
    },
  },
});
