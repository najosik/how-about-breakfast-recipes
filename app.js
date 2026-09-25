(function () {
  'use strict';

  var CAL_MIN = 0, CAL_MAX = 900, CAL_STEP = 50;

  var state = {
    all: [],
    filtered: [],
    query: '',
    activeTags: new Set(),
    excludedYears: new Set(), // years unchecked in the sidebar (default: none, i.e. all included)
    // { mm, dd } or null - no sidebar control for this anymore, but recipe
    // pages' "다른 해 같은 날" widget still deep-links to archive.html?date=
    // MM-DD, so the ?date= param is still honored on load.
    dateFilter: null,
    calOn: false,
    calMin: CAL_MIN,
    calMax: CAL_MAX,
    sort: 'new',
    viewMode: 'grid',
    page: 0,
    pageSize: 24
  };

  var grid = document.getElementById('grid');
  var resultCount = document.getElementById('resultCount');
  var emptyState = document.getElementById('emptyState');
  var loadMoreBtn = document.getElementById('loadMoreBtn');
  var tagCloud = document.getElementById('tagCloud');
  var arcCountMeta = document.getElementById('arcCountMeta');
  var searchForm = document.getElementById('archiveSearchForm');
  var searchInput = document.getElementById('searchInput');
  var sortSel = document.getElementById('sortSel');
  var calToggle = document.getElementById('calToggle');
  var calMinRange = document.getElementById('calMinRange');
  var calMaxRange = document.getElementById('calMaxRange');
  var calMinLabel = document.getElementById('calMinLabel');
  var calMaxLabel = document.getElementById('calMaxLabel');
  var calFill = document.getElementById('calFill');
  var langToggle = document.getElementById('langToggle');
  var yearChecksEl = document.getElementById('yearChecks');
  var clearFiltersBtn = document.getElementById('clearFiltersBtn');
  var viewGridBtn = document.getElementById('viewGridBtn');
  var viewListBtn = document.getElementById('viewListBtn');
  var openFiltersBtn = document.getElementById('openFiltersBtn');
  var closeFiltersBtn = document.getElementById('closeFiltersBtn');
  var sheetScrim = document.getElementById('sheetScrim');
  var arcFilters = document.getElementById('arcFilters');
  var mobileChips = document.getElementById('mobileChips');
  var filterCountBadge = document.getElementById('filterCountBadge');

  var params = new URLSearchParams(location.search);

  Shared.loadData()
    .then(function (data) {
      // A "건너뜀" skip marker (failed:true, no real content - added via
      // the admin tool's "빠진 날짜" skip action) records that a day was
      // skipped; it isn't a post, so it shouldn't appear in the archive
      // grid at all.
      data = data.filter(function (r) { return !r.failed; });
      state.all = data;
      return I18N.getLang() === 'en' ? Shared.ensureEnMerged(data) : data;
    })
    .then(function () {
      init();
    })
    .catch(function (err) {
      grid.innerHTML = '<div class="empty">' + I18N.t('load_error_archive') + '</div>';
      console.error(err);
    });

  function init() {
    I18N.applyStaticI18n();
    bindLangToggle();
    renderCountMeta();
    renderYearChecks();
    renderTagCloud();
    updateCalUI();
    bindEvents();
    bindSheet();

    var tagParams = params.getAll('tag');
    tagParams.forEach(function (t) { state.activeTags.add(t); });
    if (params.get('q')) { state.query = params.get('q').toLowerCase(); searchInput.value = params.get('q'); }
    if (params.get('sort')) { state.sort = params.get('sort'); sortSel.value = state.sort; }
    if (params.get('view') === 'list') setViewMode('list');
    if (params.get('cal')) {
      var parts = params.get('cal').split('-');
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        state.calOn = true;
        state.calMin = clampCal(parseInt(parts[0], 10));
        state.calMax = clampCal(parseInt(parts[1], 10));
        calToggle.checked = true;
      }
    }
    if (params.get('date')) {
      var dparts = params.get('date').split('-');
      if (dparts.length === 2) {
        var mm = parseInt(dparts[0], 10), dd = parseInt(dparts[1], 10);
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) state.dateFilter = { mm: mm, dd: dd };
      }
    }
    var yearsExcluded = params.getAll('yx');
    yearsExcluded.forEach(function (y) { state.excludedYears.add(y); });

    updateCalUI();

    applyFilters();
    if (tagParams.length) {
      Array.prototype.forEach.call(tagCloud.querySelectorAll('.tag-chip'), function (c) {
        if (tagParams.indexOf(c.getAttribute('data-tag')) !== -1) { c.classList.add('active'); c.setAttribute('aria-pressed', 'true'); }
      });
    }
    Array.prototype.forEach.call(yearChecksEl.querySelectorAll('input'), function (cb) {
      if (state.excludedYears.has(cb.value)) cb.checked = false;
    });
  }

  // Keeps the address bar in sync with every filter/sort/view state so the
  // URL on screen is always a valid, copy-pasteable link back to the same
  // filtered results.
  function syncUrl() {
    var p = new URLSearchParams();
    var q = searchInput.value.trim();
    if (q) p.set('q', q);
    state.activeTags.forEach(function (tag) { p.append('tag', tag); });
    state.excludedYears.forEach(function (y) { p.append('yx', y); });
    if (state.calOn) p.set('cal', state.calMin + '-' + state.calMax);
    if (state.dateFilter) p.set('date', pad(state.dateFilter.mm) + '-' + pad(state.dateFilter.dd));
    if (state.sort !== 'new') p.set('sort', state.sort);
    if (state.viewMode !== 'grid') p.set('view', state.viewMode);
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clampCal(n) { return Math.max(CAL_MIN, Math.min(CAL_MAX, n)); }

  function bindLangToggle() {
    if (!langToggle) return;
    var lang = I18N.getLang();
    Array.prototype.forEach.call(langToggle.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
      btn.addEventListener('click', function () {
        var newLang = btn.getAttribute('data-lang');
        I18N.setLang(newLang);
        Array.prototype.forEach.call(langToggle.querySelectorAll('button'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        I18N.applyStaticI18n();
        renderCountMeta();
        renderYearChecks();
        renderTagCloud();
        updateCalUI();
        // re-mark active tag chips after rebuilding the cloud
        state.activeTags.forEach(function (tag) {
          var chip = tagCloud.querySelector('.tag-chip[data-tag="' + tag + '"]');
          if (chip) { chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true'); }
        });
        Array.prototype.forEach.call(yearChecksEl.querySelectorAll('input'), function (cb) {
          if (state.excludedYears.has(cb.value)) cb.checked = false;
        });
        renderMobileChips();
        var ready = newLang === 'en' ? Shared.ensureEnMerged(state.all) : Promise.resolve(state.all);
        ready.then(renderGrid);
      });
    });
  }

  function renderCountMeta() {
    var dates = state.all.map(function (r) { return r.date; }).filter(Boolean).sort();
    var first = dates[0] ? dates[0].slice(0, 4) : '?';
    var last = dates[dates.length - 1] ? dates[dates.length - 1].slice(0, 4) : '?';
    var lang = I18N.getLang();
    arcCountMeta.textContent = state.all.length.toLocaleString() + (lang === 'en' ? ' entries · ' : '개 · ') + first + '—' + last;
  }

  function yearOf(r) { return r.date ? r.date.slice(0, 4) : null; }

  function renderYearChecks() {
    var counts = {};
    state.all.forEach(function (r) { var y = yearOf(r); if (y) counts[y] = (counts[y] || 0) + 1; });
    var years = Object.keys(counts).sort(function (a, b) { return b.localeCompare(a); });
    var lang = I18N.getLang();
    yearChecksEl.innerHTML = years.map(function (y) {
      return '<label><input type="checkbox" checked value="' + y + '">' + y + (lang === 'en' ? '' : '년') +
        '<span class="arc-year-count">' + counts[y] + '</span></label>';
    }).join('');
    Array.prototype.forEach.call(yearChecksEl.querySelectorAll('input'), function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) state.excludedYears.delete(cb.value); else state.excludedYears.add(cb.value);
        state.page = 0;
        applyFilters();
      });
    });
  }

  function renderTagCloud() {
    var top = Shared.tagFrequency(state.all, 20);
    tagCloud.innerHTML = '';
    top.forEach(function (pair) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.setAttribute('data-tag', pair[0]);
      chip.textContent = '#' + I18N.tagLabel(pair[0]);
      chip.setAttribute('aria-pressed', state.activeTags.has(pair[0]) ? 'true' : 'false');
      if (state.activeTags.has(pair[0])) chip.classList.add('active');
      chip.addEventListener('click', function () {
        toggleTag(pair[0]);
      });
      tagCloud.appendChild(chip);
    });
  }

  function toggleTag(tag) {
    var chip = tagCloud.querySelector('.tag-chip[data-tag="' + tag + '"]');
    if (state.activeTags.has(tag)) {
      state.activeTags.delete(tag);
      if (chip) { chip.classList.remove('active'); chip.setAttribute('aria-pressed', 'false'); }
    } else {
      state.activeTags.add(tag);
      if (chip) { chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true'); }
    }
    state.page = 0;
    applyFilters();
  }

  function updateCalUI() {
    if (state.calMin > state.calMax) state.calMin = state.calMax;
    calMinRange.value = String(state.calMin);
    calMaxRange.value = String(state.calMax);
    calToggle.checked = state.calOn;
    var lang = I18N.getLang();
    calMinLabel.textContent = state.calMin;
    calMaxLabel.textContent = state.calMax >= CAL_MAX ? (CAL_MAX + 'kcal+') : (state.calMax + 'kcal');
    var pctMin = (state.calMin - CAL_MIN) / (CAL_MAX - CAL_MIN) * 100;
    var pctMax = (state.calMax - CAL_MIN) / (CAL_MAX - CAL_MIN) * 100;
    calFill.style.left = pctMin + '%';
    calFill.style.width = (pctMax - pctMin) + '%';
  }

  function renderMobileChips() {
    var chips = [];
    if (state.calOn) chips.push({ key: 'cal', label: state.calMin + '–' + state.calMax + 'kcal' });
    state.activeTags.forEach(function (t) { chips.push({ key: 'tag:' + t, label: '#' + I18N.tagLabel(t) }); });

    mobileChips.innerHTML = chips.map(function (c) {
      return '<button type="button" class="arc-chip" data-chip="' + Shared.escapeHtml(c.key) + '">' + Shared.escapeHtml(c.label) + ' ✕</button>';
    }).join('');
    Array.prototype.forEach.call(mobileChips.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-chip');
        if (key === 'cal') { state.calOn = false; updateCalUI(); }
        else if (key.indexOf('tag:') === 0) { toggleTag(key.slice(4)); return; }
        state.page = 0;
        applyFilters();
      });
    });

    var activeGroups = (state.dateFilter ? 1 : 0) + (state.calOn ? 1 : 0) +
      (state.activeTags.size ? 1 : 0) + (state.excludedYears.size ? 1 : 0);
    filterCountBadge.textContent = String(activeGroups);
    filterCountBadge.classList.toggle('hidden', activeGroups === 0);
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    grid.classList.toggle('list-view', mode === 'list');
    viewGridBtn.setAttribute('aria-pressed', mode === 'grid' ? 'true' : 'false');
    viewListBtn.setAttribute('aria-pressed', mode === 'list' ? 'true' : 'false');
  }

  function clearAllFilters() {
    state.query = '';
    searchInput.value = '';
    state.activeTags.clear();
    state.excludedYears.clear();
    state.dateFilter = null;
    state.calOn = false;
    state.calMin = CAL_MIN;
    state.calMax = CAL_MAX;
    state.sort = 'new';
    sortSel.value = 'new';
    state.page = 0;

    renderTagCloud();
    Array.prototype.forEach.call(yearChecksEl.querySelectorAll('input'), function (cb) { cb.checked = true; });
    updateCalUI();
    renderMobileChips();
    applyFilters();
  }

  function bindEvents() {
    var t;
    searchInput.addEventListener('input', function () {
      clearTimeout(t);
      var v = searchInput.value;
      t = setTimeout(function () {
        state.query = v.trim().toLowerCase();
        state.page = 0;
        applyFilters();
      }, 180);
    });
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(t);
      state.query = searchInput.value.trim().toLowerCase();
      state.page = 0;
      applyFilters();
    });

    sortSel.addEventListener('change', function () {
      state.sort = sortSel.value;
      state.page = 0;
      applyFilters();
    });

    calToggle.addEventListener('change', function () {
      state.calOn = calToggle.checked;
      state.page = 0;
      applyFilters();
      renderMobileChips();
    });
    calMinRange.addEventListener('input', function () {
      var v = clampCal(parseInt(calMinRange.value, 10));
      if (v > state.calMax) v = state.calMax;
      state.calMin = v;
      updateCalUI();
      if (state.calOn) { state.page = 0; applyFilters(); }
    });
    calMaxRange.addEventListener('input', function () {
      var v = clampCal(parseInt(calMaxRange.value, 10));
      if (v < state.calMin) v = state.calMin;
      state.calMax = v;
      updateCalUI();
      if (state.calOn) { state.page = 0; applyFilters(); }
    });
    calMinRange.addEventListener('change', renderMobileChips);
    calMaxRange.addEventListener('change', renderMobileChips);

    clearFiltersBtn.addEventListener('click', clearAllFilters);

    viewGridBtn.addEventListener('click', function () { setViewMode('grid'); syncUrl(); });
    viewListBtn.addEventListener('click', function () { setViewMode('list'); syncUrl(); });

    loadMoreBtn.addEventListener('click', function () {
      state.page += 1;
      renderGrid();
    });
  }

  // Mobile bottom sheet - #arcFilters is the same sidebar element repositioned
  // via CSS under ~640px; opening/closing just toggles visibility + a scrim,
  // with focus moved in/out and Escape/outside-click to close.
  function bindSheet() {
    if (!openFiltersBtn) return;
    function openSheet() {
      arcFilters.classList.add('open');
      sheetScrim.classList.remove('hidden');
      sheetScrim.classList.add('open');
      openFiltersBtn.setAttribute('aria-expanded', 'true');
      closeFiltersBtn.focus();
    }
    function closeSheet() {
      arcFilters.classList.remove('open');
      sheetScrim.classList.add('hidden');
      sheetScrim.classList.remove('open');
      openFiltersBtn.setAttribute('aria-expanded', 'false');
      openFiltersBtn.focus();
    }
    openFiltersBtn.addEventListener('click', openSheet);
    closeFiltersBtn.addEventListener('click', closeSheet);
    sheetScrim.addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && arcFilters.classList.contains('open')) closeSheet();
    });
  }

  function matchesQuery(r, q) {
    if (!q) return true;
    var hay = [r.title, r.intro, r.ingredients, r.steps, r.weather, (r.hashtags || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function matchesDate(r, filter) {
    if (!filter || !r.date) return !filter;
    var parts = r.date.split('-');
    return parseInt(parts[1], 10) === filter.mm && parseInt(parts[2], 10) === filter.dd;
  }

  function applyFilters() {
    syncUrl();
    renderMobileChips();
    var q = state.query;
    var tags = state.activeTags;
    var list = state.all.filter(function (r) {
      if (!matchesQuery(r, q)) return false;
      if (tags.size > 0) {
        var rtags = new Set(r.hashtags || []);
        var any = false;
        tags.forEach(function (t) { if (rtags.has(t)) any = true; });
        if (!any) return false;
      }
      if (state.excludedYears.size > 0) {
        var y = yearOf(r);
        if (y && state.excludedYears.has(y)) return false;
      }
      if (state.dateFilter && !matchesDate(r, state.dateFilter)) return false;
      if (state.calOn) {
        if (r.calories == null || r.calories < state.calMin || r.calories > state.calMax) return false;
      }
      return true;
    });

    list.sort(function (a, b) {
      switch (state.sort) {
        case 'old': return (a.date || '').localeCompare(b.date || '');
        case 'kcal_asc': return (a.calories == null ? 1e9 : a.calories) - (b.calories == null ? 1e9 : b.calories);
        case 'kcal_desc': return (b.calories == null ? -1 : b.calories) - (a.calories == null ? -1 : a.calories);
        case 'new':
        default: return (b.date || '').localeCompare(a.date || '');
      }
    });

    state.filtered = list;
    renderGrid();
  }

  function renderGrid() {
    var end = (state.page + 1) * state.pageSize;
    var slice = state.filtered.slice(0, end);

    resultCount.textContent = state.filtered.length.toLocaleString() + I18N.t('result_count');

    if (state.filtered.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      loadMoreBtn.classList.add('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    grid.innerHTML = slice.map(Shared.cardHTML).join('');
    Shared.bindCardClicks(grid, slice);
    loadMoreBtn.classList.toggle('hidden', end >= state.filtered.length);
  }
})();
