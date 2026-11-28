"""Trích các biểu thuộc tính trong phụ lục Excel của quyết định công bố hiện trạng rừng (ngoài biểu theo xã):
diện tích rừng theo CHỦ QUẢN LÝ (chủ rừng), theo mục đích sử dụng chi tiết, diễn biến theo nguyên nhân, rừng trồng theo loài cây – cấp tuổi.

  python extract_decision_tables.py <phụ lục.xlsx> <năm> [--decision "1047/QĐ-UBND"] [--date 31/03/2026]

Nhận dạng tổng quát (không gắn cứng số cột): tìm dòng đánh số cột (1)(2)(3)…, ghép các dòng tiêu đề phía trên thành tên cột
(kể cả tiêu đề gộp nhiều tầng), đọc các dòng số liệu bên dưới. Biểu mới có thêm/bớt cột vẫn đọc được.
Ra: data/processed/forest-statistics-<năm>-tables.json. Các biểu này là số liệu TOÀN TỈNH theo quyết định (không tách theo xã)."""
import sys, json, re, unicodedata, datetime
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]; OUT = ROOT / 'data/processed'


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').lower().replace('đ', 'd'))
    return re.sub(r'\s+', ' ', ''.join(c for c in s if unicodedata.category(c) != 'Mn')).strip()


KINDS = [('owner', r'chu quan ly|chu rung|loai chu'), ('change', r'dien bien|nguyen nhan'), ('species', r'loai cay|cap tuoi'), ('purpose', r'muc dich su dung|loai rung'), ('commune', r'ty le che phu|don vi hanh chinh')]
LABEL = dict(owner='Diện tích rừng theo chủ quản lý (chủ rừng)', change='Diễn biến diện tích rừng theo nguyên nhân', species='Rừng trồng theo loài cây và cấp tuổi', purpose='Diện tích rừng theo mục đích sử dụng', commune='Hiện trạng theo đơn vị hành chính')
is_no = lambda v: v is not None and re.match(r'^\(?-?\d{1,2}\)?$', str(v).strip()) is not None
txt = lambda v: re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''
def num(v):
    if isinstance(v, bool): return None
    if isinstance(v, (int, float)): return round(float(v), 2)
    s = str(v or '').strip().replace(' ', '')
    if re.match(r'^-?[\d.]+,\d+$', s): s = s.replace('.', '').replace(',', '.')
    try: return round(float(s), 2)
    except ValueError: return None


def parse(ws):
    rows = [list(r) for r in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 400), max_col=40, values_only=True)]
    title = next((txt(c) for r in rows[:4] for c in r if c and len(txt(c)) > 12), ws.title)
    unit = next((txt(c) for r in rows[:6] for c in r if c and re.search(r'don vi tinh|dien tich:\s*ha', norm(c))), 'ha')
    # dòng đánh số cột; không có thì lấy dòng tiêu đề chứa "TT"
    ni = next((i for i, r in enumerate(rows[:14]) if sum(1 for c in r if is_no(c)) >= 4 and sum(1 for c in r if c not in (None, '') and not is_no(c)) <= 1), None)
    hi = next((i for i, r in enumerate(rows[:12]) if any(norm(c) in ('tt', 'stt') for c in r)), None)
    if hi is None: return None
    if ni is None or ni <= hi: ni = hi + 1 + next((k for k, r in enumerate(rows[hi + 1:hi + 4]) if any(isinstance(c, (int, float)) for c in r[2:])), 1) - 1
    head = rows[hi:ni] if ni > hi else [rows[hi]]
    ncol = max(len(r) for r in rows)
    labels = []
    for c in range(ncol):
        parts = []
        for li, hr in enumerate(head):
            v = txt(hr[c]) if c < len(hr) else ''
            if not v and li < len(head) - 1:  # ô gộp ngang: lấy chữ của ô bên trái gần nhất trên cùng dòng (chỉ áp cho tầng trên)
                k = c
                while k > 0 and not txt(hr[k] if k < len(hr) else ''): k -= 1
                below = any(txt(h2[c] if c < len(h2) else '') for h2 in head[li + 1:])
                v = txt(hr[k]) if below else ''
            if v and v not in parts: parts.append(v)
        labels.append(' – '.join(parts))
    data = rows[ni + 1:] if sum(1 for c in rows[ni] if is_no(c)) >= 4 else rows[ni:]
    name_c = next((c for c, l in enumerate(labels) if l and norm(l) not in ('tt', 'stt')), 1)
    code_c = next((c for c, l in enumerate(labels) if norm(l) == 'ma'), None)
    val_cols = [c for c in range(ncol) if c not in (name_c, code_c) and c > name_c and any(num(r[c]) is not None for r in data[:60] if c < len(r))]
    # cột có số liệu nhưng tiêu đề trống (nằm dưới một ô gộp, ví dụ “Phân theo cấp tuổi” 1…5): đặt tên theo ô gộp bên trái + số thứ tự
    numrow = rows[ni] if ni < len(rows) else []
    for c in val_cols:
        if labels[c]: continue
        k = c
        while k > name_c and not labels[k]: k -= 1
        parent = re.sub(r' – \d+$', '', labels[k]) if k > name_c else 'Cột'
        sub = txt(numrow[c]).strip('()') if c < len(numrow) and is_no(numrow[c]) else str(c - k + 1)
        if k > name_c and ' – ' not in labels[k] and is_no(numrow[k] if k < len(numrow) else None) and norm(parent) not in ('tong', 'cong'): labels[k] = f"{parent} – {txt(numrow[k]).strip('()')}"
        labels[c] = f'{parent} – {sub}'
    out = []
    for r in data:
        r = r + [None] * (ncol - len(r)); name = txt(r[name_c])
        if not name or is_no(name): continue
        vals = [num(r[c]) for c in val_cols]
        if all(v is None for v in vals): continue
        tt = txt(r[0]) if name_c > 0 else ''
        out.append(dict(tt=tt, name=name, code=txt(r[code_c]) if code_c is not None else '', level=0 if not tt and re.match(r'^(tong|cong)', norm(name)) else (1 if re.match(r'^[IVX]+$', tt) else 2 if tt else 3), values=vals))
    if not out or not val_cols: return None
    kind = next((k for k, pat in KINDS if re.search(pat, norm(title))), 'other')
    return dict(key=kind, sheet=ws.title, title=title, label=LABEL.get(kind, title), unit='ha' if 'ha' in norm(unit) else unit, columns=[labels[c] for c in val_cols], rows=out)


def extract(xlsx, year, decision='', date=''):
    wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    tables = [t for t in (parse(ws) for ws in wb.worksheets) if t and t['key'] != 'commune']
    if not tables: return None
    o = dict(year=int(year), decision=f'{decision} {date}'.strip(), scope='Số liệu TOÀN TỈNH theo quyết định công bố (không tách riêng vùng Kon Tum cũ, không chia theo xã).', source_file=Path(xlsx).name,
             extracted_at=datetime.datetime.utcnow().isoformat() + 'Z', tables=tables)
    (OUT / f'forest-statistics-{int(year)}-tables.json').write_text(json.dumps(o, ensure_ascii=False, indent=1), encoding='utf-8')
    return o


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 2: print(json.dumps(dict(ok=False, error='Cần: <xlsx> <năm>'), ensure_ascii=False)); sys.exit(2)
    opt = lambda k: (a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else '')
    try:
        o = extract(a[0], a[1], opt('--decision'), opt('--date'))
        print(json.dumps(dict(ok=bool(o), tables=[dict(key=t['key'], sheet=t['sheet'], columns=len(t['columns']), rows=len(t['rows'])) for t in (o or {}).get('tables', [])]), ensure_ascii=False))
    except Exception as e:  # noqa
        print(json.dumps(dict(ok=False, error=f'{type(e).__name__}: {e}'), ensure_ascii=False)); sys.exit(2)
