/**
 * edit-api Worker
 *
 * The only piece of this feature that holds any secret. Verifies the editor
 * password server-side (never trust the browser), then triggers the
 * "Apply content edit" GitHub Actions workflow via workflow_dispatch. The
 * GitHub token never reaches the browser — it lives only as a Worker
 * secret, set via the Cloudflare dashboard (Settings > Variables and
 * Secrets), never committed to the repo.
 *
 * Required secrets/vars (set in the Cloudflare dashboard, not in this file):
 *   EDITOR_PASSWORD  - long random shared secret the admin page prompts for
 *   GITHUB_TOKEN     - fine-grained PAT, scoped to this one repo only,
 *                      "Actions: Read and write" permission, nothing else
 *   GITHUB_OWNER     - e.g. "najosik"
 *   GITHUB_REPO      - e.g. "how-about-breakfast-recipes"
 *   ALLOWED_ORIGIN   - e.g. "https://how-about-breakfast.com"
 */

const ALLOWED_FIELDS = ['title', 'intro', 'ingredients', 'steps', 'hashtags', 'credit'];

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

    const { password, page_id, fields } = body || {};

    if (!constantTimeEqual(password, env.EDITOR_PASSWORD)) {
      // Small fixed delay slows down brute-force attempts against a
      // long random password; this is defense in depth, not the primary
      // control (the primary control is the password itself being long
      // and random, held only in this Worker's secrets).
      await sleep(500);
      return json({ error: 'unauthorized' }, 401, cors);
    }

    if (!page_id || typeof page_id !== 'string' || !fields || typeof fields !== 'object') {
      return json({ error: 'invalid payload' }, 400, cors);
    }

    const patch = {};
    for (const key of ALLOWED_FIELDS) {
      if (key in fields) patch[key] = fields[key];
    }
    if (Object.keys(patch).length === 0) {
      return json({ error: 'no editable fields provided' }, 400, cors);
    }

    const dispatchUrl =
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}` +
      `/actions/workflows/apply-edit.yml/dispatches`;

    const ghRes = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'how-about-breakfast-edit-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          page_id,
          patch: JSON.stringify(patch),
        },
      }),
    });

    if (!ghRes.ok) {
      const detail = await ghRes.text();
      return json({ error: 'github dispatch failed', detail }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};

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
