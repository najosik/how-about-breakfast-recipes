"""
insights/collect_insights.py

Collects this account's Instagram insights once a day and stores them in a
PRIVATE Cloudflare R2 bucket (never in this public repo). The private
dashboard (cloudflare-worker/insights-dashboard.js, behind Cloudflare Access)
reads the same bucket.

What it stores (all aggregate numbers about our own account - no other
user's id, name or comment text is ever requested or saved):
  data/profile_daily.json  {date: {followers_count, follows_count, media_count}}
                           one snapshot per run day - Instagram only exposes
                           the current follower count, so this file is the
                           only long-term follower history we will have
  data/account_daily.json  {date: {metric: value, ...}} account-level daily
                           insights (reach split into follower/non-follower,
                           views, interactions, new followers ...). The API
                           only goes back ~30 days, so missed days are
                           back-filled on the next run while still in range
  data/posts.json          one record per post: media fields, lifetime
                           insights, and the matching recipes.json record
                           (title/hashtags - the "소재" for later analysis)
  data/post_history.json   {post_id: {date: {metric: value}}} a daily snapshot
                           of each post's cumulative insights while it is
                           young (first RECENT_POST_DAYS days), so later
                           analysis can see how fast a post spread - the
                           API only ever returns the current totals
  data/meta.json           last run time, api version, metrics the API
                           refused (so the dashboard can say what is missing)
  app/*                    the dashboard's static files (insights/dashboard/)

Security notes (public repo => public Actions logs):
  - credentials come from environment variables (GitHub Secrets), never files
    in the repo; the access token is never printed
  - logs contain only counts and metric names, never insight values

Usage:
  python insights/collect_insights.py            # daily run (R2)
  python insights/collect_insights.py --full     # refresh every post's insights
  python insights/collect_insights.py --local DIR   # read/write DIR instead of R2
  python insights/collect_insights.py --assets-only # just upload dashboard files

Required environment variables:
  IG_ACCESS_TOKEN, IG_USER_ID       (same values instagram-sync.yml uses; the
                                     token needs instagram_business_manage_insights)
  INSIGHTS_R2_ENDPOINT, INSIGHTS_R2_ACCESS_KEY_ID,
  INSIGHTS_R2_SECRET_ACCESS_KEY, INSIGHTS_R2_BUCKET   (not needed with --local)
"""
import argparse
import datetime
import hashlib
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RECIPES_PATH = os.path.join(ROOT, 'recipes.json')
DASHBOARD_DIR = os.path.join(HERE, 'dashboard')

API_BASE = 'https://graph.instagram.com'
API_VERSION = 'v23.0'
KST = datetime.timezone(datetime.timedelta(hours=9))

# Account insights are only available for roughly the last 30 days. The
# last few days are always re-fetched because Instagram keeps revising them.
ACCOUNT_LOOKBACK_DAYS = 28
ACCOUNT_REFRESH_DAYS = 3
# Posts younger than this get their lifetime insights refreshed every run;
# older ones only on a --full run or once a week (see needs_full_refresh).
RECENT_POST_DAYS = 45
FULL_REFRESH_EVERY_DAYS = 7

# (metric, breakdown) - breakdown None means a plain total. If a breakdown is
# refused the metric is retried without it, and a metric refused outright is
# recorded in meta.json instead of failing the run.
ACCOUNT_METRICS = [
    ('reach', 'follow_type'),
    ('views', 'follow_type'),
    ('accounts_engaged', None),
    ('total_interactions', None),
    ('likes', None),
    ('comments', None),
    ('shares', None),
    ('saves', None),
    ('profile_links_taps', None),
    ('follows_and_unfollows', 'follow_type'),
]

COMMON_MEDIA_METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions']
MEDIA_METRICS = {
    'REELS': COMMON_MEDIA_METRICS + ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'],
    'FEED': COMMON_MEDIA_METRICS + ['follows', 'profile_visits'],
}

# children{id} only to count a carousel's slides (a carousel holds at most 20)
MEDIA_FIELDS = 'id,caption,media_type,media_product_type,timestamp,permalink,children{id}'
DIARY_NO_RE = re.compile(r'#조식다이어리\s*(\d+)')
# Instagram long-lived tokens last 60 days and the API does not say when a
# token was issued, so the collector notes the day it first sees a new token
# (by fingerprint - the token itself is never stored) and counts from there.
# IG_TOKEN_ISSUED_AT (repo variable, YYYY-MM-DD) overrides it when known.
TOKEN_LIFETIME_DAYS = 60

# Metrics kept in post_history.json (the per-day growth curve of a post).
HISTORY_METRICS = ('reach', 'views', 'likes', 'comments', 'saved', 'shares',
                   'total_interactions', 'follows', 'profile_visits')


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(f'HTTP {status} code={code}: {message}')
        self.status = status
        self.code = code


class RateLimited(Exception):
    pass


# --------------------------------------------------------------------------
# Instagram Graph API
# --------------------------------------------------------------------------

class InstagramClient:
    # Graph API error codes that mean "slow down" rather than "bad request".
    RATE_LIMIT_CODES = {4, 17, 32, 613}

    def __init__(self, access_token, user_id):
        self.access_token = access_token
        self.user_id = user_id
        self.calls = 0

    def get(self, path, params=None, _retries=2):
        params = dict(params or {})
        params['access_token'] = self.access_token
        url = f'{API_BASE}/{API_VERSION}/{path}?' + urllib.parse.urlencode(params)
        return self._get_url(url, _retries)

    def get_url(self, url, _retries=2):
        # paging.next URLs already carry the token; only accept our own host so
        # a malformed response can never make us send the token elsewhere.
        if urllib.parse.urlparse(url).netloc != urllib.parse.urlparse(API_BASE).netloc:
            raise ApiError(0, None, 'unexpected paging host')
        return self._get_url(url, _retries)

    def _get_url(self, url, retries):
        self.calls += 1
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            code, message = None, ''
            try:
                err = json.loads(e.read().decode()).get('error', {})
                code, message = err.get('code'), err.get('message', '')
            except (ValueError, AttributeError):
                pass
            if e.code == 429 or code in self.RATE_LIMIT_CODES:
                if retries > 0:
                    time.sleep(60)
                    return self._get_url(url, retries - 1)
                raise RateLimited(message)
            if e.code >= 500 and retries > 0:
                time.sleep(5)
                return self._get_url(url, retries - 1)
            raise ApiError(e.code, code, message[:200])
        except urllib.error.URLError as e:
            if retries > 0:
                time.sleep(5)
                return self._get_url(url, retries - 1)
            raise ApiError(0, None, f'network error: {e.reason}')

    def profile(self):
        return self.get(self.user_id, {'fields': 'username,followers_count,follows_count,media_count'})

    def all_media(self):
        data = self.get(f'{self.user_id}/media', {'fields': MEDIA_FIELDS, 'limit': 100})
        while True:
            yield from data.get('data', [])
            next_url = data.get('paging', {}).get('next')
            if not next_url:
                return
            data = self.get_url(next_url)


# --------------------------------------------------------------------------
# Response parsing
# --------------------------------------------------------------------------

def parse_metric(item):
    """Returns (total, {breakdown_value: value}) for one insights data item,
    handling both the total_value shape and the older values[] shape."""
    if 'total_value' in item:
        tv = item['total_value']
        split = {}
        for bd in tv.get('breakdowns', []) or []:
            for res in bd.get('results', []):
                key = '_'.join(res.get('dimension_values', [])).lower()
                split[key] = res.get('value', 0)
        return tv.get('value', 0), split
    values = item.get('values') or [{}]
    return values[0].get('value', 0), {}


def kst_day_bounds(day):
    start = datetime.datetime(day.year, day.month, day.day, tzinfo=KST)
    end = start + datetime.timedelta(days=1)
    return int(start.timestamp()), int(end.timestamp())


def to_kst_date(ts):
    return datetime.datetime.fromisoformat(ts).astimezone(KST).date()


# --------------------------------------------------------------------------
# Collection steps
# --------------------------------------------------------------------------

def collect_account_day(client, day, refused):
    since, until = kst_day_bounds(day)
    row = {}
    for metric, breakdown in ACCOUNT_METRICS:
        if metric in refused:
            continue
        params = {'metric': metric, 'period': 'day', 'metric_type': 'total_value',
                  'since': since, 'until': until}
        attempts = [breakdown, None] if breakdown else [None]
        for bd in attempts:
            p = dict(params, **({'breakdown': bd} if bd else {}))
            try:
                data = client.get(f'{client.user_id}/insights', p).get('data', [])
            except ApiError as e:
                if bd:
                    refused.setdefault(f'{metric}:{bd}', str(e))
                    continue
                refused[metric] = str(e)
                break
            if data:
                total, split = parse_metric(data[0])
                row[metric] = total
                for k, v in split.items():
                    row[f'{metric}_{k}'] = v
            break
    return row


def collect_follower_counts(client, days, refused):
    """Daily net new followers (Instagram's follower_count metric, last 30
    days only). Returns {date_str: value}."""
    if 'follower_count' in refused or not days:
        return {}
    since, _ = kst_day_bounds(min(days))
    _, until = kst_day_bounds(max(days))
    try:
        data = client.get(f'{client.user_id}/insights',
                          {'metric': 'follower_count', 'period': 'day', 'since': since, 'until': until})
    except ApiError as e:
        refused['follower_count'] = str(e)
        return {}
    out = {}
    for item in data.get('data', []):
        for v in item.get('values', []):
            # end_time marks the end of the reported day
            end = datetime.datetime.fromisoformat(v['end_time'])
            day = (end - datetime.timedelta(days=1)).astimezone(KST).date()
            out[day.isoformat()] = v.get('value', 0)
    return out


def media_kind(media):
    return 'REELS' if media.get('media_product_type') == 'REELS' else 'FEED'


def collect_media_insights(client, media, refused_media):
    """Lifetime insights for one post. Asks for all metrics at once; if the
    API rejects the set, falls back to one metric at a time and remembers
    which (kind, metric) pairs are unsupported so later posts skip them."""
    kind = media_kind(media)
    metrics = [m for m in MEDIA_METRICS[kind] if f'{kind}:{m}' not in refused_media]
    if not metrics:
        return {}, 'no supported metrics'
    try:
        data = client.get(f"{media['id']}/insights", {'metric': ','.join(metrics)}).get('data', [])
        return {item['name']: parse_metric(item)[0] for item in data}, None
    except ApiError:
        pass
    out, errors = {}, {}
    for m in metrics:
        try:
            data = client.get(f"{media['id']}/insights", {'metric': m}).get('data', [])
            if data:
                out[m] = parse_metric(data[0])[0]
        except ApiError as e:
            errors[m] = e
    if not out:
        # Every metric failed: the post itself has no insights (e.g. posted
        # before the account became a professional account) - not a sign
        # that the metrics are unsupported for this kind of post.
        return {}, str(next(iter(errors.values()))) if errors else None
    for m, e in errors.items():
        if e.code == 100:
            refused_media.setdefault(f'{kind}:{m}', str(e))
    return out, None


def load_recipe_index():
    try:
        with open(RECIPES_PATH, encoding='utf-8') as f:
            recipes = json.load(f)
    except (OSError, ValueError):
        return {}, {}
    by_no, by_date = {}, {}
    for r in recipes:
        info = {
            'title': r.get('title'),
            'page_id': r.get('page_id'),
            'image': r.get('image'),
            'hashtags': r.get('hashtags') or [],
            'failed': bool(r.get('failed')),
            'calories': r.get('calories'),
            'weather': r.get('weather'),
        }
        if r.get('diary_no') is not None:
            by_no[str(r['diary_no'])] = info
        if r.get('date'):
            by_date.setdefault(r['date'], info)
    return by_no, by_date


def match_recipe(media, by_no, by_date):
    m = DIARY_NO_RE.search(media.get('caption') or '')
    if m and m.group(1) in by_no:
        return m.group(1), by_no[m.group(1)]
    date = to_kst_date(media['timestamp']).isoformat()
    return (m.group(1) if m else None), by_date.get(date)


def needs_full_refresh(meta, force):
    if force:
        return True
    last = meta.get('last_full_refresh')
    if not last:
        return True
    age = datetime.datetime.now(KST) - datetime.datetime.fromisoformat(last)
    return age.days >= FULL_REFRESH_EVERY_DAYS


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------

class LocalStore:
    def __init__(self, root):
        self.root = root

    def get_json(self, key, default):
        try:
            with open(os.path.join(self.root, key), encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def put_bytes(self, key, body, content_type):
        path = os.path.join(self.root, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(body)


class R2Store:
    def __init__(self):
        import boto3
        from botocore.config import Config
        self.bucket = os.environ['INSIGHTS_R2_BUCKET']
        self.client = boto3.client(
            's3',
            endpoint_url=os.environ['INSIGHTS_R2_ENDPOINT'],
            aws_access_key_id=os.environ['INSIGHTS_R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['INSIGHTS_R2_SECRET_ACCESS_KEY'],
            config=Config(signature_version='s3v4'),
            region_name='auto',
        )

    def get_json(self, key, default):
        try:
            obj = self.client.get_object(Bucket=self.bucket, Key=key)
            return json.loads(obj['Body'].read().decode())
        except self.client.exceptions.NoSuchKey:
            return default

    def put_bytes(self, key, body, content_type):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=content_type)


def put_json(store, key, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    store.put_bytes(key, body, 'application/json; charset=utf-8')


def upload_dashboard(store):
    count = 0
    for name in sorted(os.listdir(DASHBOARD_DIR)):
        path = os.path.join(DASHBOARD_DIR, name)
        if not os.path.isfile(path):
            continue
        ctype = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript',):
            ctype += '; charset=utf-8'
        with open(path, 'rb') as f:
            store.put_bytes(f'app/{name}', f.read(), ctype)
        count += 1
    print(f'Uploaded {count} dashboard file(s).')


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def update_token_status(meta, token, today):
    fingerprint = hashlib.sha256(token.encode()).hexdigest()[:12]
    prev = meta.get('token') or {}
    if prev.get('fingerprint') != fingerprint:
        # A change between two daily runs means it was issued within a day
        # of today; the very first token we see has an unknown issue date.
        prev = {'fingerprint': fingerprint, 'first_seen': today.isoformat(),
                'issued_known': bool(prev.get('fingerprint'))}
    override = os.environ.get('IG_TOKEN_ISSUED_AT', '').strip()
    issued = prev['first_seen']
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', override):
        issued, prev['issued_known'] = override, True
    prev['issued_at'] = issued
    prev['expires_estimate'] = (datetime.date.fromisoformat(issued)
                                + datetime.timedelta(days=TOKEN_LIFETIME_DAYS)).isoformat()
    meta['token'] = prev


def run(store, client, force_full):
    now = datetime.datetime.now(KST)
    today = now.date()
    meta = store.get_json('data/meta.json', {})
    profile_daily = store.get_json('data/profile_daily.json', {})
    account_daily = store.get_json('data/account_daily.json', {})
    posts = {p['id']: p for p in store.get_json('data/posts.json', [])}
    post_history = store.get_json('data/post_history.json', {})
    refused = {}
    refused_media = {}

    # 1. Profile snapshot (the only source of long-term follower history)
    update_token_status(meta, client.access_token, today)
    try:
        prof = client.profile()
    except ApiError as e:
        # 190 = invalid/expired token: record it so the dashboard can say so
        # (the rest of this run can't collect anything).
        if e.code == 190:
            meta['token']['error'] = {'at': now.isoformat(timespec='seconds'), 'message': str(e)[:200]}
            put_json(store, 'data/meta.json', meta)
        raise
    meta['token'].pop('error', None)
    profile_daily[today.isoformat()] = {
        k: prof.get(k) for k in ('followers_count', 'follows_count', 'media_count')
    }
    meta['username'] = prof.get('username')
    print('Profile snapshot saved.')

    # 2. Account-level daily insights: back-fill missing days in range and
    #    always refresh the most recent few (today is incomplete, so skipped)
    days = [today - datetime.timedelta(days=i) for i in range(1, ACCOUNT_LOOKBACK_DAYS + 1)]
    todo = [d for d in days
            if d.isoformat() not in account_daily or (today - d).days <= ACCOUNT_REFRESH_DAYS]
    try:
        for d in todo:
            row = collect_account_day(client, d, refused)
            if row:
                account_daily.setdefault(d.isoformat(), {}).update(row)
        for date_str, value in collect_follower_counts(client, todo, refused).items():
            account_daily.setdefault(date_str, {})['follower_count'] = value
        print(f'Account insights: {len(todo)} day(s) fetched.')
    except RateLimited:
        print('Rate limited during account insights; keeping what was fetched.')

    # 3. Posts: list everything, refresh insights for new/recent posts (all
    #    posts on a full refresh), and attach the recipes.json match
    by_no, by_date = load_recipe_index()
    full = needs_full_refresh(meta, force_full)
    media_list = list(client.all_media())
    refreshed = failed = 0
    rate_limited = False
    for media in media_list:
        post = posts.get(media['id'], {})
        diary_no, recipe = match_recipe(media, by_no, by_date)
        post.update({
            'id': media['id'],
            'timestamp': media.get('timestamp'),
            'date': to_kst_date(media['timestamp']).isoformat(),
            'media_type': media.get('media_type'),
            'media_product_type': media.get('media_product_type'),
            'permalink': media.get('permalink'),
            'carousel_count': (len(media.get('children', {}).get('data', []))
                               if media.get('media_type') == 'CAROUSEL_ALBUM' else None),
            'caption': media.get('caption') or '',
            'diary_no': diary_no,
            'recipe': recipe,
        })
        age_days = (today - to_kst_date(media['timestamp'])).days
        if not rate_limited and (full or 'insights' not in post or age_days <= RECENT_POST_DAYS):
            try:
                insights, error = collect_media_insights(client, media, refused_media)
                if insights:
                    post['insights'] = insights
                    if age_days <= RECENT_POST_DAYS:
                        post_history.setdefault(media['id'], {})[today.isoformat()] = {
                            k: insights[k] for k in HISTORY_METRICS if k in insights}
                    post['insights_at'] = now.isoformat(timespec='seconds')
                    post.pop('insights_error', None)
                    refreshed += 1
                elif error:
                    post['insights_error'] = error
                    failed += 1
            except RateLimited:
                rate_limited = True
                print('Rate limited during post insights; the rest will be refreshed next run.')
        posts[media['id']] = post
    print(f'Posts: {len(media_list)} listed, {refreshed} refreshed, {failed} without insights.')

    if full and not rate_limited:
        meta['last_full_refresh'] = now.isoformat(timespec='seconds')
    meta.update({
        'last_run': now.isoformat(timespec='seconds'),
        'api_version': API_VERSION,
        'refused_account_metrics': refused,
        'refused_media_metrics': refused_media,
        'api_calls_last_run': client.calls,
    })
    meta.setdefault('collecting_since', today.isoformat())
    for name in refused:
        print(f'  account metric not available: {name}')
    for name in refused_media:
        print(f'  post metric not available: {name}')

    put_json(store, 'data/profile_daily.json', profile_daily)
    put_json(store, 'data/account_daily.json', account_daily)
    put_json(store, 'data/posts.json', sorted(posts.values(), key=lambda p: p.get('timestamp') or ''))
    put_json(store, 'data/post_history.json', post_history)
    put_json(store, 'data/meta.json', meta)
    print(f'Saved. API calls this run: {client.calls}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--full', action='store_true', help="refresh every post's insights")
    parser.add_argument('--local', metavar='DIR', help='read/write DIR instead of R2')
    parser.add_argument('--assets-only', action='store_true', help='only upload dashboard files')
    args = parser.parse_args()

    store = LocalStore(args.local) if args.local else R2Store()
    upload_dashboard(store)
    if args.assets_only:
        return

    token = os.environ.get('IG_ACCESS_TOKEN')
    user_id = os.environ.get('IG_USER_ID')
    if not token or not user_id:
        sys.exit('IG_ACCESS_TOKEN and IG_USER_ID must be set.')
    try:
        run(store, InstagramClient(token, user_id), args.full)
    except ApiError as e:
        # e never contains the token (message comes from the API's JSON body)
        sys.exit(f'Instagram API error: {e}')


if __name__ == '__main__':
    main()
