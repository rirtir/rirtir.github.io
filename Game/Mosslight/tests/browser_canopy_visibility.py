"""Canopy occlusion regression with explicit, isolated browser fixtures.

Run after the renderer change and runtime cache metadata are ready:
  python Game/Mosslight/tests/browser_canopy_visibility.py
Requires Chrome, Python Playwright, and the repository HTTP server on port 8765.

Fixture setup clears local scene nodes, installs real sprite-backed trees, sets
night/position/depletion/map, and removes combat/building interference. These are
not campaign progress or play hours. Movement uses real keyboard input. PNGs are
review evidence: diagnostic success alone does not approve visual readability.
No persistent profile, image generation, or production asset editing is used.
"""
import argparse
import json
from pathlib import Path
import sys
import traceback

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8765/Game/Mosslight/?debug=1')
parser.add_argument('--only-2d', action='store_true',
                    help='Bounded old-runtime control: two night canopy cases at both widths, no walking.')
parser.add_argument('--output', type=Path, default=None,
                    help='Optional separate evidence directory for an old-runtime control.')
args = parser.parse_args()
OUT = args.output or Path(__file__).resolve().parent / 'output/canopy-visibility'
checks = []
records = []


def check(name, ok, detail=None):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name, flush=True)


SETUP = r'''async ({kind, lighting}) => {
  const g = __mosslight, s = g.state, a = g.assets;
  const {TERRAIN, TILE} = await import('./data.js');
  const px = 41.5*TILE, py = 73.5*TILE;
  s.player.map = 'surface'; s.player.x = px; s.player.y = py;
  s.player.dir = 'down'; s.player.fx = 0; s.player.fy = 1;
  s.player.action = null; s.player.roll = null; s.player.moving = false;
  s.player.walkT = 0; s.player.buildMode = null; s.player.sel = -1;
  s.player.buffs = []; s.player.equip.trinket = null;
  s.focus = null; s.preview = null; s.enemies = []; s.npcs = [];
  s.boss = null; s.groundItems = []; s.deathBag = null;
  s.structures = []; s.houses = []; s.crops = []; s.farmland = [];
  s.nodes.clear(); s.depleted.clear(); s.hitNodes.clear();
  for (const key of ['structIndex', 'floorIndex', 'doorIndex'])
    for (const index of Object.values(s[key] || {})) index.clear?.();
  for (const m of Object.values(s.world.maps)) {
    m.nodes = []; m.nodeAt.fill(-1);
    for (let y=67;y<=79;y++) for (let x=35;x<=47;x++) {
      if (x>=m.w || y>=m.h) continue;
      m.terrain[y*m.w+x] = TERRAIN.GRASS; m.wallKind[y*m.w+x] = 0;
    }
  }
  g.setTime(520); s.rev++; s.structRev++;
  g.renderer.setLightingMode(lighting);
  // Independent fixture calibration reads actual alpha. It does not use the
  // renderer's occlusion result to manufacture passing placements.
  const mask = fr => {
    const cv=document.createElement('canvas'); cv.width=fr.w; cv.height=fr.h;
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(fr.img,fr.x,fr.y,fr.w,fr.h,0,0,fr.w,fr.h);
    return {...fr, alpha:ctx.getImageData(0,0,fr.w,fr.h).data};
  };
  const heroes=['idle0','idle1'].map(k=>mask(a.get('actors','hero_down_'+k)));
  const variants=(base,smallMirror=false)=>[...a.sheets.props.frames.keys()]
    .filter(k=>k===base || new RegExp('^'+base+'_v\\d+$').test(k))
    .map(k=>{
      if(!smallMirror)return mask(a.get('props',k));
      // Match the public smallProp contract: an explicit small frame wins;
      // otherwise the half transform carries its own rounded/flipped pivot.
      const small=k+'_small';
      return mask(a.has('props',small)?a.get('props',small,{flip:true}):a.get('props',k,{half:true,flip:true}));
    });
  const intersection=(hero,tree,dx,dy)=>{
    const hx=-hero.px,hy=-hero.py,tx=dx-tree.px,ty=dy-tree.py;
    const x0=Math.max(hx,tx),x1=Math.min(hx+hero.w,tx+tree.w);
    const y0=Math.max(hy,ty),y1=Math.min(hy+hero.h,ty+tree.h);
    let hits=0,rect=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      if(hero.alpha[((y-hy)*hero.w+x-hx)*4+3]<128)continue;
      rect++;
      if(tree.alpha[((y-ty)*tree.w+x-tx)*4+3]>=128)hits++;
    }
    return {hits,rect};
  };
  let next=0;
  const add=(type,sprite,dx,dy,mapId='surface',dead=false,smallMirror=false)=>{
    const m=s.world.maps[mapId],wx=Math.round(px+dx),wy=Math.round(py+dy);
    const tx=Math.floor(wx/TILE),ty=Math.floor(wy/TILE),cell=ty*m.w+tx;
    if(m.nodeAt[cell]>=0)throw Error('Fixture nodes share one nodeAt cell');
    const n={id:900000+next,key:'canopy-test:'+next++,map:mapId,type,sprite,
      tx,ty,px:wx,py:wy,flip:smallMirror,solidR:0,
      meta:{noMirror:!smallMirror,half:smallMirror}};
    m.nodeAt[cell]=m.nodes.length;m.nodes.push(n);
    if(dead)s.nodes.set(n.key,{respawnAt:Infinity});
    return {type,sprite,dx,dy,map:mapId,dead,smallMirror};
  };
  const installed=[]; let oracle=null;
  if(kind==='opaque-single') {
    const pine=variants('pine');let best=null;
    for(let dy=8;dy<=80;dy+=4)for(let dx=-16;dx<=16;dx+=8){
      const minimum=Math.min(...heroes.flatMap(h=>pine.map(t=>intersection(h,t,dx,dy).hits)));
      if(!best || minimum>best.hits)best={dx,dy,hits:minimum};
    }
    if(!best || best.hits<32)throw Error('Cannot position real opaque canopy over hero alpha');
    oracle=best;installed.push(add('border_pine','pine',best.dx,best.dy));
  } else if(kind==='mirrored-half-front') {
    g.renderer.setVisualToggle('mirrorNatural',true);
    const pine=variants('pine',true);let best=null;
    // dy<=2 keeps one small live tree opaque while still sorting after hero.
    for(let dy=1;dy<=2;dy++)for(let dx=-16;dx<=16;dx+=4){
      const minimum=Math.min(...heroes.flatMap(h=>pine.map(t=>intersection(h,t,dx,dy).hits)));
      if(!best || minimum>best.hits)best={dx,dy,hits:minimum};
    }
    if(!best || best.hits<32)throw Error('Cannot position mirrored/half pine over actual hero alpha');
    oracle={...best,frames:pine.map(t=>({w:t.w,h:t.h,pivot:[t.px,t.py]}))};
    installed.push(add('tree','pine',best.dx,best.dy,'surface',false,true));
  } else if(kind==='faded-single') {
    installed.push(add('tree','oak',0,40));
  } else if(kind==='multiple-front') {
    for(const dx of [-24,0,24])installed.push(add('tree','oak',dx,40));
  } else if(kind==='behind') {
    installed.push(add('tree','oak',0,-4));
  } else if(kind==='other-map') {
    installed.push(add('tree','oak',0,40,'underground'));
  } else if(kind==='depleted') {
    installed.push(add('tree','oak',0,40,'surface',true));
  } else if(kind==='transparent-edge' || kind==='mirrored-half-transparent') {
    const transformed=kind==='mirrored-half-transparent';
    if(transformed)g.renderer.setVisualToggle('mirrorNatural',true);
    const trees=variants(transformed?'pine':'oak',transformed);let found=null;
    outer:for(let dy=6;dy<=100;dy+=2)for(let dx=-104;dx<=104;dx++){
      const samples=heroes.flatMap(h=>trees.map(t=>intersection(h,t,dx,dy)));
      if(samples.length && samples.every(v=>v.hits===0 && v.rect>=8)){
        // Also require a one-pixel safety margin for rounding / tree sway.
        const near=[[-1,0],[1,0],[0,-1],[0,1]].every(([xx,yy])=>
          heroes.every(h=>trees.every(t=>intersection(h,t,dx+xx,dy+yy).hits===0)));
        if(near){found={dx,dy,minRect:Math.min(...samples.map(v=>v.rect)),alphaHits:0};break outer;}
      }
    }
    if(!found)throw Error('Cannot find a genuine overlapping transparent sprite edge');
    oracle={...found,frames:trees.map(t=>({w:t.w,h:t.h,pivot:[t.px,t.py]}))};
    installed.push(add('tree',transformed?'pine':'oak',found.dx,found.dy,'surface',false,transformed));
  } else if(kind!=='clear') throw Error('Unknown fixture '+kind);
  g.renderer.snapCamera();
  return {kind,lighting,installed,oracle,fixture:true};
}'''


# Independent final-output oracle: no heroOcclusion fields participate in the
# mask or pixel selection. Walk frames follow actual direction, distance and
# the authored frame interval. Idle uses the intersection of both idle masks,
# because renderer animation time is private; it never picks the better result.
# Four-neighbour exterior pixels match the specified one-world-pixel outline.
# World coordinates pass through the public transform and the canvas CSS/device
# ratio, rather than assuming desktop/mobile scale or devicePixelRatio.
PIXEL_SAMPLE = r'''() => {
  const g=__mosslight,p=g.state.player,cv=document.querySelector('#game');
  const names=[];
  if(p.moving){
    const step=g.assets.get('actors',`hero_${p.dir}_walk0`).meta?.walk_distance_per_frame;
    const n=Math.floor(p.walkT/(Number.isFinite(step)&&step>0?step:15))%4;
    names.push(`hero_${p.dir}_walk${n}`);
  } else names.push(`hero_${p.dir}_idle0`,`hero_${p.dir}_idle1`);
  const masks=names.map(name=>{
    const f=g.assets.get('actors',name),tmp=document.createElement('canvas');
    tmp.width=f.w;tmp.height=f.h;
    const c=tmp.getContext('2d',{willReadFrequently:true});
    c.drawImage(f.img,f.x,f.y,f.w,f.h,0,0,f.w,f.h);
    const d=c.getImageData(0,0,f.w,f.h).data;
    const solid=(x,y)=>x>=0&&x<f.w&&y>=0&&y<f.h&&d[(y*f.w+x)*4+3]>=128;
    const ring=new Set(),core=new Set();
    for(let y=-1;y<=f.h;y++)for(let x=-1;x<=f.w;x++){
      const key=`${x-f.px},${y-f.py}`;
      if(!solid(x,y)&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>solid(x+dx,y+dy)))ring.add(key);
      // Erode by two authored pixels, keeping outline and edge blending out
      // of the interior darkness control.
      if(solid(x,y)&&[[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,1],[1,-1],[-1,-1]]
        .every(([dx,dy])=>solid(x+dx,y+dy)))core.add(key);
    }
    return {ring,core};
  });
  const common=key=>[...masks[0][key]].filter(v=>masks.every(m=>m[key].has(v)));
  const rect=cv.getBoundingClientRect(),ctx=cv.getContext('2d');
  const rgb=key=>{
    const [x,y]=key.split(',').map(Number);
    const q=g.renderer.worldToScreen(Math.round(p.x)+x+.5,Math.round(p.y)+y+.5);
    const sx=Math.floor((q.x-rect.left)*cv.width/rect.width);
    const sy=Math.floor((q.y-rect.top)*cv.height/rect.height);
    if(sx<0||sy<0||sx>=cv.width||sy>=cv.height)return null;
    return [...ctx.getImageData(sx,sy,1,1).data].slice(0,3);
  };
  const rings=common('ring').map(rgb).filter(Boolean),cores=common('core').map(rgb).filter(Boolean);
  // At alpha .68, #ffe9a8 over black is approximately (173,158,114).
  // Broad thresholds allow lighting/scaling rounding but reject the dark
  // pre-fix 2D outline. Requiring a quarter of the independently selected
  // perimeter avoids a pass caused by one firefly or incidental bright pixel.
  const gold=([r,g,b])=>r>=80&&g>=65&&r>=g*.95&&b<r*.90;
  const luma=([r,g,b])=>.2126*r+.7152*g+.0722*b;
  const ls=cores.map(luma).sort((a,b)=>a-b);
  return {frames:names,ringSamples:rings.length,goldPixels:rings.filter(gold).length,
    goldRatio:rings.length?rings.filter(gold).length/rings.length:0,
    coreSamples:cores.length,coreMedian:ls.length?ls[Math.floor(ls.length/2)]:null,
    coreBrightRatio:cores.length?ls.filter(v=>v>=60).length/cores.length:1,
    canvas:{w:cv.width,h:cv.height,cssW:rect.width,cssH:rect.height}};
}'''


def sample(page):
    # Take state and output pixels in one synchronous evaluate, so animation
    # cannot advance between choosing a walk frame and inspecting its pixels.
    return page.evaluate('''() => ({position:{x:__mosslight.state.player.x,y:__mosslight.state.player.y},
      direction:__mosslight.state.player.dir,walkT:__mosslight.state.player.walkT,
      stats:__mosslight.renderer.getVisualStats(),missing:[...__mosslight.assets.missing],
      failed:__mosslight.assets.failed,pixels:('''+PIXEL_SAMPLE+''')()})''')


def verify_visible_ring(label, data):
    pix = data['pixels']
    check(label+' final canvas gold perimeter is visible',
          pix['ringSamples'] >= 20 and pix['goldRatio'] >= .25, pix)
    if data['stats']['lighting']['active'] == '2d':
        # A repair must preserve the unlit night interior. A fully bright hero
        # pasted after the dark veil is not an acceptable outline-only repair.
        check(label+' unlit hero interior stays dark',
              pix['coreSamples'] >= 20 and pix['coreMedian'] < 35 and
              pix['coreBrightRatio'] <= .10, pix)


def verify_sample(label, data):
    oc = data['stats'].get('heroOcclusion')
    check(label+' diagnostic contract',isinstance(oc,dict) and
          all(k in oc for k in ['canopies','boss','drawn']),oc)
    check(label+' no missing/GL/context failures',not data['missing'] and not data['failed'] and
          data['stats']['lighting'].get('glErrors',0)==0 and
          not data['stats']['lighting'].get('contextLost',False),data)
    if oc and 'readFail' in oc:check(label+' alpha read succeeds',oc['readFail']==0,oc)
    return oc or {}


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        for width,height in [(1264,828),(390,844)]:
            context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
            page=context.new_page();page.set_default_timeout(10000)
            errors=[];console=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda e:console.append(e.text)if e.type=='error'else None)
            try:
                page.goto(args.url)
                page.get_by_role('button',name='はじめから',exact=True).click()
                page.wait_for_function("window.__mosslight?.mode==='play'")
                for lighting in (['2d'] if args.only_2d else ['gl','2d']):
                    kinds = (['opaque-single','multiple-front'] if args.only_2d else
                             ['clear','opaque-single','faded-single','multiple-front',
                              'behind','other-map','depleted','transparent-edge',
                              'mirrored-half-front','mirrored-half-transparent'])
                    for kind in kinds:
                        label=f'{width}-{lighting}-{kind}'
                        setup=page.evaluate(SETUP,{'kind':kind,'lighting':lighting})
                        # Let existing canopy fade settle; a single faded tree is
                        # intentionally a negative outline control.
                        page.wait_for_timeout(700)
                        data=sample(page);oc=verify_sample(label,data)
                        check(label+' requested lighting active',data['stats']['lighting']['active']==lighting)
                        if kind in ['opaque-single','multiple-front','mirrored-half-front']:
                            check(label+' overlapping canopy keeps hero indicator',
                                  oc.get('canopies',0)>0 and oc.get('drawn') and not oc.get('boss'),oc)
                            verify_visible_ring(label, data)
                        elif kind=='faded-single':
                            check(label+' one translucent crown needs no extra indicator',
                                  oc.get('canopies',0)>0 and not oc.get('drawn') and not oc.get('boss'),oc)
                        else:
                            check(label+' negative control has no canopy indicator',
                                  oc.get('canopies')==0 and not oc.get('drawn') and not oc.get('boss'),oc)
                        page.screenshot(path=str(OUT/(label+'.png')))
                        records.append({'label':label,'setup':setup,'sample':data})
                    for key in ([] if args.only_2d else ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp']):
                        label=f'{width}-{lighting}-walk-{key}'
                        setup=page.evaluate(SETUP,{'kind':'multiple-front','lighting':lighting})
                        page.wait_for_timeout(700)
                        start=sample(page);frames=[]
                        page.keyboard.down(key)
                        try:
                            for i in range(3):
                                page.wait_for_timeout(85)
                                data=sample(page);verify_sample(f'{label}-{i}',data)
                                frames.append(data)
                                page.screenshot(path=str(OUT/f'{label}-{i}.png'))
                        finally:page.keyboard.up(key)
                        check(label+' real directional movement',frames[-1]['position']!=start['position'] and
                              any(f['walkT']!=start['walkT']for f in frames),frames)
                        check(label+' direction follows real key',any(f['direction']==key[5:].lower()for f in frames),frames)
                        check(label+' indicator survives entering/leaving overlapping crowns',
                              any(f['stats'].get('heroOcclusion',{}).get('drawn')for f in frames),frames)
                        check(label+' moving frame has visible final canvas perimeter',
                              any(f['pixels']['ringSamples'] >= 20 and
                                  f['pixels']['goldRatio'] >= .25 for f in frames),
                              [f['pixels'] for f in frames])
                        if lighting == '2d':
                            check(label+' moving unlit interior stays dark',
                                  all(f['pixels']['coreSamples'] >= 20 and
                                      f['pixels']['coreMedian'] < 35 and
                                      f['pixels']['coreBrightRatio'] <= .10 for f in frames),
                                  [f['pixels'] for f in frames])
                        records.append({'label':label,'setup':setup,'start':start,'frames':frames})
                check(f'{width} no page/console errors',not errors and not console,{'pageerrors':errors,'console':console})
            except Exception as error:
                check(f'{width} audit interrupted',False,{'error':str(error),'trace':traceback.format_exc()})
                page.screenshot(path=str(OUT/f'{width}-interrupted.png'))
            finally:context.close()
        browser.close()
    result={'passed':sum(c['ok']for c in checks),'failed':sum(not c['ok']for c in checks),
            'checks':checks,'records':records,'limits':'Explicit isolated fixtures, not campaign play. PNGs require independent visual review.'}
    (OUT/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':result['passed'],'failed':result['failed'],'output':str(OUT)},ensure_ascii=False))
    return bool(result['failed'])


if __name__=='__main__':
    raise SystemExit(main())
