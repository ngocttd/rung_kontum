// Express 4 không bắt lỗi của route/middleware viết bằng async: promise bị từ chối làm Node tắt cả tiến trình.
// Bổ sung một lần ở tầng router để mọi lỗi như vậy đi vào bộ xử lý lỗi (errors.js) như lỗi thông thường.
// Nạp tệp này trước khi nhận yêu cầu. Khi nâng lên Express 5 thì bỏ được.
const Layer = require('express/lib/router/layer');

Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // bộ xử lý lỗi, không phải bộ xử lý yêu cầu
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') out.then(null, (e) => next(e || new Error('Promise bị từ chối')));
    return out;
  } catch (e) {
    return next(e);
  }
};
