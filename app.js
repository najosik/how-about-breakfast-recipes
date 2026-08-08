(function () {
  'use strict';

  var state = {
    all: [],
    filtered: [],
    query: '',
    activeTags: new Set(),
    onlyFailed: false,
    calOn: false,
    calMax: 600,
    sort: 'new',
    page: 0,
    pageSize: 24
  };

  var grid = document.getElementById('grid');
  var resultCount = document.getElementById('resultCount');
  var emptyState = document.getElementById('emptyState');
  var loadMoreBtn = document.getElementById('loadMoreBtn');
  var tagCloud = document.getElementById('tagCloud');
  var statsRow = document.getElementById('statsRow');
  var searchInput = document.getElementById('searchInput');
  var sortSel = document.getElementById('sortSel');
  var calToggle = document.getElementById('calToggle');
  var calRange = document.getElementById('calRange');
  var calLabel = document.getElementById('calLabel');
  var langToggle = document.getElementById('langToggle');

  var params = new URLSearchParams(location.search);

  Shared.loadData()
    .then(function (data) {
      state.all = data;
      return I18N.getLang() === 'en' ? Shared.ensureEnMerged(data) : data;
    })
    .then(function () {
      init();
    })
    .catch(function (err) {
      grid.innerHTML = '<div class="empty"><b>데이터를 불러오지 못했어요</b>recipes-index.json 파일이 이 페이지와 같은 폴더에 있는지 확인해주세요. (로컬에서 열었다면 <code>python3 -m http.server</code>로 실행해야 fetch가 동작합니다)</div>';
      console.error(err);
    });

  function init() {
    I18N.applyStaticI18n();
    bindLangToggle();
    updateCalLabel();
    renderStats();
    renderTagCloud();
    bindEvents();

    if (params.get('tag')) state.activeTags.add(params.get('tag'));
    if (params.get('q')) { state.query = params.get('q').toLowerCase(); searchInput.value = params.get('q'); }
    if (params.get('failed') === '1') state.onlyFailed = true;

    applyFilters();
    if (params.get('tag')) {
      Array.prototype.forEach.call(tagCloud.querySelectorAll('.tag-chip'), function (c) {
        if (c.getAttribute('data-tag') === params.get('tag')) { c.classList.add('active'); c.setAttribute('aria-pressed', 'true'); }
      });
    }
  }

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
        updateCalLabel();
        renderStats();
        renderTagCloud();
        // re-mark active tag chips after rebuilding the cloud
        state.activeTags.forEach(function (tag) {
          var chip = tagCloud.querySelector('.tag-chip[data-tag="' + tag + '"]');
          if (chip) { chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true'); }
        });
        var ready = newLang === 'en' ? Shared.ensureEnMerged(state.all) : Promise.resolve(state.all);
        ready.then(renderGrid);
      });
    });
  }

  function updateCalLabel() {
    var lang = I18N.getLang();
    calLabel.textContent = lang === 'en'
      ? '≤ ' + state.calMax + 'kcal only'
      : '칼로리 ' + state.calMax + 'kcal만';
  }

  function renderStats() {
    var withRecipe = state.all.filter(function (r) { return r.ingredients; }).length;
    var dates = state.all.map(function (r) { return r.date; }).filter(Boolean).sort();
    var first = dates[0] ? dates[0].slice(0, 7) : '?';
    var last = dates[dates.length - 1] ? dates[dates.length - 1].slice(0, 7) : '?';
    statsRow.innerHTML =
      '<div class="stat"><b>' + state.all.length.toLocaleString() + '</b><span>' + I18N.t('stat_total') + '</span></div>' +
      '<div class="stat"><b>' + withRecipe.toLocaleString() + '</b><span>' + I18N.t('stat_structured') + '</span></div>' +
      '<div class="stat"><b>' + first + ' ~ ' + last + '</b><span>' + I18N.t('stat_range') + '</span></div>';
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
        if (state.activeTags.has(pair[0])) {
          state.activeTags.delete(pair[0]);
          chip.classList.remove('active');
          chip.setAttribute('aria-pressed', 'false');
        } else {
          state.activeTags.add(pair[0]);
          chip.classList.add('active');
          chip.setAttribute('aria-pressed', 'true');
        }
        state.page = 0;
        applyFilters();
      });
      tagCloud.appendChild(chip);
    });
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

    sortSel.addEventListener('change', function () {
      state.sort = sortSel.value;
      state.page = 0;
      applyFilters();
    });

    calToggle.addEventListener('change', function () {
      state.calOn = calToggle.checked;
      state.page = 0;
      applyFilters();
    });

    calRange.addEventListener('input', function () {
      state.calMax = parseInt(calRange.value, 10);
      updateCalLabel();
      if (state.calOn) { state.page = 0; applyFilters(); }
    });

    loadMoreBtn.addEventListener('click', function () {
      state.page += 1;
      renderGrid();
    });
  }

  function matchesQuery(r, q) {
    if (!q) return true;
    var hay = [r.title, r.intro, r.ingredients, r.steps, r.weather, (r.hashtags || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function applyFilters() {
    var q = state.query;
    var tags = state.activeTags;
    var list = state.all.filter(function (r) {
      if (!matchesQuery(r, q)) return false;
      if (state.onlyFailed && !r.failed) return false;
      if (tags.size > 0) {
        var rtags = new Set(r.hashtags || []);
        var any = false;
        tags.forEach(function (t) { if (rtags.has(t)) any = true; });
        if (!any) return false;
      }
      if (state.calOn) {
        if (r.calories == null || r.calories > state.calMax) return false;
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
