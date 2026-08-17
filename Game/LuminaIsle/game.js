(function(){
  "use strict";
  const LI=window.LI=window.LI||{},D=LI.DATA,W=LI.World;
  const $=q=>document.querySelector(q),$$=q=>Array.from(document.querySelectorAll(q));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
  const smoothstep=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
  const cellMap=(rows)=>Object.fromEntries(rows.flatMap((row,y)=>row.map((key,x)=>[key,[x,y]])));
  const ITEM_TOOL_ART=cellMap([
    ["axe","copper_axe","pickaxe","copper_pickaxe","spear","light_spear"],
    ["rod","watering_can","hammer","sun_axe","sun_pickaxe","sun_spear"],
    ["sun_rod","sun_watering_can","branch","wood","stone","fiber"],
    ["berry","ore","copper_bar","crystal","water","rope"]
  ]);
  const ITEM_FOOD_ART=cellMap([
    ["seed","sunroot","moonbean_seed","moonbean","tide_seed","tide_melon"],
    ["cooked_berry","cooked_fish","soup","glow_skewer","field_ration","moon_tea"],
    ["tide_salad","prism_stew","fish","fish_sun","fish_moon","fish_rain"],
    ["fish_rock","fish_glow","fish_leaf","fish_coral","fish_star","fish_prism"]
  ]);
  const WORLD_ART=cellMap([
    ["tree","branch","rock","fiber","berry_bush","shell"],
    ["ore","crystal","resin","herb","fishing","plot"],
    ["slime","thorn","crab","rockling","forest_warden","stone_warden"],
    ["stump","sapling","sunroot","moonbean","tide_melon","relic"]
  ]);
  const BUILDING_ART=cellMap([
    ["campfire","workbench","furnace","chest","bed","well"],
    ["lantern","plot","fence","gate","bridge","flag"],
    ["bench","flowerpot","sun_banner","shell_chime","prism_arch","rain_collector"],
    ["sprinkler","greenhouse","request_board","waystone","trophy_plinth","sun_dial"],
    ["beacon_garden","wood_floor","stone_floor","lighthouse","guide","windstone"]
  ]);
  const UI_ART=cellMap([
    ["health","food","water","stamina"],
    ["bag","craft","build","journal"],
    ["help","pause","interact","dodge"],
    ["rotate","place","dismantle","locate"]
  ]);

  class Game{
    constructor(){
      this.canvas=$("#gameCanvas");this.ctx=this.canvas.getContext("2d",{alpha:false});this.ctx.imageSmoothingEnabled=false;
      this.atlas=new Image();this.atlas.src="assets/sprites.png";this.sprites=window.LI_SPRITES?.sprites||{};
      this.assetPaths=window.LI_GENERATED_ASSETS||{};this.assetMetrics=window.LI_ASSET_METRICS||{};this.assets={};
      for(const [key,src] of Object.entries(this.assetPaths)){const image=new Image();image.src=src;this.assets[key]=image;}
      this.terrain={};this.terrainPatterns={};
      for(const [key,src] of Object.entries({meadow:"assets/terrain-v4/meadow.png",sand:"assets/terrain-v4/sand.png",forest:"assets/terrain-v4/forest.png",rock:"assets/terrain-v4/rock.png",water:"assets/terrain-v4/water.png"})){const image=new Image();image.src=src;this.terrain[key]=image;}
      this.combatSource=new Image();this.combatSource.src="assets/combat-world-v5.png";this.combatSheet=null;this.combatBounds=[];
      this.state=null;this.world=null;this.slot=0;this.running=false;this.paused=true;this.panel=null;this.last=0;this.acc=0;this.hudTimer=0;this.saveTimer=0;this.mapTimer=0;
      this.scale=3;this.dpr=1;this.viewW=320;this.viewH=180;this.camera={x:0,y:0,shakeX:0,shakeY:0};
      this.input={keys:new Set(),pressed:new Set(),pointerX:0,pointerY:0,pointerWorldX:0,pointerWorldY:0,pointerActive:false,pointerSeen:false,joyX:0,joyY:0,gamepadX:0,gamepadY:0};
      this.gamepadMenuPrev=[];this.gamepadMenuRepeat=0;
      this.actionCooldown=0;this.attackFx=0;this.dodgeTimer=0;this.dodgeX=0;this.dodgeY=0;this.buildMode=null;this.buildGhost={x:0,y:0,valid:false};this.cameraFocus=null;this.coach=null;
      this.particles=[];this.projectiles=[];this.pickups=[];this.target=null;this.fishing=null;this.station=null;this.autosaveFailed=false;this.endingPlaying=false;
      this.lastPlayerX=0;this.lastPlayerY=0;this.lastMasteryCheck=0;
      this.lastFrameWork=0;this.forceRender=true;this.harvestHit=null;
      this.debug={lastError:null,frames:0,updates:0};
      this.dom={loading:$("#loading"),loadingText:$("#loadingText"),title:$("#titleScreen"),shell:$("#gameShell"),slots:$("#slotList"),
        backdrop:$("#modalBackdrop"),modal:$("#modal"),modalTitle:$("#modalTitle"),modalKicker:$("#modalKicker"),tabs:$("#modalTabs"),body:$("#modalBody"),footer:$("#modalFooter"),
        hint:$("#interactionHint"),toast:$("#toastStack"),feed:$("#pickupFeed"),hotbar:$("#hotbar"),mini:$("#miniMap canvas"),objective:$("#objectiveText"),objectiveProgress:$("#objectiveProgress"),
        buildHud:$("#buildHud"),fish:$("#fishingGame"),ending:$("#endingScreen"),touchSelected:$("#touchSelected"),coach:$("#coachOverlay")};
    }

    async init(){
      this.bindUI();LI.audio.preload();
      try{await Promise.all([this.loadImage(this.atlas),this.loadImage(this.combatSource),...Object.values(this.assets).map(image=>this.loadImage(image)),...Object.values(this.terrain).map(image=>this.loadImage(image))]);this.prepareCombatSheet();this.dom.loadingText.textContent="島の準備ができました！";}
      catch(error){this.debug.lastError=error;this.dom.loadingText.textContent="画像を読み込めませんでした。再読み込みしてください。";return;}
      this.resize();this.applySettings(LI.Save.loadSettings());this.hydrateUIIcons(document);this.renderSlots();
      setTimeout(()=>{this.dom.loading.classList.add("is-hidden");this.dom.title.classList.remove("is-hidden");},250);
      requestAnimationFrame(t=>this.frame(t));
    }
    loadImage(image){return new Promise((resolve,reject)=>{if(image.complete&&image.naturalWidth)return resolve();image.onload=resolve;image.onerror=()=>reject(new Error("sprite atlas load failed"));});}
    assetStyle(el,key){if(!el)return false;const src=this.assetPaths[key];if(!src)return false;el.textContent="";el.dataset.assetKey=key;el.style.backgroundImage=`url('${src}')`;el.style.backgroundRepeat="no-repeat";this.fitAssetBackground(el,key);requestAnimationFrame(()=>this.fitAssetBackground(el,key));return true;}
    fitAssetBackground(el,key=el?.dataset?.assetKey){
      const metric=this.assetMetrics[key];if(!el||!metric){if(el){el.style.backgroundSize="contain";el.style.backgroundPosition="center";}return;}
      const style=getComputedStyle(el),ew=el.clientWidth||parseFloat(style.width)||48,eh=el.clientHeight||parseFloat(style.height)||48;
      const [iw,ih]=metric.size,[bx,by,bw,bh]=metric.bbox,scale=Math.min(ew/bw,eh/bh);
      el.style.backgroundSize=`${iw*scale}px ${ih*scale}px`;
      el.style.backgroundPosition=`${(ew-bw*scale)/2-bx*scale}px ${(eh-bh*scale)/2-by*scale}px`;
    }
    setUIIcon(el,key){this.assetStyle(el,`ui_${key}`);}
    setBuildingIcon(el,key){this.assetStyle(el,`building_${D.buildings[key]?.art||key}`);}
    setWorldIcon(el,key){this.assetStyle(el,`world_${key}`);}
    hydrateUIIcons(root=document){root.querySelectorAll?.("[data-ui]").forEach(el=>this.setUIIcon(el,el.dataset.ui));root.querySelectorAll?.("[data-building]").forEach(el=>this.setBuildingIcon(el,el.dataset.building));root.querySelectorAll?.("[data-world]").forEach(el=>this.setWorldIcon(el,el.dataset.world));}
    drawAsset(key,x,y,height,alpha=1,rotation=0,maxWidth=Infinity,flipX=false){
      const image=this.assets[key];if(!image?.naturalWidth)return false;const metric=this.assetMetrics[key],crop=metric?.bbox||[0,0,image.naturalWidth,image.naturalHeight];
      const [sx,sy,sw,sh]=crop;let drawHeight=height,drawWidth=height*sw/sh;if(drawWidth>maxWidth){const fit=maxWidth/drawWidth;drawWidth*=fit;drawHeight*=fit;}
      const c=this.ctx;c.save();c.globalAlpha=alpha;c.translate(Math.round(x),Math.round(y));if(rotation)c.rotate(rotation);if(flipX)c.scale(-1,1);
      c.drawImage(image,sx,sy,sw,sh,Math.round(-drawWidth/2),Math.round(-drawHeight),Math.round(drawWidth),Math.round(drawHeight));c.restore();return true;
    }
    prepareCombatSheet(){
      const canvas=document.createElement("canvas"),width=768,height=512;canvas.width=width;canvas.height=height;const c=canvas.getContext("2d",{willReadFrequently:true});c.imageSmoothingEnabled=false;c.drawImage(this.combatSource,0,0,width,height);
      const image=c.getImageData(0,0,width,height),data=image.data,seen=new Uint8Array(width*height),queue=new Int32Array(width*height);let head=0,tail=0;
      const background=i=>{const p=i*4,r=data[p],g=data[p+1],b=data[p+2],min=Math.min(r,g,b),max=Math.max(r,g,b);return min>224&&max-min<22;};
      const add=i=>{if(i<0||i>=seen.length||seen[i]||!background(i))return;seen[i]=1;queue[tail++]=i;};
      for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}for(let y=1;y<height-1;y++){add(y*width);add(y*width+width-1);}
      while(head<tail){const i=queue[head++],x=i%width;if(x)add(i-1);if(x<width-1)add(i+1);add(i-width);add(i+width);}
      for(let i=0;i<seen.length;i++)if(seen[i])data[i*4+3]=0;c.putImageData(image,0,0);this.combatSheet=canvas;
      const cellW=width/4,cellH=height/2;this.combatBounds=Array.from({length:8},(_,cell)=>{const ox=(cell%4)*cellW,oy=Math.floor(cell/4)*cellH;let minX=cellW,minY=cellH,maxX=-1,maxY=-1;for(let y=0;y<cellH;y++)for(let x=0;x<cellW;x++)if(data[((oy+y)*width+ox+x)*4+3]>16){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}return maxX<0?[ox,oy,cellW,cellH]:[ox+minX,oy+minY,maxX-minX+1,maxY-minY+1];});
    }
    drawCombatCell(cell,x,y,height,alpha=1,rotation=0,maxWidth=Infinity){const image=this.combatSheet,b=this.combatBounds[cell];if(!image||!b)return false;const [sx,sy,sw,sh]=b;let h=height,w=h*sw/sh;if(w>maxWidth){const fit=maxWidth/w;w*=fit;h*=fit;}const c=this.ctx;c.save();c.globalAlpha=alpha;c.translate(Math.round(x),Math.round(y));if(rotation)c.rotate(rotation);c.drawImage(image,sx,sy,sw,sh,Math.round(-w/2),Math.round(-h/2),Math.round(w),Math.round(h));c.restore();return true;}

    bindUI(){
      document.body.appendChild(this.dom.backdrop);
      window.addEventListener("resize",()=>{this.resize();if(this.coach)this.positionCoach();});window.addEventListener("orientationchange",()=>{this.clearInput();setTimeout(()=>{this.resize();if(this.coach)this.positionCoach();},120);});
      window.addEventListener("keydown",e=>{
        if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)||(this.running&&e.code==="Tab"))e.preventDefault();
        if(!this.input.keys.has(e.code))this.input.pressed.add(e.code);this.input.keys.add(e.code);LI.audio.unlock();
        if(this.fishing&&["Space","Enter"].includes(e.code)){this.fishPull();return;}if(this.fishing&&e.code==="Escape"){this.endFishing(false);return;}
        if(e.code==="Escape"){if(this.coach)this.finishTutorial();else if(this.buildMode)this.cancelBuild();else if(this.panel)this.closePanel();else if(this.running)this.openPanel("pause");}
      });
      window.addEventListener("keyup",e=>this.input.keys.delete(e.code));window.addEventListener("blur",()=>{this.clearInput();if(this.running&&!this.panel&&!this.fishing)this.openPanel("pause",true);});
      document.addEventListener("visibilitychange",()=>{if(document.hidden&&this.running){this.safeSave(true);this.clearInput();if(!this.panel&&!this.fishing)this.openPanel("pause",true);}});
      this.canvas.addEventListener("pointermove",e=>this.pointerMove(e));this.canvas.addEventListener("pointerdown",e=>{LI.audio.unlock();this.pointerMove(e);this.input.pointerActive=true;if(this.buildMode){e.preventDefault();this.buildMode.hasPosition=true;this.updateBuildGhost(false);this.updateBuildHUD();}else if(e.pointerType==="mouse"&&e.button===0){this.doAction();}});
      this.canvas.addEventListener("pointerup",()=>this.input.pointerActive=false);this.canvas.addEventListener("pointercancel",()=>{this.input.pointerActive=false;this.clearInput();});
      this.canvas.addEventListener("contextmenu",e=>{e.preventDefault();this.dodge();});
      this.canvas.addEventListener("wheel",e=>{if(!this.running)return;e.preventDefault();this.state.selectedHotbar=(this.state.selectedHotbar+(e.deltaY>0?1:7))%8;this.renderHotbar();},{passive:false});
      $("#modalClose").addEventListener("click",()=>this.closePanel());this.dom.backdrop.addEventListener("pointerdown",e=>{if(e.target===this.dom.backdrop)this.closePanel();});
      $$('[data-panel]').forEach(b=>b.addEventListener("click",()=>this.openPanel(b.dataset.panel)));
      $("#miniMap").addEventListener("click",()=>this.openPanel("journal","map"));
      $("#cancelBuild").addEventListener("click",()=>this.cancelBuild());
      $("#buildPlace").addEventListener("click",()=>this.placeBuilding());
      $("#buildRotate").addEventListener("click",()=>this.rotateBuild());
      $("#touchRotate").addEventListener("pointerdown",e=>{e.preventDefault();this.rotateBuild();});
      $("#touchAction").addEventListener("pointerdown",e=>{e.preventDefault();LI.audio.unlock();this.doAction();this.vibrate(14);});
      $("#touchDodge").addEventListener("pointerdown",e=>{e.preventDefault();if(this.buildMode)this.cancelBuild();else this.dodge();});
      this.bindJoystick();
      $("#fishingButton").addEventListener("click",()=>this.fishPull());
      $("#fishTrack").addEventListener("pointerdown",()=>this.fishPull());
      $("#continueAfterEnding").addEventListener("click",()=>{this.dom.ending.classList.add("is-hidden");this.endingPlaying=false;this.paused=false;LI.audio.playMusic("meadow-day");});
      $("#openSettingsTitle").addEventListener("click",()=>this.openPanel("settings"));
      $("#openSaveTitle").addEventListener("click",()=>this.openPanel("save"));
      $("#openCredits").addEventListener("click",()=>this.openPanel("credits"));
      window.addEventListener("gamepadconnected",()=>this.status("ゲームパッドを接続しました"));
    }
    bindJoystick(){
      const joy=$("#joystick"),knob=joy.querySelector("span");let pointer=null;
      const move=e=>{if(e.pointerId!==pointer)return;const r=joy.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),m=Math.hypot(dx,dy),max=r.width*.34,n=m>max?max/m:1;this.input.joyX=dx/max*n;this.input.joyY=dy/max*n;knob.style.transform=`translate(${dx*n}px,${dy*n}px)`;};
      const end=e=>{if(e.pointerId!==pointer)return;pointer=null;this.input.joyX=this.input.joyY=0;knob.style.transform="";};
      joy.addEventListener("pointerdown",e=>{e.preventDefault();pointer=e.pointerId;joy.setPointerCapture(pointer);move(e);});joy.addEventListener("pointermove",move);joy.addEventListener("pointerup",end);joy.addEventListener("pointercancel",end);
    }
    clearInput(){this.input.keys.clear();this.input.pressed.clear();this.input.joyX=this.input.joyY=this.input.gamepadX=this.input.gamepadY=0;this.input.pointerActive=false;}
    pointerMove(e){const r=this.canvas.getBoundingClientRect();this.input.pointerSeen=true;this.input.pointerX=e.clientX-r.left;this.input.pointerY=e.clientY-r.top;this.input.pointerWorldX=this.camera.x+(this.input.pointerX-r.width/2)/this.scale;this.input.pointerWorldY=this.camera.y+(this.input.pointerY-r.height/2)/this.scale;if(this.buildMode)this.updateBuildGhost();}
    resize(){const r=this.canvas.getBoundingClientRect(),coarse=matchMedia("(pointer:coarse)").matches||r.width<=760,quality=this.state?.settings?.quality||LI.Save.loadSettings().quality;this.dpr=quality==="high"&&!coarse?Math.min(2,window.devicePixelRatio||1):1;this.scale=(quality==="low"?2:(r.width<620?2:3));this.canvas.width=Math.max(1,Math.round(r.width*this.dpr));this.canvas.height=Math.max(1,Math.round(r.height*this.dpr));this.viewW=r.width/this.scale;this.viewH=r.height/this.scale;this.ctx.imageSmoothingEnabled=false;this.terrainPatterns={};this.forceRender=true;}

    renderSlots(){
      this.dom.slots.innerHTML="";
      for(let slot=1;slot<=3;slot++){
        const info=LI.Save.slotInfo(slot),b=document.createElement("button");b.type="button";b.className="slot-button";
        if(info.empty){b.innerHTML=`<strong>スロット ${slot}</strong><span>${info.broken?"データを読み取れません":"新しい島を始める"}</span><em>${info.broken?"修復":"NEW"}</em>`;}
        else{const h=Math.floor(info.playSeconds/3600),m=Math.floor(info.playSeconds/60)%60;b.innerHTML=`<strong>スロット ${slot} · ${info.day}日目</strong><span>灯台 ${info.stage}/4 · ${h}時間${m}分 · ${this.escape(info.seedText)}</span><em>続きから</em>`;}
        b.addEventListener("click",()=>{if(info.broken)this.openPanel("save");else if(info.empty)this.openNewGame(slot);else this.continueSlot(slot);});this.dom.slots.appendChild(b);
      }
    }
    openNewGame(slot){const seed=`SUN-${Date.now().toString(36).slice(-5).toUpperCase()}`;this.openCustom(`スロット ${slot} に新しい島`,`NEW ISLAND`,`<div class="details-card"><h3>島のシード</h3><p>同じ文字なら同じ地形になります。変更しなくても遊べます。</p><input id="newSeed" value="${seed}" maxlength="32" style="width:100%;padding:10px;border:2px solid var(--ink);border-radius:5px;text-transform:uppercase"><div class="save-actions" style="margin-top:12px"><button id="randomSeed" type="button">おまかせを更新</button><button id="beginIsland" type="button">この島で始める</button></div></div>`);$("#randomSeed").onclick=()=>$("#newSeed").value=`SUN-${Math.random().toString(36).slice(2,7).toUpperCase()}`;$("#beginIsland").onclick=()=>{const value=$("#newSeed").value.trim();this.closePanel();this.startNew(slot,value);};}
    startNew(slot,seedText=""){
      const state=LI.Save.newState(slot,seedText||`SUN-${Date.now().toString(36).slice(-5).toUpperCase()}`);const saved=LI.Save.save(slot,state);
      if(!saved.ok){this.openPanel("save");return;}this.startGame(saved.state,false);
    }
    continueSlot(slot){const result=LI.Save.load(slot);if(!result.state){this.openPanel("save");return;}this.startGame(result.state,result.recovered);}
    startGame(state,recovered=false){
      this.state=state;this.normalizeState();this.slot=state.slot;this.applySettings({...LI.Save.loadSettings(),...state.settings});this.world=W.generate(state);this.station=null;this.projectiles=[];this.particles=[];this.pickups=[];this.camera.x=state.player.x;this.camera.y=state.player.y;
      this.lastPlayerX=state.player.x;this.lastPlayerY=state.player.y;this.ensureDailyContent();this.applyUpgradeEffects();
      this.dom.title.classList.add("is-hidden");this.dom.shell.classList.remove("is-hidden");this.running=true;this.paused=false;this.last=performance.now();this.resize();this.renderHotbar();this.updateHUD(true);this.drawMiniMap();
      this.hydrateUIIcons(document);LI.audio.unlock();LI.audio.playMusic(this.phase()==="night"?"lantern-dusk":"meadow-day");if(recovered)this.toast("バックアップからセーブを復元しました","warn");else if(state.progress.tutorialDone)this.status("ルミナ島へようこそ");this.canvas.focus();
      if(!state.progress.tutorialDone)setTimeout(()=>{if(this.running&&!this.panel)this.openTutorial(0);},260);
    }
    normalizeState(){const s=this.state;s.hotbar=Array.from({length:8},(_,i)=>{const key=s.hotbar?.[i];return key&&(s.inventory[key]||0)>0?key:null;});s.selectedHotbar=clamp(Number(s.selectedHotbar)||0,0,7);s.progress.enemyTrophies=s.progress.enemyTrophies||{};for(const b of s.buildings){const size=D.buildings[b.type]?.size||[b.w||1,b.h||1],[w,h]=(b.rotation||0)%2?[size[1],size[0]]:size;b.w=w;b.h=h;}if(s.recovery&&!Object.values(s.recovery.items||{}).some(n=>n>0))s.recovery=null;}
    returnTitle(){if(this.running)this.safeSave(true);this.running=false;this.paused=true;LI.audio.stopAll();this.dom.shell.classList.add("is-hidden");this.dom.title.classList.remove("is-hidden");this.closePanel();this.renderSlots();}

    frame(now){
      try{
        const coarse=matchMedia("(pointer:coarse)").matches||this.canvas.clientWidth<=760,fps=this.running&&this.state?.settings?.quality==="high"&&!coarse?60:this.running?30:15,interval=1000/fps;if(this.lastFrameWork&&now-this.lastFrameWork<interval*.88){requestAnimationFrame(t=>this.frame(t));return;}this.lastFrameWork=now;
        const raw=Math.min(.1,Math.max(0,(now-this.last)/1000||0));this.last=now;
        const step=fps===60?1/60:1/30;if(this.running&&!this.paused){this.acc+=raw;while(this.acc>=step){this.update(step);this.acc-=step;}}else if(this.running&&this.panel)this.updateMenuGamepad(now);
        if(this.fishing)this.updateFishing(raw);if(this.running&&(!this.paused||this.forceRender||this.fishing)){this.render(now/1000);this.forceRender=false;}this.debug.frames++;
      }catch(error){this.debug.lastError=error;console.error(error);this.paused=true;this.toast("処理中に問題が起きました。セーブして再開してください。","warn");}
      requestAnimationFrame(t=>this.frame(t));
    }
    update(dt){
      this.debug.updates++;this.state.playSeconds+=dt;this.saveTimer+=dt;this.hudTimer+=dt;this.mapTimer+=dt;
      this.pollGamepad();this.updateMovement(dt);this.updateEnemies(dt);this.updateProjectiles(dt);this.updateParticles(dt);this.updateTime(dt);this.updateObjective();
      if(this.actionCooldown>0)this.actionCooldown-=dt;if(this.attackFx>0)this.attackFx-=dt;if(this.state.player.invulnerable>0)this.state.player.invulnerable-=dt;if(this.dodgeTimer>0)this.dodgeTimer-=dt;
      this.target=this.findTarget();W.explore(this.state,this.state.player.x,this.state.player.y);this.updateRegion();
      const focus=this.cameraFocus&&this.state.playSeconds<this.cameraFocus.until?this.cameraFocus:null;if(!focus)this.cameraFocus=null;this.camera.x=lerp(this.camera.x,focus?.x??this.state.player.x,focus?.x!=null?0.2:0.12);this.camera.y=lerp(this.camera.y,focus?.y??this.state.player.y,focus?.y!=null?0.2:0.12);this.camera.shakeX*=.78;this.camera.shakeY*=.78;
      if(this.hudTimer>.12){this.hudTimer=0;this.updateHUD();}if(this.mapTimer>1){this.mapTimer=0;this.drawMiniMap();this.checkProgressSystems();}if(this.saveTimer>=30){this.saveTimer=0;this.safeSave(false);}
      if(this.consumePressed("KeyE")||this.consumePressed("Space"))this.doAction();
      if(this.consumePressed("ShiftRight")||this.consumePressed("KeyK"))this.dodge();
      if(this.consumePressed("KeyI")||this.consumePressed("Tab"))this.openPanel("inventory");
      if(this.consumePressed("KeyC"))this.openPanel("craft");if(this.consumePressed("KeyB"))this.openPanel("build");if(this.consumePressed("KeyM"))this.openPanel("journal","map");if(this.consumePressed("KeyJ"))this.openPanel("journal");if(this.consumePressed("KeyP"))this.openPanel("pause");
      for(let i=0;i<8;i++)if(this.consumePressed(`Digit${i+1}`)){this.state.selectedHotbar=i;this.renderHotbar();}
      if(this.consumePressed("GamepadLB")){this.state.selectedHotbar=(this.state.selectedHotbar+7)%8;this.renderHotbar();}if(this.consumePressed("GamepadRB")){this.state.selectedHotbar=(this.state.selectedHotbar+1)%8;this.renderHotbar();}
      if(this.buildMode&&this.consumePressed("KeyR"))this.rotateBuild();
      this.input.pressed.clear();
    }
    consumePressed(code){if(!this.input.pressed.has(code))return false;this.input.pressed.delete(code);return true;}
    pollGamepad(){
      const gp=navigator.getGamepads?.()[0];if(!gp){this.input.gamepadX=this.input.gamepadY=0;return;}
      this.input.gamepadX=Math.abs(gp.axes[0]||0)>.18?gp.axes[0]:0;this.input.gamepadY=Math.abs(gp.axes[1]||0)>.18?gp.axes[1]:0;
      const press=(i,key)=>{if(gp.buttons[i]?.pressed){if(!this.input.keys.has(key))this.input.pressed.add(key);this.input.keys.add(key);}else this.input.keys.delete(key);};
      press(0,"KeyE");press(1,"KeyK");press(3,"KeyI");press(4,"GamepadLB");press(5,"GamepadRB");press(9,"KeyP");
    }
    updateMenuGamepad(now){
      const gp=navigator.getGamepads?.()[0];if(!gp)return;const down=i=>!!gp.buttons[i]?.pressed,edge=i=>down(i)&&!this.gamepadMenuPrev[i];
      if(edge(1)||edge(9)){this.closePanel();this.gamepadMenuPrev=gp.buttons.map(b=>b.pressed);return;}
      const focusables=Array.from(this.dom.modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')).filter(el=>el.offsetParent!==null);let current=focusables.indexOf(document.activeElement),move=0;
      const axisY=gp.axes[1]||0,axisX=gp.axes[0]||0,direction=edge(13)||edge(15)||axisY>.65||axisX>.65?1:edge(12)||edge(14)||axisY<-.65||axisX<-.65?-1:0;
      if(direction&&(now>this.gamepadMenuRepeat)){move=direction;this.gamepadMenuRepeat=now+180;}if(move&&focusables.length){current=(current+move+focusables.length)%focusables.length;focusables[current].focus();}
      if(edge(0)){if(current<0&&focusables.length)focusables[0].focus();else document.activeElement?.click?.();}
      if(edge(4)||edge(5)){const tabs=Array.from(this.dom.tabs.querySelectorAll('button:not(:disabled)'));if(tabs.length){let i=tabs.indexOf(document.activeElement);i=(i+(edge(5)?1:-1)+tabs.length)%tabs.length;tabs[i].focus();tabs[i].click();}}
      this.gamepadMenuPrev=gp.buttons.map(b=>b.pressed);
    }
    updateMovement(dt){
      const p=this.state.player;let x=(this.input.keys.has("KeyD")||this.input.keys.has("ArrowRight")?1:0)-(this.input.keys.has("KeyA")||this.input.keys.has("ArrowLeft")?1:0),y=(this.input.keys.has("KeyS")||this.input.keys.has("ArrowDown")?1:0)-(this.input.keys.has("KeyW")||this.input.keys.has("ArrowUp")?1:0);
      x+=this.input.joyX+this.input.gamepadX;y+=this.input.joyY+this.input.gamepadY;let len=Math.hypot(x,y);if(len>.05){x/=Math.max(1,len);y/=Math.max(1,len);this.setDirection(x,y);}
      const sprint=(this.input.keys.has("ShiftLeft")||this.state.settings.autoRun)&&p.stamina>2&&len>.2&&!this.dodgeTimer;const speedBonus=this.state.progress.upgrades.runner?1.12:1;let speed=(sprint?82:55)*speedBonus;
      if(sprint)p.stamina=Math.max(0,p.stamina-18*dt);else p.stamina=Math.min(p.maxStamina+(p.buffUntil>this.state.playSeconds?20:0),p.stamina+27*dt);
      if(this.dodgeTimer>0){x=this.dodgeX;y=this.dodgeY;speed=142;}
      const nx=p.x+x*speed*dt,ny=p.y+y*speed*dt;
      if(W.passable(this.world,this.state,nx,p.y)&&W.passable(this.world,this.state,nx+Math.sign(x)*5,p.y))p.x=nx;
      if(W.passable(this.world,this.state,p.x,ny)&&W.passable(this.world,this.state,p.x,ny+Math.sign(y)*5))p.y=ny;
      p.moving=len>.08;p.anim=(p.anim||0)+(p.moving?dt*8:0);const moved=Math.hypot(p.x-this.lastPlayerX,p.y-this.lastPlayerY);if(Number.isFinite(moved)&&moved<20)this.state.stats.distance+=moved;this.lastPlayerX=p.x;this.lastPlayerY=p.y;this.input.pointerWorldX=this.camera.x+(this.input.pointerX-this.canvas.clientWidth/2)/this.scale;this.input.pointerWorldY=this.camera.y+(this.input.pointerY-this.canvas.clientHeight/2)/this.scale;
    }
    setDirection(x,y){const a=Math.atan2(y,x),i=(Math.round(a/(Math.PI/4))+8)%8,dirs=["right","down_right","down","down_left","left","up_left","up","up_right"];this.state.player.dir=dirs[i];}
    dodge(){
      if(!this.running||this.paused||this.dodgeTimer>0||this.state.player.stamina<20)return;let{x,y}=this.moveVector();if(Math.hypot(x,y)<.1){const a=this.directionAngle();x=Math.cos(a);y=Math.sin(a);}this.dodgeX=x;this.dodgeY=y;this.dodgeTimer=.28;this.state.player.invulnerable=.42+this.masteryLevel("combat")*.015;this.state.player.stamina-=20;this.state.stats.dodges++;LI.audio.effect("dodge");this.burst(this.state.player.x,this.state.player.y,"#72d6b3",8);this.checkProgressSystems();
    }
    moveVector(){let x=(this.input.keys.has("KeyD")||this.input.keys.has("ArrowRight")?1:0)-(this.input.keys.has("KeyA")||this.input.keys.has("ArrowLeft")?1:0)+this.input.joyX+this.input.gamepadX,y=(this.input.keys.has("KeyS")||this.input.keys.has("ArrowDown")?1:0)-(this.input.keys.has("KeyW")||this.input.keys.has("ArrowUp")?1:0)+this.input.joyY+this.input.gamepadY,m=Math.hypot(x,y);return m?{x:x/m,y:y/m}:{x:0,y:0};}
    directionAngle(){return {right:0,down_right:Math.PI/4,down:Math.PI/2,down_left:3*Math.PI/4,left:Math.PI,up_left:-3*Math.PI/4,up:-Math.PI/2,up_right:-Math.PI/4}[this.state.player.dir]||0;}

    updateTime(dt){
      const s=this.state,p=s.player,rate=s.settings.needsRate||1;s.clock+=dt;p.food=Math.max(0,p.food-dt*.105*rate);p.water=Math.max(0,p.water-dt*.115*rate);
      if((p.food<=0||p.water<=0)&&p.invulnerable<=0){p.hp-=dt*1.6;if(p.hp<=0)this.knockout();}
      if(s.clock>=720)this.newDay(false);
      const phase=this.phase(),wanted=this.world.enemies.some(e=>e.state!=="dead"&&D.enemies[e.type].boss&&Math.hypot(e.x-p.x,e.y-p.y)<100)?"guardian":phase==="night"?"lantern-dusk":"meadow-day";if(LI.audio.wanted!==wanted)LI.audio.playMusic(wanted);
    }
    clockHour(){return ((6*60+(this.state?.clock||0)*2)%(24*60))/60;}
    phase(){const hour=this.clockHour();return hour>=5&&hour<9?"morning":hour>=9&&hour<17?"day":hour>=17&&hour<20?"dusk":"night";}
    lightProfile(){const hour=this.clockHour(),sun=Math.sin((hour-6)/12*Math.PI),daylight=smoothstep(-.12,.28,sun),darkness=(1-daylight)*.4,evening=hour>=15&&hour<=22?Math.exp(-Math.pow((hour-18.4)/1.45,2))*.13:0,dawn=hour<=9?Math.exp(-Math.pow((hour-5.8)/1.25,2))*.08:0;return{hour,daylight,darkness,evening,dawn,nightStrength:clamp((darkness-.08)/.32,0,1)};}
    newDay(fromSleep){
      const s=this.state;s.day++;s.clock=fromSleep?35:s.clock-720;s.stats.passedNights++;
      const r=new W.RNG((s.seed^Math.imul(s.day,2654435761))>>>0).next();s.weather=r<.7?"sunny":r<.9?"rain":"glow";
      Object.keys(s.removedResources).forEach(id=>{if(s.removedResources[id]<=s.day)delete s.removedResources[id];});
      const sprinklers=s.buildings.filter(b=>D.buildings[b.type]?.autoWater),greenhouses=s.buildings.filter(b=>D.buildings[b.type]?.greenhouse);let forestRestored=0;
      s.buildings.forEach(b=>{if(b.type==="plot"&&b.crop){const px=(b.x+.5)*W.TILE,py=(b.y+.5)*W.TILE,auto=sprinklers.some(o=>Math.hypot((o.x+.5)*W.TILE-px,(o.y+.5)*W.TILE-py)<=D.buildings[o.type].autoWater*W.TILE),warm=greenhouses.some(o=>Math.hypot((o.x+o.w/2)*W.TILE-px,(o.y+o.h/2)*W.TILE-py)<=D.buildings[o.type].greenhouse*W.TILE);if(b.watered||s.weather==="rain"||auto||warm)b.stage=Math.min(3,(b.stage||0)+1);if(b.stage>=3&&b.forestOffering&&!b.forestCounted){b.forestCounted=true;s.progress.forestPlanted++;forestRestored++;}b.watered=false;}});
      this.world.enemies.forEach(e=>{if(e.deadUntil&&e.deadUntil<=s.day&&!D.enemies[e.type].boss){e.hp=e.maxHp;e.deadUntil=0;e.state="idle";e.x=e.homeX;e.y=e.homeY;}});
      if(s.progress.lighthouseStage>=4&&s.progress.postgameRewardDay<s.day){this.addItem("light_shard",s.progress.upgrades.beacon?2:1,false);s.progress.postgameRewardDay=s.day;}
      this.ensureDailyContent(true);
      this.unlock("first_night");if(s.day>=10)this.unlock("day10");if(fromSleep){s.player.hp=s.player.maxHp;s.player.food=Math.max(55,s.player.food);s.player.water=Math.max(60,s.player.water);LI.audio.effect("sleep");}
      this.safeSave(true);this.status(`${s.day}日目の朝 · ${D.weather.find(w=>w.id===s.weather)?.name||"晴れ"}`);if(forestRestored)this.status(`森で育った植物 ${s.progress.forestPlanted}/3 · こもれびの祠へ光が届いた`);
    }

    findTarget(){
      const p=this.state.player,candidates=[],held=this.currentItem(),enemyReach=held?.tool==="weapon"?(held.power>=4?42:held.power>1?36:31):22;
      for(const r of this.world.resources)if(W.activeResource(this.state,r)){const d=Math.hypot(r.x-p.x,r.y-p.y);if(d<27)candidates.push({kind:"resource",obj:r,d});}
      for(const l of this.world.landmarks){const d=Math.hypot(l.x-p.x,l.y-p.y);if(d<(l.type==="lighthouse"?42:28))candidates.push({kind:"landmark",obj:l,d});}
      for(const b of this.state.buildings){const bx=(b.x+b.w/2)*W.TILE,by=(b.y+b.h/2)*W.TILE,d=Math.hypot(bx-p.x,by-p.y);if(d<30)candidates.push({kind:"building",obj:b,d});}
      if(this.state.recovery){const d=Math.hypot(this.state.recovery.x-p.x,this.state.recovery.y-p.y);if(d<30)candidates.push({kind:"recovery",obj:this.state.recovery,d});}
      for(const e of this.world.enemies)if(!e.deadUntil){const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<enemyReach+(D.enemies[e.type].boss?8:0))candidates.push({kind:"enemy",obj:e,d});}
      return candidates.sort((a,b)=>a.d-b.d)[0]||null;
    }
    currentKey(){const key=this.state.hotbar[this.state.selectedHotbar];return key&&(this.state.inventory[key]||0)>0?key:null;}
    currentItem(){return D.items[this.currentKey()]||null;}
    doAction(){
      if(!this.running||this.paused||this.actionCooldown>0)return;if(this.buildMode){this.placeBuilding();return;}
      const key=this.currentKey(),item=D.items[key];
      if(this.target?.kind==="recovery"){this.recoverLostItems();return;}
      if(this.target?.kind==="resource"){this.discover(`resource:${this.target.obj.type}`);this.harvest(this.target.obj);return;}
      if(this.target?.kind==="landmark"){this.discover(`landmark:${this.target.obj.id}`);this.useLandmark(this.target.obj);return;}
      if(this.target?.kind==="building"){if(item?.tool==="hammer")this.confirmDismantle(this.target.obj);else this.useBuilding(this.target.obj);return;}
      if(this.target?.kind==="enemy"||item?.tool==="weapon"){this.attack();return;}
      if(item?.food||item?.water||item?.heal){this.consumeItem(key);return;}
      if(item?.tool==="rod"){if(this.nearWater())this.startFishing();else this.status("釣り竿は水辺で使えます");return;}
      if(item?.tool==="hammer"){this.openPanel("build");return;}
    }
    vibrate(ms=15){if(this.state?.settings?.vibration&&navigator.vibrate)navigator.vibrate(ms);}
    nearWater(){const p=this.state.player;for(let oy=-20;oy<=20;oy+=10)for(let ox=-20;ox<=20;ox+=10){const t=W.tileAt(this.world,p.x+ox,p.y+oy);if(t===W.TILE_ID.shallow||t===W.TILE_ID.sea)return true;}return false;}
    harvest(r){
      const tool=this.currentItem()?.tool||"hand";
      if(r.tool!=="hand"&&tool!==r.tool){this.toast(r.tool==="axe"?"斧を選ぶと切れます":"つるはしを選ぶと掘れます","warn");LI.audio.effect("ui_cancel");this.actionCooldown=.25;return;}
      const power=Math.max(1,this.currentItem()?.power||1);r.hp-=power;this.actionCooldown=.28;const sound=r.tool==="axe"?"chop":r.tool==="pickaxe"?"mine":"pickup";LI.audio.effect(sound,.94+Math.random()*.1);
      const colors={tree:"#4faf72",stump:"#c98b5b",berry_bush:"#ef6a67",rock:"#9da7b8",loose_stone:"#b8bfca",ore:"#d87951",crystal:"#71dce1",branch:"#c98b5b",fiber:"#93d96b",shell:"#fff4c7",herb:"#72d6b3",resin:"#f7a24b",sunroot:"#ffd166",moonbean:"#a99be8",tide_melon:"#71dce1"};this.impactBurst(r.x,r.y-6,colors[r.type]||"#ffd166",r.tool);this.harvestHit={id:r.id,until:this.state.playSeconds+.18};
      if(r.hp<=0){if(this.resourceDrops(r)){r.hp=r.maxHp;this.state.removedResources[r.id]=this.state.day+r.respawn;}else r.hp=1;}
    }
    resourceDrops(r){
      const drops={branch:{branch:1},loose_stone:{stone:1},fiber:{fiber:2},berry_bush:{berry:3,seed:1},tree:{wood:5,resin:Math.random()<.45?1:0},stump:{wood:3,resin:1},rock:{stone:4},ore:{ore:3,stone:1},crystal:{crystal:2,stone:1},shell:{shell:1},herb:{herb:2},resin:{resin:1},sunroot:{sunroot:1,seed:1},moonbean:{moonbean:2,moonbean_seed:1},tide_melon:{tide_melon:2,tide_seed:1}}[r.type]||{};
      const biome=W.biomeAt(this.world,this.state,r.x,r.y),gatherLv=this.masteryLevel("gather");
      if(r.tool==="hand"&&this.state.progress.upgrades.forager&&Math.random()<.45)drops[r.type==="shell"?"herb":"fiber"]=(drops[r.type==="shell"?"herb":"fiber"]||0)+1;
      if(["tree","stump"].includes(r.type)&&this.state.progress.upgrades.logger)drops.wood+=1;if(["rock","ore","crystal"].includes(r.type)&&this.state.progress.upgrades.miner)drops[r.type==="ore"?"ore":"stone"]=(drops[r.type==="ore"?"ore":"stone"]||0)+1;
      if(Math.random()<gatherLv*.025){const bonusKey=Object.keys(drops).find(k=>drops[k]>0);if(bonusKey)drops[bonusKey]++;}
      if(r.type==="berry_bush"&&biome==="forest"&&Math.random()<.3)drops.moonbean_seed=1;if(r.type==="shell"&&Math.random()<.28)drops.tide_seed=1;if(r.type==="shell"&&Math.random()<.45)drops.herb=1;
      if(!this.canCarryDrops(drops)){this.toast(`バッグがいっぱいです（${this.inventorySlotsUsed()}/${this.inventoryLimit()}枠）。木箱へ預けよう`,"warn");return false;}
      Object.entries(drops).forEach(([key,count])=>{if(count)this.addItem(key,count);});this.state.stats.gathered+=Object.values(drops).reduce((a,b)=>a+b,0);
      this.updateObjective(true);this.checkProgressSystems();return true;
    }
    inventoryLimit(){return 24;}
    inventorySlotsUsed(){return Object.values(this.state.inventory).filter(n=>n>0).length;}
    canAddItem(key){return(this.state.inventory[key]||0)>0||this.inventorySlotsUsed()<this.inventoryLimit();}
    canCarryDrops(drops){const fresh=Object.entries(drops).filter(([key,count])=>count>0&&!(this.state.inventory[key]>0)).length;return this.inventorySlotsUsed()+fresh<=this.inventoryLimit();}
    addItem(key,count=1,show=true){if(!D.items[key]||count<=0)return false;if(!this.canAddItem(key)){if(show)this.toast(`バッグがいっぱいです（${this.inventorySlotsUsed()}/${this.inventoryLimit()}枠）`,"warn");return false;}this.state.inventory[key]=(this.state.inventory[key]||0)+count;if(D.items[key].unique)this.state.inventory[key]=1;if(show){if(key==="branch")this.state.stats.gatheredBranch+=count;if(key==="stone")this.state.stats.gatheredStone+=count;this.pickup(`${D.items[key].name} +${count}`);}if(D.items[key].unique&&!this.state.hotbar.includes(key)){const empty=this.state.hotbar.findIndex(k=>!k);if(empty>=0)this.state.hotbar[empty]=key;}this.renderHotbar();return true;}
    removeItem(key,count=1){if((this.state.inventory[key]||0)<count)return false;this.state.inventory[key]-=count;if(this.state.inventory[key]<=0){delete this.state.inventory[key];this.state.hotbar=this.state.hotbar.map(k=>k===key?null:k);}this.renderHotbar();return true;}
    consumeItem(key){
      const item=D.items[key];if(!item||!this.removeItem(key,1))return;const p=this.state.player,before=p.hp;p.food=clamp(p.food+(item.food||0),0,100);p.water=clamp(p.water+(item.water||0),0,100);p.hp=clamp(p.hp+(item.heal||0),0,p.maxHp);if(item.staminaBuff)p.buffUntil=this.state.playSeconds+item.staminaBuff;if(item.glow)p.glowUntil=this.state.playSeconds+item.glow;if(item.heal)this.status(`${item.name}: 体力 +${Math.round(p.hp-before)}`);LI.audio.effect(item===D.items.water?"pickup":"cook");
    }
    attack(){
      if(this.actionCooldown>0)return;const p=this.state.player,key=this.currentKey(),item=D.items[key],weapon=item?.tool==="weapon"?item:null;let angle=this.directionAngle();
      const range=weapon?(weapon.power>=4?42:weapon.power>1?36:31):22,baseDamage=weapon?(weapon.power>=4?34:weapon.power>1?22:12):4,damage=baseDamage*(1+this.masteryLevel("combat")*.025)*(this.state.progress.upgrades.guardian?1.25:1);let hits=0;
      const contextual=this.target?.kind==="enemy"&&Math.hypot(this.target.obj.x-p.x,this.target.obj.y-p.y)<=range+(D.enemies[this.target.obj.type].boss?8:0)?this.target.obj:null;
      if(contextual){angle=Math.atan2(contextual.y-p.y,contextual.x-p.x);this.setDirection(Math.cos(angle),Math.sin(angle));}
      else if(this.input.pointerSeen&&matchMedia("(pointer:fine)").matches&&Number.isFinite(this.input.pointerWorldX)){angle=Math.atan2(this.input.pointerWorldY-p.y,this.input.pointerWorldX-p.x);this.setDirection(Math.cos(angle),Math.sin(angle));}
      for(const e of this.world.enemies){if(e.deadUntil)continue;const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy),dot=(dx*Math.cos(angle)+dy*Math.sin(angle))/Math.max(1,d);if(d<=range+(D.enemies[e.type].boss?8:0)&&dot>.15){this.damageEnemy(e,damage);hits++;}}
      this.attackFx=.18;this.attackAngle=angle;this.actionCooldown=weapon?.power>1?.34:.42;LI.audio.effect("attack",weapon?.power>1?1.08:1);if(!hits)this.burst(p.x+Math.cos(angle)*18,p.y+Math.sin(angle)*18,"#fff4c7",3);
    }
    damageEnemy(e,damage){
      this.discover(`enemy:${e.type}`);e.hp-=damage;e.hitFlash=.13;if(e.state!=="attack"){e.state="chase";e.cooldown=Math.max(e.cooldown||0,.15);}this.burst(e.x,e.y-6,"#fff4c7",6);this.shake(1.4);LI.audio.effect("hit",1.05);
      if(e.hp<=0)this.calmEnemy(e);
    }
    calmEnemy(e){
      const def=D.enemies[e.type];e.deadUntil=def.boss?99999:this.state.day+1;e.state="dead";this.state.stats.enemiesCalmed++;this.burst(e.x,e.y-8,def.boss?"#ffd166":"#72d6b3",def.boss?28:12);LI.audio.effect("discover",def.boss?.85:1.15);
      Object.entries(def.drop||{}).forEach(([key,range])=>{const count=range[0]+Math.floor(Math.random()*(range[1]-range[0]+1));if(count&&!this.addItem(key,count))this.addRecoveryItem(key,count,e.x,e.y);});
      if(!this.state.progress.enemyTrophies[e.type]){this.state.progress.enemyTrophies[e.type]=true;this.state.progress.sunBadges++;this.status(`初めて${def.name}を鎮めた · 記章 +1`);}
      if(e.type==="forest_warden")this.grantPrism("forest");if(e.type==="stone_warden")this.grantPrism("rock");
      if(def.boss){if(this.bossStartDamage===this.state.stats.damageTaken)this.unlock("no_hit");this.bossStartDamage=null;}this.checkAchievements();
    }
    damagePlayer(amount){
      const p=this.state.player;if(this.isPlayerProtected()||p.invulnerable>0||this.dodgeTimer>0)return;p.hp-=amount*(this.state.settings.enemyDamage||1);p.invulnerable=1;this.state.stats.damageTaken+=amount;this.shake(3);LI.audio.effect("hit",.82);this.burst(p.x,p.y-7,"#ef6a67",10);if(p.hp<=0)this.knockout();
    }
    isPlayerProtected(){return !this.state.progress.tutorialDone;}
    knockout(){
      const p=this.state.player;this.state.stats.knockouts++;const lost=this.dropOnKnockout();p.x=p.spawnX;p.y=p.spawnY;p.hp=p.maxHp;p.food=Math.max(45,p.food);p.water=Math.max(50,p.water);p.invulnerable=2;this.newDay(true);this.toast(lost?`朝、休んだ場所で目覚めた。倒れた場所の回収袋に${lost}枠分を落とした`:"朝、最後に休んだ場所で目を覚ましました","warn");
    }
    addRecoveryItem(key,count,x=this.state.player.x,y=this.state.player.y){if(count<=0)return;if(!this.state.recovery)this.state.recovery={x,y,items:{}};this.state.recovery.items[key]=(this.state.recovery.items[key]||0)+count;}
    dropOnKnockout(){if(this.state.recovery)return 0;const p=this.state.player,candidates=Object.entries(this.state.inventory).filter(([key,count])=>count>=3&&!D.items[key]?.tool&&!D.items[key]?.key&&!D.items[key]?.unique).sort((a,b)=>b[1]-a[1]).slice(0,4);if(!candidates.length)return 0;this.state.recovery={x:p.x,y:p.y,items:{}};for(const [key,count] of candidates){const lost=Math.max(1,Math.floor(count*.15));this.removeItem(key,lost);this.state.recovery.items[key]=lost;}return candidates.length;}
    recoverLostItems(){const bag=this.state.recovery;if(!bag)return;let recovered=0;for(const [key,count] of Object.entries({...bag.items})){if(!this.canAddItem(key))continue;if(this.addItem(key,count,false)){delete bag.items[key];recovered++;}}if(!Object.keys(bag.items).length)this.state.recovery=null;this.status(recovered?`回収袋から${recovered}種類を取り戻した`:"バッグがいっぱいで回収できない");LI.audio.effect(recovered?"pickup":"ui_cancel");this.safeSave(false);}
    updateEnemies(dt){
      const p=this.state.player;
      for(const e of this.world.enemies){
        if(e.deadUntil)continue;const def=D.enemies[e.type];e.hitFlash=Math.max(0,(e.hitFlash||0)-dt);e.cooldown=Math.max(0,(e.cooldown||0)-dt);const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy);
        if(this.isPlayerProtected()){e.state="idle";e.attackTimer=0;e.x=lerp(e.x,e.homeX,dt*.8);e.y=lerp(e.y,e.homeY,dt*.8);continue;}
        if(e.state==="attack"){
          e.attackTimer-=dt;if(e.attackTimer<=0){this.resolveEnemyAttack(e,def,dx,dy,d);e.state="chase";e.cooldown=def.boss?1.0:1.35;}continue;
        }
        const aggro=def.boss?135:92;if(d<aggro){if(def.boss&&this.bossStartDamage==null)this.bossStartDamage=this.state.stats.damageTaken;if(e.cooldown<=0&&d<def.range){e.state="attack";e.attackTimer=def.notice;e.telegraphAngle=Math.atan2(dy,dx);continue;}
          const speed=def.speed*(d>def.range*.78?1:0);if(speed){const nx=e.x+dx/Math.max(1,d)*speed*dt,ny=e.y+dy/Math.max(1,d)*speed*dt;if(W.passable(this.world,this.state,nx,ny)){e.x=nx;e.y=ny;}else e.state="idle";}
        }else if(Math.hypot(e.x-e.homeX,e.y-e.homeY)>8){e.x=lerp(e.x,e.homeX,dt*.55);e.y=lerp(e.y,e.homeY,dt*.55);}
        e.timer=(e.timer||0)+dt;
      }
    }
    resolveEnemyAttack(e,def,dx,dy,d){
      const a=e.telegraphAngle||Math.atan2(dy,dx),shot=(angle,speed,kind,damage=def.damage,life=2.2)=>{const cells={seed:4,crystal:5,bubble:6};this.projectiles.push({x:e.x,y:e.y-5,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life,maxLife:life,damage,r:kind==="bubble"?5:4,kind,spriteCell:cells[kind],angle});};
      if(def.attack==="seed")shot(a,66,"seed");
      else if(def.attack==="bubble")shot(a,54,"bubble");
      else if(def.attack==="crystal")for(let i=-1;i<=1;i++)shot(a+i*.18,64,"crystal",def.damage*.8);
      else if(def.attack==="crystal_burst")for(let i=0;i<7;i++)shot(i/7*Math.PI*2,56,"crystal");
      else if(def.attack==="forest")for(let i=-1;i<=1;i++)shot(a+i*.42,54,"seed",def.damage*.7,2);
      else if(def.attack==="charge"){e.x+=Math.cos(a)*18;e.y+=Math.sin(a)*18;if(Math.hypot(this.state.player.x-e.x,this.state.player.y-e.y)<22)this.damagePlayer(def.damage);}
      else if(d<def.range+10)this.damagePlayer(def.damage);
    }
    updateProjectiles(dt){
      const p=this.state.player;
      for(const q of this.projectiles){q.x+=q.vx*dt;q.y+=q.vy*dt;q.life-=dt;if(q.life>0&&Math.hypot(q.x-p.x,q.y-p.y)<q.r+6){this.damagePlayer(q.damage);q.life=0;}}
      this.projectiles=this.projectiles.filter(q=>q.life>0&&W.passable(this.world,this.state,q.x,q.y));
    }

    useBuilding(b){
      const def=D.buildings[b.type];if(!def)return;
      if(def.station){this.station=def.station;this.openPanel("craft",def.station);return;}
      if(b.type==="chest"){this.openStorage(b);return;}
      if(def.sleep){this.state.player.spawnX=(b.x+b.w/2)*W.TILE;this.state.player.spawnY=(b.y+b.h+0.5)*W.TILE;this.newDay(true);return;}
      if(def.water){this.fillWater();return;}
      if(def.farm){this.usePlot(b);return;}
      if(def.healStation){if(b.healedDay===this.state.day){this.status("癒やし柱の草は朝まで休んでいる");return;}const before=this.state.player.hp;this.state.player.hp=Math.min(this.state.player.maxHp,this.state.player.hp+def.healStation);b.healedDay=this.state.day;this.burst((b.x+.5)*W.TILE,(b.y+.5)*W.TILE,"#72d6b3",16);this.status(`癒やし柱: 体力 +${Math.round(this.state.player.hp-before)}`);return;}
      if(def.commission){this.openPanel("journal","commissions");return;}
      if(def.travel){this.openTravel(b);return;}
      this.toast(def.name,"good");
    }
    fillWater(){const key=this.currentKey();if(D.items[key]?.tool==="water"){this.state.player.watering=key==="sun_watering_can"?50:key==="copper_watering_can"?24:12;this.toast("じょうろを満たした","good");}else{this.addItem("water",1);this.toast("淡水を汲んだ","good");}LI.audio.effect("pickup");}
    openTravel(source){const points=[{name:"最初のキャンプ",x:W.START.x,y:W.START.y},...this.state.buildings.filter(b=>b.type==="waystone"&&b.id!==source.id).map((b,i)=>({name:`陽光の道標 ${i+1}`,x:(b.x+.5)*W.TILE,y:(b.y+1.5)*W.TILE}))];const body=`<div class="recipe-grid">${points.map((p,i)=>`<article class="recipe-card"><h3>${p.name}</h3><p>この場所へ移動します。</p><button type="button" data-travel="${i}">ここへ移動</button></article>`).join("")}</div>`;this.openCustom("陽光の道標","FAST TRAVEL",body);this.dom.body.querySelectorAll("[data-travel]").forEach(b=>b.onclick=()=>{const p=points[+b.dataset.travel];this.state.player.x=p.x;this.state.player.y=p.y;this.state.player.invulnerable=2;this.closePanel();this.status(`${p.name}へ移動しました`);this.safeSave(false);});}
    usePlot(b){
      const key=this.currentKey(),tool=D.items[key]?.tool;
      const cropItems={sunroot:["sunroot","seed"],moonbean:["moonbean","moonbean_seed"],tide_melon:["tide_melon","tide_seed"]};
      if(b.crop&&b.stage>=3){const [produce,seedReturn]=cropItems[b.crop]||cropItems.sunroot,bonus=this.state.progress.upgrades.farmer?1:0;this.addItem(produce,2+bonus);this.addItem(seedReturn,1);b.crop=null;b.stage=0;b.watered=false;b.forestOffering=false;b.forestCounted=false;this.state.stats.harvested++;this.unlock("first_harvest");LI.audio.effect("pickup");this.checkProgressSystems();return;}
      const selectedSeed=D.items[key]?.seedCrop?key:(key==="seed"?"seed":null),fallback=["seed","moonbean_seed","tide_seed"].find(k=>(this.state.inventory[k]||0)>0),seedKey=selectedSeed||fallback;
      if(!b.crop&&seedKey&&(this.state.inventory[seedKey]||0)>0){this.removeItem(seedKey,1);b.crop=D.items[seedKey]?.seedCrop||"sunroot";b.stage=0;b.watered=false;b.forestOffering=W.biomeAt(this.world,this.state,(b.x+.5)*W.TILE,(b.y+.5)*W.TILE)==="forest";b.forestCounted=false;this.state.stats.planted++;this.toast(`${D.items[seedKey].name}を植えた${b.forestOffering?" · 森で育てると祠へ光が届く":""}`,"good");this.burst((b.x+.5)*W.TILE,(b.y+.5)*W.TILE,"#93d96b",7);if(this.state.stats.planted>=100)this.unlock("plant100");this.checkProgressSystems();return;}
      if(b.crop&&tool==="water"){if(this.state.player.watering<=0){this.toast("井戸でじょうろを満たそう","warn");return;}const radius=this.currentKey()==="sun_watering_can"?2:this.currentKey()==="copper_watering_can"?1:0;let watered=0;for(const plot of this.state.buildings.filter(o=>o.type==="plot"&&o.crop)){if(Math.abs(plot.x-b.x)<=radius&&Math.abs(plot.y-b.y)<=radius){plot.watered=true;watered++;}}this.state.player.watering=Math.max(0,this.state.player.watering-Math.max(1,watered));this.toast(`${watered}区画に水をまいた`,"good");this.burst((b.x+.5)*W.TILE,(b.y+.5)*W.TILE,"#71dce1",8);return;}
      this.toast(b.crop?(b.watered?"水やり済み。朝を待とう":"じょうろを選んで水をまこう"):"種を選ぶと植えられます","good");
    }
    useLandmark(l){
      if(l.type==="guide"){this.openTutorial(1,true);return;}
      if(l.type==="relic"){this.collectRelic(l);return;}
      if(l.type==="cache"){this.collectCache(l);return;}
      if(l.type==="waymark"){this.activateWaymark(l);return;}
      if(l.type==="lighthouse"){this.state.progress.lighthouseSeen=true;this.openPanel("lighthouse");this.updateObjective(true);return;}
      if(l.type==="well"||l.type==="spring"){this.fillWater();return;}
      if(l.type==="windstone"){if(!this.state.progress.windstones[l.index]){this.state.progress.windstones[l.index]=true;LI.audio.effect("craft");this.burst(l.x,l.y,"#ffd166",14);this.toast(`風車石 ${this.state.progress.windstones.filter(Boolean).length}/3 を整えた`,"good");}else this.toast("風車石は風に向いている","good");return;}
      if(l.region==="forest"){
        if(this.state.progress.prisms.forest){this.toast("森の光は穏やかだ","good");return;}
        if(this.state.progress.forestPlanted>=3)this.grantPrism("forest");else this.openRegionPanel("forest");
      }else if(l.region==="tide")this.offerFish();
      else if(l.region==="rock"){
        if(this.state.progress.prisms.rock)this.toast("岩の庭に風が通っている","good");
        else if(this.state.progress.windstones.every(Boolean))this.grantPrism("rock");else this.openRegionPanel("rock");
      }
    }
    collectRelic(l){if(this.state.progress.relics[l.index]){this.toast(`${D.relics[l.index].name}の記憶がきらめいている`,"good");return;}this.state.progress.relics[l.index]=true;this.state.stats.relics++;this.state.progress.sunBadges+=2;this.burst(l.x,l.y-6,"#ffd166",24);LI.audio.effect("discover",1.12);this.toast(`${D.relics[l.index].name}を発見！ 記章 +2`,"good");if(this.state.progress.relics.every(Boolean))this.addItem("light_shard",5);this.checkProgressSystems();this.safeSave(true);}
    collectCache(l){
      const opened=this.state.progress.caches||(this.state.progress.caches={});if(opened[l.id]){this.toast(`${l.name}は空になっている`,"good");return;}
      opened[l.id]=true;for(const [key,count] of Object.entries(l.reward||{}))this.addItem(key,count);this.state.progress.sunBadges++;this.burst(l.x,l.y-8,"#ffd166",24);LI.audio.effect("discover",1.06);this.toast(`${l.name}を発見！ 記章 +1`,"good");this.safeSave(true);
    }
    activateWaymark(l){
      const active=this.state.progress.waymarks||(this.state.progress.waymarks={});if(active[l.id]){this.toast("標石の光が周囲の地形を映している","good");return;}
      active[l.id]=true;W.reveal(this.state,l.x,l.y,4);this.state.progress.sunBadges++;this.burst(l.x,l.y-18,"#71dce1",30);LI.audio.effect("discover",1.12);this.toast(`${l.name}を起動。周辺の地図が見えるようになった！`,"good");this.drawMiniMap();this.safeSave(true);
    }
    offerFish(){
      const prog=this.state.progress;if(prog.prisms.tide){this.toast("潮の光は満ちている","good");return;}
      let added=0;for(const key of D.fish){if(!prog.fishOffered.includes(key)&&(this.state.inventory[key]||0)>0){this.removeItem(key,1);prog.fishOffered.push(key);added++;if(prog.fishOffered.length>=3)break;}}
      if(added)LI.audio.effect("discover");if(prog.fishOffered.length>=3)this.grantPrism("tide");else this.openRegionPanel("tide");
    }
    grantPrism(region){
      if(this.state.progress.prisms[region])return;this.state.progress.prisms[region]=true;const key=`prism_${region}`,names={forest:"森",tide:"潮",rock:"岩"};this.addItem(key,1,false);this.unlock(region);this.world.enemies.forEach(e=>{if((region==="forest"&&e.type==="forest_warden")||(region==="rock"&&e.type==="stone_warden")){e.deadUntil=99999;e.state="dead";}});this.toast(`${names[region]}のプリズムを受け取った！`,`good`);this.burst(this.state.player.x,this.state.player.y-12,{forest:"#4faf72",tide:"#71dce1",rock:"#a99be8"}[region],32);LI.audio.effect("discover",1.08);this.safeSave(true);this.updateObjective(true);
    }
    openRegionPanel(region){const cfg={forest:["こもれびの祠","植物を3つ育て、森へ緑を返そう。",this.state.progress.forestPlanted,3,"育つ光は、刈り取る手より、植える手を選ぶ。"],tide:["潮の祭壇","異なる魚を3種類、祭壇へ納めよう。",this.state.progress.fishOffered.length,3,"満ちる光は、急ぐ手より、待つ手を選ぶ。"],rock:["石の庭","岩丘にある三つの風車石を整えよう。",this.state.progress.windstones.filter(Boolean).length,3,"眠る光は、砕く手より、整える手を選ぶ。"]}[region];this.openCustom(cfg[0],"REGION TASK",`<div class="journal-card"><p>「${cfg[4]}」</p><h3>${cfg[1]}</h3><p>${cfg[2]} / ${cfg[3]}</p><div class="progress-line"><b style="width:${cfg[2]/cfg[3]*100}%"></b></div></div>`);}

    itemAmount(key){return key==="fish"?D.fish.reduce((sum,k)=>sum+(this.state.inventory[k]||0),0):(this.state.inventory[key]||0);}
    canAfford(cost){return Object.entries(cost).every(([key,n])=>this.itemAmount(key)>=n);}
    pay(cost){if(!this.canAfford(cost))return false;Object.entries(cost).forEach(([key,count])=>{let n=count;if(key!=="fish")this.removeItem(key,n);else for(const fish of D.fish){const take=Math.min(n,this.state.inventory[fish]||0);if(take){this.removeItem(fish,take);n-=take;}if(n<=0)break;}});return true;}
    stationAvailable(station){if(station==="hand")return true;const p=this.state.player;return this.state.buildings.some(b=>D.buildings[b.type]?.station===station&&Math.hypot((b.x+b.w/2)*W.TILE-p.x,(b.y+b.h/2)*W.TILE-p.y)<54);}
    craft(recipe){
      if(!this.recipeUnlocked(recipe)){this.toast("まだこの作り方を発見していません","warn");return;}
      if(D.items[recipe.output]?.masterwork&&this.state.progress.lighthouseStage<4){this.toast("灯台の完成後に作れる設計です","warn");return;}
      if(!this.stationAvailable(recipe.station)){this.toast(`${{workbench:"作業台",campfire:"焚き火",furnace:"炉"}[recipe.station]}の近くで作れます`,`warn`);return;}
      if(D.items[recipe.output]?.unique&&(this.state.inventory[recipe.output]||0)>0){this.toast("すでに持っています","warn");return;}
      if(!this.pay(recipe.cost)){this.toast("素材が足りません","warn");LI.audio.effect("ui_cancel");return;}
      const first=!this.state.crafted[recipe.output];let made=recipe.count;if(recipe.station==="campfire"&&this.state.progress.upgrades.cook&&Math.random()<.25&&!D.items[recipe.output]?.unique)made+=recipe.count;this.addItem(recipe.output,made,false);
      const refundChance=(this.state.progress.upgrades.craftsman ? .2 : 0)+this.masteryLevel("craft")*.01;if(refundChance&&Math.random()<refundChance){const key=Object.keys(recipe.cost)[0];this.addItem(key,1,false);this.toast(`${D.items[key].name}を端材から回収した`,"good");}
      this.state.crafted[recipe.output]=(this.state.crafted[recipe.output]||0)+made;this.state.stats.crafted++;if(recipe.station==="campfire")this.state.stats.cooked++;LI.audio.effect(recipe.station==="campfire"?"cook":"craft",first?1.1:1);this.unlock("first_craft");if(recipe.station==="campfire")this.unlock("first_cook");this.toast(`${first?"新しい作り方を発見 · ":""}${recipe.name}${made>recipe.count?"が2個":""}完成！`,"good");this.burst(this.state.player.x,this.state.player.y-8,first?"#71dce1":"#ffd166",first?28:14);if(first){this.shake(3);this.vibrate(24);}this.checkProgressSystems();this.renderPanel();
    }
    beginBuild(type){const def=D.buildings[type];if(!def)return;if(!(this.state.inventory.hammer>0)){this.toast("建築には木槌が必要です。木材5で手作りできます","warn");return;}if(def.postgame&&this.state.progress.lighthouseStage<4){this.toast("灯台の完成後に作れます","warn");return;}this.buildMode={type,rotation:0,hasPosition:false};this.closePanel();this.updateBuildGhost(true);this.dom.buildHud.classList.remove("is-hidden");$("#touchRotate").classList.remove("is-hidden");$("#buildName").textContent=def.name;this.setBuildingIcon($("#buildPreview"),type);this.updateBuildHUD();this.updateHUD();}
    cancelBuild(){this.buildMode=null;this.dom.buildHud.classList.add("is-hidden");$("#touchRotate").classList.add("is-hidden");this.updateHUD();}
    orientedSize(type,rotation=this.buildMode?.rotation||0){const size=D.buildings[type]?.size||[1,1];return rotation%2?[size[1],size[0]]:[...size];}
    rotateBuild(){if(!this.buildMode)return;this.buildMode.rotation=(this.buildMode.rotation+1)%4;this.updateBuildGhost(false);this.updateBuildHUD();}
    updateBuildGhost(forcePlayer=false){
      if(!this.buildMode)return;const p=this.state.player,a=this.directionAngle();let wx=this.input.pointerWorldX,wy=this.input.pointerWorldY;
      if(forcePlayer||!this.buildMode.hasPosition||!Number.isFinite(wx)){wx=p.x+Math.cos(a)*36;wy=p.y+Math.sin(a)*36;}
      const [bw,bh]=this.orientedSize(this.buildMode.type);this.buildGhost.x=Math.floor(wx/W.TILE-bw/2);this.buildGhost.y=Math.floor(wy/W.TILE-bh/2);this.buildGhost.valid=this.buildValid(this.buildMode.type,this.buildGhost.x,this.buildGhost.y,this.buildMode.rotation);this.updateBuildHUD();
    }
    updateBuildHUD(){if(!this.buildMode)return;const valid=this.buildGhost.valid,selected=this.buildMode.hasPosition,guide=$("#buildGuide"),button=$("#buildPlace"),def=D.buildings[this.buildMode.type];guide.textContent=!this.canAfford(def.cost)?"素材が足りません":valid?(selected?"選んだ場所に配置できます":"地面をタップして位置を決める"):"赤い場所には配置できません";button.disabled=!valid||!selected;button.classList.toggle("valid",valid&&selected);}
    buildValid(type,x,y,rotation=0){
      const def=D.buildings[type];if(!def||!(this.state.inventory.hammer>0)||this.state.buildings.length>=400||!this.canAfford(def.cost))return false;const [bw,bh]=this.orientedSize(type,rotation),p=this.state.player;if(Math.hypot((x+bw/2)*W.TILE-p.x,(y+bh/2)*W.TILE-p.y)>112)return false;
      for(let yy=y;yy<y+bh;yy++)for(let xx=x;xx<x+bw;xx++){
        const tile=W.tileAt(this.world,(xx+.5)*W.TILE,(yy+.5)*W.TILE);if(type==="bridge"?tile!==W.TILE_ID.shallow:(tile===W.TILE_ID.sea||tile===W.TILE_ID.shallow))return false;
        if(this.state.buildings.some(b=>xx>=b.x&&yy>=b.y&&xx<b.x+b.w&&yy<b.y+b.h))return false;
        if(this.world.resources.some(r=>W.activeResource(this.state,r)&&Math.floor(r.x/W.TILE)===xx&&Math.floor(r.y/W.TILE)===yy))return false;
        if(this.world.landmarks.some(l=>Math.hypot(l.x-(xx+.5)*W.TILE,l.y-(yy+.5)*W.TILE)<28))return false;
      }return true;
    }
    placeBuilding(){
      if(!this.buildMode)return;if(!this.buildMode.hasPosition){this.status("地面をタップして場所を選びます");return;}this.updateBuildGhost(false);const {type,rotation}=this.buildMode,{x,y,valid}=this.buildGhost,def=D.buildings[type];if(!valid){this.toast(this.canAfford(def.cost)?"赤い場所には置けません":"素材が足りません","warn");LI.audio.effect("ui_cancel");return;}
      if(!this.pay(def.cost))return;const first=!this.state.discovered.includes(`building:${type}`),[bw,bh]=this.orientedSize(type,rotation),b={id:`b${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,type,x,y,w:bw,h:bh,rotation};if(type==="plot"){b.crop=null;b.stage=0;b.watered=false;}this.state.buildings.push(b);this.discover(`building:${type}`);this.state.stats.built++;LI.audio.effect("build",first?1.08:1);const bx=(x+bw/2)*W.TILE,by=(y+bh/2)*W.TILE;this.burst(bx,by,first?"#71dce1":"#ffd166",first?32:16);this.unlock("first_build");this.status(first&&def.station?`${def.name}が完成。新しいクラフトが見えるようになった！`:first?`初めての${def.name}が完成。拠点の景色が変わった！`:`${def.name}を建てました`);if(first){this.cameraFocus={x:bx,y:by,until:this.state.playSeconds+1.4};this.shake(3);this.vibrate(28);}this.safeSave(true);this.buildMode.hasPosition=false;this.updateBuildGhost(true);
    }
    focusBuilding(id){const b=this.state.buildings.find(o=>o.id===id);if(!b)return;this.closePanel();const x=(b.x+b.w/2)*W.TILE,y=(b.y+b.h/2)*W.TILE;this.cameraFocus={x,y,until:this.state.playSeconds+2.2};setTimeout(()=>{if(this.running)this.confirmDismantle(b);},520);}
    confirmDismantle(b){if(!b||!this.state.buildings.includes(b))return;const def=D.buildings[b.type];this.openCustom(`${def.name}を解体しますか？`,"DISMANTLE",`<div class="confirm-building"><span class="building-preview large" data-building="${b.type}"></span><div><p>背景の画面中央に表示している建築物です。</p><p>使った素材はすべてバッグへ戻ります。</p></div></div><div class="confirm-actions"><button id="cancelDismantle" type="button">やめる</button><button id="confirmDismantle" class="danger-button" type="button"><span class="ui-raster" data-ui="dismantle"></span>解体する</button></div>`);this.dom.modal.classList.add("dismantle-modal");this.dom.backdrop.classList.add("dismantle-backdrop");this.hydrateUIIcons(this.dom.body);$("#cancelDismantle").onclick=()=>this.closePanel();$("#confirmDismantle").onclick=()=>{this.closePanel();this.dismantleBuilding(b.id);};}
    dismantleBuilding(id){const i=this.state.buildings.findIndex(b=>b.id===id);if(i<0)return;const b=this.state.buildings[i],def=D.buildings[b.type];if(b.type==="chest"&&Object.values(this.state.storage[id]||{}).some(Boolean)){this.toast("木箱を空にしてください","warn");return;}Object.entries(def.cost).forEach(([k,n])=>this.addItem(k,n,false));this.state.buildings.splice(i,1);delete this.state.storage[id];this.status(`${def.name}を解体し、素材を戻しました`);LI.audio.effect("build",.8);this.safeSave(true);if(this.panel?.type==="build")this.renderPanel();}

    startFishing(){
      if(!this.nearWater()){this.toast("水辺でもう少し近づこう","warn");return;}const assist=this.masteryLevel("fish")*.012+(this.state.progress.upgrades.angler?.05:0),half=clamp(.14+assist,.14,.27);this.paused=true;this.fishing={pos:.08,velocity:.38+Math.random()*.18,meter:0,time:0,region:W.biomeAt(this.world,this.state,this.state.player.x,this.state.player.y),low:.5-half,high:.5+half};this.dom.fish.classList.remove("is-hidden");$("#safeZone").style.left=`${this.fishing.low*100}%`;$("#safeZone").style.width=`${(this.fishing.high-this.fishing.low)*100}%`;$("#fishingTitle").textContent="魚がかかった！";$("#fishingHelp").textContent="魚が金色の帯に入った瞬間に引こう。3回で成功！";$("#fishingButton").textContent="引く！";LI.audio.effect("fish_bite");
    }
    updateFishing(dt){if(!this.fishing)return;const f=this.fishing;f.time+=dt;f.pos+=f.velocity*dt;if(f.pos<.02||f.pos>.98){f.pos=clamp(f.pos,.02,.98);f.velocity*=-1;}if(Math.random()<dt*.7)f.velocity=clamp(f.velocity+(Math.random()-.5)*.25,-.75,.75);$("#fishMarker").style.left=`${f.pos*100}%`;$("#catchMeter").style.width=`${clamp(f.meter,0,1)*100}%`;if(f.time>14)this.endFishing(false);}
    fishPull(){if(!this.fishing)return;const f=this.fishing,inside=f.pos>=f.low&&f.pos<=f.high;if(inside){f.meter+=.34;LI.audio.effect("ui_confirm",1.1);$("#fishingTitle").textContent="いい手応え！";}else{f.meter=Math.max(0,f.meter-.17);LI.audio.effect("ui_cancel");$("#fishingTitle").textContent="まだ、待とう…";}if(f.meter>=.99)this.endFishing(true);}
    endFishing(success){
      const f=this.fishing;this.fishing=null;this.dom.fish.classList.add("is-hidden");this.paused=false;if(!success){this.toast("魚は逃げた。餌は失っていない。","warn");return;}
      const phase=this.phase(),weather=this.state.weather,masterRod=this.currentKey()==="sun_rod";let pool=["fish","fish_sun"];if(phase==="dusk"||phase==="night")pool.push("fish_moon","fish_moon");if(weather==="rain"||weather==="glow")pool.push("fish_rain","fish_rain");if(f.region==="rock")pool.push("fish_rock","fish_rock");if(f.region==="forest")pool.push("fish_leaf","fish_leaf");if(f.region==="beach")pool.push("fish_coral","fish_coral");if(phase==="night"&&weather==="sunny")pool.push("fish_star");if(Math.random()<(masterRod?.16:.07))pool.push("fish_glow");if(this.state.progress.lighthouseStage>=4&&Math.random()<(masterRod?.15:.035))pool.push("fish_prism");const key=pool[Math.floor(Math.random()*pool.length)];this.addItem(key,1);this.state.fishCaught[key]=(this.state.fishCaught[key]||0)+1;this.state.stats.fishCaught++;LI.audio.effect("fish_catch");this.burst(this.state.player.x,this.state.player.y-10,"#71dce1",16);this.checkProgressSystems();
    }

    updateObjective(force=false){
      let i=this.state.progress.objective||0,advanced=false;while(i<D.objectives.length-1&&D.objectives[i].check(this.state)){i++;advanced=true;}if(advanced){this.state.progress.objective=i;this.toast(`手帳更新: ${D.objectives[i].title}`,"good");LI.audio.effect("discover");if(force)this.safeSave(false);}if(advanced||force)this.updateHUD(true);
    }
    unlock(id){if(this.state.achievements[id])return;const a=D.achievements.find(x=>x.id===id);if(!a)return;this.state.achievements[id]=new Date().toISOString();this.toast(`実績解除「${a.name}」`,`good`);LI.audio.effect("discover",1.15);}
    masteryLevel(id){const def=D.mastery.find(m=>m.id===id);if(!def)return 0;const value=def.metric(this.state);let level=0;for(let i=1;i<def.thresholds.length;i++)if(value>=def.thresholds[i])level=i;return level;}
    checkMasteries(){for(const def of D.mastery){const level=this.masteryLevel(def.id),previous=this.state.progress.masteryLevels[def.id]||0;if(level>previous){this.state.progress.masteryLevels[def.id]=level;this.state.progress.sunBadges+=level-previous;this.toast(`${def.name}熟練度 ${level}！ 記章 +${level-previous}`,"good");LI.audio.effect("discover",1.08);}}}
    commissionMetric(metric){return Number(this.state.stats[metric]||0);}
    ensureDailyContent(force=false){const p=this.state.progress;if(!force&&p.commissionsDay===this.state.day&&p.commissions.length===3)return;const rng=new W.RNG((this.state.seed^Math.imul(this.state.day,2246822519))>>>0),pool=[...D.commissions],selected=[];while(selected.length<3&&pool.length){const i=rng.int(0,pool.length-1),def=pool.splice(i,1)[0],scale=1+Math.min(1.2,(this.state.day-1)*.035);selected.push({id:def.id,goal:Math.max(1,Math.round(def.goal*scale)),reward:def.reward+(this.state.day>=10?1:0),baseline:this.commissionMetric(def.metric),claimed:false});}p.commissionsDay=this.state.day;p.commissions=selected;if(force)this.toast("島のおねがいが更新されました","good");}
    commissionProgress(c){const def=D.commissions.find(x=>x.id===c.id);return Math.max(0,this.commissionMetric(def.metric)-(c.baseline||0));}
    claimCommission(index){const c=this.state.progress.commissions[index];if(!c||c.claimed||this.commissionProgress(c)<c.goal)return;c.claimed=true;this.state.progress.sunBadges+=c.reward;this.state.stats.commissions++;if(c.id==="plant"&&Math.random()<.5)this.addItem("moonbean_seed",1,false);if(c.id==="fish"&&Math.random()<.5)this.addItem("tide_seed",1,false);this.toast(`おねがい達成！ 陽だまり記章 +${c.reward}`,"good");LI.audio.effect("discover",1.12);this.checkProgressSystems();this.safeSave(false);this.renderPanel();}
    buyUpgrade(id){const u=D.upgrades.find(x=>x.id===id),p=this.state.progress;if(!u||p.upgrades[id]||p.sunBadges<u.cost)return;p.sunBadges-=u.cost;p.upgrades[id]=true;this.applyUpgradeEffects();this.toast(`技能「${u.name}」を習得！`,"good");LI.audio.effect("discover",1.16);this.safeSave(true);this.renderPanel();}
    applyUpgradeEffects(){const p=this.state.player,u=this.state.progress.upgrades;p.maxHp=100+(u.vitality?20:0);p.maxStamina=100+(u.breath?20:0);p.hp=Math.min(p.maxHp,p.hp);p.stamina=Math.min(p.maxStamina,p.stamina);}
    discover(id){if(!this.state.discovered.includes(id))this.state.discovered.push(id);}
    islandRating(){
      const s=this.state,prisms=Object.values(s.progress.prisms).filter(Boolean).length;
      const nature=Math.min(10,Math.floor((s.stats.planted+s.stats.harvested*2+prisms*6)/7));
      const uniqueBuildings=new Set(s.buildings.map(b=>b.type)).size,life=Math.min(10,Math.floor((uniqueBuildings*2+Math.min(30,s.stats.cooked)+Object.keys(s.crafted).length+Math.min(30,s.stats.commissions))/12));
      const discovery=Math.min(10,Math.floor((s.explored.filter(Boolean).length/s.explored.length)*5+(Object.keys(s.fishCaught).length/D.fish.length)*2.5+(s.progress.relics.filter(Boolean).length/D.relics.length)*2.5));
      const total=nature+life+discovery,rank=total>=30?"S+":total>=26?"S":total>=20?"A":total>=14?"B":total>=8?"C":"D";return{nature,life,discovery,total,rank};
    }
    checkAchievements(){
      const s=this.state,fish=Object.keys(s.fishCaught).length;if(fish>=3)this.unlock("fish3");if(fish>=6)this.unlock("fish6");if(s.stats.dodges>=30)this.unlock("dodge30");if(D.recipes.every(r=>s.crafted[r.output]))this.unlock("all_recipes");
      const explored=s.explored.filter(Boolean).length/s.explored.length,relics=s.progress.relics.filter(Boolean).length,levels=D.mastery.map(m=>this.masteryLevel(m.id));if(explored>=.98)this.unlock("map100");if(s.progress.lighthouseStage>=4)this.unlock("lighthouse");if(this.islandRating().total>=15)this.unlock("rating15");if(this.islandRating().total>=30)this.unlock("rating30");if(relics>=1)this.unlock("relic1");if(relics>=4)this.unlock("relic4");if(relics>=8)this.unlock("relic8");if(s.stats.commissions>=1)this.unlock("commission1");if(s.stats.commissions>=10)this.unlock("commission10");if(s.stats.commissions>=30)this.unlock("commission30");if(Math.max(...levels)>=5)this.unlock("mastery5");if(Math.max(...levels)>=10)this.unlock("mastery10");if(levels.every(n=>n>=5))this.unlock("all_mastery5");if(fish>=10)this.unlock("fish10");if(s.day>=30)this.unlock("day30");if(s.stats.built>=50)this.unlock("build50");if(s.stats.gathered>=500)this.unlock("gather500");if(["sun_axe","sun_pickaxe","sun_spear","sun_rod","sun_watering_can"].every(k=>s.inventory[k]))this.unlock("all_masterwork");
    }
    checkProgressSystems(){this.checkMasteries();this.checkAchievements();}
    updateRegion(){
      const p=this.state.player,b=W.biomeAt(this.world,this.state,p.x,p.y),zone=W.zoneAt(this.world,p.x,p.y);
      if(["grass","forest","beach","rock"].includes(b)){this.discover(`region:${b}`);if(!this.state.progress.regions[b]){this.state.progress.regions[b]=true;const names={grass:"陽だまり草原",forest:"こもれび林",beach:"きらめき浜",rock:"ひかり岩丘"};this.toast(`新しい地域: ${names[b]}`,"good");LI.audio.effect("discover",.95);}}
      if(W.ZONE_NAMES[zone]){const zones=this.state.progress.zones||(this.state.progress.zones={});if(!zones[zone]){zones[zone]=true;this.discover(`zone:${zone}`);this.toast(`新しい場所: ${W.ZONE_NAMES[zone]}`,"good");LI.audio.effect("discover",1.02);}}
    }

    updateParticles(dt){for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=15*dt;p.rotation=(p.rotation||0)+(p.spin||0)*dt;p.life-=dt;}this.particles=this.particles.filter(p=>p.life>0).slice(-250);}
    burst(x,y,color,count=8){const quality=this.state?.settings?.particles||"high";if(quality==="off")return;if(quality==="low"||(matchMedia("(pointer:coarse)").matches&&this.state?.settings?.quality!=="high"))count=Math.ceil(count/2);for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=10+Math.random()*28;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-8,life:.28+Math.random()*.35,max:.65,color,size:1+Math.floor(Math.random()*2)});}}
    impactBurst(x,y,color,tool="hand"){const strong=tool==="axe"||tool==="pickaxe";this.burst(x,y,color,strong?18:9);if(strong){const count=this.state.settings.particles==="low"?3:7;for(let i=0;i<count;i++){const a=-Math.PI+Math.random()*Math.PI,s=24+Math.random()*36;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-18,life:.42+Math.random()*.25,max:.7,color,size:2+Math.floor(Math.random()*2),kind:tool==="axe"?"leaf":"chip",rotation:Math.random()*Math.PI,spin:(Math.random()-.5)*12});}this.shake(tool==="axe"?1.8:2.2);this.vibrate(10);}}
    shake(amount){if(!this.state.settings.screenShake||this.state.settings.reducedMotion)return;this.camera.shakeX+=(Math.random()-.5)*amount;this.camera.shakeY+=(Math.random()-.5)*amount;}

    render(time){
      const ctx=this.ctx,dpr=this.dpr,scale=this.scale,p=this.state.player;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle="#71dce1";ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
      const halfW=this.viewW/2,halfH=this.viewH/2,minX=halfW,maxX=W.W*W.TILE-halfW,minY=halfH,maxY=W.H*W.TILE-halfH;
      const camX=clamp(this.camera.x+this.camera.shakeX,minX,maxX),camY=clamp(this.camera.y+this.camera.shakeY,minY,maxY);
      ctx.setTransform(dpr*scale,0,0,dpr*scale,this.canvas.width/2-camX*dpr*scale,this.canvas.height/2-camY*dpr*scale);ctx.imageSmoothingEnabled=false;
      const x0=Math.max(0,Math.floor((camX-halfW)/W.TILE)-1),x1=Math.min(W.W-1,Math.ceil((camX+halfW)/W.TILE)+1),y0=Math.max(0,Math.floor((camY-halfH)/W.TILE)-1),y1=Math.min(W.H-1,Math.ceil((camY+halfH)/W.TILE)+1);
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const id=this.world.tiles[y*W.W+x],name=W.TILE_NAME[id];this.drawTerrain(name,x*W.TILE,y*W.TILE,x,y,time);}
      // Building floors and placement grid live under characters.
      for(const b of this.state.buildings){const def=D.buildings[b.type];if(def?.tile)this.drawFloorTile(b,def.tile);if(b.type==="bridge")this.drawBridge(b);}
      this.drawTelegraphs(ctx);
      const objects=[];
      for(const r of this.world.resources)if(W.activeResource(this.state,r)&&r.x>camX-halfW-40&&r.x<camX+halfW+40&&r.y>camY-halfH-50&&r.y<camY+halfH+50)objects.push({kind:"resource",sort:r.sortY,obj:r});
      for(const l of this.world.landmarks)if(l.x>camX-halfW-50&&l.x<camX+halfW+50&&l.y>camY-halfH-70&&l.y<camY+halfH+50)objects.push({kind:"landmark",sort:l.sortY,obj:l});
      for(const b of this.state.buildings){if(D.buildings[b.type]?.tile||b.type==="bridge")continue;objects.push({kind:"building",sort:(b.y+b.h)*W.TILE,obj:b});}
      if(this.state.recovery)objects.push({kind:"recovery",sort:this.state.recovery.y+7,obj:this.state.recovery});
      for(const e of this.world.enemies)if(!e.deadUntil)objects.push({kind:"enemy",sort:e.y+8,obj:e});objects.push({kind:"player",sort:p.y+7,obj:p});objects.sort((a,b)=>a.sort-b.sort);
      for(const o of objects){if(o.kind==="resource")this.drawResource(o.obj,time);else if(o.kind==="landmark")this.drawLandmark(o.obj,time);else if(o.kind==="building")this.drawBuilding(o.obj,time);else if(o.kind==="recovery")this.drawCombatCell(3,o.obj.x,o.obj.y-5,27,1,0,28);else if(o.kind==="enemy")this.drawEnemy(o.obj,time);else this.drawPlayer(time);}
      for(const q of this.projectiles)this.drawProjectile(q);
      for(const v of this.particles){ctx.globalAlpha=clamp(v.life/(v.max||.65),0,1);ctx.fillStyle=v.color;if(v.kind){ctx.save();ctx.translate(Math.round(v.x),Math.round(v.y));ctx.rotate(v.rotation||0);if(v.kind==="leaf"){ctx.fillRect(-v.size,-1,v.size*2,2);ctx.fillStyle="#fff4c7";ctx.fillRect(0,-1,1,2);}else{ctx.fillRect(-v.size/2,-v.size/2,v.size,v.size);ctx.strokeStyle="#fffdf0";ctx.lineWidth=.6;ctx.strokeRect(-v.size/2,-v.size/2,v.size,v.size);}ctx.restore();}else ctx.fillRect(Math.round(v.x),Math.round(v.y),v.size,v.size);ctx.globalAlpha=1;}
      if(this.target)this.drawTarget(this.target);if(this.buildMode)this.drawBuildGhost();
      this.drawLighting(time);this.drawWeather(time);
    }
    drawSprite(key,x,y,alpha=1,anchor=null){const s=this.sprites[key];if(!s)return false;const a=anchor||s.anchor||[s.w/2,s.h];this.ctx.globalAlpha=alpha;this.ctx.drawImage(this.atlas,s.x,s.y,s.w,s.h,Math.round(x-a[0]),Math.round(y-a[1]),s.w,s.h);this.ctx.globalAlpha=1;return true;}
    terrainColor(name,zone){const zoneColors={old_meadow:"#84c966",moon_meadow:"#75c79a",sunreach:"#a3cf69",whisper_forest:"#438e61",amber_grove:"#65a957",north_coast:"#e8c77f",tideflats:"#d9c98b",old_quarry:"#8f9aac",crystal_ridge:"#9595b5"};return{sea:"#3b98b9",shallow:"#68c9cf",path:"#d5b271"}[name]||zoneColors[zone]||({grass:"#84c966",forest:"#4f9d69",sand:"#e8c77f",rock_ground:"#8f9aac"}[name]||"#84c966");}
    drawTerrain(name,x,y,tileX,tileY,time){
      const textureKey={grass:"meadow",forest:"forest",sand:"sand",rock_ground:"rock",sea:"water",shallow:"water",path:"sand"}[name]||"meadow",image=this.terrain[textureKey],c=this.ctx,zone=this.world.zones[tileY*W.W+tileX];
      const base=this.terrainColor(name,zone);c.fillStyle=base;c.fillRect(x,y,W.TILE,W.TILE);
      if(image?.naturalWidth){let pattern=this.terrainPatterns[textureKey];if(!pattern){pattern=c.createPattern(image,"repeat");if(pattern?.setTransform)pattern.setTransform(new DOMMatrix([.25,0,0,.25,0,0]));this.terrainPatterns[textureKey]=pattern;}c.save();c.globalAlpha=name==="sea"?.42:name==="shallow"?.34:.3;c.fillStyle=pattern;c.fillRect(x,y,W.TILE,W.TILE);c.restore();}
      const shade=((tileX*17+tileY*31)%11)-5;if(shade){c.fillStyle=shade>0?`rgba(255,244,199,${shade*.006})`:`rgba(35,50,75,${-shade*.005})`;c.fillRect(x,y,W.TILE,W.TILE);}
      if(name==="sea"){c.fillStyle="rgba(25,72,137,.2)";c.fillRect(x,y,W.TILE,W.TILE);}else if(name==="shallow"){c.fillStyle="rgba(210,255,239,.12)";c.fillRect(x,y,W.TILE,W.TILE);}else if(name==="path"){c.fillStyle="rgba(181,126,74,.16)";c.fillRect(x,y,W.TILE,W.TILE);}
      this.drawTerrainEdges(name,x,y,tileX,tileY);
      if((name==="sea"||name==="shallow")&&((tileX*13+tileY*7+Math.floor(time*1.5))%19===0)){c.globalAlpha=.34;c.fillStyle="#e6fff5";c.fillRect(x+3+(tileY%4),y+5+(tileX%3),5,1);c.globalAlpha=1;}
    }
    drawTerrainEdges(name,x,y,tileX,tileY){const c=this.ctx,index=tileY*W.W+tileX,zone=this.world.zones[index],dirs=[[0,-1,"top"],[1,0,"right"],[0,1,"bottom"],[-1,0,"left"]];for(const [dx,dy,side] of dirs){const nx=tileX+dx,ny=tileY+dy;if(nx<0||ny<0||nx>=W.W||ny>=W.H)continue;const ni=ny*W.W+nx,other=W.TILE_NAME[this.world.tiles[ni]],otherZone=this.world.zones[ni];if(other===name&&otherZone===zone)continue;const waterA=name==="sea"||name==="shallow",waterB=other==="sea"||other==="shallow";if(waterA&&waterB)continue;const color=this.terrainColor(other,otherZone);for(let band=0;band<3;band++){c.globalAlpha=.22-band*.055;c.fillStyle=color;if(side==="top")c.fillRect(x,y+band,W.TILE,1);else if(side==="bottom")c.fillRect(x,y+W.TILE-1-band,W.TILE,1);else if(side==="left")c.fillRect(x+band,y,1,W.TILE);else c.fillRect(x+W.TILE-1-band,y,1,W.TILE);}c.globalAlpha=.34;c.fillStyle=waterA||waterB?"#e6fff5":this.terrainColor(name,zone);for(let i=0;i<4;i++){const n=(tileX*11+tileY*7+i*5)%14+1;if(side==="top"||side==="bottom")c.fillRect(x+n,y+(side==="top"?3:12),1,1);else c.fillRect(x+(side==="left"?3:12),y+n,1,1);}c.globalAlpha=1;}}
    drawFloorTile(b,tile){for(let yy=0;yy<b.h;yy++)for(let xx=0;xx<b.w;xx++){const x=(b.x+xx+.5)*W.TILE,y=(b.y+yy+1)*W.TILE;this.drawAsset(`building_${tile}`,x,y,18,1,0,18);}}
    drawResource(r,time){const artType=r.type==="loose_stone"?"rock":r.type;if(WORLD_ART[artType]){const heights={tree:58,stump:31,berry_bush:38,rock:30,loose_stone:18,ore:32,crystal:38,branch:25,fiber:29,shell:23,herb:25,resin:23,sunroot:29,moonbean:31,tide_melon:32},hit=this.harvestHit?.id===r.id&&this.harvestHit.until>this.state.playSeconds,sway=["fiber","herb","sunroot","moonbean"].includes(r.type)?Math.sin(time*1.35+(r.x||0)*.07)*.012:hit?Math.sin(time*80)*.06:0;this.drawAsset(`world_${artType}`,r.x+(hit?Math.sin(time*90)*1.2:0),r.y,(heights[r.type]||32)*(r.scale||1),1,sway,Infinity,!!r.flip);return;}this.drawSprite(`resource.${r.type}.0`,r.x,r.y);}
    drawLandmark(l,time){
      const c=this.ctx;if(l.type==="lighthouse"){this.drawAsset("building_lighthouse",l.x,l.y,98,this.state.progress.lighthouseStage?1:.68,0,72);if(this.state.progress.lighthouseStage>=4){c.globalAlpha=.22+.08*Math.sin(time*3);c.fillStyle="#fff4c7";c.beginPath();c.moveTo(l.x,l.y-68);c.lineTo(l.x-120,l.y-86);c.lineTo(l.x-120,l.y-66);c.fill();c.globalAlpha=1;}return;}
      if(l.type==="well"||l.type==="spring"){this.drawAsset("building_well",l.x,l.y,l.type==="spring"?48:55,1,0,48);return;}
      if(l.type==="guide"){this.drawAsset("building_guide",l.x,l.y,45,1,0,34);return;}
      if(l.type==="relic"){const found=this.state.progress.relics[l.index];this.drawAsset("world_relic",l.x,l.y,37,found?.3:1,0,29);return;}
      if(l.type==="cache"){const opened=this.state.progress.caches?.[l.id];this.drawAsset("building_chest",l.x,l.y,42,opened?.42:1,0,42);return;}
      if(l.type==="waymark"){const active=this.state.progress.waymarks?.[l.id];this.drawAsset("building_waystone",l.x,l.y,57,active?1:.66,0,43);if(active){c.globalAlpha=.3+.12*Math.sin(time*2.4);c.strokeStyle="#71dce1";c.beginPath();c.arc(l.x,l.y-20,18,0,Math.PI*2);c.stroke();c.globalAlpha=1;}return;}
      if(l.type==="windstone"){this.drawAsset("building_windstone",l.x,l.y,52,1,0,42);return;}
      if(l.type==="altar"){const col={forest:"#4faf72",tide:"#71dce1",rock:"#a99be8"}[l.region];this.drawCombatCell(7,l.x,l.y-1,45,1,0,48);c.save();c.globalAlpha=.7+.2*Math.sin(time*2.2);c.fillStyle=col;c.beginPath();c.moveTo(l.x,l.y-24);c.lineTo(l.x+5,l.y-18);c.lineTo(l.x,l.y-12);c.lineTo(l.x-5,l.y-18);c.fill();c.restore();return;}
      c.fillStyle="#6c73a8";c.fillRect(l.x-10,l.y+7,20,4);
      const done=this.state.progress.windstones[l.index];c.fillStyle="#27324d";c.fillRect(l.x-6,l.y-5,12,17);c.fillStyle="#9da7b8";c.fillRect(l.x-4,l.y-7,8,17);c.strokeStyle=done?"#ffd166":"#46506a";c.lineWidth=2;for(let i=0;i<4;i++){const a=time*(done?1.5:.2)+i*Math.PI/2;c.beginPath();c.moveTo(l.x,l.y-9);c.lineTo(l.x+Math.cos(a)*11,l.y-9+Math.sin(a)*11);c.stroke();}
    }
    drawBuilding(b,time){
      const def=D.buildings[b.type],x=(b.x+b.w/2)*W.TILE,y=(b.y+b.h)*W.TILE;
      const artKey=def?.art||b.type,art=BUILDING_ART[artKey];if(art){const flat=["moss_rug"].includes(b.type),width=Math.max(flat?b.w*16:38,b.w*20+22),height=flat?20:Math.max(43,b.h*18+27),rotation=["fence","gate"].includes(b.type)?(b.rotation||0)*Math.PI/2:0;this.drawAsset(`building_${artKey}`,x,y,height,1,rotation,width);if(b.type==="plot"&&b.crop)this.drawCrop(b,time);return;}
      if(this.drawSprite(`building.${b.type}`,x,y)){if(b.type==="plot"&&b.crop)this.drawCrop(b,time);return;}
      const c=this.ctx;c.fillStyle="#6c73a8";c.fillRect(b.x*16+2,(b.y+b.h)*16-5,b.w*16-4,4);c.strokeStyle="#27324d";c.lineWidth=2;c.fillStyle=b.type==="fence"?"#d89b5d":b.type==="flag"?"#ef6a67":b.type==="bench"?"#c98b5b":"#fff4c7";
      if(b.type==="fence"){c.fillRect(b.x*16+2,b.y*16+5,12,5);c.strokeRect(b.x*16+2,b.y*16+5,12,5);}
      else if(b.type==="gate"){c.fillStyle="#27324d";c.fillRect(x-7,y-20,3,20);c.fillRect(x+4,y-20,3,20);c.fillRect(x-7,y-21,14,3);c.fillStyle="#ffd166";c.fillRect(x+2,y-12,2,2);}
      else if(b.type==="flag"||b.type==="sun_banner"){c.fillStyle="#27324d";c.fillRect(x-1,y-28,2,28);c.fillStyle=b.type==="sun_banner"?"#ffd166":"#ef6a67";c.fillRect(x+1,y-27,10,7);}
      else if(b.type==="bench"){c.fillRect(b.x*16+2,y-13,b.w*16-4,5);c.fillRect(b.x*16+5,y-9,3,9);c.fillRect(b.x*16+b.w*16-8,y-9,3,9);}
      else if(b.type==="shell_chime"){c.fillStyle="#27324d";c.fillRect(x-1,y-27,2,24);c.fillRect(x-7,y-23,14,2);c.fillStyle="#fff4c7";c.fillRect(x-6,y-20,3,5);c.fillRect(x+3,y-18,3,6);c.fillStyle="#71dce1";c.fillRect(x-1,y-15,2,7);}
      else if(b.type==="prism_arch"){c.fillStyle="#27324d";c.fillRect(x-14,y-24,5,24);c.fillRect(x+9,y-24,5,24);c.fillRect(x-12,y-28,24,5);c.fillStyle="#a99be8";c.fillRect(x-10,y-26,20,2);c.fillStyle="#ffd166";c.fillRect(x-1,y-24,3,14);}
      else if(b.type==="rain_collector"){c.fillStyle="#27324d";c.fillRect(x-7,y-17,14,16);c.fillStyle="#d89b5d";c.fillRect(x-5,y-15,10,12);c.fillStyle="#71dce1";c.fillRect(x-5,y-15,10,3);c.fillStyle="#fff4c7";c.fillRect(x-7,y-10,14,2);}
      else if(b.type==="sprinkler"){c.fillStyle="#27324d";c.fillRect(x-2,y-20,4,20);c.fillRect(x-10,y-21,20,3);c.fillStyle="#71dce1";c.fillRect(x-8,y-20,16,1);for(let i=-1;i<=1;i++)c.fillRect(x+i*7,y-25-Math.abs(i)*2,2,2);}
      else if(b.type==="greenhouse"){c.globalAlpha=.72;c.fillStyle="#dff8ee";c.fillRect(b.x*16+3,y-40,b.w*16-6,39);c.globalAlpha=1;c.strokeStyle="#34726b";c.strokeRect(b.x*16+3,y-40,b.w*16-6,39);c.beginPath();c.moveTo(b.x*16+3,y-40);c.lineTo(x,y-50);c.lineTo(b.x*16+b.w*16-3,y-40);c.stroke();for(let xx=b.x*16+12;xx<b.x*16+b.w*16;xx+=12)c.fillRect(xx,y-40,1,39);}
      else if(b.type==="request_board"){c.fillStyle="#27324d";c.fillRect(x-15,y-25,30,18);c.fillRect(x-11,y-7,4,8);c.fillRect(x+7,y-7,4,8);c.fillStyle="#ffd166";c.fillRect(x-13,y-23,26,14);c.fillStyle="#fffdf0";c.fillRect(x-9,y-19,8,8);c.fillRect(x+3,y-19,7,5);}
      else if(b.type==="waystone"){c.fillStyle="#27324d";c.beginPath();c.moveTo(x,y-30);c.lineTo(x+9,y-15);c.lineTo(x+6,y);c.lineTo(x-6,y);c.lineTo(x-9,y-15);c.fill();c.fillStyle="#ffd166";c.beginPath();c.moveTo(x,y-26);c.lineTo(x+5,y-15);c.lineTo(x,y-5);c.lineTo(x-5,y-15);c.fill();}
      else if(b.type==="trophy_plinth"){c.fillStyle="#27324d";c.fillRect(x-8,y-13,16,13);c.fillStyle="#9da7b8";c.fillRect(x-6,y-11,12,9);c.fillStyle="#ffd166";c.beginPath();c.arc(x,y-18,6,0,Math.PI*2);c.fill();}
      else if(b.type==="sun_dial"){c.fillStyle="#27324d";c.beginPath();c.ellipse(x,y-7,15,5,0,0,Math.PI*2);c.fill();c.fillStyle="#f4d58d";c.beginPath();c.ellipse(x,y-8,12,3.5,0,0,Math.PI*2);c.fill();c.fillStyle="#ef6a67";c.beginPath();c.moveTo(x,y-28);c.lineTo(x+3,y-6);c.lineTo(x-2,y-8);c.fill();}
      else if(b.type==="beacon_garden"){c.fillStyle="#34726b";c.fillRect(b.x*16+3,y-7,b.w*16-6,6);for(let i=0;i<7;i++){const fx=b.x*16+7+(i*13)%38,fy=y-9-(i%3)*6;c.fillStyle=["#ffd166","#71dce1","#a99be8"][i%3];c.fillRect(fx-2,fy-2,5,5);c.fillStyle="#fffdf0";c.fillRect(fx,fy,1,1);}}
      else{c.beginPath();c.arc(x,y-8,6,0,Math.PI*2);c.fill();c.stroke();}
    }
    drawCrop(b,time){const c=this.ctx,x=(b.x+b.w/2)*16,y=(b.y+b.h)*16,stage=b.stage||0,crop=WORLD_ART[b.crop]?b.crop:"sunroot";if(stage>=2)this.drawAsset(`world_${crop}`,x,y,28+stage*4,stage===2?.72:1,0,24+stage*3);else{c.strokeStyle="#34726b";c.lineWidth=2;c.beginPath();c.moveTo(x,y-5);c.lineTo(x,y-9-stage*4);c.stroke();c.fillStyle="#93d96b";c.fillRect(x-4,y-12-stage*3,8,4);}if(b.watered){c.fillStyle="#71dce1";c.fillRect(x-8,y-3,3,2);c.fillRect(x+5,y-4,3,2);}}
    drawBridge(b){const c=this.ctx,x=b.x*16,y=b.y*16;c.fillStyle="#27324d";c.fillRect(x,y+2,16,13);c.fillStyle="#d89b5d";for(let yy=3;yy<15;yy+=4)c.fillRect(x+1,y+yy,14,3);c.fillStyle="#fff4c7";c.fillRect(x+3,y+4,8,1);}
    drawEnemy(e,time){
      const def=D.enemies[e.type],pos=WORLD_ART[e.type],c=this.ctx;c.save();c.globalAlpha=def.boss?.24:.18;c.fillStyle="#23324b";c.beginPath();c.ellipse(e.x,e.y,def.boss?19:11,def.boss?6:4,0,0,Math.PI*2);c.fill();c.restore();if(pos){this.drawAsset(`world_${e.type}`,e.x,e.y,def.boss?66:41,e.hitFlash>0?.45:1,0,def.boss?58:36);}else{const frame=Math.floor((e.timer||0)*5)%2;this.drawSprite(`enemy.${def.sprite}.${frame}`,e.x,e.y,e.hitFlash>0?.45:1);}
      if(def.combatCell!=null)this.drawCombatCell(def.combatCell,e.x,e.y-11,def.boss?64:37,e.hitFlash>0?.45:1,0,def.boss?58:38);
      if(e.state==="attack"){const ratio=clamp(e.attackTimer/def.notice,0,1);c.strokeStyle="#fffdf0";c.lineWidth=3;c.beginPath();c.arc(e.x,e.y,def.range*(1-ratio)+6,0,Math.PI*2);c.stroke();c.strokeStyle="#ef6a67";c.lineWidth=1;c.stroke();}
      if(e.hp<e.maxHp||def.boss){const w=def.boss?34:20,barY=e.y-(def.boss?72:47);c.fillStyle="#27324d";c.fillRect(e.x-w/2,barY,w,4);c.fillStyle=def.boss?"#ffd166":"#ef6a67";c.fillRect(e.x-w/2+1,barY+1,(w-2)*clamp(e.hp/e.maxHp,0,1),2);}
    }
    drawProjectile(q){const c=this.ctx,angle=Math.atan2(q.vy,q.vx),life=clamp(q.life/(q.maxLife||2.2),0,1);c.save();c.globalAlpha=.2*life;c.strokeStyle=q.kind==="seed"?"#93d96b":q.kind==="bubble"?"#e6fff5":"#a99be8";c.lineWidth=q.kind==="bubble"?4:2;c.beginPath();c.moveTo(q.x-Math.cos(angle)*13,q.y-Math.sin(angle)*13);c.lineTo(q.x-Math.cos(angle)*3,q.y-Math.sin(angle)*3);c.stroke();c.restore();if(this.drawCombatCell(q.spriteCell,q.x,q.y,q.kind==="bubble"?16:14,life,angle,22))return;c.save();c.translate(q.x,q.y);c.rotate(angle);if(q.kind==="bubble"){c.fillStyle="#71dce1";c.beginPath();c.arc(0,0,q.r,0,Math.PI*2);c.fill();c.strokeStyle="#fffdf0";c.stroke();}else{c.fillStyle=q.kind==="seed"?"#ef8b32":"#71dce1";c.beginPath();c.moveTo(q.r+3,0);c.lineTo(-q.r,-q.r*.75);c.lineTo(-q.r,q.r*.75);c.closePath();c.fill();c.strokeStyle="#fffdf0";c.stroke();}c.restore();}
    drawPlayer(time){
      const p=this.state.player,step=p.moving&&Math.floor(p.anim/2)%2?"walk":"idle",alpha=p.invulnerable>0&&Math.floor(time*14)%2?.38:1,key=`hero_${p.dir||"down"}_${step}`,flip=step==="walk"&&(p.dir==="right"||p.dir==="down_right"),c=this.ctx;c.save();c.globalAlpha=.2;c.fillStyle="#23324b";c.beginPath();c.ellipse(p.x,p.y,10,3.5,0,0,Math.PI*2);c.fill();c.restore();this.drawAsset(key,p.x,p.y,44,alpha,0,31,flip);
      if(this.attackFx>0){const c=this.ctx,a=this.attackAngle,r=25;c.strokeStyle="#fff4c7";c.lineWidth=3;c.beginPath();c.arc(p.x,p.y-3,r,a-.75,a+.75);c.stroke();c.strokeStyle="#ffd166";c.lineWidth=1;c.stroke();}
      if(p.glowUntil>this.state.playSeconds){const c=this.ctx;c.strokeStyle="#ffd166";c.globalAlpha=.55;c.beginPath();c.arc(p.x,p.y-7,18+Math.sin(time*3)*2,0,Math.PI*2);c.stroke();c.globalAlpha=1;}
    }
    drawTelegraphs(c){for(const e of this.world.enemies)if(!e.deadUntil&&e.state==="attack"){const def=D.enemies[e.type],ratio=1-clamp(e.attackTimer/def.notice,0,1);c.globalAlpha=.16+ratio*.22;c.fillStyle="#ef6a67";c.beginPath();c.arc(e.x,e.y,def.range,0,Math.PI*2);c.fill();c.globalAlpha=1;}}
    drawTarget(target){const c=this.ctx,o=target.obj,x=target.kind==="building"?(o.x+o.w/2)*16:o.x,y=target.kind==="building"?(o.y+o.h)*16:o.y;c.strokeStyle="#fffdf0";c.lineWidth=2;c.setLineDash([3,2]);c.beginPath();c.ellipse(x,y-5,target.kind==="landmark"&&o.type==="lighthouse"?22:13,7,0,0,Math.PI*2);c.stroke();c.setLineDash([]);}
    drawBuildGhost(){const c=this.ctx,{x,y,valid}=this.buildGhost,type=this.buildMode.type,[bw,bh]=this.orientedSize(type),cx=(x+bw/2)*16,cy=(y+bh)*16,artKey=D.buildings[type]?.art||type;c.globalAlpha=.34;c.fillStyle=valid?"#72d6b3":"#ef6a67";c.fillRect(x*16,y*16,bw*16,bh*16);c.strokeStyle=valid?"#fffdf0":"#5b2632";c.lineWidth=1.5;c.setLineDash([3,2]);c.strokeRect(x*16+.5,y*16+.5,bw*16-1,bh*16-1);c.setLineDash([]);c.globalAlpha=1;if(BUILDING_ART[artKey])this.drawAsset(`building_${artKey}`,cx,cy,Math.max(43,bh*18+27),.68,["fence","gate"].includes(type)?(this.buildMode.rotation||0)*Math.PI/2:0,Math.max(38,bw*20+22));}
    drawLighting(time){
      const {darkness,evening,dawn,nightStrength}=this.lightProfile();if(darkness<.002&&evening<.002&&dawn<.002)return;const c=this.ctx,w=this.canvas.width,h=this.canvas.height;c.setTransform(1,0,0,1,0,0);if(darkness>.001){c.globalAlpha=darkness;c.fillStyle="#172b57";c.fillRect(0,0,w,h);}const warmth=Math.max(evening,dawn);if(warmth>.001){c.globalAlpha=warmth;c.fillStyle=evening>=dawn?"#b45e69":"#ffd79a";c.fillRect(0,0,w,h);}if(nightStrength>0){const px=(this.state.player.x-this.camera.x)*this.scale*this.dpr+w/2,py=(this.state.player.y-this.camera.y)*this.scale*this.dpr+h/2,r=Math.max(115*this.dpr,this.canvas.clientWidth*.18*this.dpr),glow=c.createRadialGradient(px,py,16*this.dpr,px,py,r);glow.addColorStop(0,`rgba(255,232,154,${.3*nightStrength})`);glow.addColorStop(.55,`rgba(255,209,102,${.1*nightStrength})`);glow.addColorStop(1,"rgba(23,43,87,0)");c.globalAlpha=1;c.fillStyle=glow;c.fillRect(0,0,w,h);if(nightStrength>.45)for(let i=0;i<24;i++){c.fillStyle=`rgba(255,244,199,${(.2+(i%3)*.1)*nightStrength})`;c.fillRect((i*173)%w,(i*97)%(h*.55),Math.max(1,this.dpr),Math.max(1,this.dpr));}}c.globalAlpha=1;
    }
    drawWeather(time){
      if(this.state.weather==="sunny")return;const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);const w=this.canvas.clientWidth,h=this.canvas.clientHeight,mobile=matchMedia("(pointer:coarse)").matches||w<=760,count=this.state.settings.quality==="low"||mobile&&this.state.settings.quality!=="high"?18:40;c.strokeStyle=this.state.weather==="glow"?"rgba(255,244,199,.72)":"rgba(255,255,255,.48)";c.lineWidth=1;for(let i=0;i<count;i++){const x=(i*83+time*55)% (w+40)-20,y=(i*47+time*120)%(h+40)-20;c.beginPath();c.moveTo(x,y);c.lineTo(x-3,y+7);c.stroke();}}

    updateHUD(){
      if(!this.state)return;const p=this.state.player;[["hp",p.hp,p.maxHp],["food",p.food,100],["water",p.water,100],["stamina",p.stamina,p.maxStamina+(p.buffUntil>this.state.playSeconds?20:0)]].forEach(([id,v,max])=>{$(`#${id}Bar`).style.width=`${clamp(v/max*100,0,100)}%`;$(`#${id}Text`).textContent=Math.ceil(v);});
      const total=(6*60+this.state.clock*2)%(24*60),hour=Math.floor(total/60),min=Math.floor(total%60),phaseNames={morning:"朝",day:"昼",dusk:"夕",night:"夜"},phase=this.phase();this.dom.shell.dataset.phase=phase;$("#dayText").textContent=`${this.state.day}日目`;$("#clockText").textContent=`${phaseNames[phase]} ${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}`;const weather=D.weather.find(w=>w.id===this.state.weather)||D.weather[0],weatherIcon=$("#weatherIcon");weatherIcon.className=`weather-glyph weather-${weather.id}`;$("#weatherText").textContent=weather.name;
      const obj=D.objectives[this.state.progress.objective]||D.objectives.at(-1);this.dom.objective.textContent=obj.title;this.dom.objectiveProgress.textContent=this.objectiveDetail(obj);
      const action=this.actionDescriptor();if(this.target||this.buildMode){this.dom.hint.querySelector("span").textContent=action.label;$("#interactionKey").textContent="E";this.dom.hint.classList.remove("is-hidden");}else this.dom.hint.classList.add("is-hidden");
      $("#touchActionLabel").textContent=action.label;const actionIcon=$("#touchActionIcon");if(action.iconKey)this.setIcon(actionIcon,action.iconKey);else this.setUIIcon(actionIcon,this.buildMode?"place":"interact");$("#touchAction").classList.toggle("is-ready",action.ready);$("#touchDodge strong").textContent=this.buildMode?"中止":"回避";const current=this.currentKey(),currentItem=D.items[current];$("#touchSelectedName").textContent=currentItem?.name||"素手";const selectedIcon=$("#touchSelectedIcon");selectedIcon.style.backgroundImage="none";if(currentItem)this.setIcon(selectedIcon,current);
    }
    actionDescriptor(){const key=this.currentKey(),item=D.items[key];if(this.buildMode)return{label:this.buildMode.hasPosition?"ここに置く":"場所を選ぶ",ready:this.buildGhost.valid&&this.buildMode.hasPosition};if(!this.target){if(item?.food||item?.water||item?.heal)return{label:item.water&&!item.food?"飲む":item.food?"食べる":"使う",iconKey:key,ready:true};if(item?.tool==="rod")return{label:"釣る",iconKey:key,ready:this.nearWater()};if(item?.tool==="hammer")return{label:"建築",iconKey:key,ready:true};if(item?.tool)return{label:item.tool==="weapon"?"攻撃":"振る",iconKey:key,ready:true};return{label:"行動",ready:false};}if(this.target.kind==="recovery")return{label:"回収",ready:true};if(this.target.kind==="enemy")return{label:"攻撃",iconKey:item?.tool?key:null,ready:true};if(this.target.kind==="resource"){const r=this.target.obj,labels={branch:"拾う",loose_stone:"拾う",fiber:"採る",berry_bush:"摘む",tree:"切る",stump:"割る",rock:"掘る",ore:"掘る",crystal:"掘る",shell:"拾う",herb:"摘む",resin:"拾う",sunroot:"抜く",moonbean:"摘む",tide_melon:"収穫"},tool=item?.tool;if(r.tool!=="hand"&&tool!==r.tool)return{label:r.tool==="axe"?"斧を選ぶ":"つるはしを選ぶ",iconKey:r.tool==="axe"?"axe":"pickaxe",ready:false};return{label:labels[r.type]||"採る",iconKey:r.tool!=="hand"?key:null,ready:true};}if(this.target.kind==="landmark"){const labels={lighthouse:"調べる",altar:"捧げる",windstone:"整える",well:"汲む",spring:"汲む",guide:"説明",relic:"記憶を見る",cache:"開ける",waymark:"起動する"};return{label:labels[this.target.obj.type]||"調べる",ready:true};}const def=D.buildings[this.target.obj.type];if(item?.tool==="hammer")return{label:"解体",iconKey:key,ready:true};const label=def?.farm?(this.target.obj.crop?(this.target.obj.stage>=3?"収穫":"手入れ"):"植える"):def?.water?"汲む":def?.commission?"おねがい":def?.travel?"移動":"使う";return{label,ready:true};}
    objectiveDetail(obj){
      const s=this.state;if(obj.id==="gather")return `枝 ${Math.min(3,Math.max(s.stats.gatheredBranch,s.inventory.branch||0))}/3 · 石 ${Math.min(3,Math.max(s.stats.gatheredStone,s.inventory.stone||0))}/3`;if(obj.id==="prisms")return `森 ${s.progress.prisms.forest?"済":"未"} · 潮 ${s.progress.prisms.tide?"済":"未"} · 岩 ${s.progress.prisms.rock?"済":"未"}`;return obj.detail;
    }
    drawMiniMap(targetCanvas=this.dom.mini){
      if(!this.world||!targetCanvas)return;const c=targetCanvas.getContext("2d"),w=targetCanvas.width,h=targetCanvas.height,colors=["#4baac8","#71dce1","#f4d58d","#93d96b","#67bd78","#9da7b8","#e2b875"],zoneColors={old_meadow:"#93d96b",moon_meadow:"#72d6b3",sunreach:"#b7df72",whisper_forest:"#4faf72",amber_grove:"#79b95b",north_coast:"#f4d58d",tideflats:"#ddcf91",old_quarry:"#9da7b8",crystal_ridge:"#a99be8"};c.imageSmoothingEnabled=false;c.fillStyle=colors[0];c.fillRect(0,0,w,h);for(let y=0;y<W.H;y++)for(let x=0;x<W.W;x++){const ex=Math.floor(x/W.W*W.FOG_COLS),ey=Math.floor(y/W.H*W.FOG_ROWS),seen=this.state.explored[ey*W.FOG_COLS+ex],tile=this.world.tiles[y*W.W+x],zone=this.world.zones[y*W.W+x];c.fillStyle=seen?(tile===W.TILE_ID.sea||tile===W.TILE_ID.shallow||tile===W.TILE_ID.path?colors[tile]:zoneColors[zone]||colors[tile]):"#dce9dd";c.fillRect(Math.floor(x/W.W*w),Math.floor(y/W.H*h),Math.ceil(w/W.W),Math.ceil(h/W.H));}
      for(const l of this.world.landmarks){const ex=Math.floor(l.x/(W.W*16)*W.FOG_COLS),ey=Math.floor(l.y/(W.H*16)*W.FOG_ROWS);if(!this.state.explored[ey*W.FOG_COLS+ex])continue;c.fillStyle=l.type==="lighthouse"?"#ffd166":l.type==="waymark"?"#71dce1":"#fffdf0";c.fillRect(l.x/(W.W*16)*w-1,l.y/(W.H*16)*h-1,3,3);}c.fillStyle="#27324d";const px=this.state.player.x/(W.W*16)*w,py=this.state.player.y/(W.H*16)*h;c.beginPath();c.moveTo(px,py-3);c.lineTo(px+3,py+3);c.lineTo(px-3,py+3);c.fill();
    }
    renderHotbar(){
      if(!this.state)return;this.dom.hotbar.innerHTML="";this.state.hotbar.forEach((stored,i)=>{const key=stored&&(this.state.inventory[stored]||0)>0?stored:null;if(stored&&!key)this.state.hotbar[i]=null;const b=document.createElement("button");b.type="button";b.className=`hot-slot${i===this.state.selectedHotbar?" selected":""}${key?"":" empty"}`;b.setAttribute("aria-label",key&&D.items[key]?`${i+1}: ${D.items[key].name}`:`${i+1}: 空`);b.innerHTML=`<small>${i+1}</small><span class="sprite-icon"></span><em>${key?(this.state.inventory[key]||0)||"":""}</em>`;if(key&&D.items[key])this.setIcon(b.querySelector(".sprite-icon"),key);b.addEventListener("click",()=>{this.state.selectedHotbar=i;this.renderHotbar();});this.dom.hotbar.appendChild(b);});
    }
    setIcon(el,itemKey){if(!el)return;el.style.filter="";const aliases={copper_watering_can:"watering_can",herbal_wrap:"fiber",crab_soup:"soup",sun_tonic:"water",thorn_skewer:"glow_skewer"},artKey=aliases[itemKey]||itemKey;if(ITEM_TOOL_ART[artKey]||ITEM_FOOD_ART[artKey]){this.assetStyle(el,`item_${artKey}`);if(itemKey==="copper_watering_can")el.style.filter="sepia(.55) saturate(1.4)";if(itemKey==="sun_tonic")el.style.filter="hue-rotate(285deg) saturate(1.4)";return;}const worldKey={shell:"shell",resin:"resin",herb:"herb",light_shard:"relic",prism_forest:"crystal",prism_tide:"crystal",prism_rock:"crystal",slime_gel:"slime",thorn_seed:"thorn",crab_meat:"crab",moss_shell:"crab",wisp_essence:"relic",crystal_dust:"crystal"}[itemKey];if(worldKey){this.assetStyle(el,`world_${worldKey}`);if(itemKey==="prism_forest")el.style.filter="hue-rotate(250deg) saturate(1.35)";if(itemKey==="prism_rock"||itemKey==="crystal_dust")el.style.filter="hue-rotate(70deg) saturate(1.3)";if(itemKey==="moss_shell")el.style.filter="hue-rotate(55deg) saturate(.8)";return;}const item=D.items[itemKey],s=this.sprites[`item.${item?.sprite||itemKey}`];if(!s)return;const scale=2;el.style.backgroundImage="url('assets/sprites.png')";el.style.backgroundRepeat="no-repeat";el.style.backgroundSize=`${window.LI_SPRITES.meta.size[0]*scale}px ${window.LI_SPRITES.meta.size[1]*scale}px`;el.style.backgroundPosition=`-${s.x*scale}px -${s.y*scale}px`;}

    openPanel(type,tab=null){
      if(this.buildMode&&type!=="build")this.cancelBuild();this.dom.modal.classList.remove("dismantle-modal");this.dom.backdrop.classList.remove("dismantle-backdrop");this.panel={type,tab};if(this.running)this.paused=true;this.forceRender=true;const gp=navigator.getGamepads?.()[0];this.gamepadMenuPrev=gp?gp.buttons.map(b=>b.pressed):[];this.dom.backdrop.classList.remove("is-hidden");this.renderPanel();setTimeout(()=>$("#modalClose").focus(),0);
    }
    openCustom(title,kicker,html){this.panel={type:"custom"};if(this.running)this.paused=true;this.forceRender=true;this.dom.backdrop.classList.remove("is-hidden");this.setModal(title,kicker,html,"","");}
    closePanel(){if(!this.panel)return;this.dom.backdrop.classList.add("is-hidden");this.dom.backdrop.classList.remove("dismantle-backdrop");this.dom.modal.classList.remove("dismantle-modal");this.panel=null;if(this.running&&!this.fishing&&!this.endingPlaying)this.paused=false;this.forceRender=true;this.canvas?.focus();}
    setModal(title,kicker,body,tabs="",footer=""){this.dom.modalTitle.textContent=title;this.dom.modalKicker.textContent=kicker;this.dom.body.innerHTML=body;this.dom.tabs.innerHTML=tabs;this.dom.tabs.classList.toggle("is-hidden",!tabs);this.dom.footer.innerHTML=footer;this.dom.footer.classList.toggle("is-hidden",!footer);}
    renderPanel(){
      if(!this.panel)return;const {type}=this.panel;if(type==="inventory")this.renderInventory();else if(type==="craft")this.renderCraft();else if(type==="build")this.renderBuild();else if(type==="journal")this.renderJournal();else if(type==="help")this.renderHelp();else if(type==="pause")this.renderPause();else if(type==="settings")this.renderSettings();else if(type==="save")this.renderSave();else if(type==="credits")this.renderCredits();else if(type==="lighthouse")this.renderLighthouse();else if(type==="storage")this.renderStorage();
    }
    tabBar(tabs,active){return tabs.map(([id,name])=>`<button type="button" data-tab="${id}" class="${id===active?"active":""}">${name}</button>`).join("");}
    bindTabs(){this.dom.tabs.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{this.panel.tab=b.dataset.tab;this.renderPanel();}));}
    renderInventory(){
      const entries=Object.entries(this.state.inventory).filter(([,n])=>n>0),slots=this.state.hotbar.map((stored,i)=>{const key=stored&&(this.state.inventory[stored]||0)>0?stored:null;return `<button type="button" class="hot-slot inventory-slot${i===this.state.selectedHotbar?" selected":""}${key?"":" empty"}" data-inventory-slot="${i}" aria-label="${i+1}: ${key?D.items[key].name:"空"}"><small>${i+1}</small><span class="sprite-icon" ${key?`data-icon="${key}"`:""}></span><em>${key?this.state.inventory[key]||"":""}</em></button>`;}).join(""),body=`<div class="inventory-summary"><strong>バッグ ${this.inventorySlotsUsed()} / ${this.inventoryLimit()}枠</strong><span>同じアイテムは一つの枠にまとまります。木箱へ預けると空きが増えます。</span></div><div class="panel-grid inventory-items">${entries.map(([key,n])=>this.itemHTML(key,n)).join("")||"<p>バッグは空です。</p>"}</div><section class="inventory-hotbar-wrap"><div><strong>ホットバーの入れ先を選ぶ</strong><small>枠を選んでから上のアイテムをタップ</small></div><div class="inventory-hotbar">${slots}</div></section>`;this.setModal("バッグ","INVENTORY",body,"",`<span>選択中: ${this.state.selectedHotbar+1}番枠 · 何もない枠では行動は切り替わりません。</span>`);this.hydrateIcons();this.dom.body.querySelectorAll("[data-inventory-slot]").forEach(b=>b.addEventListener("click",()=>{this.state.selectedHotbar=+b.dataset.inventorySlot;this.renderHotbar();this.renderInventory();}));this.dom.body.querySelectorAll("[data-item]").forEach(b=>b.addEventListener("click",()=>{const key=b.dataset.item;this.state.hotbar[this.state.selectedHotbar]=key;this.renderHotbar();this.status(`${this.state.selectedHotbar+1}番枠に${D.items[key].name}を入れた`);this.renderInventory();}));
    }
    itemHTML(key,n,small=""){const it=D.items[key];if(!it)return"";return `<button class="item-cell${this.currentKey()===key?" selected":""}" type="button" data-item="${key}"><span class="sprite-icon" data-icon="${key}"></span><strong>${it.name}</strong><em>×${n}</em><small>${small||it.description}</small></button>`;}
    hydrateIcons(root=this.dom.body){root.querySelectorAll("[data-icon]").forEach(el=>this.setIcon(el,el.dataset.icon));}
    hasStation(station){return station==="hand"||this.state.buildings.some(b=>D.buildings[b.type]?.station===station);}
    recipeUnlocked(recipe){if(D.items[recipe.output]?.masterwork&&this.state.progress.lighthouseStage<4)return false;if(!this.hasStation(recipe.station))return false;const rare=["slime_gel","thorn_seed","crab_meat","crystal_dust"];if(Object.keys(recipe.cost).some(k=>rare.includes(k))&&!Object.keys(recipe.cost).some(k=>(this.state.inventory[k]||0)>0)&&!this.state.crafted[recipe.output])return false;return true;}
    renderCraft(){
      const tab=this.panel.tab||"all",stations=[["campfire","焚き火"],["workbench","作業台"],["furnace","炉"]],tabs=this.tabBar([["all","発見済み"],["ready","今作れる"],["hand","手作り"],...stations.map(([id,name])=>[id,this.hasStation(id)?name:`${name} ?`])],tab);let list=D.recipes.filter(r=>this.recipeUnlocked(r));if(tab==="ready")list=list.filter(r=>this.canAfford(r.cost)&&this.stationAvailable(r.station));else if(!["all"].includes(tab))list=list.filter(r=>r.station===tab);const lockedStation=stations.find(([id])=>id===tab&&!this.hasStation(id)),nextStation=stations.find(([id])=>!this.hasStation(id));
      const cards=list.map(r=>{const ready=this.canAfford(r.cost)&&this.stationAvailable(r.station)&&(!(D.items[r.output].unique)||(this.state.inventory[r.output]||0)===0);return `<article class="recipe-card"><header><span class="sprite-icon" data-icon="${r.output}"></span><div><h3>${r.name}${r.count>1?` ×${r.count}`:""}</h3><small>${{hand:"手作り",campfire:"焚き火",workbench:"作業台",furnace:"炉"}[r.station]}</small></div></header><p>${r.description}</p><div class="costs">${Object.entries(r.cost).map(([k,n])=>`<span class="cost ${this.itemAmount(k)>=n?"ok":"no"}">${D.items[k].name} ${this.itemAmount(k)}/${n}</span>`).join("")}</div><button type="button" data-recipe="${D.recipes.indexOf(r)}" ${ready?"":"disabled"}>作る</button></article>`;}).join("");const discovery=lockedStation?`<div class="recipe-discovery"><strong>まだ見つけていない作り方</strong><p>${lockedStation[1]}を建てると、ここに新しいレシピが並びます。</p></div>`:nextStation&&tab==="all"?`<div class="recipe-discovery"><strong>次の発見: ${nextStation[1]}</strong><p>設備を建てると新しい道具や料理が解放されます。未発見の全レシピは表示しません。</p></div>`:"";const body=`${discovery}<div class="recipe-grid">${cards||(!lockedStation?"<p>条件に合うレシピはありません。</p>":"")}</div>`;
      this.setModal("クラフト","CRAFTING",body,tabs,`<span>設備の近くでは作れる物が増えます。</span>`);this.bindTabs();this.hydrateIcons();this.dom.body.querySelectorAll("[data-recipe]").forEach(b=>b.addEventListener("click",()=>this.craft(D.recipes[+b.dataset.recipe])));
    }
    renderBuild(){
      const tab=this.panel.tab||"life",tabs=this.tabBar([["life","生活"],["farm","農業"],["decor","飾り"],["special","特別"],["manage","建てた物"]],tab),hasHammer=this.state.inventory.hammer>0;let body="";
      if(tab!=="manage"){let entries=Object.entries(D.buildings);const category=([,b])=>b.commission||b.travel||b.postgame?"special":b.farm||b.water||b.autoWater||b.greenhouse?"farm":b.decor?"decor":"life";entries=entries.filter(e=>category(e)===tab&&this.buildingUnlocked(e[0]));const hint=!this.hasStation("workbench")?`<div class="recipe-discovery"><strong>作業台で建築の幅が広がる</strong><p>まず木槌と作業台を用意すると、床・柵・収納などが見えるようになります。</p></div>`:!this.hasStation("furnace")?`<div class="recipe-discovery"><strong>炉の先にも設計がある</strong><p>炉を建てると、銅や光晶を使う高度な設備が増えます。</p></div>`:"";body=`${hint}<div class="recipe-grid build-grid">${entries.map(([key,b])=>{const ready=hasHammer&&this.canAfford(b.cost)&&(!b.postgame||this.state.progress.lighthouseStage>=4);return `<article class="recipe-card build-card"><span class="building-preview" data-building="${key}"></span><div class="build-copy"><header><h3>${b.name}</h3><span class="hammer-required"><span class="sprite-icon hammer-required-icon" data-icon="hammer"></span>木槌必須</span></header><p>${b.description}</p><div class="costs">${Object.entries(b.cost).map(([k,n])=>`<span class="cost ${this.itemAmount(k)>=n?"ok":"no"}">${D.items[k].name} ${this.itemAmount(k)}/${n}</span>`).join("")}</div><button type="button" data-build="${key}" ${ready?"":"disabled"}>${!hasHammer?"木槌が必要":b.postgame&&this.state.progress.lighthouseStage<4?"灯台完成後":"配置する"}</button></div></article>`;}).join("")}</div>`;}
      else body=`<div class="recipe-grid build-grid">${this.state.buildings.map((b,i)=>`<article class="recipe-card build-card"><span class="building-preview" data-building="${b.type}"></span><div class="build-copy"><h3>${D.buildings[b.type]?.name}</h3><p>設置 ${i+1} · 島の地図上で確認してから解体します。</p><button type="button" data-locate="${b.id}"><span class="ui-raster" data-ui="locate"></span>場所を見て選ぶ</button></div></article>`).join("")||"<p>まだ建築物はありません。</p>"}</div>`;
      this.setModal("建築","BUILDING",body,tabs,`<span>配置中は地面をタップして場所を選び、「ここに置く」で確定します。</span>`);this.bindTabs();this.hydrateUIIcons(this.dom.body);this.dom.body.querySelectorAll("[data-build]").forEach(b=>b.addEventListener("click",()=>this.beginBuild(b.dataset.build)));this.dom.body.querySelectorAll("[data-locate]").forEach(b=>b.addEventListener("click",()=>this.focusBuilding(b.dataset.locate)));
    }
    buildingUnlocked(type){const def=D.buildings[type];if(!def)return false;if(["campfire","workbench"].includes(type))return true;if(def.postgame)return this.state.progress.lighthouseStage>=4;if(!this.hasStation("workbench"))return false;const advanced=["well","sprinkler","greenhouse","sun_dial","beacon_garden","prism_arch","waystone"];if(advanced.includes(type)&&!this.hasStation("furnace"))return false;const rare={healing_totem:"moss_shell",moss_rug:"moss_shell",wisp_lantern:"wisp_essence",warden_banner:"crystal_dust"}[type];if(rare&&!(this.state.inventory[rare]>0)&&!this.state.discovered.includes(`building:${type}`))return false;return true;}
    renderJournal(){
      const tab=this.panel.tab||"tasks",tabs=this.tabBar([["tasks","道しるべ"],["commissions","日替わり"],["mastery","熟練と技能"],["collection","島の記憶"],["map","地図"],["fish","魚図鑑"],["achievements","実績"]],tab);let body="";
      if(tab==="tasks"){const rating=this.islandRating(),visuals=["branch","axe","hammer","campfire","cooked_berry","workbench","lighthouse","stone","copper_bar","crystal","lighthouse","guide"],visual=(key)=>BUILDING_ART[key]?`<span class="journal-visual building-preview" data-building="${key}"></span>`:`<span class="journal-visual sprite-icon" data-icon="${key}"></span>`;body=`<div class="rank-banner"><div><small>ISLAND RANK</small><strong>島評価 ${rating.total}/30</strong><p>自然 ${rating.nature}/10　生活 ${rating.life}/10　発見 ${rating.discovery}/10</p></div><span class="rank-letter">${rating.rank}</span></div><div class="journal-objectives">`+D.objectives.map((o,i)=>`<article class="journal-card visual-journal ${i===this.state.progress.objective?"current":""}">${visual(visuals[i])}<div><small class="state-label">${i<this.state.progress.objective?"完了":i===this.state.progress.objective?"現在の目標":"このあと"}</small><h3>${o.title}</h3><p>${this.objectiveDetail(o)}</p></div></article>`).join("")+`</div><article class="journal-card"><h3>地域の光</h3><p>森 ${this.state.progress.prisms.forest?"完了":"未完了"}　潮 ${this.state.progress.prisms.tide?"完了":"未完了"}　岩 ${this.state.progress.prisms.rock?"完了":"未完了"}</p></article>`;}
      else if(tab==="commissions"){this.ensureDailyContent();body=`<div class="progress-currency"><span class="sprite-icon" data-icon="light_shard"></span><div><small>技能の習得に使う</small><br><b>陽だまり記章 ${this.state.progress.sunBadges}</b></div></div><div class="commission-grid">${this.state.progress.commissions.map((c,i)=>{const def=D.commissions.find(x=>x.id===c.id),n=Math.min(c.goal,this.commissionProgress(c)),done=n>=c.goal;return `<article class="commission-card ${c.claimed?"claimed":done?"done":""}"><header><h3>${def.name}</h3><b>記章 +${c.reward}</b></header><p>${def.desc}　${n}/${c.goal}</p><div class="progress-line"><b style="width:${n/c.goal*100}%"></b></div>${!c.claimed?`<button type="button" data-claim="${i}" ${done?"":"disabled"}>${done?"報酬を受け取る":"進行中"}</button>`:"<p>受取済み</p>"}</article>`;}).join("")}</div><p class="help-note">おねがいは島の朝ごとに3件更新されます。達成済みでも、朝を迎える前に報酬を受け取ってください。</p>`;}
      else if(tab==="mastery"){const masteryIcons={gather:"branch",craft:"hammer",farm:"seed",fish:"fish",combat:"spear",explore:"journal"};body=`<div class="progress-currency"><span class="sprite-icon" data-icon="light_shard"></span><div><small>熟練度上昇と日替わり報酬で獲得</small><br><b>陽だまり記章 ${this.state.progress.sunBadges}</b></div></div><h3>六つの熟練</h3><div class="mastery-grid">${D.mastery.map(m=>{const lv=this.masteryLevel(m.id),value=m.metric(this.state),next=m.thresholds[Math.min(10,lv+1)],ratio=lv>=10?100:(value-m.thresholds[lv])/(next-m.thresholds[lv])*100,key=masteryIcons[m.id],icon=m.id==="explore"?`<span class="ui-raster mastery-icon" data-ui="journal"></span>`:`<span class="sprite-icon mastery-icon" data-icon="${key}"></span>`;return `<article class="mastery-card"><header>${icon}<div><small>${m.perk}</small><h3>${m.name}</h3></div><span class="mastery-level">${lv}</span></header><p>${lv>=10?"MASTER":`${Math.floor(value)} / ${next}`}</p><div class="progress-line"><b style="width:${clamp(ratio,0,100)}%"></b></div></article>`;}).join("")}</div><h3>記章で覚える技能</h3><div class="mastery-grid">${D.upgrades.map(u=>{const owned=!!this.state.progress.upgrades[u.id],ready=this.state.progress.sunBadges>=u.cost;return `<article class="mastery-card upgrade-card ${owned?"owned":""}"><header><h3>${u.name}</h3><b>記章 ${u.cost}</b></header><p>${u.desc}</p><button type="button" data-upgrade="${u.id}" ${owned||!ready?"disabled":""}>${owned?"習得済み":"習得する"}</button></article>`;}).join("")}</div>`;}
      if(!["tasks","commissions","mastery"].includes(tab)){if(tab==="collection"){const found=this.state.progress.relics.filter(Boolean).length;body=`<div class="rank-banner"><div><small>ISLAND MEMORIES</small><strong>島の記憶 ${found}/${D.relics.length}</strong><p>各地に浮かぶ光の遺物を調べよう。1個につき記章2。</p></div><span class="rank-letter">${found}</span></div><div class="collection-grid">${D.relics.map((r,i)=>`<article class="collection-card ${this.state.progress.relics[i]?"":"locked"}"><span class="collection-icon world-preview" data-world="relic"></span><h3>${this.state.progress.relics[i]?r.name:`記憶 ${i+1}`}</h3><p>${this.state.progress.relics[i]?r.desc:"まだ見つけていない"}</p></article>`).join("")}</div><article class="journal-card"><h3>発見記録</h3><p>地域 ${Object.values(this.state.progress.regions).filter(Boolean).length}/4　資源 ${this.state.discovered.filter(x=>x.startsWith("resource:")).length}/8　場所 ${this.state.discovered.filter(x=>x.startsWith("landmark:")).length}/${this.world.landmarks.length}</p></article>`;}
      else if(tab==="map")body=`<canvas id="largeMap" class="map-large" width="576" height="576"></canvas><p style="text-align:center">探索率 ${Math.round(this.state.explored.filter(Boolean).length/this.state.explored.length*100)}%</p>`;
      else if(tab==="fish")body=`<div class="panel-grid">${D.fish.map(k=>this.itemHTML(k,this.state.fishCaught[k]||0,this.state.fishCaught[k]?"発見済み":"まだ釣っていない")).join("")}</div><p class="help-note">時間、天候、地域、釣り竿によって出会える魚が変わります。</p>`;
      else body=`<div class="recipe-grid">${D.achievements.map(a=>`<article class="journal-card"><small class="state-label">${this.state.achievements[a.id]?"達成済み":"未達成"}</small><h3>${a.name}</h3><p>${a.desc}</p></article>`).join("")}</div>`;}
      this.setModal("島の手帳","JOURNAL",body,tabs,`<span>${this.state.day}日目 · プレイ ${Math.floor(this.state.playSeconds/60)}分 · 実績 ${Object.keys(this.state.achievements).length}/${D.achievements.length}</span>`);this.bindTabs();this.hydrateIcons();this.hydrateUIIcons(this.dom.body);if(tab==="map")this.drawMiniMap($("#largeMap"));this.dom.body.querySelectorAll("[data-claim]").forEach(b=>b.onclick=()=>this.claimCommission(+b.dataset.claim));this.dom.body.querySelectorAll("[data-upgrade]").forEach(b=>b.onclick=()=>this.buyUpgrade(b.dataset.upgrade));
    }
    openTutorial(step=0,replay=false){
      const coarse=matchMedia("(pointer:coarse)").matches||innerWidth<=760,steps=[
        {target:"#gameCanvas",title:"島の職人、ヒナ",text:"この姿があなたです。島を歩き、素材を集め、古い灯台を直して暮らします。",center:true},
        {target:coarse?"#joystick":"#gameCanvas",title:"移動",text:coarse?"いま光っているパッドへ指を置き、行きたい方向へ倒します。":"WASDか矢印キーで歩きます。Shiftで走れます。"},
        {target:coarse?"#touchAction":"#interactionHint",title:"行動はこの一つ",text:"近くの物と選んだ道具に合わせて、拾う・採る・攻撃・食べる・使うが自動で切り替わります。"},
        {target:"#hotbar",title:"使う物を選ぶ",text:"下の現物アイコンをタップして道具や食べ物を選びます。斧・つるはし・槍は形で見分けられます。"},
        {target:".primary-actions",title:"よく使うメニュー",text:"バッグ・クラフト・建築・手帳は、スマホでも届きやすい画面下側にあります。"},
        {target:"#objectiveHud",title:"まずは枝と石から",text:"この欄が次の目標を一つずつ案内します。説明を閉じたら、近くの枝と石を集めましょう。"}
      ],index=clamp(step,0,steps.length-1),page=steps[index];this.dom.hint.classList.remove("coach-demo-control");if(page.target==="#interactionHint"){this.dom.hint.querySelector("span").textContent="行動";this.dom.hint.classList.remove("is-hidden");this.dom.hint.classList.add("coach-demo-control");}this.dom.backdrop.classList.add("is-hidden");this.panel=null;this.paused=true;this.coach={step:index,replay,steps};this.dom.coach.classList.remove("is-hidden");$("#coachStep").textContent=`${index+1} / ${steps.length}`;$("#coachTitle").textContent=page.title;$("#coachText").textContent=page.text;$("#coachNext").textContent=index===steps.length-1?(replay?"説明を閉じる":"始める"):"次へ";$("#coachNext").onclick=()=>index===steps.length-1?this.finishTutorial():this.openTutorial(index+1,replay);this.positionCoach();
    }
    positionCoach(){if(!this.coach)return;const page=this.coach.steps[this.coach.step],shell=this.dom.shell.getBoundingClientRect(),target=$(page.target),spot=$("#coachSpotlight"),bubble=$("#coachBubble"),arrow=$("#coachArrow");if(!target)return;const r=target.getBoundingClientRect(),pad=8,local={left:r.left-shell.left-pad,top:r.top-shell.top-pad,width:r.width+pad*2,height:r.height+pad*2};if(page.center){local.left=shell.width/2-48;local.top=shell.height/2-62;local.width=96;local.height=124;}Object.assign(spot.style,{left:`${local.left}px`,top:`${local.top}px`,width:`${local.width}px`,height:`${local.height}px`});requestAnimationFrame(()=>{const bw=Math.min(bubble.offsetWidth,shell.width-16),bh=bubble.offsetHeight,cx=local.left+local.width/2,above=local.top>bh+24,left=clamp(cx-bw/2,8,shell.width-bw-8),top=above?local.top-bh-16:Math.min(shell.height-bh-8,local.top+local.height+16);bubble.style.left=`${left}px`;bubble.style.top=`${Math.max(8,top)}px`;arrow.style.left=`${clamp(cx-7,8,shell.width-22)}px`;arrow.style.top=`${above?local.top-10:local.top+local.height}px`;arrow.classList.toggle("down",above);});}
    finishTutorial(){if(!this.state.progress.tutorialDone){this.state.progress.tutorialDone=true;this.state.progress.enemyGraceUntil=0;this.safeSave(false);}this.dom.hint.classList.remove("coach-demo-control");if(!this.target)this.dom.hint.classList.add("is-hidden");this.dom.coach.classList.add("is-hidden");this.coach=null;this.panel=null;this.paused=false;this.status("次の目標: 枝3本と石3個を集める");this.canvas.focus();}
    renderHelp(){const coarse=matchMedia("(pointer:coarse)").matches||innerWidth<=760,body=`<div class="visual-help"><article><span class="ui-raster help-control" data-ui="interact"></span><div><h3>行動</h3><p>一つのボタンが、採取・攻撃・使用へ自動で切り替わります。</p></div></article><article><span class="ui-raster help-control" data-ui="dodge"></span><div><h3>回避</h3><p>敵の赤い予告から素早く離れます。</p></div></article><article><span class="sprite-icon help-control" data-icon="axe"></span><div><h3>道具を選ぶ</h3><p>画面下の現物アイコンから、必要な道具を選びます。</p></div></article><article><span class="ui-raster help-control" data-ui="build"></span><div><h3>基本メニュー</h3><p>${coarse?"バッグ・作る・建てる・手帳は画面下から開きます。":"I / C / B / J キーでも開けます。"}</p></div></article><article><span class="sprite-icon help-control" data-icon="cooked_fish"></span><div><h3>体力を回復</h3><p>焼き魚や上位料理、島草の包帯は赤い体力を回復します。</p></div></article><article><span class="sprite-icon help-control" data-icon="hammer"></span><div><h3>建築には木槌</h3><p>木材5で木槌を手作りし、建築一覧の「木槌必須」表示が付いた物を配置します。</p></div></article></div><div class="details-card"><h3>もう一度、実画面で確認</h3><p>実際の操作部分を順番に光らせて案内します。</p><div class="save-actions"><button id="replayTutorial" type="button">画面上で案内を見る</button><button id="openDailyHelp" type="button">島のおねがいを見る</button></div></div>`;this.setModal("操作と遊び方","HOW TO PLAY",body,"",`<span>料理と包帯で体力を回復できます。</span>`);this.hydrateIcons();this.hydrateUIIcons(this.dom.body);$("#replayTutorial").onclick=()=>this.openTutorial(0,true);$("#openDailyHelp").onclick=()=>{this.panel={type:"journal",tab:"commissions"};this.renderPanel();};}
    renderPause(){const tabs=this.tabBar([["pause","休憩"],["settings","設定"],["save","セーブ"]],this.panel.tab||"pause");if(this.panel.tab==="settings"){this.renderSettings(true);return;}if(this.panel.tab==="save"){this.renderSave(true);return;}this.setModal("ひと休み","PAUSED",`<div class="details-card"><h3>ルミナ島 ${this.state.day}日目</h3><p>ゲームは停止しています。</p><div class="save-actions"><button id="resumeGame" type="button">ゲームへ戻る</button><button id="saveNow" type="button">今すぐ保存</button><button id="safeReturn" type="button">最後に休んだ場所へ戻る</button><button id="returnTitle" type="button">タイトルへ戻る</button></div></div>`,tabs);this.bindTabs();$("#resumeGame").onclick=()=>this.closePanel();$("#saveNow").onclick=()=>this.safeSave(true);$("#safeReturn").onclick=()=>{this.state.player.x=this.state.player.spawnX;this.state.player.y=this.state.player.spawnY;this.closePanel();this.status("最後に休んだ場所へ戻りました");};$("#returnTitle").onclick=()=>this.returnTitle();}
    renderSettings(fromPause=false){
      const s=this.state?.settings||LI.Save.loadSettings(),tabs=fromPause?this.tabBar([["pause","休憩"],["settings","設定"],["save","セーブ"]],"settings"):"";const range=(id,label,val)=>`<div class="settings-row"><label for="${id}">${label}</label><input id="${id}" data-setting="${id}" type="range" min="0" max="1" step=".05" value="${val}"></div>`,check=(id,label,val)=>`<div class="settings-row"><label for="${id}">${label}</label><input id="${id}" data-setting="${id}" type="checkbox" ${val?"checked":""}></div>`;
      const body=`<section class="settings-group"><h3>音</h3>${range("master","全体音量",s.master)}${range("music","BGM",s.music)}${range("sfx","効果音",s.sfx)}${check("muted","ミュート",s.muted)}</section><section class="settings-group"><h3>表示と操作</h3>${check("highContrast","高コントラスト",s.highContrast)}${check("reducedMotion","動きを減らす",s.reducedMotion)}${check("screenShake","画面揺れ",s.screenShake)}${check("autoRun","オートラン",s.autoRun)}${check("vibration","振動",s.vibration)}<div class="settings-row"><label for="uiScale">UIサイズ</label><select id="uiScale" data-setting="uiScale"><option value=".9">90%</option><option value="1">100%</option><option value="1.15">115%</option><option value="1.3">130%</option></select></div><div class="settings-row"><label for="quality">描画品質</label><select id="quality" data-setting="quality"><option value="auto">自動</option><option value="low">軽量</option><option value="high">高品質</option></select></div><div class="settings-row"><label for="touchLayout">スマホ利き手</label><select id="touchLayout" data-setting="touchLayout"><option value="right">右手でボタン</option><option value="left">左手でボタン</option></select></div><div class="settings-row"><label for="touchButtonScale">スマホボタン</label><select id="touchButtonScale" data-setting="touchButtonScale"><option value=".9">小さめ</option><option value="1">標準</option><option value="1.15">大きめ</option></select></div></section><section class="settings-group"><h3>遊びやすさ</h3><div class="settings-row"><label for="needsRate">生存値</label><select id="needsRate" data-setting="needsRate"><option value=".7">やさしい</option><option value="1">標準</option></select></div><div class="settings-row"><label for="enemyDamage">敵ダメージ</label><select id="enemyDamage" data-setting="enemyDamage"><option value=".7">70%</option><option value="1">100%</option></select></div></section>`;
      this.setModal("設定","OPTIONS",body,tabs,`<span>設定は全スロットで共有されます。</span>`);if(tabs)this.bindTabs();["uiScale","quality","touchLayout","touchButtonScale","needsRate","enemyDamage"].forEach(id=>{const el=$(`#${id}`);if(el)el.value=String(s[id]);});this.dom.body.querySelectorAll("[data-setting]").forEach(el=>el.addEventListener("input",()=>{const id=el.dataset.setting;s[id]=el.type==="checkbox"?el.checked:(el.tagName==="SELECT"?(isNaN(+el.value)?el.value:+el.value):+el.value);this.applySettings(s);LI.Save.saveSettings(s);if(this.state)this.state.settings={...s};}));
    }
    applySettings(settings){const ui=Number(settings.uiScale)||1;document.documentElement.style.setProperty("--ui-scale",ui);document.documentElement.style.setProperty("--touch-scale",Number(settings.touchButtonScale)||1);document.documentElement.style.setProperty("--objective-top",`${Math.round(20+92*ui)}px`);document.documentElement.style.setProperty("--objective-mobile-top",`${Math.round(66+86*ui)}px`);document.documentElement.style.setProperty("--side-actions-top",`${Math.round(20+104*ui)}px`);document.body.classList.toggle("high-contrast",!!settings.highContrast);document.body.classList.toggle("reduce-motion",!!settings.reducedMotion);document.body.classList.toggle("low-quality",settings.quality==="low");document.body.classList.toggle("touch-left",settings.touchLayout==="left");LI.audio.setSettings(settings);if(this.state)this.state.settings=settings;this.resize();}
    renderSave(fromPause=false){
      const tabs=fromPause?this.tabBar([["pause","休憩"],["settings","設定"],["save","セーブ"]],"save"):"";let body="";for(let slot=1;slot<=3;slot++){const info=LI.Save.slotInfo(slot);body+=`<article class="save-card${info.broken?" danger-zone":""}"><div><strong>スロット ${slot}</strong><p>${info.empty?(info.broken?"破損データがあります":"空きスロット"):`${info.day}日目 · 灯台 ${info.stage}/4 · ${this.escape(info.seedText)}`}</p></div><div class="save-actions">${!info.empty?`<button data-export="${slot}" type="button">書き出す</button>`:""}<button data-import="${slot}" type="button">読み込む</button>${!info.empty||info.broken?`<button data-delete="${slot}" type="button">削除</button>`:""}</div></article>`;}body+=`<section class="settings-group"><h3>JSONを貼り付けて読み込む</h3><textarea id="savePaste" rows="5" style="width:100%;resize:vertical" placeholder="書き出したJSONをここへ貼り付け"></textarea><input id="saveFile" type="file" accept="application/json,.json"></section>`;
      this.setModal("セーブ管理","SAVE DATA",body,tabs,`<span>保存は主データ・バックアップ・一時検証の三段階です。</span>`);if(tabs)this.bindTabs();this.dom.body.querySelectorAll("[data-export]").forEach(b=>b.onclick=()=>{try{LI.Save.download(+b.dataset.export);this.toast("セーブを書き出しました","good");}catch(e){this.toast(e.message,"warn");}});this.dom.body.querySelectorAll("[data-import]").forEach(b=>b.onclick=()=>this.importSave(+b.dataset.import));this.dom.body.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{const slot=+b.dataset.delete;if(confirm(`スロット ${slot} を削除しますか？ この操作は元に戻せません。`)&&confirm("本当に削除しますか？")){LI.Save.remove(slot);if(this.slot===slot)this.returnTitle();else{this.renderSave(fromPause);this.renderSlots();}}});$("#saveFile").onchange=async e=>{$("#savePaste").value=await e.target.files[0]?.text()||"";};
    }
    importSave(slot){const raw=$("#savePaste").value.trim();if(!raw){this.toast("JSONを貼り付けるかファイルを選んでください","warn");return;}try{const result=LI.Save.importSlot(slot,raw);if(!result.ok)throw result.error;if(this.running&&this.slot===slot){this.closePanel();this.startGame(result.state,false);this.toast(`スロット ${slot} を読み込み直しました`,`good`);}else{this.toast(`スロット ${slot} へ読み込みました`,`good`);this.renderSave(this.running);this.renderSlots();}}catch(error){this.toast(`読み込み失敗: ${error.message}`,"warn");}}
    renderCredits(){const c=D.credits;this.setModal("クレジット","CREDITS",`<div class="details-card"><h3>${c.title}</h3><p>企画・実装・生成素材: ${c.author}</p><p>バージョン ${c.version} / ${c.year}</p><p>画像: built-in imagegenによるキービジュアルと、プロジェクト内生成スクリプトによるピクセルアトラス。</p><p>音楽・効果音: プロジェクト内の合成スクリプトで制作した完全オリジナル音源。</p><p>外部ライブラリ、外部素材、通信APIは使用していません。</p></div><div class="details-card"><h3>操作</h3><p>移動 WASD / 矢印　使う E / Space　回避 Shift / K<br>バッグ I　クラフト C　建築 B　地図 M　休憩 Esc</p></div>`);}
    renderLighthouse(){
      const s=this.state.progress.lighthouseStage,p=this.state.progress,prisms=Object.values(p.prisms).filter(Boolean).length;let action="",desc="";
      if(s===0){desc="波で崩れた台座を、木と石で組み直せそうだ。";action=`<button id="lighthouseAction" class="pixel-button" ${this.canAfford({wood:20,stone:20})?"":"disabled"}>台座を修理（木材20・石20）</button>`;}
      else if(s===1){desc="次は光を受け止める銅のレンズ枠が必要だ。";action=`<button id="lighthouseAction" class="pixel-button" ${this.canAfford({copper_bar:8,crystal:5})?"":"disabled"}>レンズ枠を作る（銅塊8・光晶5）</button>`;}
      else if(s===2){desc=`森・潮・岩の光がレンズを満たす。現在 ${prisms}/3。`;action=`<button id="lighthouseAction" class="pixel-button" ${prisms===3?"":"disabled"}>三つのプリズムを収める</button>`;}
      else if(s===3){desc="すべての光が揃った。灯台を再点灯できる。";action=`<button id="lighthouseAction" class="pixel-button">光を灯す</button>`;}
      else{const rating=this.islandRating(),relics=this.state.progress.relics.filter(Boolean).length;desc=`灯台は毎朝、光のかけらを${this.state.progress.upgrades.beacon?"二つ":"一つ"}生み出す。`;action=`<div class="save-actions" style="justify-content:center"><button id="openLighthouseDaily" class="pixel-button">日替わり ${this.state.progress.commissions.filter(c=>c.claimed).length}/3</button><button id="openLighthouseMastery" class="pixel-button">島評価 ${rating.total}/30</button><button id="openLighthouseRelics" class="pixel-button">記憶 ${relics}/8</button></div>`;}
      this.setModal("古い灯台","LIGHTHOUSE",`<div class="details-card"><h3>復旧段階 ${s}/4</h3><p>${desc}</p><div class="progress-line"><b style="width:${s/4*100}%"></b></div></div><div style="text-align:center">${action}</div>`);const b=$("#lighthouseAction");if(b)b.onclick=()=>this.advanceLighthouse();
      const openTab=tab=>{this.panel={type:"journal",tab};this.renderPanel();};if($("#openLighthouseDaily"))$("#openLighthouseDaily").onclick=()=>openTab("commissions");if($("#openLighthouseMastery"))$("#openLighthouseMastery").onclick=()=>openTab("mastery");if($("#openLighthouseRelics"))$("#openLighthouseRelics").onclick=()=>openTab("collection");
    }
    advanceLighthouse(){const p=this.state.progress,s=p.lighthouseStage;if(s===0){if(!this.pay({wood:20,stone:20}))return;p.lighthouseStage=1;}else if(s===1){if(!this.pay({copper_bar:8,crystal:5}))return;p.lighthouseStage=2;}else if(s===2){if(!Object.values(p.prisms).every(Boolean))return;["prism_forest","prism_tide","prism_rock"].forEach(k=>this.removeItem(k,1));p.lighthouseStage=3;}else if(s===3){p.lighthouseStage=4;p.endingSeen=true;p.sunBadges+=5;this.unlock("lighthouse");this.completeEnding();return;}LI.audio.effect("craft");this.burst(36.5*16,43*16,"#ffd166",28);this.safeSave(true);this.updateObjective(true);this.renderLighthouse();}
    completeEnding(){this.safeSave(true);this.closePanel();this.paused=true;this.endingPlaying=true;this.dom.ending.classList.remove("is-hidden");LI.audio.playMusic("homecoming");this.burst(this.state.player.x,this.state.player.y,"#ffd166",60);}
    openStorage(b){this.panel={type:"storage",id:b.id};if(!this.state.storage[b.id])this.state.storage[b.id]={};this.paused=true;this.dom.backdrop.classList.remove("is-hidden");this.renderStorage();}
    renderStorage(){const store=this.state.storage[this.panel.id]||{},inv=Object.entries(this.state.inventory).filter(([,n])=>n>0),stored=Object.entries(store).filter(([,n])=>n>0),used=stored.length;this.setModal("木箱","STORAGE",`<div class="inventory-summary"><strong>木箱 ${used} / 24枠</strong><span>バッグ ${this.inventorySlotsUsed()} / ${this.inventoryLimit()}枠</span></div><h3>バッグ → 木箱</h3><div class="panel-grid">${inv.map(([k,n])=>this.itemHTML(k,n,"クリックで1個しまう")).join("")}</div><h3>木箱 → バッグ</h3><div class="panel-grid storage-out">${stored.map(([k,n])=>this.itemHTML(k,n,"クリックで1個取り出す")).join("")||"<p>空です。</p>"}</div>`);this.hydrateIcons();const all=this.dom.body.querySelectorAll("[data-item]");all.forEach((el,i)=>el.onclick=()=>{const key=el.dataset.item;if(i<inv.length){if(!(store[key]>0)&&Object.values(store).filter(n=>n>0).length>=24){this.toast("木箱が24枠でいっぱいです","warn");return;}this.removeItem(key,1);store[key]=(store[key]||0)+1;}else if(store[key]>0){if(!this.canAddItem(key)){this.toast("バッグに空きがありません","warn");return;}store[key]--;if(store[key]<=0)delete store[key];this.addItem(key,1,false);}this.renderStorage();});}

    safeSave(show=false){if(!this.state||!this.slot)return false;const result=LI.Save.save(this.slot,this.state);if(result.ok){this.state=result.state;if(show)this.toast("保存しました","good");this.autosaveFailed=false;return true;}if(!this.autosaveFailed||show)this.toast("保存できません。セーブ管理から書き出してください。","warn");this.autosaveFailed=true;return false;}
    toast(message,type=""){if(type==="good"||type==="info"||!type){this.status(message);return;}const now=performance.now();if(this.lastToast?.message===message&&now-this.lastToast.time<1800)return;this.lastToast={message,time:now};const el=document.createElement("div");el.className=`toast ${type}`;el.textContent=message;this.dom.toast.replaceChildren(el);setTimeout(()=>el.remove(),2600);}
    status(message){if(!message)return;const existing=Array.from(this.dom.feed.children).find(el=>el.textContent===message);if(existing){existing.remove();this.dom.feed.appendChild(existing);return;}const el=document.createElement("span");el.className="status-line";el.textContent=message;this.dom.feed.appendChild(el);while(this.dom.feed.children.length>4)this.dom.feed.firstElementChild.remove();setTimeout(()=>el.remove(),2600);}
    pickup(message){const el=document.createElement("span");el.className="pickup-line";el.textContent=message;this.dom.feed.appendChild(el);while(this.dom.feed.children.length>4)this.dom.feed.firstElementChild.remove();setTimeout(()=>el.remove(),2100);LI.audio.effect("pickup",.95+Math.random()*.1);}
    escape(value){return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
  }

  LI.Game=Game;
  window.addEventListener("DOMContentLoaded",()=>{LI.game=new Game();LI.game.init();});
})();
