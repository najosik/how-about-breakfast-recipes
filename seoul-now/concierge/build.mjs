// src/worker.js(+SDK·샘플 데이터) → dist/concierge-worker.js 단일 파일. Cloudflare 대시보드에 그대로 붙여 넣거나 wrangler로 배포.
import { build } from "esbuild";

await build({
  entryPoints: ["src/worker.js"],
  outfile: "dist/concierge-worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["workerd", "worker", "browser"],
  target: "es2022",
  minify: false,
  legalComments: "eof",
  logLevel: "info",
});
