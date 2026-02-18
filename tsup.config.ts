import { defineConfig } from "tsup";

export default defineConfig([
  {
    banner: ({ format }) => {
      // Polyfill require() for bundled CJS dependencies in ESM output
      if (format === "esm") {
        return {
          js: `import {createRequire as __createRequire} from 'module';var require=__createRequire(import.meta.url);`,
        };
      }
    },
    clean: true,
    define: {
      __PACKAGE_VERSION__: JSON.stringify(
        (await import("./package.json", { with: { type: "json" } })).default.version,
      ),
    },
    dts: true,
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    sourcemap: true,
  },
]);
