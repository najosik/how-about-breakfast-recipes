import re, json, sys
from datetime import datetime

header_re = re.compile(r'^\d{8}(-실패)?$')

GENERIC_TAGS_FOR_TITLE = {
    '조식', '레시피', '직장인', '아침밥', '아침밥상', '먹스타그램', '요리스타그램',
    '홈쿡', '집밥', '혼밥', 'breakfast', '조식다이어리', '나의프랑스식샐러드',
    '나의프랑스식오븐요리', '샐러드', '트위터레시피', '초간단레시피', '미라클모닝',
}


def parse_entry(date_str, failed, body):
    """Parse one diary entry's body text into a structured record.
    date_str: 'YYYYMMDD' (may be malformed - handled gracefully)
    failed: bool, whether this entry was tagged as a failed attempt
    body: the full text content of the entry (everything after the date header)
    """
    body = body.strip('\n')
    body = re.sub(r'\n{3,}', '\n\n', body)

    try:
        date_iso = datetime.strptime(date_str, '%Y%m%d').strftime('%Y-%m-%d')
    except ValueError:
        if len(date_str) == 8 and date_str.isdigit():
            date_iso = f'{date_str[0:4]}-{date_str[4:6]}-{date_str[6:8]}'
        else:
            date_iso = None

    diary_no = None
    weather = None
    m = re.search(r'#조식다이어리\s*(\d+)\s*,?\s*([^\n]*)', body)
    if m:
        diary_no = int(m.group(1))
        weather = m.group(2).strip().rstrip(',').strip() or None

    m_cal = re.search(r'(?:약\s*)?([\d,]{2,6})\s*kcal', body)
    calories = int(m_cal.group(1).replace(',', '')) if m_cal else None

    m_credit = re.search(r'Inspired by[:\s]*([@#]\S+)', body)
    credit = m_credit.group(1) if m_credit else None

    hashtags_ordered = re.findall(r'#([^\s#,]+)', body)
    hashtags = sorted(set(hashtags_ordered))

    title = None
    if m_cal:
        after = body[m_cal.end():]
        after = after.split('\n\n')[0].split('👉')[0].strip()
        after = re.sub(r'\s+', ' ', after)
        if after:
            title = after[:60]
    if not title:
        food_tags = [h for h in hashtags_ordered if h not in GENERIC_TAGS_FOR_TITLE and not h.isascii()]
        if food_tags:
            title = ' '.join(dict.fromkeys(food_tags[:3]))
    if not title:
        first_line = next((l.strip() for l in body.split('\n') if l.strip() and not header_re.match(l.strip())), '')
        title = first_line[:40] or '(제목 미상)'

    ing_text = None
    step_text = None
    intro_text = body

    ing_match = re.search(r'👉\s*재료[^\n]*\n(.*?)(?=👉\s*조리|$)', body, re.S)
    step_match = re.search(r'👉\s*조리[^\n]*\n(.*?)(?=Inspired by|\n#[^\n]*#|\Z)', body, re.S)

    if ing_match:
        ing_text = ing_match.group(1).strip()
        intro_text = body[:ing_match.start()].strip()
    if step_match:
        step_text = step_match.group(1).strip()

    intro_text = re.sub(r'Inspired by[^\n]*', '', intro_text)
    intro_text = re.sub(r'^\s*#\S+(?:\s+#\S+)*\s*$', '', intro_text, flags=re.M)
    intro_text = re.sub(r'\n{2,}', '\n', intro_text).strip()

    return {
        'date': date_iso,
        'date_raw': date_str,
        'diary_no': diary_no,
        'weather': weather,
        'failed': failed,
        'calories': calories,
        'title': title,
        'credit': credit,
        'hashtags': hashtags,
        'intro': intro_text,
        'ingredients': ing_text,
        'steps': step_text,
        'raw': body,
    }


def parse_file(path):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    text = text.replace('\ufeff', '').replace('\r\n', '\n').replace('\r', '\n')
    lines = text.split('\n')

    blocks = []
    cur_header = None
    cur_lines = []
    for line in lines:
        stripped = line.strip()
        if header_re.match(stripped):
            if cur_header is not None:
                blocks.append((cur_header, cur_lines))
            cur_header = stripped
            cur_lines = []
        else:
            cur_lines.append(line)
    if cur_header is not None:
        blocks.append((cur_header, cur_lines))

    records = []
    for header, body_lines in blocks:
        date_str = header.split('-')[0]
        failed = '실패' in header
        records.append(parse_entry(date_str, failed, '\n'.join(body_lines)))
    return records


if __name__ == '__main__':
    records = parse_file('/home/claude/breakfast/raw.txt')
    print(f'Total blocks found: {len(records)}', file=sys.stderr)

    def sort_key(r):
        return (r['date'] or '0000-00-00', r['diary_no'] or 0)
    records.sort(key=sort_key, reverse=True)

    with open('/home/claude/breakfast/recipes.json', 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    print(f'Total records: {len(records)}', file=sys.stderr)
    with_ing = sum(1 for r in records if r['ingredients'])
    with_cal = sum(1 for r in records if r['calories'])
    print(f'With ingredients: {with_ing}, with calories: {with_cal}', file=sys.stderr)
    dates = [r['date'] for r in records if r['date']]
    print(f'Date range: {min(dates)} ~ {max(dates)}', file=sys.stderr)
