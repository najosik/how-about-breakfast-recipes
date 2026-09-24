/* Private Instagram insights dashboard.
 * Reads the JSON files insights/collect_insights.py writes, served by
 * cloudflare-worker/insights-dashboard.js. Every value from the data files
 * is inserted with textContent / setAttribute - never innerHTML - so a
 * caption can never inject markup. */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const IMAGE_ORIGIN = 'https://images.how-about-breakfast.com/';
  const PERMALINK_ORIGIN = 'https://www.instagram.com/';
  const FORMAT_LABELS = { REELS: '릴스', CAROUSEL_ALBUM: '캐러셀', IMAGE: '사진', VIDEO: '동영상' };
  const PAGE_SIZE = 50;

  const state = {
    profile: {}, account: {}, posts: [], meta: {},
    postsShown: PAGE_SIZE, sortKey: 'date', sortDir: -1,
  };

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      // CSSOM, not a style attribute: the CSP forbids inline style attributes
      else if (k === 'bg') node.style.background = v;
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // fill/stroke go through CSSOM so var(--token) works in every browser
  // (and dark mode repaints without a re-render).
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'fill' || k === 'stroke') node.style[k] = v;
      else node.setAttribute(k, v);
    }
    return node;
  }

  const numFmt = new Intl.NumberFormat('ko-KR');
  const compactFmt = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
  const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : numFmt.format(Math.round(v)));
  const fmtCompact = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : compactFmt.format(v));
  const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);
  const fmtRatio = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}×`);
  const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  function isoDay(date) {
    // Calendar date in KST, matching the collector's day keys.
    const kst = new Date(date.getTime() + 9 * 3600 * 1000);
    return kst.toISOString().slice(0, 10);
  }
  function daysAgo(n) {
    return isoDay(new Date(Date.now() - n * 86400 * 1000));
  }
  function sum(values) {
    let total = 0, any = false;
    for (const v of values) if (typeof v === 'number') { total += v; any = true; }
    return any ? total : null;
  }
  function mean(values) {
    const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  // Followers on a given day: the latest snapshot on or before it, falling
  // back to the earliest snapshot for posts older than the collection start.
  let profileDates = [];
  function followersAt(date) {
    if (!profileDates.length) return null;
    let found = null;
    for (const d of profileDates) {
      if (d <= date) found = d; else break;
    }
    return state.profile[found || profileDates[0]].followers_count || null;
  }

  function spreadIndex(post) {
    const reach = post.insights && post.insights.reach;
    const f = followersAt(post.date);
    return typeof reach === 'number' && f ? reach / f : null;
  }
  function engagementRate(post) {
    const i = post.insights || {};
    return typeof i.total_interactions === 'number' && i.reach ? i.total_interactions / i.reach : null;
  }

  // ------------------------------------------------------------------
  // Tooltip
  // ------------------------------------------------------------------

  const tooltip = document.getElementById('tooltip');
  function showTooltip(evt, title, rows) {
    tooltip.replaceChildren(el('div', { class: 'tt-title', text: title }));
    for (const r of rows) {
      tooltip.append(el('div', { class: 'tt-row' }, [
        el('span', {}, [r.color ? el('span', { class: 'swatch', bg: r.color }) : null, r.label]),
        el('strong', { text: r.value }),
      ]));
    }
    tooltip.hidden = false;
    const pad = 14;
    const { innerWidth: w, innerHeight: h } = window;
    const rect = tooltip.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + rect.width > w - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > h - 8) y = evt.clientY - rect.height - pad;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }
  function hideTooltip() { tooltip.hidden = true; }

  // ------------------------------------------------------------------
  // Charts (hand-rolled SVG: no third-party script in a private page)
  // ------------------------------------------------------------------

  function niceMax(v) {
    if (!v || v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
    return 10 * mag;
  }

  function chartFrame(container, title, subtitle, series) {
    container.replaceChildren(el('h2', { text: title }));
    if (subtitle) container.append(el('p', { class: 'card-sub', text: subtitle }));
    if (series.length > 1) {
      container.append(el('div', { class: 'legend' }, series.map((s) =>
        el('span', {}, [el('span', { class: 'swatch', bg: `var(${s.color})` }), s.name]))));
    }
    const holder = el('div', { class: 'chart' });
    container.append(holder);
    return holder;
  }

  function tableView(labels, series, labelHead = '날짜', valueFormat = fmt) {
    const table = el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, [el('th', { class: 'left', text: labelHead }), ...series.map((s) => el('th', { text: s.name }))])),
      el('tbody', {}, labels.map((d, i) => el('tr', {}, [
        el('td', { class: 'left', text: d }), ...series.map((s) => el('td', { text: valueFormat(s.values[i]) })),
      ]))),
    ]);
    return el('details', { class: 'as-table' }, [el('summary', { text: '표로 보기' }), el('div', { class: 'table-wrap' }, table)]);
  }

  function axes(root, geom, yMax, tickFormat = fmtCompact) {
    const { left, top, plotW, plotH } = geom;
    const g = svg('g', { class: 'axis' });
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4;
      const y = top + plotH - (plotH * i) / 4;
      g.append(svg('line', { class: i === 0 ? 'baseline' : 'gridline', x1: left, x2: left + plotW, y1: y, y2: y }));
      const t = svg('text', { x: left - 6, y: y + 4, 'text-anchor': 'end' });
      t.textContent = tickFormat(v);
      g.append(t);
    }
    root.append(g);
  }

  function xLabels(root, geom, labels, xAt, xFormat = shortDate) {
    const g = svg('g', { class: 'axis' });
    const step = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(geom.plotW / 70))));
    labels.forEach((d, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      if (i !== labels.length - 1 && labels.length - 1 - i < step / 2) return;
      const t = svg('text', { x: xAt(i), y: geom.top + geom.plotH + 16, 'text-anchor': 'middle' });
      t.textContent = xFormat(d);
      g.append(t);
    });
    root.append(g);
  }

  function makeGeom(holder, height) {
    const width = Math.max(280, holder.clientWidth || 600);
    const geom = { width, height, left: 44, right: 12, top: 10, bottom: 24 };
    geom.plotW = width - geom.left - geom.right;
    geom.plotH = height - geom.top - geom.bottom;
    return geom;
  }

  function roundedTopPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // labels are dates unless xFormat/labelHead say otherwise (e.g. bins).
  function columnChart(container, {
    title, subtitle, labels, series, emptyText,
    xFormat = shortDate, valueFormat = fmt, tickFormat = fmtCompact, labelHead = '날짜', height = 220,
  }) {
    const holder = chartFrame(container, title, subtitle, series);
    const hasData = series.some((s) => s.values.some((v) => typeof v === 'number'));
    if (!labels.length || !hasData) {
      holder.append(el('p', { class: 'empty', text: emptyText || '아직 데이터가 없습니다.' }));
      return;
    }
    const geom = makeGeom(holder, height);
    const root = svg('svg', { viewBox: `0 0 ${geom.width} ${geom.height}`, height: geom.height, role: 'img', 'aria-label': title });
    const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const yMax = niceMax(Math.max(...totals));
    axes(root, geom, yMax, tickFormat);
    const band = geom.plotW / labels.length;
    const barW = Math.max(2, Math.min(24, band * 0.7));
    const xAt = (i) => geom.left + band * i + band / 2;
    const yScale = (v) => (geom.plotH * v) / yMax;
    const base = geom.top + geom.plotH;

    labels.forEach((d, i) => {
      const hit = svg('rect', { class: 'hit', x: geom.left + band * i, y: geom.top, width: band, height: geom.plotH });
      root.append(hit);
      let acc = 0;
      const parts = series.map((s) => s.values[i] || 0);
      const topIdx = parts.reduce((t, v, k) => (v > 0 ? k : t), -1);
      parts.forEach((v, k) => {
        if (v <= 0) return;
        const gap = acc > 0 ? 2 : 0;
        const h = Math.max(1, yScale(v) - gap);
        const y = base - yScale(acc) - gap - h;
        const x = xAt(i) - barW / 2;
        const shape = k === topIdx
          ? svg('path', { d: roundedTopPath(x, y, barW, h, 4) })
          : svg('rect', { x, y, width: barW, height: h });
        shape.style.fill = `var(${series[k].color})`;
        shape.setAttribute('pointer-events', 'none');
        root.append(shape);
        acc += v;
      });
      const rows = series.map((s) => ({ label: s.name, value: valueFormat(s.values[i]), color: `var(${s.color})` }));
      if (series.length > 1) rows.push({ label: '합계', value: valueFormat(totals[i]) });
      hit.addEventListener('mousemove', (e) => { hit.classList.add('active'); showTooltip(e, d, rows); });
      hit.addEventListener('mouseleave', () => { hit.classList.remove('active'); hideTooltip(); });
    });
    xLabels(root, geom, labels, xAt, xFormat);
    holder.append(root);
    container.append(tableView(labels, series, labelHead, valueFormat));
  }

  function lineChart(container, { title, subtitle, labels, series, emptyText }) {
    const holder = chartFrame(container, title, subtitle, series);
    const s = series[0];
    const points = labels.map((d, i) => [i, s.values[i]]).filter((p) => typeof p[1] === 'number');
    if (points.length < 2) {
      holder.append(el('p', { class: 'empty', text: emptyText || '아직 데이터가 없습니다.' }));
      return;
    }
    const geom = makeGeom(holder, 220);
    const root = svg('svg', { viewBox: `0 0 ${geom.width} ${geom.height}`, height: geom.height, role: 'img', 'aria-label': title });
    const vals = points.map((p) => p[1]);
    // Follower counts move slowly - start the axis near the data, not at 0,
    // but label it clearly via the tick values.
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = niceMax(Math.max(hi - lo, 1) * 1.25);
    const yMin = Math.max(0, Math.floor(lo / (span / 4)) * (span / 4));
    const yMax = yMin + span;
    const g = svg('g', { class: 'axis' });
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (span * i) / 4;
      const y = geom.top + geom.plotH - (geom.plotH * i) / 4;
      g.append(svg('line', { class: i === 0 ? 'baseline' : 'gridline', x1: geom.left, x2: geom.left + geom.plotW, y1: y, y2: y }));
      const t = svg('text', { x: geom.left - 6, y: y + 4, 'text-anchor': 'end' });
      t.textContent = fmtCompact(v);
      g.append(t);
    }
    root.append(g);
    const xAt = (i) => geom.left + (labels.length === 1 ? geom.plotW / 2 : (geom.plotW * i) / (labels.length - 1));
    const yAt = (v) => geom.top + geom.plotH - (geom.plotH * (v - yMin)) / (yMax - yMin);
    const d = points.map((p, k) => `${k ? 'L' : 'M'}${xAt(p[0])},${yAt(p[1])}`).join('');
    root.append(svg('path', { d, fill: 'none', stroke: `var(${s.color})`, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = points[points.length - 1];
    root.append(svg('circle', { cx: xAt(last[0]), cy: yAt(last[1]), r: 4, fill: `var(${s.color})`, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    const endLabel = svg('text', { class: 'end-label', x: xAt(last[0]) - 8, y: yAt(last[1]) - 10, 'text-anchor': 'end' });
    endLabel.textContent = fmt(last[1]);
    root.append(endLabel);
    xLabels(root, geom, labels, xAt);

    const cross = svg('line', { class: 'crosshair', y1: geom.top, y2: geom.top + geom.plotH, visibility: 'hidden' });
    const dot = svg('circle', { r: 4, fill: `var(${s.color})`, stroke: 'var(--surface-1)', 'stroke-width': 2, visibility: 'hidden' });
    const overlay = svg('rect', { x: geom.left, y: geom.top, width: geom.plotW, height: geom.plotH, fill: 'transparent' });
    root.append(cross, dot, overlay);
    overlay.addEventListener('mousemove', (e) => {
      const box = root.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * geom.width;
      let best = points[0];
      for (const p of points) if (Math.abs(xAt(p[0]) - x) < Math.abs(xAt(best[0]) - x)) best = p;
      const cx = xAt(best[0]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', yAt(best[1])); dot.setAttribute('visibility', 'visible');
      showTooltip(e, labels[best[0]], [{ label: s.name, value: fmt(best[1]), color: `var(${s.color})` }]);
    });
    overlay.addEventListener('mouseleave', () => {
      cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTooltip();
    });
    holder.append(root);
    container.append(tableView(labels, series));
  }

  // ------------------------------------------------------------------
  // Overview tab
  // ------------------------------------------------------------------

  function accountRows(rangeDays) {
    const dates = Object.keys(state.account).sort();
    const from = rangeDays ? daysAgo(rangeDays) : '';
    const today = daysAgo(0);
    return dates.filter((d) => d >= from && d < today).map((d) => ({ date: d, ...state.account[d] }));
  }

  function tile(label, value, delta, deltaClass) {
    return el('div', { class: 'tile' }, [
      el('div', { class: 'label', text: label }),
      el('div', { class: 'value', text: value }),
      delta ? el('div', { class: `delta ${deltaClass || ''}`, text: delta }) : null,
    ]);
  }

  function renderOverview() {
    const range = Number(document.getElementById('ov-range').value);
    const rows = accountRows(range);
    const labels = rows.map((r) => r.date);
    const col = (k) => rows.map((r) => (typeof r[k] === 'number' ? r[k] : null));

    const current = profileDates.length ? state.profile[profileDates[profileDates.length - 1]].followers_count : null;
    const newFollowers = sum(col('follower_count'));
    const reachF = sum(col('reach_follower'));
    const reachNF = sum(col('reach_non_follower'));
    const nfShare = reachF !== null && reachNF !== null && reachF + reachNF > 0 ? reachNF / (reachF + reachNF) : null;

    document.getElementById('ov-range-hint').textContent = labels.length
      ? `${labels[0]} ~ ${labels[labels.length - 1]} (${labels.length}일치 데이터)`
      : '이 기간의 계정 인사이트가 아직 없습니다.';

    document.getElementById('ov-tiles').replaceChildren(
      tile('팔로워', fmt(current), newFollowers !== null ? `기간 중 신규 +${fmt(newFollowers)}` : null, newFollowers ? 'up' : ''),
      tile('도달 (일별 합계)', fmtCompact(sum(col('reach')))),
      tile('비팔로워 도달 비율', fmtPct(nfShare), nfShare !== null ? `비팔로워 ${fmtCompact(reachNF)}명` : null),
      tile('조회 (일별 합계)', fmtCompact(sum(col('views')))),
      tile('참여 (좋아요·댓글·저장·공유)', fmtCompact(sum(col('total_interactions')))),
    );

    const hasSplit = rows.some((r) => typeof r.reach_non_follower === 'number');
    columnChart(document.getElementById('ch-reach'), {
      title: '일별 도달',
      subtitle: hasSplit ? '팔로워와 비팔로워로 나눠 보여줍니다. 비팔로워 막대가 큰 날의 게시물이 확산된 게시물입니다.' : '팔로워/비팔로워 구분 데이터가 없어 전체 도달만 표시합니다.',
      labels,
      series: hasSplit
        ? [{ name: '팔로워', color: '--series-1', values: col('reach_follower') },
          { name: '비팔로워', color: '--series-2', values: col('reach_non_follower') }]
        : [{ name: '도달', color: '--series-1', values: col('reach') }],
    });

    const from = range ? daysAgo(range) : '';
    const pDates = profileDates.filter((d) => d >= from);
    lineChart(document.getElementById('ch-followers'), {
      title: '팔로워 수',
      subtitle: '매일 수집할 때 기록한 값입니다.',
      labels: pDates,
      series: [{ name: '팔로워', color: '--series-1', values: pDates.map((d) => state.profile[d].followers_count) }],
      emptyText: '팔로워 수는 수집을 시작한 날부터 쌓입니다. 이틀 이상 쌓이면 그래프가 나타납니다.',
    });
    columnChart(document.getElementById('ch-new-followers'), {
      title: '일별 신규 팔로워', labels, series: [{ name: '신규 팔로워', color: '--series-1', values: col('follower_count') }],
    });
    columnChart(document.getElementById('ch-interactions'), {
      title: '일별 참여', subtitle: '좋아요·댓글·저장·공유 합계', labels,
      series: [{ name: '참여', color: '--series-1', values: col('total_interactions') }],
    });
    columnChart(document.getElementById('ch-views'), {
      title: '일별 조회', labels, series: [{ name: '조회', color: '--series-1', values: col('views') }],
    });

    const posts = state.posts.filter((p) => p.date >= from && p.insights);
    renderFormatTable(posts);
    renderTopTable(posts);
  }

  function renderFormatTable(posts) {
    const groups = {};
    for (const p of posts) (groups[p.media_type] = groups[p.media_type] || []).push(p);
    const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    const holder = document.getElementById('ov-formats');
    if (!keys.length) {
      holder.replaceChildren(el('p', { class: 'empty', text: '이 기간에 인사이트가 있는 게시물이 없습니다.' }));
      return;
    }
    const m = (list, k) => mean(list.map((p) => p.insights[k]));
    holder.replaceChildren(el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, ['형식', '게시물', '평균 도달', '평균 조회', '평균 저장', '평균 공유', '평균 참여율', '평균 확산 지수']
        .map((h, i) => el('th', { class: i === 0 ? 'left' : null, text: h })))),
      el('tbody', {}, keys.map((k) => {
        const list = groups[k];
        return el('tr', {}, [
          el('td', { class: 'left', text: FORMAT_LABELS[k] || k }),
          el('td', { text: fmt(list.length) }),
          el('td', { text: fmt(m(list, 'reach')) }),
          el('td', { text: fmt(m(list, 'views')) }),
          el('td', { text: fmt(m(list, 'saved')) }),
          el('td', { text: fmt(m(list, 'shares')) }),
          el('td', { text: fmtPct(mean(list.map(engagementRate))) }),
          el('td', { text: fmtRatio(mean(list.map(spreadIndex))) }),
        ]);
      })),
    ]));
  }

  function renderTopTable(posts) {
    const top = posts.filter((p) => spreadIndex(p) !== null)
      .sort((a, b) => spreadIndex(b) - spreadIndex(a)).slice(0, 5);
    const holder = document.getElementById('ov-top');
    if (!top.length) {
      holder.replaceChildren(el('p', { class: 'empty', text: '표시할 게시물이 없습니다.' }));
      return;
    }
    holder.replaceChildren(postTable(top, [
      COLS.date, COLS.thumb, COLS.title, COLS.format, COLS.reach, COLS.shares, COLS.saved, COLS.follows, COLS.spread,
    ], false));
  }

  // ------------------------------------------------------------------
  // Posts tab
  // ------------------------------------------------------------------

  function titleOf(p) {
    if (p.recipe && p.recipe.title) return p.recipe.title;
    const first = (p.caption || '').split('\n').find((line) => line.trim()) || '(캡션 없음)';
    return first.length > 40 ? `${first.slice(0, 40)}…` : first;
  }

  function linkCell(p) {
    const title = titleOf(p);
    const href = typeof p.permalink === 'string' && p.permalink.startsWith(PERMALINK_ORIGIN) ? p.permalink : null;
    const content = href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: title }) : title;
    const extra = p.diary_no ? el('div', { class: 'muted', text: `#조식다이어리 ${p.diary_no}` }) : null;
    return [content, extra];
  }

  const ins = (k) => (p) => (p.insights ? p.insights[k] : null);
  const COLS = {
    date: { key: 'date', label: '날짜', left: true, value: (p) => p.date, show: (p) => p.date },
    thumb: {
      key: 'thumb', label: '', left: true, value: null,
      show: (p) => {
        const src = p.recipe && typeof p.recipe.image === 'string' && p.recipe.image.startsWith(IMAGE_ORIGIN) ? p.recipe.image : null;
        if (!src) return '';
        const img = el('img', { class: 'thumb', src, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => img.remove());
        return img;
      },
    },
    title: { key: 'title', label: '게시물', left: true, cls: 'title', value: titleOf, show: linkCell },
    format: { key: 'format', label: '형식', left: true, value: (p) => p.media_type, show: (p) => el('span', { class: 'badge', text: FORMAT_LABELS[p.media_type] || p.media_type || '—' }) },
    reach: { key: 'reach', label: '도달', value: ins('reach'), show: (p) => fmt(ins('reach')(p)) },
    views: { key: 'views', label: '조회', value: ins('views'), show: (p) => fmt(ins('views')(p)) },
    likes: { key: 'likes', label: '좋아요', value: ins('likes'), show: (p) => fmt(ins('likes')(p)) },
    comments: { key: 'comments', label: '댓글', value: ins('comments'), show: (p) => fmt(ins('comments')(p)) },
    saved: { key: 'saved', label: '저장', value: ins('saved'), show: (p) => fmt(ins('saved')(p)) },
    shares: { key: 'shares', label: '공유', value: ins('shares'), show: (p) => fmt(ins('shares')(p)) },
    follows: { key: 'follows', label: '팔로우', value: ins('follows'), show: (p) => fmt(ins('follows')(p)) },
    engagement: { key: 'engagement', label: '참여율', value: engagementRate, show: (p) => fmtPct(engagementRate(p)) },
    spread: { key: 'spread', label: '확산 지수', value: spreadIndex, show: (p) => fmtRatio(spreadIndex(p)) },
  };
  const POST_COLUMNS = ['date', 'thumb', 'title', 'format', 'reach', 'views', 'likes', 'comments', 'saved', 'shares', 'follows', 'engagement', 'spread'].map((k) => COLS[k]);

  function postTable(posts, cols, sortable) {
    const head = el('tr', {}, cols.map((c) => {
      const th = el('th', { class: [c.left ? 'left' : '', sortable && c.value ? 'sortable' : ''].join(' ').trim() || null, text: c.label });
      if (sortable && c.value) {
        th.setAttribute('tabindex', '0');
        if (state.sortKey === c.key) th.setAttribute('aria-sort', state.sortDir < 0 ? 'descending' : 'ascending');
        const toggle = () => {
          if (state.sortKey === c.key) state.sortDir = -state.sortDir;
          else { state.sortKey = c.key; state.sortDir = -1; }
          renderPosts();
        };
        th.addEventListener('click', toggle);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      }
      return th;
    }));
    const body = el('tbody', {}, posts.map((p) => el('tr', {}, cols.map((c) =>
      el('td', { class: [c.left ? 'left' : '', c.cls || ''].join(' ').trim() || null }, c.show(p))))));
    return el('table', { class: 'data' }, [el('thead', {}, head), body]);
  }

  function filteredPosts() {
    const range = Number(document.getElementById('ps-range').value);
    const format = document.getElementById('ps-format').value;
    const q = document.getElementById('ps-search').value.trim().toLowerCase();
    const from = range ? daysAgo(range) : '';
    return state.posts.filter((p) => {
      if (p.date < from) return false;
      if (format && p.media_type !== format) return false;
      if (q) {
        const hay = [titleOf(p), p.caption, ...((p.recipe && p.recipe.hashtags) || [])].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderPosts() {
    const col = COLS[state.sortKey] || COLS.date;
    const list = filteredPosts().sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va < vb ? -1 : 1) * state.sortDir;
    });
    document.getElementById('ps-count').textContent =
      `${fmt(list.length)}개 게시물 · 열 제목을 누르면 정렬됩니다. 확산 지수는 게시 당시 팔로워 수 기준 (수집 시작 전 게시물은 수집 첫날 팔로워 수로 계산해 실제보다 낮게 나올 수 있습니다).`;
    const table = postTable(list.slice(0, state.postsShown), POST_COLUMNS, true);
    document.getElementById('ps-table').replaceWith(Object.assign(table, { id: 'ps-table' }));
    document.getElementById('ps-more').hidden = list.length <= state.postsShown;
  }

  // ------------------------------------------------------------------
  // Analysis tab (phase 1): the signals Instagram says drive distribution
  // ------------------------------------------------------------------

  const NEIGHBOR_WINDOW = 15; // posts on each side of the "usual reach" baseline
  const BIN_LABELS = ['하위 20%', '20~40%', '40~60%', '60~80%', '상위 20%'];

  function median(values) {
    const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = nums.length >> 1;
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  // Reach relative to the median reach of the ~30 posts around it. Unlike
  // reach / followers this needs no follower history (which only starts on
  // the first collection day) and cancels slow drifts such as account growth
  // or algorithm eras, so posts from different years compare fairly.
  function computeRelativeReach(posts) {
    const list = posts.filter((p) => p.insights && p.insights.reach > 0)
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
    list.forEach((p, i) => {
      const around = [];
      for (let k = Math.max(0, i - NEIGHBOR_WINDOW); k < Math.min(list.length, i + NEIGHBOR_WINDOW + 1); k++) {
        if (k !== i) around.push(list[k].insights.reach);
      }
      const base = median(around);
      p._relReach = base ? p.insights.reach / base : null;
    });
  }

  const fmtPct2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`);
  const fmtSec = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}초`);
  const fmtTimes = (v) => `${Number(v.toFixed(2))}×`;
  const perReach = (k) => (p) => {
    const i = p.insights || {};
    return typeof i[k] === 'number' && i.reach > 0 ? i[k] / i.reach : null;
  };
  const SIGNALS = [
    { key: 'share', label: '공유율', desc: '도달 대비 공유(DM 보내기 포함)', value: perReach('shares'), format: fmtPct2 },
    { key: 'save', label: '저장율', desc: '도달 대비 저장', value: perReach('saved'), format: fmtPct2 },
    { key: 'like', label: '좋아요율', desc: '도달 대비 좋아요', value: perReach('likes'), format: fmtPct2 },
    { key: 'comment', label: '댓글율', desc: '도달 대비 댓글', value: perReach('comments'), format: fmtPct2 },
    {
      key: 'watch', label: '릴스 평균 시청 시간', desc: '릴스 1회 재생당 평균 시청 시간', format: fmtSec,
      value: (p) => {
        const v = p.insights && p.insights.ig_reels_avg_watch_time;
        return p.media_product_type === 'REELS' && typeof v === 'number' && v > 0 ? v / 1000 : null;
      },
    },
  ];

  // Spearman rank correlation: does a higher signal go with higher reach?
  function spearman(pairs) {
    const rank = (vals) => {
      const order = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const r = new Array(vals.length);
      for (let i = 0; i < order.length;) {
        let j = i;
        while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
        for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(pairs.map((p) => p[0])), ry = rank(pairs.map((p) => p[1]));
    const mx = mean(rx), my = mean(ry);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < rx.length; i++) {
      num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : null;
  }

  function analysisPosts() {
    const range = Number(document.getElementById('an-range').value);
    const format = document.getElementById('an-format').value;
    const from = range ? daysAgo(range) : '';
    return state.posts.filter((p) => p.date >= from && p._relReach !== undefined && p._relReach !== null
      && (!format || formatLabel(p) === format));
  }

  function renderAnalysis() {
    const posts = analysisPosts();
    document.getElementById('an-count').textContent = `분석 대상 ${fmt(posts.length)}개 게시물 (인사이트가 있는 게시물만)`;
    document.getElementById('an-tiles').replaceChildren(...[SIGNALS[0], SIGNALS[1], SIGNALS[4]].map((sig) => {
      const vals = posts.map(sig.value).filter((v) => v !== null);
      return el('div', { class: 'side-tile' }, [
        el('div', {}, [el('span', { text: `${sig.label} 중앙값` }), el('strong', { text: sig.format(median(vals)) })]),
        el('span', { class: 'muted', text: `${fmt(vals.length)}개` }),
      ]);
    }));
    renderKeyInsight(posts, renderSignalCompare(posts));
    const grid = document.getElementById('an-bins');
    grid.replaceChildren();
    for (const sig of SIGNALS) {
      const card = el('figure', { class: 'card' });
      grid.append(card);
      renderSignalBins(card, sig, posts);
    }
    renderNonFollowerDays();
    renderPhase2(posts);
  }

  // Paired bars per signal: top-20% vs bottom-20% posts, scaled per signal
  // so the gap reads at a glance; the two biggest gaps are highlighted.
  // Paired bars per signal: top-20% vs bottom-20% posts, scaled per signal
  // so the gap reads at a glance; the two biggest gaps are highlighted.
  // Returns those two for the key-insight card.
  function renderSignalCompare(posts) {
    const holder = document.getElementById('an-compare');
    const summary = document.getElementById('an-summary');
    const ranked = posts.slice().sort((a, b) => b._relReach - a._relReach);
    const n = Math.floor(ranked.length / 5);
    if (n < 5) {
      summary.textContent = '';
      holder.replaceChildren(el('p', { class: 'empty', text: '비교하려면 게시물이 25개 이상 필요합니다. 기간을 넓혀 보세요.' }));
      return { strongest: [], top: [] };
    }
    const top = ranked.slice(0, n), bottom = ranked.slice(-n);
    const rows = SIGNALS.map((sig) => {
      const t = median(top.map(sig.value)), b = median(bottom.map(sig.value));
      return { sig, t, b, ratio: t !== null && b ? t / b : null };
    });
    const strongest = rows.filter((r) => r.ratio !== null).sort((a, b) => b.ratio - a.ratio).slice(0, 2);
    summary.textContent = strongest.length
      ? `잘 퍼진 게시물은 ${strongest.map((r) => `${r.sig.label} ${fmtRatio(r.ratio)}`).join(', ')}로 가장 크게 달랐습니다.`
      : '';
    const bar = (v, max, cls) => {
      const fill = el('span', { class: `pair-fill ${cls}` });
      fill.style.width = `${max ? Math.max(2, (v / max) * 100) : 0}%`;
      return fill;
    };
    holder.replaceChildren(
      el('div', { class: 'legend' }, [
        el('span', {}, [el('span', { class: 'swatch', bg: 'var(--accent)' }), `확산 상위 20% · ${n}개`]),
        el('span', {}, [el('span', { class: 'swatch', bg: 'var(--grid-strong)' }), '하위 20%']),
      ]),
      ...rows.map((r) => {
        const max = Math.max(r.t || 0, r.b || 0);
        return el('div', { class: `pair-row${strongest.includes(r) ? ' highlight' : ''}` }, [
          el('div', { class: 'pair-label' }, [el('strong', { text: r.sig.label }), el('span', { class: 'muted', text: `${r.sig.format(r.t)} vs ${r.sig.format(r.b)}` })]),
          el('div', { class: 'pair-bars' }, [bar(r.t || 0, max, 'top'), bar(r.b || 0, max, 'bottom')]),
          el('strong', { class: 'pair-ratio', text: fmtRatio(r.ratio) }),
        ]);
      }),
    );
    return { strongest, top };
  }

  // The dark "key insight" card next to the weekly plan: the two signals that
  // separated spread from non-spread posts, plus the share/save rates to aim
  // for (medians of the top-20% posts).
  function renderKeyInsight(posts, { strongest, top }) {
    const box = document.getElementById('an-insight');
    const head = el('span', { class: 'ins-label', text: '이번 기간 핵심' });
    if (!strongest.length) {
      box.replaceChildren(head, el('strong', { class: 'ins-main', text: '데이터가 더 쌓이면 핵심 요약이 나타나요.' }));
      return;
    }
    const sendsLead = strongest.some((r) => r.sig.key === 'share');
    box.replaceChildren(
      head,
      el('strong', { class: 'ins-main', text: `잘 퍼진 게시물은 ${strongest.map((r) => `${r.sig.label}이 ${fmtRatio(r.ratio)}`).join(', ')} 높았어요.` }),
      el('p', { text: sendsLead
        ? '비팔로워 확산의 핵심 신호인 공유가 차이를 만들었어요. 캡션 끝에 자연스러운 공유 문구를 계속 시험해 보세요.'
        : '비팔로워 확산의 핵심은 공유(보내기)예요. 이번 주는 캡션 끝에 자연스러운 공유 문구를 시험해 보세요.' }),
      el('div', { class: 'ins-targets' }, [
        el('div', {}, [el('span', { text: '목표 공유율' }), el('strong', { text: fmtPct(median(top.map(SIGNALS[0].value))) })]),
        el('div', {}, [el('span', { text: '목표 저장율' }), el('strong', { text: fmtPct(median(top.map(SIGNALS[1].value))) })]),
      ]),
    );
  }

  function renderSignalBins(card, sig, posts) {
    const list = posts.map((p) => [sig.value(p), p._relReach]).filter((x) => x[0] !== null)
      .sort((a, b) => a[0] - b[0]);
    const title = `${sig.label}이 높을수록 더 퍼졌나`;
    if (list.length < 25) {
      columnChart(card, { title, labels: [], series: [], emptyText: '게시물이 25개 이상 필요합니다.' });
      return;
    }
    const groups = BIN_LABELS.map(() => []);
    list.forEach((x, i) => groups[Math.floor((i * 5) / list.length)].push(x));
    const rho = spearman(list);
    const strength = rho === null ? '' : Math.abs(rho) >= 0.4 ? '뚜렷한 관계' : Math.abs(rho) >= 0.2 ? '약한 관계' : '관계 거의 없음';
    columnChart(card, {
      title,
      subtitle: `${strength} · 순위 상관 ${rho === null ? '—' : (Math.abs(rho) < 0.005 ? 0 : rho).toFixed(2)} · ${fmt(list.length)}개`,
      labels: BIN_LABELS,
      series: [{ name: '평소 대비 도달', color: '--series-1', values: groups.map((g) => median(g.map((x) => x[1]))) }],
      xFormat: (d) => d, labelHead: `${sig.label} 구간`, valueFormat: fmtRatio, tickFormat: fmtTimes, height: 170,
    });
  }

  function renderNonFollowerDays() {
    const holder = document.getElementById('an-days');
    const byDate = {};
    for (const p of state.posts) (byDate[p.date] = byDate[p.date] || []).push(p);
    const days = Object.keys(state.account)
      .map((d) => ({ date: d, ...state.account[d] }))
      .filter((r) => typeof r.reach_non_follower === 'number' && typeof r.reach_follower === 'number')
      .map((r) => ({ ...r, share: r.reach_follower + r.reach_non_follower ? r.reach_non_follower / (r.reach_follower + r.reach_non_follower) : null }))
      .sort((a, b) => b.reach_non_follower - a.reach_non_follower)
      .slice(0, 10);
    if (!days.length) {
      holder.replaceChildren(el('p', { class: 'empty', text: '계정 일별 데이터가 아직 없습니다.' }));
      return;
    }
    holder.replaceChildren(el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, ['날짜', '그날 올린 게시물', '형식', '비팔로워 도달', '비팔로워 비율', '공유율', '평소 대비 도달']
        .map((h, i) => el('th', { class: i < 3 ? 'left' : null, text: h })))),
      el('tbody', {}, days.map((r) => {
        const p = (byDate[r.date] || [])[0];
        return el('tr', {}, [
          el('td', { class: 'left', text: r.date }),
          el('td', { class: 'left title' }, p ? linkCell(p) : el('span', { class: 'muted', text: '게시물 없음' })),
          el('td', { class: 'left' }, p ? COLS.format.show(p) : ''),
          el('td', { text: fmt(r.reach_non_follower) }),
          el('td', { text: fmtPct(r.share) }),
          el('td', { text: p ? fmtPct2(SIGNALS[0].value(p)) : '—' }),
          el('td', { text: p ? fmtRatio(p._relReach) : '—' }),
        ]);
      })),
    ]));
  }

  // ------------------------------------------------------------------
  // Analysis tab (phase 2): topic, caption, format and timing factors
  // ------------------------------------------------------------------

  // Hashtags that appear on nearly every post say nothing about the topic.
  const GENERIC_TAGS = new Set(['조식', '조식다이어리', '미라클모닝', '레시피', '아침밥', '직장인', '아침밥상', '혼밥', '집밥',
    '홈쿡', '모닝루틴', '모닝리추얼', '먹스타그램', '요리스타그램', '오늘의조식', '조식스타그램', '아침', '아침식사',
    '브런치', '건강식', '다이어트', '맛스타그램', '요리', '일상', '데일리']);
  // Series / campaign names (#나의프랑스식샐러드, #나의로컬푸드샐러드,
  // #나의프랑스식오븐요리, #그래잇데이 ...) name a column, not a topic.
  const SERIES_TAG = /^나의|^그래잇데이$/;
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const MIN_GROUP = 15; // groups smaller than this are shown but never drive a strategy card

  function kstParts(p) {
    // Safari cannot parse "+0000" offsets, so add the colon first.
    const t = Date.parse(String(p.timestamp || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    if (Number.isNaN(t)) return null;
    const d = new Date(t + 9 * 3600 * 1000);
    return { dow: d.getUTCDay(), hour: d.getUTCHours(), month: d.getUTCMonth() + 1 };
  }

  function postTags(p) {
    if (p._tags) return p._tags;
    const tags = new Set();
    for (const m of (p.caption || '').matchAll(/#([^\s#.,!?]+)/g)) tags.add(m[1]);
    for (const t of (p.recipe && p.recipe.hashtags) || []) tags.add(String(t));
    p._tags = [...tags].filter((t) => /[가-힣]/.test(t) && !GENERIC_TAGS.has(t) && !/^조식다이어리\d*$/.test(t)
      && !SERIES_TAG.test(t));
    return p._tags;
  }

  // Mosseri: hashtags label what a post is about (used above as topics) but
  // do not drive reach, and posts are now capped at five - so hashtag count
  // is not a factor. These caption traits map onto the signals that do.
  const CTA_RE = /저장\s*(해\s*(두|놓)|하세요|하시|필수|각)|공유\s*(해|하세요|부탁)|보내\s*(주세요|줘|보세요)|친구(에게|한테|를)?\s*(보내|태그|공유|알려)|태그\s*(해|하세요)|댓글로|\bDM\b|디엠|save (this|it)|share (this|it|with)|send (this|it)|tag (a|your) friend/i;
  function hookLine(p) {
    const lines = (p.caption || '').split('\n').map((l) => l.trim()).filter(Boolean);
    // The diary's first line is metadata ("20260817 #조식다이어리 1810, 날씨")
    const body = lines.filter((l, i) => !(i === 0 && (/^\d{8}/.test(l) || /#조식다이어리/.test(l))));
    return body[0] || '';
  }
  function hookType(p) {
    const line = hookLine(p);
    if (!line) return null;
    if (/\?|？|(까요|나요|을까|는지|ㄹ까)\s*[.!]*$/.test(line)) return '질문형';
    // "5분", "3가지", "2단계" - a number with a counter word, not a calorie tag
    if (/\d+\s*(가지|분|초|단계|번|배|%|퍼센트|인분|개|년|시간)(?![a-z])/i.test(line.replace(/\d+\s*kcal/gi, ''))) return '숫자·정보형';
    if (/[!♥❤😍🤤😋🥰]/u.test(line)) return '감탄·감성형';
    return '일반 서술형';
  }
  const bin = (v, edges, labels) => { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[labels.length - 1]; };
  const formatLabel = (p) => (p.media_product_type === 'REELS' ? '릴스' : FORMAT_LABELS[p.media_type] || null);

  const FACTORS = [
    { key: 'format', title: '형식', order: ['릴스', '캐러셀', '사진', '동영상'], group: formatLabel },
    {
      key: 'length', title: '캡션 길이', order: ['300자 미만', '300~600자', '600~1,000자', '1,000자 이상'],
      group: (p) => bin((p.caption || '').length, [300, 600, 1000], ['300자 미만', '300~600자', '600~1,000자', '1,000자 이상']),
    },
    { key: 'hook', title: '캡션 첫 문장 유형', order: ['질문형', '숫자·정보형', '감탄·감성형', '일반 서술형'], group: hookType },
    { key: 'cta', title: '공유·저장 유도 문구', order: ['있음', '없음'], group: (p) => (CTA_RE.test(p.caption || '') ? '있음' : '없음') },
    {
      key: 'slides', title: '캐러셀 장수', order: ['2~3장', '4~6장', '7장 이상'],
      group: (p) => (p.media_type === 'CAROUSEL_ALBUM' && p.carousel_count ? bin(p.carousel_count, [4, 7], ['2~3장', '4~6장', '7장 이상']) : null),
    },
    { key: 'recipe', title: '캡션에 레시피(재료)', order: ['있음', '없음'], group: (p) => (/재료/.test(p.caption || '') ? '있음' : '없음') },
    { key: 'kcal', title: '칼로리 표기', order: ['있음', '없음'], group: (p) => (/kcal/i.test(p.caption || '') ? '있음' : '없음') },
    {
      key: 'english', title: '제목 영어 병기', order: ['영어 병기', '한글만'],
      group: (p) => (/[A-Za-z]{3,}/.test(titleOf(p)) ? '영어 병기' : '한글만'),
    },
    { key: 'failed', title: '실패기', order: ['실패기', '일반'], group: (p) => (p.recipe ? (p.recipe.failed ? '실패기' : '일반') : null) },
    {
      key: 'dow', title: '게시 요일', order: WEEKDAYS.map((d) => `${d}요일`),
      group: (p) => { const k = kstParts(p); return k ? `${WEEKDAYS[k.dow]}요일` : null; },
    },
    {
      key: 'hour', title: '게시 시간대', order: ['새벽 (0~6시)', '아침 (6~9시)', '오전 (9~12시)', '오후 (12~18시)', '저녁 (18~24시)'],
      group: (p) => { const k = kstParts(p); return k ? bin(k.hour, [6, 9, 12, 18], ['새벽 (0~6시)', '아침 (6~9시)', '오전 (9~12시)', '오후 (12~18시)', '저녁 (18~24시)']) : null; },
    },
    {
      key: 'season', title: '계절', order: ['봄', '여름', '가을', '겨울'],
      group: (p) => { const k = kstParts(p); return k ? ['겨울', '겨울', '봄', '봄', '봄', '여름', '여름', '여름', '가을', '가을', '가을', '겨울'][k.month - 1] : null; },
    },
  ];

  function groupStats(posts, keyFn, order) {
    const groups = {};
    for (const p of posts) {
      const keys = [].concat(keyFn(p) || []);
      for (const k of keys) (groups[k] = groups[k] || []).push(p);
    }
    const labels = order ? order.filter((l) => groups[l]) : Object.keys(groups);
    return labels.map((label) => {
      const list = groups[label];
      return {
        label, n: list.length,
        rel: median(list.map((p) => p._relReach)),
        share: median(list.map(SIGNALS[0].value)),
        save: median(list.map(SIGNALS[1].value)),
      };
    });
  }

  // Compact bar list: label · bar (relative reach) · post count. Share and
  // save rates live in the tooltip-free "details" of the signals section.
  // Compact bar list: label · bar (relative reach) · ratio (· post count).
  // The best group's bar takes the accent; groups under minN are dimmed.
  function factorTable(rows, firstHead, minN = MIN_GROUP, showN = false) {
    const max = Math.max(...rows.map((r) => r.rel || 0));
    const eligible = rows.filter((r) => r.n >= minN && r.rel !== null);
    const best = eligible.length > 1 ? eligible.reduce((a, b) => (b.rel > a.rel ? b : a)) : null;
    return el('div', { class: `frows${showN ? ' with-n' : ''}`, role: 'list', 'aria-label': firstHead }, rows.map((r) => {
      const fill = el('span', { class: 'bar-fill' });
      fill.style.width = `${r.rel && max ? Math.max(2, Math.min(100, (r.rel / max) * 100)) : 0}%`;
      return el('div', { class: ['frow', r === best ? 'best' : '', r.n < minN ? 'small-n' : ''].join(' ').trim(), role: 'listitem', title: `${fmt(r.n)}개 게시물` }, [
        el('span', { class: 'f-label', text: r.label }),
        el('span', { class: 'bar-track' }, fill),
        el('strong', { class: 'f-rel', text: fmtRatio(r.rel) }),
        showN ? el('span', { class: 'f-n', text: `${fmt(r.n)}개` }) : null,
      ]);
    }));
  }

  function renderFactors(posts) {
    const grid = document.getElementById('an-factors');
    grid.replaceChildren();
    const results = [];
    for (const f of FACTORS) {
      const rows = groupStats(posts, f.group, f.order);
      results.push({ factor: f, rows });
      grid.append(el('section', { class: 'card factor-card' }, [
        el('h3', { text: f.title }),
        rows.length ? el('div', { class: 'table-wrap' }, factorTable(rows, f.title)) : el('p', { class: 'empty', text: '데이터가 없습니다.' }),
      ]));
    }
    return results;
  }

  function renderTopics(posts) {
    const holder = document.getElementById('an-topics');
    const minN = posts.length >= 600 ? 15 : 8;
    const rows = groupStats(posts, postTags).filter((r) => r.n >= minN && r.rel !== null)
      .sort((a, b) => b.rel - a.rel);
    document.getElementById('an-topics-sub').textContent = `해시태그 기준 · ${minN}개 이상 · 공통·시리즈 태그 제외`;
    if (rows.length < 4) {
      holder.replaceChildren(el('p', { class: 'empty', text: '비교할 만큼 자주 쓰인 소재가 없습니다. 기간을 넓혀 보세요.' }));
      return rows;
    }
    const top = rows.slice(0, 10), bottom = rows.length > 15 ? rows.slice(-5).reverse() : [];
    holder.replaceChildren(
      el('div', { class: 'topic-cols' }, [
        el('div', {}, [el('h4', { class: 'topic-head good', text: '잘 퍼진 소재' }), factorTable(top, '잘 퍼진 소재', minN, true)]),
        bottom.length ? el('div', { class: 'low' }, [el('h4', { class: 'topic-head warn', text: '덜 퍼진 소재' }), factorTable(bottom, '덜 퍼진 소재', minN, true)]) : null,
      ]),
    );
    return rows;
  }

  // Strategy cards: the groups that beat the posts' own median by the most,
  // only from groups big enough (MIN_GROUP) to not be a fluke.
  // Strategy tiles: the conditions whose group beat the posts' own median
  // by the most, from groups big enough (MIN_GROUP) to not be a fluke.
  function renderStrategy(posts, factorResults, topicRows) {
    const holder = document.getElementById('an-strategy');
    const base = median(posts.map((p) => p._relReach));
    const cards = [];
    for (const { factor, rows } of factorResults) {
      const ok = rows.filter((r) => r.n >= MIN_GROUP && r.rel !== null);
      if (ok.length < 2) continue;
      const best = ok.reduce((a, b) => (b.rel > a.rel ? b : a));
      cards.push({ lift: best.rel / base, rel: best.rel, kind: factor.title, value: best.label, n: best.n });
    }
    const topTopic = topicRows.find((r) => r.n >= MIN_GROUP);
    if (topTopic) cards.push({ lift: topTopic.rel / base, rel: topTopic.rel, kind: '소재', value: `#${topTopic.label}`, n: topTopic.n });
    const picked = cards.filter((c) => c.lift >= 1.1).sort((a, b) => b.lift - a.lift).slice(0, 5);
    if (!picked.length) {
      holder.replaceChildren(el('p', { class: 'empty', text: '뚜렷하게 앞서는 요인이 아직 없습니다.' }));
      return;
    }
    const maxRel = Math.max(...picked.map((c) => c.rel));
    holder.replaceChildren(...picked.map((c) => {
      const fill = el('span', { class: 's-fill' });
      fill.style.width = `${Math.round((c.rel / (maxRel * 1.25)) * 100)}%`;
      return el('div', { class: 's-tile' }, [
        el('span', { class: 's-kind', text: c.kind }),
        el('strong', { class: 's-value', text: c.value }),
        el('div', { class: 's-row' }, [el('span', { class: 's-lift', text: fmtRatio(c.rel) }), el('span', { class: 's-n', text: `${fmt(c.n)}개` })]),
        el('span', { class: 's-track' }, fill),
      ]);
    }));
  }

  function renderPhase2(posts) {
    const factorResults = renderFactors(posts);
    const topicRows = renderTopics(posts);
    renderStrategy(posts, factorResults, topicRows);
    renderPlaybooks();
  }

  // Playbooks: the "format × topic" combinations that spread best, each with
  // the timing and caption habits that worked best *for that format* and
  // the past posts to use as a model. Only the period filter applies - the
  // playbooks are meant to span formats.
  function bestGroup(posts, factorKey, minN) {
    const f = FACTORS.find((x) => x.key === factorKey);
    const rows = groupStats(posts, f.group, f.order).filter((r) => r.n >= minN && r.rel !== null);
    if (!rows.length) return null;
    const best = rows.reduce((a, b) => (b.rel > a.rel ? b : a));
    return { ...best, only: rows.length === 1 };
  }

  const PLAN_FORMATS = ['캐러셀', '사진'];

  function renderPlaybooks() {
    const holder = document.getElementById('an-playbooks');
    const range = Number(document.getElementById('an-range').value);
    const from = range ? daysAgo(range) : '';
    // Feed posts only: the reels are re-edits of older posts, so they are not
    // something to plan a topic/day for.
    const posts = state.posts.filter((p) => p.date >= from && p._relReach !== undefined && p._relReach !== null
      && PLAN_FORMATS.includes(formatLabel(p)));
    const base = median(posts.map((p) => p._relReach));
    const minCombo = posts.length >= 600 ? 6 : 4;

    const combos = {};
    for (const p of posts) {
      for (const tag of postTags(p)) (combos[`${formatLabel(p)}|${tag}`] = combos[`${formatLabel(p)}|${tag}`] || []).push(p);
    }
    const ranked = Object.entries(combos)
      .filter(([, list]) => list.length >= minCombo)
      .map(([k, list]) => { const [format, tag] = k.split('|'); return { format, tag, posts: list, rel: median(list.map((p) => p._relReach)) }; })
      .filter((c) => base && c.rel >= base * 1.1)
      .sort((a, b) => b.rel - a.rel);

    // Spread the five picks over formats (at most three each) and never reuse
    // a topic; relax the per-format cap if that leaves fewer than five.
    const picked = [];
    for (const cap of [3, 5]) {
      for (const c of ranked) {
        if (picked.length >= 5) break;
        if (picked.includes(c) || picked.some((x) => x.tag === c.tag)) continue;
        if (picked.filter((x) => x.format === c.format).length >= cap) continue;
        picked.push(c);
      }
    }
    picked.sort((a, b) => b.rel - a.rel);
    renderWeekPlan(posts, picked);
    if (!picked.length) {
      holder.replaceChildren(el('p', { class: 'empty', text: `평소보다 뚜렷하게 잘 퍼진 형식 × 소재 조합(게시물 ${minCombo}개 이상)이 아직 없습니다. 기간을 넓혀 보세요.` }));
      return;
    }

    // Only conditions with a clear winner become chips - no chip means
    // "no difference", which keeps each card short.
    const chip = (label, g, fmtBase) => {
      if (!g || g.only || (fmtBase && g.rel < fmtBase * 1.05)) return null;
      return el('span', { class: 'chip', title: `평소 대비 ${fmtRatio(g.rel)}` }, `${label} · ${g.label}`);
    };
    holder.replaceChildren(...picked.map((c, i) => {
      const fmtPosts = posts.filter((p) => formatLabel(p) === c.format);
      const minN = fmtPosts.length >= 150 ? 15 : 8;
      const fmtBase = median(fmtPosts.map((p) => p._relReach));
      const g = (key, n = minN) => bestGroup(fmtPosts, key, n);
      const topFmt = fmtPosts.slice().sort((a, b) => b._relReach - a._relReach).slice(0, Math.max(1, Math.floor(fmtPosts.length / 5)));
      const targetShare = median(topFmt.map(SIGNALS[0].value)), targetSave = median(topFmt.map(SIGNALS[1].value));
      const examples = c.posts.slice().sort((a, b) => b._relReach - a._relReach).slice(0, 2);
      const chips = [
        chip('요일', g('dow'), fmtBase), chip('시간', g('hour'), fmtBase),
        chip('첫 문장', g('hook'), fmtBase), chip('유도 문구', g('cta'), fmtBase),
        chip('캡션', g('length'), fmtBase), chip('레시피', g('recipe'), fmtBase),
        c.format === '캐러셀' ? chip('장수', g('slides', Math.min(minN, 8)), fmtBase) : null,
      ].filter(Boolean);
      return el('article', { class: 'pb-card' }, [
        el('div', { class: 'pb-top' }, [
          el('span', { class: 'strategy-rank', text: String(i + 1) }),
          el('span', { class: 'badge', text: c.format }),
          el('span', { class: 'pb-lift', text: fmtRatio(c.rel) }),
        ]),
        el('strong', { class: 'pb-topic', text: `#${c.tag}` }),
        el('div', { class: 'pb-thumbs' }, examples.map((p) => {
          const src = p.recipe && typeof p.recipe.image === 'string' && p.recipe.image.startsWith(IMAGE_ORIGIN) ? p.recipe.image : null;
          const href = typeof p.permalink === 'string' && p.permalink.startsWith(PERMALINK_ORIGIN) ? p.permalink : null;
          const img = src ? el('img', { src, alt: titleOf(p), loading: 'lazy' }) : el('span', { class: 'pb-noimg', text: titleOf(p) });
          if (src) img.addEventListener('error', () => img.replaceWith(el('span', { class: 'pb-noimg', text: titleOf(p) })));
          const cap = el('span', { class: 'pb-cap', text: fmtRatio(p._relReach) });
          return href ? el('a', { class: 'pb-thumb', href, target: '_blank', rel: 'noopener noreferrer', title: titleOf(p) }, [img, cap])
            : el('span', { class: 'pb-thumb' }, [img, cap]);
        })),
        chips.length ? el('div', { class: 'chips' }, chips) : el('p', { class: 'hint', text: '시점·캡션은 조건별 차이가 뚜렷하지 않음' }),
        el('div', { class: 'pb-foot' }, [
          el('span', {}, ['공유 ', el('strong', { text: fmtPct(targetShare) })]),
          el('span', {}, ['저장 ', el('strong', { text: fmtPct(targetSave) })]),
          el('span', { class: 'muted', text: `${fmt(c.posts.length)}개` }),
        ]),
      ]);
    }));
  }

  // Weekly plan: the best playbook goes on the weekday where feed posts have
  // spread best, the second on the next best, and so on; leftover days become
  // slots for testing a share/save call-to-action, which the account has
  // barely tried and which feeds the strongest non-follower signal.
  // Weekly plan as a 7-day strip: the best playbook on the weekday where
  // feed posts spread best, the next on the next best, and so on; leftover
  // days are slots for testing a natural share prompt. Cell shade = how well
  // that weekday's feed posts spread.
  function renderWeekPlan(posts, picked) {
    const holder = document.getElementById('an-weekplan');
    const dowFactor = FACTORS.find((f) => f.key === 'dow');
    const ranking = groupStats(posts, dowFactor.group, dowFactor.order)
      .filter((r) => r.n >= 5 && r.rel !== null).sort((a, b) => b.rel - a.rel);
    const overall = Object.fromEntries(ranking.map((r) => [r.label, r]));
    if (!ranking.length) {
      holder.replaceChildren(el('p', { class: 'empty', text: '요일별로 비교할 게시물이 부족합니다. 기간을 넓혀 보세요.' }));
      return;
    }
    const plan = {};
    picked.forEach((c, i) => { if (ranking[i]) plan[ranking[i].label] = { c, rank: i + 1 }; });
    const level = (rel) => (rel === undefined ? 0 : rel >= 1.3 ? 3 : rel >= 1.1 ? 2 : rel >= 0.95 ? 1 : 0);
    const days = dowFactor.order.slice(1).concat(dowFactor.order[0]); // 월요일 first
    holder.replaceChildren(el('div', { class: 'week' }, days.map((d) => {
      const slot = plan[d], stat = overall[d];
      return el('div', { class: `day lvl-${level(stat && stat.rel)}${slot ? '' : ' free'}` }, [
        el('div', { class: 'day-head' }, [el('strong', { text: d.replace('요일', '') }), el('span', { text: stat ? fmtRatio(stat.rel) : '—' })]),
        slot
          ? el('div', { class: 'day-body' }, [
            el('span', { class: 'strategy-rank', text: String(slot.rank) }),
            el('span', { class: 'day-format', text: slot.c.format }),
            el('strong', { class: 'day-topic', text: `#${slot.c.tag}` }),
          ])
          : el('div', { class: 'day-body' }, [el('span', { class: 'day-format', text: '자유 소재' }), el('span', { class: 'day-test', text: '공유 문구 시험' })]),
      ]);
    })));
  }

  // ------------------------------------------------------------------
  // Tabs, loading, wiring
  // ------------------------------------------------------------------

  function selectTab(name) {
    if (!['overview', 'posts', 'analysis'].includes(name)) name = 'overview';
    for (const b of document.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const p of document.querySelectorAll('[role="tabpanel"]')) p.hidden = p.dataset.panel !== name;
    if (name === 'overview') renderOverview();
    if (name === 'posts') renderPosts();
    if (name === 'analysis') renderAnalysis();
  }

  // Token expiry (the collector's estimate) and data freshness, shown under
  // the title so a renewal is never missed.
  function renderTokenStatus(meta) {
    const box = document.getElementById('token-status');
    const t = meta.token;
    const msgs = [];
    let level = 'ok';
    if (t && t.error) {
      level = 'bad';
      msgs.push(`인스타그램 토큰 오류로 수집이 멈췄습니다 (${t.error.at.slice(0, 10)}). 토큰을 새로 발급해 GitHub Secrets와 Cloudflare Worker의 IG_ACCESS_TOKEN을 교체해 주세요.`);
    } else if (t && t.expires_estimate) {
      const left = Math.round((Date.parse(t.expires_estimate) - Date.parse(daysAgo(0))) / 86400000);
      if (left <= 0) level = 'bad'; else if (left <= 14) level = 'warn';
      msgs.push(`토큰 만료까지 ${left > 0 ? `D-${left}` : '만료됨'}${t.issued_known ? '' : ' (추정)'}`
        + (left <= 14 ? ' · 지금 갱신해 주세요' : ''));
      box.title = `만료 예정 ${t.expires_estimate}`
        + (t.issued_known ? '' : ' · 발급일을 몰라 첫 수집일 기준으로 추정했습니다. 실제 만료는 더 빠를 수 있어요');
    }
    if (meta.last_run) {
      const age = (Date.now() - Date.parse(meta.last_run)) / 3600000;
      if (age > 36) {
        if (level === 'ok') level = 'warn';
        msgs.push(`마지막 수집이 ${Math.floor(age / 24)}일 전입니다. GitHub Actions의 수집 기록을 확인해 주세요.`);
      }
    }
    box.textContent = msgs.join(' · ');
    box.className = `token-status ${level}`;
    box.hidden = !msgs.length;
  }

  async function loadJson(name, fallback) {
    const resp = await fetch(`/data/${name}.json`, { credentials: 'same-origin', cache: 'no-store' });
    if (resp.status === 404) return fallback;
    if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
    return resp.json();
  }

  async function init() {
    try {
      const [profile, account, posts, meta] = await Promise.all([
        loadJson('profile_daily', {}), loadJson('account_daily', {}), loadJson('posts', []), loadJson('meta', {}),
      ]);
      Object.assign(state, { profile, account, posts, meta });
    } catch (e) {
      const box = document.getElementById('load-error');
      box.textContent = `데이터를 불러오지 못했습니다 (${e.message}). 수집기가 한 번 이상 실행됐는지 확인해주세요.`;
      box.hidden = false;
    }
    profileDates = Object.keys(state.profile).sort();
    computeRelativeReach(state.posts);
    const meta = state.meta;
    const parts = [];
    if (meta.username) parts.push(`@${meta.username}`);
    if (meta.last_run) parts.push(`마지막 수집 ${meta.last_run.replace('T', ' ').slice(0, 16)}`);
    if (meta.collecting_since) parts.push(`${meta.collecting_since}부터 수집 중`);
    document.getElementById('account-line').textContent = parts.join(' · ') || '수집된 데이터가 없습니다.';
    renderTokenStatus(meta);
    const missing = Object.keys(meta.refused_account_metrics || {}).concat(Object.keys(meta.refused_media_metrics || {}));
    document.getElementById('an-status').textContent = missing.length
      ? `API가 제공하지 않은 지표: ${missing.join(', ')}`
      : '';

    for (const b of document.querySelectorAll('[role="tab"]')) {
      b.addEventListener('click', () => { history.replaceState(null, '', `#${b.dataset.tab}`); selectTab(b.dataset.tab); });
    }
    document.getElementById('ov-range').addEventListener('change', renderOverview);
    for (const id of ['an-range', 'an-format']) document.getElementById(id).addEventListener('change', renderAnalysis);
    // In-tab shortcuts scroll instead of changing the hash (the hash picks the tab).
    const jumps = document.querySelectorAll('[data-jump]');
    for (const b of jumps) {
      b.addEventListener('click', () => {
        for (const x of jumps) x.setAttribute('aria-pressed', String(x === b));
        document.getElementById(b.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    // Segmented buttons drive the (hidden) selects the renderers read.
    for (const box of document.querySelectorAll('.seg-box[data-for]')) {
      const select = document.getElementById(box.dataset.for);
      const sync = () => { for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === select.value)); };
      box.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-value]');
        if (!b || b.dataset.value === select.value) return;
        select.value = b.dataset.value;
        sync();
        select.dispatchEvent(new Event('change'));
      });
      sync();
    }
    for (const id of ['ps-range', 'ps-format']) {
      document.getElementById(id).addEventListener('change', () => { state.postsShown = PAGE_SIZE; renderPosts(); });
    }
    let searchTimer;
    document.getElementById('ps-search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.postsShown = PAGE_SIZE; renderPosts(); }, 200);
    });
    document.getElementById('ps-more').addEventListener('click', () => { state.postsShown += PAGE_SIZE; renderPosts(); });
    let resizeTimer, lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!document.getElementById('tab-overview').hidden) renderOverview();
        if (!document.getElementById('tab-analysis').hidden) renderAnalysis();
      }, 150);
    });
    window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
    selectTab(location.hash.slice(1));
  }

  init();
})();
