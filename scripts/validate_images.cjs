const fs=require('fs'),path=require('path');
const sharp=require('../.tools/svg/node_modules/sharp');
const base=path.resolve(__dirname,'../public/assets');
async function main(){
const rows=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8')).assets.filter(x=>!x.path.endsWith('.svg'));
for(const item of rows){const {info}=await sharp(path.join(base,item.path)).raw().toBuffer({resolveWithObject:true});if(info.width!==item.width||info.height!==item.height)throw Error('Wrong dimensions '+item.path);}
const result={decoded_images:rows.length,decoder:'sharp',failed:0};fs.writeFileSync(path.resolve(__dirname,'../notes/image-decode-validation.json'),JSON.stringify(result,null,2));console.log(result);
}main().catch(e=>{console.error(e.message);process.exit(1)});
