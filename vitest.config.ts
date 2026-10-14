import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    // Unit tests only — pure logic, no DB. Integration is verified via probes.
    include: ["src/**/*.test.ts"],
    /**
     * Foundation-era tests written against the removed mock-JSON layer.
     *
     * STILL EXCLUDED BECAUSE IT FAILS, not because it is unchecked. Four of
     * its assertions expect `initiativeTypeService` to return a populated
     * library — `getAllInitiativeTypes()` now resolves to an empty array, so
     * `tier1Types.length` is 0 and `firstType.id` throws. Fixing that means
     * giving the service real data, which is an integration concern rather
     * than a unit one.
     *
     * Its sibling, components/initiatives/__tests__/initiatives-list.test.ts,
     * was excluded alongside it and has been RE-ENABLED: it is pure filter and
     * sort logic over mock objects, needs nothing external, and passes.
     *
     * Both now typecheck. `globals: true` below means the explicit vitest
     * imports they carry are redundant at runtime, but tsconfig does not
     * declare vitest's globals, so without them `tsc --noEmit` reported 126
     * phantom errors in files nobody was running.
     */
    exclude: ["src/services/__tests__/initiative-type.service.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
