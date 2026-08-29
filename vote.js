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
        renderInactive();
      }
      renderTimeline(rounds, byId);
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

  function renderInactive() {
    content.innerHTML =
      '<div class="vote-empty">' +
      '<b>' + I18N.t('vote_no_active_title') + '</b>' +
      '<span>' + I18N.t('vote_no_active_desc') + '</span>' +
      '</div>';
  }

  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function yearLabel(year) {
    return year + ' ' + I18N.t('footer_vote');
  }

  function monthShortLabel(m) {
    return I18N.getLang() === 'en' ? MONTH_SHORT[m - 1] : m + '월';
  }

  // Jan-Dec strip for the current year: each month shows its finalized
  // winner's thumbnail (clickable, opens the same modal used elsewhere on
  // the site), or an empty placeholder if that month has no winner yet
  // (still voting, or in the future).
  function renderTimeline(rounds, byId) {
    var year = todayKST().slice(0, 4);
    var winnerByMonth = {};
    rounds.forEach(function (r) {
      if (r.winner && r.target_month && r.target_month.slice(0, 4) === year) {
        winnerByMonth[r.target_month] = r.winner;
      }
    });

    var items = '';
    for (var m = 1; m <= 12; m++) {
      var key = year + '-' + String(m).padStart(2, '0');
      var pid = winnerByMonth[key];
      var rec = pid ? byId[pid] : null;
      if (rec) {
        var title = Shared.hasStaticEn(rec, 'title') ? Shared.localizedText(rec, 'title') : (rec.title || '');
        items +=
          '<div class="vote-timeline-item filled" data-page-id="' + Shared.escapeHtml(pid) + '" role="button" tabindex="0" aria-label="' + Shared.escapeHtml(title) + '">' +
          '<div class="thumb">' + Shared.thumbHTML(rec, 20) + '</div>' +
          '<div class="month">' + monthShortLabel(m) + '</div>' +
          '</div>';
      } else {
        items +=
          '<div class="vote-timeline-item unfilled">' +
          '<div class="thumb"></div>' +
          '<div class="month">' + monthShortLabel(m) + '</div>' +
          '</div>';
      }
    }

    var section =
      '<div class="vote-divider"></div>' +
      '<div class="vote-timeline-wrap">' +
      '<p class="label">' + Shared.escapeHtml(yearLabel(year)) + '</p>' +
      '<div class="vote-timeline">' + items + '</div>' +
      '</div>';
    content.insertAdjacentHTML('beforeend', section);

    Array.prototype.forEach.call(content.querySelectorAll('.vote-timeline-item.filled'), function (el) {
      var rec = byId[el.getAttribute('data-page-id')];
      var open = function () { Shared.openModal(rec); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
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
