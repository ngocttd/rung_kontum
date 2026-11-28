// Phân quyền theo KHU VỰC QUẢN LÝ (địa bàn xã/phường).
// users.scope: rỗng = toàn vùng; hoặc một hay nhiều mã xã cách nhau bằng dấu phẩy ("23344,23350").
// Dùng chung cho web quản trị (lọc danh sách cảnh báo, phản ánh, vùng khoanh, báo cáo), MobileGIS (nhiệm vụ, khảo sát) và thông báo.
const list = (scope) => (scope ? String(scope).split(',').map((s) => s.trim()).filter(Boolean) : []);
// null = không giới hạn (toàn vùng)
function communesOf(user) { const l = list(user && user.scope); return l.length ? l : null; }
function inScope(scope, code) { const l = list(scope && scope.scope !== undefined ? scope.scope : scope); return !l.length || !code || l.includes(String(code)); }
// lọc danh sách theo địa bàn của người dùng; pick(item) → mã xã của mục; mục không xác định được xã vẫn hiện (để không bỏ sót)
function filter(user, items, pick) { const l = communesOf(user); return l ? items.filter((x) => { const c = pick(x); return !c || l.includes(String(c)); }) : items; }
function label(user, names = {}) { const l = communesOf(user); return l ? l.map((c) => names[c] || c).join(', ') : 'Toàn vùng'; }
const normalize = (v) => { const l = [...new Set((Array.isArray(v) ? v : list(v)).map((s) => String(s).trim()).filter((s) => /^[\w-]{1,20}$/.test(s)))]; return l.length ? l.join(',') : null; };
module.exports = { list, communesOf, inScope, filter, label, normalize };
