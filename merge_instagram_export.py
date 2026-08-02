"""
merge_instagram_export.py

인스타그램 공식 데이터 내보내기(zip 압축 해제한 폴더)를 recipes.json과 병합하고,
사진을 웹사이트 images/ 폴더로 복사해주는 스크립트입니다.

사용법:
    python3 merge_instagram_export.py <내보내기_압축해제_폴더> <사이트_폴더>

예:
    python3 merge_instagram_export.py ~/Downloads/instagram-how.about.breakfast ./how-about-breakfast-recipes

<내보내기_압축해제_폴더> 안에는 아래와 같은 구조가 있어야 합니다 (표준 인스타그램 내보내기 구조):
    your_instagram_activity/media/posts_1.json  (또는 posts_2.json 등 여러 개)
    media/posts/...(실제 사진 파일들)

<사이트_폴더>는 index.html, recipes.json, parse.py 등이 들어있는 그 폴더입니다.
실행하면:
  1. recipes.json 을 백업(recipes.backup.json)
  2. posts_*.json 을 전부 읽어서 캡션의 #조식다이어리 N 번호로 매칭
     - 이미 있는 항목이면 image 필드만 추가
     - 없는 항목(예: 예전 텍스트 내보내기 이후에 새로 올라온 글)이면 새 레코드로 추가
  3. #조식다이어리 번호가 아예 없는 초창기 글(계정 시작일 ~ 1번 다이어리 시작일 사이)은
     "D-N" 형식(1번 시작 바로 전날 = D-1, 그 전날 = D-2 ...)으로 새 레코드 추가
  4. 매칭된 사진을 <사이트_폴더>/images/{diary_no 또는 D-N}.jpg 로 복사 (Pillow가 있으면
     폭 1000px로 리사이즈/압축, 없으면 원본 그대로 복사)
  5. 갱신된 recipes.json 저장

필요 라이브러리: 없어도 동작합니다. 있으면(pip install pillow) 사진을 웹에 적합한
크기로 압축해서 용량을 크게 줄여줍니다.
"""
import sys
import os
import re
import json
import glob
import shutil
import datetime

# 계정 시작일 (프로필 소개 기준). #조식다이어리 번호가 없는 초창기 글을 찾는 범위의
# 하한선으로 쓰입니다. 필요하면 이 값만 바꾸면 됩니다.
ACCOUNT_START_DATE = '2020-07-13'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse import parse_entry  # noqa: E402

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def fix_mojibake(s):
    """Instagram's official export writes UTF-8 bytes through a Latin-1 JSON
    string escaper, so text comes out garbled unless re-decoded like this."""
    if not s:
        return s
    try:
        fixed = s.encode('latin1').decode('utf-8')
        # heuristic: if it round-trips to something with hangul, trust it
        return fixed
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def find_posts_json_files(export_dir):
    patterns = [
        'your_instagram_activity/media/posts_*.json',
        'your_instagram_activity/media/posts.json',
    ]
    found = []
    for pat in patterns:
        found.extend(glob.glob(os.path.join(export_dir, pat), recursive=True))
    # dedupe, keep order
    seen = set()
    result = []
    for f in found:
        rp = os.path.realpath(f)
        if rp not in seen:
            seen.add(rp)
            result.append(f)
    return result


def find_reels_json_files(export_dir):
    patterns = [
        'your_instagram_activity/media/reels.json',
        'your_instagram_activity/media/reels_*.json',
    ]
    found = []
    for pat in patterns:
        found.extend(glob.glob(os.path.join(export_dir, pat), recursive=True))
    seen = set()
    result = []
    for f in found:
        rp = os.path.realpath(f)
        if rp not in seen:
            seen.add(rp)
            result.append(f)
    return result


def load_reels(path):
    """Instagram's reels.json wraps each reel as {"media": [{uri, creation_timestamp,
    title, ...}]} inside a top-level "ig_reels_media" list. Flatten that into
    simple post-like dicts so the rest of the script can treat reels the same
    way it treats feed posts."""
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    entries = raw.get('ig_reels_media', []) if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        return []
    flattened = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        media_list = entry.get('media', [])
        for item in media_list:
            if not isinstance(item, dict):
                continue
            flattened.append({
                'title': item.get('title', ''),
                'creation_timestamp': item.get('creation_timestamp'),
                'media': [item],
            })
    return flattened


KST = datetime.timezone(datetime.timedelta(hours=9))


def extract_date_str(post, title=''):
    m = re.match(r'\s*(\d{8})', title)
    if m:
        return m.group(1)
    ts = post.get('creation_timestamp')
    if not ts:
        return None
    # Instagram's export timestamp is UTC; posts made late at night KST
    # (e.g. 1am KST = 4pm UTC the previous day) need to be converted to KST
    # before taking the date, or they land on the wrong calendar day.
    return datetime.datetime.fromtimestamp(ts, KST).strftime('%Y%m%d')


def save_image(src_path, dest_path, max_width=1000, quality=82):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    if HAS_PIL:
        try:
            img = Image.open(src_path)
            img = img.convert('RGB')
            if img.width > max_width:
                ratio = max_width / img.width
                img = img.resize((max_width, int(img.height * ratio)))
            img.save(dest_path, 'JPEG', quality=quality, optimize=True)
            return
        except Exception as e:
            print(f'  ! Pillow resize failed ({e}), copying original instead')
    shutil.copyfile(src_path, dest_path)


def copy_post_images(post, name_base, export_dir, images_dir):
    """Copy all jpg/png media for a post into images_dir, named name_base.jpg,
    name_base_2.jpg, ... Also copies a native video within the post's own
    media, if present - a regular feed post (matched via #조식다이어리 N in
    its caption, not a separate Reel) can itself contain a video as one of
    its media items, e.g. when the video is posted first. Only the very
    first media item is considered for this - some posts end with an
    unrelated follow-me/outro clip as their last item, which should not be
    picked up as the recipe's video. Returns
    (image_missing: bool, gallery: list[str], video: str|None)."""
    media_items = post.get('media', [])
    jpg_uris = [md['uri'] for md in media_items if md.get('uri', '').lower().endswith(('.jpg', '.jpeg', '.png'))]
    mp4_uris = []
    if media_items and media_items[0].get('uri', '').lower().endswith('.mp4'):
        mp4_uris = [media_items[0]['uri']]

    def resolve_src(uri):
        src = os.path.join(export_dir, uri)
        if os.path.isfile(src):
            return src
        alt = os.path.join(export_dir, 'your_instagram_activity', uri)
        return alt if os.path.isfile(alt) else None

    gallery_rel_paths = []
    for i, uri in enumerate(jpg_uris):
        src = resolve_src(uri)
        if not src:
            continue
        dest_name = f'{name_base}.jpg' if i == 0 else f'{name_base}_{i+1}.jpg'
        dest = os.path.join(images_dir, dest_name)
        save_image(src, dest)
        gallery_rel_paths.append(f'images/{dest_name}')

    video_rel_path = None
    for uri in mp4_uris:
        src = resolve_src(uri)
        if not src:
            continue
        dest_name = f'{name_base}.mp4'
        dest = os.path.join(images_dir, dest_name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(src, dest)
        video_rel_path = f'images/{dest_name}'
        break  # one video per post is enough

    return (not jpg_uris and not video_rel_path), gallery_rel_paths, video_rel_path


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    export_dir = sys.argv[1]
    site_dir = sys.argv[2]
    recipes_path = os.path.join(site_dir, 'recipes.json')
    images_dir = os.path.join(site_dir, 'images')

    if not os.path.isfile(recipes_path):
        print(f'! recipes.json not found at {recipes_path}')
        sys.exit(1)

    with open(recipes_path, encoding='utf-8') as f:
        recipes = json.load(f)
    shutil.copyfile(recipes_path, os.path.join(site_dir, 'recipes.backup.json'))
    print(f'Backed up existing recipes.json -> recipes.backup.json ({len(recipes)} records)')

    recipe_by_no = {r['diary_no']: r for r in recipes if r.get('diary_no') is not None}
    # existing pre-numbering (D-N) entries, keyed by date, so re-running the
    # script doesn't create duplicates
    pre_by_date = {r['date']: r for r in recipes if r.get('diary_no') is None and r.get('pre_label') and r.get('date')}

    numbered_dates = sorted(r['date'] for r in recipes if r.get('diary_no') is not None and r.get('date'))
    anchor_date = datetime.date.fromisoformat(numbered_dates[0]) if numbered_dates else None
    account_start = datetime.date.fromisoformat(ACCOUNT_START_DATE)

    posts_files = find_posts_json_files(export_dir)
    if not posts_files:
        print('! posts_*.json not found under', export_dir)
        print('  직접 경로를 확인해서 스크립트 상단의 find_posts_json_files() 패턴을 조정해주세요.')
        sys.exit(1)
    print(f'Found {len(posts_files)} posts json file(s): {posts_files}')

    all_posts = []
    for pf in posts_files:
        with open(pf, encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list):
            all_posts.extend([item for item in data if isinstance(item, dict)])
    print(f'Total posts in export: {len(all_posts)}')

    matched, added, no_diary_no, image_missing, pre_added, pre_skipped = 0, 0, 0, 0, 0, 0
    pre_posts_by_date = {}  # date_iso -> list of (date_str, title, post), filled in below

    for post in all_posts:
        title = fix_mojibake(post.get('title', ''))
        m = re.search(r'#조식다이어리\s*(\d+)', title)

        if m:
            diary_no = int(m.group(1))
            image_no_jpg, gallery_rel_paths, video_rel_path = copy_post_images(post, str(diary_no), export_dir, images_dir)
            if image_no_jpg:
                image_missing += 1

            if diary_no in recipe_by_no:
                rec = recipe_by_no[diary_no]
                if gallery_rel_paths:
                    rec['image'] = gallery_rel_paths[0]
                    if len(gallery_rel_paths) > 1:
                        rec['gallery'] = gallery_rel_paths
                if video_rel_path:
                    rec['video'] = video_rel_path
                matched += 1
            else:
                date_str = extract_date_str(post, title) or ''
                new_rec = parse_entry(date_str, False, title)
                if gallery_rel_paths:
                    new_rec['image'] = gallery_rel_paths[0]
                    if len(gallery_rel_paths) > 1:
                        new_rec['gallery'] = gallery_rel_paths
                if video_rel_path:
                    new_rec['video'] = video_rel_path
                recipes.append(new_rec)
                recipe_by_no[diary_no] = new_rec
                added += 1
            continue

        no_diary_no += 1

        # --- not a numbered diary post: is it one of the early, pre-numbering
        # breakfast posts (account start ~ the day before diary #1)? ---
        if anchor_date is None:
            continue
        date_str = extract_date_str(post, title)
        if not date_str:
            continue
        try:
            post_date = datetime.date(int(date_str[0:4]), int(date_str[4:6]), int(date_str[6:8]))
        except ValueError:
            continue
        if not (account_start <= post_date < anchor_date):
            continue  # outside the pre-numbering window, or a typo'd date

        date_iso = post_date.isoformat()
        pre_posts_by_date.setdefault(date_iso, []).append((date_str, title, post))

    # --- process pre-numbering posts, one calendar day at a time. Most early
    # days have exactly one Instagram post. Some days have more than one
    # (posted more than once before the #조식다이어리 numbering habit started),
    # and matching purely by date can't tell which photo belongs to that
    # day's diary text - so for those we keep every candidate on the record
    # and let review.html surface them for a manual pick, instead of silently
    # guessing and possibly attaching the wrong photo. ---
    ambiguous_dates = 0
    for date_iso, entries in pre_posts_by_date.items():
        days_before = (anchor_date - datetime.date.fromisoformat(date_iso)).days
        pre_label = f'D-{days_before}'

        rec = pre_by_date.get(date_iso)
        if rec is not None and rec.get('photo_review_resolved'):
            # a human already picked the right photo for this ambiguous day
            # during review; leave it alone on re-runs.
            pre_skipped += 1
            continue

        candidates = []
        for i, (date_str, title, post) in enumerate(entries):
            suffix = '' if i == 0 else f'-alt{i + 1}'
            image_no_jpg, gallery_rel_paths, _video_rel_path = copy_post_images(post, f'pre-{days_before}{suffix}', export_dir, images_dir)
            if gallery_rel_paths:
                candidates.append(gallery_rel_paths)
            elif image_no_jpg:
                image_missing += 1

        if rec is None:
            date_str, title, _post = entries[0]
            rec = parse_entry(date_str, False, title)
            rec['pre_label'] = pre_label
            recipes.append(rec)
            pre_by_date[date_iso] = rec
            pre_added += 1
        else:
            pre_skipped += 1

        if len(candidates) > 1:
            rec['photo_candidates'] = candidates
            if not rec.get('image'):
                rec['image'] = candidates[0][0]
                if len(candidates[0]) > 1:
                    rec['gallery'] = candidates[0]
            ambiguous_dates += 1
        elif len(candidates) == 1:
            rec['image'] = candidates[0][0]
            if len(candidates[0]) > 1:
                rec['gallery'] = candidates[0]
            rec.pop('photo_candidates', None)

    def sort_key(r):
        return (r.get('date') or '0000-00-00', r.get('diary_no') or 0)

    # --- reels: attach matching video to whichever diary entry shares its date/number ---
    reels_files = find_reels_json_files(export_dir)
    reel_matched, reel_unmatched = 0, 0
    if reels_files:
        print(f'Found {len(reels_files)} reels json file(s): {reels_files}')
        all_reels = []
        for rf in reels_files:
            all_reels.extend(load_reels(rf))
        print(f'Total reels in export: {len(all_reels)}')

        by_date = {r['date']: r for r in recipes if r.get('date')}

        for reel in all_reels:
            title = fix_mojibake(reel.get('title', ''))
            m = re.search(r'#조식다이어리\s*(\d+)', title)
            rec = None
            name_base = None
            if m:
                diary_no = int(m.group(1))
                rec = recipe_by_no.get(diary_no)
                name_base = str(diary_no)
            if rec is None:
                date_str = extract_date_str(reel, title)
                if date_str:
                    try:
                        d = datetime.date(int(date_str[0:4]), int(date_str[4:6]), int(date_str[6:8]))
                        rec = by_date.get(d.isoformat())
                        if rec is not None:
                            name_base = str(rec.get('diary_no')) if rec.get('diary_no') is not None else rec.get('pre_label', d.isoformat())
                    except ValueError:
                        pass

            if rec is None:
                reel_unmatched += 1
                continue

            mp4_uris = [md['uri'] for md in reel.get('media', []) if md.get('uri', '').lower().endswith('.mp4')]
            for uri in mp4_uris:
                src = os.path.join(export_dir, uri)
                if not os.path.isfile(src):
                    alt = os.path.join(export_dir, 'your_instagram_activity', uri)
                    src = alt if os.path.isfile(alt) else src
                if not os.path.isfile(src):
                    continue
                dest_name = f'{name_base}.mp4'
                dest = os.path.join(images_dir, dest_name)
                os.makedirs(images_dir, exist_ok=True)
                shutil.copyfile(src, dest)
                rec['video'] = f'images/{dest_name}'
                reel_matched += 1
                break  # one video per entry is enough

    recipes.sort(key=sort_key, reverse=True)

    with open(recipes_path, 'w', encoding='utf-8') as f:
        json.dump(recipes, f, ensure_ascii=False, indent=1)

    print()
    print('=== 완료 ===')
    print(f'기존 항목에 사진 매칭: {matched}')
    print(f'새로 추가된 항목(예전 텍스트에 없던 글): {added}')
    print(f'#조식다이어리 번호를 못 찾은 게시물: {no_diary_no}')
    print(f'  → 이 중 초창기(D-N) 글로 새로 추가: {pre_added}, 이미 있어서 사진만 갱신: {pre_skipped}')
    print(f'  → 하루에 게시물이 여러 개라 사진 후보를 review.html에서 골라야 하는 날: {ambiguous_dates}')
    print(f'사진이 없는 게시물(영상만 있는 릴스 등으로 추정): {image_missing}')
    if reels_files:
        print(f'릴스 매칭되어 영상 추가: {reel_matched}')
        print(f'릴스 중 매칭되는 다이어리 항목을 못 찾음: {reel_unmatched}')
    print(f'최종 recipes.json 총 레코드 수: {len(recipes)}')
    print(f'사진은 {images_dir} 에 저장되었습니다.')
    if not HAS_PIL:
        print()
        print('참고: Pillow가 없어서 사진을 원본 그대로 복사했어요. 용량을 줄이려면:')
        print('  pip install pillow --break-system-packages')
        print('  설치 후 스크립트를 다시 실행하면 자동으로 리사이즈/압축됩니다.')


if __name__ == '__main__':
    main()
