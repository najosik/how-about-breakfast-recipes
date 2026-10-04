// 1) public/ 화면 파일을 src/static.generated.js 로 묶고
// 2) src/worker.js(+SDK·샘플 데이터·화면) → dist/concierge-worker.js 단일 파일로 번들.
//    Cloudflare 대시보드에 그대로 붙여 넣거나 wrangler로 배포. `--static-only`는 1)만 수행(테스트용).
import { build } from "esbuild";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const files = {};
for (const name of readdirSync("public").sort()) {
  if (/\.(html|css|js|svg)$/.test(name)) files[`/${name}`] = readFileSync(`public/${name}`, "utf-8");
}
writeFileSync("src/static.generated.js",
  `// 자동 생성 파일(build.mjs) — 직접 수정하지 마세요.\nexport default ${JSON.stringify(files, null, 0)};\n`);
console.log(`static: ${Object.keys(files).join(", ")}`);

if (!process.argv.includes("--static-only")) {
  await build({
    entryPoints: ["src/worker.js"], outfile: "dist/concierge-worker.js",
    bundle: true, format: "esm", platform: "browser", conditions: ["workerd", "worker", "browser"],
    target: "es2022", minify: false, legalComments: "eof", logLevel: "info",
  });
}
