// Chuyển mọi ô ảnh PNG trong một thư mục (đệ quy) sang WebP rồi xoá PNG – dùng khi Pillow của Python không hỗ trợ WebP.
// node tiles_to_webp.cjs <thư mục> [chất lượng]
const fs = require('fs'); const path = require('path'); const sharp = require('sharp');
const [dir, q = '82'] = process.argv.slice(2);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.png') ? [path.join(d, e.name)] : []));
(async () => { const fl = walk(dir); let n = 0;
  for (let i = 0; i < fl.length; i += 16) await Promise.all(fl.slice(i, i + 16).map(async (f) => { await sharp(f).webp({ quality: Number(q), alphaQuality: 90 }).toFile(f.replace(/\.png$/, '.webp')); fs.unlinkSync(f); n += 1; }));
  console.log(JSON.stringify({ ok: true, converted: n })); })().catch((e) => { console.error(e.message); process.exit(1); });
