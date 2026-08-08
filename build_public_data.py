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
PAGES_DIR = os.path.join(HERE, 'recipes')
PAGES_DIR_EN = os.path.join(HERE, 'en', 'recipes')
SITEMAP_PATH = os.path.join(HERE, 'sitemap.xml')

SITE_BASE = 'https://how-about-breakfast.com'

# Static per-language labels for the recipe page chrome (headers, nav,
# share button). Free-text recipe content itself comes from r['_en'].
LABELS = {
    'ko': {
        'site_name': '날마다, 조식',
        'title_suffix': '날마다 조식',
        'archive_back': '← 전체 아카이브',
        'notes': '메모', 'ingredients': '재료', 'steps': '조리',
        'credit': '원본 크레딧', 'tags': '태그',
        'failed_badge': '실패기',
        'share_label': '링크 복사', 'share_copied': '복사됨!',
        'ig_link': '인스타그램에서 크게 보기 →',
        'switch_label': 'EN',
        'recipe_word': '레시피',
        'prev_fallback': '이전', 'next_fallback': '다음',
    },
    'en': {
        'site_name': 'Breakfast, Every Day',
        'title_suffix': 'Breakfast, Every Day',
        'archive_back': '← Full Archive',
        'notes': 'Notes', 'ingredients': 'Ingredients', 'steps': 'Steps',
        'credit': 'Original Credit', 'tags': 'Tags',
        'failed_badge': 'Failed attempt',
        'share_label': 'Copy link', 'share_copied': 'Copied!',
        'ig_link': 'View larger on Instagram →',
        'switch_label': 'KO',
        'recipe_word': 'recipe',
        'prev_fallback': 'Previous', 'next_fallback': 'Next',
    },
}

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
    'image', 'gallery', 'video', 'permalink',
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
    fell back to the raw '20250926 #조식다이어리 1519, 20도/흐림' diary header -
    unusable as a page <title>/<h1>. Derive something readable instead."""
    title = r.get('title') or ''
    if not RAW_HEADER_RE.match(title):
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


def build_index(live, ids):
    slim = []
    for r, pid in zip(live, ids):
        rec = {k: r[k] for k in INDEX_FIELDS if k in r}
        rec['page_id'] = pid
        slim.append(rec)
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(slim, f, ensure_ascii=False, separators=(',', ':'))
    return slim


def stamp_label(r):
    if r.get('diary_no') is not None:
        return '#' + str(r['diary_no'])
    return r.get('pre_label') or '#?'


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
    if not imgs:
        return ''
    video_html = f'<video src="{esc(r["video"])}" controls playsinline></video>' if r.get('video') else ''
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
    return (
        f'<div class="recipe-photo"><img src="{esc(imgs[0])}" alt="{esc(title)}"></div>'
        + video_html + ig_link_html + thumbs
    )


def json_ld(r, url, title, intro=None, ingredients=None, steps=None):
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
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — {title_suffix}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{url}">
{hreflang_tags}
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
<link href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Sans+KR:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{rel}/styles.css">
<style>
  .recipe-page{{max-width:640px; margin:0 auto; padding:40px 0 20px;}}
  .recipe-photo{{width:100%; aspect-ratio:3/4; max-width:360px; border-radius:2px; overflow:hidden; margin-bottom:14px; background:var(--line);}}
  .recipe-photo img{{width:100%; height:100%; object-fit:cover; display:block;}}
  .recipe-photo video{{width:100%; max-width:360px; display:block; border-radius:2px; margin-bottom:10px;}}
  .recipe-ig-link{{display:inline-block; font-size:12.5px; color:var(--teal-deep); text-decoration:none; margin:-6px 0 12px;}}
  .recipe-ig-link:hover{{text-decoration:underline;}}
  .recipe-thumbs{{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;}}
  .recipe-thumbs img{{width:64px; height:64px; object-fit:cover; border-radius:2px;}}
  .recipe-page h1{{font-family:'Nanum Myeongjo',serif; font-size:26px; color:var(--teal-deep); margin:10px 0 6px;}}
  .recipe-meta{{font-size:13px; color:var(--ink-faint); margin-bottom:22px;}}
  .recipe-page section{{margin-bottom:22px;}}
  .recipe-page section h2{{font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--teal); margin:0 0 8px; font-weight:600;}}
  .recipe-body{{white-space:pre-line; font-size:14.5px; color:var(--ink); line-height:1.75;}}
  .recipe-tags{{display:flex; gap:6px; flex-wrap:wrap;}}
  .recipe-tags span{{font-size:12px; color:var(--teal-deep); background:var(--teal-pale); padding:3px 9px; border-radius:4px;}}
  .recipe-nav{{display:flex; justify-content:space-between; gap:10px; margin:32px 0 0; padding-top:18px; border-top:1px solid var(--line); font-size:13px;}}
  .recipe-nav a{{color:var(--ink-soft); text-decoration:none;}}
  .recipe-nav a:hover{{color:var(--teal-deep); text-decoration:underline;}}
  .recipe-stamp-row{{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;}}
  .recipe-stamp-row .stamp, .recipe-stamp-row .fail-badge{{margin-bottom:0;}}
  .recipe-share-btn{{display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; white-space:nowrap; border:1px solid var(--line-strong); background:var(--paper); border-radius:20px; padding:5px 12px; font-size:12.5px; color:var(--ink-soft); cursor:pointer; font-family:inherit;}}
  .recipe-share-btn:hover{{border-color:var(--teal); color:var(--teal-deep);}}
  .recipe-share-btn.copied{{border-color:var(--teal); color:var(--teal-deep); background:var(--teal-pale);}}
  .ad-slot{{margin:22px 0 0;}}
  .lang-switch{{font-size:12px; font-weight:600; border:1px solid var(--line-strong); border-radius:20px; padding:3px 10px;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="nav-bar">
    <a href="{rel}/archive.html">{archive_back_label}</a>
    {lang_switch_html}
  </div>
  <div class="recipe-page">
    {media}
    <div class="recipe-stamp-row">
      <span class="stamp">{stamp}</span>
      {fail_badge}
      {share_btn}
    </div>
    <h1>{title}</h1>
    <div class="recipe-meta">{meta_line}</div>
    {intro_section}
    {ingredients_section}
    {steps_section}
    {credit_section}
    {tags_section}
    <div class="recipe-nav">
      <a href="{prev_href}">{prev_label}</a>
      <a href="{next_href}">{next_label}</a>
    </div>
    {ad_slot}
  </div>
</div>

<footer class="site-footer">
  <div class="site-footer-inner">
    <div class="site-footer-social">
      <a href="https://www.instagram.com/how.about.breakfast/" target="_blank" rel="noopener" aria-label="Instagram">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.9" fill="currentColor" stroke="none"/></svg>
      </a>
      <a href="https://www.youtube.com/@How.about.breakfast" target="_blank" rel="noopener" aria-label="YouTube">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l6 3-6 3z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/></svg>
      </a>
    </div>
    <div class="site-footer-bottom">© how.about.breakfast 2020-2026. All rights reserved.</div>
  </div>
</footer>

{json_ld}
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
</body>
</html>
"""


def build_pages(live, ids, lang='ko'):
    labels = LABELS[lang]
    pages_dir = PAGES_DIR if lang == 'ko' else PAGES_DIR_EN
    url_prefix = 'recipes' if lang == 'ko' else 'en/recipes'
    rel = '..' if lang == 'ko' else '../..'
    os.makedirs(pages_dir, exist_ok=True)
    ordered = sorted(range(len(live)), key=lambda i: (sort_key(live[i]), i))

    # Only records with a completed _en translation get an English page;
    # the Korean page is generated for every live record regardless.
    include = [i for i in ordered if lang == 'ko' or live[i].get('_en')]

    urls = []
    for pos, idx in enumerate(include):
        r = live[idx]
        pid = ids[idx]
        en = r.get('_en') or {}
        url = f'{SITE_BASE}/{url_prefix}/{pid}.html'
        ko_url = f'{SITE_BASE}/recipes/{pid}.html'
        en_url = f'{SITE_BASE}/en/recipes/{pid}.html'
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

        meta_bits = [b for b in [r.get('date'), weather, f'{r["calories"]}kcal' if r.get('calories') else None] if b]
        meta_line = ' · '.join(esc(b) for b in meta_bits)

        intro_section = (
            f'<section><h2>{labels["notes"]}</h2><div class="recipe-body">{esc(intro)}</div></section>'
            if intro else ''
        )
        ingredients_section = (
            f'<section><h2>{labels["ingredients"]}</h2><div class="recipe-body">{esc(ingredients)}</div></section>'
            if ingredients else ''
        )
        steps_section = (
            f'<section><h2>{labels["steps"]}</h2><div class="recipe-body">{esc(steps)}</div></section>'
            if steps else ''
        )
        credit_section = (
            f'<section><h2>{labels["credit"]}</h2><div class="recipe-body">Inspired by {esc(r["credit"])}</div></section>'
            if r.get('credit') else ''
        )
        tags_section = ''
        if r.get('hashtags'):
            tags_section = f'<section><h2>{labels["tags"]}</h2><div class="recipe-tags">' + ''.join(
                f'<span>#{esc(h)}</span>' for h in r['hashtags']
            ) + '</div></section>'

        if pos > 0:
            prev_idx = include[pos - 1]
            prev_r = live[prev_idx]
            prev_href = f'{ids[prev_idx]}.html'
            prev_label = '← ' + (prev_r.get('date') or labels['prev_fallback'])
        else:
            prev_href, prev_label = '#', ''
        if pos < len(include) - 1:
            next_idx = include[pos + 1]
            next_r = live[next_idx]
            next_href = f'{ids[next_idx]}.html'
            next_label = (next_r.get('date') or labels['next_fallback']) + ' →'
        else:
            next_href, next_label = '#', ''

        hreflang_tags = f'<link rel="alternate" hreflang="ko" href="{ko_url}">'
        if en:
            hreflang_tags += f'\n<link rel="alternate" hreflang="en" href="{en_url}">'
        hreflang_tags += f'\n<link rel="alternate" hreflang="x-default" href="{ko_url}">'

        switch_url = en_url if lang == 'ko' else ko_url
        lang_switch_html = (
            f'<a href="{switch_url}" class="lang-switch">{labels["switch_label"]}</a>' if en else ''
        )

        html_out = PAGE_TEMPLATE.format(
            html_lang=lang, title_suffix=labels['title_suffix'], site_name=labels['site_name'],
            title=esc(title), description=esc(description), url=url, rel=rel,
            hreflang_tags=hreflang_tags, lang_switch_html=lang_switch_html,
            archive_back_label=labels['archive_back'],
            og_image=og_image, twitter_image=twitter_image, ad_verify_script=AD_VERIFY_SCRIPT,
            media=media_html(r, title, lang), stamp=esc(stamp_label(r)),
            fail_badge=f'<span class="fail-badge">{labels["failed_badge"]}</span>' if r.get('failed') else '',
            share_btn=share_btn_html(lang), share_copied_label=labels['share_copied'],
            meta_line=meta_line,
            intro_section=intro_section, ingredients_section=ingredients_section,
            steps_section=steps_section, credit_section=credit_section, tags_section=tags_section,
            prev_href=prev_href, prev_label=prev_label, next_href=next_href, next_label=next_label,
            json_ld=json_ld(r, url, title, intro=intro, ingredients=ingredients, steps=steps),
            ad_slot=ad_slot_html('recipe-bottom') if ad_eligible(r) else '',
        )
        with open(os.path.join(pages_dir, f'{pid}.html'), 'w', encoding='utf-8') as f:
            f.write(html_out)

    return urls


def build_sitemap(recipe_urls, recipe_urls_en):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines.append(f'  <url><loc>{SITE_BASE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>')
    lines.append(f'  <url><loc>{SITE_BASE}/archive.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>')
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

    slim = build_index(live, ids)
    print(f'recipes-index.json: {len(slim)} records')

    urls = build_pages(live, ids, lang='ko')
    print(f'recipe pages generated (ko): {len(urls)}')

    urls_en = build_pages(live, ids, lang='en')
    print(f'recipe pages generated (en): {len(urls_en)}')

    build_sitemap(urls, urls_en)
    print(f'sitemap.xml: {len(urls) + len(urls_en) + 2} URLs')


if __name__ == '__main__':
    main()
