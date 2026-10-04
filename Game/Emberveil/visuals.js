/** 原画素材の読み込みと、継ぎ目の目立たない独自ドット地形。 */
export const TILE = 24;
export const PALETTES = [
  {base:'#243b36', dark:'#1b2d2b', fleck:'#3d5444', moss:'#496044', wall:'#465043', face:'#303c35', light:'#66745b', water:'#133b40', glow:'#77edc6'},
  {base:'#282f43', dark:'#202538', fleck:'#44485b', moss:'#55506b', wall:'#4b4a61', face:'#303047', light:'#797589', water:'#222d4e', glow:'#a58aff'},
  {base:'#3a302b', dark:'#2b2527', fleck:'#57433b', moss:'#725139', wall:'#54443b', face:'#3b2c2a', light:'#92705a', water:'#542b28', glow:'#ffa45d'}
];
export function hash(x,y,s=0) { let n=Math.imul(x+17,374761393)^Math.imul(y+13,668265263)^s; n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296; }
export function canvas(w,h) { const c=document.createElement('canvas'); c.width=w;c.height=h;return c; }
export class VisualAssets {
  constructor(){this.images=new Map();this.tiles=[];this.atlas=null;this.frames={};}
  async load(){
    const response=await fetch(new URL('./assets/pixel-atlas.json',import.meta.url));if(!response.ok)throw new Error('庭園の素材定義を読み込めません');
    this.frames=(await response.json()).sprites;
    const names=['knight_m','elf_f','elf_m','lizard_m','tiny_zombie','skelet','orc_warrior','chort','big_zombie','ogre','big_demon'];
    const files=[];
    for(const n of names)for(const action of ['idle','run'])for(let i=0;i<4;i++) files.push(`${n}_${action}_anim_f${i}.png`);
    files.push('weapon_rusty_sword.png','weapon_regular_sword.png','weapon_golden_sword.png','weapon_red_gem_sword.png','weapon_axe.png','weapon_hammer.png','weapon_bow.png','flask_red.png','flask_blue.png','coin_anim_f0.png','crate.png','column.png','floor_1.png','floor_2.png');
    const load=(url)=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`素材が読み込めません: ${url}`));img.src=url;});
    this.atlas=await load(new URL('./assets/pixel-atlas.png',import.meta.url));
    const packed=await fetch(new URL('./assets/dungeon-atlas.json',import.meta.url));
    if(!packed.ok)throw new Error('キャラクターの素材定義を読み込めません');
    const frameData=(await packed.json()).sprites;
    const sheet=await load(new URL('./assets/dungeon-atlas.png',import.meta.url));
    for(const name of files){
      const f=frameData[name];if(!f)throw new Error(`原画フレームがありません: ${name}`);
      const c=canvas(f[2],f[3]),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
      ctx.drawImage(sheet,...f,0,0,f[2],f[3]);this.images.set(name,c);
    }
    this.makeTerrain();
  }
  makeTerrain(){
    for(let biome=0;biome<3;biome++){
      const pal=PALETTES[biome];this.tiles[biome]=[];
      for(let variant=0;variant<16;variant++){
        const c=canvas(TILE,TILE),ctx=c.getContext('2d');ctx.fillStyle=pal.base;ctx.fillRect(0,0,TILE,TILE);
        for(let i=0;i<47;i++){
          const x=Math.floor(hash(i,variant,biome)*TILE),y=Math.floor(hash(variant,i,biome+4)*TILE);
          ctx.fillStyle=i%3===0?pal.dark:pal.fleck;ctx.globalAlpha=i%3===0?.4:.24;
          ctx.fillRect(x,y,1+(i%4===0?2:0),1);
        }
        ctx.globalAlpha=1;
        if(variant%3===0){
          const x=4+variant%13,y=5+(variant*7)%15;ctx.globalAlpha=.4;ctx.fillStyle=pal.dark;
          ctx.fillRect(x,y,5,2);ctx.fillRect(x+2,y+2,3,1);ctx.fillStyle=pal.fleck;ctx.fillRect(x,y,4,1);ctx.globalAlpha=1;
        }
        this.tiles[biome].push(c);
      }
    }
  }
  image(name){return this.images.get(name);}
  garden(ctx,name,x,y,width,alpha=1){
    const f=this.frames[name];if(!f)return false;
    const scale=Math.max(1,Math.round((width||f[2])/f[2])),w=f[2]*scale,height=f[3]*scale;
    ctx.save();ctx.globalAlpha*=alpha;ctx.drawImage(this.atlas,...f,Math.round(x-w/2),Math.round(y-height),w,height);ctx.restore();return true;
  }
  character(ctx,name,action,frame,x,y,scale=1,flip=false,alpha=1){
    const img=this.images.get(`${name}_${action}_anim_f${frame%4}.png`)||this.images.get(`${name}_idle_anim_f0.png`);if(!img)return false;
    ctx.save();ctx.translate(Math.round(x),Math.round(y));if(flip)ctx.scale(-1,1);ctx.globalAlpha*=alpha;
    ctx.drawImage(img,Math.round(-img.width*scale/2),Math.round(-img.height*scale),Math.round(img.width*scale),Math.round(img.height*scale));ctx.restore();return true;
  }
}
