(function () {
  'use strict';

  // 커버 스토리 선정 규칙 - docs/Handoff/HANDOFF.md 2절 "선정 규칙은 설정값으로
  // 분리" 요구사항. 'latest' = 온디스데이(같은 달/일) 기록 중 가장 최근 연도.
  var HERO_SELECTION_RULE = 'latest';

  var COLLECTIONS = [
    { label: '토마토 앓이', tag: '토마토' },
    { label: '아보카도 중독', tag: '아보카도' },
    { label: '면치기의 정석', tag: '파스타' },
    { label: '감자, 무한변신', tag: '감자' },
    { label: '계란이면 다 돼', tag: '계란' },
    { label: '샌드위치 아카이브', tag: '샌드위치' },
    { label: '샐러드 탐구생활', tag: '샐러드' },
    { label: '가지의 재발견', tag: '가지' }
  ];

  var SEARCH_PROMPTS = [
    '토마토 땡기는 아침이죠?',
    '오늘 아보카도 어때요?',
    '아침부터 파스타, 괜찮아요',
    '감자 없인 서운한 아침',
    '계란 하나쯤은 필수죠',
    '샌드위치, 오늘의 정답',
    '초록초록 샐러드 어때요',
    '가지, 오늘 주인공 해볼까?'
  ];

  var allData = null;
  var selectedYear = null; // 히트맵 연도 탭 필터 상태 (데스크톱)
  var calendarMonth = null; // 모바일 월별 캘린더 커서 (Date, day=1)
  var calendarBound = false;

  bindHomeSearch();
  bindBetaToggle();

  function bindHomeSearch() {
    var form = document.getElementById('homeSearchForm');
    var input = document.getElementById('homeSearchInput');
    if (!form || !input) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      window.location.href = 'archive.html' + (q ? '?q=' + encodeURIComponent(q) : '');
    });
  }

  Shared.loadData().then(function (all) {
    allData = all;
    Shared.setRecords(all);
    I18N.setCount(all.length);
    var ready = I18N.getLang() === 'en' ? Shared.ensureEnMerged(all) : Promise.resolve(all);
    ready.then(function () {
      renderAll(all);
      bindLangToggle(all);
    });
  }).catch(function (err) {
    document.getElementById('coverCol').innerHTML = '<div class="home-cover-empty">' + I18N.t('load_error_home') + '</div>';
    console.error(err);
  });

  // All real (non-failed) posts sharing a date, in feed order - shared by
  // the ledger heatmap and the "해마다 오늘의 조식" list, both of which can
  // open a record whose date has more than one post and need the same
  // same-day switcher in the modal.
  function buildSiblingsByDate(all) {
    var siblingsByDate = {};
    all.forEach(function (r) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.failed) return;
      (siblingsByDate[r.date] = siblingsByDate[r.date] || []).push(r);
    });
    return siblingsByDate;
  }

  function renderAll(all) {
    I18N.applyStaticI18n();
    syncBetaToggleLabel();
    randomizeSearchPlaceholder();
    var siblingsByDate = buildSiblingsByDate(all);
    renderMasthead(all);
    var otd = computeOnThisDay(all);
    renderCoverAndList(otd, siblingsByDate);
    renderLedger(all, siblingsByDate);
    renderCalendar(all, siblingsByDate);
    renderTags(all);
    renderCta(all);
  }

  function randomizeSearchPlaceholder() {
    var input = document.getElementById('homeSearchInput');
    if (!input || I18N.getLang() !== 'ko') return;
    var lastIdx = -1;
    try { lastIdx = parseInt(sessionStorage.getItem('homeSearchPromptIdx'), 10); } catch (e) {}
    var idx;
    do { idx = Math.floor(Math.random() * SEARCH_PROMPTS.length); }
    while (SEARCH_PROMPTS.length > 1 && idx === lastIdx);
    input.placeholder = SEARCH_PROMPTS[idx];
    try { sessionStorage.setItem('homeSearchPromptIdx', String(idx)); } catch (e) {}
  }

  function bindBetaToggle() {
    var btn = document.getElementById('betaMoreToggle');
    var caveat = document.getElementById('betaCaveat');
    if (!btn || !caveat) return;
    btn.addEventListener('click', function () {
      var expanded = caveat.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      btn.textContent = I18N.t(expanded ? 'home_beta_less' : 'home_beta_more');
    });
  }

  function syncBetaToggleLabel() {
    var btn = document.getElementById('betaMoreToggle');
    var caveat = document.getElementById('betaCaveat');
    if (!btn || !caveat) return;
    var expanded = !caveat.classList.contains('hidden');
    btn.textContent = I18N.t(expanded ? 'home_beta_less' : 'home_beta_more');
  }

  function bindLangToggle() {
    var box = document.getElementById('langToggle');
    if (!box) return;
    var lang = I18N.getLang();
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
      btn.addEventListener('click', function () {
        var newLang = btn.getAttribute('data-lang');
        I18N.setLang(newLang);
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        if (!allData) return;
        var ready = newLang === 'en' ? Shared.ensureEnMerged(allData) : Promise.resolve(allData);
        ready.then(renderAll);
      });
    });
  }

  function renderMasthead(all) {
    var dated = all.filter(function (r) { return r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date); });
    // Vol. N reflects the actual number of live posts, not the latest
    // diary_no - past backfills/deletions have drifted diary_no away from
    // a true running count, same reason build_public_data.py's stats and
    // the archive page's "stat_total" both count records instead.
    var postCount = all.length;
    var lang = I18N.getLang();
    var now = new Date();
    var dateStr = lang === 'en'
      ? now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    document.getElementById('kickerVol').textContent = 'Vol. ' + postCount;
    document.getElementById('kickerDate').textContent = dateStr;
    document.getElementById('kickerTotal').innerHTML = I18N.t('home_total_label').replace('{count}', '<b>' + all.length.toLocaleString() + '</b>');
  }

  // Same "같은 달/일" 매칭 + 형제 레코드 우선순위 로직 - 커버 스토리와
  // "해마다 오늘의 조식" 목록이 공유한다.
  function computeOnThisDay(all) {
    var today = new Date();
    var mm = today.getMonth() + 1;
    var dd = today.getDate();

    // A "건너뜀" skip marker (failed:true, no real content) is a record
    // but not a post - it should read the same as no record at all here.
    function isExactMatch(r) {
      if (r.failed) return false;
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
      var parts = r.date.split('-');
      return parseInt(parts[1], 10) === mm && parseInt(parts[2], 10) === dd;
    }
    // A handful of dates have two records for the same day - when that
    // happens, prefer whichever one actually has a photo/video over a
    // later one in array order that doesn't, and respect an explicit
    // day_secondary flag marking a record as not the preferred one to show.
    function hasMedia(r) { return !!(r.image || r.gallery || r.video); }
    var byYear = {};
    all.forEach(function (r) {
      if (!isExactMatch(r)) return;
      var y = r.date.slice(0, 4);
      var existing = byYear[y];
      if (!existing || (existing.day_secondary && !r.day_secondary) || (!hasMedia(existing) && hasMedia(r) && !r.day_secondary)) {
        byYear[y] = r;
      }
    });

    // Years the archive actually spans, so a year with no exact-day post
    // still gets a row (with the "no breakfast that day" placeholder)
    // instead of just vanishing from the list.
    var allDates = all.map(function (r) { return r.date; })
      .filter(function (d) { return d && /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
    if (!allDates.length) return { years: [], byYear: {}, mm: mm, dd: dd };
    var minDate = allDates[0];
    var startYear = parseInt(minDate.slice(0, 4), 10);
    var startMM = parseInt(minDate.slice(5, 7), 10);
    var startDD = parseInt(minDate.slice(8, 10), 10);
    var currentYear = today.getFullYear();

    var years = [];
    for (var y = startYear; y <= currentYear; y++) {
      if (y === startYear && (mm < startMM || (mm === startMM && dd < startDD))) continue;
      // Today's own post typically goes up in the morning and only reaches
      // recipes-index.json once the overnight sync runs - skip the
      // placeholder for the current year entirely if it's missing rather
      // than falsely implying no breakfast was made today.
      if (y === currentYear && !byYear[String(y)]) continue;
      years.push(String(y));
    }
    return { years: years, byYear: byYear, mm: mm, dd: dd };
  }

  function pickHero(otd) {
    if (HERO_SELECTION_RULE === 'latest') {
      for (var i = otd.years.length - 1; i >= 0; i--) {
        if (otd.byYear[otd.years[i]]) return otd.years[i];
      }
    }
    return null;
  }

  function renderCoverAndList(otd, siblingsByDate) {
    var lang = I18N.getLang();
    var coverCol = document.getElementById('coverCol');
    var listCol = document.getElementById('otdListCol');

    if (!otd.years.length) {
      coverCol.innerHTML = '';
      listCol.innerHTML = '';
      return;
    }

    var heroYear = pickHero(otd);
    var hero = heroYear ? otd.byYear[heroYear] : null;

    if (hero) {
      var dd = String(otd.dd);
      var monthNames = lang === 'en'
        ? ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
        : ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
      var mLabel = monthNames[parseInt(hero.date.slice(5, 7), 10) - 1];
      var koTitle = hero.title || I18N.t('untitled_fallback');
      var heroTitleHtml = Shared.hasStaticEn(hero, 'title')
        ? Shared.escapeHtml(Shared.localizedText(hero, 'title'))
        : '<span class="i18n-dyn" data-ko="' + Shared.escapeHtml(koTitle) + '">' + Shared.escapeHtml(koTitle) + '</span>';
      coverCol.innerHTML =
        '<div class="home-cover-photo">' + Shared.thumbHTML(hero, 32) +
        '<div class="home-cover-stamp"><span class="num">' + Shared.escapeHtml(dd) + '</span>' +
        '<span class="label">' + Shared.escapeHtml(mLabel) + '<br>ON THIS DAY</span></div></div>' +
        '<div class="home-cover-body">' +
        '<span class="home-cover-eyebrow">' + Shared.escapeHtml(heroYear) + (lang === 'en' ? ' · Cover story' : ' · 커버 스토리') + '</span>' +
        '<h2 class="home-cover-title">' + heroTitleHtml + '</h2>' +
        '<a class="home-cover-link" href="' + Shared.escapeHtml(Shared.recipeUrl(hero)) + '">' + (lang === 'en' ? 'View recipe →' : '레시피 보기 →') + '</a>' +
        '</div>';
      var photoImg = coverCol.querySelector('.home-cover-photo img');
      if (photoImg) photoImg.setAttribute('fetchpriority', 'high');
      I18N.applyDynamicTranslations(coverCol);
    } else {
      coverCol.innerHTML = '';
    }

    var count = otd.years.filter(function (y) { return otd.byYear[y]; }).length;
    var rows = otd.years.map(function (y) {
      var r = otd.byYear[y];
      var yearLabel = lang === 'en' ? y : (y + '년');
      if (!r) {
        return '<div class="home-otd-row otd-empty-row"><span class="home-otd-year">' + Shared.escapeHtml(y.slice(2)) + '</span>' +
          '<span class="home-otd-title">' + (lang === 'en' ? 'No breakfast that day' : '조식이 없었어요') + '</span></div>';
      }
      var isCover = y === heroYear;
      var koTitle = r.title || I18N.t('untitled_fallback');
      var titleHtml = Shared.hasStaticEn(r, 'title')
        ? Shared.escapeHtml(Shared.localizedText(r, 'title'))
        : '<span class="i18n-dyn" data-ko="' + Shared.escapeHtml(koTitle) + '">' + Shared.escapeHtml(koTitle) + '</span>';
      var siblingCount = (siblingsByDate[r.date] || []).length;
      var sibHtml = siblingCount > 1
        ? '<span class="home-otd-sib">· ' + (lang === 'en' ? siblingCount + ' posts' : siblingCount + '개') + '</span>'
        : '';
      return '<a class="home-otd-row' + (isCover ? ' is-cover' : '') + '" href="' + Shared.escapeHtml(Shared.recipeUrl(r)) + '" data-year="' + y + '">' +
        '<span class="home-otd-year">' + Shared.escapeHtml(yearLabel) + '</span>' +
        '<span class="home-otd-title">' + titleHtml + sibHtml + '</span>' +
        Shared.thumbHTML(r, 20) +
        '</a>';
    }).join('');

    listCol.innerHTML =
      '<div class="home-otdlist-head"><h2 data-i18n="otd_title">해마다 오늘의 조식</h2>' +
      '<span>' + count + (lang === 'en' ? ' posts' : '편') + '</span></div>' + rows;
    I18N.applyStaticI18n(listCol);
    I18N.applyDynamicTranslations(listCol);

    Array.prototype.forEach.call(listCol.querySelectorAll('.home-otd-row:not(.otd-empty-row)'), function (el) {
      var y = el.getAttribute('data-year');
      el.addEventListener('click', function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        Shared.openModal(otd.byYear[y], { siblingsByDate: siblingsByDate });
      });
    });
  }

  function renderLedger(all, siblingsByDate) {
    var lang = I18N.getLang();
    var postedDates = new Set();
    var failedDates = new Set();
    all.forEach(function (r) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
      if (r.failed) failedDates.add(r.date); else postedDates.add(r.date);
    });

    var recordByDate = {};
    var postCounts = {}; // real (non-failed) post count per date, for the "+N" badge on days with more than one
    Object.keys(siblingsByDate).forEach(function (d) { postCounts[d] = siblingsByDate[d].length; });
    all.forEach(function (r) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
      // prefer a successful entry over a failed one when a day has both,
      // and prefer a non-day_secondary entry when a day has multiple posts
      var existing = recordByDate[r.date];
      if (!existing || (existing.failed && !r.failed) || (existing.day_secondary && !r.day_secondary)) {
        recordByDate[r.date] = r;
      }
    });

    var dated = Array.from(postedDates).concat(Array.from(failedDates)).sort();
    if (dated.length === 0) return;

    var start = new Date(dated[0] + 'T00:00:00');
    var end = new Date();
    var startAligned = new Date(start);
    startAligned.setDate(startAligned.getDate() - startAligned.getDay());

    var weeks = [];
    var cur = new Date(startAligned);
    var week = [];
    var todayKey = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');

    while (cur <= end) {
      var key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
      var status = 'empty';
      if (cur >= start && cur <= end) {
        // A day marked "건너뜀" via the admin tool has a real record but no
        // actual content - visually it should read the same as a day with
        // no record at all, not stand out as a distinct "실패기" color.
        status = postedDates.has(key) ? 'posted' : 'missed';
      } else {
        status = 'pad';
      }
      week.push({ key: key, status: status, year: cur.getFullYear(), isToday: key === todayKey });
      if (week.length === 7) { weeks.push(week); week = []; }
      cur.setDate(cur.getDate() + 1);
    }
    if (week.length) {
      while (week.length < 7) week.push({ key: '', status: 'pad', year: null });
      weeks.push(week);
    }

    // 연도 탭
    var years = [];
    for (var y = start.getFullYear(); y <= end.getFullYear(); y++) years.push(String(y));
    if (selectedYear === null || years.indexOf(selectedYear) === -1) selectedYear = String(end.getFullYear());
    var tabsEl = document.getElementById('yearTabs');
    tabsEl.innerHTML = years.map(function (yy) {
      return '<button type="button" data-year="' + yy + '" class="' + (yy === selectedYear ? 'active' : '') + '">' + yy + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        selectedYear = btn.getAttribute('data-year');
        renderLedger(all, siblingsByDate);
      });
    });

    var monthNames = lang === 'en'
      ? ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
      : ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    document.getElementById('monthLabels').innerHTML = monthNames.map(function (m) { return '<span>' + m + '</span>'; }).join('');

    var gridEl = document.getElementById('ledgerGrid');
    gridEl.innerHTML = '';

    var tooltip = document.getElementById('ledgerTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'ledgerTooltip';
      tooltip.className = 'ledger-tooltip hidden';
      document.getElementById('ledgerSection').appendChild(tooltip);
    }

    var labelFor = {
      posted: lang === 'en' ? 'Made it' : '조식',
      missed: lang === 'en' ? 'Breakfast skipped' : '조식 건너뜀'
    };
    function formatDate(key) {
      var parts = key.split('-');
      return parts[0] + '.' + Number(parts[1]) + '.' + Number(parts[2]) + '.';
    }
    function showTooltip(cell, key, status, n) {
      if (status !== 'posted' || !key) return;
      var label = labelFor[status] || '';
      if (n > 1) label += ' · ' + (lang === 'en' ? n + ' posts' : n + '개');
      tooltip.textContent = formatDate(key) + ' · ' + label;
      tooltip.classList.remove('hidden');
      var wrapRect = document.getElementById('ledgerSection').getBoundingClientRect();
      var cellRect = cell.getBoundingClientRect();
      tooltip.style.left = (cellRect.left - wrapRect.left + cellRect.width / 2) + 'px';
      tooltip.style.top = (cellRect.top - wrapRect.top - 8) + 'px';
    }
    function hideTooltip() { tooltip.classList.add('hidden'); }

    var postedInYear = 0, totalInYear = 0;
    weeks.forEach(function (w) {
      var col = document.createElement('div');
      col.className = 'home-ledger-col';
      w.forEach(function (day) {
        var n = day.key ? (postCounts[day.key] || 0) : 0;
        // Only an actual post is a real control - a real <button> gets
        // keyboard focus + activation for free, where a plain <div> with
        // just a click handler is invisible to keyboard/screen-reader users.
        var isActionable = day.status === 'posted';
        var cell = document.createElement(isActionable ? 'button' : 'div');
        if (isActionable) cell.type = 'button';
        var inSelectedYear = day.year === parseInt(selectedYear, 10);
        var cls = 'home-ledger-cell';
        if (day.status === 'posted') cls += n > 1 ? ' posted multi' : ' posted';
        else if (day.status === 'missed') cls += ' missed';
        if (day.isToday) cls += ' today';
        if (day.year != null && !inSelectedYear) cls += ' dim';
        cell.className = cls;
        if (day.status === 'posted' && n > 1) cell.textContent = n;
        if (day.year === parseInt(selectedYear, 10)) { totalInYear++; if (day.status === 'posted') postedInYear++; }

        if (day.status !== 'pad' && day.key) {
          cell.addEventListener('mouseenter', function () { showTooltip(cell, day.key, day.status, n); });
          cell.addEventListener('mouseleave', hideTooltip);

          var longPressTimer = null;
          var longPressFired = false;
          cell.addEventListener('touchstart', function () {
            longPressFired = false;
            longPressTimer = setTimeout(function () {
              longPressFired = true;
              showTooltip(cell, day.key, day.status, n);
            }, 450);
          });
          cell.addEventListener('touchend', function (e) {
            clearTimeout(longPressTimer);
            if (longPressFired) { e.preventDefault(); hideTooltip(); longPressFired = false; }
          });
          cell.addEventListener('touchmove', function () { clearTimeout(longPressTimer); longPressFired = false; hideTooltip(); });
          cell.addEventListener('touchcancel', function () { clearTimeout(longPressTimer); longPressFired = false; hideTooltip(); });

          if (isActionable) {
            var rec = recordByDate[day.key];
            var label = labelFor[day.status] || '';
            if (n > 1) label += ' · ' + (lang === 'en' ? n + ' posts' : n + '개');
            cell.setAttribute('aria-label', formatDate(day.key) + ' · ' + label);
            cell.addEventListener('focus', function () { showTooltip(cell, day.key, day.status, n); });
            cell.addEventListener('blur', hideTooltip);
            cell.addEventListener('click', function () {
              hideTooltip();
              Shared.openModal(rec, { siblingsByDate: siblingsByDate });
            });
          }
        }
        col.appendChild(cell);
      });
      gridEl.appendChild(col);
    });

    var pct = totalInYear ? Math.round((postedInYear / totalInYear) * 100) : 0;
    document.getElementById('ledgerPct').textContent = pct + '%';
    document.getElementById('ledgerSub').textContent = lang === 'en'
      ? (selectedYear + ' · ' + postedInYear + ' of ' + totalInYear + ' days')
      : (selectedYear + '년 ' + totalInYear + '일 가운데 ' + postedInYear + '일, 아침을 만들었습니다.');

    var scrollWrap = document.querySelector('.home-ledger-scroll');
    if (scrollWrap) requestAnimationFrame(function () { scrollWrap.scrollLeft = scrollWrap.scrollWidth; });
  }

  // Mobile-only month calendar (docs/Handoff/B-Mobile.dc.html) - shows one
  // month at a time with prev/next navigation, same posted/missed/multi/
  // today states as the desktop week-grid, computed independently here so
  // it stays simple even though it duplicates renderLedger()'s per-date scan.
  function renderCalendar(all, siblingsByDate) {
    var lang = I18N.getLang();
    var postedDates = new Set();
    var recordByDate = {};
    var postCounts = {};
    Object.keys(siblingsByDate).forEach(function (d) { postCounts[d] = siblingsByDate[d].length; });
    all.forEach(function (r) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
      if (!r.failed) postedDates.add(r.date);
      var existing = recordByDate[r.date];
      if (!existing || (existing.failed && !r.failed) || (existing.day_secondary && !r.day_secondary)) {
        recordByDate[r.date] = r;
      }
    });
    var dated = Array.from(postedDates).sort();
    if (!dated.length) return;
    var minDate = new Date(dated[0] + 'T00:00:00');
    var today = new Date();
    if (!calendarMonth) calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var todayKey = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());

    var weekdayNames = lang === 'en' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['일', '월', '화', '수', '목', '금', '토'];
    document.getElementById('calWeekdays').innerHTML = weekdayNames.map(function (w) { return '<span>' + w + '</span>'; }).join('');

    var y = calendarMonth.getFullYear();
    var m = calendarMonth.getMonth();
    var monthNames = lang === 'en'
      ? ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
      : ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    document.getElementById('calLabel').textContent = lang === 'en' ? (monthNames[m] + ' ' + y) : (y + '년 ' + monthNames[m]);

    var firstDow = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var cells = [];
    for (var i = 0; i < firstDow; i++) cells.push(null);
    for (var d = 1; d <= daysInMonth; d++) cells.push({ key: y + '-' + pad(m + 1) + '-' + pad(d), day: d });

    var gridEl = document.getElementById('calGrid');
    gridEl.innerHTML = '';
    cells.forEach(function (c) {
      if (!c) {
        var pad = document.createElement('div');
        pad.className = 'home-calendar-cell empty';
        gridEl.appendChild(pad);
        return;
      }
      var cellDate = new Date(c.key + 'T00:00:00');
      var inRange = cellDate >= minDate && cellDate <= today;
      var n = postCounts[c.key] || 0;
      var isActionable = inRange && postedDates.has(c.key);
      var cell = document.createElement(isActionable ? 'button' : 'div');
      if (isActionable) cell.type = 'button';
      var cls = 'home-calendar-cell';
      if (inRange) cls += postedDates.has(c.key) ? (n > 1 ? ' posted multi' : ' posted') : ' missed';
      if (c.key === todayKey) cls += ' today';
      cell.className = cls;
      cell.textContent = n > 1 ? n : c.day;
      if (isActionable) {
        var rec = recordByDate[c.key];
        var label = n > 1 ? (lang === 'en' ? n + ' posts' : n + '개') : (lang === 'en' ? 'Made it' : '조식');
        cell.setAttribute('aria-label', c.key + ' · ' + label);
        cell.addEventListener('click', function () { Shared.openModal(rec, { siblingsByDate: siblingsByDate }); });
      }
      gridEl.appendChild(cell);
    });

    var prevBtn = document.getElementById('calPrev');
    var nextBtn = document.getElementById('calNext');
    prevBtn.disabled = (y === minDate.getFullYear() && m === minDate.getMonth());
    nextBtn.disabled = (y === today.getFullYear() && m === today.getMonth());

    if (!calendarBound) {
      calendarBound = true;
      prevBtn.addEventListener('click', function () {
        if (prevBtn.disabled) return;
        calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
        renderCalendar(allData, siblingsByDate);
      });
      nextBtn.addEventListener('click', function () {
        if (nextBtn.disabled) return;
        calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
        renderCalendar(allData, siblingsByDate);
      });
    }
  }

  function renderTags(all) {
    var counts = {};
    all.forEach(function (r) { (r.hashtags || []).forEach(function (h) { counts[h] = (counts[h] || 0) + 1; }); });
    var lang = I18N.getLang();
    var html = COLLECTIONS.map(function (c, i) {
      var n = counts[c.tag] || 0;
      return '<a class="home-tag-row" href="archive.html?tag=' + encodeURIComponent(c.tag) + '">' +
        '<span class="home-tag-no">0' + (i + 1) + '</span>' +
        '<span class="home-tag-name">' + Shared.escapeHtml(I18N.collectionLabel(c.label)) + '</span>' +
        '<span class="home-tag-count">' + n + I18N.t('col_records_suffix') + '</span></a>';
    }).join('');
    document.getElementById('tagsList').innerHTML = html;
  }

  function renderCta(all) {
    var pickable = all.filter(function (r) { return !r.failed; });
    document.getElementById('shuffleDesc').textContent = I18N.t('shuffle_desc').replace('{count}', all.length.toLocaleString());
    var cta = document.getElementById('shuffleCta');
    if (cta.dataset.bound) return;
    cta.dataset.bound = '1';
    cta.addEventListener('click', function () {
      var pick = pickable[Math.floor(Math.random() * pickable.length)];
      Shared.openModal(pick, {});
    });
  }
})();
