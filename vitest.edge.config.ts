import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    exclude: [...configDefaults.exclude, "**/*.node.test.ts"],
    include: ["**/*.test.ts"],
  },
});
