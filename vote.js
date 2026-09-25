(function () {
  'use strict';

  // Fill in after deploying the vote-api Cloudflare Worker (cloudflare-worker/vote-api.js).
  var VOTE_API_URL = 'https://misty-hill-0027.howaboutbreakfast2020.workers.dev';

  var content = document.getElementById('hallContent');
  var tabsEl = document.getElementById('hallTabs');
  var langToggle = document.getElementById('langToggle');

  var state = {
    rounds: [],
    byId: {},
    tallies: {}, // round_id -> {page_id: count}
    active: null, // the currently-open-for-voting round, or null
    period: 'all',
  };

  function todayKST() {
    // en-CA gives YYYY-MM-DD directly, matching how dates are stored everywhere else on the site.
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  function findActiveRound(rounds) {
    var today = todayKST();
    return rounds.find(function (r) { return !r.winner && r.vote_start <= today && today <= r.vote_end; }) || null;
  }

  function votedKeyFor(roundId) {
    return 'habVoted:' + roundId;
  }

  Promise.all([
    fetch('monthly-vote.json').then(function (r) { return r.json(); }),
    Shared.loadData(),
  ])
    .then(function (results) {
      var voteData = results[0];
      var all = results[1];
      var ready = I18N.getLang() === 'en' ? Shared.ensureEnMerged(all) : Promise.resolve(all);
      return ready.then(function (merged) { return { voteData: voteData, all: merged }; });
    })
    .then(function (data) {
      state.rounds = data.voteData.rounds || [];
      data.all.forEach(function (r) { state.byId[r.page_id] = r; });
      state.active = findActiveRound(state.rounds);

      // Every round's tally is fetched once up front (there are only a
      // handful of rounds - one per month since launch) so switching
      // between 이번 달/올해/전체 tabs afterward is instant, no refetch.
      return Promise.all(state.rounds.map(function (r) {
        return fetch(VOTE_API_URL + '/tally?round=' + encodeURIComponent(r.id))
          .then(function (res) { return res.ok ? res.json() : {}; })
          .catch(function () { return {}; })
          .then(function (tally) { state.tallies[r.id] = tally; });
      }));
    })
    .then(function () {
      bindTabs();
      bindLangToggle();
      render();
    })
    .catch(function (err) {
      content.innerHTML = '<div class="hall-empty">' + I18N.t('load_error_archive') + '</div>';
      console.error(err);
    });

  function bindTabs() {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        state.period = btn.getAttribute('data-period');
        Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (b) {
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        render();
      });
    });
  }

  function roundsForPeriod(period) {
    if (period === 'month') {
      var month = todayKST().slice(0, 7);
      return state.rounds.filter(function (r) { return r.target_month === month; });
    }
    if (period === 'year') {
      var year = todayKST().slice(0, 4);
      return state.rounds.filter(function (r) { return r.target_month && r.target_month.slice(0, 4) === year; });
    }
    return state.rounds;
  }

  // Sums each candidate's vote count across every round in the given
  // period - a page_id normally only ever appears as a candidate once,
  // but this adds correctly even in the rare case it's re-nominated.
  function leaderboardFor(period) {
    var rounds = roundsForPeriod(period);
    var totals = {};
    rounds.forEach(function (r) {
      var tally = state.tallies[r.id] || {};
      (r.candidates || []).forEach(function (pid) {
        totals[pid] = (totals[pid] || 0) + (tally[pid] || 0);
      });
    });
    return Object.keys(totals)
      .map(function (pid) { return { pid: pid, votes: totals[pid] }; })
      .filter(function (row) { return state.byId[row.pid]; })
      .sort(function (a, b) { return b.votes - a.votes; });
  }

  function titleFor(r) {
    return Shared.hasStaticEn(r, 'title') ? Shared.localizedText(r, 'title') : (r.title || I18N.t('untitled_fallback'));
  }

  function votesLabel(n) {
    var lang = I18N.getLang();
    return lang === 'en' ? (n + (n === 1 ? ' vote' : ' votes')) : (n + I18N.t('hall_votes_suffix'));
  }

  function dateLabel(r) {
    if (!r.date) return '';
    var parts = r.date.split('-');
    return parts[0] + '.' + parts[1] + '.' + parts[2];
  }

  // A leaderboard row is votable only if it's a candidate of the round
  // that's *currently* open for voting - every other row (past winners,
  // other periods) is read-only, since the vote API itself only accepts
  // a vote for the active round's own candidates.
  function activeVoteState(pid) {
    if (!state.active) return null;
    if ((state.active.candidates || []).indexOf(pid) === -1) return null;
    var votedPageId = localStorage.getItem(votedKeyFor(state.active.id));
    return { roundId: state.active.id, voted: !!votedPageId, isMine: votedPageId === pid };
  }

  function voteButtonHTML(pid) {
    var vs = activeVoteState(pid);
    if (!vs) return '';
    var label = vs.isMine ? I18N.t('vote_voted_btn') : I18N.t('vote_btn');
    return (
      '<button type="button" class="hall-vote-btn" data-page-id="' + Shared.escapeHtml(pid) + '" data-round-id="' + Shared.escapeHtml(vs.roundId) + '"' +
      (vs.voted ? ' disabled' : '') + ' aria-pressed="' + (vs.isMine ? 'true' : 'false') + '">' + Shared.escapeHtml(label) + '</button>'
    );
  }

  function render() {
    var rows = leaderboardFor(state.period);
    if (!rows.length) {
      content.innerHTML = '<div class="hall-empty">' + I18N.t('hall_empty') + '</div>';
      return;
    }

    var first = rows[0];
    var firstR = state.byId[first.pid];
    var podiumRest = rows.slice(1, 3);
    var rest = rows.slice(3, 10);

    // A vote <button> can't nest inside the card's <a> (invalid HTML,
    // unpredictable tap behavior), so when a podium row happens to be
    // the currently-votable candidate, its button renders as a sibling
    // right under the card instead of inside it.
    var firstHTML =
      '<div class="hall-first-wrap">' +
      '<a class="hall-first" href="' + Shared.escapeHtml(Shared.recipeUrl(firstR)) + '">' +
      '<div class="hall-first-media">' + Shared.thumbHTML(firstR, 40) + '<span class="hall-first-rank">1</span></div>' +
      '<div class="hall-first-meta"><span>' + Shared.escapeHtml(dateLabel(firstR)) + '</span><span class="votes">' + Shared.escapeHtml(votesLabel(first.votes)) + '</span></div>' +
      '<span class="hall-first-title">' + Shared.escapeHtml(titleFor(firstR)) + '</span>' +
      '</a>' + voteButtonHTML(first.pid) + '</div>';

    var sideHTML = podiumRest.map(function (row, i) {
      var r = state.byId[row.pid];
      return (
        '<div class="hall-side-wrap">' +
        '<a class="hall-side-item" href="' + Shared.escapeHtml(Shared.recipeUrl(r)) + '">' +
        '<div class="hall-side-media">' + Shared.thumbHTML(r, 28) + '<span class="hall-side-rank">' + (i + 2) + '</span></div>' +
        '<div class="hall-side-info"><span class="meta">' + Shared.escapeHtml(dateLabel(r)) + '</span>' +
        '<span class="title">' + Shared.escapeHtml(titleFor(r)) + '</span>' +
        '<span class="votes">' + Shared.escapeHtml(votesLabel(row.votes)) + '</span></div>' +
        '</a>' + voteButtonHTML(row.pid) + '</div>'
      );
    }).join('');

    var restHTML = rest.map(function (row, i) {
      var r = state.byId[row.pid];
      return (
        '<li><span class="hall-rest-rank">' + (i + 4) + '</span>' +
        '<a class="title" href="' + Shared.escapeHtml(Shared.recipeUrl(r)) + '">' + Shared.escapeHtml(titleFor(r)) + '</a>' +
        '<span class="hall-rest-votes">' + Shared.escapeHtml(votesLabel(row.votes)) + '</span>' +
        voteButtonHTML(row.pid) +
        '</li>'
      );
    }).join('');

    content.innerHTML =
      '<div class="hall-podium">' + firstHTML + '<div class="hall-podium-side">' + sideHTML + '</div></div>' +
      (rest.length ? (
        '<div class="hall-rest-wrap"><div class="hall-rest"><h2>' + Shared.escapeHtml(I18N.t('hall_rest_heading')) + '</h2>' +
        '<ol class="hall-rest-list">' + restHTML + '</ol></div>' +
        '<aside class="hall-howto">' +
        '<span class="hall-howto-eyebrow">' + Shared.escapeHtml(I18N.t('hall_howto_eyebrow')) + '</span>' +
        '<span class="hall-howto-title">' + Shared.escapeHtml(I18N.t('hall_howto_title')) + '</span>' +
        '<p class="hall-howto-desc">' + Shared.escapeHtml(I18N.t('hall_howto_desc')) + '</p>' +
        '<a href="privacy.html#vote">' + Shared.escapeHtml(I18N.t('hall_howto_privacy_link')) + '</a>' +
        '</aside></div>'
      ) : '');

    Array.prototype.forEach.call(content.querySelectorAll('.hall-vote-btn:not([disabled])'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        castVote(btn.getAttribute('data-round-id'), btn.getAttribute('data-page-id'), btn);
      });
    });
  }

  function castVote(roundId, pageId, btn) {
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = I18N.t('vote_loading');

    fetch(VOTE_API_URL + '/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ round_id: roundId, page_id: pageId }),
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; }); })
      .then(function (res) {
        if (res.ok) {
          localStorage.setItem(votedKeyFor(roundId), pageId);
          state.tallies[roundId] = state.tallies[roundId] || {};
          state.tallies[roundId][pageId] = (state.tallies[roundId][pageId] || 0) + 1;
          render();
          return;
        }
        btn.disabled = false;
        btn.textContent = original;
        var msg = res.status === 409 ? I18N.t('vote_error_duplicate') : I18N.t('vote_error_generic');
        alert(msg);
        if (res.status === 409) {
          localStorage.setItem(votedKeyFor(roundId), pageId);
          render();
        }
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = original;
        alert(I18N.t('vote_error_generic'));
      });
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
        location.reload();
      });
    });
  }
})();
