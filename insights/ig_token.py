"""Keeps the Instagram long-lived access token alive automatically.

Instagram tokens die 60 days after they are issued unless refreshed. This
script refreshes the token once a week and keeps the current one in the
PRIVATE insights R2 bucket (auth/ig-token.json, never served by the
dashboard Worker), so nothing has to be pasted by hand any more.

  python insights/ig_token.py resolve   # export the current token to later steps
  python insights/ig_token.py refresh   # get a fresh 60-day token, store it

The GitHub secret IG_ACCESS_TOKEN stays the seed: the stored token is used
only while it descends from the secret's current value (seed_fingerprint),
so pasting a brand-new token into the secret always takes over again.

Why the bucket and not the secret itself: rewriting a GitHub secret (or a
Worker secret) from a workflow needs a new key that can change secrets;
the bucket already has a bucket-scoped key, so no new credential is added.

Security notes (public repo => public Actions logs): the token is masked
(::add-mask::) before anything else and never printed; logs say only where
the token came from and the expiry date.

Required environment variables:
  IG_ACCESS_TOKEN, IG_USER_ID, INSIGHTS_R2_ENDPOINT, INSIGHTS_R2_ACCESS_KEY_ID,
  INSIGHTS_R2_SECRET_ACCESS_KEY, INSIGHTS_R2_BUCKET
  GITHUB_ENV (set by Actions; only for resolve)
"""
import datetime
import os
import re
import sys
import urllib.parse

from collect_insights import (API_BASE, ApiError, InstagramClient, R2Store,
                              RateLimited, put_json, token_fingerprint)

TOKEN_KEY = 'auth/ig-token.json'
# Long-lived tokens are opaque [A-Za-z0-9] strings; anything else (spaces,
# newlines, quotes) would break the GITHUB_ENV file or the credentials JSON.
TOKEN_RE = re.compile(r'[A-Za-z0-9_\-.]{20,2048}')
# A stored token this close to expiry is not handed out any more.
MIN_REMAINING = datetime.timedelta(hours=1)


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def mask(token):
    # Before any other output, so the value is redacted even in a traceback.
    print(f'::add-mask::{token}', flush=True)


def current_token(store, secret):
    """Returns (token, source, record)."""
    try:
        rec = (store.get_json(TOKEN_KEY, None) if store else None) or {}
    except Exception as e:  # R2 down must not stop the sync: fall back to the secret
        print(f'Token store unreadable ({type(e).__name__}); using the GitHub secret.')
        rec = {}
    stored = rec.get('access_token')
    usable = (
        stored and TOKEN_RE.fullmatch(stored)
        and rec.get('seed_fingerprint') == token_fingerprint(secret)
        and datetime.datetime.fromisoformat(rec['expires_at']) - now_utc() > MIN_REMAINING
    )
    if usable:
        return stored, 'refreshed token (R2)', rec
    return secret, 'GitHub secret', rec


def resolve(store, secret):
    token, source, rec = current_token(store, secret)
    mask(token)
    with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as f:
        f.write(f'IG_ACCESS_TOKEN={token}\n')
    expires = rec.get('expires_at', '')[:10] if source.startswith('refreshed') else 'unknown'
    print(f'Instagram token: {source}, expires {expires}.')


def refresh(store, secret, user_id):
    token, source, rec = current_token(store, secret)
    mask(token)
    seed = rec.get('seed_fingerprint') if source.startswith('refreshed') else token_fingerprint(secret)
    client = InstagramClient(token, user_id)
    try:
        # Not under /vXX.X/ - this endpoint is unversioned.
        data = client.get_url(f'{API_BASE}/refresh_access_token?' + urllib.parse.urlencode(
            {'grant_type': 'ig_refresh_token', 'access_token': token}))
        new = data.get('access_token') or ''
        if not TOKEN_RE.fullmatch(new):
            raise ApiError(0, None, 'refresh returned no usable token')
        mask(new)
        # Prove the new token can read this account before switching to it.
        InstagramClient(new, user_id).profile()
    except (ApiError, RateLimited) as e:
        # Keep the previous token (still valid until its own expiry) and
        # leave a note for the dashboard. e never contains the token.
        rec['seed_fingerprint'] = rec.get('seed_fingerprint') or seed
        rec['last_error'] = {'at': now_utc().isoformat(timespec='seconds'), 'message': str(e)[:200]}
        put_json(store, TOKEN_KEY, rec)
        sys.exit(f'Token refresh failed ({source}): {e}')

    expires = now_utc() + datetime.timedelta(seconds=int(data.get('expires_in') or 0))
    put_json(store, TOKEN_KEY, {
        'access_token': new,
        'fingerprint': token_fingerprint(new),
        'seed_fingerprint': seed,
        'refreshed_at': now_utc().isoformat(timespec='seconds'),
        'expires_at': expires.isoformat(timespec='seconds'),
    })
    print(f'Token refreshed (from {source}); new token expires {expires.date().isoformat()}.')


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('resolve', 'refresh'):
        sys.exit('usage: ig_token.py resolve|refresh')
    secret = (os.environ.get('IG_ACCESS_TOKEN') or '').strip()
    if not TOKEN_RE.fullmatch(secret):
        sys.exit('IG_ACCESS_TOKEN is missing or malformed (check the secret for spaces/quotes).')
    mask(secret)
    if sys.argv[1] == 'resolve':
        try:
            store = R2Store()
        except Exception as e:  # missing bucket config must not stop the sync either
            print(f'Token store unavailable ({type(e).__name__}); using the GitHub secret.')
            store = None
        resolve(store, secret)
        return
    store = R2Store()
    user_id = os.environ.get('IG_USER_ID')
    if not user_id:
        sys.exit('IG_USER_ID must be set.')
    refresh(store, secret, user_id)


if __name__ == '__main__':
    main()
