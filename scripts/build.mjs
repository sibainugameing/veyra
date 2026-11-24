import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["runtime/composition/entry.tsx"], bundle: true, outfile: "dist/bundle.js", jsx: "automatic", sourcemap: true,
  alias: { "@project": path.resolve("src/main.tsx"), "@veyra/core": path.resolve("packages/core/src/index.tsx") },
});
