import { build } from "esbuild"; import fs from "node:fs";
await build({ entryPoints: ["apps/desktop/ui/app.tsx"], bundle: true, outfile: "apps/desktop/dist/ui.js", jsx: "automatic", format: "iife", sourcemap: true });
fs.cpSync("node_modules/monaco-editor/min/vs", "apps/desktop/dist/vs", { recursive: true });
fs.copyFileSync("apps/desktop/ui/index.html", "apps/desktop/dist/index.html");
