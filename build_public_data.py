"""
build_public_data.py

Derives everything the deployed site needs from recipes.json (the full,
hand-edited source of truth used by review.html):

  1. recipes-index.json — a slimmed, minified copy of recipes.json that
     home.js/app.js actually fetch. Drops fields no client-side code reads
     (`raw`, `date_raw`, `photo_candidates`, `photo_review_resolved`) and
     drops deleted:true records entirely. This is what cuts the payload
     down (raw alone is ~32% of the file and is unused at runtime).
  2. recipes/<id>.html — one static Korean page per recipe, with real meta
     tags, Open Graph/Twitter previews using that recipe's own photo, and
     Recipe JSON-LD structured data when ingredients+steps are both
     present. Gives every recipe a crawlable, shareable URL.
  3. en/recipes/<id>.html — the matching English page, pre-rendered from
     the record's `_en` translation (title/intro/ingredients/steps),
     skipped for any record that hasn't been translated yet. Korean and
     English pages carry reciprocal hreflang alternates.
  4. sitemap.xml — regenerated to include every recipe page, both languages.

The one field this script DOES write back into recipes.json is `page_id`:
once a record gets a page id, it's frozen there permanently, so editing a
post's title later can't silently change its URL and orphan whatever was
already indexed or shared under the old one. Every other field is only
ever read, never written, by this script.

Run this after editing recipes.json (by hand or via review.html) and
before committing/deploying.

Usage:
    python build_public_data.py
"""
import json
import os
import re
import html

HERE = os.path.dirname(os.path.abspath(__file__))
RECIPES_PATH = os.path.join(HERE, 'recipes.json')
INDEX_PATH = os.path.join(HERE, 'recipes-index.json')
INDEX_EN_PATH = os.path.join(HERE, 'recipes-index-en.json')
PAGES_DIR = os.path.join(HERE, 'recipes')
PAGES_DIR_EN = os.path.join(HERE, 'en', 'recipes')
SITEMAP_PATH = os.path.join(HERE, 'sitemap.xml')
VOTE_PATH = os.path.join(HERE, 'monthly-vote.json')

SITE_BASE = 'https://how-about-breakfast.com'

# 공유 CSS/JS가 바뀔 때마다 값을 올려서 Cloudflare/브라우저 캐시를 무효화한다.
# (정적 페이지 index/archive/vote/privacy/en-privacy.html의 <link>/<script>도 함께 올려줄 것)
ASSET_VERSION = '20260926c'


def load_medal_winners():
    """{page_id: target_month} for every 이달의 조식 vote round that has a
    winner recorded - drives the medal badge on that record's card and
    detail page. monthly-vote.json is optional (site works fine before the
    feature's first round is ever registered)."""
    if not os.path.exists(VOTE_PATH):
        return {}
    with open(VOTE_PATH, encoding='utf-8') as f:
        data = json.load(f)
    return {
        r['winner']: r['target_month']
        for r in data.get('rounds', [])
        if r.get('winner')
    }

# Static per-language labels for the recipe page chrome (headers, nav,
# share button). Free-text recipe content itself comes from r['_en'].
LABELS = {
    'ko': {
        'site_name': '날마다 조식',
        'title_suffix': '날마다 조식',
        'archive_back': '아카이브',
        'nav_home': '← 홈으로',
        'notes': '메모', 'ingredients': '재료', 'steps': '조리',
        'credit': '원본 크레딧', 'tags': '태그',
        'failed_badge': '실패기',
        'share_label': '링크 복사', 'share_copied': '복사됨!',
        'ig_link': '인스타그램 원문 ↗', 'ig_link_short': '원문 ↗',
        'switch_label': 'EN',
        'recipe_word': '레시피',
        'prev_fallback': '이전', 'next_fallback': '다음',
        'prev_prefix': '← 전날', 'next_suffix': '다음날 →',
        'footer_privacy': '개인정보처리방침',
        'medal_label': '이달의 조식',
        'cook_start': '요리하기',
        'kcal_label': '1인분 열량',
        'no_checklist_note': '',
        'checklist_note': '장 볼 때 체크해 두면 표시가 남아요.',
        'other_years_title': '다른 해의 {date}',
        'other_years_more': '모두 보기 →',
        'same_day_note': '이 날 다른 게시물도 있어요:',
        'mobile_jump': '재료로 이동',
    },
    'en': {
        'site_name': 'Breakfast, Every Day',
        'title_suffix': 'Breakfast, Every Day',
        'archive_back': 'Archive',
        'nav_home': '← Home',
        'notes': 'Notes', 'ingredients': 'Ingredients', 'steps': 'Steps',
        'credit': 'Original Credit', 'tags': 'Tags',
        'failed_badge': 'Failed attempt',
        'share_label': 'Copy link', 'share_copied': 'Copied!',
        'ig_link': 'Original on Instagram ↗', 'ig_link_short': 'Original ↗',
        'switch_label': 'KO',
        'recipe_word': 'recipe',
        'prev_fallback': 'Previous', 'next_fallback': 'Next',
        'prev_prefix': '← Previous', 'next_suffix': 'Next →',
        'footer_privacy': 'Privacy Policy',
        'medal_label': 'Breakfast of the Month',
        'cook_start': 'Start Cooking',
        'kcal_label': 'Calories (per serving)',
        'no_checklist_note': '',
        'checklist_note': 'Check items off while grocery shopping - it’s remembered here.',
        'other_years_title': 'Other years, {date}',
        'other_years_more': 'See all →',
        'same_day_note': 'There’s another post from this day:',
        'mobile_jump': 'Jump to ingredients',
    },
}


def json_script_safe(obj):
    """Serializes `obj` for embedding inside a <script type="application/json">
    tag - escapes '<', '>', '&' as \\uXXXX so the recipe text can never be
    mistaken for markup or close the script tag early (the same technique
    Django's json_script uses)."""
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace('<', '\\u003c')
        .replace('>', '\\u003e')
        .replace('&', '\\u0026')
    )

# Best-effort translation for the standalone `weather` field (e.g. "31도/맑음")
# shown in the meta line. The _en data only covers title/intro/ingredients/
# steps, not this field, so unmatched terms are left in Korean rather than
# guessed at.
WEATHER_EN = {
    '맑음': 'clear', '대체로맑음': 'mostly clear', '흐림': 'cloudy', '후림': 'cloudy',
    '대체로흐림': 'mostly cloudy', '비': 'rainy', '눈': 'snowy', '한때흐림': 'briefly cloudy',
}


def weather_en(weather):
    if not weather:
        return weather
    m = re.match(r'^(-?\d+)\s*도\s*/\s*(.+)$', weather)
    if not m:
        return weather
    temp, cond = m.group(1), m.group(2).strip()
    return f'{temp}°C/{WEATHER_EN.get(cond, cond)}'

# AdSense: 사이트 소유권 확인용 퍼블리셔 ID. 광고 단위(ad-slot)는 심사 통과 후
# 발급되며, AD_SLOT_RECIPE_BOTTOM을 채우기 전까지는 로더 스크립트만 로드되고
# 실제 광고 <ins> 태그는 렌더링되지 않습니다.
AD_CLIENT = 'ca-pub-2329784289008303'
AD_SLOT_RECIPE_BOTTOM = ''  # 예: '1234567890' — 심사 통과 후 광고 단위 생성 시 발급

# 사진+한두 줄뿐인 초기 게시물처럼 콘텐츠가 지나치게 적은 페이지는
# 애드센스 정책(광고 대비 콘텐츠 부족) 위반 소지가 있어 광고를 아예 넣지 않는다.
MIN_AD_CONTENT_CHARS = 60

INDEX_FIELDS = [
    'date', 'diary_no', 'pre_label', 'weather', 'failed', 'calories',
    'title', 'credit', 'hashtags', 'intro', 'ingredients', 'steps',
    'image', 'gallery', 'video', 'permalink', 'day_secondary',
    'essay_candidate', 'essay_reviewed',
]


def slugify(text):
    text = (text or '').strip()
    text = re.sub(r'[^\w\-]+', '-', text)
    text = re.sub(r'-{2,}', '-', text).strip('-')
    if len(text) > 60:
        text = text[:60]
        if '-' in text:
            text = text.rsplit('-', 1)[0]
    return text


def base_page_id(r):
    slug = slugify(display_title(r))
    if slug:
        return slug
    if r.get('diary_no') is not None:
        return str(r['diary_no'])
    if r.get('pre_label'):
        return r['pre_label']
    return (r.get('date') or 'unknown').replace('-', '')


def assign_unique_page_ids(records):
    """A record that already has a `page_id` keeps it forever, regardless
    of what its title becomes later — that id is what search engines and
    shared links point at, and changing it out from under them orphans
    the old URL. Only records with no page_id yet (brand-new posts) get
    one newly minted here, deduped against every id already in use.

    (Some diary_no values repeat on purpose — a failed attempt retried
    later the same day keeps the same #조식다이어리 N — so newly minted ids
    still suffix -2, -3, ... on repeat base slugs.)"""
    ids = [r.get('page_id') for r in records]
    taken = {pid for pid in ids if pid}
    for i, r in enumerate(records):
        if ids[i]:
            continue
        base = base_page_id(r)
        candidate = base
        n = 1
        while candidate in taken:
            n += 1
            candidate = f'{base}-{n}'
        ids[i] = candidate
        taken.add(candidate)
    return ids


def sort_key(r):
    d = r.get('date')
    valid = bool(d) and re.match(r'^\d{4}-\d{2}-\d{2}$', d)
    return d if valid else '9999-99-99'


def esc(s):
    return html.escape(str(s), quote=True) if s is not None else ''


RAW_HEADER_RE = re.compile(r'^\d{8}\s*#조식다이어리')


def display_title(r):
    """A handful of essay-era records never got a real title extracted and
    fell back to either the raw '20250926 #조식다이어리 1519, 20도/흐림' diary
    header, or a stray punctuation fragment like ')' - neither is usable as
    a page <title>/<h1>. Derive something readable instead."""
    title = r.get('title') or ''
    looks_broken = RAW_HEADER_RE.match(title) or not re.search(r'[가-힣a-zA-Z0-9]', title)
    if not looks_broken:
        return title or '(제목 미상)'
    cleaned = clean_description(r.get('intro'), '', fallback_suffix='').strip()
    if cleaned:
        return cleaned[:40] + ('…' if len(cleaned) > 40 else '')
    tags = [h for h in (r.get('hashtags') or []) if h not in ('조식', '조식다이어리')]
    if tags:
        return ' '.join(tags[:3])
    return r.get('date') or '(제목 미상)'


def clean_description(intro, title, fallback_suffix='레시피'):
    """intro often starts with the raw '20260731 #조식다이어리 1796, 날씨' header
    line copied from the diary text - drop that before using it as a meta
    description, so search snippets read as a sentence instead of a date code."""
    text = (intro or '').strip()
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if lines and re.match(r'^\d{8}\b', lines[0]):
        lines = lines[1:]
    cleaned = ' '.join(lines).strip()
    if not cleaned:
        return f'{title} {fallback_suffix}'
    return cleaned[:150]


def build_index(live, ids, medal_winners):
    slim = []
    for r, pid in zip(live, ids):
        rec = {k: r[k] for k in INDEX_FIELDS if k in r}
        rec['page_id'] = pid
        if pid in medal_winners:
            rec['medal'] = medal_winners[pid]
        slim.append(rec)
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(slim, f, ensure_ascii=False, separators=(',', ':'))
    return slim


def build_index_en(live, ids):
    """Keyed by page_id (not a parallel array) so the client can fetch this
    lazily, only once someone actually switches to English, and merge it
    into records it already has by simple lookup. Left out of
    recipes-index.json itself so the default (Korean) page load doesn't
    pay for text most visitors never see — English text alone runs longer
    than the Korean it's translated from, so inlining it would roughly
    double that file's size for everyone."""
    en_map = {}
    for r, pid in zip(live, ids):
        en = r.get('_en')
        if not en:
            continue
        en_map[pid] = {
            'title': en.get('title') or '',
            'intro': en.get('intro') or '',
            'ingredients': en.get('ingredients') or '',
            'steps': en.get('steps') or '',
        }
    with open(INDEX_EN_PATH, 'w', encoding='utf-8') as f:
        json.dump(en_map, f, ensure_ascii=False, separators=(',', ':'))
    return en_map


def stamp_label(r):
    if r.get('diary_no') is not None:
        return '#' + str(r['diary_no'])
    return r.get('pre_label') or '#?'


MONTH_NAMES = {
    'ko': ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
    'en': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
WEEKDAY_NAMES_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def parse_date_parts(date):
    """('2022-09-25', 'ko'/'en') -> (year, month, day) ints, or None."""
    if not date or not re.match(r'^\d{4}-\d{2}-\d{2}$', date):
        return None
    y, m, d = date.split('-')
    return int(y), int(m), int(d)


def month_day_label(date, lang):
    parts = parse_date_parts(date)
    if not parts:
        return date or ''
    y, m, d = parts
    if lang == 'en':
        return f'{MONTH_NAMES["en"][m - 1]} {d}'
    return f'{m}월 {d}일'


def full_date_label(date, lang):
    """Recipe hero's 'No. 0000 / SUN, SEP 25, 2022' style right-hand date.
    A handful of very old records carry a malformed but regex-shaped date
    (day 00, Feb 29 on a non-leap year, Apr 31...) - real calendar math
    on those raises, so fall back to the date without a weekday instead
    of crashing the whole build over a handful of legacy typos."""
    parts = parse_date_parts(date)
    if not parts:
        return date or ''
    y, m, d = parts
    if lang == 'en':
        import datetime
        try:
            wd = WEEKDAY_NAMES_EN[datetime.date(y, m, d).weekday()]
            return f'{wd.upper()}, {MONTH_NAMES["en"][m - 1].upper()} {d}, {y}'
        except ValueError:
            return f'{MONTH_NAMES["en"][m - 1].upper()} {d}, {y}'
    return f'{y}년 {m}월 {d}일'


def parse_ingredient_lines(text):
    """Mirrors cookmode.js's parseIngredientLines() so the build-time
    checklist and the client-side cook-mode overlay split the same free
    text the same way."""
    if not text:
        return []
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if any(re.match(r'^[-•]', l) for l in lines):
        return [re.sub(r'^[-•]\s*', '', l) for l in lines]
    return [s.strip() for s in text.split(',') if s.strip()]


def parse_step_lines(text):
    """Mirrors cookmode.js's parseStepLines()."""
    if not text:
        return []
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    return [re.sub(r'^\d+\.\s*', '', l) for l in lines]


def find_other_years(live, include, idx, limit=4):
    """Other (non-failed, same-language-available) records sharing this
    record's month-day across different years, most recent first - the
    build-time equivalent of home.js's on-this-day matching, scoped to
    just this one date instead of "today"."""
    date = live[idx].get('date')
    parts = parse_date_parts(date)
    if not parts:
        return []
    mmdd = date[5:]
    cur_year = date[:4]
    # Exclude the current record's own YEAR (not just its own index) so a
    # day with two posts (see day_secondary) doesn't show its sibling
    # post as if it were a different year's entry.
    matches = [j for j in include if live[j].get('date', '')[5:] == mmdd
               and live[j].get('date', '')[:4] != cur_year
               and re.match(r'^\d{4}-\d{2}-\d{2}$', live[j].get('date', ''))]
    matches.sort(key=lambda j: live[j]['date'], reverse=True)
    return matches[:limit]


def share_btn_html(lang='ko'):
    return (
        f'<button type="button" class="recipe-share-btn" id="shareBtn" aria-label="{LABELS[lang]["share_label"]}">'
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
        '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
        f'<span id="shareLabel">{LABELS[lang]["share_label"]}</span></button>'
    )


def ad_eligible(r):
    text = (r.get('intro') or '') + (r.get('ingredients') or '') + (r.get('steps') or '')
    return len(text.strip()) >= MIN_AD_CONTENT_CHARS


# AdSense flagged the site for "low value content": ~10% of pages have
# neither a photo/video nor much text - a picture-and-one-line diary note.
# That's legitimate as a page for a direct visitor, but not something we
# want Google crawling and weighing as part of the site's overall content
# quality. noindex (not delete) keeps the page reachable while asking
# Google to leave it out of its index and out of the site-quality review.
MIN_INDEXABLE_CONTENT_CHARS = 100


def is_thin_content(r):
    has_media = bool(r.get('image') or r.get('gallery') or r.get('video'))
    text = (r.get('intro') or '') + (r.get('ingredients') or '') + (r.get('steps') or '')
    return not has_media or len(text.strip()) < MIN_INDEXABLE_CONTENT_CHARS


AD_VERIFY_SCRIPT = (
    f'<!-- Google AdSense (site verification) -->\n'
    f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={AD_CLIENT}" crossorigin="anonymous"></script>'
) if AD_CLIENT else ''


def ad_slot_html(position):
    if not (AD_CLIENT and AD_SLOT_RECIPE_BOTTOM):
        return f'<!-- AdSense: 광고 단위(ad-slot) 발급 후 이 자리에 실제 광고 코드가 채워집니다 ({position}) -->'
    return (
        f'<div class="ad-slot ad-slot-{position}">'
        f'<ins class="adsbygoogle" style="display:block" data-ad-client="{AD_CLIENT}" '
        f'data-ad-slot="{AD_SLOT_RECIPE_BOTTOM}" data-ad-format="auto" data-full-width-responsive="true"></ins>'
        f'<script>(adsbygoogle = window.adsbygoogle || []).push({{}});</script>'
        f'</div>'
    )


def media_html(r, title, lang='ko'):
    imgs = r.get('gallery') or ([r['image']] if r.get('image') else [])
    if not imgs and not r.get('video'):
        return ''
    video_class = 'recipe-video' if imgs else 'recipe-video recipe-video-solo'
    video_html = f'<video class="{video_class}" src="{esc(r["video"])}" controls playsinline></video>' if r.get('video') else ''
    ig_link_html = (
        f'<a class="recipe-ig-link" href="{esc(r["permalink"])}" target="_blank" rel="noopener">{LABELS[lang]["ig_link"]}</a>'
        if r.get('video') and r.get('permalink') else ''
    )
    thumbs = ''
    if len(imgs) > 1:
        thumbs = '<div class="recipe-thumbs">' + ''.join(
            f'<img src="{esc(u)}" alt="{esc(title)} {i+1}" loading="lazy">'
            for i, u in enumerate(imgs[1:], start=1)
        ) + '</div>'
    photo_html = f'<div class="recipe-photo"><img src="{esc(imgs[0])}" alt="{esc(title)}"></div>' if imgs else ''
    return photo_html + video_html + ig_link_html + thumbs


def json_ld(r, url, title, intro=None, ingredients=None, steps=None, lang='ko'):
    intro = r.get('intro') if intro is None else intro
    ingredients = r.get('ingredients') if ingredients is None else ingredients
    steps = r.get('steps') if steps is None else steps
    if not (ingredients and steps):
        return ''
    ingredient_list = [s.strip() for s in re.split(r',\s*', ingredients) if s.strip()]
    step_list = [re.sub(r'^\d+\.\s*', '', s.strip()) for s in steps.split('\n') if s.strip()]
    imgs = r.get('gallery') or ([r['image']] if r.get('image') else [])
    data = {
        '@context': 'https://schema.org/',
        '@type': 'Recipe',
        'name': title,
        'url': url,
    }
    if imgs:
        data['image'] = imgs
    data['author'] = {
        '@type': 'Person', 'name': '나조식',
        'sameAs': [
            'https://www.instagram.com/how.about.breakfast/',
            'https://www.youtube.com/@How.about.breakfast',
        ],
    }
    data['recipeYield'] = '1인분' if lang == 'ko' else '1 serving'
    if r.get('date'):
        data['datePublished'] = r['date']
    if intro:
        data['description'] = clean_description(intro, title)[:300]
    data['recipeIngredient'] = ingredient_list
    data['recipeInstructions'] = [{'@type': 'HowToStep', 'text': s} for s in step_list]
    if r.get('hashtags'):
        data['keywords'] = ', '.join(r['hashtags'])
    if r.get('calories'):
        data['nutrition'] = {'@type': 'NutritionInformation', 'calories': f'{r["calories"]} kcal'}
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False) + '</script>'


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="{html_lang}">
<head>
<script>if(location.hostname==='najosik.github.io'){{location.replace('https://how-about-breakfast.com'+location.pathname.replace(/^\/how-about-breakfast-recipes/,'')+location.search+location.hash);}}</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — {title_suffix}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{url}">
{hreflang_tags}
{robots_meta}
<link rel="icon" type="image/svg+xml" href="{rel}/favicon.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{site_name}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{url}">
{og_image}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{description}">
{twitter_image}
{ad_verify_script}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Serif+KR:wght@700;900&family=Noto+Sans+KR:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{rel}/styles.css?v={asset_version}">
<style>
  .recipe-page{{max-width:1080px; margin:0 auto; padding:0 20px 20px;}}
  .recipe-breadcrumb{{max-width:1080px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; font-size:13.5px; color:var(--text-2); border-bottom:1px solid var(--rule);}}
  .recipe-breadcrumb-path{{display:flex; gap:8px; align-items:center;}}
  .recipe-breadcrumb-path a{{color:var(--text-2); text-decoration:none;}}
  .recipe-breadcrumb-path a:hover{{color:var(--green-dark); text-decoration:underline;}}
  .recipe-breadcrumb-path .current{{color:var(--ink);}}
  .recipe-breadcrumb-actions{{display:flex; gap:8px; flex-wrap:wrap;}}
  .recipe-hero-grid{{padding:32px 0; display:grid; grid-template-columns:7fr 5fr; gap:40px;}}
  .recipe-hero-media{{position:relative;}}
  .recipe-photo{{width:100%; aspect-ratio:3/4; border-radius:2px; overflow:hidden; margin-bottom:0; background:var(--line);}}
  .recipe-photo img{{width:100%; height:100%; object-fit:cover; display:block;}}
  .recipe-video{{width:100%; display:block; border-radius:2px; margin-top:10px;}}
  .recipe-video-solo{{margin-top:0; aspect-ratio:3/4; object-fit:cover; background:var(--line);}}
  .recipe-ig-link{{display:inline-block; font-size:12.5px; color:var(--green-dark); text-decoration:none; margin-top:8px;}}
  .recipe-ig-link:hover{{text-decoration:underline;}}
  .recipe-thumbs{{display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;}}
  .recipe-thumbs img{{width:64px; height:64px; object-fit:cover; border-radius:2px;}}
  .recipe-hero-info{{display:flex; flex-direction:column; gap:18px; border-top:3px solid var(--ink); padding-top:18px;}}
  .recipe-hero-topline{{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; font-family:'Fraunces',serif; font-size:14px; color:var(--text-2);}}
  .recipe-hero-topline .stamp{{margin-bottom:0;}}
  .recipe-page h1{{font-family:'Noto Serif KR',serif; font-weight:900; font-size:36px; line-height:1.2; letter-spacing:-0.01em; margin:0; color:var(--ink);}}
  .recipe-kcal-block{{display:flex; flex-direction:column; gap:2px; border-top:1px solid var(--ink); border-bottom:1px solid var(--ink); padding:14px 0;}}
  .recipe-kcal-block .label{{font-size:12.5px; color:var(--text-2);}}
  .recipe-kcal-block .value{{font-family:'Fraunces',serif; font-size:34px; font-weight:800; color:var(--green); line-height:1;}}
  .recipe-kcal-block .value small{{font-size:15px; font-weight:400; color:var(--text-2);}}
  .recipe-tags{{display:flex; gap:8px; flex-wrap:wrap;}}
  .recipe-tags span{{height:32px; padding:0 12px; display:inline-flex; align-items:center; border:1px solid var(--line-strong); font-size:12.5px; color:var(--ink);}}
  .cook-start-btn{{align-self:flex-start; height:44px; padding:0 22px; border:0; background:var(--green); color:#fff; font:inherit; font-size:14px; font-weight:700; cursor:pointer;}}
  .cook-start-btn:hover{{background:var(--green-dark);}}
  .recipe-page section{{margin-bottom:22px;}}
  .recipe-page section h2{{font-family:'Noto Serif KR',serif; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--green); margin:0 0 8px; font-weight:600;}}
  .recipe-body{{white-space:pre-line; font-size:14.5px; color:var(--ink); line-height:1.75;}}
  .recipe-cook-grid{{padding:44px 0; border-top:1px solid var(--ink); display:grid; grid-template-columns:4fr 8fr; gap:44px;}}
  .recipe-cook-col h2{{margin:0; font-family:'Noto Serif KR',serif; font-size:22px; font-weight:900; border-bottom:3px solid var(--ink); padding-bottom:10px; display:flex; justify-content:space-between; align-items:baseline;}}
  .recipe-cook-col h2 span{{font-size:13px; font-family:'Noto Sans KR',sans-serif; font-weight:400; color:var(--text-2);}}
  .recipe-ing-list{{margin:0; padding:0; list-style:none; display:flex; flex-direction:column;}}
  .recipe-ing-list li{{min-height:44px; display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--rule); font-size:15.5px;}}
  .recipe-ing-list label{{flex:1 1 auto; display:flex; align-items:center; gap:12px; cursor:pointer;}}
  .recipe-ing-list input{{width:19px; height:19px; accent-color:var(--green); flex:0 0 auto;}}
  .recipe-ing-list label.checked-off .recipe-ing-name{{text-decoration:line-through; color:var(--text-3);}}
  .recipe-checklist-note{{font-size:12.5px; color:var(--text-2); margin-top:8px;}}
  .recipe-step-list{{margin:0; padding:0; list-style:none; display:flex; flex-direction:column;}}
  .recipe-step-list li{{padding:18px 0; display:flex; gap:20px; border-bottom:1px solid var(--rule);}}
  .recipe-step-num{{width:44px; flex:0 0 auto; font-family:'Fraunces',serif; font-size:32px; font-weight:800; line-height:0.9; color:var(--green);}}
  .recipe-step-text{{margin:0; font-family:'Noto Serif KR',serif; font-size:16.5px; line-height:1.75; color:var(--ink);}}
  .recipe-other-years{{padding:44px 20px; margin:0 -20px 22px; background:var(--mint);}}
  .recipe-other-years-head{{display:flex; align-items:baseline; justify-content:space-between; border-bottom:1px solid var(--ink); padding-bottom:12px; margin-bottom:20px;}}
  .recipe-other-years-head h2{{margin:0; font-family:'Noto Serif KR',serif; font-size:20px; font-weight:900; text-transform:none; letter-spacing:0; color:var(--ink);}}
  .recipe-other-years-head a{{font-size:13px; color:var(--green-dark); text-decoration:none;}}
  .recipe-other-years-head a:hover{{text-decoration:underline;}}
  .recipe-same-day{{margin:0 0 22px; padding:14px 18px; background:var(--mint); font-size:13.5px; color:var(--text-2);}}
  .recipe-same-day a{{color:var(--green-dark); font-weight:700; text-decoration:none;}}
  .recipe-same-day a:hover{{text-decoration:underline;}}
  .recipe-same-day a + a{{margin-left:10px;}}
  .recipe-other-years-grid{{display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:20px;}}
  .recipe-other-years-grid a{{display:flex; flex-direction:column; gap:8px; text-decoration:none; color:var(--ink);}}
  .recipe-other-years-grid img,.recipe-other-years-grid .card-thumb{{width:100%; aspect-ratio:1; object-fit:cover; margin-bottom:0;}}
  .recipe-other-years-grid .oy-year{{font-family:'Fraunces',serif; font-size:16px; font-weight:800; color:var(--green);}}
  .recipe-other-years-grid .oy-title{{font-family:'Noto Serif KR',serif; font-size:14.5px; font-weight:700; line-height:1.4;}}
  .recipe-daynav{{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); border-top:1px solid var(--ink); border-bottom:1px solid var(--ink); margin-bottom:22px;}}
  .recipe-daynav a{{min-height:88px; padding:18px 0; display:flex; flex-direction:column; justify-content:center; gap:4px; text-decoration:none; color:var(--ink);}}
  .recipe-daynav-prev{{border-right:1px solid var(--ink);}}
  .recipe-daynav-next{{align-items:flex-end; text-align:right;}}
  .recipe-daynav .meta{{font-size:12.5px; color:var(--text-2);}}
  .recipe-daynav .title{{font-family:'Noto Serif KR',serif; font-size:18px; font-weight:700;}}
  .recipe-daynav a:hover .title{{color:var(--green-dark);}}
  .recipe-share-btn{{display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; white-space:nowrap; border:1px solid var(--line-strong); background:var(--paper); border-radius:20px; padding:5px 12px; font-size:12.5px; color:var(--ink-soft); cursor:pointer; font-family:inherit;}}
  .recipe-share-btn:hover{{border-color:var(--green); color:var(--green-dark);}}
  .recipe-share-btn.copied{{border-color:var(--green); color:var(--green-dark); background:var(--mint);}}
  .ad-slot{{margin:22px 0 0;}}
  .lang-switch{{font-size:12px; font-weight:600; border:1px solid var(--line-strong); border-radius:20px; padding:3px 10px; text-decoration:none; color:var(--ink);}}
  .recipe-mobile-bar{{display:none;}}
  @media (max-width:760px){{
    .recipe-hero-grid{{grid-template-columns:1fr; padding:20px 0;}}
    .recipe-page h1{{font-size:26px;}}
    .recipe-cook-grid{{grid-template-columns:1fr; gap:8px; padding:28px 0;}}
    .recipe-other-years-grid{{grid-template-columns:repeat(2,minmax(0,1fr));}}
    .recipe-page{{padding-bottom:96px;}}
    .recipe-mobile-bar{{
      display:flex; align-items:center; gap:10px; position:fixed; left:0; right:0; bottom:0; z-index:20;
      height:76px; padding:0 20px calc(0px + env(safe-area-inset-bottom,0px)); box-sizing:border-box;
      background:var(--paper); border-top:1px solid var(--ink);
    }}
    .recipe-mobile-jump{{flex:1 1 auto; height:50px; background:var(--green); color:#fff; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:700; text-decoration:none;}}
    .recipe-mobile-ig{{height:50px; padding:0 16px; border:1px solid var(--ink); display:flex; align-items:center; font-size:14px; color:var(--ink); text-decoration:none; white-space:nowrap;}}
  }}
</style>
</head>
<body>
<div class="wrap">
  <header class="site-header">
    <nav class="site-header-nav" aria-label="주요 메뉴">
      <a href="{rel}/index.html">{nav_home_label}</a>
    </nav>
    <div class="nav-right">
      <button type="button" class="channel-toggle" id="channelToggle" aria-expanded="false" aria-controls="channelLinks" aria-label="채널 링크 메뉴">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <div class="channel-links" id="channelLinks">
        <a href="https://www.instagram.com/how.about.breakfast/" target="_blank" rel="noopener">Instagram</a>
        <a href="https://www.youtube.com/@How.about.breakfast" target="_blank" rel="noopener">YouTube</a>
        <a href="https://brunch.co.kr/brunchbook/dailybreakfast" target="_blank" rel="noopener">Brunch</a>
      </div>
      {lang_switch_html}
    </div>
  </header>
</div>

<nav aria-label="위치" class="recipe-breadcrumb">
  <div class="recipe-breadcrumb-path">
    <a href="{rel}/archive.html">{archive_back_label}</a><span>/</span><span>{year_label}</span><span>/</span><span class="current">{month_day_label}</span>
  </div>
  <div class="recipe-breadcrumb-actions">
    {share_btn}
    {ig_link_top}
  </div>
</nav>

<div class="wrap">
  <div class="recipe-page">
    <div class="recipe-hero-grid">
      <div class="recipe-hero-media">{media}</div>
      <div class="recipe-hero-info">
        <div class="recipe-hero-topline">
          <span class="stamp">{stamp}</span>
          {fail_badge}
          {medal_badge}
          <span>{full_date_label}</span>
        </div>
        <h1>{title}</h1>
        {kcal_block}
        {tags_section}
        {cook_section}
      </div>
    </div>

    {intro_section}

    {cook_grid_section}

    {same_day_section}
    {other_years_section}

    <nav aria-label="이전·다음 기록" class="recipe-daynav">
      <a href="{prev_href}" class="recipe-daynav-prev">{prev_block}</a>
      <a href="{next_href}" class="recipe-daynav-next">{next_block}</a>
    </nav>

    {credit_section}
    {ad_slot}
  </div>
</div>

<footer class="page-footer">
  <span>© how.about.breakfast 2020-2026. All rights reserved.</span>
  <div class="page-footer-links"><a href="{privacy_href}">{footer_privacy_label}</a></div>
</footer>

{mobile_bar_html}

{json_ld}
<script src="{rel}/shared.js?v={asset_version}"></script>
<script src="{rel}/cookmode.js?v={asset_version}"></script>
<script src="{rel}/recipe.js?v={asset_version}"></script>
<script>
(function () {{
  var btn = document.getElementById('shareBtn');
  var label = document.getElementById('shareLabel');
  var original = label.textContent;
  function fallbackCopy(text) {{
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try {{ document.execCommand('copy'); }} catch (e) {{}}
    document.body.removeChild(ta);
  }}
  btn.addEventListener('click', function () {{
    var url = location.href;
    var done = function () {{
      label.textContent = '{share_copied_label}';
      btn.classList.add('copied');
      setTimeout(function () {{ label.textContent = original; btn.classList.remove('copied'); }}, 1600);
    }};
    if (navigator.clipboard && navigator.clipboard.writeText) {{
      navigator.clipboard.writeText(url).then(done).catch(function () {{ fallbackCopy(url); done(); }});
    }} else {{
      fallbackCopy(url); done();
    }}
  }});
}})();
</script>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-64KS503K5Y"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-64KS503K5Y');
</script>
<!-- Microsoft Clarity -->
<script type="text/javascript">
    (function(c,l,a,r,i,t,y){{
        c[a]=c[a]||function(){{(c[a].q=c[a].q||[]).push(arguments)}};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    }})(window, document, "clarity", "script", "y3orfq5syr");
</script>
</body>
</html>
"""


def build_pages(live, ids, lang='ko', medal_winners=None):
    medal_winners = medal_winners or {}
    labels = LABELS[lang]
    pages_dir = PAGES_DIR if lang == 'ko' else PAGES_DIR_EN
    url_prefix = 'recipes' if lang == 'ko' else 'en/recipes'
    rel = '..' if lang == 'ko' else '../..'
    privacy_href = f'{rel}/privacy.html' if lang == 'ko' else f'{rel}/en/privacy.html'
    os.makedirs(pages_dir, exist_ok=True)
    ordered = sorted(range(len(live)), key=lambda i: (sort_key(live[i]), i))

    # Only records with a completed _en translation get an English page;
    # the Korean page is generated for every live record regardless.
    # A 건너뜀 skip marker (failed:true, no title/intro/etc - added by the
    # admin tool's "빠진 날짜" skip action) has nothing to show, so it gets
    # no page at all rather than a blank one that still carries live
    # AdSense script - those blank pages were flagged by AdSense's policy
    # review as "low value content" even though noindex kept them out of
    # Google's own index (noindex doesn't stop AdSense's own crawler, and
    # the adjacent real pages' prev/next links still made them reachable).
    include = [i for i in ordered if not live[i].get('failed') and (lang == 'ko' or live[i].get('_en'))]

    urls = []
    for pos, idx in enumerate(include):
        r = live[idx]
        pid = ids[idx]
        en = r.get('_en') or {}
        url = f'{SITE_BASE}/{url_prefix}/{pid}.html'
        ko_url = f'{SITE_BASE}/recipes/{pid}.html'
        en_url = f'{SITE_BASE}/en/recipes/{pid}.html'
        thin = is_thin_content(r)
        if not thin:
            urls.append(url)

        if lang == 'ko':
            title = display_title(r)
            intro, ingredients, steps = r.get('intro'), r.get('ingredients'), r.get('steps')
            weather = r.get('weather')
        else:
            title = en.get('title') or display_title(r)
            intro, ingredients, steps = en.get('intro'), en.get('ingredients'), en.get('steps')
            weather = weather_en(r.get('weather'))

        description = clean_description(intro, title, fallback_suffix=labels['recipe_word'])
        imgs = r.get('gallery') or ([r['image']] if r.get('image') else [])
        og_image = f'<meta property="og:image" content="{esc(imgs[0])}">' if imgs else ''
        twitter_image = f'<meta name="twitter:image" content="{esc(imgs[0])}">' if imgs else ''

        year_label = (r.get('date') or '')[:4]
        month_day = month_day_label(r.get('date'), lang)
        full_date = full_date_label(r.get('date'), lang)

        intro_section = (
            f'<section><h2>{labels["notes"]}</h2><div class="recipe-body">{esc(intro)}</div></section>'
            if intro else ''
        )

        kcal_block = (
            f'<div class="recipe-kcal-block"><span class="label">{labels["kcal_label"]}</span>'
            f'<span class="value">{r["calories"]}<small> kcal</small></span></div>'
            if r.get('calories') else ''
        )

        ing_lines = parse_ingredient_lines(ingredients)
        if ing_lines:
            ing_items = ''.join(
                f'<li><label><input type="checkbox" class="recipe-ing-check" data-idx="{i}">'
                f'<span class="recipe-ing-name">{esc(name)}</span></label></li>'
                for i, name in enumerate(ing_lines)
            )
            ingredients_section = (
                f'<div class="recipe-cook-col"><h2>{labels["ingredients"]}</h2>'
                f'<ul class="recipe-ing-list" id="ingList" data-recipe-id="{esc(pid)}">{ing_items}</ul>'
                f'<p class="recipe-checklist-note">{labels["checklist_note"]}</p></div>'
            )
        else:
            ingredients_section = ''

        step_lines = parse_step_lines(steps)
        if step_lines:
            step_items = ''.join(
                f'<li><span class="recipe-step-num">{i + 1:02d}</span><p class="recipe-step-text">{esc(text)}</p></li>'
                for i, text in enumerate(step_lines)
            )
            steps_section = f'<div class="recipe-cook-col"><h2>{labels["steps"]}</h2><ol class="recipe-step-list">{step_items}</ol></div>'
        else:
            steps_section = ''

        cook_grid_section = (
            f'<section class="recipe-cook-grid" id="cookGrid">{ingredients_section}{steps_section}</section>'
            if ingredients_section or steps_section else ''
        )
        mobile_jump_html = (
            f'<a href="#cookGrid" class="recipe-mobile-jump">{labels["mobile_jump"]}</a>'
            if ingredients_section or steps_section else ''
        )

        cook_section = (
            f'<button type="button" class="cook-start-btn" id="cookStartBtn">{labels["cook_start"]}</button>'
            f'<script type="application/json" id="cookData">'
            f'{json_script_safe({"title": title, "ingredients": ingredients, "steps": steps})}'
            f'</script>'
            if ingredients and steps else ''
        )
        credit_section = (
            f'<section><h2>{labels["credit"]}</h2><div class="recipe-body">Inspired by {esc(r["credit"])}</div></section>'
            if r.get('credit') else ''
        )
        tags_section = ''
        if r.get('hashtags'):
            tags_section = f'<div class="recipe-tags">' + ''.join(
                f'<span>#{esc(h)}</span>' for h in r['hashtags']
            ) + '</div>'

        ig_link_top = (
            f'<a href="{esc(r["permalink"])}" target="_blank" rel="noopener" class="recipe-share-btn">{labels["ig_link"]}</a>'
            if r.get('permalink') else ''
        )
        mobile_ig_link = (
            f'<a href="{esc(r["permalink"])}" target="_blank" rel="noopener" class="recipe-mobile-ig">{labels["ig_link_short"]}</a>'
            if r.get('permalink') else ''
        )
        mobile_bar_html = (
            f'<div class="recipe-mobile-bar">{mobile_jump_html}{mobile_ig_link}</div>'
            if mobile_jump_html or mobile_ig_link else ''
        )

        # A day can have more than one post (see day_secondary) - prev/next
        # and the "other years" grid both skip these siblings now, so
        # surface them here instead or they'd be unreachable from this page.
        same_date_idxs = [j for j in include if j != idx and live[j].get('date') == r.get('date')]
        if same_date_idxs:
            sd_links = []
            for j in same_date_idxs:
                other_r = live[j]
                other_en = other_r.get('_en') or {}
                other_title = (other_en.get('title') or display_title(other_r)) if lang == 'en' else display_title(other_r)
                sd_links.append(f'<a href="{esc(ids[j])}.html">{esc(other_title)} →</a>')
            same_day_section = (
                f'<div class="recipe-same-day">{labels["same_day_note"]} ' + ' '.join(sd_links) + '</div>'
            )
        else:
            same_day_section = ''

        other_year_idxs = find_other_years(live, include, idx)
        if other_year_idxs:
            oy_cards = []
            for j in other_year_idxs:
                other_r = live[j]
                other_en = other_r.get('_en') or {}
                other_title = (other_en.get('title') or display_title(other_r)) if lang == 'en' else display_title(other_r)
                other_imgs = other_r.get('gallery') or ([other_r['image']] if other_r.get('image') else [])
                thumb_html = f'<img src="{esc(other_imgs[0])}" alt="" loading="lazy">' if other_imgs else '<div class="card-thumb"></div>'
                oy_cards.append(
                    f'<a href="{esc(ids[j])}.html">{thumb_html}'
                    f'<span class="oy-year">{esc(other_r.get("date", "")[:4])}</span>'
                    f'<span class="oy-title">{esc(other_title)}</span></a>'
                )
            mm_dd = r['date'][5:7] + '-' + r['date'][8:10]
            other_years_section = (
                f'<section class="recipe-other-years"><div class="recipe-other-years-head">'
                f'<h2>{labels["other_years_title"].format(date=month_day)}</h2>'
                f'<a href="{rel}/archive.html?date={mm_dd}">{labels["other_years_more"]}</a>'
                f'</div><div class="recipe-other-years-grid">{"".join(oy_cards)}</div></section>'
            )
        else:
            other_years_section = ''

        # Skip past any sibling post(s) sharing this record's own date (see
        # day_secondary) so "전날/다음날" always lands on a genuinely
        # different calendar day instead of mislabeling a same-day sibling.
        cur_date = r.get('date')
        prev_pos = pos - 1
        while prev_pos >= 0 and live[include[prev_pos]].get('date') == cur_date:
            prev_pos -= 1
        next_pos = pos + 1
        while next_pos < len(include) and live[include[next_pos]].get('date') == cur_date:
            next_pos += 1

        if prev_pos >= 0:
            prev_idx = include[prev_pos]
            prev_r = live[prev_idx]
            prev_href = f'{ids[prev_idx]}.html'
            prev_title = (prev_r.get('_en') or {}).get('title') if lang == 'en' else None
            prev_title = prev_title or display_title(prev_r)
            prev_block = (
                f'<span class="meta">{labels["prev_prefix"]} · {esc(prev_r.get("date") or labels["prev_fallback"])}</span>'
                f'<span class="title">{esc(prev_title)}</span>'
            )
        else:
            prev_href, prev_block = '#', ''
        if next_pos < len(include):
            next_idx = include[next_pos]
            next_r = live[next_idx]
            next_href = f'{ids[next_idx]}.html'
            next_title = (next_r.get('_en') or {}).get('title') if lang == 'en' else None
            next_title = next_title or display_title(next_r)
            next_block = (
                f'<span class="meta">{esc(next_r.get("date") or labels["next_fallback"])} · {labels["next_suffix"]}</span>'
                f'<span class="title">{esc(next_title)}</span>'
            )
        else:
            next_href, next_block = '#', ''

        hreflang_tags = f'<link rel="alternate" hreflang="ko" href="{ko_url}">'
        if en:
            hreflang_tags += f'\n<link rel="alternate" hreflang="en" href="{en_url}">'
        hreflang_tags += f'\n<link rel="alternate" hreflang="x-default" href="{ko_url}">'

        switch_url = en_url if lang == 'ko' else ko_url
        lang_switch_html = (
            f'<a href="{switch_url}" class="lang-switch">{labels["switch_label"]}</a>' if en else ''
        )

        robots_meta = '<meta name="robots" content="noindex,follow">' if thin else ''

        medal_badge = (
            f'<span class="medal-badge" title="{esc(medal_winners[pid])}">🥇 {labels["medal_label"]}</span>'
            if pid in medal_winners else ''
        )

        html_out = PAGE_TEMPLATE.format(
            html_lang=lang, title_suffix=labels['title_suffix'], site_name=labels['site_name'],
            title=esc(title), description=esc(description), url=url, rel=rel, asset_version=ASSET_VERSION,
            hreflang_tags=hreflang_tags, robots_meta=robots_meta, lang_switch_html=lang_switch_html,
            archive_back_label=labels['archive_back'],
            nav_home_label=labels['nav_home'],
            year_label=esc(year_label), month_day_label=esc(month_day), full_date_label=esc(full_date),
            privacy_href=privacy_href, footer_privacy_label=labels['footer_privacy'],
            og_image=og_image, twitter_image=twitter_image, ad_verify_script=AD_VERIFY_SCRIPT,
            media=media_html(r, title, lang), stamp=esc(stamp_label(r)),
            fail_badge=f'<span class="fail-badge">{labels["failed_badge"]}</span>' if r.get('failed') else '',
            medal_badge=medal_badge,
            share_btn=share_btn_html(lang), share_copied_label=labels['share_copied'],
            ig_link_top=ig_link_top, mobile_bar_html=mobile_bar_html,
            kcal_block=kcal_block,
            intro_section=intro_section, cook_grid_section=cook_grid_section, cook_section=cook_section,
            same_day_section=same_day_section,
            other_years_section=other_years_section,
            credit_section=credit_section, tags_section=tags_section,
            prev_href=prev_href, prev_block=prev_block, next_href=next_href, next_block=next_block,
            json_ld=json_ld(r, url, title, intro=intro, ingredients=ingredients, steps=steps, lang=lang),
            ad_slot=ad_slot_html('recipe-bottom') if ad_eligible(r) else '',
        )
        with open(os.path.join(pages_dir, f'{pid}.html'), 'w', encoding='utf-8') as f:
            f.write(html_out)

    return urls


def build_sitemap(recipe_urls, recipe_urls_en):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines.append(f'  <url><loc>{SITE_BASE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>')
    lines.append(f'  <url><loc>{SITE_BASE}/archive.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>')
    lines.append(f'  <url><loc>{SITE_BASE}/vote.html</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>')
    lines.append(f'  <url><loc>{SITE_BASE}/privacy.html</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>')
    lines.append(f'  <url><loc>{SITE_BASE}/en/privacy.html</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>')
    for u in recipe_urls:
        lines.append(f'  <url><loc>{u}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>')
    for u in recipe_urls_en:
        lines.append(f'  <url><loc>{u}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>')
    lines.append('</urlset>')
    with open(SITEMAP_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    with open(RECIPES_PATH, encoding='utf-8') as f:
        records = json.load(f)

    live = [r for r in records if not r.get('deleted')]
    ids = assign_unique_page_ids(live)

    newly_assigned = 0
    for r, pid in zip(live, ids):
        if r.get('page_id') != pid:
            r['page_id'] = pid
            newly_assigned += 1
    if newly_assigned:
        with open(RECIPES_PATH, 'w', encoding='utf-8') as f:
            json.dump(records, f, ensure_ascii=False, indent=1)
        print(f'recipes.json: froze {newly_assigned} new page_id(s)')

    medal_winners = load_medal_winners()

    slim = build_index(live, ids, medal_winners)
    print(f'recipes-index.json: {len(slim)} records')

    en_map = build_index_en(live, ids)
    print(f'recipes-index-en.json: {len(en_map)} records')

    urls = build_pages(live, ids, lang='ko', medal_winners=medal_winners)
    print(f'recipe pages generated (ko): {len(urls)}')

    urls_en = build_pages(live, ids, lang='en', medal_winners=medal_winners)
    print(f'recipe pages generated (en): {len(urls_en)}')

    build_sitemap(urls, urls_en)
    print(f'sitemap.xml: {len(urls) + len(urls_en) + 3} URLs')


if __name__ == '__main__':
    main()
