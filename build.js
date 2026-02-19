const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const debug = process.argv.includes("--debug");

const options = {
  entryPoints: [
    "src/interceptor.ts",
    "src/content.ts",
    "src/popup.ts",
  ],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "es2020",
  logLevel: "info",
  define: {
    __DEBUG__: debug ? "true" : "false",
  },
};

if (watch) {
  esbuild.context(options).then((ctx) => ctx.watch());
} else {
  esbuild.build(options);
}
