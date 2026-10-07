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
    if (!g || !g.TranslateElement) return;
    new g.TranslateElement({
      pageLanguage: ko() ? "ko" : "en",
      autoDisplay: false,
      layout: g.TranslateElement.InlineLayout.SIMPLE,
    }, "google_translate_element");
    btn.hidden = true;
    box.hidden = false;
  };

  btn.addEventListener("click", () => {
    if (loading) return;
    loading = true;
    btn.disabled = true;
    const s = document.createElement("script");
    s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    s.async = true;
    s.onerror = () => {
      loading = false;
      btn.disabled = false;
      if (note) note.textContent = ko() ? "번역기를 불러오지 못했습니다. 브라우저의 번역 기능을 이용해 주세요." : "Couldn't load the translator. Please use your browser's translate feature.";
    };
    document.head.append(s);
  });
})();
