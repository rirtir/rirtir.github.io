(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  const W=128,H=128,TILE=16,FOG_COLS=32,FOG_ROWS=32;
  // 旧版と開始地点を共有し、既存セーブの建築物をそのまま残せるよう東・南へ島を拡張する。
  const START={x:36.5*TILE,y:54.5*TILE,enemyClearRadius:10*TILE};
  const TILE_ID={sea:0,shallow:1,sand:2,grass:3,forest:4,rock:5,path:6};
  const TILE_NAME=["sea","shallow","sand","grass","forest","rock_ground","path"];
  const ZONE_NAMES={
    old_meadow:"灯台の草原",whisper_forest:"ささやきの森",amber_grove:"琥珀樹林",
    north_coast:"白波の浜",tideflats:"星潮干潟",old_quarry:"風鳴り採石地",
    crystal_ridge:"光晶尾根",moon_meadow:"月見草原",sunreach:"陽だまり岬"
  };
  class RNG{
    constructor(seed){this.state=seed>>>0||0x6d2b79f5;}
    next(){let x=this.state;x^=x<<13;x^=x>>>17;x^=x<<5;this.state=x>>>0;return this.state/4294967296;}
    int(min,max){return min+Math.floor(this.next()*(max-min+1));}
    pick(array){return array[Math.floor(this.next()*array.length)];}
  }
  function cellNoise(x,y,seed){
    let h=Math.imul(x+11,374761393)^Math.imul(y+37,668265263)^seed;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
  }
  function distanceToSegment(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/length)):0;
    return Math.hypot(px-(ax+dx*t),py-(ay+dy*t));
  }
  function nearTrail(x,y,points,width=1.05){
    for(let i=1;i<points.length;i++)if(distanceToSegment(x,y,...points[i-1],...points[i])<=width)return true;
    return false;
  }
  function zoneFor(x,y,biome){
    if(biome==="forest")return x<31+Math.sin(y*.17)*6&&y<54+Math.sin(x*.13)*7?"whisper_forest":"amber_grove";
    if(biome==="rock")return x>90+Math.sin(y*.14)*7?"crystal_ridge":"old_quarry";
    if(biome==="beach")return y>79+Math.sin(x*.15)*7?"tideflats":"north_coast";
    if(biome==="grass")return y>85+Math.sin(x*.12)*8?"sunreach":x>63+Math.sin(y*.13)*9?"moon_meadow":"old_meadow";
    return"sea";
  }
  function resourceDef(type,x,y,seed){
    const defs={
      branch:[1,"hand",1],fiber:[1,"hand",1],berry_bush:[2,"hand",2],tree:[4,"axe",3],
      rock:[3,"pickaxe",3],ore:[4,"pickaxe",4],crystal:[5,"pickaxe",5],shell:[1,"hand",1],
      herb:[1,"hand",2],resin:[1,"hand",3],stump:[4,"axe",5],sunroot:[1,"hand",3],
      moonbean:[1,"hand",4],tide_melon:[2,"hand",4]
    };
    const d=defs[type],visual=cellNoise(x,y,seed^0x85ebca6b);
    return{id:`r:${type}:${x}:${y}`,type,x:(x+.5)*TILE,y:(y+.68)*TILE,hp:d[0],maxHp:d[0],tool:d[1],respawn:d[2],
      variant:Math.floor(visual*4),scale:.88+visual*.22,flip:visual>.5,sortY:(y+1)*TILE};
  }
  function generate(state){
    const seed=state.seed>>>0,rng=new RNG(seed),tiles=new Uint8Array(W*H),biomes=new Array(W*H),zones=new Array(W*H);
    const idx=(x,y)=>y*W+x;
    const trails=[
      [[36,54],[34,50],[37,46],[36,43]],[[36,43],[31,39],[25,32],[18,23]],
      [[36,43],[29,46],[22,49],[16,50]],[[36,43],[43,39],[50,31],[55,22]],
      [[36,43],[53,48],[72,58],[88,67],[103,73]],[[36,43],[39,61],[48,82],[58,106]]
    ];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const old=Math.hypot((x-35.5)/31,(y-35)/33);
      const east=Math.hypot((x-86)/38,(y-58)/45);
      const south=Math.hypot((x-55)/46,(y-96)/31);
      const broad=(cellNoise(Math.floor(x/6),Math.floor(y/6),seed)-.5)*.075;
      const fine=(cellNoise(x,y,seed^0x9e3779b9)-.5)*.024;
      const dist=Math.min(old,east,south)+broad+fine;let type="grass",biome="grass";
      if(dist>1){type="sea";biome="sea";}
      else if(dist>.93){type="shallow";biome="beach";}
      else if(dist>.84){type="sand";biome="beach";}
      else{
        const regionNoise=cellNoise(Math.floor(x/9),Math.floor(y/9),seed^0x27d4eb2d);
        const oldForest=x<33&&y<39&&old>.28;
        const westForest=x<55&&y<82&&regionNoise>.36&&(x<32||y<63);
        const oldRock=x>41&&y<37;
        const ridgeEdge=70+Math.sin(y*.12)*7+(regionNoise-.5)*18;
        const eastRock=x>ridgeEdge&&y<87;
        if(oldForest||westForest){type="forest";biome="forest";}
        else if(oldRock||eastRock){type="rock";biome="rock";}
      }
      if(!["sea","shallow","sand"].includes(type)&&trails.some(path=>nearTrail(x,y,path))){type="path";biome="grass";}
      tiles[idx(x,y)]=TILE_ID[type];biomes[idx(x,y)]=biome;zones[idx(x,y)]=zoneFor(x,y,biome);
    }

    const clear=(cx,cy,r,type="grass",biome="grass")=>{for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if(x>=0&&y>=0&&x<W&&y<H&&Math.hypot(x-cx,y-cy)<=r+.2){tiles[idx(x,y)]=TILE_ID[type];biomes[idx(x,y)]=biome;zones[idx(x,y)]=zoneFor(x,y,biome);}};
    clear(36,54,5);clear(36,43,4);clear(18,23,3,"forest","forest");clear(16,50,3,"sand","beach");clear(55,22,4,"rock","rock");

    const relicPoints=[[29,44],[20,32],[17,55],[42,89],[76,68],[96,79],[111,35],[61,112]];
    const relicGround=[["grass","grass"],["forest","forest"],["sand","beach"],["grass","grass"],["grass","grass"],["rock","rock"],["rock","rock"],["grass","grass"]];
    const extraSites=[
      [23,88,2,"grass","grass"],[103,73,2,"grass","grass"],[58,106,2,"grass","grass"],[106,48,2,"rock","rock"],
      [16,105,2,"sand","beach"],[102,104,2,"sand","beach"],[113,27,2,"rock","rock"],[29,88,2,"forest","forest"]
    ];
    relicPoints.forEach(([x,y],i)=>clear(x,y,1,relicGround[i][0],relicGround[i][1]));
    extraSites.forEach(([x,y,r,type,biome])=>clear(x,y,r,type,biome));

    const landmarks=[
      {id:"guide_sign",type:"guide",name:"ヒナの旅立ち案内",x:36.5*TILE,y:51.5*TILE,sortY:53*TILE},
      {id:"lighthouse",type:"lighthouse",name:"古い灯台",x:36.5*TILE,y:43.8*TILE,sortY:46*TILE},
      {id:"forest_altar",type:"altar",region:"forest",name:"こもれびの祠",x:18.5*TILE,y:23.5*TILE,sortY:25*TILE},
      {id:"tide_altar",type:"altar",region:"tide",name:"潮の祭壇",x:16.5*TILE,y:50.5*TILE,sortY:52*TILE},
      {id:"rock_altar",type:"altar",region:"rock",name:"石の庭",x:55.5*TILE,y:22.5*TILE,sortY:24*TILE},
      {id:"wind_0",type:"windstone",index:0,name:"風車石",x:49.5*TILE,y:25.5*TILE,sortY:27*TILE},
      {id:"wind_1",type:"windstone",index:1,name:"風車石",x:57.5*TILE,y:28.5*TILE,sortY:30*TILE},
      {id:"wind_2",type:"windstone",index:2,name:"風車石",x:61.5*TILE,y:18.5*TILE,sortY:20*TILE},
      {id:"well_old",type:"well",name:"古い井戸",x:29.5*TILE,y:47.5*TILE,sortY:49*TILE},
      {id:"spring_west",type:"spring",name:"琥珀樹林の泉",x:23.5*TILE,y:88.5*TILE,sortY:90*TILE},
      {id:"spring_east",type:"spring",name:"尾根の湧き水",x:103.5*TILE,y:73.5*TILE,sortY:75*TILE},
      {id:"waymark_south",type:"waymark",name:"陽だまり岬の標石",x:58.5*TILE,y:106.5*TILE,sortY:108*TILE},
      {id:"waymark_east",type:"waymark",name:"光晶尾根の標石",x:106.5*TILE,y:48.5*TILE,sortY:50*TILE},
      {id:"cache_drift",type:"cache",name:"漂着した探検箱",reward:{rope:2,field_ration:1},x:16.5*TILE,y:105.5*TILE,sortY:107*TILE},
      {id:"cache_tide",type:"cache",name:"潮読みの小箱",reward:{shell:4,tide_seed:2},x:102.5*TILE,y:104.5*TILE,sortY:106*TILE},
      {id:"cache_miner",type:"cache",name:"採掘師の忘れ物",reward:{ore:5,crystal:2},x:113.5*TILE,y:27.5*TILE,sortY:29*TILE},
      {id:"cache_grove",type:"cache",name:"森守の隠し箱",reward:{resin:3,herb:3,moonbean_seed:2},x:29.5*TILE,y:88.5*TILE,sortY:90*TILE}
    ];
    relicPoints.forEach(([x,y],index)=>landmarks.push({id:`relic_${index}`,type:"relic",index,name:LI.DATA.relics[index].name,x:(x+.5)*TILE,y:(y+.65)*TILE,sortY:(y+1)*TILE}));

    const resources=[],occupied=new Set();
    const add=(type,x,y,force=false)=>{
      const key=`${x}:${y}`;if(occupied.has(key)||x<2||y<2||x>=W-2||y>=H-2)return false;
      const tile=tiles[idx(x,y)];if(!force&&(tile===TILE_ID.sea||tile===TILE_ID.shallow))return false;
      if(landmarks.some(l=>Math.hypot(l.x-(x+.5)*TILE,l.y-(y+.68)*TILE)<30))return false;
      occupied.add(key);resources.push(resourceDef(type,x,y,seed));return true;
    };
    for(let y=3;y<H-3;y++)for(let x=3;x<W-3;x++){
      if(Math.hypot((x+.5)*TILE-START.x,(y+.5)*TILE-START.y)<6*TILE)continue;
      const tile=TILE_NAME[tiles[idx(x,y)]],biome=biomes[idx(x,y)],zone=zones[idx(x,y)],r=rng.next();
      const cluster=cellNoise(Math.floor(x/5),Math.floor(y/5),seed^0xc2b2ae35);
      if(tile==="path"){
        if(r<.007)add("branch",x,y);else if(r<.014)add("herb",x,y);
      }else if(biome==="grass"){
        const lush=cluster>.56;
        if(r<(lush?.025:.007))add("tree",x,y);
        else if(r<(lush?.047:.024))add("fiber",x,y);
        else if(r<(lush?.064:.037))add("branch",x,y);
        else if(r<(lush?.081:.048))add("berry_bush",x,y);
        else if(r<(zone==="sunreach"?.103:.059))add("sunroot",x,y);
        else if(r<(zone==="moon_meadow"?.087:.067))add("moonbean",x,y);
        else if(r<.075)add("herb",x,y);
      }else if(biome==="forest"){
        const dense=cluster>.42;
        if(r<(dense?.115:.052))add("tree",x,y);
        else if(r<(dense?.138:.071))add("branch",x,y);
        else if(r<(dense?.158:.089))add("fiber",x,y);
        else if(r<(dense?.181:.108))add("berry_bush",x,y);
        else if(r<(dense?.201:.126))add("herb",x,y);
        else if(r<(dense?.214:.137))add("resin",x,y);
        else if(r<(dense?.224:.145))add("stump",x,y);
        else if(zone==="amber_grove"&&r<.235)add("moonbean",x,y);
      }else if(tile==="sand"){
        if(r<.035)add("shell",x,y);else if(r<.043)add("branch",x,y);else if(zone==="tideflats"&&r<.065)add("tide_melon",x,y);
      }else if(biome==="rock"){
        const rich=cluster>.52||zone==="crystal_ridge";
        if(r<(rich?.075:.043))add("rock",x,y);
        else if(r<(rich?.112:.066))add("ore",x,y);
        else if(r<(rich?.137:.076))add("crystal",x,y);
        else if(r<.084)add("herb",x,y);
      }
    }
    [["branch",34,54],["branch",37,53],["branch",34,51],["rock",38,54],["rock",39,52],["rock",34,49],["berry_bush",32,54],["herb",31,52]].forEach(([type,x,y])=>add(type,x,y,true));
    if(resources.length>950){
      const guaranteed=resources.filter(r=>Math.hypot(r.x-START.x,r.y-START.y)<110);
      const keep=resources.filter(r=>!guaranteed.includes(r)).sort((a,b)=>cellNoise(Math.floor(a.x/TILE),Math.floor(a.y/TILE),seed^0x165667b1)-cellNoise(Math.floor(b.x/TILE),Math.floor(b.y/TILE),seed^0x165667b1)).slice(0,950-guaranteed.length);
      resources.length=0;resources.push(...keep,...guaranteed);
    }

    const enemies=[];let eid=0;
    const enemy=(type,x,y)=>enemies.push({id:`e${eid++}`,type,x:(x+.5)*TILE,y:(y+.5)*TILE,homeX:(x+.5)*TILE,homeY:(y+.5)*TILE,hp:LI.DATA.enemies[type].hp,maxHp:LI.DATA.enemies[type].hp,state:"idle",timer:rng.next()*2,attackTimer:0,deadUntil:0,hitFlash:0,angle:rng.next()*Math.PI*2});
    const placeEnemies=(type,count,minX,maxX,minY,maxY)=>{let placed=0,tries=0;while(placed<count&&tries++<900){const x=rng.int(minX,maxX),y=rng.int(minY,maxY),wx=(x+.5)*TILE,wy=(y+.5)*TILE,tile=tiles[idx(x,y)],biome=biomes[idx(x,y)];if(tile===TILE_ID.sea||tile===TILE_ID.shallow||Math.hypot(wx-START.x,wy-START.y)<START.enemyClearRadius+32||biome!==LI.DATA.enemies[type].biome)continue;if(enemies.some(e=>Math.hypot(e.x-wx,e.y-wy)<56))continue;enemy(type,x,y);placed++;}};
    placeEnemies("slime",6,20,86,40,112);placeEnemies("thorn",7,7,53,8,91);placeEnemies("crab",6,7,116,42,118);placeEnemies("rockling",7,43,119,7,82);
    if(!state.progress.prisms.forest)enemy("forest_warden",18,20);
    if(!state.progress.prisms.rock)enemy("stone_warden",55,19);
    return{width:W,height:H,tileSize:TILE,tiles,biomes,zones,resources,landmarks,enemies,seed,rng,day:state.day};
  }
  function tileAt(world,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);if(tx<0||ty<0||tx>=W||ty>=H)return TILE_ID.sea;return world.tiles[ty*W+tx];}
  function biomeAt(world,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);if(tx<0||ty<0||tx>=W||ty>=H)return"sea";return world.biomes[ty*W+tx];}
  function zoneAt(world,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);if(tx<0||ty<0||tx>=W||ty>=H)return"sea";return world.zones[ty*W+tx];}
  function buildingAt(state,x,y){const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE);return state.buildings.find(b=>tx>=b.x&&ty>=b.y&&tx<b.x+b.w&&ty<b.y+b.h);}
  function passable(world,state,x,y){
    const tile=tileAt(world,x,y),b=buildingAt(state,x,y);
    if(b&&LI.DATA.buildings[b.type]?.solid!==false)return false;
    if(tile===TILE_ID.sea)return false;
    if(tile===TILE_ID.shallow)return!!state.buildings.find(o=>o.type==="bridge"&&Math.floor(x/TILE)===o.x&&Math.floor(y/TILE)===o.y);
    return true;
  }
  function activeResource(state,r){return !(state.removedResources[r.id]>state.day);}
  function nearby(world,state,x,y,radius,collection="resources"){
    return world[collection].filter(o=>collection!=="resources"||activeResource(state,o)).map(o=>({o,d:Math.hypot(o.x-x,o.y-y)})).filter(v=>v.d<=radius).sort((a,b)=>a.d-b.d);
  }
  function ensureExplored(state){if(!Array.isArray(state.explored)||state.explored.length!==FOG_COLS*FOG_ROWS)state.explored=Array(FOG_COLS*FOG_ROWS).fill(0);}
  function reveal(state,x,y,radius=1){
    ensureExplored(state);const mx=Math.max(0,Math.min(FOG_COLS-1,Math.floor(x/(W*TILE)*FOG_COLS))),my=Math.max(0,Math.min(FOG_ROWS-1,Math.floor(y/(H*TILE)*FOG_ROWS)));
    for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++){const nx=mx+ox,ny=my+oy;if(nx>=0&&ny>=0&&nx<FOG_COLS&&ny<FOG_ROWS)state.explored[ny*FOG_COLS+nx]=1;}
  }
  function explore(state,x,y){reveal(state,x,y,1);}
  LI.World={W,H,TILE,FOG_COLS,FOG_ROWS,TILE_ID,TILE_NAME,ZONE_NAMES,START,RNG,generate,tileAt,biomeAt,zoneAt,buildingAt,passable,activeResource,nearby,reveal,explore};
})();
