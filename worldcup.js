/* worldcup.js — reusable single-elimination "breakfast World Cup" bracket
   engine + renderer. Independent of vote.js/vote.html (the Hall of Fame
   annual pick) — this is its own module so neither feature can break the
   other. Consumers just call WorldCup.start(container, candidates, opts);
   what happens with the champion (submit a vote, show a toast, etc.) is
   entirely up to the caller via opts.onComplete. */
var WorldCup = (function () {
  'use strict';

  var ROUND_NAME = {
    ko: { 2: '결승', 4: '준결승', 8: '8강', 16: '16강', 32: '32강', 64: '64강' },
    en: { 2: 'Final', 4: 'Semifinal', 8: 'Quarterfinal', 16: 'Round of 16', 32: 'Round of 32', 64: 'Round of 64' }
  };

  function roundLabel(size, lang) {
    var table = ROUND_NAME[lang] || ROUND_NAME.ko;
    return table[size] || (size + (lang === 'en' ? '-entrant round' : '강'));
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function nextPow2(n) {
    var p = 1;
    while (p < n) p *= 2;
    return p;
  }

  // Pads the shuffled entrant list with `null` byes up to the next power of
  // two, one bye per pair for as many pairs as needed. Byes can never
  // outnumber real entrants in a pair (size/2 < candidates.length always,
  // since size is the *smallest* power of two >= candidates.length), so
  // every pair gets at least one real entrant.
  function buildFirstRound(candidates) {
    var shuffled = shuffle(candidates);
    var size = nextPow2(shuffled.length);
    var byes = size - shuffled.length;
    var slots = shuffled.slice();
    for (var i = 0; i < byes; i++) {
      slots.splice(i * 2 + 1, 0, null);
    }
    return slots;
  }

  function escapeHtml(s) {
    if (typeof Shared !== 'undefined') return Shared.escapeHtml(s);
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function thumbHTML(r) {
    if (typeof Shared !== 'undefined') return Shared.thumbHTML(r, 40);
    return r.image ? '<img src="' + escapeHtml(r.image) + '" alt="">' : '';
  }

  function cardTitle(r) {
    if (typeof Shared !== 'undefined' && Shared.hasStaticEn(r, 'title')) return Shared.localizedText(r, 'title');
    return r.title || '';
  }

  var STR = {
    ko: { byePrefix: '부전승', championLabel: '이달의 조식 우승!', restart: '다시 하기' },
    en: { byePrefix: 'Bye', championLabel: 'Champion of the Month!', restart: 'Play Again' }
  };

  var ANNOUNCE_DURATION_MS = 1200;

  function announceText(size, lang) {
    var label = roundLabel(size, lang);
    return lang === 'en' ? ('Yay~ Starting the ' + label + '!') : ('오예~ ' + label + '을 시작합니다!');
  }

  /**
   * Runs a single-elimination bracket inside `container`.
   * candidates: array of record objects (must have .page_id, .title/._en.title, .image or gallery).
   * opts:
   *   lang: 'ko' | 'en' (default 'ko')
   *   onComplete: function(championRecord) — called once, at the end
   *   onMatch: function(round_size, pairIndexWithinRound, totalPairsInRound) — optional progress hook
   */
  function start(container, candidates, opts) {
    opts = opts || {};
    var lang = opts.lang || 'ko';
    var t = STR[lang] || STR.ko;
    var onComplete = opts.onComplete || function () {};

    if (!candidates || candidates.length === 0) {
      container.innerHTML = '';
      return;
    }
    var currentRound = buildFirstRound(candidates);
    var roundSize = currentRound.length;
    var pairIndex = 0;
    var winners = [];
    var matchNumInRound = 0;
    var totalPairsInRound = Math.ceil(roundSize / 2);
    var announcedForSize = null;

    function advanceRound() {
      currentRound = winners;
      roundSize = currentRound.length;
      winners = [];
      pairIndex = 0;
      matchNumInRound = 0;
      totalPairsInRound = Math.ceil(roundSize / 2);
    }

    function renderProgress() {
      return '<div class="wc-progress">' + escapeHtml(roundLabel(roundSize, lang)) +
        (totalPairsInRound > 1 ? ' · ' + matchNumInRound + '/' + totalPairsInRound : '') + '</div>';
    }

    function step() {
      // once per round size (including the very first), show a brief
      // "Starting the Round of 32!"-style announcement before anything else
      // in that round - byes included - gets resolved or rendered.
      if (announcedForSize !== roundSize) {
        announcedForSize = roundSize;
        renderAnnouncement(roundSize);
        return;
      }

      // auto-resolve byes (a lone real entrant paired with a `null` slot
      // advances without a click) before rendering the next real matchup.
      while (pairIndex < currentRound.length) {
        var a = currentRound[pairIndex];
        var b = currentRound[pairIndex + 1];
        if (a && b) break;
        var advancer = a || b;
        if (advancer) winners.push(advancer);
        pairIndex += 2;
        matchNumInRound++;
      }

      if (pairIndex >= currentRound.length) {
        if (winners.length <= 1) {
          renderChampion(winners[0] || currentRound[0]);
          return;
        }
        advanceRound();
        step();
        return;
      }

      matchNumInRound++;
      renderMatchup(currentRound[pairIndex], currentRound[pairIndex + 1]);
    }

    function renderAnnouncement(size) {
      container.innerHTML =
        '<div class="wc-announce"><div class="wc-announce-text">' +
        escapeHtml(announceText(size, lang)) +
        '</div></div>';
      setTimeout(step, ANNOUNCE_DURATION_MS);
    }

    function renderMatchup(a, b) {
      container.innerHTML =
        renderProgress() +
        '<div class="wc-match">' +
        '<div class="wc-card" data-side="a">' +
        '<div class="thumb">' + thumbHTML(a) + '</div>' +
        '<div class="title">' + escapeHtml(cardTitle(a)) + '</div>' +
        '</div>' +
        '<div class="wc-vs">VS</div>' +
        '<div class="wc-card" data-side="b">' +
        '<div class="thumb">' + thumbHTML(b) + '</div>' +
        '<div class="title">' + escapeHtml(cardTitle(b)) + '</div>' +
        '</div>' +
        '</div>';

      var cardA = container.querySelector('.wc-card[data-side="a"]');
      var cardB = container.querySelector('.wc-card[data-side="b"]');
      var settled = false;

      function pick(winnerEl, loserEl, winnerRec) {
        if (settled) return;
        settled = true;
        winnerEl.classList.add('wc-pick');
        loserEl.classList.add('wc-drop');
        setTimeout(function () {
          winners.push(winnerRec);
          pairIndex += 2;
          step();
        }, 480);
      }

      cardA.addEventListener('click', function () { pick(cardA, cardB, a); });
      cardB.addEventListener('click', function () { pick(cardB, cardA, b); });
    }

    function renderChampion(champion) {
      container.innerHTML =
        '<div class="wc-champion">' +
        '<div class="crown">🏆</div>' +
        '<div class="champion-label">' + escapeHtml(t.championLabel) + '</div>' +
        '<div class="thumb">' + thumbHTML(champion) + '</div>' +
        '<div class="title">' + escapeHtml(cardTitle(champion)) + '</div>' +
        '</div>';
      onComplete(champion);
    }

    step();
  }

  return {
    start: start,
    shuffle: shuffle,
    nextPow2: nextPow2,
    buildFirstRound: buildFirstRound,
    roundLabel: roundLabel
  };
})();
