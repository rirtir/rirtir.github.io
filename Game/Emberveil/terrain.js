/** 地下庭園の24ドット地形。線・矩形はすべて整数座標。 */
import {TILE,PALETTES,hash} from './visuals.js';

// 自然の硬さ、設置した素材、通れない封印を色と輪郭で識別する。
const WALL_COLORS={
  loam_wall:['#634a3b','#463334','#8b6746'],
  hard_rock:['#44485b','#202538','#797589'],
  burnt_rock:['#57433b','#3b2c2a','#92705a'],
  obsidian_rock:['#202538','#141c2c','#714b80'],
  bedrock:['#141c2c','#090f19','#354954'],
  seal_stone:['#4b6166','#253641','#70847d'],
  gate_crystal:['#44485b','#202538','#a46d9c'],
  gate_ember:['#57433b','#3b2c2a','#d36737'],
  arena_barrier:['#253641','#141c2c','#49af9d'],
  wall_wood:['#634a3b','#463334','#b39158'],
  wall_stone:['#4b6166','#354954','#70847d'],
  wall_brick:['#924331','#463334','#d36737'],
  wall_gold:['#4b6166','#354954','#e8b35b']
};

export class TerrainArt {
  constructor(assets){this.assets=assets;}
  draw(ctx,kind,biome,tx,ty,x,y,time,neighbors={},ground='moss_floor',build=null){
    x=Math.round(x);y=Math.round(y);biome=Math.max(0,Math.min(2,biome||0));
    const p=PALETTES[biome],variant=Math.floor(hash(tx,ty)*16);
    if(kind==='void'||kind==='chasm'){
      ctx.fillStyle='#090f19';ctx.fillRect(x,y,TILE,TILE);
      if(kind==='chasm')for(const [side,n] of Object.entries(neighbors))if(n&&n!==kind&&n!=='wall'){
        ctx.fillStyle=p.face;
        if(side==='n')ctx.fillRect(x,y,TILE,3);if(side==='s')ctx.fillRect(x,y+TILE-3,TILE,3);
        if(side==='w')ctx.fillRect(x,y,3,TILE);if(side==='e')ctx.fillRect(x+TILE-3,y,3,TILE);
      }
      return;
    }
    if(kind==='water'||kind==='lava'){
      const lava=kind==='lava',hot=ground==='hot_spring';ctx.fillStyle=lava?'#4f2a36':hot?'#267d80':p.water;ctx.fillRect(x,y,TILE,TILE);
      for(let i=0;i<4;i++){
        const cy=(Math.floor(hash(tx,ty,i+11)*TILE+time*(lava?1:2))+i*5)%TILE;
        const cx=Math.floor(hash(tx,ty,i+30)*18),width=3+Math.floor(hash(tx,ty,i+20)*8);
        ctx.fillStyle=lava?(i%2?'#924331':'#d36737'):hot?(i%2?'#49af9d':'#70847d'):(i%2?'#1e5360':'#267d80');
        ctx.fillRect(x+cx,y+cy,width,1);
        if(hash(tx,ty,i+70)>.93){ctx.fillStyle=lava?'#ffd275':'#82ddbd';ctx.fillRect(x+cx+2,y+cy,2,1);}
      }
      for(const [side,n] of Object.entries(neighbors))if(n&&n!==kind&&n!=='wall'){
        ctx.fillStyle=lava?'#996139':'#4b6166';
        if(side==='n')ctx.fillRect(x,y,TILE,2);if(side==='s')ctx.fillRect(x,y+TILE-2,TILE,2);
        if(side==='w')ctx.fillRect(x,y,2,TILE);if(side==='e')ctx.fillRect(x+TILE-2,y,2,TILE);
      }
      return;
    }
    ctx.drawImage(this.assets.tiles[biome][variant],x,y);
    if(kind==='bridge'&&build==='bridge_stone'){
      ctx.fillStyle='#253641';ctx.fillRect(x,y,TILE,TILE);
      for(let i=0;i<3;i++){
        ctx.fillStyle='#4b6166';ctx.fillRect(x+2,y+i*8+1,20,6);
        ctx.fillStyle='#70847d';ctx.fillRect(x+3,y+i*8+1,18,1);
        ctx.fillStyle='#354954';ctx.fillRect(x+11+(i%2)*3,y+i*8+2,1,5);
      }
      ctx.fillStyle='#70847d';ctx.fillRect(x,y,1,TILE);ctx.fillRect(x+23,y,1,TILE);
    }else if(kind==='bridge'||kind==='woodfloor'){
      ctx.fillStyle='#2b272e';ctx.fillRect(x,y,TILE,TILE);
      for(let i=0;i<4;i++){
        ctx.fillStyle=i%2?'#634a3b':'#463334';ctx.fillRect(x+1,y+i*6+1,22,4);
        ctx.fillStyle='#8b6746';ctx.fillRect(x+1,y+i*6+1,22,1);
        ctx.fillStyle='#b39158';ctx.fillRect(x+3,y+i*6+3,1,1);ctx.fillRect(x+20,y+i*6+3,1,1);
      }
    }else if(kind==='stonefloor'&&build==='floor_crystal'){
      ctx.fillStyle='#303047';ctx.fillRect(x,y,TILE,TILE);
      ctx.fillStyle='#4b4a61';ctx.fillRect(x+1,y+1,22,22);
      ctx.fillStyle='#797589';ctx.fillRect(x+2,y+2,20,1);ctx.fillRect(x+2,y+2,1,20);
      ctx.fillStyle='#714b80';ctx.fillRect(x+11,y+3,2,18);ctx.fillRect(x+3,y+11,18,2);
      ctx.fillStyle='#49af9d';ctx.fillRect(x+9,y+10,6,4);ctx.fillRect(x+10,y+9,4,6);
      ctx.fillStyle='#ceeed2';ctx.fillRect(x+10,y+10,2,1);
    }else if(kind==='stonefloor'&&build==='floor_brick'){
      ctx.fillStyle='#463334';ctx.fillRect(x,y,TILE,TILE);
      for(let row=0;row<4;row++)for(let col=-1;col<3;col++){
        const bx=col*8+(row%2)*4,left=Math.max(0,bx),width=Math.min(24,bx+7)-left;
        if(width<=0)continue;
        ctx.fillStyle=(row+col)%2?'#924331':'#634a3b';ctx.fillRect(x+left,y+row*6+1,width,4);
        ctx.fillStyle='#996139';ctx.fillRect(x+left,y+row*6+1,width,1);
      }
    }else if(kind==='stonefloor'||['stone_floor','ruin_floor','shrine_floor'].includes(ground)){
      ctx.fillStyle='#354954';ctx.fillRect(x,y,TILE,TILE);ctx.fillStyle='#253641';
      ctx.fillRect(x,y+11,TILE,1);ctx.fillRect(x+variant%2*12,y,1,12);ctx.fillRect(x+12-variant%2*12,y+12,1,12);
      ctx.fillStyle='#4b6166';ctx.fillRect(x+1,y+1,10,1);ctx.fillRect(x+1,y+13,21,1);
      if(ground==='shrine_floor'){
        ctx.fillStyle='#70847d';ctx.fillRect(x+2,y+2,8,1);ctx.fillRect(x+2,y+14,20,1);
        if((tx+ty)%4===0){ctx.fillStyle='#b39158';ctx.fillRect(x+9,y+7,5,1);ctx.fillRect(x+11,y+5,1,5);}
      }
      if(build==='floor_gold'){
        ctx.fillStyle='#996139';ctx.fillRect(x,y,TILE,2);ctx.fillRect(x,y,2,TILE);
        ctx.fillStyle='#e8b35b';ctx.fillRect(x+1,y+1,TILE-1,1);ctx.fillRect(x+1,y+1,1,TILE-1);
        ctx.fillStyle='#ffd275';ctx.fillRect(x+10,y+10,4,1);ctx.fillRect(x+11,y+9,1,4);
      }
    }else if(kind==='farm'){
      ctx.fillStyle='#463334';ctx.fillRect(x+1,y+1,22,22);
      for(let i=0;i<4;i++){ctx.fillStyle='#2b272e';ctx.fillRect(x+3,y+4+i*5,18,2);ctx.fillStyle='#634a3b';ctx.fillRect(x+3,y+3+i*5,18,1);}
    }else{
      if(ground==='loam_floor'){
        ctx.fillStyle='#3a302b';ctx.fillRect(x,y,TILE,TILE);
        for(let i=0;i<12;i++){ctx.fillStyle=i%3?'#463334':'#634a3b';ctx.fillRect(x+Math.floor(hash(tx,ty,i+43)*23),y+Math.floor(hash(ty,tx,i+31)*23),2,1);}
      }
      if(ground==='vent'){
        ctx.fillStyle='#141c2c';ctx.fillRect(x+6,y+7,13,11);ctx.fillStyle='#924331';ctx.fillRect(x+8,y+8,9,7);ctx.fillStyle='#d36737';ctx.fillRect(x+9,y+9,7,1);ctx.fillRect(x+10,y+12,4,1);
      }
      // 大きい苔の群れはタイルごとに閉じず世界座標の波で連続させる。
      const wet=Math.sin(tx*.33+ty*.21)+Math.sin(ty*.47-tx*.14);
      if(wet>.7&&biome===0){
        for(let i=0;i<5;i++){
          const lx=Math.floor(hash(tx,ty,i+9)*21),ly=Math.floor(hash(ty,tx,i+80)*21);
          ctx.fillStyle=i%2?'#294b40':'#3c6548';ctx.fillRect(x+lx,y+ly,3,2);ctx.fillStyle='#588552';ctx.fillRect(x+lx+1,y+ly,2,1);
        }
      }
      if(hash(tx,ty,998)>.96){
        const lx=3+Math.floor(hash(tx,ty,67)*16),ly=3+Math.floor(hash(tx,ty,24)*16);
        ctx.fillStyle=biome===0?'#294b40':p.fleck;ctx.fillRect(x+lx,y+ly,1,6);
        ctx.fillRect(x+lx-2,y+ly+2,2,1);ctx.fillRect(x+lx+1,y+ly+3,2,1);
        ctx.fillStyle=biome===0?'#82ddbd':p.glow;ctx.fillRect(x+lx-1,y+ly-1,3,2);
      }
    }
  }
  wall(ctx,biome,tx,ty,x,y,front=false,ore=null,material=null){
    let p=PALETTES[biome||0];const colors=WALL_COLORS[material];
    if(colors)p={...p,wall:colors[0],face:colors[1],light:colors[2]};
    x=Math.round(x);y=Math.round(y);
    if(material==='wall_glass'){
      // 透ける床を残し、枠・反射だけをnativeの矩形で描く。
      ctx.drawImage(this.assets.tiles[biome||0][Math.floor(hash(tx,ty)*16)],x,y);
      ctx.fillStyle='rgba(73,175,157,.2)';ctx.fillRect(x+1,y-7,22,29);
      ctx.fillStyle='#267d80';ctx.fillRect(x,y-8,1,32);ctx.fillRect(x+23,y-8,1,32);ctx.fillRect(x,y+23,24,1);
      ctx.fillStyle='#82ddbd';ctx.fillRect(x,y-8,24,1);ctx.fillRect(x+11,y-7,1,30);
      ctx.fillStyle='#ceeed2';
      for(let i=0;i<5;i++){ctx.fillRect(x+4+i,y-3+i,1,2);ctx.fillRect(x+15+i,y+7+i,1,2);}
      return;
    }
    ctx.fillStyle=p.wall;ctx.fillRect(x,y-8,TILE,TILE+8);
    ctx.fillStyle=p.light;ctx.fillRect(x,y-8,TILE,1);
    ctx.fillStyle=p.face;ctx.fillRect(x,y+14,TILE,10);
    ctx.fillStyle='#141c2c';ctx.fillRect(x,y+23,TILE,1);
    for(let i=0;i<7;i++){
      const rx=Math.floor(hash(tx,ty,i+41)*20),ry=Math.floor(hash(ty,tx,i+68)*18)-6;
      ctx.fillStyle=i%2?p.light:p.face;ctx.fillRect(x+rx,y+ry,3+i%3,1);
    }
    ctx.fillStyle=p.face;ctx.fillRect(x+Math.floor(hash(tx,ty,66)*12)+5,y-5,1,14);
    if(front){ctx.fillStyle=p.light;ctx.fillRect(x+1,y+14,TILE-2,1);ctx.fillStyle=p.wall;ctx.fillRect(x+2,y+17,TILE-4,1);}
    if(material==='wall_wood'){
      for(let i=1;i<4;i++){
        ctx.fillStyle='#463334';ctx.fillRect(x+i*6,y-7,1,30);
        ctx.fillStyle='#8b6746';ctx.fillRect(x+i*6+1,y-7,1,20);
      }
      ctx.fillStyle='#253641';ctx.fillRect(x,y+9,24,3);ctx.fillStyle='#b39158';ctx.fillRect(x+3,y+10,1,1);ctx.fillRect(x+20,y+10,1,1);
    }else if(material==='wall_brick'||material==='wall_stone'||material==='wall_gold'){
      for(let row=0;row<5;row++){
        ctx.fillStyle=p.face;ctx.fillRect(x,y-5+row*6,24,1);
        ctx.fillRect(x+6+(row%2)*10,y-5+row*6,1,Math.min(6,29-row*6));
      }
      if(material==='wall_gold'){
        ctx.fillStyle='#e8b35b';ctx.fillRect(x,y-8,24,2);ctx.fillRect(x,y+13,24,2);ctx.fillRect(x+2,y-6,1,19);ctx.fillRect(x+21,y-6,1,19);
        ctx.fillStyle='#ffd275';ctx.fillRect(x+1,y-8,22,1);
      }
    }
    if(material==='coal_vein'){
      for(let i=0;i<5;i++){
        const rx=3+Math.floor(hash(tx,ty,i+126)*15),ry=-3+Math.floor(hash(ty,tx,i+145)*14);
        ctx.fillStyle='#141c2c';ctx.fillRect(x+rx,y+ry,5,3);ctx.fillRect(x+rx+1,y+ry-1,3,1);
        ctx.fillStyle='#4b6166';ctx.fillRect(x+rx+1,y+ry,2,1);
      }
    }
    if(material==='obsidian_rock'){
      ctx.fillStyle='#714b80';ctx.fillRect(x+4,y-4,1,12);ctx.fillRect(x+5,y+6,5,1);ctx.fillRect(x+15,y-2,1,10);
      ctx.fillStyle='#a46d9c';ctx.fillRect(x+4,y-4,1,3);ctx.fillRect(x+15,y-2,1,2);
    }else if(material==='hard_rock'||material==='bedrock'){
      ctx.fillStyle=p.face;ctx.fillRect(x+2,y+3,19,2);ctx.fillRect(x+6,y-6,2,17);
    }
    if(['seal_stone','gate_crystal','gate_ember','arena_barrier'].includes(material)){
      const rune=material==='gate_ember'?'#f99a49':material==='gate_crystal'?'#a46d9c':material==='arena_barrier'?'#82ddbd':'#b39158';
      ctx.fillStyle=p.face;ctx.fillRect(x+5,y-4,14,17);
      ctx.fillStyle=rune;
      ctx.fillRect(x+10,y-3,4,2);ctx.fillRect(x+8,y-1,2,3);ctx.fillRect(x+14,y-1,2,3);
      ctx.fillRect(x+6,y+2,2,3);ctx.fillRect(x+16,y+2,2,3);
      ctx.fillRect(x+8,y+5,2,3);ctx.fillRect(x+14,y+5,2,3);ctx.fillRect(x+10,y+8,4,2);
      ctx.fillRect(x+11,y+1,2,6);
      if(material==='arena_barrier'){
        ctx.fillStyle='#267d80';ctx.fillRect(x+1,y-6,1,28);ctx.fillRect(x+22,y-6,1,28);
        ctx.fillStyle='#82ddbd';ctx.fillRect(x+1,y-6,1,4);ctx.fillRect(x+22,y+18,1,4);
      }
    }
    if(ore){
      const colors=ore==='copper'?['#996139','#e8b35b']:ore==='crystal'?['#267d80','#82ddbd']:['#924331','#f99a49'];
      for(let i=0;i<4;i++){const rx=4+Math.floor(hash(tx,ty,i+8)*15),ry=-3+Math.floor(hash(ty,tx,i+99)*14);
        ctx.fillStyle=colors[0];ctx.fillRect(x+rx,y+ry,4,3);ctx.fillStyle=colors[1];ctx.fillRect(x+rx+1,y+ry,2,1);}
    }
  }
}
