/* cookmode.js — step-by-step "Cook Mode" for recipe detail pages
   (recipes/*.html, en/recipes/*.html). Self-contained: reads the page's own
   embedded #cookData JSON (no fetch, no dependency on shared.js/vote.js/
   worldcup.js) and renders a full-screen overlay with a checkable
   ingredient list followed by a one-step-at-a-time walkthrough.

   No serving-size multiplier: ingredients are free text with no reliable
   quantity/unit structure across the site's history, so scaling them was
   often wrong (multi-quantity clauses, "a pinch", "to taste", etc.) -
   dropped rather than shown with occasionally-bad numbers. */
var CookMode = (function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var STR = {
    ko: {
      ingredientsCount: function (n) { return '재료 ' + n + '개'; },
      stepsCount: function (n) { return n + '단계'; },
      start: '요리 시작하기', close: '닫기',
      step: function (i, n) { return i + ' / ' + n + '단계'; },
      prev: '이전', next: '다음', finish: '짠!', finishDesc: '조식이 준비됐습니다. 맛있게 드세요!',
      backToIngredients: '재료로 돌아가기'
    },
    en: {
      ingredientsCount: function (n) { return n + ' ingredients'; },
      stepsCount: function (n) { return n + ' steps'; },
      start: 'Start Cooking', close: 'Close',
      step: function (i, n) { return 'Step ' + i + ' / ' + n; },
      prev: 'Prev', next: 'Next', finish: 'Ta-da!', finishDesc: 'Your breakfast is ready. Enjoy!',
      backToIngredients: 'Back to ingredients'
    }
  };

  // Splits ingredients text into items - supports both the current
  // "- item\n- item" convention and the older single-line "item, item"
  // convention still present on some pre-2025 posts.
  function parseIngredientLines(text) {
    if (!text) return [];
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length > 1) {
      return lines.map(function (l) { return l.replace(/^[-•]\s*/, ''); });
    }
    return text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function parseStepLines(text) {
    if (!text) return [];
    return text.split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (l) { return l.replace(/^\d+\.\s*/, ''); });
  }

  function ensureOverlay() {
    var overlay = document.getElementById('cookOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'cookOverlay';
    overlay.className = 'cook-overlay hidden';
    overlay.innerHTML = '<div class="cook-modal" id="cookModal"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
    });
    return overlay;
  }

  function close() {
    var overlay = document.getElementById('cookOverlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function open(data, lang) {
    // Recipe pages ship as separate ko/en static files, so <html lang> is a
    // reliable signal there; index.html/archive.html instead toggle
    // language client-side without ever touching <html lang>, so their
    // modal integration passes I18N.getLang() explicitly instead.
    if (lang !== 'ko' && lang !== 'en') lang = document.documentElement.lang === 'en' ? 'en' : 'ko';
    var t = STR[lang];
    var ingredientLines = parseIngredientLines(data.ingredients);
    var stepLines = parseStepLines(data.steps);
    var checked = {};

    var overlay = ensureOverlay();
    var modal = document.getElementById('cookModal');

    function renderIngredients() {
      modal.innerHTML =
        '<button type="button" class="cook-close" aria-label="' + t.close + '">✕</button>' +
        '<h2>' + escapeHtml(data.title) + '</h2>' +
        '<div class="cook-meta">' + t.ingredientsCount(ingredientLines.length) + ' · ' + t.stepsCount(stepLines.length) + '</div>' +
        '<ul class="cook-ing-list">' +
        ingredientLines.map(function (line, i) {
          return '<li class="cook-ing-item' + (checked[i] ? ' checked' : '') + '" data-idx="' + i + '">' +
            '<span class="cook-check"></span>' +
            '<span class="cook-ing-text">' + escapeHtml(line) + '</span>' +
            '</li>';
        }).join('') +
        '</ul>' +
        '<button type="button" class="cook-start-primary">' + t.start + '</button>';

      modal.querySelector('.cook-close').addEventListener('click', close);
      Array.prototype.forEach.call(modal.querySelectorAll('.cook-ing-item'), function (li) {
        li.addEventListener('click', function () {
          var i = li.getAttribute('data-idx');
          checked[i] = !checked[i];
          li.classList.toggle('checked');
        });
      });
      modal.querySelector('.cook-start-primary').addEventListener('click', function () { renderStep(0); });
    }

    function renderStep(idx) {
      var total = stepLines.length;
      modal.innerHTML =
        '<button type="button" class="cook-close" aria-label="' + t.close + '">✕</button>' +
        '<div class="cook-step-progress">' + t.step(idx + 1, total) + '</div>' +
        '<div class="cook-step-bar"><div class="cook-step-bar-fill" style="width:' + (((idx + 1) / total) * 100) + '%"></div></div>' +
        '<div class="cook-step-text">' + escapeHtml(stepLines[idx]) + '</div>' +
        '<div class="cook-step-nav">' +
        '<button type="button" class="cook-nav-btn cook-nav-prev"' + (idx === 0 ? ' disabled' : '') + '>← ' + t.prev + '</button>' +
        '<button type="button" class="cook-nav-btn cook-nav-next">' + (idx === total - 1 ? t.finish : t.next + ' →') + '</button>' +
        '</div>' +
        '<button type="button" class="cook-back-link">' + t.backToIngredients + '</button>';

      modal.querySelector('.cook-close').addEventListener('click', close);
      modal.querySelector('.cook-back-link').addEventListener('click', renderIngredients);
      if (idx > 0) modal.querySelector('.cook-nav-prev').addEventListener('click', function () { renderStep(idx - 1); });
      modal.querySelector('.cook-nav-next').addEventListener('click', function () {
        if (idx < total - 1) renderStep(idx + 1);
        else renderFinish();
      });
    }

    function renderFinish() {
      modal.innerHTML =
        '<button type="button" class="cook-close" aria-label="' + t.close + '">✕</button>' +
        '<div class="cook-finish">' +
        '<div class="cook-finish-emoji">🍳</div>' +
        '<div class="cook-finish-title">' + t.finish + '</div>' +
        '<div class="cook-finish-desc">' + t.finishDesc + '</div>' +
        '</div>';
      modal.querySelector('.cook-close').addEventListener('click', close);
    }

    renderIngredients();
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function init() {
    var btn = document.getElementById('cookStartBtn');
    var dataEl = document.getElementById('cookData');
    if (!btn || !dataEl) return;
    var data;
    try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
    btn.addEventListener('click', function () { open(data); });
  }

  init();

  return { open: open };
})();
