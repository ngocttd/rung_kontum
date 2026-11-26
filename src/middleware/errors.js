// Terminal HTTP errors must not depend on sessions, template locals or EJS.
// Earlier middleware can fail before those are available. Keep diagnostics in
// server logs and send only fixed, public messages, including in development.
const messages = {
  400: 'Yêu cầu không hợp lệ.',
  401: 'Cần đăng nhập để tiếp tục.',
  403: 'Không có quyền truy cập.',
  404: 'Không tìm thấy nội dung yêu cầu.',
  413: 'Dữ liệu gửi lên quá lớn.',
  415: 'Định dạng dữ liệu không được hỗ trợ.',
  429: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.',
};

module.exports = function errors(err, req, res, next) {
  console.error('[http]', err);
  if (res.headersSent) return next(err);

  const candidate = err.status || err.statusCode;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : 500;
  const message = messages[status] || (status < 500 ? messages[400] : 'Đã xảy ra lỗi khi xử lý yêu cầu.');
  res.status(status).set('Cache-Control', 'no-store');
  if (req.path === '/api' || req.path.startsWith('/api/') || req.path.startsWith('/quan-tri/api/')) return res.json({ error: message });
  return res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${status}</title></head><body><main><h1>${status}</h1><p>${message}</p><a href="/">Về trang chủ</a></main></body></html>`);
};
