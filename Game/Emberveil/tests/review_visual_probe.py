"""独立描画レビューの回帰検証。判定と警告の一致・native原画・素材識別を確認。"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
from PIL import Image
import json

root = Path(__file__).resolve().parents[3]
assets = Path(__file__).resolve().parents[1] / 'assets'
meta = json.loads((assets / 'dungeon-atlas.json').read_text(encoding='utf-8'))
atlas = Image.open(assets / 'dungeon-atlas.png').convert('RGBA')
for name, (x, y, w, h) in meta['sprites'].items():
    source = Image.open(assets / 'dungeon' / name).convert('RGBA')
    packed = atlas.crop((x, y, x + w, y + h))
    assert source.size == packed.size and source.tobytes() == packed.tobytes(), name
    assert set(source.getchannel('A').getdata()) <= {0, 255}, name


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/Game/Emberveil/dev/render-preview.html')
        page.wait_for_function('window.ready===true', timeout=30000)
        result = page.evaluate('''async () => {
          const {Game}=await import('../world.js'),{Renderer}=await import('../render.js');
          const g=new Game();g.newGame({seed:'visual-review',slot:1});g.setPaused('review',true);
          const canvas=document.createElement('canvas');document.body.append(canvas);
          const r=new Renderer(canvas,g);r.assets=renderer.assets;r.terrain.assets=r.assets;r.ready=true;
          const checks=[],check=(name,ok,detail)=>{if(!ok)throw new Error(name+': '+JSON.stringify(detail));checks.push(name);};
          const sample=document.createElement('canvas');sample.width=196;sample.height=174;
          const q=sample.getContext('2d',{willReadFrequently:true});q.imageSmoothingEnabled=false;
          const hashPixels=()=>Array.from(q.getImageData(0,0,sample.width,sample.height).data).reduce((h,v)=>Math.imul(h^v,16777619)>>>0,2166136261);
          const clear=()=>q.clearRect(0,0,sample.width,sample.height);
          // 画面外の中心、円周・内周、角度の折り返し、広い安全域も全ピクセル比較する。
          let masks=0,pixels=0,mismatches=[];
          for(const [radius,width]of[[4,6],[2,.5],[1,2]])for(const angle of[0,.17,.8,Math.PI/2,2.1,Math.PI,4.2,5.9])
          for(const gapWidth of[0,50*Math.PI/180,.2,Math.PI+1])for(const [cx,cy]of[[98,87],[0,0],[-20,22],[220,10]]){
            canvas.width=sample.width;canvas.height=sample.height;r.camera={x:sample.width/2-cx,y:sample.height/2-cy};
            r.shakeX=r.shakeY=0;clear();const shape={type:'ring',x:0,y:0,r:radius,width,gapAngle:angle,gapWidth};
            r.drawHazard(q,{shape,phase:'warn',t:.5,warn:1},0);
            const data=q.getImageData(0,0,sample.width,sample.height).data;
            for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++){
              const wx=(x-cx)/24,wy=(y-cy)/24,d=Math.hypot(wx,wy),a=Math.atan2(wy,wx),relative=Math.atan2(Math.sin(a-angle),Math.cos(a-angle));
              // 浮動小数点でちょうど境界上の一致は評価せず、その内外の画素を照合する。
              if(Math.abs(Math.abs(d-radius)-width/2)<1e-10||Math.abs(Math.abs(relative)-gapWidth/2)<1e-10)continue;
              const expected=g._inShape(shape,wx,wy,0),actual=data[(y*sample.width+x)*4+3]>0;
              if(expected!==actual&&mismatches.length<12)mismatches.push({radius,width,angle,gapWidth,cx,cy,x,y,expected,actual});pixels++;
            }
            masks++;
          }
          check('ring mask matches engine incl gap and clipping',mismatches.length===0,mismatches);
          let coneMasks=0,conePixels=0,coneMismatches=[];
          for(const range of[2,5,14])for(const angle of[0,.17,.8,Math.PI/2,2.1,Math.PI,4.2,5.9])
          for(const spread of[Math.PI/6,70*Math.PI/180,150*Math.PI/180,240*Math.PI/180])for(const [cx,cy]of[[98,87],[0,0],[-20,22],[220,10]]){
            r.camera={x:sample.width/2-cx,y:sample.height/2-cy};clear();
            const shape={type:'cone',x:0,y:0,range,angle,spread};r.drawHazard(q,{shape,phase:'warn',t:.5,warn:1},0);
            const data=q.getImageData(0,0,sample.width,sample.height).data;
            for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++){
              const wx=(x-cx)/24,wy=(y-cy)/24,d=Math.hypot(wx,wy),a=Math.atan2(wy,wx),relative=Math.atan2(Math.sin(a-angle),Math.cos(a-angle));
              // 扇形のnative輪郭はBresenhamで最大1ドット張り出すので、輪郭の接触帯を除く。
              const edgeA=angle-spread/2,edgeB=angle+spread/2;
              const onEdge=[edgeA,edgeB].some(edge=>wx*Math.cos(edge)+wy*Math.sin(edge)>=0&&Math.abs(-wx*Math.sin(edge)+wy*Math.cos(edge))*24<=1.5);
              if(d<.35||Math.abs(d-range)*24<=1.5||onEdge||Math.abs(Math.abs(relative)-spread/2)<1e-10)continue;
              const expected=g._inShape(shape,wx,wy,0),actual=data[(y*sample.width+x)*4+3]>0;
              if(expected!==actual&&coneMismatches.length<12)coneMismatches.push({range,angle,spread,cx,cy,x,y,expected,actual});conePixels++;
            }
            coneMasks++;
          }
          check('cone mask matches engine incl wrap and clipping',coneMismatches.length===0,coneMismatches);
          canvas.width=720;canvas.height=450;r.resize();r.camera.initialized=false;g.enemies=[];r.render(1/60);
          const a=g.world.anchors.arenas.moss;g.player.x=a.cx+.5;g.player.y=a.cy+.5;
          g.hazards=[{shape:{type:'ring',x:g.player.x,y:g.player.y,r:4,width:6,gapAngle:.5,gapWidth:50*Math.PI/180},phase:'warn',t:.5,warn:1}];
          r.camera.initialized=false;r.render(1/60);const start=performance.now();for(let i=0;i<60;i++)r.render(1/60);
          const ringMs=performance.now()-start;check('warning ring 60 frames under 1.2s',ringMs<1200,ringMs);g.hazards=[];
          const hazardFrames={};
          for(const [name,shape]of[['crystalCone',{type:'cone',range:14,spread:50*Math.PI/180,angle:.3}],['emberCone',{type:'cone',range:5,spread:70*Math.PI/180,angle:.3}],['crystalBeam',{type:'line',length:14,width:.6,angle:.3}]]){
            g.hazards=[{shape:{...shape,x:g.player.x,y:g.player.y},phase:'warn',t:.5,warn:1}];r.render(1/60);
            const before=performance.now();for(let i=0;i<60;i++)r.render(1/60);hazardFrames[name]=performance.now()-before;
            check(name+' 60 frames under 1.2s',hazardFrames[name]<1200,hazardFrames[name]);
          }
          g.hazards=[];
          r.camera={x:0,y:0};canvas.width=sample.width;canvas.height=sample.height;r.shakeX=r.shakeY=0;
          const boss={id:'bcrystal',kind:'warden_crystal',x:0,y:0,hp:760,maxHp:760,boss:true,moving:false,hitTimer:0,faceX:1,glintT:.1};
          g.boss={_mirror:{}};r.reducedMotion=false;clear();r.drawEnemy(q,boss,0);const realGlint=hashPixels();
          clear();r.drawEnemy(q,{...boss,id:'d1'},0);const decoy=hashPixels();
          check('real mirror glint differs from decoy',realGlint!==decoy);
          clear();r.drawEnemy(q,{...boss,glintT:.5},0);check('normal glint has a quiet phase',hashPixels()!==realGlint);
          r.reducedMotion=true;clear();r.drawEnemy(q,boss,0);const still=hashPixels();
          clear();r.drawEnemy(q,{...boss,glintT:.5},0);check('reduced motion uses stable real glint',hashPixels()===still);g.boss=null;
          let badCoordinates=[],rectangles=0;const nativeRect=q.fillRect.bind(q);
          q.fillRect=(...v)=>{rectangles++;if(v.some(n=>!Number.isInteger(n)))badCoordinates.push(v);return nativeRect(...v);};
          const planterHashes=[];
          for(const crop of[null,'tuber','grain','pepper','glowcap']){
            const stages=[];for(const stage of crop?[0,1,2,3]:[0]){clear();r.drawPlanter(q,{x:98,y:100},{crop,stage,dark:false},[],0);stages.push(hashPixels());}
            if(crop)check(crop+' growth stages differ',new Set(stages).size===4,stages);planterHashes.push(stages.at(-1));
          }
          check('empty and four mature crops differ',new Set(planterHashes).size===5,planterHashes);
          clear();r.drawPlanter(q,{x:98,y:100},{crop:'tuber',stage:1,dark:false},[],0);const lit=hashPixels();
          clear();r.drawPlanter(q,{x:98,y:100},{crop:'tuber',stage:1,dark:true},[],0);check('dark planter warning visible',hashPixels()!==lit);
          const young={type:'sapling',kind:'mushroom',x:0,y:0,growth:.2},farView={player:{x:20,y:20}};
          clear();r.drawObject(q,young,farView,[],0);const small=hashPixels();
          const youngPixels=q.getImageData(0,0,sample.width,sample.height).data;let top=sample.height,bottom=0;
          for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++)if(youngPixels[(y*sample.width+x)*4+3]){top=Math.min(top,y);bottom=Math.max(bottom,y);}
          check('young sapling is small',bottom-top<20,{top,bottom});
          clear();r.drawObject(q,{...young,growth:.8},farView,[],0);check('sapling growth changes art',hashPixels()!==small);
          let itemPixels=0;
          for(const [key,def]of Object.entries(g.data.ITEMS)){
            const icon=r.itemIcons.image(key,def),ic=icon.getContext('2d'),rgba=ic.getImageData(0,0,16,16).data;
            check(key+' native item icon',icon.width===16&&icon.height===16&&!ic.imageSmoothingEnabled);
            for(let i=3;i<rgba.length;i+=4){if(rgba[i]!==0&&rgba[i]!==255)throw new Error(key+' anti-aliased icon');if(rgba[i])itemPixels++;}
          }
          check('item icons contain actual pixels',itemPixels>1000,itemPixels);
          const walls=['loam_wall','rock_wall','coal_vein','copper_vein','hard_rock','crystal_vein','burnt_rock','obsidian_rock','ember_vein','bedrock','seal_stone','gate_crystal','gate_ember','arena_barrier','wall_wood','wall_stone','wall_glass','wall_brick','wall_gold'];
          const wallHashes=[];for(const key of walls){clear();const ore=key==='copper_vein'?'copper':key==='crystal_vein'?'crystal':key==='ember_vein'?'ember':null;r.terrain.wall(q,0,64,64,40,40,true,ore,key);wallHashes.push(hashPixels());}
          check('19 wall materials distinguishable',new Set(wallHashes).size===19,wallHashes);
          const floorHashes=[];for(const key of['floor_wood','floor_stone','floor_crystal','floor_brick','floor_gold','bridge_wood','bridge_stone']){clear();r.terrain.draw(q,key.startsWith('bridge')?'bridge':key==='floor_wood'?'woodfloor':'stonefloor',0,64,64,40,40,0,{},'moss_floor',key);floorHashes.push(hashPixels());}
          check('five floors distinguishable',new Set(floorHashes.slice(0,5)).size===5,floorHashes);
          check('stone and wooden bridge differ',floorHashes[5]!==floorHashes[6]);check('all crop and terrain rectangles integer',badCoordinates.length===0,badCoordinates.slice(0,5));
          q.fillRect=nativeRect;r.resize();r.camera.initialized=false;r.render(1/60);g.settings.reduceMotion=false;g.settings.screenShake=true;
          g.emit('playerHurt',{x:g.player.x,y:g.player.y,dmg:4});let motion=false;
          for(let i=0;i<8;i++){r.render(1/60);motion ||= r.shakeX!==0||r.shakeY!==0;const sp=r.worldPoint(g.player.x,g.player.y),rect=canvas.getBoundingClientRect();const mapped=r.screenToWorld(rect.left+sp.x*rect.width/canvas.width,rect.top+sp.y*rect.height/canvas.height);check('shake pointer conversion '+i,Math.abs(mapped.x-g.player.x)<.03&&Math.abs(mapped.y-g.player.y)<.03,mapped);}
          check('enabled shake produces motion',motion);g.settings.screenShake=false;r.shakeT=.18;r.render(1/60);check('disabled shake stays still',r.shakeX===0&&r.shakeY===0);
          g.settings.screenShake=true;g.settings.reduceMotion=true;r.shakeT=.18;r.render(1/60);check('reduced motion disables shake',r.shakeX===0&&r.shakeY===0);
          check('engine effects not duplicated',r.eventEffects.length===0,r.eventEffects);
          return {checks,count:checks.length,ringMasks:masks,pixels,coneMasks,conePixels,ring60FramesMs:ringMs,hazard60FramesMs:hazardFrames,integerRectangles:rectangles,itemPixels};
        }''')
        assert not errors, errors
        print(json.dumps({key: value for key, value in result.items() if key != 'checks'}, ensure_ascii=False, indent=2))
        browser.close()
finally:
    server.shutdown()
print(f"PASS: independent visual regressions; {len(meta['sprites'])} source-identical native frames")
