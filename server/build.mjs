import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.join(__dirname, "dist/index.js"),
  // esbuild is installed at runtime by the Rust extension — keep it external
  external: ["esbuild"],
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  minify: false,
  sourcemap: false,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
