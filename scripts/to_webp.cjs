// Convert generated PNG overlays/thumbnails to WebP (lossy for imagery, keeps alpha) and remove the PNG.
const path=require('path'),fs=require('fs');
const sharp=require(path.join(__dirname,'..','.tools','svg','node_modules','sharp'));
const root=path.join(__dirname,'..','public','generated');
(async()=>{for(const dir of ['overlays','docs']){const d=path.join(root,dir);
 for(const f of fs.readdirSync(d).filter(f=>f.endsWith('.png'))){const src=path.join(d,f),dst=src.replace(/\.png$/,'.webp');
  await sharp(src).webp({quality:dir==='docs'?80:85,alphaQuality:90,effort:5}).toFile(dst);fs.unlinkSync(src);
  console.log(dir+'/'+path.basename(dst),fs.statSync(dst).size);}}})().catch(e=>{console.error(e);process.exit(1)});
