"""
sync_instagram.py

Polls the Instagram Graph API for this account's most recent posts and adds
any that aren't in recipes.json yet, matched by #조식다이어리 N in the caption
(same convention merge_instagram_export.py uses for the bulk export format).
Meant to run on a schedule (see .github/workflows/instagram-sync.yml) so
daily posts flow onto the site without a manual review.html pass.

Safe to re-run: only checks the most recent FETCH_LIMIT posts and skips any
whose diary_no is already in recipes.json, so a missed or repeated run just
no-ops on posts already ingested. Also skips Reels that re-edit an older
post (same diary_no, posted again later as a video) and any post where
#조식다이어리 N can't be found in the caption at all - those are logged for a
manual look via review.html rather than guessed at.

Requires .ig-credentials.json (gitignored):
    {"access_token": "...", "ig_user_id": "..."}

Usage:
    python sync_instagram.py
"""
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parse import parse_entry  # noqa: E402
from merge_instagram_export import save_image, KST  # noqa: E402

CRED_PATH = os.path.join(HERE, '.ig-credentials.json')
RECIPES_PATH = os.path.join(HERE, 'recipes.json')
IMAGES_DIR = os.path.join(HERE, 'images')
API_VERSION = 'v21.0'
FETCH_LIMIT = 15


def load_credentials():
    with open(CRED_PATH, encoding='utf-8') as f:
        return json.load(f)


def api_get(path, params, access_token):
    params = dict(params)
    params['access_token'] = access_token
    url = f'https://graph.instagram.com/{API_VERSION}/{path}?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_recent_media(ig_user_id, access_token, limit=FETCH_LIMIT):
    fields = ('id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,'
              'children{media_type,media_url,thumbnail_url}')
    data = api_get(f'{ig_user_id}/media', {'fields': fields, 'limit': limit}, access_token)
    return data.get('data', [])


def extract_date_str(media, caption):
    m = re.match(r'\s*(\d{8})', caption)
    if m:
        return m.group(1)
    ts = media.get('timestamp')
    if not ts:
        return None
    # Instagram's Graph API timestamp is an ISO8601 string with its own
    # offset; convert to KST before taking the calendar date, same reasoning
    # as merge_instagram_export.py's extract_date_str (a late-night KST post
    # can otherwise land on the wrong day).
    dt = datetime.datetime.fromisoformat(ts)
    return dt.astimezone(KST).strftime('%Y%m%d')


def download_to_file(url, dest_path):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, 'wb') as f:
        f.write(data)


def download_post_media(media, name_base):
    """Mirrors copy_post_images() in merge_instagram_export.py, but pulls
    from the Graph API's remote media_url instead of local export files.
    Only the first media item is considered for a video (a carousel's
    trailing outro clip should not be picked up as the recipe's video).
    Returns (image_missing, gallery_rel_paths, video_rel_path)."""
    media_type = media.get('media_type')
    items = media.get('children', {}).get('data', []) if media_type == 'CAROUSEL_ALBUM' else [media]

    image_items = [it for it in items if it.get('media_type') == 'IMAGE']
    video_first = bool(items) and items[0].get('media_type') == 'VIDEO'

    gallery_rel_paths = []
    for i, item in enumerate(image_items):
        dest_name = f'{name_base}.jpg' if i == 0 else f'{name_base}_{i + 1}.jpg'
        dest = os.path.join(IMAGES_DIR, dest_name)
        tmp = dest + '.download'
        download_to_file(item['media_url'], tmp)
        save_image(tmp, dest)
        if os.path.exists(tmp):
            os.remove(tmp)
        gallery_rel_paths.append(f'images/{dest_name}')

    video_rel_path = None
    if video_first:
        dest_name = f'{name_base}.mp4'
        dest = os.path.join(IMAGES_DIR, dest_name)
        download_to_file(items[0]['media_url'], dest)
        video_rel_path = f'images/{dest_name}'

    return (not gallery_rel_paths and not video_rel_path), gallery_rel_paths, video_rel_path


def main():
    cred = load_credentials()
    with open(RECIPES_PATH, encoding='utf-8') as f:
        recipes = json.load(f)

    recipe_by_no = {r['diary_no']: r for r in recipes if r.get('diary_no') is not None}

    media_list = fetch_recent_media(cred['ig_user_id'], cred['access_token'])
    print(f'Checked {len(media_list)} recent Instagram post(s).')

    added, video_attached = 0, 0
    for media in media_list:
        caption = media.get('caption') or ''
        m = re.search(r'#조식다이어리\s*(\d+)', caption)
        if not m:
            print(f'  skip (no #조식다이어리 N in caption): {media.get("permalink")}')
            continue

        diary_no = int(m.group(1))
        existing = recipe_by_no.get(diary_no)

        if existing is not None:
            # A later Reels re-edit of an already-known post: attach its video
            # to the existing record instead of creating a duplicate entry.
            if media.get('media_type') == 'VIDEO' and not existing.get('video'):
                _missing, _gallery, video = download_post_media(media, str(diary_no))
                if video:
                    existing['video'] = video
                    video_attached += 1
                    print(f'  ~ attached video to existing #{diary_no}')
            continue

        date_str = extract_date_str(media, caption)
        image_missing, gallery, video = download_post_media(media, str(diary_no))
        if image_missing:
            print(f'  ! #{diary_no}: no downloadable photo/video found, skipping auto-add (review manually)')
            continue

        rec = parse_entry(date_str, False, caption)
        if gallery:
            rec['image'] = gallery[0]
            if len(gallery) > 1:
                rec['gallery'] = gallery
        if video:
            rec['video'] = video
        recipes.append(rec)
        recipe_by_no[diary_no] = rec
        added += 1
        print(f'  + added #{diary_no} ({rec.get("date")}): {rec.get("title")}')

    if added or video_attached:
        recipes.sort(key=lambda r: (r.get('date') or '0000-00-00', r.get('diary_no') or 0), reverse=True)
        with open(RECIPES_PATH, 'w', encoding='utf-8') as f:
            json.dump(recipes, f, ensure_ascii=False, indent=1)
        print(f'recipes.json updated: {added} new record(s), {video_attached} video(s) attached to existing posts.')
    else:
        print('No new posts to add.')


if __name__ == '__main__':
    main()
