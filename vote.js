(function () {
  'use strict';

  // Fill in after deploying the vote-api Cloudflare Worker (cloudflare-worker/vote-api.js).
  var VOTE_API_URL = 'https://misty-hill-0027.howaboutbreakfast2020.workers.dev';

  var content = document.getElementById('voteContent');
  var langToggle = document.getElementById('langToggle');

  function todayKST() {
    // en-CA gives YYYY-MM-DD directly, matching how dates are stored everywhere else on the site.
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  function findActiveRound(rounds) {
    var today = todayKST();
    return rounds.find(function (r) { return !r.winner && r.vote_start <= today && today <= r.vote_end; });
  }

  function findLatestFinalized(rounds) {
    var finalized = rounds.filter(function (r) { return r.winner; });
    finalized.sort(function (a, b) { return b.id < a.id ? -1 : 1; });
    return finalized[0] || null;
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
      var voteData = data.voteData;
      var byId = {};
      data.all.forEach(function (r) { byId[r.page_id] = r; });

      var rounds = voteData.rounds || [];
      var active = findActiveRound(rounds);
      if (active) {
        renderActive(active, byId);
      } else {
        renderInactive(findLatestFinalized(rounds), byId);
      }
      bindLangToggle();
    })
    .catch(function (err) {
      content.innerHTML = '<div class="empty">' + I18N.t('load_error_archive') + '</div>';
      console.error(err);
    });

  function votedKeyFor(roundId) {
    return 'habVoted:' + roundId;
  }

  function renderActive(round, byId) {
    var votedPageId = localStorage.getItem(votedKeyFor(round.id));
    var cards = round.candidates
      .map(function (pid) { return byId[pid]; })
      .filter(Boolean);

    content.innerHTML =
      '<div class="vote-grid">' +
      cards.map(function (r) { return voteCardHTML(r, !!votedPageId, r.page_id === votedPageId); }).join('') +
      '</div>' +
      (votedPageId
        ? '<p class="vote-note">' + I18N.t('vote_already_voted') + '</p>'
        : '');

    cards.forEach(function (r) {
      Shared.bindGallery(document.getElementById('voteMedia-' + cssId(r.page_id)), r);
    });

    if (!votedPageId) {
      Array.prototype.forEach.call(content.querySelectorAll('.vote-btn'), function (btn) {
        btn.addEventListener('click', function () { castVote(round.id, btn.getAttribute('data-page-id'), btn); });
      });
    }
  }

  function monthLabel(targetMonth) {
    var parts = (targetMonth || '').split('-');
    var year = parts[0];
    var month = parseInt(parts[1], 10);
    if (!year || !month) return I18N.t('vote_winner_prefix');
    if (I18N.getLang() === 'en') {
      var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return MONTHS[month - 1] + ' ' + year;
    }
    return year + '년 ' + month + '월';
  }

  function renderInactive(latestFinalized, byId) {
    var html =
      '<div class="vote-empty">' +
      '<b>' + I18N.t('vote_no_active_title') + '</b>' +
      '<span>' + I18N.t('vote_no_active_desc') + '</span>' +
      '</div>' +
      '<div class="vote-divider"></div>';

    var winner = null;
    if (latestFinalized) {
      winner = byId[latestFinalized.winner];
      if (winner) {
        var winnerTitle = Shared.hasStaticEn(winner, 'title') ? Shared.localizedText(winner, 'title') : (winner.title || '');
        html +=
          '<div class="vote-winner">' +
          '<p class="label">' + Shared.escapeHtml(monthLabel(latestFinalized.target_month)) + '</p>' +
          '<span class="medal-badge">🥇 ' + I18N.t('medal_label') + '</span>' +
          '<p class="vote-winner-name">' + Shared.escapeHtml(winnerTitle) + '</p>' +
          '<div class="card" id="voteWinnerCard" role="button" tabindex="0">' +
          Shared.thumbHTML(winner, 30) +
          '</div>' +
          '</div>';
      }
    }
    if (!winner) {
      html += '<p class="vote-note">' + I18N.t('vote_winner_none') + '</p>';
    }

    content.innerHTML = html;

    var winnerCard = document.getElementById('voteWinnerCard');
    if (winnerCard && winner) {
      var open = function () { Shared.openModal(winner); };
      winnerCard.addEventListener('click', open);
      winnerCard.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
  }

  function cssId(pageId) {
    return pageId.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  function voteCardHTML(r, disabled, isMine) {
    var title = Shared.hasStaticEn(r, 'title') ? Shared.localizedText(r, 'title') : (r.title || '');
    var btnLabel = isMine ? I18N.t('vote_voted_btn') : I18N.t('vote_btn');
    return (
      '<div class="vote-card' + (isMine ? ' voted' : '') + '">' +
      '<div id="voteMedia-' + cssId(r.page_id) + '">' + Shared.galleryHTML(r) + '</div>' +
      '<h3 class="card-title">' + Shared.escapeHtml(title) + '</h3>' +
      '<button type="button" class="btn-primary vote-btn" data-page-id="' + Shared.escapeHtml(r.page_id) + '"' +
      (disabled ? ' disabled' : '') + (isMine ? ' data-mine="1"' : '') + '>' + Shared.escapeHtml(btnLabel) + '</button>' +
      '</div>'
    );
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
          Array.prototype.forEach.call(content.querySelectorAll('.vote-btn'), function (b) {
            b.disabled = true;
            if (b === btn) { b.textContent = I18N.t('vote_voted_btn'); b.closest('.vote-card').classList.add('voted'); }
          });
          var note = document.createElement('p');
          note.className = 'vote-note';
          note.textContent = I18N.t('vote_thanks');
          content.appendChild(note);
          return;
        }
        btn.disabled = false;
        btn.textContent = original;
        var msg = res.status === 409 ? I18N.t('vote_error_duplicate') : I18N.t('vote_error_generic');
        alert(msg);
        if (res.status === 409) {
          localStorage.setItem(votedKeyFor(roundId), pageId);
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
