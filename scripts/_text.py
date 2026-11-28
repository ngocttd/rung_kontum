"""Chữ Việt trong bảng thuộc tính: nhận dạng và chuyển bảng mã TCVN3 (ABC – phông .Vn…) sang Unicode.
Dữ liệu kiểm kê, hiện trạng rừng cũ (MapInfo, Shapefile) thường gõ bằng TCVN3: chữ lưu trong tệp là ký tự Latin-1 (µ, ¸, ®, ©…)."""
_L = 'µ¸¶·¹¨»¾¼½Æ©ÇÊÈÉË®ÌÐÎÏÑªÒÕÓÔÖ×ÝØÜÞßãáâä«åèæçé¬êíëìîïóñòô\xadõøö÷ùúýûüþ'
_U = 'àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ'
_UP = {'¡': 'Ă', '¢': 'Â', '§': 'Đ', '£': 'Ê', '¤': 'Ô', '¥': 'Ơ', '¦': 'Ư'}
assert len(_L) == len(_U)
MAP = {ord(a): b for a, b in zip(_L, _U)}; MAP.update({ord(k): v for k, v in _UP.items()})
VN = set(_U) | set(_U.upper())
# ký tự "chữ ký" của TCVN3: mã TCVN3 mà KHÔNG phải chữ Việt Unicode hợp lệ (µ ¸ ® © ª « ¬ …); chữ Việt Unicode thật có mã > U+00FF (ă ơ ư đ ạ ề…)
SIG = (set(_L) | set(_UP)) - VN


def looks_tcvn3(strings):
    """Có ký tự đặc trưng TCVN3 và gần như không có chữ Việt Unicode (mã > U+00FF)."""
    sig = uni = 0
    for s in strings:
        if not isinstance(s, str): continue
        for ch in s:
            if ord(ch) > 0xFF: uni += 1
            elif ch in SIG: sig += 1
    return sig >= 3 and sig > uni * 5


def tcvn3_to_unicode(s):
    return s.translate(MAP) if isinstance(s, str) else s


def fix_props(features, mode='auto'):
    """mode: auto | tcvn3 | none. Trả về True nếu đã chuyển TCVN3 → Unicode (áp cho cả giá trị và giữ nguyên tên trường)."""
    if mode == 'none': return False
    if mode == 'auto':
        sample = [v for f in features[:400] for v in (f.get('properties') or {}).values() if isinstance(v, str)]
        if not looks_tcvn3(sample): return False
    for f in features:
        p = f.get('properties') or {}
        for k, v in p.items():
            if isinstance(v, str): p[k] = tcvn3_to_unicode(v)
    return True
