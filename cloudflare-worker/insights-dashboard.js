/**
 * insights-dashboard Worker
 *
 * Serves the private Instagram insights dashboard straight out of the
 * PRIVATE R2 bucket that insights/collect_insights.py writes to. Nothing
 * here is public: the Worker's route sits behind a Cloudflare Access
 * application that only lets the account owner's email in, and the Worker
 * itself re-verifies the Access token on every request (so a mis-set route,
 * a workers.dev URL, or an Access policy mistake fails closed instead of
 * leaking data).
 *
 * Bindings / vars (set in the Cloudflare dashboard, never in this file):
 *   INSIGHTS            - R2 bucket binding to the private insights bucket
 *   ACCESS_TEAM_DOMAIN  - e.g. "yourteam.cloudflareaccess.com"
 *   ACCESS_AUD          - the Access application's "Application Audience (AUD) Tag"
 *   ALLOWED_EMAIL       - the one email allowed in (checked again here)
 */

// Only these objects are ever served - no path is passed through to R2.
const ROUTES = {
  '/': 'app/index.html',
  '/app/dashboard.css': 'app/dashboard.css',
  '/app/dashboard.js': 'app/dashboard.js',
  '/data/profile_daily.json': 'data/profile_daily.json',
  '/data/account_daily.json': 'data/account_daily.json',
  '/data/posts.json': 'data/posts.json',
  '/data/meta.json': 'data/meta.json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https://images.how-about-breakfast.com",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const CERTS_TTL_MS = 60 * 60 * 1000;
let certsCache = { keys: null, fetchedAt: 0 };

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') {
      return text('method not allowed', 405);
    }
    if (!env.INSIGHTS || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAIL) {
      // Fail closed: never serve anything until access control is configured.
      return text('not configured', 503);
    }

    let identity;
    try {
      identity = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), env);
    } catch (e) {
      return text('forbidden', 403);
    }
    if ((identity.email || '').toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
      return text('forbidden', 403);
    }

    const key = ROUTES[new URL(request.url).pathname];
    if (!key) {
      return text('not found', 404);
    }
    const obj = await env.INSIGHTS.get(key);
    if (!obj) {
      return text('not found', 404);
    }
    const headers = new Headers(SECURITY_HEADERS);
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    return new Response(obj.body, { headers });
  },
};

function text(body, status) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// --------------------------------------------------------------------------
// Cloudflare Access JWT verification (RS256 against the team's public certs)
// --------------------------------------------------------------------------

async function verifyAccessJwt(token, env) {
  if (!token) throw new Error('missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlDecodeText(headerB64));
  const payload = JSON.parse(b64urlDecodeText(payloadB64));

  if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected alg');
  const jwk = await findCert(env.ACCESS_TEAM_DOMAIN, header.kid);
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('bad signature');

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error('bad audience');
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error('bad issuer');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) throw new Error('not yet valid');
  return payload;
}

async function findCert(teamDomain, kid) {
  const fresh = Date.now() - certsCache.fetchedAt < CERTS_TTL_MS;
  let jwk = fresh && certsCache.keys?.find((k) => k.kid === kid);
  if (!jwk) {
    // Unknown kid may mean a key rotation - refetch once.
    const resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!resp.ok) throw new Error('certs unavailable');
    certsCache = { keys: (await resp.json()).keys || [], fetchedAt: Date.now() };
    jwk = certsCache.keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error('unknown key');
  return jwk;
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlDecodeText(s) {
  return new TextDecoder().decode(b64urlDecode(s));
}
