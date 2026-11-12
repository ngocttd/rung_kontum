"""Nạp số liệu hiện trạng rừng chính thức của một năm từ phụ lục Excel của quyết định công bố (Biểu 4 – hiện trạng
rừng theo đơn vị hành chính, mẫu Thông tư 33/2018/TT-BNNPTNT) → data/processed/forest-statistics-<năm>-kon-tum-communes.json
và cập nhật danh mục năm data/processed/forest-statistics-index.json. Số liệu cũ các năm trước giữ nguyên để tra cứu.

Usage: python import_official_statistics.py <tệp.xlsx> --as-of 2026-12-31 --decision "123/QĐ-UBND" --date 31/03/2027
                                              [--sheet "bieu 4"] [--url https://...] [--check]
--check: chỉ kiểm tra, không ghi (trả về số xã khớp, tổng diện tích để quản trị xem trước).
Cột Biểu 4 (theo thứ tự): STT, đơn vị, DT tự nhiên, DT có rừng + chưa thành rừng, rừng tự nhiên, rừng trồng đã thành rừng,
rừng trồng chưa thành rừng, DT quy hoạch lâm nghiệp, đặc dụng, phòng hộ, sản xuất, tỷ lệ che phủ (%).
"""
import sys, json, re, argparse, hashlib, unicodedata, datetime
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/processed'
ap = argparse.ArgumentParser()
ap.add_argument('xlsx'); ap.add_argument('--as-of', required=True); ap.add_argument('--decision', required=True); ap.add_argument('--date', required=True)
ap.add_argument('--sheet', default=''); ap.add_argument('--url', default=''); ap.add_argument('--check', action='store_true')
a = ap.parse_args()


def fail(m): print(json.dumps(dict(ok=False, error=m), ensure_ascii=False)); sys.exit(2)


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '').lower().replace('đ', 'd'))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub(r'^(xa|phuong|dac khu|thi tran)\s+', '', s.strip())).strip()


if not re.match(r'^\d{4}-\d{2}-\d{2}$', a.as_of): fail('Ngày số liệu dạng YYYY-MM-DD')
year = int(a.as_of[:4])
try: book = openpyxl.load_workbook(a.xlsx, data_only=True, read_only=True)
except Exception as e: fail(f'Không đọc được Excel: {e}')
sheets = [s for s in book if (a.sheet and norm(s.title) == norm(a.sheet)) or (not a.sheet and re.search(r'bieu\s*0?4\b', norm(s.title)))]
if not sheets: fail('Không thấy sheet Biểu 4 (hiện trạng rừng theo đơn vị hành chính). Các sheet: ' + ', '.join(s.title for s in book))
sh = sheets[0]
cols = ['sequence', 'source_commune_name', 'natural_area_ha', 'forest_and_immature_plantation_ha', 'natural_forest_ha', 'established_plantation_ha', 'immature_plantation_ha',
        'forest_planning_area_ha', 'special_use_planning_ha', 'protection_planning_ha', 'production_planning_ha', 'official_forest_cover_percent']
communes = json.loads((ROOT / 'data/boundaries/kon-tum-new-communes-full.geojson').read_text(encoding='utf-8'))['features']
lookup = {norm(f['properties']['fullName']): f['properties'] for f in communes}
num = lambda v: float(v) if isinstance(v, (int, float)) else (float(str(v).replace('.', '').replace(',', '.')) if v not in (None, '') and re.match(r'^[\d.,]+$', str(v).strip()) else None)
rows = []; allrows = []
for i, values in enumerate(sh.iter_rows(min_row=1, max_col=12, values_only=True), 1):
    if not values or not isinstance(values[0], (int, float)) or not values[1] or not isinstance(values[0], int) and not float(values[0]).is_integer(): continue
    vals = list(values) + [None] * (12 - len(values))
    item = {c: (vals[j] if j < 2 else num(vals[j])) for j, c in enumerate(cols)}
    item.update(source_sheet=sh.title, source_row=i, as_of=a.as_of, decision=f'{a.decision} {a.date}', unit='ha except percent', source_url=a.url or None)
    item['established_forest_ha'] = round((item['natural_forest_ha'] or 0) + (item['established_plantation_ha'] or 0), 2)
    allrows.append(item)
    k = norm(item['source_commune_name'])
    if k in lookup:
        p = lookup[k]
        rows.append({**item, 'commune_code': p['code'], 'commune_name': p['fullName'], 'match_method': 'khớp tên xã (bỏ dấu)', 'scope': 'toàn xã hiện hành'})
codes = {r['commune_code'] for r in rows}
missing = [p['fullName'] for k, p in lookup.items() if p['code'] not in codes]
if len(rows) < 30: fail(f'Chỉ khớp {len(rows)}/40 xã – kiểm tra sheet/cột. Chưa khớp: ' + ', '.join(missing[:10]))
tot = lambda k: round(sum(r[k] or 0 for r in rows), 1)
report = dict(ok=True, year=year, matched=len(rows), expected=len(lookup), missing=missing, sheet=sh.title, rows_in_sheet=len(allrows),
              natural_area_ha=tot('natural_area_ha'), established_forest_ha=tot('established_forest_ha'), natural_forest_ha=tot('natural_forest_ha'), plantation_ha=tot('established_plantation_ha'),
              cover_percent=round(tot('established_forest_ha') / tot('natural_area_ha') * 100, 2) if tot('natural_area_ha') else None)
if a.check: print(json.dumps(report, ensure_ascii=False)); sys.exit(0)
(OUT / f'forest-statistics-{year}-kon-tum-communes.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
(OUT / f'forest-statistics-{year}-all-communes.json').write_text(json.dumps(allrows, ensure_ascii=False, indent=2), encoding='utf-8')
idx_p = OUT / 'forest-statistics-index.json'
idx = json.loads(idx_p.read_text(encoding='utf-8')) if idx_p.exists() else {'years': []}
idx['years'] = [y for y in idx['years'] if y['year'] != year] + [dict(year=year, as_of=a.as_of, decision=a.decision, decision_date=a.date, source_url=a.url or None,
    file=f'forest-statistics-{year}-kon-tum-communes.json', sha256=hashlib.sha256(Path(a.xlsx).read_bytes()).hexdigest(), imported_at=datetime.datetime.utcnow().isoformat() + 'Z', matched=len(rows))]
idx['years'].sort(key=lambda y: y['year'])
idx_p.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
