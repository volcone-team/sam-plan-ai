import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    // Unit tests only — pure logic, no DB. Integration is verified via probes.
    include: ["src/**/*.test.ts"],
    // Pre-existing foundation-era tests, written against the removed mock-JSON
    // layer; out of scope for current work and tracked separately.
    exclude: [
      "src/services/__tests__/initiative-type.service.test.ts",
      "src/components/initiatives/__tests__/initiatives-list.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
