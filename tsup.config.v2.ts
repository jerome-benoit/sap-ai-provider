import { defineConfig } from "tsup";
import { version as tsVersion } from "typescript";

const isTsV6 = parseInt(tsVersion.split(".")[0] ?? "0", 10) >= 6;

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
    dts: {
      compilerOptions: {
        // tsup injects baseUrl: "." for rollup-plugin-dts; suppress TS 6.0 deprecation
        ...(isTsV6 ? { ignoreDeprecations: "6.0" } : {}),
      },
    },
    entry: ["src/index-v2.ts"],
    format: ["cjs", "esm"],
    sourcemap: true,
  },
]);
