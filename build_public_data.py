"""
build_public_data.py

Derives everything the deployed site needs from recipes.json (the full,
hand-edited source of truth used by review.html) without ever modifying
recipes.json itself:

  1. recipes-index.json — a slimmed, minified copy of recipes.json that
     home.js/app.js actually fetch. Drops fields no client-side code reads
     (`raw`, `date_raw`, `photo_candidates`, `photo_review_resolved`) and
     drops deleted:true records entirely. This is what cuts the payload
     down (raw alone is ~32% of the file and is unused at runtime).
  2. recipes/<id>.html — one static page per recipe, with real meta tags,
     Open Graph/Twitter previews using that recipe's own photo, and
     Recipe JSON-LD structured data when ingredients+steps are both
     present. Gives every recipe a crawlable, shareable URL.
  3. sitemap.xml — regenerated to include every recipe page.

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
SITEMAP_PATH = os.path.join(HERE, 'sitemap.xml')

SITE_BASE = 'https://najosik.github.io/how-about-breakfast-recipes'

INDEX_FIELDS = [
    'date', 'diary_no', 'pre_label', 'weather', 'failed', 'calories',
    'title', 'credit', 'hashtags', 'intro', 'ingredients', 'steps',
    'image', 'gallery', 'video',
]


def base_page_id(r):
    if r.get('diary_no') is not None:
        return str(r['diary_no'])
    if r.get('pre_label'):
        return r['pre_label']
    return (r.get('date') or 'unknown').replace('-', '')


def assign_unique_page_ids(records):
    """Some diary_no values repeat on purpose (a failed attempt retried later
    the same day keeps the same #조식다이어리 N). Give every record its own
    page id by suffixing -2, -3, ... on all but the first occurrence."""
    seen = {}
    ids = []
    for r in records:
        base = base_page_id(r)
        seen[base] = seen.get(base, 0) + 1
        ids.append(base if seen[base] == 1 else f'{base}-{seen[base]}')
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


def media_html(r):
    imgs = r.get('gallery') or ([r['image']] if r.get('image') else [])
    if not imgs:
        return ''
    thumbs = ''
    if len(imgs) > 1:
        thumbs = '<div class="recipe-thumbs">' + ''.join(
            f'<img src="{esc(u)}" alt="{esc(r.get("title") or "")} {i+1}" loading="lazy">'
            for i, u in enumerate(imgs[1:], start=1)
        ) + '</div>'
    video_html = f'<video src="{esc(r["video"])}" controls playsinline></video>' if r.get('video') else ''
    return (
        f'<div class="recipe-photo"><img src="{esc(imgs[0])}" alt="{esc(r.get("title") or "")}"></div>'
        + video_html + thumbs
    )


def json_ld(r, url, title):
    if not (r.get('ingredients') and r.get('steps')):
        return ''
    ingredients = [s.strip() for s in re.split(r',\s*', r['ingredients']) if s.strip()]
    steps = [re.sub(r'^\d+\.\s*', '', s.strip()) for s in r['steps'].split('\n') if s.strip()]
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
    if r.get('intro'):
        data['description'] = clean_description(r['intro'], r.get('title') or '')[:300]
    data['recipeIngredient'] = ingredients
    data['recipeInstructions'] = [{'@type': 'HowToStep', 'text': s} for s in steps]
    if r.get('hashtags'):
        data['keywords'] = ', '.join(r['hashtags'])
    if r.get('calories'):
        data['nutrition'] = {'@type': 'NutritionInformation', 'calories': f'{r["calories"]} kcal'}
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False) + '</script>'


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — 날마다 조식</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="날마다, 조식">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{url}">
{og_image}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{description}">
{twitter_image}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Sans+KR:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../styles.css">
<style>
  .recipe-page{{max-width:640px; margin:0 auto; padding:40px 0 20px;}}
  .recipe-photo{{width:100%; aspect-ratio:3/4; max-width:360px; border-radius:2px; overflow:hidden; margin-bottom:14px; background:var(--line);}}
  .recipe-photo img{{width:100%; height:100%; object-fit:cover; display:block;}}
  .recipe-photo video{{width:100%; max-width:360px; display:block; border-radius:2px; margin-bottom:10px;}}
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
  .recipe-share-btn{{display:inline-flex; align-items:center; gap:6px; float:right; border:1px solid var(--line-strong); background:var(--paper); border-radius:20px; padding:6px 12px; font-size:12.5px; color:var(--ink-soft); cursor:pointer; font-family:inherit;}}
  .recipe-share-btn:hover{{border-color:var(--teal); color:var(--teal-deep);}}
  .recipe-share-btn.copied{{border-color:var(--teal); color:var(--teal-deep); background:var(--teal-pale);}}
</style>
</head>
<body>
<div class="wrap">
  <div class="nav-bar">
    <a href="../archive.html">← 전체 아카이브</a>
  </div>
  <div class="recipe-page">
    <button type="button" class="recipe-share-btn" id="shareBtn" aria-label="링크 복사">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <span id="shareLabel">링크 복사</span>
    </button>
    {media}
    <span class="stamp">{stamp}</span>
    {fail_badge}
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
      label.textContent = '복사됨!';
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


def build_pages(live, ids):
    os.makedirs(PAGES_DIR, exist_ok=True)
    ordered = sorted(range(len(live)), key=lambda i: (sort_key(live[i]), i))

    urls = []
    for pos, idx in enumerate(ordered):
        r = live[idx]
        pid = ids[idx]
        url = f'{SITE_BASE}/recipes/{pid}.html'
        urls.append(url)

        title = display_title(r)
        description = clean_description(r.get('intro'), title)
        imgs = r.get('gallery') or ([r['image']] if r.get('image') else [])
        og_image = f'<meta property="og:image" content="{esc(imgs[0])}">' if imgs else ''
        twitter_image = f'<meta name="twitter:image" content="{esc(imgs[0])}">' if imgs else ''

        meta_bits = [b for b in [r.get('date'), r.get('weather'), f'{r["calories"]}kcal' if r.get('calories') else None] if b]
        meta_line = ' · '.join(esc(b) for b in meta_bits)

        intro_section = (
            f'<section><h2>메모</h2><div class="recipe-body">{esc(r["intro"])}</div></section>'
            if r.get('intro') else ''
        )
        ingredients_section = (
            f'<section><h2>재료</h2><div class="recipe-body">{esc(r["ingredients"])}</div></section>'
            if r.get('ingredients') else ''
        )
        steps_section = (
            f'<section><h2>조리</h2><div class="recipe-body">{esc(r["steps"])}</div></section>'
            if r.get('steps') else ''
        )
        credit_section = (
            f'<section><h2>원본 크레딧</h2><div class="recipe-body">Inspired by {esc(r["credit"])}</div></section>'
            if r.get('credit') else ''
        )
        tags_section = ''
        if r.get('hashtags'):
            tags_section = '<section><h2>태그</h2><div class="recipe-tags">' + ''.join(
                f'<span>#{esc(h)}</span>' for h in r['hashtags']
            ) + '</div></section>'

        if pos > 0:
            prev_idx = ordered[pos - 1]
            prev_r = live[prev_idx]
            prev_href = f'{ids[prev_idx]}.html'
            prev_label = '← ' + (prev_r.get('date') or '이전')
        else:
            prev_href, prev_label = '#', ''
        if pos < len(ordered) - 1:
            next_idx = ordered[pos + 1]
            next_r = live[next_idx]
            next_href = f'{ids[next_idx]}.html'
            next_label = (next_r.get('date') or '다음') + ' →'
        else:
            next_href, next_label = '#', ''

        html_out = PAGE_TEMPLATE.format(
            title=esc(title), description=esc(description), url=url,
            og_image=og_image, twitter_image=twitter_image,
            media=media_html(r), stamp=esc(stamp_label(r)),
            fail_badge='<span class="fail-badge">실패기</span>' if r.get('failed') else '',
            meta_line=meta_line,
            intro_section=intro_section, ingredients_section=ingredients_section,
            steps_section=steps_section, credit_section=credit_section, tags_section=tags_section,
            prev_href=prev_href, prev_label=prev_label, next_href=next_href, next_label=next_label,
            json_ld=json_ld(r, url, title),
        )
        with open(os.path.join(PAGES_DIR, f'{pid}.html'), 'w', encoding='utf-8') as f:
            f.write(html_out)

    return urls


def build_sitemap(recipe_urls):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines.append(f'  <url><loc>{SITE_BASE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>')
    lines.append(f'  <url><loc>{SITE_BASE}/archive.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>')
    for u in recipe_urls:
        lines.append(f'  <url><loc>{u}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>')
    lines.append('</urlset>')
    with open(SITEMAP_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    with open(RECIPES_PATH, encoding='utf-8') as f:
        records = json.load(f)

    live = [r for r in records if not r.get('deleted')]
    ids = assign_unique_page_ids(live)

    slim = build_index(live, ids)
    print(f'recipes-index.json: {len(slim)} records')

    urls = build_pages(live, ids)
    print(f'recipe pages generated: {len(urls)}')

    build_sitemap(urls)
    print(f'sitemap.xml: {len(urls) + 2} URLs')


if __name__ == '__main__':
    main()
