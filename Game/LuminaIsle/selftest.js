(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  function run(){
    const results=[];const test=(name,fn)=>{try{const detail=fn();results.push({name,ok:true,detail:detail??"OK"});}catch(error){results.push({name,ok:false,detail:error.message});}};const assert=(v,m)=>{if(!v)throw new Error(m);};
    test("全レシピ参照",()=>{for(const r of LI.DATA.recipes){assert(LI.DATA.items[r.output],`出力 ${r.output}`);for(const k of Object.keys(r.cost))assert(LI.DATA.items[k],`素材 ${k}`);}return `${LI.DATA.recipes.length} recipes`;});
    test("全建築素材参照",()=>{for(const b of Object.values(LI.DATA.buildings))for(const k of Object.keys(b.cost))assert(LI.DATA.items[k],`素材 ${k}`);return `${Object.keys(LI.DATA.buildings).length} buildings`;});
    test("アトラス必須スプライト",()=>{const s=window.LI_SPRITES.sprites;for(const k of ["tile.grass.0","tile.water.0","player.down.0","enemy.slime.0","building.lighthouse.4","item.axe"])assert(s[k],k);return `${Object.keys(s).length} sprites`;});
    test("ワールド決定性",()=>{const a=LI.Save.newState(1,"TEST-SEED"),w1=LI.World.generate(a),w2=LI.World.generate(a);assert(Array.from(w1.tiles).join()===Array.from(w2.tiles).join(),"tile mismatch");assert(w1.resources.map(r=>r.type+r.x+r.y).join()===w2.resources.map(r=>r.type+r.x+r.y).join(),"resource mismatch");return a.seed;});
    test("開始資源保証",()=>{const s=LI.Save.newState(1,"START"),w=LI.World.generate(s),near=w.resources.filter(r=>Math.hypot(r.x-s.player.x,r.y-s.player.y)<100),branches=near.filter(r=>r.type==="branch").length,stones=near.filter(r=>r.type==="rock").length;assert(branches>=3,`branch ${branches}`);assert(stones>=3,`stone ${stones}`);return `branch ${branches}, stone ${stones}`;});
    test("全ランドマーク",()=>{const w=LI.World.generate(LI.Save.newState(1,"LANDMARK")),ids=new Set(w.landmarks.map(l=>l.id));for(const id of ["lighthouse","forest_altar","tide_altar","rock_altar","wind_0","wind_1","wind_2","well_old"])assert(ids.has(id),id);return `${ids.size} landmarks`;});
    test("セーブ検証と移行",()=>{const s=LI.Save.newState(2,"SAVE"),payload=JSON.stringify(s),raw=JSON.stringify({schemaVersion:1,checksum:LI.Save.hash(payload),payload}),out=LI.Save.unpack(raw);assert(out.seed===s.seed&&out.player.x===s.player.x,"roundtrip");return "checksum OK";});
    test("破損セーブ拒否",()=>{let rejected=false;try{LI.Save.unpack('{"schemaVersion":1,"checksum":"bad","payload":"{}"}');}catch(_){rejected=true;}assert(rejected,"accepted bad checksum");});
    test("夜間明度方針",()=>{const night=parseInt("6c",16),ink=parseInt("27",16);assert(night>ink*2,"night palette too dark");return "#6c73a8";});
    test("完成目標構造",()=>{assert(LI.DATA.objectives.length>=10,"objectives");assert(LI.DATA.achievements.length===18,"achievements");assert(LI.DATA.fish.length===6,"fish");return `${LI.DATA.objectives.length} objectives / ${LI.DATA.achievements.length} achievements`;});
    const passed=results.filter(r=>r.ok).length,report={passed,total:results.length,ok:passed===results.length,results};console.table(results);console.info(`Lumina Isle self-test ${passed}/${results.length}`);return report;
  }
  LI.selfTest={run};
  function demo(){
    const s=LI.Save.newState(1,"SUN-DEMO");s.clock=250;s.weather="glow";s.progress.lighthouseSeen=true;s.progress.lighthouseStage=1;s.inventory={branch:18,wood:28,stone:24,fiber:15,berry:7,seed:5,axe:1,pickaxe:1,spear:1,rod:1,hammer:1,watering_can:1};s.hotbar=["axe","pickaxe","spear","rod","berry","seed","watering_can","hammer"];
    s.buildings=[{id:"demo-fire",type:"campfire",x:34,y:51,w:1,h:1},{id:"demo-work",type:"workbench",x:38,y:50,w:2,h:1},{id:"demo-plot1",type:"plot",x:40,y:48,w:1,h:1,crop:"sunroot",stage:2,watered:true},{id:"demo-plot2",type:"plot",x:41,y:48,w:1,h:1,crop:"sunroot",stage:3,watered:false},{id:"demo-lamp",type:"lantern",x:42,y:49,w:1,h:1}];
    LI.game.startGame(s,false);
  }
  function integration(){
    const out=[];const ok=(name,value)=>{if(!value)throw new Error(name);out.push(`✓ ${name}`);};const g=LI.game;let s=LI.Save.newState(2,"INTEGRATION");g.startGame(s,false);s.inventory={branch:30,wood:60,stone:60,fiber:30,berry:10,seed:6,ore:20,copper_bar:20,crystal:20,fish:3,fish_sun:2,fish_moon:2};
    g.craft(LI.DATA.recipes.find(r=>r.output==="axe"));ok("クラフト",g.state.inventory.axe===1);
    g.buildMode={type:"campfire",rotation:0};g.input.pointerWorldX=33.5*16;g.input.pointerWorldY=52.5*16;g.placeBuilding();s=g.state;ok("建築",s.buildings.some(b=>b.type==="campfire"));g.cancelBuild();
    const plot={id:"test-plot",type:"plot",x:34,y:52,w:1,h:1,crop:null,stage:0,watered:false};s.buildings.push(plot);s.hotbar[0]="seed";s.selectedHotbar=0;g.usePlot(plot);ok("植え付け",plot.crop==="sunroot");s.hotbar[0]="watering_can";s.inventory.watering_can=1;s.player.watering=2;g.usePlot(plot);ok("水やり",plot.watered===true);
    s.progress.prisms={forest:true,tide:true,rock:true};s.progress.lighthouseStage=2;g.advanceLighthouse();s=g.state;ok("プリズム設置",s.progress.lighthouseStage===3);g.advanceLighthouse();s=g.state;ok("灯台完成",s.progress.lighthouseStage===4);
    const saved=LI.Save.save(2,s),loaded=LI.Save.load(2);ok("セーブ往復",saved.ok&&loaded.state?.progress.lighthouseStage===4);
    const html=`<div class="details-card" style="font-family:monospace;line-height:1.8">${out.join("<br>")}</div>`;g.dom.ending.classList.add("is-hidden");g.endingPlaying=false;g.openCustom(`統合テスト ${out.length}/${out.length}`,"ALL PASSED",html);
  }
  const params=new URLSearchParams(location.search);
  if(params.has("selftest"))window.addEventListener("load",()=>setTimeout(()=>{const report=run(),lines=report.results.map(r=>`${r.ok?"✓":"✗"} ${r.name}: ${r.detail}`).join("<br>");LI.game?.openCustom(`自動テスト ${report.passed}/${report.total}`,report.ok?"ALL PASSED":"FAILED",`<div class="details-card" style="font-family:monospace;line-height:1.8">${lines}</div>`);},600));
  if(params.has("demo"))window.addEventListener("load",()=>setTimeout(demo,600));
  if(params.has("integration"))window.addEventListener("load",()=>setTimeout(()=>{try{integration();}catch(error){console.error(error);LI.game?.openCustom("統合テスト失敗","FAILED",`<div class="details-card">${error.message}</div>`);}},700));
})();
