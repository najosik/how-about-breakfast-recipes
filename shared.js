/* shared.js — common helpers for the homepage and the archive/search page */
var Shared = (function () {
  'use strict';

  var GENERIC_TAGS = new Set([
    '조식', '레시피', '직장인', '아침밥', '아침밥상', '먹스타그램', '요리스타그램',
    '홈쿡', '집밥', '혼밥', 'breakfast', '조식다이어리', '나의프랑스식샐러드',
    '나의프랑스식오븐요리', '샐러드', '트위터레시피', '초간단레시피', '미라클모닝',
    '모닝루틴', '모닝리추얼', '나의로컬푸드샐러드'
  ]);

  var LINK_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' +
    '</svg>';

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function L(key) {
    return (typeof I18N !== 'undefined') ? I18N.t(key) : key;
  }

  function foodTags(r) {
    return (r.hashtags || []).filter(function (h) {
      return !GENERIC_TAGS.has(h) && !/^[a-zA-Z]+$/.test(h);
    });
  }

  /* ---- category icon system (illustrative placeholders until real photos arrive) ---- */
  var CATEGORY_RULES = [
    ['tomato', ['토마토'], 'clay'],
    ['seafood', ['연어', '훈제연어', '새우', '굴', '명란', '참치', '문어', '조개'], 'clay'],
    ['egg', ['계란', '에그'], 'clay'],
    ['dairy_cheese', ['치즈', '모짜렐라', '리코타', '부라타', '크림치즈', '그릭요거트', '요거트'], 'clay'],
    ['avocado', ['아보카도'], 'teal'],
    ['mushroom', ['버섯'], 'teal'],
    ['legume_bean', ['두부', '템페', '병아리콩', '렌틸콩', '완두콩', '두유'], 'teal'],
    ['salad_greens', ['샐러드', '시금치', '브로콜리', '루꼴라', '케일'], 'teal'],
    ['root_veg', ['감자', '당근', '가지', '애호박', '파프리카', '양파', '고구마'], 'teal'],
    ['dessert_baking', ['케이크', '푸딩', '타르트', '쿠키', '코코넛'], 'wheat'],
    ['fruit', ['블루베리', '체리', '사과', '망고', '딸기', '바나나', '복숭아', '오이'], 'wheat'],
    ['bread_toast', ['샌드위치', '토스트', '베이글', '오픈샌드위치', '사워도우'], 'wheat'],
    ['rice_grain', ['밥', '리조또', '오트밀', '크리스피라이스'], 'wheat'],
    ['pasta_noodle', ['파스타', '라자냐', '우동', '모밀', '국수', '리가토니', '누들'], 'wheat']
  ];

  var ICONS = {
    tomato: '<circle cx="32" cy="36" r="16"/><path d="M32 20c-3-6 3-9 8-6"/><path d="M32 20c3-6-3-9-8-6"/>',
    seafood: '<path d="M14 34c8-14 28-14 36 0-8 14-28 14-36 0z"/><circle cx="41" cy="34" r="2.2" fill="currentColor" stroke="none"/><path d="M14 34l-6-6M14 34l-6 6"/>',
    egg: '<ellipse cx="32" cy="36" rx="19" ry="13"/><circle cx="32" cy="36" r="7"/>',
    dairy_cheese: '<path d="M10 42 32 16l22 26z"/><circle cx="27" cy="34" r="2" fill="currentColor" stroke="none"/><circle cx="35" cy="30" r="2" fill="currentColor" stroke="none"/>',
    avocado: '<ellipse cx="32" cy="33" rx="15" ry="20"/><ellipse cx="32" cy="35" rx="7" ry="9"/>',
    mushroom: '<path d="M13 30a19 13 0 0 1 38 0z"/><path d="M24 30v14a8 8 0 0 0 16 0V30"/>',
    legume_bean: '<path d="M18 46c-6-14-2-30 10-34 12-4 20 8 18 20-2 12-16 22-28 14z"/><circle cx="27" cy="30" r="2" fill="currentColor" stroke="none"/><circle cx="33" cy="38" r="2" fill="currentColor" stroke="none"/>',
    salad_greens: '<path d="M32 46C18 40 16 22 24 14c4 10 4 18 8 24 4-6 4-14 8-24 8 8 6 26-8 32z"/>',
    root_veg: '<path d="M26 14c4-3 8-3 10 1-2 1-4 1-6 0"/><path d="M22 20c14-4 24 6 20 20-3 10-22 14-26-2-3-10 0-16 6-18z"/>',
    dessert_baking: '<path d="M14 44V30l18-14 18 14v14z"/><path d="M14 37h36"/><circle cx="32" cy="20" r="3" fill="currentColor" stroke="none"/>',
    fruit: '<circle cx="30" cy="38" r="15"/><path d="M30 23c0-5 4-8 8-7"/>',
    bread_toast: '<path d="M12 44V26a20 14 0 0 1 40 0v18z"/><path d="M12 44h40"/>',
    rice_grain: '<path d="M12 30a20 8 0 0 1 40 0v6a20 8 0 0 1-40 0z"/><path d="M12 30a20 8 0 0 0 40 0"/>',
    pasta_noodle: '<path d="M12 22c6 6-6 10 0 16s-6 10 0 16"/><path d="M26 22c6 6-6 10 0 16s-6 10 0 16"/><path d="M40 22c6 6-6 10 0 16s-6 10 0 16"/>',
    default: '<circle cx="32" cy="32" r="18"/><circle cx="36" cy="28" r="6"/>'
  };

  function categorize(r) {
    var hay = (foodTags(r).join(' ') + ' ' + (r.title || '')).toLowerCase();
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var rule = CATEGORY_RULES[i];
      for (var j = 0; j < rule[1].length; j++) {
        if (hay.indexOf(rule[1][j].toLowerCase()) !== -1) return { key: rule[0], tone: rule[2] };
      }
    }
    return { key: 'default', tone: 'teal' };
  }

  function stampLabel(r) {
    if (r.diary_no != null) return '#' + r.diary_no;
    if (r.pre_label) return r.pre_label;
    return '#?';
  }

  function iconSVG(r, size) {
    var cat = categorize(r);
    var s = size || 32;
    return (
      '<span class="card-thumb tone-' + cat.tone + '" aria-hidden="true">' +
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[cat.key] || ICONS.default) +
      '</svg></span>'
    );
  }

  function thumbHTML(r, size) {
    if (r.image) {
      return '<div class="card-photo"><img src="' + escapeHtml(r.image) + '" alt="' + escapeHtml(r.title || L('untitled_fallback')) + '" loading="lazy"></div>';
    }
    return iconSVG(r, size);
  }


  function loadData() {
    return fetch('recipes-index.json').then(function (r) {
      if (!r.ok) throw new Error('recipes-index.json load failed');
      return r.json();
    });
  }

  /* ---- static English text (pre-translated, no live API call) ----
     recipes-index-en.json is fetched lazily — only once someone actually
     switches to English — and merged onto the records the page already
     has, keyed by page_id. Records still missing a translation fall back
     to the old on-demand i18n-dyn/MyMemory path further below. */
  var enIndexPromise = null;
  function loadEnIndex() {
    if (!enIndexPromise) {
      enIndexPromise = fetch('recipes-index-en.json')
        .then(function (r) { if (!r.ok) throw new Error('recipes-index-en.json load failed'); return r.json(); })
        .catch(function (err) { console.error(err); return {}; });
    }
    return enIndexPromise;
  }
  function ensureEnMerged(all) {
    return loadEnIndex().then(function (enMap) {
      all.forEach(function (r) {
        if (!r._en && enMap[r.page_id]) r._en = enMap[r.page_id];
      });
      return all;
    });
  }
  function localizedText(r, field) {
    var lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ko';
    if (lang === 'en' && r._en && r._en[field]) return r._en[field];
    return r[field];
  }
  function hasStaticEn(r, field) {
    return !!(r._en && r._en[field]);
  }
  /* pre-translated text renders as plain static markup (no flash, no API
     call); untranslated fields still fall back to the old i18n-dyn path. */
  function bodyTextHtml(r, field) {
    var koText = r[field];
    if (!koText) return '';
    if (hasStaticEn(r, field)) {
      return '<div class="body-text">' + escapeHtml(localizedText(r, field)) + '</div>';
    }
    return '<div class="body-text i18n-dyn" data-ko="' + escapeHtml(koText) + '">' + escapeHtml(koText) + '</div>';
  }

  function recipeUrl(r) {
    var lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ko';
    if (lang === 'en' && hasStaticEn(r, 'title')) return 'en/recipes/' + r.page_id + '.html';
    return 'recipes/' + r.page_id + '.html';
  }

  function tagFrequency(all, limit) {
    var counts = {};
    all.forEach(function (r) {
      foodTags(r).forEach(function (h) { counts[h] = (counts[h] || 0) + 1; });
    });
    return Object.keys(counts)
      .map(function (k) { return [k, counts[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, limit || 20);
  }

  /* ---- modal (requires <div id="overlay" class="overlay hidden"><div class="modal" id="modalContent"></div></div> in the page) ---- */
  function ensureModalDom() {
    var overlay = document.getElementById('overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'overlay hidden';
      overlay.id = 'overlay';
      overlay.innerHTML = '<div class="modal" id="modalContent"></div>';
      document.body.appendChild(overlay);
    }
    // index.html/archive.html already ship a static #overlay, so this runs
    // every time openModal() is called; only bind the outside-click/Escape
    // handlers once regardless of whether the element was just created.
    if (overlay.dataset.bound) return;
    overlay.dataset.bound = '1';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  function mediaItemsFor(r) {
    var items = [];
    if (r.gallery && r.gallery.length) {
      r.gallery.forEach(function (src) { items.push({ type: 'image', src: src }); });
    } else if (r.image) {
      items.push({ type: 'image', src: r.image });
    }
    if (r.video) items.push({ type: 'video', src: r.video });
    return items;
  }

  function galleryHTML(r) {
    var items = mediaItemsFor(r);
    if (items.length === 0 || (items.length === 1 && items[0].type === 'image')) {
      return thumbHTML(r, 40);
    }

    var altText = escapeHtml(r.title || L('untitled_fallback'));
    var mainItem = items[0];
    var mainHTML = mainItem.type === 'video'
      ? '<video src="' + escapeHtml(mainItem.src) + '" controls playsinline></video>'
      : '<img src="' + escapeHtml(mainItem.src) + '" alt="' + altText + '">';

    var thumbs = items.map(function (item, i) {
      var thumbImg = item.type === 'video'
        ? (items[0].type === 'image' ? items[0].src : item.src)
        : item.src;
      return (
        '<button type="button" class="gallery-thumb' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
        '<img src="' + escapeHtml(thumbImg) + '" alt="' + altText + ' ' + (i + 1) + '">' +
        (item.type === 'video' ? '<span class="play-badge">▶</span>' : '') +
        '</button>'
      );
    }).join('');

    var igLinkHTML = (r.video && r.permalink)
      ? '<a class="modal-ig-link" href="' + escapeHtml(r.permalink) + '" target="_blank" rel="noopener">' + L('modal_ig_link') + '</a>'
      : '';

    return (
      '<div class="modal-gallery">' +
      '<div class="gallery-main">' + mainHTML + '</div>' +
      '<div class="gallery-thumbs">' + thumbs + '</div>' +
      igLinkHTML +
      '</div>'
    );
  }

  function bindGallery(container, r) {
    var items = mediaItemsFor(r);
    if (items.length < 2) return;
    var altText = escapeHtml(r.title || L('untitled_fallback'));
    var mainEl = container.querySelector('.gallery-main');
    var thumbBtns = container.querySelectorAll('.gallery-thumb');
    Array.prototype.forEach.call(thumbBtns, function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var item = items[idx];
        if (item.type === 'video') {
          mainEl.innerHTML = '<video src="' + escapeHtml(item.src) + '" controls playsinline></video>';
          // call play() directly in this click handler (rather than the
          // declarative `autoplay` attribute) so the browser reliably
          // attributes it to the click and doesn't fall back to muted
          // autoplay, which happened intermittently with `autoplay`.
          mainEl.querySelector('video').play().catch(function () {});
        } else {
          mainEl.innerHTML = '<img src="' + escapeHtml(item.src) + '" alt="' + altText + '">';
        }
        Array.prototype.forEach.call(thumbBtns, function (b) { b.classList.toggle('active', b === btn); });
      });
    });
  }

  function openModal(r, nav) {
    ensureModalDom();
    var overlay = document.getElementById('overlay');
    var modalContent = document.getElementById('modalContent');
    var prevRec = (nav && nav.index > 0) ? nav.list[nav.index - 1] : null;
    var nextRec = (nav && nav.index < nav.list.length - 1) ? nav.list[nav.index + 1] : null;
    var navHTML = nav ? (
      '<div class="modal-nav">' +
      '<button type="button" class="modal-nav-btn modal-nav-prev"' + (prevRec ? '' : ' disabled') + '>' +
      '← ' + L('modal_prev_day') + (prevRec ? '<span class="modal-nav-date">' + escapeHtml(prevRec.date) + '</span>' : '') +
      '</button>' +
      '<button type="button" class="modal-nav-btn modal-nav-next"' + (nextRec ? '' : ' disabled') + '>' +
      L('modal_next_day') + (nextRec ? '<span class="modal-nav-date">' + escapeHtml(nextRec.date) + '</span>' : '') + ' →' +
      '</button>' +
      '</div>'
    ) : '';
    var tagsHtml = (r.hashtags || []).map(function (h) {
      var label = (typeof I18N !== 'undefined') ? I18N.tagLabel(h) : h;
      return '<a href="archive.html?tag=' + encodeURIComponent(h) + '">#' + escapeHtml(label) + '</a>';
    }).join('');
    var ingSection = r.ingredients
      ? '<section><h4>' + L('modal_ingredients') + '</h4>' + bodyTextHtml(r, 'ingredients') + '</section>' : '';
    var stepSection = r.steps
      ? '<section><h4>' + L('modal_steps') + '</h4>' + bodyTextHtml(r, 'steps') + '</section>' : '';
    var introSection = r.intro
      ? '<section><h4>' + (r.ingredients ? L('modal_notes') : L('modal_fulltext')) + '</h4>' + bodyTextHtml(r, 'intro') + '</section>' : '';
    var creditSection = r.credit
      ? '<section><h4>' + L('modal_credit') + '</h4><div class="credit">Inspired by ' + escapeHtml(r.credit) + '</div></section>' : '';

    var shareBtnHtml = '<button class="modal-share-btn" type="button" aria-label="' + escapeHtml(L('modal_copy_link')) + '">' + LINK_ICON_SVG + '<span class="modal-share-label">' + L('modal_copy_link') + '</span></button>';

    var koTitle = r.title || L('untitled_fallback');
    var titleHtml = hasStaticEn(r, 'title')
      ? '<h2>' + escapeHtml(localizedText(r, 'title')) + '</h2>'
      : '<h2 class="i18n-dyn" data-ko="' + escapeHtml(koTitle) + '">' + escapeHtml(koTitle) + '</h2>';

    modalContent.innerHTML =
      '<button class="modal-close" aria-label="' + escapeHtml(L('modal_close')) + '">✕</button>' +
      navHTML +
      galleryHTML(r) +
      '<div class="modal-stamp-row">' +
      '<span class="stamp">' + stampLabel(r) + '</span>' +
      (r.failed ? '<span class="fail-badge">' + L('badge_failed') + '</span>' : '') +
      shareBtnHtml +
      '</div>' +
      titleHtml +
      '<div class="modal-meta">' + [r.date, r.weather, r.calories ? r.calories + 'kcal' : null].filter(Boolean).map(escapeHtml).join(' · ') + '</div>' +
      introSection + ingSection + stepSection + creditSection +
      (tagsHtml ? '<section><h4>' + L('modal_tags') + '</h4><div class="tag-list">' + tagsHtml + '</div></section>' : '');

    modalContent.querySelector('.modal-close').addEventListener('click', closeModal);
    bindShareButton(modalContent.querySelector('.modal-share-btn'), r, L);
    if (nav) {
      var prevBtn = modalContent.querySelector('.modal-nav-prev');
      var nextBtn = modalContent.querySelector('.modal-nav-next');
      if (prevRec) prevBtn.addEventListener('click', function () { openModal(prevRec, { list: nav.list, index: nav.index - 1 }); });
      if (nextRec) nextBtn.addEventListener('click', function () { openModal(nextRec, { list: nav.list, index: nav.index + 1 }); });
    }
    bindGallery(modalContent, r);
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (typeof I18N !== 'undefined') I18N.applyDynamicTranslations(modalContent);
  }

  function closeModal() {
    var overlay = document.getElementById('overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function bindShareButton(btn, r, L) {
    if (!btn) return;
    var label = btn.querySelector('.modal-share-label');
    btn.addEventListener('click', function () {
      var url = new URL(recipeUrl(r), location.href).href;
      var done = function () {
        label.textContent = L('modal_copied');
        btn.classList.add('copied');
        setTimeout(function () {
          label.textContent = L('modal_copy_link');
          btn.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url); done(); });
      } else {
        fallbackCopy(url);
        done();
      }
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function cardHTML(r) {
    var metaBits = [];
    if (r.date) metaBits.push(r.date);
    if (r.weather) metaBits.push(escapeHtml(r.weather));
    var kcal = r.calories ? '<span class="kcal">' + r.calories + 'kcal</span>' : '';
    var koTitle = r.title || L('untitled_fallback');
    var titleHtml = hasStaticEn(r, 'title')
      ? '<h3 class="card-title">' + escapeHtml(localizedText(r, 'title')) + '</h3>'
      : '<h3 class="card-title i18n-dyn" data-ko="' + escapeHtml(koTitle) + '">' + escapeHtml(koTitle) + '</h3>';
    return (
      '<a class="card" href="' + escapeHtml(recipeUrl(r)) + '" data-no="' + r.diary_no + '" data-date="' + r.date + '">' +
      thumbHTML(r, 30) +
      '<span class="stamp">' + stampLabel(r) + '</span>' +
      (r.failed ? '<span class="fail-badge">' + L('badge_failed') + '</span>' : '') +
      titleHtml +
      '<div class="card-meta"><span>' + metaBits.join(' · ') + '</span>' + kcal + '</div>' +
      '</a>'
    );
  }

  function bindCardClicks(container, records) {
    Array.prototype.forEach.call(container.querySelectorAll('.card'), function (el, i) {
      // cards are real <a href="recipes/...html"> links (crawlable, shareable,
      // work with no JS). Intercept plain clicks to open the modal instead;
      // let ctrl/cmd/middle-click etc. through so "open in new tab" still works.
      el.addEventListener('click', function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openModal(records[i]);
      });
    });
    if (typeof I18N !== 'undefined') I18N.applyDynamicTranslations(container);
  }

  return {
    GENERIC_TAGS: GENERIC_TAGS,
    escapeHtml: escapeHtml,
    foodTags: foodTags,
    loadData: loadData,
    ensureEnMerged: ensureEnMerged,
    localizedText: localizedText,
    hasStaticEn: hasStaticEn,
    recipeUrl: recipeUrl,
    tagFrequency: tagFrequency,
    categorize: categorize,
    iconSVG: iconSVG,
    thumbHTML: thumbHTML,
    galleryHTML: galleryHTML,
    openModal: openModal,
    closeModal: closeModal,
    cardHTML: cardHTML,
    bindCardClicks: bindCardClicks
  };
})();
