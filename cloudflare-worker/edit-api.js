/**
 * edit-api Worker
 *
 * The only piece of this feature that holds any secret. Verifies the editor
 * password server-side (never trust the browser), then does one of five
 * things depending on `action`:
 *   - 'edit' (default): triggers "Apply content edit" - patches an
 *     existing record
 *   - 'add': triggers "Add missing post" - creates a brand-new record for
 *     a date that has no entry at all (the admin editor's "빠진 날짜" tool)
 *   - 'preview': looks up Instagram's own post for a given date (read-only,
 *     no GitHub Actions involved) so the admin page can show what was
 *     actually posted before deciding whether to add or skip that date
 *   - 'add_vote_round': triggers "Add vote round" - registers a new
 *     "이달의 조식" vote round (body.round: {target_month, candidates,
 *     vote_start, vote_end})
 *   - 'finalize_vote_round': triggers "Finalize vote round" - records a
 *     vote round's winner (body.round_id, body.winner_page_id), once the
 *     admin has read the final tally from the public vote-api Worker
 * The GitHub token and Instagram access token never reach the browser —
 * they live only as Worker secrets, set via the Cloudflare dashboard
 * (Settings > Variables and Secrets), never committed to the repo.
 *
 * Required secrets/vars (set in the Cloudflare dashboard, not in this file):
 *   EDITOR_PASSWORD  - long random shared secret the admin page prompts for
 *   GITHUB_TOKEN     - fine-grained PAT, scoped to this one repo only,
 *                      "Actions: Read and write" permission, nothing else
 *   GITHUB_OWNER     - e.g. "najosik"
 *   GITHUB_REPO      - e.g. "how-about-breakfast-recipes"
 *   ALLOWED_ORIGIN   - e.g. "https://how-about-breakfast.com"
 *   IG_ACCESS_TOKEN  - same Instagram Graph API token instagram-sync.yml uses
 *                      (only needed for the 'preview' action)
 *   IG_USER_ID       - same Instagram user id instagram-sync.yml uses
 *                      (only needed for the 'preview' action)
 */

const ALLOWED_FIELDS = {
  edit: ['title', 'intro', 'ingredients', 'steps', 'hashtags', 'credit', 'image', 'gallery', 'video'],
  add: ['title', 'intro', 'ingredients', 'steps', 'hashtags', 'credit', 'weather', 'calories', 'image', 'gallery', 'failed'],
};

// Instagram's media feed has no date filter - to find a specific day we
// have to page through newest-first and stop once we've scanned past it.
// A recent missing date is found in one page; an old one near the start
// of the account needs many. This cap keeps a single lookup from running
// away (and from tripping Cloudflare's per-request subrequest limit).
const IG_PAGE_LIMIT = 100;
const IG_MAX_PAGES = 30;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'bad request' }, 400, cors);
    }

    const { password, action, page_id, date, fields } = body || {};

    if (!constantTimeEqual(password, env.EDITOR_PASSWORD)) {
      // Small fixed delay slows down brute-force attempts against a
      // long random password; this is defense in depth, not the primary
      // control (the primary control is the password itself being long
      // and random, held only in this Worker's secrets).
      await sleep(500);
      return json({ error: 'unauthorized' }, 401, cors);
    }

    if (action === 'preview') {
      if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: 'invalid payload' }, 400, cors);
      }
      if (!env.IG_ACCESS_TOKEN || !env.IG_USER_ID) {
        return json({ error: 'instagram credentials not configured' }, 500, cors);
      }
      const result = await searchInstagramForDate(date, env);
      return json(result, 200, cors);
    }

    if (action === 'add_vote_round') {
      const round = body.round;
      if (!round || typeof round !== 'object') {
        return json({ error: 'invalid payload' }, 400, cors);
      }
      return dispatchWorkflow('add-vote-round.yml', { round: JSON.stringify(round) }, env, cors);
    }

    if (action === 'finalize_vote_round') {
      const roundId = body.round_id;
      const winnerPageId = body.winner_page_id;
      if (typeof roundId !== 'string' || !roundId || typeof winnerPageId !== 'string' || !winnerPageId) {
        return json({ error: 'invalid payload' }, 400, cors);
      }
      return dispatchWorkflow('finalize-vote-round.yml', { round_id: roundId, winner_page_id: winnerPageId }, env, cors);
    }

    const act = action === 'add' ? 'add' : 'edit';

    if (!fields || typeof fields !== 'object') {
      return json({ error: 'invalid payload' }, 400, cors);
    }
    if (act === 'edit' && (!page_id || typeof page_id !== 'string')) {
      return json({ error: 'invalid payload' }, 400, cors);
    }
    if (act === 'add' && (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return json({ error: 'invalid payload' }, 400, cors);
    }

    const patch = {};
    for (const key of ALLOWED_FIELDS[act]) {
      if (key in fields) patch[key] = fields[key];
    }
    if (Object.keys(patch).length === 0) {
      return json({ error: 'no editable fields provided' }, 400, cors);
    }

    const workflowFile = act === 'add' ? 'add-post.yml' : 'apply-edit.yml';
    const inputs = act === 'add'
      ? { date, patch: JSON.stringify(patch) }
      : { page_id, patch: JSON.stringify(patch) };

    return dispatchWorkflow(workflowFile, inputs, env, cors);
  },
};

async function dispatchWorkflow(workflowFile, inputs, env, cors) {
  const dispatchUrl =
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}` +
    `/actions/workflows/${workflowFile}/dispatches`;

  const ghRes = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'how-about-breakfast-edit-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });

  if (!ghRes.ok) {
    const detail = await ghRes.text();
    return json({ error: 'github dispatch failed', detail }, 502, cors);
  }

  return json({ ok: true }, 200, cors);
}

async function searchInstagramForDate(targetDate, env) {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,children{media_type,media_url,thumbnail_url}';
  let url =
    `https://graph.instagram.com/v21.0/${env.IG_USER_ID}/media` +
    `?fields=${encodeURIComponent(fields)}&limit=${IG_PAGE_LIMIT}&access_token=${encodeURIComponent(env.IG_ACCESS_TOKEN)}`;

  let checked = 0;
  for (let page = 0; page < IG_MAX_PAGES && url; page++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      return { found: false, error: 'instagram api request failed', detail: String(e), checked };
    }
    if (!res.ok) {
      const detail = await res.text();
      return { found: false, error: 'instagram api error', detail, checked };
    }
    const data = await res.json();
    const items = data.data || [];

    for (const item of items) {
      checked++;
      const itemDate = extractItemDate(item);
      if (!itemDate) continue;
      if (itemDate === targetDate) {
        return Object.assign({ found: true, checked }, summarizeItem(item));
      }
      if (itemDate < targetDate) {
        // Feed is newest-first; once we're past the target date
        // chronologically without a match, it isn't there.
        return { found: false, checked };
      }
    }

    url = data.paging && data.paging.next;
  }

  return { found: false, checked, truncated: true };
}

// Mirrors extract_date_str() in sync_instagram.py: prefer the caption's own
// leading YYYYMMDD (immutable once posted), fall back to the post's
// timestamp converted to KST.
function extractItemDate(item) {
  const caption = item.caption || '';
  const m = caption.match(/^\s*(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (!item.timestamp) return null;
  const d = new Date(item.timestamp);
  if (isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const da = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function summarizeItem(item) {
  const parts = item.media_type === 'CAROUSEL_ALBUM' ? ((item.children && item.children.data) || []) : [item];
  const images = parts.filter((it) => it.media_type === 'IMAGE').map((it) => it.media_url).filter(Boolean);
  const video = parts.find((it) => it.media_type === 'VIDEO');
  return {
    caption: item.caption || '',
    images,
    video_thumbnail: video ? (video.thumbnail_url || null) : null,
    permalink: item.permalink || null,
    timestamp: item.timestamp || null,
  };
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://how-about-breakfast.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Constant-time string comparison so a mistyped/guessed password doesn't
// leak timing information about how many leading characters matched.
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return diff === 0;
}
