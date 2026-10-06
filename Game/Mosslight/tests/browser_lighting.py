"""実GPU shaderの向き・夜・遮蔽と、実ゲームのPC/タッチ描画を確認する。"""
from pathlib import Path
import json,sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
OUT=Path(__file__).parent/'output';OUT.mkdir(exist_ok=True)
checks=[]
def check(name,ok,detail=None):
    checks.append({'name':name,'ok':bool(ok),'detail':detail})
    print(('PASS ' if ok else 'FAIL ')+name,flush=True)

SHADER_TEST=r'''async () => {
  const {createLighting}=await import('./lighting.js');
  const L=createLighting({maxLights:8,steps:8});
  if(!L)throw Error('WebGL2を利用できません');
  const cv=(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c;};
  const C=cv(96,32,'#808080'), H=cv(96,32,'#00cc80');
  const N=cv(96,32,'#808000');
  const sample=(n,u,occ=null,xy=[16,16],height=H)=>{
    const out=L.render(C,n,height,occ,{camX:0,camY:0,t:0,calm:true,steps:8,
      skyColor:[.03,.03,.03],sunStrength:0,sunColor:[1,1,1],lights:[],debug:'off',...u});
    const r=cv(96,32,'#000000');r.getContext('2d').drawImage(out,0,0);
    return [...r.getContext('2d').getImageData(...xy,1,1).data].slice(0,3).reduce((a,b)=>a+b)/3;
  };
  const left=cv(96,32,'#408000'),right=cv(96,32,'#c08000');
  const lamp=x=>({x,y:16,r:4,color:[255,255,255],power:1,flicker:0,id:1});
  const ll=sample(left,{lights:[lamp(-16)]}),lr=sample(right,{lights:[lamp(-16)]});
  const rl=sample(left,{lights:[lamp(48)]}),rr=sample(right,{lights:[lamp(48)]});
  const day=sample(N,{sunStrength:.6,skyColor:[.55,.55,.55]});
  const night=sample(N,{sunStrength:0,skyColor:[.06,.06,.06]});
  const shadowH=cv(96,32,'#00cc80');
  shadowH.getContext('2d').fillStyle='#80cc80';shadowH.getContext('2d').fillRect(1,0,12,12);
  const sunlit=sample(N,{sunStrength:.6},null,[18,18]);
  const shaded=sample(N,{sunStrength:.6},null,[18,18],shadowH);
  const occ={x0:0,y0:0,w:3,h:1,data:new Uint8Array([0,0,255,0,0,0])};
  const light=lamp(16);light.r=6;light.power=2;
  const open=sample(N,{lights:[light]},null,[80,16]);
  const blocked=sample(N,{lights:[light]},occ,[80,16]);
  const pointH=cv(96,32,'#00cc80');pointH.getContext('2d').fillStyle='#80cc80';
  pointH.getContext('2d').fillRect(32,0,25,32);
  const pointShadow=sample(N,{lights:[light]},null,[80,16],pointH);
  const specLight=lamp(16);specLight.power=.3;
  const matte=sample(N,{lights:[specLight]});
  const wet=sample(N,{lights:[specLight]},null,[16,16],cv(96,32,'#002980'));
  const up=sample(cv(96,32,'#80c000'),{sunStrength:.6});
  const down=sample(cv(96,32,'#804000'),{sunStrength:.6});
  const cg=C.getContext('2d');cg.fillStyle='#ff0000';cg.fillRect(0,0,96,16);
  cg.fillStyle='#0000ff';cg.fillRect(0,16,96,16);
  const oriented=L.render(C,N,H,null,{camX:0,camY:0,t:0,steps:8,debug:'off',calm:true,skyColor:[1,1,1],sunStrength:0,sunColor:[1,1,1],lights:[]});
  const copied=cv(96,32,'#000000');copied.getContext('2d').drawImage(oriented,0,0);
  const top=[...copied.getContext('2d').getImageData(2,2,1,1).data];
  const bottom=[...copied.getContext('2d').getImageData(2,25,1,1).data];
  const stats={...L.stats};
  const ext=oriented.getContext('webgl2').getExtension('WEBGL_lose_context');
  let lost=false,restored=false;
  if(ext) {
    ext.loseContext();await new Promise(r=>setTimeout(r,150));lost=L.isLost();
    ext.restoreContext();await new Promise(r=>setTimeout(r,250));
    restored=!L.isLost() && !!L.render(C,N,H,null,{camX:0,camY:0,t:0,steps:8,debug:'off',calm:true,skyColor:[.5,.5,.5],sunStrength:0,sunColor:[1,1,1],lights:[]});
  }
  L.dispose();
  return {ll,lr,rl,rr,day,night,sunlit,shaded,open,blocked,pointShadow,matte,wet,up,down,top,bottom,
    contextExtension:!!ext,lost,restored,stats};
}'''

SETUP=r'''async scene => {
  const d=window.__mosslight;
  const {createReviewFixture}=await import('./tests/gameplay.js');
  const f=createReviewFixture(scene==='night'?'night':'house');
  Object.assign(d.state,f.state);
  d.state.time.clock=scene==='night'?520:200;
  d.state.paused=true;
  d.renderer.snapCamera();d.renderer.setLightingMode('gl');
  await new Promise(r=>setTimeout(r,500));
  return d.renderer.getLightingStats();
}'''

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    for mobile in (False,True):
        context=browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':900},
                                   has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:8765/Game/Mosslight/?debug=1')
        page.get_by_role('button',name='はじめから',exact=True).click()
        page.wait_for_timeout(500)
        label='touch' if mobile else 'desktop'
        if not mobile:
            result=page.evaluate(SHADER_TEST)
            check('光源が左のとき左向き法線が明るい',result['ll']>result['lr']+5,result)
            check('光源を右へ動かすと右向き法線が明るい',result['rr']>result['rl']+5,result)
            check('光源のない夜は昼より暗い',result['night']<result['day']*.5,result)
            check('高さのある物が太陽方向の光を遮る',result['shaded']<result['sunlit']*.8,result)
            check('固体壁が局所光を遮る',result['blocked']<result['open']*.7,result)
            check('物の高さが局所光の影を作る',result['pointShadow']<result['open']*.8,result)
            check('水の粗さが木や土と異なる反射を作る',result['wet']>result['matte']+3,result)
            check('上向き法線は固定の左上太陽で明るい',result['up']>result['down']+5,result)
            check('bufferの上下が反転しない',result['top'][0]>240 and result['top'][2]<10
                  and result['bottom'][2]>240 and result['bottom'][0]<10,result)
            check('context lostから再描画できる',result['contextExtension'] and result['lost'] and result['restored'],result)
            check('shader検査にGLエラーなし',result['stats']['errorCount']==0,result['stats'])
        for scene in ('day','night'):
            stats=page.evaluate(SETUP,scene)
            check(f'{label} {scene} GL実描画',stats['active']=='gl',stats)
            check(f'{label} {scene} 太陽の昼夜切替',stats['sunStrength']>0 if scene=='day' else stats['sunStrength']==0,stats)
            check(f'{label} {scene} GLエラーなし',stats['errorCount']==0,stats)
            check(f'{label} {scene} 灯数上限',stats['lights']<=(4 if mobile else 8),stats)
            page.screenshot(path=str(OUT/f'lighting-{label}-{scene}.png'))
        stats=page.evaluate(r'''async () => {
          const values=[];let previous=performance.now();
          for(let i=0;i<120;i++) { await new Promise(requestAnimationFrame);
            const now=performance.now();values.push(now-previous);previous=now; }
          values.sort((a,b)=>a-b);
          return {...window.__mosslight.renderer.getLightingStats(),rafMedian:values[60]};
        }''')
        check(f'{label} 120frame描画が継続',stats['active']=='gl' and stats['errorCount']==0,stats)
        page.evaluate("window.__mosslight.renderer.setLightingMode('2d')")
        page.wait_for_timeout(200)
        fallback=page.evaluate('window.__mosslight.renderer.getLightingStats()')
        check(f'{label} 2Dへ切替可能',fallback['active']=='2d',fallback)
        check(f'{label} 描画例外なし',not errors,errors)
        context.close()
    browser.close()
(OUT/'lighting-report.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
failures=[c for c in checks if not c['ok']]
print(f'{len(checks)-len(failures)} 成功 / {len(failures)} 失敗')
sys.exit(bool(failures))
