// News/guide articles (CMS). Seeded once from data/content/articles.json as drafts awaiting review;
// nothing is auto-published. Editors move items draft → review → published in the admin.
const fs = require('fs');
const path = require('path');
const { paths, showDraftContent } = require('../config');
const store = require('../data/store');

const CATEGORIES = {
  'canh-bao-chay': { label: 'Cảnh báo cháy rừng', icon: 'fire' },
  'quan-ly-rung': { label: 'Hoạt động quản lý rừng', icon: 'forest' },
  'chinh-sach': { label: 'Chính sách – Văn bản', icon: 'documents' },
  'khoa-hoc': { label: 'Khoa học – Công nghệ', icon: 'satellite' },
  'hop-tac': { label: 'Hợp tác – Dự án', icon: 'community' },
  'cong-dong': { label: 'Cộng đồng – Xã hội', icon: 'users' },
  'thien-tai': { label: 'Ứng phó thiên tai', icon: 'storm' },
};
const STATUS = { draft: 'Bản nháp', review: 'Chờ duyệt', published: 'Đã xuất bản', archived: 'Lưu trữ' };

const SEED_CATEGORY = { 'Văn bản chuyên ngành': 'chinh-sach', 'Hướng dẫn dữ liệu': 'khoa-hoc', 'Hướng dẫn cảnh báo': 'canh-bao-chay', 'Hướng dẫn giám sát': 'khoa-hoc' };

// Additional explanatory drafts describing the methods implemented in this system (no events, no claims).
const METHOD_ARTICLES = [
  {
    id: 'fire-danger-method', category: 'canh-bao-chay', title: 'Cách hệ thống tính cấp dự báo nguy cơ cháy rừng',
    image: '/assets/items/smoke-report.webp', source_url: 'https://cfs.nrcan.gc.ca/terms/read/1318',
    body: 'Cấp dự báo nguy cơ cháy được tính tự động cho từng xã theo chỉ số tổng hợp P của Nesterov: cộng dồn tích nhiệt độ không khí và độ chênh lệch bão hòa hơi nước qua các ngày có mưa không quá 5 mm; ngày mưa trên 5 mm thì chỉ số trở về 0. Năm cấp I–V dùng ngưỡng 5.000, 10.000, 15.000 và 20.000 như các bảng tra cấp tỉnh ban hành theo Nghị định 156/2018/NĐ-CP.\n\nĐầu vào là số liệu khí tượng lúc 12 giờ tại điểm đại diện mỗi xã: tái phân tích ERA5-Land cho giai đoạn đã qua và Open-Meteo cho những ngày gần đây và 7 ngày dự báo. Hệ thống tính thêm bộ chỉ số FWI của Canada để đối chiếu.\n\nKết quả đã được so với lịch sử điểm nóng vệ tinh 2024–2026: tỷ lệ ngày có điểm nóng tăng rõ từ cấp I đến cấp V. Đây là sản phẩm tính toán tự động; cảnh báo chính thức chỉ có hiệu lực khi được cơ quan chuyên môn phê duyệt và công bố.',
  },
  {
    id: 'forest-loss-forecast-method', category: 'khoa-hoc', title: 'Dự báo nguy cơ mất rừng 2025–2026: dữ liệu và kiểm định',
    image: '/assets/items/forest-technology.webp', source_url: 'https://glad.earthengine.app/view/global-forest-change',
    body: 'Bản đồ nguy cơ mất rừng được dựng trên lưới 100 m bằng mô hình Random Forest. Mô hình học từ lịch sử mất tán cây Hansen GFC 2001–2024 cùng các yếu tố: khoảng cách và mật độ mất rừng gần đây, độ cao, độ dốc, khoảng cách tới khu xây dựng và tỷ lệ đất canh tác xung quanh.\n\nĐể kiểm tra khả năng dự báo, mô hình học với trạng thái cuối năm 2018 để dự báo 2019–2020, rồi được thử trên giai đoạn 2023–2024 mà nó chưa từng thấy. Kết quả kiểm định, cách phân cấp và tỷ lệ mất rừng thực tế theo từng cấp được công khai trên trang Biến động rừng.\n\nMất tán cây theo Hansen gồm cả khai thác rừng trồng theo chu kỳ, nên bản đồ dùng để ưu tiên tuần tra, kiểm tra, không dùng để kết luận vi phạm.',
  },
  {
    id: 'how-to-report', category: 'cong-dong', title: 'Hướng dẫn gửi phản ánh hiện trường về rừng',
    image: '/assets/items/field-survey.webp', source_url: null,
    body: 'Người dân có thể gửi phản ánh về cháy rừng, phá rừng, lấn chiếm đất rừng, vận chuyển lâm sản hoặc động vật hoang dã tại trang Phản ánh. Hãy chọn loại phản ánh, mô tả ngắn gọn, chọn vị trí trên bản đồ hoặc dùng định vị của điện thoại và đính kèm ảnh nếu có.\n\nSau khi gửi, hệ thống cấp mã hồ sơ để tra cứu tiến độ xử lý. Thông tin liên hệ của người gửi chỉ cán bộ xử lý được xem. Ảnh được loại bỏ dữ liệu vị trí ẩn trước khi lưu. Khi phát hiện cháy đang lan, hãy gọi ngay số điện thoại khẩn cấp 114 và báo chính quyền địa phương.',
  },
];

function seed() {
  if (store.all('articles').length) return;
  const src = path.join(paths.content, 'articles.json');
  const list = fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, 'utf8')) : [];
  for (const a of list) {
    store.insert('articles', {
      slug: a.id, title: a.title, category: SEED_CATEGORY[a.category] || 'khoa-hoc', body: a.body, summary: a.body.split('. ')[0] + '.',
      image: a.image, source_url: a.source_url || null, source_date: a.source_date || null, author: a.author,
      status: 'draft', published_at: null, views: 0, origin: 'data/content/articles.json',
    });
  }
  for (const a of METHOD_ARTICLES) {
    store.insert('articles', {
      slug: a.id, title: a.title, category: a.category, body: a.body, summary: a.body.split('. ')[0] + '.', image: a.image,
      source_url: a.source_url, source_date: null, author: 'Nội dung biên soạn cho hệ thống', status: 'draft', published_at: null, views: 0, origin: 'method_description',
    });
  }
}

function visible(a) { return a.status === 'published' || (showDraftContent && (a.status === 'draft' || a.status === 'review')); }

function list({ category, q, includeAll } = {}) {
  let rows = store.all('articles').filter((a) => (includeAll ? a.status !== 'deleted' : visible(a)));
  if (category) rows = rows.filter((a) => a.category === category);
  if (q) { const s = q.toLowerCase(); rows = rows.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(s)); }
  return rows.slice().sort((a, b) => (b.published_at || b.created_at).localeCompare(a.published_at || a.created_at))
    .map((a) => ({ ...a, categoryLabel: (CATEGORIES[a.category] || {}).label || a.category, statusLabel: STATUS[a.status] }));
}

function bySlug(slug) {
  const a = store.find('articles', (x) => x.slug === slug && x.status !== 'deleted');
  return a && visible(a) ? { ...a, categoryLabel: (CATEGORIES[a.category] || {}).label, statusLabel: STATUS[a.status] } : null;
}

module.exports = { CATEGORIES, STATUS, seed, list, bySlug, visible };
