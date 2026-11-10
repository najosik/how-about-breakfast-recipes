// Google 번역: 사전 고지 시트 → [번역 시작]을 누른 경우에만 Google 스크립트를 불러온다(동의 전 요청 0건).
// 동의 상태는 이 브라우저 탭의 sessionStorage에만 저장(서버 전송 없음). 번역 중에는 '원문 보기'로 언제든 끈다.
// Google 스크립트가 넣는 인라인 스크립트 1개는 index.html CSP에 해시로만 허용한다. Google이 바꾸면 위젯이 안 뜨고 실패 안내로 넘어간다.
const KEY = "seoulnow.translate.consent";
const SRC = "https://translate.google.com/translate_a/element.js?cb=seoulNowTranslateInit";

function store(get, value) {
  try { return get ? sessionStorage.getItem(KEY) === "1" : sessionStorage.setItem(KEY, "1"); } catch { return false; }
}
const translated = () => /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className);
const hasCookie = () => /(?:^|;\s*)googtrans=/.test(document.cookie);

export function initTranslate({ button, sheet, bar, pick, original, strings, lang, open, close, sheetHead, el }) {
  let state = "idle";   // idle | loading | ready | failed
  const box = document.getElementById("google_translate_element");

  const fail = () => {
    state = "failed";
    bar.hidden = false;
    pick.textContent = strings().trFail;
    box.hidden = true;
  };

  window.seoulNowTranslateInit = () => {
    const g = window.google && window.google.translate;
    if (!g || !g.TranslateElement) { fail(); return; }
    bar.hidden = false;
    pick.textContent = strings().trPick;
    new g.TranslateElement({ pageLanguage: lang() === "en" ? "en" : "ko", autoDisplay: false }, "google_translate_element");
    const started = Date.now();
    const timer = setInterval(() => {
      const sel = box.querySelector("select.goog-te-combo");
      if (sel && sel.options.length > 1 && sel.offsetWidth > 0) {
        clearInterval(timer);
        state = "ready";
        sel.setAttribute("aria-label", strings().trPick);
        if (!translated()) sel.focus();
      } else if (Date.now() - started > 6000) { clearInterval(timer); fail(); }
    }, 200);
  };

  function load() {
    if (state === "loading" || state === "ready") return;
    state = "loading";
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onerror = fail;
    document.head.append(s);
    setTimeout(() => { if (state === "loading") fail(); }, 8000);
  }

  // 원문 보기: Google이 남긴 언어 쿠키를 지우고 다시 불러온다
  original.addEventListener("click", () => {
    const host = location.hostname;
    for (const d of ["", `; domain=${host}`, `; domain=.${host}`]) document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
    location.reload();
  });
  new MutationObserver(() => {
    original.hidden = !translated();
    original.textContent = strings().trOriginal;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  function openConsent() {
    const s = strings();
    sheet.replaceChildren(...sheetHead("tr-title", s.trTitle),
      el("div", { class: "sheet-body" }, el("p", { text: s.trBody1 }), el("p", { text: s.trBody2 })),
      el("div", { class: "sheet-foot" },
        el("button", { type: "button", class: "btn", text: s.trCancel, onclick: close }),
        el("button", { type: "button", class: "btn primary", text: s.trStart, onclick: () => { store(false); close(); load(); } })));
    open(sheet, button);
  }

  button.addEventListener("click", () => {
    if (state === "ready" || state === "loading") { bar.hidden = false; const sel = box.querySelector("select"); if (sel) sel.focus(); return; }
    if (store(true)) load(); else openConsent();
  });

  // 이 탭에서 이미 동의했고 번역 언어를 골라 둔 상태라면(새로고침 등) 다시 불러와 번역을 이어 간다
  if (store(true) && hasCookie()) load();
}
