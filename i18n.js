/* i18n.js — KO/EN language toggle for both pages.
   - Static UI chrome (labels, buttons, headings) is hand-translated (STRINGS).
   - Common ingredient tags are hand-translated (TAG_EN) for speed/accuracy.
   - Free-text recipe content (titles, intro, ingredients, steps) is translated
     on demand via the free MyMemory API, cached in localStorage so repeat
     views (and switching languages back and forth) don't re-hit the network.
*/
var I18N = (function () {
  'use strict';

  var LANG_KEY = 'hab_lang';

  var STRINGS = {
    ko: {
      nav_home: '← 홈으로',
      archive_title: '전체 레시피 아카이브',
      archive_subtitle: '2020년 7월부터 매일 아침 기록해 온 조식 다이어리, 그 안에 쌓인 레시피를 검색합니다.',
      stat_total: '전체 기록',
      stat_structured: '레시피 구조화',
      stat_range: '기록 기간',
      search_placeholder: '재료, 메뉴명, 키워드로 검색 (예: 토마토, 사워도우, 코코넛)',
      sort_new: '최신순',
      sort_old: '오래된순',
      sort_kcal_asc: '칼로리 낮은순',
      sort_kcal_desc: '칼로리 높은순',
      cal_only_prefix: '칼로리 ',
      cal_only_suffix: '만',
      empty_title: '일치하는 조식이 없어요',
      empty_desc: '검색어나 필터를 조정해보세요.',
      load_more: '더 불러오기',
      result_count: '개의 조식',
      footer_copyright: '© how.about.breakfast 2020-2026. All rights reserved.',

      home_title: '날마다 조식(Beta)',
      home_tagline: '매일 어제와 다른 조식을 만들어 먹고, 그 조식들을 기록하는 아카이브입니다.',
      home_since_suffix: ' 창간',
      ledger_title: '하루도 빼지 않은 기록(은 아니지만)',
      ledger_desc: '칸 하나가 하루예요. 진한 초록은 조식을 만든 날, 빈 칸은 별일이 있어서 조식을 건너뛴 날입니다.',
      legend_posted: '기록함',
      legend_failed: '실패기',
      legend_skipped: '건너뜀',
      otd_title: '그 날의 조식들',
      otd_desc: '해마다 오늘 만들었던 조식을 모아봤어요.',
      col_title: '소재로 골라 먹기',
      col_desc: '가장 자주 등장한 재료들로 모은 테마별 아카이브예요.',
      col_more: '전체 검색으로 보기 →',
      col_records_suffix: '건의 기록',
      col_failed_label: '실패기 아카이브',
      col_failed_suffix: '건의 솔직한 실패담',
      shuffle_title: '오늘 뭐 먹지?',
      shuffle_desc: '1,800개가 넘는 기록 중에서 무작위로 하나를 꺼내드려요.',
      shuffle_btn: '무작위로 하나 꺼내기',
      cta_title: '전체 아카이브 검색하기',
      cta_desc: '재료, 칼로리, 키워드로 1,831개의 기록을 직접 뒤져보세요.',
      cta_btn: '아카이브 열기 →',

      modal_ingredients: '재료',
      modal_steps: '조리',
      modal_notes: '메모',
      modal_fulltext: '전문',
      modal_credit: '원본 크레딧',
      modal_tags: '태그',
      badge_failed: '실패기',
      modal_prev_day: '이전 날짜',
      modal_next_day: '다음 날짜',
      modal_copy_link: '링크 복사',
      modal_copied: '복사됨!'
    },
    en: {
      nav_home: '← Home',
      archive_title: 'Full Recipe Archive',
      archive_subtitle: 'A daily breakfast journal since July 2020 — search the recipes collected along the way.',
      stat_total: 'Total entries',
      stat_structured: 'Structured recipes',
      stat_range: 'Date range',
      search_placeholder: 'Search by ingredient, dish, or keyword (e.g. tomato, sourdough, coconut)',
      sort_new: 'Newest',
      sort_old: 'Oldest',
      sort_kcal_asc: 'Lowest calories',
      sort_kcal_desc: 'Highest calories',
      cal_only_prefix: '≤ ',
      cal_only_suffix: 'kcal only',
      empty_title: 'No matching breakfasts',
      empty_desc: 'Try adjusting your search or filters.',
      load_more: 'Load more',
      result_count: ' breakfasts',
      footer_copyright: '© how.about.breakfast 2020-2026. All rights reserved.',

      home_title: 'Breakfast, Every Day',
      home_tagline: 'A record of someone who makes a different breakfast every morning, unless something comes up. This is the whole archive, gathered in one place.',
      home_since_suffix: ' · established',
      ledger_title: 'Not a single day missed',
      ledger_desc: 'Each square is a day. Deep green means breakfast was made, orange means a failed attempt, and empty means the day was skipped.',
      legend_posted: 'Made it',
      legend_failed: 'Failed attempt',
      legend_skipped: 'Skipped',
      otd_title: 'On this day, in years past',
      otd_desc: 'Breakfasts made around this exact date, across the years.',
      col_title: 'Browse by ingredient',
      col_desc: 'Themed collections built from the most frequent ingredients.',
      col_more: 'See the full archive →',
      col_records_suffix: ' entries',
      col_failed_label: 'The Failure Files',
      col_failed_suffix: ' honest failures',
      shuffle_title: 'What should I eat today?',
      shuffle_desc: 'Pull a random entry from over 1,800 recorded breakfasts.',
      shuffle_btn: 'Surprise me',
      cta_title: 'Search the full archive',
      cta_desc: 'Dig through 1,831 entries by ingredient, calories, or keyword.',
      cta_btn: 'Open the archive →',

      modal_ingredients: 'Ingredients',
      modal_steps: 'Steps',
      modal_notes: 'Notes',
      modal_fulltext: 'Full entry',
      modal_credit: 'Credit',
      modal_tags: 'Tags',
      badge_failed: 'Failed attempt',
      modal_prev_day: 'Previous',
      modal_next_day: 'Next',
      modal_copy_link: 'Copy link',
      modal_copied: 'Copied!'
    }
  };

  var COLLECTION_LABELS_EN = {
    '토마토 특집': 'Tomato Special',
    '아보카도 아카이브': 'Avocado Archive',
    '파스타 & 누들': 'Pasta & Noodles',
    '감자 요리 모음': 'Potato Dishes',
    '계란 한 알의 힘': 'The Power of One Egg',
    '오픈샌드위치 특집': 'Open-Sandwich Special'
  };

  var TAG_EN = {
    '토마토': 'Tomato', '아보카도': 'Avocado', '파스타': 'Pasta', '감자': 'Potato',
    '샌드위치': 'Sandwich', '계란': 'Egg', '가지': 'Eggplant', '아스파라거스': 'Asparagus',
    '리코타치즈': 'Ricotta', '시금치': 'Spinach', '당근': 'Carrot', '토스트': 'Toast',
    '오픈샌드위치': 'Open Sandwich', '양파': 'Onion', '두부': 'Tofu', '브로콜리': 'Broccoli',
    '새우': 'Shrimp', '파프리카': 'Bell Pepper', '버섯': 'Mushroom', '호두': 'Walnut',
    '오이': 'Cucumber', '애호박': 'Zucchini', '블루베리': 'Blueberry', '명란': 'Mentaiko',
    '연어': 'Salmon', '두유': 'Soy Milk', '모짜렐라': 'Mozzarella', '코코넛': 'Coconut',
    '크림치즈': 'Cream Cheese', '그릭요거트': 'Greek Yogurt', '굴': 'Oyster', '참치': 'Tuna',
    '사과': 'Apple', '망고': 'Mango', '딸기': 'Strawberry', '바나나': 'Banana',
    '복숭아': 'Peach', '체리': 'Cherry', '렌틸콩': 'Lentils', '병아리콩': 'Chickpeas',
    '완두콩': 'Peas', '템페': 'Tempeh', '부라타': 'Burrata', '훈제연어': 'Smoked Salmon',
    '라자냐': 'Lasagna', '우동': 'Udon', '모밀': 'Buckwheat Noodles', '리가토니': 'Rigatoni',
    '샐러드': 'Salad'
  };

  function getLang() {
    try { return localStorage.getItem(LANG_KEY) || 'ko'; } catch (e) { return 'ko'; }
  }
  function setLang(lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  }
  function t(key) {
    var lang = getLang();
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ko[key] || key;
  }
  function tagLabel(koTag) {
    if (getLang() !== 'en') return koTag;
    return TAG_EN[koTag] || koTag;
  }
  function collectionLabel(koLabel) {
    if (getLang() !== 'en') return koLabel;
    return COLLECTION_LABELS_EN[koLabel] || koLabel;
  }

  function applyStaticI18n(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-placeholder]'), function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
  }

  /* ---- on-demand translation of free-text recipe content ---- */
  var CACHE_PREFIX = 'hab_tr_en:';
  var memCache = {};

  function cacheGet(key) {
    if (memCache[key]) return memCache[key];
    try {
      var v = localStorage.getItem(CACHE_PREFIX + key);
      if (v) { memCache[key] = v; return v; }
    } catch (e) {}
    return null;
  }
  function cacheSet(key, val) {
    memCache[key] = val;
    try { localStorage.setItem(CACHE_PREFIX + key, val); } catch (e) {}
  }
  function hashKey(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return String(h) + ':' + s.length;
  }

  function translateChunk(text) {
    if (!text || !text.trim()) return Promise.resolve(text);
    var key = hashKey(text);
    var cached = cacheGet(key);
    if (cached) return Promise.resolve(cached);
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.slice(0, 480)) + '&langpair=ko|en';
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var out = (data && data.responseData && data.responseData.translatedText) || text;
        cacheSet(key, out);
        return out;
      })
      .catch(function () { return text; });
  }

  // translate longer text by chunking on lines, sequentially (keeps things
  // simple and avoids hammering the free API in parallel)
  function translateText(text) {
    if (!text) return Promise.resolve(text);
    var lines = text.split('\n');
    var out = [];
    var chain = Promise.resolve();
    lines.forEach(function (line, i) {
      chain = chain.then(function () {
        return translateChunk(line).then(function (t) { out[i] = t; });
      });
    });
    return chain.then(function () { return out.join('\n'); });
  }

  /* apply translations to any element carrying data-ko + class i18n-dyn
     found within `root`. Restores Korean instantly; fetches EN lazily. */
  function applyDynamicTranslations(root) {
    var lang = getLang();
    var els = (root || document).querySelectorAll('.i18n-dyn');
    Array.prototype.forEach.call(els, function (el) {
      var original = el.getAttribute('data-ko');
      if (original == null) return;
      if (lang === 'ko') {
        el.textContent = original;
        return;
      }
      var key = hashKey(original);
      var cached = cacheGet(key);
      if (cached) {
        el.textContent = cached;
      } else {
        translateText(original).then(function (translated) {
          if (getLang() === 'en') el.textContent = translated;
        });
      }
    });
  }

  return {
    STRINGS: STRINGS,
    getLang: getLang,
    setLang: setLang,
    t: t,
    tagLabel: tagLabel,
    collectionLabel: collectionLabel,
    applyStaticI18n: applyStaticI18n,
    applyDynamicTranslations: applyDynamicTranslations,
    translateText: translateText
  };
})();
