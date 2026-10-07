// 다국어 번역(구글 번역 위젯). 버튼을 누른 방문자에게만 구글 스크립트를 불러온다
// (누르지 않으면 외부 요청 없음). 번역하면 화면의 글이 구글로 전송된다 — 공공 행사 정보뿐, 개인정보 없음.
"use strict";

(() => {
  const btn = document.getElementById("gt-btn");
  const box = document.getElementById("google_translate_element");
  const note = document.getElementById("gt-note");
  if (!btn || !box) return;
  const ko = () => (document.documentElement.lang || "ko").startsWith("ko");
  let loading = false;

  // 구글 스크립트가 불러온 뒤 호출하는 콜백(전역 이름은 구글 규약)
  window.googleTranslateElementInit = () => {
    const g = window.google && window.google.translate;
    if (!g || !g.TranslateElement) { failed(); return; }
    // 기본 모양(언어 선택 상자). SIMPLE 모양은 언어 목록을 별도 프레임으로 띄워 가려질 수 있어 쓰지 않는다
    box.hidden = false;
    new g.TranslateElement({ pageLanguage: ko() ? "ko" : "en", autoDisplay: false }, "google_translate_element");
    // 언어 선택 상자가 실제로 나타난 뒤에만 버튼을 숨긴다(6초 안에 안 나오면 버튼 유지 + 안내)
    const started = Date.now();
    const timer = setInterval(() => {
      const select = box.querySelector("select.goog-te-combo");
      if (select) {
        clearInterval(timer);
        btn.hidden = true;
        select.setAttribute("aria-label", ko() ? "번역할 언어 선택" : "Choose a language");
        select.focus();
      } else if (Date.now() - started > 6000) {
        clearInterval(timer);
        box.hidden = true;
        failed();
      }
    }, 200);
  };

  function failed() {
    loading = false;
    btn.disabled = false;
    if (note) note.textContent = ko() ? "번역기를 불러오지 못했습니다. 브라우저의 번역 기능을 이용해 주세요." : "Couldn't load the translator. Please use your browser's translate feature.";
  }

  btn.addEventListener("click", () => {
    if (loading) return;
    loading = true;
    btn.disabled = true;
    const s = document.createElement("script");
    s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    s.async = true;
    s.onerror = failed;
    // 스크립트는 받았지만 구글 콜백이 오지 않는 경우(차단·지원 중단 등)도 8초 뒤 실패로 처리
    setTimeout(() => { if (loading && box.hidden) failed(); }, 8000);
    document.head.append(s);
  });
})();
