/**
 * vote-api Worker
 *
 * Public (no password) endpoint backing the "이달의 조식" (Breakfast of the
 * Month) vote page (vote.html). Unlike edit-api.js, this one is meant to be
 * hit directly by any visitor's browser, so it carries no admin secrets -
 * its only job is counting votes and enforcing one vote per IP per day.
 *
 * Routes:
 *   POST /vote   body: { round_id, page_id }
 *     -> records one vote, rejecting a second vote from the same IP on the
 *        same round within the same KST calendar day.
 *   GET  /tally?round=<round_id>
 *     -> { page_id: count, ... } current vote counts for that round. Public
 *        and safe to expose - it's aggregate numbers, not personal data.
 *        Used by the admin editor's "집계 및 마감" (tally & close) step to
 *        decide the winner once voting closes.
 *
 * Required KV binding (set in the Cloudflare dashboard, Settings > Bindings):
 *   VOTES_KV
 *
 * Required vars (Settings > Variables and Secrets):
 *   ALLOWED_ORIGIN  - e.g. "https://how-about-breakfast.com"
 *
 * Privacy: the requester's IP address is never stored. It's combined with
 * the round id and today's date (KST) and hashed (SHA-256) before ever
 * touching KV, and the resulting dedupe key expires automatically after 48
 * hours (VOTE_DEDUPE_TTL_SECONDS) - just long enough to block a same-day
 * repeat vote, not to build any lasting record of who voted.
 */

const VOTE_DEDUPE_TTL_SECONDS = 60 * 60 * 48; // 48h - a little over one day's worth of margin
const SITE_BASE = 'https://how-about-breakfast.com';

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/tally') {
      return handleTally(url, env, cors);
    }
    if (request.method === 'POST' && url.pathname === '/vote') {
      return handleVote(request, env, cors);
    }
    return json({ error: 'not found' }, 404, cors);
  },
};

async function handleVote(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400, cors);
  }

  const roundId = typeof body.round_id === 'string' ? body.round_id : '';
  const pageId = typeof body.page_id === 'string' ? body.page_id : '';
  if (!roundId || !pageId) {
    return json({ error: 'invalid payload' }, 400, cors);
  }

  const round = await fetchRound(roundId);
  if (!round) {
    return json({ error: 'unknown round' }, 404, cors);
  }
  if (round.winner) {
    return json({ error: 'voting is closed for this round' }, 403, cors);
  }
  const today = kstDateString(new Date());
  if (today < round.vote_start || today > round.vote_end) {
    return json({ error: 'voting is not open for this round' }, 403, cors);
  }
  if (!round.candidates.includes(pageId)) {
    return json({ error: 'not a candidate of this round' }, 400, cors);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const dedupeKey = 'voted:' + (await sha256Hex(`${ip}:${roundId}:${today}`));

  const already = await env.VOTES_KV.get(dedupeKey);
  if (already) {
    return json({ error: 'already voted' }, 409, cors);
  }

  const countKey = `count:${roundId}:${pageId}`;
  // Not a true atomic increment (KV has no such primitive) - a read then
  // write, so two requests landing in the same instant could both read the
  // same old count and one increment could be lost. Acceptable at this
  // site's traffic scale; the per-IP-per-day dedupe key above is the part
  // that actually matters for fairness.
  const current = parseInt((await env.VOTES_KV.get(countKey)) || '0', 10);
  await env.VOTES_KV.put(countKey, String(current + 1));
  await env.VOTES_KV.put(dedupeKey, '1', { expirationTtl: VOTE_DEDUPE_TTL_SECONDS });

  return json({ ok: true }, 200, cors);
}

async function handleTally(url, env, cors) {
  const roundId = url.searchParams.get('round') || '';
  if (!roundId) {
    return json({ error: 'missing round' }, 400, cors);
  }
  const round = await fetchRound(roundId);
  if (!round) {
    return json({ error: 'unknown round' }, 404, cors);
  }
  const tally = {};
  for (const pageId of round.candidates) {
    tally[pageId] = parseInt((await env.VOTES_KV.get(`count:${roundId}:${pageId}`)) || '0', 10);
  }
  return json(tally, 200, cors);
}

async function fetchRound(roundId) {
  const res = await fetch(`${SITE_BASE}/monthly-vote.json`, { cf: { cacheTtl: 60 } });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.rounds || []).find((r) => r.id === roundId) || null;
}

// KST (UTC+9) calendar date as YYYY-MM-DD, matching how dates are stored
// everywhere else on the site (recipes.json, monthly-vote.json).
function kstDateString(date) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://how-about-breakfast.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
