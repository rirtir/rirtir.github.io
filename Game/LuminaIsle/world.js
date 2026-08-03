(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  const W=72,H=72,TILE=16;
  const TILE_ID={sea:0,shallow:1,sand:2,grass:3,forest:4,rock:5,path:6};
  const TILE_NAME=["sea","shallow","sand","grass","forest","rock_ground","path"];
  class RNG{
    constructor(seed){this.state=seed>>>0||0x6d2b79f5;}
    next(){let x=this.state;x^=x<<13;x^=x>>>17;x^=x<<5;this.state=x>>>0;return this.state/4294967296;}
    int(min,max){return min+Math.floor(this.next()*(max-min+1));}
    pick(array){return array[Math.floor(this.next()*array.length)];}
  }
  function cellNoise(x,y,seed){
    let h=Math.imul(x+11,374761393)^Math.imul(y+37,668265263)^seed;h=(h^(h>>>13))*1274126177;return ((h^(h>>>16))>>>0)/4294967295;
  }
  function resourceDef(type,x,y,id){
    const defs={branch:[1,0,"hand",1],fiber:[1,0,"hand",1],berry_bush:[2,0,"hand",2],tree:[4,3,"axe",3],rock:[3,3,"pickaxe",3],ore:[4,4,"pickaxe",4],crystal:[5,5,"pickaxe",5],shell:[1,0,"hand",1]};
    const d=defs[type];return{id,type,x:(x+.5)*TILE,y:(y+.68)*TILE,hp:d[0],maxHp:d[0],tool:d[2],respawn:d[3],sortY:(y+1)*TILE};
  }
  function generate(state){
    const seed=state.seed>>>0,rng=new RNG(seed),tiles=new Uint8Array(W*H),biomes=new Array(W*H);
    const idx=(x,y)=>y*W+x;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const dx=(x-35.5)/31,dy=(y-35)/33;
      const n=(cellNoise(Math.floor(x/4),Math.floor(y/4),seed)-.5)*.085+(cellNoise(x,y,seed^0x9e3779b9)-.5)*.025;
      const dist=Math.sqrt(dx*dx+dy*dy)+n;let type="grass",biome="grass";
      if(dist>1){type="sea";biome="sea";}
      else if(dist>.92){type="shallow";biome="beach";}
      else if(dist>.82){type="sand";biome="beach";}
      else if(x<33&&y<39&&dist>.28){type="forest";biome="forest";}
      else if(x>41&&y<37){type="rock";biome="rock";}
      if((Math.abs(x-36)<=1&&y>=41&&y<=55)||(Math.abs(y-43)<=1&&x>=18&&x<=55)){type="path";biome="grass";}
      tiles[idx(x,y)]=TILE_ID[type];biomes[idx(x,y)]=biome;
    }
    // Safe clearings and fixed objective sites.
    const clear=(cx,cy,r,type="grass",biome="grass")=>{for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if(x>=0&&y>=0&&x<W&&y<H&&Math.hypot(x-cx,y-cy)<=r+.2){tiles[idx(x,y)]=TILE_ID[type];biomes[idx(x,y)]=biome;}};
    clear(36,54,5);clear(36,43,4);clear(18,23,3,"forest","forest");clear(16,50,3,"sand","beach");clear(55,22,4,"rock","rock");

    const resources=[];let rid=0;
    const add=(type,x,y)=>resources.push(resourceDef(type,x,y,`r${rid++}`));
    for(let y=3;y<H-3;y++)for(let x=3;x<W-3;x++){
      if(Math.hypot(x-36,y-54)<6||Math.hypot(x-36,y-43)<4||Math.hypot(x-18,y-23)<3||Math.hypot(x-16,y-50)<3||Math.hypot(x-55,y-22)<4)continue;
      const type=TILE_NAME[tiles[idx(x,y)]],r=rng.next();
      if(type==="grass"||type==="path"){
        if(r<.018)add("tree",x,y);else if(r<.052)add("fiber",x,y);else if(r<.082)add("branch",x,y);else if(r<.098)add("berry_bush",x,y);
      }else if(type==="forest"){
        if(r<.065)add("tree",x,y);else if(r<.088)add("branch",x,y);else if(r<.11)add("fiber",x,y);else if(r<.132)add("berry_bush",x,y);
      }else if(type==="sand"){
        if(r<.042)add("shell",x,y);else if(r<.05)add("branch",x,y);
      }else if(type==="rock_ground"){
        if(r<.055)add("rock",x,y);else if(r<.08)add("ore",x,y);else if(r<.09)add("crystal",x,y);
      }
    }
    [["branch",34,54],["branch",37,53],["branch",34,51],["stone",38,54],["stone",39,52],["stone",34,49],["berry_bush",32,54]].forEach(([type,x,y])=>add(type==="stone"?"rock":type,x,y));
    if(resources.length>350){const guaranteed=resources.slice(-7);resources.length=343;resources.push(...guaranteed);}

    const landmarks=[
      {id:"lighthouse",type:"lighthouse",name:"古い灯台",x:36.5*TILE,y:43.8*TILE,sortY:46*TILE},
      {id:"forest_altar",type:"altar",region:"forest",name:"こもれびの祠",x:18.5*TILE,y:23.5*TILE,sortY:25*TILE},
      {id:"tide_altar",type:"altar",region:"tide",name:"潮の祭壇",x:16.5*TILE,y:50.5*TILE,sortY:52*TILE},
      {id:"rock_altar",type:"altar",region:"rock",name:"石の庭",x:55.5*TILE,y:22.5*TILE,sortY:24*TILE},
      {id:"wind_0",type:"windstone",index:0,name:"風車石",x:49.5*TILE,y:25.5*TILE,sortY:27*TILE},
      {id:"wind_1",type:"windstone",index:1,name:"風車石",x:57.5*TILE,y:28.5*TILE,sortY:30*TILE},
      {id:"wind_2",type:"windstone",index:2,name:"風車石",x:61.5*TILE,y:18.5*TILE,sortY:20*TILE},
      {id:"well_old",type:"well",name:"古い井戸",x:29.5*TILE,y:47.5*TILE,sortY:49*TILE},
    ];
    const enemies=[];let eid=0;
    const enemy=(type,x,y)=>enemies.push({id:`e${eid++}`,type,x:(x+.5)*TILE,y:(y+.5)*TILE,homeX:(x+.5)*TILE,homeY:(y+.5)*TILE,hp:LI.DATA.enemies[type].hp,maxHp:LI.DATA.enemies[type].hp,state:"idle",timer:rng.next()*2,attackTimer:0,deadUntil:0,hitFlash:0,angle:rng.next()*Math.PI*2});
    for(let i=0;i<5;i++)enemy("slime",rng.int(25,45),rng.int(46,61));
    for(let i=0;i<5;i++)enemy("thorn",rng.int(9,29),rng.int(12,35));
    for(let i=0;i<4;i++)enemy("crab",rng.int(8,27),rng.int(45,59));
    for(let i=0;i<5;i++)enemy("rockling",rng.int(46,63),rng.int(10,35));
    if(!state.progress.prisms.forest)enemy("forest_warden",18,20);
    if(!state.progress.prisms.rock)enemy("stone_warden",55,19);
    return{width:W,height:H,tileSize:TILE,tiles,biomes,resources,landmarks,enemies,seed,rng,day:state.day};
  }
  function tileAt(world,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);if(tx<0||ty<0||tx>=W||ty>=H)return TILE_ID.sea;return world.tiles[ty*W+tx];}
  function biomeAt(world,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);if(tx<0||ty<0||tx>=W||ty>=H)return"sea";return world.biomes[ty*W+tx];}
  function buildingAt(state,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);return state.buildings.find(b=>tx>=b.x&&ty>=b.y&&tx<b.x+b.w&&ty<b.y+b.h);}
  function passable(world,state,x,y){
    const tile=tileAt(world,x,y),b=buildingAt(state,x,y);
    if(b&&LI.DATA.buildings[b.type]?.solid!==false)return false;
    if(tile===TILE_ID.sea)return false;
    if(tile===TILE_ID.shallow){return !!state.buildings.find(o=>o.type==="bridge"&&Math.floor(x/TILE)===o.x&&Math.floor(y/TILE)===o.y);}
    return true;
  }
  function activeResource(state,r){return !(state.removedResources[r.id]>state.day);}
  function nearby(world,state,x,y,radius,collection="resources"){
    return world[collection].filter(o=>collection!=="resources"||activeResource(state,o)).map(o=>({o,d:Math.hypot(o.x-x,o.y-y)})).filter(v=>v.d<=radius).sort((a,b)=>a.d-b.d);
  }
  function explore(state,x,y){
    const mx=Math.max(0,Math.min(17,Math.floor(x/(W*TILE)*18))),my=Math.max(0,Math.min(17,Math.floor(y/(H*TILE)*18)));
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const nx=mx+ox,ny=my+oy;if(nx>=0&&ny>=0&&nx<18&&ny<18)state.explored[ny*18+nx]=1;}
  }
  LI.World={W,H,TILE,TILE_ID,TILE_NAME,RNG,generate,tileAt,biomeAt,buildingAt,passable,activeResource,nearby,explore};
})();
