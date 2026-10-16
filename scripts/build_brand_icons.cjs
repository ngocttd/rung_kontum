// Sinh toàn bộ biểu trưng / icon cho web và ứng dụng từ MỘT ảnh logo nguồn.
//
//   node scripts/build_brand_icons.cjs                       # dùng public/img/brand/logo-source.png nếu có, nếu không dùng brand-mark.svg
//   node scripts/build_brand_icons.cjs duong/dan/logo.png    # ảnh logo đầy đủ (biểu tượng tròn + chữ bên dưới, nền trắng)
//
// Ảnh nguồn được tách tự động:
//   - emblem: phần biểu tượng tròn phía trên (dòng trắng rộng nhất ngăn cách với phần chữ) → favicon, icon app, logo đầu trang web;
//   - full:   toàn bộ logo kèm chữ → màn hình khởi động/đăng nhập của ứng dụng, trang đăng nhập quản trị.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const BRAND = path.join(ROOT, 'public/img/brand');
const SVG = path.join(ROOT, 'public/img/brand-mark.svg');

// phân tích ảnh: các dòng/cột "có nội dung" (khác nền trắng)
async function contentProfile(buf) {
  const { data, info } = await sharp(buf).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rows = new Array(h).fill(0); const cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) { rows[y] += 1; cols[x] += 1; }
    }
  }
  return { w, h, rows, cols };
}
async function splitLogo(src) {
  const buf = fs.readFileSync(src);
  const p = await contentProfile(buf);
  const minPix = Math.max(2, p.w * 0.002);
  const filled = p.rows.map((n) => n > minPix);
  const top = filled.indexOf(true); const bottom = p.h - 1 - [...filled].reverse().indexOf(true);
  // ranh giới biểu tượng / chữ: dòng ít nội dung nhất trong dải 55–82% chiều cao nội dung
  // (logo có dải lượn sát chữ nên không phải lúc nào cũng có khoảng trắng hoàn toàn)
  const hgt = bottom - top;
  let splitY = Math.round(top + hgt * 0.68); let minN = Infinity;
  for (let y = Math.round(top + hgt * 0.55); y <= Math.round(top + hgt * 0.82); y++) {
    const n = p.rows.slice(Math.max(0, y - 2), y + 3).reduce((x, v) => x + v, 0); // làm mượt 5 dòng
    if (n < minN) { minN = n; splitY = y; }
  }
  // vùng biểu tượng: cắt theo nội dung, rồi đưa về hình vuông
  // sharp áp dụng trim trước extract nếu chung một chuỗi → tách 2 bước
  const band = await sharp(buf).extract({ left: 0, top, width: p.w, height: splitY - top }).flatten({ background: '#ffffff' }).png().toBuffer();
  const emblemRaw = await sharp(band).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer();
  const em = await sharp(emblemRaw).metadata();
  const side = Math.max(em.width, em.height);
  const emblem = await sharp({ create: { width: side, height: side, channels: 4, background: '#ffffff00' } })
    .composite([{ input: await whiteToAlpha(emblemRaw), left: Math.round((side - em.width) / 2), top: Math.round((side - em.height) / 2) }]).png().toBuffer();
  const full = await sharp(buf).flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer();
  return { emblem, full, splitY, top, bottom };
}

// nền trắng → trong suốt (giữ viền mềm) để đặt logo lên nền màu
async function whiteToAlpha(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.min(data[i], data[i + 1], data[i + 2]);
    if (m > 245) data[i + 3] = 0; else if (m > 225) data[i + 3] = Math.round(((245 - m) / 20) * 255);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function square(input, n, { scale = 0.92, bg = '#ffffff00', alpha = true } = {}) {
  const inner = await sharp(input).resize(Math.round(n * scale), Math.round(n * scale), { fit: 'contain', background: '#ffffff00' }).png().toBuffer();
  let img = sharp({ create: { width: n, height: n, channels: 4, background: bg } }).composite([{ input: inner, gravity: 'center' }]);
  if (!alpha) img = img.flatten({ background: bg === '#ffffff00' ? '#ffffff' : bg });
  return img.png().toBuffer();
}
const write = (file, buf) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); };

(async () => {
  const arg = process.argv[2];
  const src = arg ? path.resolve(arg) : fs.existsSync(path.join(BRAND, 'logo-source.png')) ? path.join(BRAND, 'logo-source.png') : null;
  let emblem; let full;
  if (src) {
    if (src !== path.join(BRAND, 'logo-source.png')) write(path.join(BRAND, 'logo-source.png'), await sharp(src).png().toBuffer());
    const r = await splitLogo(src);
    emblem = r.emblem; full = r.full;
    console.log(`Tách logo: biểu tượng dòng ${r.top}–${r.splitY}, chữ đến dòng ${r.bottom}`);
  } else {
    emblem = await sharp(fs.readFileSync(SVG), { density: 1200 }).resize(1024, 1024).png().toBuffer();
    full = emblem;
    console.log('Không có ảnh nguồn – dùng public/img/brand-mark.svg');
  }

  // ---- web ----
  write(path.join(BRAND, 'emblem.png'), await square(emblem, 512, { scale: 1 }));
  write(path.join(BRAND, 'emblem-128.png'), await square(emblem, 128, { scale: 1 }));
  write(path.join(BRAND, 'logo-full.png'), await sharp(full).resize({ width: 1200, withoutEnlargement: true }).png().toBuffer());
  write(path.join(BRAND, 'logo-full.webp'), await sharp(full).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 90 }).toBuffer());
  write(path.join(ROOT, 'public/img/favicon-32.png'), await square(emblem, 32, { scale: 1 }));
  write(path.join(ROOT, 'public/img/apple-touch-icon.png'), await square(emblem, 180, { scale: 0.9, bg: '#ffffff', alpha: false }));
  write(path.join(ROOT, 'public/img/icon-192.png'), await square(emblem, 192, { scale: 0.94 }));
  write(path.join(ROOT, 'public/img/icon-512.png'), await square(emblem, 512, { scale: 0.94 }));

  // ---- ứng dụng Flutter ----
  const m = path.join(ROOT, 'mobile');
  if (fs.existsSync(m)) {
    write(path.join(m, 'assets/images/logo.png'), await square(emblem, 512, { scale: 1 }));
    write(path.join(m, 'assets/images/logo-full.png'), await sharp(full).resize({ width: 900, withoutEnlargement: true }).png().toBuffer());
    for (const [d, n] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
      write(path.join(m, `android/app/src/main/res/mipmap-${d}/ic_launcher.png`), await square(emblem, n, { scale: 0.94, bg: '#ffffff' }));
    }
    const ios = path.join(m, 'ios/Runner/Assets.xcassets/AppIcon.appiconset');
    const contents = JSON.parse(fs.readFileSync(path.join(ios, 'Contents.json'), 'utf8'));
    for (const im of contents.images.filter((x) => x.filename)) {
      write(path.join(ios, im.filename), await square(emblem, Math.round(parseFloat(im.size) * parseInt(im.scale, 10)), { scale: 0.9, bg: '#ffffff', alpha: false })); // iOS: không kênh alpha
    }
    for (const [f, n, sc, bg] of [['Icon-192.png', 192, 0.94, '#ffffff00'], ['Icon-512.png', 512, 0.94, '#ffffff00'], ['Icon-maskable-192.png', 192, 0.72, '#ffffff'], ['Icon-maskable-512.png', 512, 0.72, '#ffffff']]) {
      write(path.join(m, 'web/icons', f), await square(emblem, n, { scale: sc, bg }));
    }
    write(path.join(m, 'web/favicon.png'), await square(emblem, 32, { scale: 1 }));
  }
  console.log('Đã sinh icon/logo cho web và ứng dụng.');
})().catch((e) => { console.error(e); process.exit(1); });
