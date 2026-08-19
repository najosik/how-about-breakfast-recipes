(function () {
  'use strict';

  var COLLECTIONS = [
    { label: '토마토 특집', tag: '토마토', cls: 'c-teal' },
    { label: '아보카도 아카이브', tag: '아보카도', cls: 'c-ink' },
    { label: '파스타 & 누들', tag: '파스타', cls: 'c-teal' },
    { label: '감자 요리 모음', tag: '감자', cls: 'c-ink' },
    { label: '계란 한 알의 힘', tag: '계란', cls: 'c-teal' },
    { label: '오픈샌드위치 특집', tag: '샌드위치', cls: 'c-ink' },
    { label: '샐러드 특집', tag: '샐러드', cls: 'c-teal' },
    { label: '가지 요리 모음', tag: '가지', cls: 'c-ink' }
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

  bindHomeSearch();

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
    I18N.setCount(all.length);
    var ready = I18N.getLang() === 'en' ? Shared.ensureEnMerged(all) : Promise.resolve(all);
    ready.then(function () {
      renderAll(all);
      bindShuffle(all);
      bindLangToggle(all);
    });
  }).catch(function (err) {
    document.getElementById('ledgerWrap').innerHTML =
      '<div class="empty">' + I18N.t('load_error_home') + '</div>';
    console.error(err);
  });

  function renderAll(all) {
    I18N.applyStaticI18n();
    randomizeSearchPlaceholder();
    renderMasthead(all);
    renderLedger(all);
    renderOnThisDay(all);
    renderCollections(all);
  }

  // Rotates the empty search box's placeholder through a pool of short,
  // search-inviting prompts instead of the same static hint every time -
  // random, but never the same one twice in a row (tracked per tab via
  // sessionStorage). English mode keeps the plain static placeholder
  // (search_placeholder) since these prompts are Korean copy only.
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
        document.getElementById('shuffleResult').classList.add('hidden');
        if (!allData) return;
        var ready = newLang === 'en' ? Shared.ensureEnMerged(allData) : Promise.resolve(allData);
        ready.then(renderAll);
      });
    });
  }

  function renderMasthead(all) {
    var strip = document.getElementById('mastheadIcons');
    if (strip) {
      var demo = [
        { hashtags: ['토마토'] }, { hashtags: ['아보카도'] }, { hashtags: ['계란'] },
        { hashtags: ['파스타'] }, { hashtags: ['샌드위치'] }, { hashtags: ['버섯'] }
      ];
      strip.innerHTML = demo.map(function (d) { return Shared.iconSVG(d, 26); }).join('');
    }

    var dated = all.filter(function (r) { return r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date); });
    var sorted = dated.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var first = sorted[0].date;
    // Vol. N reflects the actual number of live posts, not the latest
    // diary_no - past backfills/deletions have drifted diary_no away from
    // a true running count, same reason build_public_data.py's stats and
    // the archive page's "stat_total" both count records instead.
    var postCount = all.length;

    var firstDate = new Date(first + 'T00:00:00');
    var today = new Date();
    var months = (today.getFullYear() - firstDate.getFullYear()) * 12 + (today.getMonth() - firstDate.getMonth());
    var years = Math.floor(months / 12);
    var remMonths = months % 12;

    var lang = I18N.getLang();
    document.getElementById('kickerVol').textContent = 'Vol. ' + postCount;
    document.getElementById('kickerSince').textContent = first + I18N.t('home_since_suffix');

    var streakHTML = lang === 'en'
      ? '<b>' + years + 'y ' + remMonths + 'm</b> in · ' + all.length.toLocaleString() + ' breakfasts total'
      : '<b>' + years + '년 ' + remMonths + '개월째</b> · 총 ' + all.length.toLocaleString() + '회의 아침';
    document.getElementById('streakText').innerHTML = streakHTML;
  }

  function renderLedger(all) {
    var lang = I18N.getLang();
    var postedDates = new Set();
    var failedDates = new Set();
    all.forEach(function (r) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
      if (r.failed) failedDates.add(r.date); else postedDates.add(r.date);
    });

    var recordByDate = {};
    all.forEach(function (r) {
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
      // prefer a successful entry over a failed one when a day has both
      if (!recordByDate[r.date] || (recordByDate[r.date].failed && !r.failed)) {
        recordByDate[r.date] = r;
      }
    });

    var dated = Array.from(postedDates).concat(Array.from(failedDates)).sort();
    if (dated.length === 0) return;

    var sortedDates = Object.keys(recordByDate).sort();
    var sortedRecords = sortedDates.map(function (d) { return recordByDate[d]; });
    var dateIndex = {};
    sortedDates.forEach(function (d, i) { dateIndex[d] = i; });
    var start = new Date(dated[0] + 'T00:00:00');
    var end = new Date();

    var startAligned = new Date(start);
    startAligned.setDate(startAligned.getDate() - startAligned.getDay());

    var weeks = [];
    var cur = new Date(startAligned);
    var week = [];

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
      week.push({ key: key, status: status, year: cur.getFullYear() });
      if (week.length === 7) { weeks.push(week); week = []; }
      cur.setDate(cur.getDate() + 1);
    }
    if (week.length) {
      while (week.length < 7) week.push({ key: '', status: 'pad', year: null });
      weeks.push(week);
    }

    var gridEl = document.getElementById('ledgerGrid');
    var labelsEl = document.getElementById('ledgerYearLabels');
    gridEl.innerHTML = '';
    labelsEl.innerHTML = '';

    var labelFor = {
      posted: lang === 'en' ? 'Made it' : '조식',
      missed: lang === 'en' ? 'Breakfast skipped' : '조식 건너뜀'
    };

    var tooltip = document.getElementById('ledgerTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'ledgerTooltip';
      tooltip.className = 'ledger-tooltip hidden';
      document.getElementById('ledgerWrap').appendChild(tooltip);
    }

    function showTooltip(cell, day) {
      if (day.status === 'pad' || !day.key) return;
      var label = labelFor[day.status] || '';
      tooltip.textContent = day.key + ' · ' + label;
      tooltip.classList.remove('hidden');
      var wrapRect = document.getElementById('ledgerWrap').getBoundingClientRect();
      var cellRect = cell.getBoundingClientRect();
      var wrap = document.getElementById('ledgerWrap');
      tooltip.style.left = (cellRect.left - wrapRect.left + wrap.scrollLeft + cellRect.width / 2) + 'px';
      tooltip.style.top = (cellRect.top - wrapRect.top - 8) + 'px';
    }
    function hideTooltip() { tooltip.classList.add('hidden'); }

    var yearRuns = [];
    weeks.forEach(function (w) {
      var col = document.createElement('div');
      col.className = 'ledger-col';
      w.forEach(function (day) {
        var cell = document.createElement('div');
        cell.className = 'ledger-cell' + (day.status === 'posted' ? ' posted' : '');
        if (day.status !== 'pad' && day.key) {
          cell.addEventListener('mouseenter', function () { showTooltip(cell, day); });
          cell.addEventListener('mouseleave', hideTooltip);
          var rec = recordByDate[day.key];
          if (rec && day.status === 'posted') {
            cell.classList.add('clickable');
            cell.addEventListener('click', function () {
              hideTooltip();
              Shared.openModal(rec, { list: sortedRecords, index: dateIndex[day.key] });
            });
          }
        }
        col.appendChild(cell);
      });
      gridEl.appendChild(col);

      var repYear = w.find(function (d) { return d.year; });
      var y = repYear ? repYear.year : null;
      if (yearRuns.length && yearRuns[yearRuns.length - 1].year === y) {
        yearRuns[yearRuns.length - 1].count += 1;
      } else if (y != null) {
        yearRuns.push({ year: y, count: 1 });
      } else if (yearRuns.length) {
        yearRuns[yearRuns.length - 1].count += 1;
      }
    });

    yearRuns.forEach(function (run) {
      var lbl = document.createElement('div');
      lbl.style.width = (run.count * 17) + 'px';
      lbl.style.flex = '0 0 auto';
      lbl.textContent = run.year;
      labelsEl.appendChild(lbl);
    });

    var ledgerWrap = document.getElementById('ledgerWrap');
    requestAnimationFrame(function () { ledgerWrap.scrollLeft = ledgerWrap.scrollWidth; });
  }

  function renderOnThisDay(all) {
    var lang = I18N.getLang();
    var today = new Date();
    var mm = today.getMonth() + 1;
    var dd = today.getDate();

    var datePrefixEl = document.getElementById('otdDatePrefix');
    if (datePrefixEl) {
      datePrefixEl.textContent = (lang === 'en' ? (mm + '/' + dd) : (mm + '.' + dd + '.')) + ' ';
    }

    function isExactMatch(r) {
      // A "건너뜀" skip marker (failed:true, no real content) is a record
      // but not a post - it should read the same as no record at all here,
      // not surface as a broken-looking untitled card.
      if (r.failed) return false;
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false;
      var parts = r.date.split('-');
      return parseInt(parts[1], 10) === mm && parseInt(parts[2], 10) === dd;
    }

    var byYear = {};
    all.forEach(function (r) {
      if (!isExactMatch(r)) return;
      byYear[r.date.slice(0, 4)] = r;
    });

    // Years the archive actually spans, so a year with no exact-day post
    // still gets a card (with the "no breakfast that day" placeholder)
    // instead of just vanishing from the row. The very first (partial)
    // year only counts once the diary had actually started.
    var allDates = all.map(function (r) { return r.date; })
      .filter(function (d) { return d && /^\d{4}-\d{2}-\d{2}$/.test(d); })
      .sort();
    var row = document.getElementById('otdRow');
    var section = document.getElementById('otdSection');
    if (!allDates.length) {
      section.classList.add('hidden');
      return;
    }
    var minDate = allDates[0];
    var startYear = parseInt(minDate.slice(0, 4), 10);
    var startMM = parseInt(minDate.slice(5, 7), 10);
    var startDD = parseInt(minDate.slice(8, 10), 10);
    var currentYear = today.getFullYear();

    var years = [];
    for (var y = startYear; y <= currentYear; y++) {
      if (y === startYear && (mm < startMM || (mm === startMM && dd < startDD))) continue;
      // Today's own post typically goes up in the morning and only reaches
      // recipes-index.json once the overnight sync runs - a missing exact
      // match for the current year almost always just means "not synced
      // yet", not an actual skipped day, so skip the placeholder for it
      // entirely rather than falsely implying no breakfast was made today.
      if (y === currentYear && !byYear[String(y)]) continue;
      years.push(String(y));
    }

    if (years.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    row.innerHTML = years.map(function (y) {
      var r = byYear[y];
      var yearLabel = lang === 'en' ? y : (y + '년');
      if (!r) {
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var emptyDate = y + '-' + pad(mm) + '-' + pad(dd);
        return (
          '<div class="otd-card otd-empty" data-year="' + y + '">' +
          '<div class="otd-empty-msg">' +
          '<span class="otd-empty-bang">' + Shared.escapeHtml(I18N.t('otd_empty_bang')) + '</span>' +
          '<span class="otd-empty-sub">' + Shared.escapeHtml(I18N.t('otd_empty_sub')) + '</span>' +
          '</div>' +
          '<div class="otd-year">' + yearLabel + '</div>' +
          '<h4 class="otd-title"><a href="https://brunch.co.kr/@howaboutbfast/4" target="_blank" rel="noopener noreferrer">' +
          Shared.escapeHtml(I18N.t('otd_empty_title')) + '</a></h4>' +
          '<div class="otd-meta">' + emptyDate + '</div>' +
          '</div>'
        );
      }
      var koTitle = r.title || I18N.t('untitled_fallback');
      var titleHtml = Shared.hasStaticEn(r, 'title')
        ? '<h4 class="otd-title">' + Shared.escapeHtml(Shared.localizedText(r, 'title')) + '</h4>'
        : '<h4 class="otd-title i18n-dyn" data-ko="' + Shared.escapeHtml(koTitle) + '">' + Shared.escapeHtml(koTitle) + '</h4>';
      return (
        '<a class="otd-card" href="' + Shared.escapeHtml(Shared.recipeUrl(r)) + '" data-year="' + y + '">' +
        Shared.thumbHTML(r, 24) +
        '<div class="otd-year">' + yearLabel + '</div>' +
        titleHtml +
        '<div class="otd-meta">' + r.date + (r.calories ? ' · ' + r.calories + 'kcal' : '') + '</div>' +
        '</a>'
      );
    }).join('');

    Array.prototype.forEach.call(row.querySelectorAll('.otd-card:not(.otd-empty)'), function (el) {
      var y = el.getAttribute('data-year');
      el.addEventListener('click', function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        Shared.openModal(byYear[y]);
      });
    });
    I18N.applyDynamicTranslations(row);
  }

  function renderCollections(all) {
    var counts = {};
    all.forEach(function (r) { (r.hashtags || []).forEach(function (h) { counts[h] = (counts[h] || 0) + 1; }); });

    var grid = document.getElementById('collectionGrid');
    var cards = COLLECTIONS.map(function (c) {
      var n = counts[c.tag] || 0;
      return (
        '<a class="collection-card ' + c.cls + '" href="archive.html?tag=' + encodeURIComponent(c.tag) + '">' +
        '<span class="collection-icon">' + Shared.iconSVG({ hashtags: [c.tag] }, 26) + '</span>' +
        '<div class="big">' + Shared.escapeHtml(I18N.collectionLabel(c.label)) + '</div>' +
        '<div class="count">' + n + I18N.t('col_records_suffix') + '</div>' +
        '</a>'
      );
    });
    grid.innerHTML = cards.join('');
  }

  function bindShuffle(all) {
    var btn = document.getElementById('shuffleBtn');
    var resultEl = document.getElementById('shuffleResult');
    var spinning = false;

    btn.addEventListener('click', function () {
      if (spinning) return;
      spinning = true;
      btn.disabled = true;
      btn.classList.add('spinning');
      var spinLabel = I18N.getLang() === 'en' ? 'Choosing…' : '고르는 중…';
      var originalLabel = btn.textContent;

      resultEl.classList.remove('hidden');
      resultEl.classList.remove('shuffle-land');

      var finalPick = all[Math.floor(Math.random() * all.length)];

      // decelerating cycle: fast flickers at first, slowing down toward the end
      var delays = [60, 60, 70, 80, 90, 110, 130, 160, 200, 260, 340];
      var step = 0;

      function tick() {
        if (step >= delays.length) {
          // land on the real pick
          resultEl.innerHTML = Shared.cardHTML(finalPick);
          Shared.bindCardClicks(resultEl, [finalPick]);
          resultEl.classList.add('shuffle-land');
          btn.disabled = false;
          btn.classList.remove('spinning');
          btn.textContent = originalLabel;
          spinning = false;
          return;
        }
        var r = all[Math.floor(Math.random() * all.length)];
        resultEl.innerHTML = Shared.cardHTML(r);
        resultEl.classList.add('shuffle-flicker');
        btn.textContent = spinLabel;
        setTimeout(tick, delays[step]);
        step++;
      }
      tick();
    });
  }
})();
