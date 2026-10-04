// claude.ai 아티팩트용 단일 페이지 생성: dist/artifact/seoul-concierge.html
// - 화면(public/index.html·app.css·app.js) + 엔진(artifact/engine.js, 기존 모듈·샘플 데이터·축제 스냅샷 번들)
// - 아티팩트 규칙: <!doctype>/<html>/<head>/<body> 없이 <title>·<style>로 시작, 외부 스크립트 없음(모두 인라인)
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const engine = await build({
  entryPoints: ["artifact/engine.js"], bundle: true, write: false, format: "iife",
  platform: "browser", target: "es2020", minify: true, legalComments: "none",
});
const engineJs = engine.outputFiles[0].text;
const appJs = readFileSync("public/app.js", "utf-8");
const css = readFileSync("public/app.css", "utf-8");
const index = readFileSync("public/index.html", "utf-8");
const bodyHtml = index.slice(index.indexOf("<body>") + 6, index.indexOf("</body>"))
  .replace(/<script[^>]*><\/script>\s*/g, "");

// 인라인 스크립트 안의 "</script" 가 태그를 닫지 않도록
const inline = (js) => js.replace(/<\/script/gi, "<\\/script");

const page = `<title>서울 AI 컨시어지</title>
<style>
${css}
html, body { height: 100%; }
body { background: var(--bg); color: var(--text); padding-inline: 0; }
</style>
${bodyHtml.trim()}
<script>
${inline(engineJs)}
</script>
<script>
${inline(appJs)}
</script>
`;
mkdirSync("dist/artifact", { recursive: true });
writeFileSync("dist/artifact/seoul-concierge.html", page);
console.log(`dist/artifact/seoul-concierge.html  ${(page.length / 1024).toFixed(0)} KB`);
