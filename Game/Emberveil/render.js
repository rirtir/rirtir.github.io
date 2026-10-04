/** 残り火の深庭: 原画ドットを崩さない整数拡大の描画。 */
import {VisualAssets,TILE,PALETTES,hash} from './visuals.js';
import {TerrainArt} from './terrain.js';
import {PixelLighting,pixelEllipse} from './lighting.js';
import {pixelText} from './pixel-font.js';
import {ItemIcons} from './item-icons.js';

function pixelLine(ctx,x0,y0,x1,y1,color,width=1){
  x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
  const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let err=dx+dy;
  ctx.fillStyle=color;
  for(let i=0;i<2000;i++){ctx.fillRect(x0,y0,width,width);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}
}
function pixelRing(ctx,x,y,r,color,dashed=false){
  ctx.fillStyle=color;
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    const dist=dx*dx+dy*dy;if(dist<=r*r&&dist>=(r-1)*(r-1)&&(!dashed||(dx+dy+400)%5<3))ctx.fillRect(Math.round(x+dx),Math.round(y+dy),1,1);
  }
}

// 円環を走査線の区間として描く。穴と扇形の安全域を保ち、1ドットずつの大量描画を避ける。
function pixelAnnulus(ctx,cx,cy,outer,inner,color,gapAngle,gapWidth){
  ctx.fillStyle=color;
  const gap=gapAngle!==undefined&&gapWidth>0;
  for(let y=Math.max(-outer,-cy);y<=Math.min(outer,ctx.canvas.height-1-cy);y++){
    const xo=Math.floor(Math.sqrt(Math.max(0,outer*outer-y*y)));
    const xi=Math.abs(y)<inner?Math.ceil(Math.sqrt(inner*inner-y*y)):0;
    const spans=xi>0?[[-xo,-xi],[xi,xo]]:[[-xo,xo]];
    for(let [start,end]of spans){
      start=Math.max(start,-cx);end=Math.min(end,ctx.canvas.width-1-cx);if(end<start)continue;
      if(!gap){ctx.fillRect(cx+start,cy+y,end-start+1,1);continue;}
      const breaks=[start,end+1];
      for(const a of[gapAngle-gapWidth/2,gapAngle+gapWidth/2]){
        const sin=Math.sin(a),cos=Math.cos(a);
        if(Math.abs(sin)>1e-8&&y/sin>=0){const edge=y*cos/sin;for(const point of[Math.floor(edge),Math.ceil(edge),Math.ceil(edge)+1])if(point>start&&point<=end)breaks.push(point);}
      }
      if(y===0)for(const point of[0,1])if(point>start&&point<=end)breaks.push(point);
      breaks.sort((a,b)=>a-b);
      for(let i=0;i<breaks.length-1;i++){
        const a=breaks[i],b=breaks[i+1]-1;if(b<a)continue;
        const angle=Math.atan2(y,(a+b)/2),relative=Math.atan2(Math.sin(angle-gapAngle),Math.cos(angle-gapAngle));
        if(Math.abs(relative)>=gapWidth/2)ctx.fillRect(cx+a,cy+y,b-a+1,1);
      }
    }
  }
}

export class Renderer {
  constructor(target,game){
    this.canvas=target;this.ctx=target.getContext('2d',{alpha:false});this.game=game;
    this.zoom=innerWidth<600?1:2;this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.assets=new VisualAssets();this.terrain=new TerrainArt(this.assets);this.lighting=new PixelLighting();this.itemIcons=new ItemIcons();
    this.camera={x:64*TILE,y:64*TILE};this.shakeT=0;this.shakeX=0;this.shakeY=0;this.time=0;this.ready=false;this.lastView=null;
    this.attractor=this.makeAttractor();this.worldId=null;this.lastSeq=0;this.eventEffects=[];this.resize();
  }
  async load(){await this.assets.load();this.ready=true;}
  getItemIconURL(key){return this.itemIcons.url(key,this.game?.data?.ITEMS?.[key]);}
  resize(){
    this.zoom=Math.max(1,Math.min(3,Math.round(Number(this.zoom)||2)));
    const w=Math.ceil(innerWidth/this.zoom),h=Math.ceil(innerHeight/this.zoom);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    this.canvas.style.width=w*this.zoom+'px';this.canvas.style.height=h*this.zoom+'px';
    this.canvas.style.position='absolute';this.canvas.style.left=Math.floor((innerWidth-w*this.zoom)/2)+'px';this.canvas.style.top=Math.floor((innerHeight-h*this.zoom)/2)+'px';
    this.canvas.style.imageRendering='pixelated';this.ctx.imageSmoothingEnabled=false;
  }
  screenToWorld(clientX,clientY){
    const rect=this.canvas.getBoundingClientRect();
    return {x:((clientX-rect.left)*this.canvas.width/rect.width+this.camera.x-this.canvas.width/2-this.shakeX)/TILE,
      y:((clientY-rect.top)*this.canvas.height/rect.height+this.camera.y-this.canvas.height/2-this.shakeY)/TILE};
  }
  makeAttractor(){
    const objects=[];
    for(let y=49;y<80;y++)for(let x=49;x<85;x++){
      const n=hash(x,y,144);if(Math.hypot(x-64,y-64)<4||n<.88)continue;
      if((Math.sin(x*.37)+Math.sin(y*.3+x*.19))>1.1)continue;
      objects.push({id:x+':'+y,x:x+.5,y:y+.7,kind:n>.973?'tree':n>.94?'mushroom':n>.915?'roots':'crystal'});
    }
    objects.push({id:'home',x:61.5,y:61.7,kind:'cabin'},{id:'bench',x:62.5,y:64.5,kind:'workbench'},
      {id:'fire',x:65.5,y:64.5,kind:'campfire'},{id:'altar',x:70.5,y:63.5,kind:'altar'},
      {id:'chest',x:61.5,y:65.5,kind:'chest'},{id:'farm',x:63.5,y:67.5,kind:'farm',growth:1});
    return {width:128,height:128,mode:'title',player:{x:64.5,y:64.5,faceX:1,faceY:0},objects,enemies:[],effects:[],time:0,
      tileAt(x,y){const wet=Math.sin(x*.37)+Math.sin(y*.3+x*.19);return {kind:wet>1.23&&Math.hypot(x-64,y-64)>6?'water':'floor',biome:0};}};
  }
  view(){
    const v=this.game?.getRenderState?.();
    return v&&v.tileAt&&v.player?v:this.attractor;
  }
  worldPoint(x,y){return {x:Math.round(x*TILE-this.camera.x+this.canvas.width/2+this.shakeX),y:Math.round(y*TILE-this.camera.y+this.canvas.height/2+this.shakeY)};}
  render(dt=1/60){
    if(!this.ready)return;
    this.time+=Math.min(.1,Math.max(0,dt));const view=this.view();this.lastView=view;
    this.reducedMotion=this.game?.settings?.reduceMotion??this.reducedMotion;
    this.collectEffects(dt);
    this.shakeT=Math.max(0,this.shakeT-dt);
    const shake=!this.reducedMotion&&this.game?.settings?.screenShake!==false&&this.shakeT>0;
    this.shakeX=shake?Math.round((hash(Math.floor(this.time*45),1,78)-.5)*6):0;
    this.shakeY=shake?Math.round((hash(Math.floor(this.time*45),2,78)-.5)*4):0;
    const title=view.mode==='title',p=view.player,t=this.reducedMotion?0:this.time;
    const targetX=p.x*TILE+(title?30:0),targetY=p.y*TILE+(title?-20:0);
    if(!this.camera.initialized){this.camera.x=targetX;this.camera.y=targetY;this.camera.initialized=true;}
    const smooth=this.reducedMotion?1:Math.min(1,dt*9);
    this.camera.x+=(targetX-this.camera.x)*smooth;this.camera.y+=(targetY-this.camera.y)*smooth;
    this.camera.x=Math.round(this.camera.x);this.camera.y=Math.round(this.camera.y);
    const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#141c2c';ctx.fillRect(0,0,w,h);
    const minX=Math.max(0,Math.floor((this.camera.x-w/2)/TILE)-2),maxX=Math.min(view.width-1,Math.ceil((this.camera.x+w/2)/TILE)+2);
    const minY=Math.max(0,Math.floor((this.camera.y-h/2)/TILE)-3),maxY=Math.min(view.height-1,Math.ceil((this.camera.y+h/2)/TILE)+5);
    const tile=(x,y)=>x<0||y<0||x>=view.width||y>=view.height?{kind:'wall',biome:0}:view.tileAt(x,y);
    const lights=[],walls=[];
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const cell=tile(x,y),screen=this.worldPoint(x,y);
      if(cell.kind==='wall'){walls.push({x,y,cell,screen});continue;}
      this.terrain.draw(ctx,cell.kind,cell.biome,x,y,screen.x,screen.y,t,{n:tile(x,y-1).kind,s:tile(x,y+1).kind,w:tile(x-1,y).kind,e:tile(x+1,y).kind},cell.ground,cell.build);
      if(cell.kind==='lava'&&hash(x,y,62)>.75)lights.push({x:screen.x+12,y:screen.y+12,radius:48,color:'ff9a49',glow:.1});
    }
    // 壁の天面と側面。下側の壁はキャラクターと同じ奥行順に描く。
    const queue=[];
    for(const wall of walls)queue.push({y:wall.y+.95,draw:()=>this.terrain.wall(ctx,wall.cell.biome,wall.x,wall.y,wall.screen.x,wall.screen.y,tile(wall.x,wall.y+1).kind!=='wall',wall.cell.ore,wall.cell.wall)});
    for(const object of view.objects||[]){
      if(object.x<minX-3||object.x>maxX+3||object.y<minY-4||object.y>maxY+4)continue;
      if(!title&&!this.isVisible(view,object.x,object.y))continue;
      queue.push({y:object.y,draw:()=>this.drawObject(ctx,object,view,lights,t)});
    }
    for(const hazard of this.game?.hazards||[])this.drawHazard(ctx,hazard,t);
    for(const enemy of view.enemies||[]){
      if(enemy.x<minX-2||enemy.x>maxX+2||enemy.y<minY-2||enemy.y>maxY+2||!this.isVisible(view,enemy.x,enemy.y))continue;
      if(enemy.telegraph&&!(this.game?.hazards?.length))this.drawTelegraph(ctx,enemy.telegraph,t);
      queue.push({y:enemy.y,draw:()=>this.drawEnemy(ctx,enemy,t)});
    }
    if(!p.dead)queue.push({y:p.y,draw:()=>this.drawPlayer(ctx,p,t)});
    queue.sort((a,b)=>a.y-b.y);for(const entry of queue)entry.draw();
    for(const shot of this.game?.projectiles||[]){
      if(!this.isVisible(view,shot.x,shot.y))continue;const sp=this.worldPoint(shot.x,shot.y),fire=shot.theme==='ember';
      pixelEllipse(ctx,sp.x,sp.y,3,3,fire?'#d36737':'#714b80');ctx.fillStyle=fire?'#ffdc8c':'#ceeed2';ctx.fillRect(sp.x-1,sp.y-1,2,2);
      pixelLine(ctx,sp.x,sp.y,sp.x-(shot.vx||0)*1.5,sp.y-(shot.vy||0)*1.5,fire?'#924331':'#48315f');
    }
    for(const drop of this.game?.drops||[]){
      if(!this.isVisible(view,drop.x,drop.y))continue;const sp=this.worldPoint(drop.x,drop.y);
      ctx.fillStyle='#996139';ctx.fillRect(sp.x-3,sp.y-4,6,5);ctx.fillStyle='#ffdc8c';ctx.fillRect(sp.x-1,sp.y-4,2,2);
    }
    const pp=this.worldPoint(p.x,p.y);
    lights.push({x:pp.x,y:pp.y-10,radius:135,color:'ffd275',strength:1,glow:.08});
    if(view.buildPreview)this.drawBuildPreview(ctx,view.buildPreview);
    else if(!title&&view.aim){
      const aim=this.worldPoint(Math.floor(view.aim.x),Math.floor(view.aim.y));
      if(Math.hypot(view.aim.x-p.x,view.aim.y-p.y)<5)this.brackets(ctx,aim.x,aim.y,24,'#b7c979');
    }
    this.lighting.draw(ctx,lights,title?.3:.36);
    this.drawSpores(ctx,view,minX,maxX,minY,maxY,t);
    for(const effect of view.effects||[])this.drawEffect(ctx,effect,t);
    for(const effect of this.eventEffects)this.drawEffect(ctx,effect,t);
    if(!title)this.drawFog(ctx,view,minX,maxX,minY,maxY);
    if(!title&&view.questMarker&&this.game?.settings?.objectiveArrow!==false)this.drawObjectiveArrow(ctx,view.questMarker);
    // 淡い周辺暗部も矩形のピクセルだけで重ねる。
    ctx.fillStyle='rgba(9,15,25,.08)';for(let i=0;i<6;i++){ctx.fillRect(i*3,i*3,w-i*6,3);ctx.fillRect(i*3,h-(i+1)*3,w-i*6,3);ctx.fillRect(i*3,i*3,3,h-i*6);ctx.fillRect(w-(i+1)*3,i*3,3,h-i*6);}
    ctx.globalAlpha=1;
  }
  isVisible(view,x,y){return view.mode==='title'||(view.visible?view.visible(Math.floor(x),Math.floor(y)):Math.hypot(x-view.player.x,y-view.player.y)<14);}
  collectEffects(dt){
    const game=this.game;if(!game?.pollEvents)return;
    if(game.worldId!==this.worldId){this.worldId=game.worldId;this.lastSeq=game.eventSeq||0;this.eventEffects=[];this.shakeT=0;this.camera.initialized=false;}
    for(const event of game.pollEvents(this.lastSeq)){
      this.lastSeq=event.seq;
      if(['playerHurt','bossPhase','bossDefeated','treeFall'].includes(event.type))this.shakeT=.18;
      if(!Number.isFinite(event.x)||!Number.isFinite(event.y))continue;
      let kind=null,text,color;
      if(event.type==='hit'){kind='hit';text=this.game.settings?.showDamageNumbers===false?undefined:Math.round(event.dmg||0);}
      else if(event.type==='playerHurt'){kind='hurt';text=this.game.settings?.showDamageNumbers===false?undefined:'-'+Math.round(event.dmg||0);color='#f99a49';}
      else if(['mineHit','tileBreak','chop','treeFall','gather','harvest','plant','place','remove'].includes(event.type))kind='build';
      else if(event.type==='swing')kind='slash';else if(event.type==='dodge')kind='dodge';else if(event.type.startsWith('fish'))kind='fish';
      else if(event.type==='death'||event.type==='enemyDie')kind='death';else if(event.type==='respawn')kind='heal';
      // エンジン側の短命エフェクトがある場合は同じ命中や建築を二重に描かない。
      if(kind&&!Array.isArray(game.effects))this.eventEffects.push({kind,x:event.x,y:event.y,text,color,age:0,duration:.6});
    }
    if(this.eventEffects.length>96)this.eventEffects.splice(0,this.eventEffects.length-96);
    if(!game.paused)for(const fx of this.eventEffects)fx.age+=Math.min(dt,.1);
    this.eventEffects=this.eventEffects.filter(fx=>fx.age<fx.duration);
  }
  brackets(ctx,x,y,size,color){
    ctx.fillStyle=color;for(const [dx,dy]of[[0,0],[size-1,0],[0,size-1],[size-1,size-1]]){ctx.fillRect(x+dx-(dx?4:0),y+dy,5,1);ctx.fillRect(x+dx,y+dy-(dy?4:0),1,5);}
  }
  drawObject(ctx,o,view,lights,time){
    const s=this.worldPoint(o.x,o.y),p=view.player;
    const object=this.game?.world?.objectAt?.(Math.floor(o.x),Math.floor(o.y));
    const original=o.type||object?.type;
    const artKinds={cap_tree:'mushroom',glowcap:'glowcap',moss_grass:'moss',rubble:'rubble',wild_tuber:'tuber',wild_grain:'grain',wild_pepper:'pepper',core:'hearth',cookpot:'cookpot',moss_pot:'moss_pot',lamp_brass:'lamp_brass',lamp_crystal:'lamp_crystal',table:'table',stool:'stool',banner_moss:'banner_moss',banner_crystal:'banner_crystal',banner_ember:'banner_ember',core_model:'altar'};
    let artKind=o.kind==='logs'&&original==='cap_tree'?'logs':artKinds[original]||o.kind;
    if(artKind==='crystal'&&this.game?.world?.biomeAt?.(Math.floor(o.x),Math.floor(o.y))===2)artKind='crystal_violet';
    const occludes=Math.abs(o.x-p.x)<1.5&&o.y>p.y&&o.y-p.y<3&&['tree','goldtree','mushroom','violet','cabin','arch'].includes(o.kind);
    const alpha=occludes?.42:1;
    pixelEllipse(ctx,s.x,s.y+1,['tree','cabin','altar'].includes(o.kind)?22:14,5,'rgba(9,15,25,.35)');
    if(original==='planter'){
      this.drawPlanter(ctx,s,object,lights,time);
    }else if(original==='sapling'){
      ctx.fillStyle='#463334';ctx.fillRect(s.x-6,s.y-3,12,4);
      ctx.fillStyle='#80a35c';ctx.fillRect(s.x-1,s.y-9,2,7);ctx.fillRect(s.x-4,s.y-7,3,2);ctx.fillRect(s.x+1,s.y-10,4,2);
      if((o.growth||0)>.5){ctx.fillStyle='#267d80';ctx.fillRect(s.x-6,s.y-13,12,4);ctx.fillStyle='#82ddbd';ctx.fillRect(s.x-3,s.y-13,3,1);}
    }else if(artKind==='campfire'){
      pixelEllipse(ctx,s.x,s.y,13,5,'#253641');pixelEllipse(ctx,s.x,s.y-1,10,3,'#4b6166');
      pixelLine(ctx,s.x-7,s.y,s.x+7,s.y-5,'#634a3b',3);pixelLine(ctx,s.x-7,s.y-5,s.x+7,s.y,'#8b6746',2);
      for(let i=0;i<4;i++){const flame=7+Math.floor(Math.sin(time*7+i)*3);ctx.fillStyle=i%2?'#f99a49':'#d36737';ctx.fillRect(s.x-5+i*3,s.y-flame,3,flame-1);ctx.fillStyle='#ffd275';ctx.fillRect(s.x-2+i,s.y-flame+3,2,4);}
      lights.push({x:s.x,y:s.y-5,radius:100,color:'ffdc8c',strength:.95,glow:.18});
    }else if(artKind==='torch'){
      ctx.fillStyle='#463334';ctx.fillRect(s.x-1,s.y-15,3,16);ctx.fillStyle='#b39158';ctx.fillRect(s.x,s.y-12,1,11);
      ctx.fillStyle='#d36737';ctx.fillRect(s.x-2,s.y-20,5,6);ctx.fillStyle='#ffdc8c';ctx.fillRect(s.x-1,s.y-19-(Math.floor(time*5)%2),3,5);
      lights.push({x:s.x,y:s.y-17,radius:80,color:'ffd275',glow:.15});
    }else if(o.kind==='bed'){
      ctx.fillStyle='#463334';ctx.fillRect(s.x-12,s.y-21,24,24);ctx.fillStyle='#8b6746';ctx.fillRect(s.x-13,s.y-20,2,25);ctx.fillRect(s.x+11,s.y-20,2,25);
      ctx.fillStyle='#fff0c2';ctx.fillRect(s.x-9,s.y-19,18,5);ctx.fillStyle='#267d80';ctx.fillRect(s.x-9,s.y-12,18,14);ctx.fillStyle='#49af9d';ctx.fillRect(s.x-9,s.y-12,18,2);
    }else if(o.kind==='gravestone'){
      ctx.fillStyle='#253641';ctx.fillRect(s.x-8,s.y-21,16,22);ctx.fillRect(s.x-5,s.y-24,10,3);
      ctx.fillStyle='#70847d';ctx.fillRect(s.x-6,s.y-21,12,18);ctx.fillStyle='#354954';ctx.fillRect(s.x-1,s.y-18,2,12);ctx.fillRect(s.x-4,s.y-15,8,2);lights.push({x:s.x,y:s.y-12,radius:45,color:'88abc1',glow:.08});
    }else if(o.kind==='wall'){
      this.terrain.wall(ctx,0,Math.floor(o.x),Math.floor(o.y),s.x-12,s.y-12,true);
    }else{
      this.assets.garden(ctx,artKind,s.x,s.y,undefined,alpha);
      if(['mushroom','violet','crystal','altar','furnace','cabin','ember'].includes(o.kind)){
        const color=['furnace','cabin','ember'].includes(o.kind)?'ffd275':o.kind==='violet'?'d99aba':'82ddbd';
        lights.push({x:s.x,y:s.y-(o.kind==='mushroom'?35:20),radius:o.kind==='altar'?95:65,color,glow:o.kind==='furnace'?.17:.08});
      }
      if(['lamp_brass','lamp_crystal','glowcap','hearth'].includes(artKind))lights.push({x:s.x,y:s.y-12,radius:artKind==='hearth'?100:60,color:artKind==='lamp_crystal'||artKind==='glowcap'?'82ddbd':'ffd275',glow:.12});
    }
    if(o.hp!==undefined&&o.maxHp&&o.hp<o.maxHp&&o.hp>0){ctx.fillStyle='#141c2c';ctx.fillRect(s.x-11,s.y-8,22,3);ctx.fillStyle='#e8b35b';ctx.fillRect(s.x-10,s.y-7,Math.ceil(20*o.hp/o.maxHp),1);}
  }
  drawPlanter(ctx,s,object,lights,time){
    ctx.fillStyle='#253641';ctx.fillRect(s.x-14,s.y-13,28,15);ctx.fillStyle='#8b6746';ctx.fillRect(s.x-13,s.y-12,26,12);
    ctx.fillStyle='#463334';ctx.fillRect(s.x-11,s.y-10,22,8);ctx.fillStyle='#634a3b';for(let i=0;i<3;i++)ctx.fillRect(s.x-10,s.y-9+i*3,20,1);
    if(!object?.crop)return;
    const crop=object.crop,stage=object.stage||0;
    if(stage===3){
      const icon=this.itemIcons.image(crop,this.game.data.ITEMS[crop]);
      ctx.drawImage(icon,s.x-14,s.y-21);ctx.drawImage(icon,s.x-2,s.y-18);
      ctx.fillStyle='#ffdc8c';ctx.fillRect(s.x+11,s.y-19,1,5);ctx.fillRect(s.x+9,s.y-17,5,1);
    }else for(let i=0;i<3;i++){
      const x=s.x-7+i*7,y=s.y-6,height=3+stage*3;
      ctx.fillStyle=crop==='glowcap'?'#267d80':'#588552';ctx.fillRect(x,y-height,2,height);
      ctx.fillStyle=crop==='glowcap'?'#82ddbd':'#b7c979';ctx.fillRect(x-2,y-height+1,3,2);if(stage>0)ctx.fillRect(x+2,y-height-1,3,2);
      if(stage===2){ctx.fillStyle=crop==='pepper'?'#d36737':crop==='grain'?'#ffd275':crop==='tuber'?'#c88b48':'#82ddbd';ctx.fillRect(x-1,y-height-2,4,3);}
    }
    if(crop==='glowcap')lights.push({x:s.x,y:s.y-9,radius:35,color:'82ddbd',glow:.08});
    if(object.dark){ctx.fillStyle='#a46d9c';ctx.fillRect(s.x-1,s.y-27,3,4);ctx.fillRect(s.x-1,s.y-22,3,1);}
  }
  drawPlayer(ctx,p,time){
    const s=this.worldPoint(p.x,p.y),moving=p.moving,frame=Math.floor(time*(moving?10:4))%4;
    pixelEllipse(ctx,s.x,s.y+1,8,3,'rgba(9,15,25,.6)');
    const blink=p.invuln>0&&Math.floor(time*12)%2===0;
    this.assets.character(ctx,p.skin||'knight_m',moving?'run':'idle',frame,s.x,s.y,1,(p.faceX??1)<0,blink?.4:1);
    const direction=(p.faceX??1)<0?-1:1,player=this.game?.player;
    const held=player?.action?.item||player?.inventory?.[player.selected]?.id,def=this.game?.data?.ITEMS?.[held];
    if(def&&['sword','axe','pick','rod'].includes(def.type)){
      const icon=this.itemIcons.image(held,def);
      ctx.save();ctx.translate(s.x+direction*7,s.y-5);if(direction<0)ctx.scale(-1,1);ctx.drawImage(icon,-3,-icon.height);ctx.restore();
    }
    ctx.fillStyle='#ffdc8c';ctx.fillRect(s.x-direction*6,s.y-10,2,3);ctx.fillStyle='#fff0c2';ctx.fillRect(s.x-direction*6,s.y-10,1,1);
    if(p.attackTimer>0){const angle=Math.atan2(p.faceY??0,p.faceX??1);for(let i=-6;i<=6;i++){const a=angle+i*.1;const x=s.x+Math.cos(a)*20,y=s.y+Math.sin(a)*13-7;ctx.fillStyle=Math.abs(i)<3?'#fff0c2':'#e8b35b';ctx.fillRect(Math.round(x),Math.round(y),2,2);}}
  }
  drawEnemy(ctx,e,time){
    const s=this.worldPoint(e.x,e.y),names={slime:'tiny_zombie',skeleton:'skelet',orc:'orc_warrior',chort:'chort',warden_moss:'big_zombie',warden_crystal:'ogre',warden_ember:'big_demon'};
    pixelEllipse(ctx,s.x,s.y+2,e.boss?16:8,e.boss?5:3,'rgba(9,15,25,.6)');
    const scale=e.boss?2:1;this.assets.character(ctx,names[e.kind]||'tiny_zombie',e.moving?'run':'idle',Math.floor(time*(e.moving?8:4))%4,s.x,s.y,scale,(e.faceX??1)<0,e.hitTimer>0?.6:1);
    if(e.kind==='warden_crystal'&&!String(e.id).startsWith('d')&&this.game?.boss?._mirror&&(this.reducedMotion||e.glintT<.16)){
      for(const [x,y]of[[s.x-18,s.y-60],[s.x+20,s.y-42],[s.x,s.y-79]]){
        ctx.fillStyle='#ffdc8c';ctx.fillRect(x-3,y,7,1);ctx.fillRect(x,y-3,1,7);ctx.fillStyle='#fff0c2';ctx.fillRect(x,y,1,1);
      }
    }
    if(e.hp<e.maxHp||e.boss){const width=e.boss?44:20,y=s.y-(e.boss?76:32);ctx.fillStyle='#141c2c';ctx.fillRect(s.x-width/2-1,y-1,width+2,4);ctx.fillStyle=e.boss?'#d36737':'#924331';ctx.fillRect(s.x-width/2,y,Math.max(0,Math.ceil(width*e.hp/e.maxHp)),2);}
  }
  drawTelegraph(ctx,g,time){
    const s=this.worldPoint(g.x,g.y),radius=Math.round((g.radius??2)*TILE),danger=(g.progress??0)>.65;
    const strong=this.game?.settings?.highContrastTelegraph;
    const fill=danger?'rgba(211,103,55,.36)':'rgba(211,103,55,.18)',outline=strong?'#fff0c2':danger?'#ffd275':'#d36737';
    if(g.kind==='circle'){
      pixelEllipse(ctx,s.x,s.y,radius,radius,fill);pixelRing(ctx,s.x,s.y,radius,outline,true);
      pixelRing(ctx,s.x,s.y,Math.round(radius*Math.max(.1,g.progress??.1)),outline);
    }else if(g.kind==='cone'){
      const angle=g.angle??0,arc=g.width??1.2;ctx.fillStyle=fill;
      pixelAnnulus(ctx,s.x,s.y,radius,0,fill,angle+Math.PI,Math.PI*2-arc);
      pixelAnnulus(ctx,s.x,s.y,radius,Math.max(0,radius-1),outline,angle+Math.PI,Math.PI*2-arc);
      for(const a of[angle-arc/2,angle+arc/2])pixelLine(ctx,s.x,s.y,s.x+Math.cos(a)*radius,s.y+Math.sin(a)*radius,outline);
    }else{
      const angle=g.angle??0,half=Math.max(1,(g.width??.4)*TILE/2),c=Math.cos(angle),sn=Math.sin(angle);
      const ex=s.x+c*radius,ey=s.y+sn*radius;
      const x0=Math.max(0,Math.floor(Math.min(s.x,ex)-half)),x1=Math.min(ctx.canvas.width-1,Math.ceil(Math.max(s.x,ex)+half));
      const y0=Math.max(0,Math.floor(Math.min(s.y,ey)-half)),y1=Math.min(ctx.canvas.height-1,Math.ceil(Math.max(s.y,ey)+half));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const dx=x-s.x,dy=y-s.y,along=dx*c+dy*sn,across=-dx*sn+dy*c;
        if(along>=0&&along<=radius&&Math.abs(across)<=half){ctx.fillStyle=Math.abs(across)>half-1?outline:fill;ctx.fillRect(x,y,1,1);}
      }
    }
  }
  drawHazard(ctx,hazard,time){
    const g=hazard.shape;if(!g)return;
    const progress=hazard.phase==='active'?1:Math.min(1,(hazard.t||0)/(hazard.warn||1));
    if(g.type==='ring'){
      const s=this.worldPoint(g.x,g.y),outer=Math.round(Math.max(0,g.r+g.width/2)*TILE),inner=Math.round(Math.max(0,g.r-g.width/2)*TILE);
      const strong=this.game?.settings?.highContrastTelegraph,outline=strong?'#fff0c2':'#f99a49';
      const color=hazard.phase==='active'?'rgba(249,154,73,.55)':strong?'rgba(211,103,55,.45)':'rgba(211,103,55,.25)';ctx.fillStyle=color;
      pixelAnnulus(ctx,s.x,s.y,outer,inner,color,g.gapAngle,g.gapWidth);
      pixelAnnulus(ctx,s.x,s.y,outer,Math.max(inner,outer-1),outline,g.gapAngle,g.gapWidth);
      if(inner>0)pixelAnnulus(ctx,s.x,s.y,Math.min(outer,inner+1),inner,outline,g.gapAngle,g.gapWidth);
    }else this.drawTelegraph(ctx,{kind:g.type,x:g.x,y:g.y,radius:g.r??g.length??g.range??2,angle:g.angle,width:g.spread??g.width,progress},time);
  }
  drawBuildPreview(ctx,b){
    const s=this.worldPoint(Math.floor(b.x),Math.floor(b.y));ctx.fillStyle=b.valid?'rgba(130,221,189,.22)':'rgba(211,103,55,.22)';ctx.fillRect(s.x,s.y,TILE,TILE);this.brackets(ctx,s.x,s.y,24,b.valid?'#82ddbd':'#d36737');
    if(this.assets.frames[b.kind])this.assets.garden(ctx,b.kind,s.x+12,s.y+20,undefined,.5);
  }
  drawSpores(ctx,view,minX,maxX,minY,maxY,t){
    for(let y=minY;y<=maxY;y+=2)for(let x=minX;x<=maxX;x+=2){
      const value=hash(x,y,339);if(value<.83||!this.isVisible(view,x,y))continue;
      const s=this.worldPoint(x+.5,y+.5),phase=value*40;
      const sx=s.x+Math.round(Math.sin(t*.2+phase)*8),sy=s.y-Math.round((t*3+phase)%30);
      ctx.fillStyle=value>.96?'#ffdc8c':'#82ddbd';ctx.globalAlpha=.2+.3*(Math.sin(t+phase)+1)/2;ctx.fillRect(sx,sy,value>.96?2:1,1);ctx.globalAlpha=1;
    }
  }
  drawEffect(ctx,e,time){
    const age=e.age??0,duration=e.duration??.7,remain=Math.max(0,1-age/duration);if(!remain)return;
    const s=this.worldPoint(e.x,e.y);ctx.save();ctx.globalAlpha=remain;
    if(e.text!==undefined)pixelText(ctx,e.text,s.x,s.y-25-Math.round(age*15),e.color||'#fff0c2',1,true);
    if(['hit','hurt','pickup','build','death','victory','heal'].includes(e.kind)){
      for(let i=0;i<8;i++){const angle=i*Math.PI/4,spread=age*22;ctx.fillStyle=e.color||(['hurt','death'].includes(e.kind)?'#d36737':'#ffdc8c');ctx.fillRect(s.x+Math.round(Math.cos(angle)*spread),s.y-8+Math.round(Math.sin(angle)*spread-age*8),2,2);}
    }else if(e.kind==='slash'){
      for(let i=0;i<14;i++){const a=-1.4+i*.2;ctx.fillStyle='#fff0c2';ctx.fillRect(s.x+Math.round(Math.cos(a)*18),s.y-8+Math.round(Math.sin(a)*14),2,2);}
    }else if(e.kind==='fish')pixelRing(ctx,s.x,s.y,Math.round(4+age*18),'#82ddbd');
    else if(e.kind==='dodge'){for(let i=0;i<4;i++){ctx.fillStyle='#70847d';ctx.fillRect(s.x-8+i*5,s.y+i%2,3,1);}}
    ctx.restore();
  }
  drawFog(ctx,view,minX,maxX,minY,maxY){
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const s=this.worldPoint(x,y),known=view.explored?.[y*view.width+x];
      // 永続する地図の探索履歴と現在の視界は分け、照明の点在で穴の開いた霧にしない。
      const distance=Math.hypot(x+.5-view.player.x,y+.5-view.player.y);
      if(view.explored&&!known){
        const alpha=Math.min(1,Math.max(0,(distance-6)/3));
        if(alpha>0){ctx.fillStyle=`rgba(9,15,25,${Math.round(alpha*8)/8})`;ctx.fillRect(s.x,s.y,TILE,TILE);}
      }
      else if(distance>6){ctx.fillStyle=`rgba(9,15,25,${Math.min(.875,Math.round((distance-6)/3*8)/8)})`;ctx.fillRect(s.x,s.y,TILE,TILE);}
    }
  }
  drawObjectiveArrow(ctx,target){
    const s=this.worldPoint(target.x,target.y),w=ctx.canvas.width,h=ctx.canvas.height;
    if(s.x>12&&s.x<w-12&&s.y>12&&s.y<h-12)return;
    const dx=s.x-w/2,dy=s.y-h/2,ratio=Math.min((w/2-22)/Math.max(1,Math.abs(dx)),(h/2-22)/Math.max(1,Math.abs(dy)));
    const x=Math.round(w/2+dx*ratio),y=Math.round(h/2+dy*ratio),a=Math.atan2(dy,dx);
    pixelLine(ctx,x-Math.cos(a)*6,y-Math.sin(a)*6,x+Math.cos(a)*6,y+Math.sin(a)*6,'#82ddbd',2);
    for(const side of[-1,1])pixelLine(ctx,x+Math.cos(a)*6,y+Math.sin(a)*6,x+Math.cos(a+side*2.4)*5,y+Math.sin(a+side*2.4)*5,'#fff0c2',2);
    pixelText(ctx,'GOAL',x,y+10,'#82ddbd',1,true);
  }
  drawMinimap(target,large=false){
    if(!this.ready||!target)return;const view=this.lastView||this.view();
    const available=target.parentElement?.clientWidth||view.width*2;
    const size=large?view.width*Math.max(1,Math.floor(Math.min(available,460)/view.width)):Math.max(1,Math.round(target.clientWidth));
    const scale=size/view.width;
    if(target.width!==size||target.height!==size){target.width=size;target.height=size;}
    // 小型地図は表示サイズを原画解像度として直接ラスタライズする。
    // 拡大地図は128ドットの整数倍だけで表示する。
    if(large){target.style.width=size+'px';target.style.height=size+'px';}
    const ctx=target.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#141c2c';ctx.fillRect(0,0,target.width,target.height);
    for(let y=0;y<view.height;y++)for(let x=0;x<view.width;x++){
      if(view.explored&&!view.explored[y*view.width+x])continue;const cell=view.tileAt(x,y),p=PALETTES[cell.biome||0];
      ctx.fillStyle=cell.kind==='wall'?p.face:cell.kind==='water'?p.water:cell.kind==='lava'?'#924331':p.moss;ctx.fillRect(Math.floor(x*scale),Math.floor(y*scale),Math.max(1,Math.ceil(scale)),Math.max(1,Math.ceil(scale)));
    }
    for(const o of view.objects||[])if(['altar','cabin','gravestone','campfire'].includes(o.kind)){
      const ix=Math.floor(o.x),iy=Math.floor(o.y);if(!view.explored||view.explored[iy*view.width+ix]){ctx.fillStyle=o.kind==='gravestone'?'#d99aba':'#e8b35b';ctx.fillRect(Math.floor(ix*scale),Math.floor(iy*scale),Math.max(1,Math.ceil(2*scale)),Math.max(1,Math.ceil(2*scale)));}
    }
    if(view.questMarker){ctx.fillStyle='#82ddbd';ctx.fillRect(Math.floor(view.questMarker.x*scale)-1,Math.floor(view.questMarker.y*scale)-1,3,3);}
    ctx.fillStyle='#fff0c2';const x=Math.floor(view.player.x*scale),y=Math.floor(view.player.y*scale);ctx.fillRect(x-1,y-1,3,3);ctx.fillStyle='#d36737';ctx.fillRect(x,y,1,1);
  }
}
