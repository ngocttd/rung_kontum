const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('../.tools/svg/node_modules/sharp');
const root=path.resolve(__dirname,'..'),base=path.join(root,'public/assets');
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(path.join(dir,d.name)):[path.join(dir,d.name)]);
async function main(){
  for(const folder of ['banners','items']) for(const p of files(path.join(base,folder)).filter(p=>p.endsWith('.png'))){
    const out=p.replace(/\.png$/,'.webp');
    await sharp(p).resize({width:folder==='banners'?1920:1200,withoutEnlargement:true}).webp({quality:88}).toFile(out);
    await sharp(p).resize({width:folder==='banners'?960:480,withoutEnlargement:true}).webp({quality:84}).toFile(p.replace(/\.png$/,'-small.webp'));
  }
  for(const folder of ['icons/colored','markers','symbols','maps']) for(const p of files(path.join(base,folder)).filter(p=>p.endsWith('.svg'))){
    await sharp(p).resize({width:folder==='maps'?1200:128}).png().toFile(p.replace(/\.svg$/,'.png'));
  }
  const markers=files(path.join(base,'markers')).filter(p=>p.endsWith('.svg')).sort();
  for(const ratio of [1,2]){
    const tile=64*ratio,cols=6,rows=Math.ceil(markers.length/cols),positions={},parts=[];
    for(let i=0;i<markers.length;i++){
      const x=(i%cols)*tile,y=Math.floor(i/cols)*tile;
      parts.push({input:await sharp(markers[i]).resize(tile,tile).png().toBuffer(),left:x,top:y});
      positions[path.basename(markers[i],'.svg')]={x,y,width:tile,height:tile,pixelRatio:ratio,sdf:false};
    }
    const name=ratio===1?'markers':'markers@2x',dir=path.join(base,'sprites');fs.mkdirSync(dir,{recursive:true});
    await sharp({create:{width:cols*tile,height:rows*tile,channels:4,background:'#00000000'}}).composite(parts).png().toFile(path.join(dir,name+'.png'));
    fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(positions,null,2));
  }
  const manifest=[];
  for(const p of files(base).filter(p=>/\.(svg|png|webp)$/.test(p))){
    const rel=path.relative(base,p).replace(/\\/g,'/'),m=await sharp(p).metadata();
    manifest.push({path:rel,width:m.width,height:m.height,bytes:fs.statSync(p).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
      source:rel.startsWith('banners/')||rel.startsWith('items/')?'AI-generated illustration':rel.startsWith('maps/')?'GIS-derived historical province and current communes':rel.startsWith('icons/')?'Bootstrap Icons 1.13.1 MIT / project styling':'Project cartographic symbols; Bootstrap glyphs except custom wildlife paw',
      illustrativeOnly:rel.startsWith('banners/')||rel.startsWith('items/'),hasAlpha:m.hasAlpha});
  }
  fs.writeFileSync(path.join(base,'manifest.json'),JSON.stringify({created:'2026-10-15',assets:manifest},null,2));
  const show=manifest.filter(x=>x.path.endsWith('.webp')&&!x.path.includes('-small.')||x.path.endsWith('.svg')&&!x.path.startsWith('icons/')||x.path.startsWith('icons/colored/')&&x.path.endsWith('.svg'));
  const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cards=show.map(x=>`<a class="asset ${x.path.split('/')[0]}" data-name="${esc(x.path)}" href="${esc(x.path)}" target="_blank"><img loading="lazy" src="${esc(x.path)}" alt="${esc(x.path)}"><strong>${esc(x.path)}</strong><small>${x.width} × ${x.height} · ${Math.round(x.bytes/1024)} KB</small><span>${x.illustrativeOnly?'Ảnh minh họa AI':x.path.startsWith('maps/')?'Vẽ từ dữ liệu GIS':'SVG / biểu tượng'}</span></a>`).join('');
  fs.writeFileSync(path.join(base,'index.html'),`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thư viện tài nguyên WebGIS Kon Tum</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f6f4;color:#12354a;font:15px system-ui}header{background:#073f35;color:white;padding:32px 5vw}h1{margin:0 0 10px;font-size:28px}header p{max-width:1000px;line-height:1.6}nav{position:sticky;top:0;background:#fff;padding:18px 5vw;display:flex;gap:12px;z-index:2;border-bottom:1px solid #d7e5df}input,select{padding:12px;border:1px solid #bfd1c8;border-radius:8px;font:inherit}input{flex:1}main{padding:28px 5vw;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}.asset{background:white;border:1px solid #dce6e0;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;display:flex;flex-direction:column;gap:8px;padding-bottom:15px}.asset img{width:100%;height:170px;object-fit:contain;background:#e7eeeb}.banners{grid-column:span 2}.banners img{height:220px;object-fit:contain;background:#173f38}.asset strong,.asset small,.asset span{margin:0 15px;overflow-wrap:anywhere}.asset strong{font-size:13px}.asset span{font-size:11px;color:#467762}.asset[hidden]{display:none}.icons img,.markers img,.symbols img{height:100px;padding:20px;background:repeating-conic-gradient(#f1f5f3 0% 25%,#fff 0% 50%) 50% / 16px 16px}footer{padding:30px 5vw}@media(max-width:600px){.banners{grid-column:span 1}nav{flex-wrap:wrap}main{grid-template-columns:1fr}}</style><header><h1>Thư viện tài nguyên WebGIS Kon Tum</h1><p>Banner P01–P11, nền MobileGIS, ảnh item, icon, symbol và marker. Ảnh AI dùng để minh họa giao diện; không dùng làm bằng chứng hiện trường. Các hình bản đồ chỉ biểu diễn ranh giới đã tải, chưa có lớp rừng hoặc nguy cơ cháy.</p></header><nav><input id="q" type="search" placeholder="Tìm tên tài nguyên…"><select id="kind"><option value="">Tất cả</option><option>banners</option><option>items</option><option>icons</option><option>markers</option><option>symbols</option><option>maps</option></select></nav><main>${cards}</main><footer>Bootstrap Icons © The Bootstrap Authors — MIT. Ranh giới tỉnh lịch sử: Government of Viet Nam / HDX, CC BY 3.0 IGO, qua geoBoundaries. Xã mới: thanglequoc/vietnamese-provinces-database v5.2.0. Xem manifest và tài liệu đi kèm để biết phạm vi sử dụng.</footer><script>const q=document.querySelector('#q'),k=document.querySelector('#kind');function filter(){document.querySelectorAll('.asset').forEach(el=>el.hidden=!(el.dataset.name.includes(q.value.toLowerCase())&&(!k.value||el.classList.contains(k.value))))}q.oninput=k.onchange=filter;</script></html>`);
  console.log(JSON.stringify({assetFiles:manifest.length,previewCards:show.length,generatedPhotos:manifest.filter(x=>x.path.endsWith('.png')&&x.illustrativeOnly).length}));
}main().catch(e=>{console.error(e.message);process.exit(1)});
