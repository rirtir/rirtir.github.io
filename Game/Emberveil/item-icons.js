/** すべての持ち物用の16×16 native pixel icons。文字の代用品を使わない。 */
import {canvas,hash} from './visuals.js';
import {pixelEllipse} from './lighting.js';

const P={ink:'#141c2c',dark:'#253641',stone:'#70847d',white:'#ceeed2',wood:'#634a3b',tan:'#b39158',copper:'#c88b48',gold:'#ffdc8c',green:'#588552',lightgreen:'#b7c979',teal:'#49af9d',purple:'#a46d9c',red:'#d36737',yellow:'#ffd275'};
const rect=(c,x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
function line(c,x,y,dx,dy,n,color,width=1){for(let i=0;i<n;i++)rect(c,x+dx*i,y+dy*i,width,width,color);}
function metal(key){return key.includes('ember')?P.red:key.includes('crystal')?P.teal:key.includes('copper')?P.copper:P.stone;}
function rock(c,color){
 for(let y=4;y<=12;y++){const w=y<7?y-2:y<10?6:14-y;rect(c,8-w,y,w*2+1,1,P.ink);rect(c,9-w,y,w*2-1,1,P.dark);}
 rect(c,5,5,6,4,color);rect(c,4,9,4,2,color);rect(c,10,9,2,2,color);rect(c,6,5,3,1,P.white);
}
function food(c,key){
 if(key.includes('fish')){
  const color=key.includes('golden')?P.gold:key.includes('ember')?P.red:key.includes('prism')?P.purple:P.teal;
  pixelEllipse(c,8,8,5,3,P.ink);pixelEllipse(c,8,7,4,2,color);rect(c,3,5,2,6,color);rect(c,12,6,1,1,P.white);rect(c,12,7,1,1,P.ink);line(c,7,10,1,0,4,P.stone);
 }else if(key.includes('glowcap')){
  rect(c,7,8,2,6,P.wood);pixelEllipse(c,8,7,6,3,P.ink);pixelEllipse(c,8,6,5,2,P.teal);rect(c,5,5,2,1,P.white);rect(c,10,6,1,1,P.white);rect(c,5,8,6,1,P.white);
 }else if(key.includes('grain')||key==='flour'){
  for(const x of[5,9]){rect(c,x,5,1,9,P.wood);for(let i=0;i<3;i++){rect(c,x-1,3+i*3,1,2,P.gold);rect(c,x+1,4+i*3,1,2,P.tan);}}
 }else if(key.includes('pepper')){
  rect(c,8,2,2,4,P.green);pixelEllipse(c,8,8,3,4,P.red);rect(c,7,5,1,4,P.gold);rect(c,6,12,2,2,P.red);
 }else if(key.includes('soup')||key.includes('stew')||key.includes('meal')){
  rect(c,3,7,11,5,P.ink);rect(c,4,9,9,4,P.stone);pixelEllipse(c,8,7,5,2,P.tan);rect(c,5,6,2,1,P.green);rect(c,9,7,2,1,P.red);rect(c,6,13,5,1,P.dark);rect(c,6,3,1,2,P.white);
 }else if(key.includes('bread')){pixelEllipse(c,8,8,6,4,P.wood);pixelEllipse(c,7,7,5,3,P.tan);rect(c,5,5,1,3,P.gold);rect(c,8,5,1,3,P.gold);}
 else{pixelEllipse(c,8,8,4,4,P.wood);pixelEllipse(c,7,7,3,3,P.tan);rect(c,7,3,1,3,P.green);rect(c,8,3,3,2,P.lightgreen);rect(c,5,7,2,1,P.gold);}
}
function furniture(c,key){
 if(key.startsWith('wall')||key.startsWith('floor')||key.startsWith('bridge')){
  const color=key.includes('wood')?P.wood:key.includes('gold')?P.copper:key.includes('crystal')||key.includes('glass')?P.teal:key.includes('brick')?P.red:P.stone;
  rect(c,2,3,12,10,P.ink);rect(c,3,4,10,8,color);
  for(let i=0;i<3;i++){rect(c,3,5+i*3,10,1,P.dark);rect(c,5+i%2*4,4+i*3,1,3,P.dark);}rect(c,3,4,10,1,P.white);
 }else if(key.includes('torch')||key.includes('lamp')||key==='brazier'){
  rect(c,7,7,2,7,P.wood);rect(c,6,13,4,1,P.stone);const col=key.includes('crystal')?P.teal:P.gold;
  rect(c,5,4,6,5,P.ink);rect(c,6,3,4,5,col);rect(c,7,2,2,5,P.white);
 }else if(key.includes('banner')){
  const col=key.includes('ember')?P.red:key.includes('crystal')?P.purple:P.green;
  rect(c,4,2,1,12,P.tan);rect(c,5,3,7,8,P.ink);rect(c,5,3,6,7,col);rect(c,5,10,4,1,col);rect(c,7,5,2,2,P.gold);
 }else if(key==='chest'){
  rect(c,2,5,12,8,P.ink);rect(c,3,4,10,8,P.wood);rect(c,3,5,10,2,P.tan);rect(c,4,5,1,7,P.gold);rect(c,11,5,1,7,P.gold);rect(c,3,8,10,1,P.ink);rect(c,7,8,2,2,P.gold);
 }else if(key==='bed'){
  rect(c,2,3,2,11,P.wood);rect(c,12,3,2,11,P.wood);rect(c,4,4,8,3,P.white);rect(c,4,7,8,6,P.teal);rect(c,4,7,8,1,P.lightgreen);
 }else if(key==='planter'||key==='moss_pot'){
  rect(c,3,9,10,5,P.wood);rect(c,3,9,10,1,P.tan);for(const x of[5,9]){rect(c,x,5,1,4,P.green);rect(c,x-2,5,2,2,P.lightgreen);rect(c,x+1,6,2,2,P.green);}
 }else if(key==='furnace'||key==='campfire'){
  rect(c,4,5,8,8,P.dark);rect(c,5,3,6,4,P.stone);rect(c,6,8,4,4,P.red);rect(c,7,7,2,5,P.gold);rect(c,3,13,10,1,P.stone);
 }else if(key==='cookpot'){
  rect(c,4,5,8,2,P.stone);pixelEllipse(c,8,9,5,4,P.dark);rect(c,5,7,6,2,P.tan);rect(c,6,14,4,1,P.red);rect(c,8,2,1,2,P.white);
 }else{
  rect(c,2,6,12,4,P.wood);rect(c,2,6,12,1,P.tan);rect(c,3,10,2,4,P.wood);rect(c,11,10,2,4,P.wood);rect(c,6,4,4,2,P.stone);
 }
}
export class ItemIcons {
 constructor(){this.cache=new Map();this.canvases=new Map();}
 image(key,def){this.url(key,def);return this.canvases.get(key);}
 url(key,definition={}){
  if(this.cache.has(key))return this.cache.get(key);
  const c=canvas(16,16),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
  const type=definition.type||'material',color=metal(key);
  if(type==='sword'){
    line(ctx,4,11,1,-1,9,P.ink,3);line(ctx,5,11,1,-1,8,color,2);line(ctx,6,10,1,-1,7,P.white);line(ctx,2,12,1,-1,3,P.wood,2);line(ctx,4,9,1,1,4,P.copper);
  }else if(type==='pick'||type==='axe'){
    line(ctx,3,12,1,-1,8,P.wood,2);line(ctx,3,12,1,-1,8,P.tan);
    if(type==='pick'){line(ctx,6,3,1,0,7,color,2);rect(ctx,5,4,3,3,color);rect(ctx,12,5,1,3,color);rect(ctx,7,3,5,1,P.white);}
    else{rect(ctx,7,2,5,6,P.ink);rect(ctx,9,2,4,5,color);rect(ctx,12,3,2,3,P.white);}
  }else if(type==='armor'){
    const rows=['00100100','01111110','11111111','11011011','00111100','00111100','00111100','00111100','00111100','00111100','00011000'];
    rows.forEach((row,y)=>{for(let x=0;x<row.length;x++)if(row[x]==='1')rect(ctx,x+4,y+2,1,1,x<7?color:P.dark);});rect(ctx,7,4,2,2,P.gold);
  }else if(type==='rod'){
    line(ctx,3,13,1,-1,11,P.tan);line(ctx,13,3,-1,1,3,P.white);rect(ctx,9,6,1,7,P.white);rect(ctx,9,12,2,1,P.ink);
  }else if(type==='place')furniture(ctx,key);
  else if(type==='potion'||key.includes('salve')){
    const col=key.includes('heat')?P.teal:P.red;rect(ctx,6,2,4,2,P.tan);rect(ctx,7,4,2,3,P.stone);pixelEllipse(ctx,8,10,4,4,P.ink);pixelEllipse(ctx,8,10,3,3,col);rect(ctx,6,8,1,3,P.white);
  }else if(type==='seed'||key.includes('spore')){
    rect(ctx,4,6,8,8,P.wood);rect(ctx,5,7,6,6,P.tan);rect(ctx,6,4,4,3,P.wood);rect(ctx,5,5,6,1,P.gold);rect(ctx,7,8,1,4,P.green);rect(ctx,8,8,2,2,P.lightgreen);
  }else if(['food','fish','crop'].includes(type)||key==='glowcap')food(ctx,key);
  else if(key==='capwood'){
    for(const [x,y]of[[5,7],[9,10]]){rect(ctx,x,y-3,6,5,P.wood);rect(ctx,x,y-3,6,1,P.tan);pixelEllipse(ctx,x,y,3,3,P.ink);pixelEllipse(ctx,x,y,2,2,P.tan);rect(ctx,x,y,1,1,P.wood);}
  }else if(key==='fiber'){
    for(const x of[4,7,10])line(ctx,x,4,1,1,7,P.green);rect(ctx,6,9,5,2,P.tan);rect(ctx,9,3,2,3,P.lightgreen);
  }else if(key.includes('ingot')||key==='emberite'){
    const col=key==='emberite'?P.red:P.copper;rect(ctx,3,7,11,5,P.ink);rect(ctx,4,5,8,5,col);rect(ctx,5,5,6,1,P.gold);rect(ctx,3,10,11,2,col);
  }else if(key==='gel'){
    pixelEllipse(ctx,8,9,5,4,P.dark);pixelEllipse(ctx,8,8,4,3,P.teal);rect(ctx,6,6,2,1,P.white);
  }else rock(ctx,key.includes('crystal')?P.teal:key.includes('copper')?P.copper:key.includes('ember')?P.red:key==='coal'||key==='obsidian'?P.dark:key==='loam'?P.wood:key==='chitin'?P.tan:P.stone);
  const url=c.toDataURL('image/png');this.canvases.set(key,c);this.cache.set(key,url);return url;
 }
}
