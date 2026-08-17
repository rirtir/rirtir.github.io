(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  const VERSION=4, FOG_COLS=32,FOG_ROWS=32,PREFIX="luminaIsle_save_v1_slot_", SETTINGS_KEY="luminaIsle_settings_v1";
  const copy=value=>JSON.parse(JSON.stringify(value));

  function hash(text){
    let h=0x811c9dc5;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}
    return (h>>>0).toString(16).padStart(8,"0");
  }
  function seedFrom(value){
    const text=String(value||`${Date.now()}-${Math.random()}`);let h=2166136261;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
    return h>>>0||0x71f15e;
  }
  function defaultSettings(){
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches||false;
    const contrast=window.matchMedia?.("(prefers-contrast: more)")?.matches||false;
    return {master:.8,music:.62,sfx:.82,ambient:.5,muted:false,uiScale:1,needsRate:1,enemyDamage:1,
      fishingAssist:1,highContrast:contrast,reducedMotion:reduced,screenShake:!reduced,particles:"high",quality:"auto",
      touchLayout:"right",joystick:"fixed",tapMove:false,autoRun:false,vibration:true,touchButtonScale:1};
  }
  function newState(slot,seedText){
    const seed=seedFrom(seedText);
    return {schemaVersion:VERSION,slot,seed,seedText:String(seedText||seed.toString(36).toUpperCase()),rngState:seed,
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),playSeconds:0,day:1,clock:60,weather:"sunny",
      player:{x:36.5*16,y:54.5*16,dir:"down",hp:100,food:88,water:90,stamina:100,maxHp:100,maxStamina:100,
        spawnX:36.5*16,spawnY:54.5*16,invulnerable:0,buffUntil:0,glowUntil:0,watering:0},
      inventory:{branch:2,berry:2},hotbar:[null,null,null,null,"berry",null,null,null],selectedHotbar:4,
      buildings:[],storage:{},crops:[],terrainChanges:[],removedResources:{},discovered:[],recovery:null,
      progress:{objective:0,lighthouseSeen:false,lighthouseStage:0,prisms:{forest:false,tide:false,rock:false},forestPlanted:0,fishOffered:[],windstones:[false,false,false],endingSeen:false,postgameRewardDay:0,regions:{grass:false,forest:false,beach:false,rock:false},zones:{},caches:{},waymarks:{},tutorialDone:false,enemyGraceUntil:0,relics:Array(8).fill(false),commissionsDay:0,commissions:[],sunBadges:0,upgrades:{},masteryLevels:{},masteryRewards:{},enemyTrophies:{},outfit:"island"},
      achievements:{},crafted:{},fishCaught:{},stats:{gathered:0,gatheredBranch:0,gatheredStone:0,crafted:0,cooked:0,built:0,harvested:0,fishCaught:0,enemiesCalmed:0,dodges:0,damageTaken:0,planted:0,passedNights:0,knockouts:0,relics:0,commissions:0,distance:0},
      explored:Array(FOG_COLS*FOG_ROWS).fill(0),messagesSeen:{},settings:loadSettings()};
  }
  function loadSettings(){
    try{return {...defaultSettings(),...JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null")};}catch(_){return defaultSettings();}
  }
  function saveSettings(settings){
    try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({...defaultSettings(),...settings}));return true;}catch(_){return false;}
  }
  function envelope(state){
    const payload=JSON.stringify(state);return JSON.stringify({schemaVersion:VERSION,checksum:hash(payload),payload});
  }
  function unpack(raw){
    if(!raw)throw new Error("保存データがありません");
    const box=JSON.parse(raw);
    if(!box||typeof box.payload!=="string"||box.schemaVersion>VERSION)throw new Error("未対応の保存形式です");
    if(hash(box.payload)!==box.checksum)throw new Error("チェックサムが一致しません");
    const state=JSON.parse(box.payload);
    if(!state||!Number.isFinite(state.seed)||!state.player||!state.inventory)throw new Error("必要な項目がありません");
    return migrate(state);
  }
  function migrate(state){
    if((state.schemaVersion||0)>VERSION)throw new Error("このゲームより新しい保存データです");
    const previousVersion=state.schemaVersion||0;
    const base=newState(state.slot||1,state.seedText||state.seed);
    const merged={...base,...state};
    merged.player={...base.player,...state.player};
    merged.progress={...base.progress,...state.progress,prisms:{...base.progress.prisms,...state.progress?.prisms},regions:{...base.progress.regions,...state.progress?.regions},zones:{...base.progress.zones,...state.progress?.zones},caches:{...base.progress.caches,...state.progress?.caches},waymarks:{...base.progress.waymarks,...state.progress?.waymarks},upgrades:{...base.progress.upgrades,...state.progress?.upgrades},masteryLevels:{...base.progress.masteryLevels,...state.progress?.masteryLevels},masteryRewards:{...base.progress.masteryRewards,...state.progress?.masteryRewards},enemyTrophies:{...base.progress.enemyTrophies,...state.progress?.enemyTrophies}};
    merged.progress.relics=Array.from({length:8},(_,i)=>!!state.progress?.relics?.[i]);
    merged.progress.commissions=Array.isArray(state.progress?.commissions)?state.progress.commissions:[];
    const oldExplored=Array.isArray(state.explored)?state.explored:[];
    if(oldExplored.length===FOG_COLS*FOG_ROWS)merged.explored=oldExplored.map(Boolean);
    else{
      merged.explored=Array(FOG_COLS*FOG_ROWS).fill(0);
      const oldSide=Math.round(Math.sqrt(oldExplored.length));
      if(oldSide*oldSide===oldExplored.length)for(let y=0;y<Math.min(oldSide,FOG_ROWS);y++)for(let x=0;x<Math.min(oldSide,FOG_COLS);x++)merged.explored[y*FOG_COLS+x]=oldExplored[y*oldSide+x]?1:0;
    }
    // v3では資源IDを座標ベースへ変更したため、旧IDの一時的な採取済み状態だけを破棄する。
    if(previousVersion<3)merged.removedResources={};
    // v4で「木槌を作る」を導入目標へ追加したため、以降の目標番号を一つ送る。
    if(previousVersion<4&&merged.progress.objective>=2)merged.progress.objective++;
    merged.hotbar=Array.from({length:8},(_,i)=>{const key=state.hotbar?.[i];return key&&(merged.inventory[key]||0)>0?key:null;});
    merged.selectedHotbar=Math.max(0,Math.min(7,Number(state.selectedHotbar)||0));
    merged.recovery=state.recovery&&state.recovery.items&&Object.values(state.recovery.items).some(n=>n>0)?state.recovery:null;
    merged.stats={...base.stats,...state.stats};merged.settings={...loadSettings(),...state.settings};
    merged.schemaVersion=VERSION;return merged;
  }
  function keys(slot){const base=PREFIX+slot;return{main:base,backup:base+"_backup",tmp:base+"_tmp"};}
  function save(slot,state){
    const k=keys(slot),snapshot=copy(state);snapshot.slot=slot;snapshot.updatedAt=new Date().toISOString();snapshot.schemaVersion=VERSION;
    const raw=envelope(snapshot);
    try{
      const prior=localStorage.getItem(k.main);if(prior)localStorage.setItem(k.backup,prior);
      localStorage.setItem(k.tmp,raw);unpack(localStorage.getItem(k.tmp));localStorage.setItem(k.main,raw);localStorage.removeItem(k.tmp);return{ok:true,state:snapshot};
    }catch(error){try{localStorage.removeItem(k.tmp);}catch(_){}return{ok:false,error};}
  }
  function load(slot){
    const k=keys(slot);let mainError=null;
    try{return{state:unpack(localStorage.getItem(k.main)),recovered:false};}catch(error){mainError=error;}
    try{
      const state=unpack(localStorage.getItem(k.backup));localStorage.setItem(k.main,envelope(state));return{state,recovered:true,error:mainError};
    }catch(backupError){return{state:null,error:mainError,backupError};}
  }
  function slotInfo(slot){
    const result=load(slot);if(!result.state)return{slot,empty:true,broken:!!localStorage.getItem(keys(slot).main)};
    const s=result.state;return{slot,empty:false,recovered:result.recovered,day:s.day,clock:s.clock,updatedAt:s.updatedAt,playSeconds:s.playSeconds,stage:s.progress?.lighthouseStage||0,seedText:s.seedText};
  }
  function remove(slot){const k=keys(slot);localStorage.removeItem(k.main);localStorage.removeItem(k.backup);localStorage.removeItem(k.tmp);}
  function exportSlot(slot){const raw=localStorage.getItem(keys(slot).main);if(!raw)throw new Error("書き出すデータがありません");unpack(raw);return raw;}
  function importSlot(slot,raw){const state=unpack(raw);state.slot=slot;return save(slot,state);}
  function download(slot){
    const raw=exportSlot(slot),blob=new Blob([raw],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`lumina-isle-slot-${slot}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  LI.Save={VERSION,PREFIX,hash,seedFrom,newState,defaultSettings,loadSettings,saveSettings,save,load,remove,slotInfo,exportSlot,importSlot,download,unpack,copy};
})();
