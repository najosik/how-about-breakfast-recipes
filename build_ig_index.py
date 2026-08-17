"""
build_ig_index.py

Builds ig_index.json: a {date: {caption, images, video_thumbnail,
permalink, timestamp}} map of every Instagram post on this account, keyed
by the same date convention sync_instagram.py uses (the caption's own
leading YYYYMMDD, falling back to the post's timestamp converted to KST).

This exists so the admin editor's "빠진 날짜" preview can look up what
Instagram actually has for a given date instantly, instead of paginating
through the whole feed live on every click. cloudflare-worker/edit-api.js's
'preview' action stays in place as a slower fallback for any date posted
after the last time this index was rebuilt.

Requires .ig-credentials.json (gitignored):
    {"access_token": "...", "ig_user_id": "..."}

Usage:
    python build_ig_index.py
"""
import datetime
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from merge_instagram_export import KST  # noqa: E402

CRED_PATH = os.path.join(HERE, '.ig-credentials.json')
INDEX_PATH = os.path.join(HERE, 'ig_index.json')
API_VERSION = 'v21.0'
PAGE_LIMIT = 100


def load_credentials():
    with open(CRED_PATH, encoding='utf-8') as f:
        return json.load(f)


def extract_item_date(item):
    caption = unicodedata.normalize('NFC', item.get('caption') or '')
    m = re.match(r'\s*(\d{4})(\d{2})(\d{2})', caption)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    ts = item.get('timestamp')
    if not ts:
        return None
    dt = datetime.datetime.fromisoformat(ts)
    return dt.astimezone(KST).strftime('%Y-%m-%d')


def summarize(item):
    media_type = item.get('media_type')
    parts = item.get('children', {}).get('data', []) if media_type == 'CAROUSEL_ALBUM' else [item]
    images = [p['media_url'] for p in parts if p.get('media_type') == 'IMAGE' and p.get('media_url')]
    video = next((p for p in parts if p.get('media_type') == 'VIDEO'), None)
    return {
        'caption': unicodedata.normalize('NFC', item.get('caption') or ''),
        'images': images,
        'video_thumbnail': (video or {}).get('thumbnail_url'),
        'permalink': item.get('permalink'),
        'timestamp': item.get('timestamp'),
    }


def main():
    cred = load_credentials()
    fields = ('id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,'
              'children{media_type,media_url,thumbnail_url}')
    params = {'fields': fields, 'limit': PAGE_LIMIT, 'access_token': cred['access_token']}
    url = f'https://graph.instagram.com/{API_VERSION}/{cred["ig_user_id"]}/media?' + urllib.parse.urlencode(params)

    index = {}
    pages = 0
    while url:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        pages += 1
        for item in data.get('data', []):
            date = extract_item_date(item)
            if not date or date in index:
                # Newest-first order: first hit for a date wins, matching
                # the live preview fallback's same-day tiebreak.
                continue
            index[date] = summarize(item)
        url = (data.get('paging') or {}).get('next')
        print(f'  page {pages}: {len(index)} dates indexed so far')

    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f'ig_index.json written: {len(index)} dates across {pages} page(s).')


if __name__ == '__main__':
    main()
