"""局所光(点光源)の地面影に、看板・板・支柱の影が離れた四角で繰り返し出ないことを実GPU shaderで確認する。

これは固定条件(fixture)の回帰試験で、実プレイの時刻・日数・天候とは無関係。
灯8個(影アトラス枠3 + 枠なし5)・地面の高さ0と小さな起伏・看板(支柱+板)の輪郭を合成画像で用意し、
lighting.js の render() を実際のWebGL2で動かして画素を読み戻す。
使い方: 静的サーバを起動した上で  python tests/browser_point_shadow_regression.py [基底URL]
  既定の基底URLは http://127.0.0.1:8765/Game/Mosslight/
終了コード: 失敗・欠測・例外のどれかがあれば 1
"""
from pathlib import Path
import hashlib,json,sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8765/Game/Mosslight/'
OUT=Path(__file__).parent/'output';OUT.mkdir(exist_ok=True)
checks=[];missing=[]
def check(name,ok,detail=None):
    checks.append({'name':name,'ok':bool(ok),'detail':detail})
    print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def num(d,k):
    v=d.get(k) if isinstance(d,dict) else None
    if not isinstance(v,(int,float)) or v!=v:
        missing.append(k);return None
    return v

PAGE_TEST=r'''async () => {
  const {createLighting,MAX_PT,PT_HALF}=await import('./lighting.js');
  const L=createLighting({maxLights:8,steps:8});
  if(!L)throw Error('WebGL2を利用できません');
  const W=256,H=160,CELL=256;
  const cv=(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c;};
  const hv=(px,rough=204)=>`rgb(${Math.round(px/64*255)},${rough},128)`; // height画像: R=高さ/64
  // 固定の地形: 上半分は高さ0、y>=100 は高さ5px の小さな起伏(法線は平ら)
  const ground=(withSign,withPillar)=>{
    const c=cv(W,H,hv(0));const x=c.getContext('2d');
    x.fillStyle=hv(5);x.fillRect(0,100,W,H-100);
    if(withSign){
      x.fillStyle=hv(24);x.fillRect(100,60,8,20);   // 支柱(足元 y=80)
      x.fillStyle=hv(28);x.fillRect(90,52,32,8);    // 板
    }
    return c;};
  const color=cv(W,H,'#808080'),flatN=cv(W,H,'#808000');
  const FOOT_BOX={x0:84,y0:46,x1:128,y1:86}; // 看板そのもの(物の表面)は地面の判定から除く
  const LAMP_H=60,POLE={x:100,w:8,y:80,z:24},PLANK={x0:90,x1:122,y:80,z0:20,z1:28};
  const mk=(i,x,y)=>({x:0,y:0,r:6,color:[255,255,255],power:2,flicker:0,id:i+1,src:{x,y,h:LAMP_H}});
  // 灯0は旧配置(40,84)だと看板の足元線(y=80)とほぼ同じ高さで、影が厚み約1.5画素の細い帯になり、
  // 軸線の丸め標本が帯を外す(新旧とも dark6/9)。斜めから照らし、
  // 看板矩形の外に出る投影がアトラスの不減衰領域(半径96)にも入る位置を使う。
  const pos=[[60,116],[52,116],[64,92],[28,70],[70,88],[34,96],[58,100],[76,82]];
  const lamps=pos.map((p,i)=>mk(i,p[0],p[1]));
  // 影アトラス: 灯の足元から見た支柱・板の投影(連続した面)。R=遮る物の高さ/64
  const proj=(P,G,z)=>[P[0]+(G[0]-P[0])*LAMP_H/(LAMP_H-z),P[1]+(G[1]-P[1])*LAMP_H/(LAMP_H-z)];
  // 幾何から決まる「影があってよい範囲」: 支柱・板の投影四角形(アトラスと同じ式。shaderの標本化側を検証する)
  const polys=(li)=>{const P=pos[li],g=(gx,z)=>proj(P,[gx,POLE.y],z);
    return [[g(POLE.x,0),g(POLE.x+POLE.w,0),g(POLE.x+POLE.w,POLE.z),g(POLE.x,POLE.z)],
            [g(PLANK.x0,PLANK.z0),g(PLANK.x1,PLANK.z0),g(PLANK.x1,PLANK.z1),g(PLANK.x0,PLANK.z1)]];};
  // 画素中心から四角形までの符号付き距離(内側が負)。複数灯・複数四角形は最小値(和集合)
  const sdCache={};
  const sdField=(li)=>{
    if(sdCache[li])return sdCache[li];
    const f=new Float32Array(W*H).fill(1e9),ps=polys(li);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const qx=x+.5,qy=y+.5;let best=1e9;
      for(const q of ps){
        let inside=false,d=1e9;
        for(let k=0;k<q.length;k++){
          const a=q[k],b=q[(k+1)%q.length],ex=b[0]-a[0],ey=b[1]-a[1];
          if((a[1]>qy)!==(b[1]>qy)&&qx<a[0]+(qy-a[1])/ey*ex)inside=!inside;
          const t=Math.max(0,Math.min(1,((qx-a[0])*ex+(qy-a[1])*ey)/(ex*ex+ey*ey)));
          d=Math.min(d,Math.hypot(qx-a[0]-t*ex,qy-a[1]-t*ey));}
        best=Math.min(best,inside?-d:d);}
      f[y*W+x]=best;}
    return sdCache[li]=f;};
  const TOL=2,MARGIN=.5; // 範囲外の許容 2画素(ラスタ1+画素中心.5+補間.5)。内部標本は辺から.5画素以上内側
  const atlas=(idx,blank)=>{
    const c=cv(CELL*MAX_PT,CELL,'#000000'),x=c.getContext('2d');
    if(blank)return c; // 負の対照: 影アトラスが空(投影が無い)
    idx.forEach((li,j)=>{
      const P=pos[li],ox=j*CELL-(P[0]-PT_HALF),oy=-(P[1]-PT_HALF);
      const quad=(pts,col)=>{x.fillStyle=col;x.beginPath();pts.forEach((q,k)=>k?x.lineTo(q[0]+ox,q[1]+oy):x.moveTo(q[0]+ox,q[1]+oy));x.closePath();x.fill();};
      const g=(gx,z)=>proj(P,[gx,POLE.y],z);
      quad([g(POLE.x,0),g(POLE.x+POLE.w,0),g(POLE.x+POLE.w,POLE.z),g(POLE.x,POLE.z)],'rgb(96,0,0)');
      quad([g(PLANK.x0,PLANK.z0),g(PLANK.x1,PLANK.z0),g(PLANK.x1,PLANK.z1),g(PLANK.x0,PLANK.z1)],'rgb(112,0,0)');
    });
    return c;};
  let calls=0,maxSlots=0;
  const render=(ls,shadowIdx,hc,normal=flatN,blank=false)=>{
    const pt=shadowIdx&&shadowIdx.length?{canvas:atlas(shadowIdx,blank),cell:CELL,th:1.5,
      entries:shadowIdx.map(i=>({light:lamps[i],x:pos[i][0],y:pos[i][1],h:LAMP_H,strength:1}))}:undefined;
    const out=L.render(color,normal,hc,null,{camX:0,camY:0,t:0,calm:true,steps:8,debug:'off',skyColor:[.03,.03,.03],
      sunStrength:0,sunColor:[1,1,1],lights:ls,maxLights:8,ptShadow:pt});
    if(!out)throw Error('render が null');
    calls++;if(pt)maxSlots=Math.max(maxSlots,L.stats.ptShadows);
    const r=cv(W,H,'#000000'),rx=r.getContext('2d');rx.drawImage(out,0,0);
    return rx.getImageData(0,0,W,H).data;};
  const lum=(d,x,y)=>{const i=(y*W+x)*4;return (d[i]+d[i+1]+d[i+2])/3;};
  const inBox=(x,y)=>x>=FOOT_BOX.x0&&x<=FOOT_BOX.x1&&y>=FOOT_BOX.y0&&y<=FOOT_BOX.y1;
  // a と b が thr より違う画素(看板の箱の外)を連結成分に分ける
  const diff=(a,b,thr)=>{
    const m=new Uint8Array(W*H);let n=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(inBox(x,y))continue;const i=(y*W+x)*4;
      if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>thr){m[y*W+x]=1;n++;}}
    const seen=new Uint8Array(W*H),sizes=[];
    for(let s=0;s<W*H;s++){
      if(!m[s]||seen[s])continue;let sz=0;const st=[s];seen[s]=1;
      while(st.length){const p=st.pop();sz++;const px=p%W,py=(p/W)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const qx=px+dx,qy=py+dy;if(qx<0||qy<0||qx>=W||qy>=H)continue;const q=qy*W+qx;
          if(m[q]&&!seen[q]){seen[q]=1;st.push(q);}}}
      sizes.push(sz);}
    return {pixels:n,big:sizes.filter(s=>s>=20).length,stray:sizes.filter(s=>s<20).reduce((u,v)=>u+v,0)};};
  // a と b の差を、灯 lis の解析的な影の範囲と突き合わせる。
  //  outside: 範囲(+TOL)の外で変わった画素(離れた複製・偽の四角は全てここに入る)
  //  interior/hit: 範囲の内部標本数と、そのうち実際に暗くなった数
  //  largest/inFoot: 範囲内で変わった画素の最大連結成分と全体(影が1つの連結面か)
  const audit=(a,b,thr,lis)=>{
    const fs=lis.map(sdField),sd=(p)=>{let m=1e9;for(const f of fs)m=Math.min(m,f[p]);return m;};
    const ch=new Uint8Array(W*H);let changed=0,outside=0,interior=0,hit=0,inFoot=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(inBox(x,y))continue;const p=y*W+x,i=p*4,s=sd(p);
      const c=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>thr;
      if(c){changed++;if(s>TOL)outside++;else{ch[p]=1;inFoot++;}}
      // shaderの影アトラスは半径128の縁で薄め、96px以内は減衰しない。
      // 「内部は暗い」の保証は投影形状と、この不減衰領域の共通部分で検査する。
      const core=lis.some(li=>Math.hypot(x+.5-pos[li][0],y+.5-pos[li][1])<=PT_HALF*.75);
      if(s<=-MARGIN&&core){interior++;if(c)hit++;}}
    const seen=new Uint8Array(W*H);let largest=0,comps=0;
    for(let s0=0;s0<W*H;s0++){
      if(!ch[s0]||seen[s0])continue;let sz=0;const st=[s0];seen[s0]=1;comps++;
      while(st.length){const p=st.pop();sz++;const px=p%W,py=(p/W)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const qx=px+dx,qy=py+dy;if(qx<0||qy<0||qx>=W||qy>=H)continue;const q=qy*W+qx;
          if(ch[q]&&!seen[q]){seen[q]=1;st.push(q);}}}
      largest=Math.max(largest,sz);}
    return {changed,outside,interior,hit,frac:interior?hit/interior:0,inFoot,largest,comps};};
  const res={fixture:true,note:'固定条件の合成画像。実プレイの時刻・日数ではない',variants:{}};
  const hSign=ground(true),hFlat=ground(false);
  // 地面の起伏の有無に関わらず、地形はこの1枚に「高さ0(y<100)と起伏5px(y>=100)」を同居させる。さらに起伏なし(全面0)も試す
  const flatSign=(()=>{const c=ground(true),x=c.getContext('2d');x.fillStyle=hv(0);x.fillRect(0,100,W,H-100);return c;})();
  const flatCtl=(()=>{const c=ground(false),x=c.getContext('2d');x.fillStyle=hv(0);x.fillRect(0,100,W,H-100);return c;})();
  const terrains={mixed:[hSign,hFlat],flat:[flatSign,flatCtl]};
  for(const [name,[hs,hc]] of Object.entries(terrains)){
    const v={unshadowed:[],shadowed:[]};
    // 影枠のない灯: 看板があっても地面は看板なしと同じ(偽の四角を作らない)
    for(let i=3;i<8;i++){
      const d=diff(render([lamps[i]],null,hs),render([lamps[i]],null,hc),2);
      v.unshadowed.push({lamp:i,...d});}
    // 影枠のある灯: 変わった画素は全て解析的な投影範囲(+TOL)の中、範囲内部は暗く、影は連結した1面
    for(let j=0;j<3;j++){
      const a=render([lamps[j]],[j],hs),b=render([lamps[j]],null,hc);
      v.shadowed.push({lamp:j,...audit(a,b,3,[j])});}
    // 8灯同時(影枠3 + 枠なし5): 変わった画素は3灯の投影範囲の和集合の中だけ。
    // 加算で飽和するため灯ごとの内部の暗さ割合は求めず、範囲内に実在の影(連結20画素以上)が残ることを見る
    const sIdx=[0,1,2];
    v.combined={...audit(render(lamps,sIdx,hs),render(lamps,null,hc),2,sIdx),slots:maxSlots};
    if(name==='mixed'){
      // 負の対照: 検査が鈍感でないことの確認
      v.neg={};
      // (1) 影アトラスが空(投影が無い) -> 影の内部が暗くならない
      const j=2,bl=render([lamps[j]],[j],hs,flatN,true),b=render([lamps[j]],null,hc);
      v.neg.blank=audit(bl,b,3,[j]);
      const cb=render(lamps,sIdx,hs,flatN,true),c0=render(lamps,null,hc);
      v.neg.blankCombined=audit(cb,c0,2,sIdx);
      // (2) 別の灯の投影範囲と突き合わせる(影の位置がずれた/離れた複製の模擬) -> 範囲外が出る
      const a2=render([lamps[2]],[2],hs);
      v.neg.wrongFootprint=audit(a2,b,3,[0]);
    }
    res.variants[name]=v;
  }
  // 法線の向き: 灯のある側を向く法線が明るい(影枠なしの physical 灯、地面0と起伏5px)
  const left=cv(W,H,'#408000'),right=cv(W,H,'#c08000');
  res.normal={};
  for(const [name,y] of [['ground0',60],['relief5',120]]){
    const lamp=mk(0,30,y);
    const l=render([lamp],null,hFlat,left),r=render([lamp],null,hFlat,right);
    res.normal[name]={toward:lum(l,70,y),away:lum(r,70,y)};}
  // 物の表面の自己遮蔽は従来どおり(高さ24pxの台の上で、手前の高い柱が灯を遮る)
  // 幾何: 灯(110,100,高さ40)→標本(190,100,台の上=高さ24)の光線は x=163 で高さ約29。
  //   柱(高さ60, y90..110)は光線を遮る。標本(190,128)の光線は x=163 で y≈118.6 と柱の外を通り遮られない(対照)。
  //   低い柱(高さ25)は光線(≥約29)の下なので遮らない(対照: 物理的に変化しないはず)
  const platform=(pillarH)=>{const c=cv(W,H,hv(0)),x=c.getContext('2d');
    x.fillStyle=hv(24);x.fillRect(150,80,60,50);if(pillarH){x.fillStyle=hv(pillarH);x.fillRect(160,90,6,20);}return c;};
  const lamp=mk(0,110,100);lamp.src.h=40;
  const dark=mk(0,110,100);dark.src.h=40;dark.power=0; // 直接光なし = 環境光のみの基準
  const open=render([lamp],null,platform(0)),blocked=render([lamp],null,platform(60)),low=render([lamp],null,platform(25));
  const amb=render([dark],null,platform(0));
  const lin=(v)=>Math.pow(v/255,2.2); // 出力はガンマ符号化: 線形光へ戻して環境光を引く
  const direct=(d,x,y)=>Math.max(0,lin(lum(d,x,y))-lin(lum(amb,x,y)));
  // 地面位置 g=(p.x,p.y+24)、q=gs+d*t-(0,rayH) を用いるため、
  // y=128 の ray が柱の画面上の90..110を横切り、y=100 の ray はその上を通る。
  const dOpen=direct(open,190,128);
  res.surface={open:lum(open,190,128),blocked:lum(blocked,190,128),low:lum(low,190,128),ambient:lum(amb,190,128),
    openControl:lum(open,190,100),blockedControl:lum(blocked,190,100),
    directOpen:dOpen,directBlocked:direct(blocked,190,128),
    ratio:dOpen>0?direct(blocked,190,128)/dOpen:null,
    ratioNegative:dOpen>0?direct(open,190,128)/dOpen:null}; // 負の対照: 遮蔽なし同士の比は1で、検査の閾値を超える
  res.stats={...L.stats};res.calls=calls;
  L.dispose();
  return res;
}'''

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    context=browser.new_context(viewport={'width':800,'height':600},device_scale_factor=1)
    page=context.new_page();errors=[]
    loaded_modules=[]
    def module_response(response):
        if response.request.resource_type!='script' or not response.url.split('?')[0].endswith('/lighting.js'):return
        try:
            body=response.body().decode('utf-8').replace('\r\n','\n').replace('\r','\n').encode('utf-8')
            loaded_modules.append({'url':response.url,'status':response.status,'sha256':hashlib.sha256(body).hexdigest()})
        except Exception as e:errors.append('module-body: '+str(e))
    page.on('response',module_response)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    page.goto(BASE+'lighting.js')
    try:
        r=page.evaluate(PAGE_TEST)
    except Exception as e:
        r=None;errors.append(str(e))
    browser.close()

report={'kind':'fixture','note':'固定条件の回帰試験。実プレイの時刻・日数とは別','base_url':BASE,'loaded_modules':loaded_modules,'result':r,'errors':errors}
if r:
    print('FIXTURE(実プレイ時刻ではない): 灯8(影枠3+枠なし5)・地面高さ0/5px・看板',flush=True)
    for name,v in r['variants'].items():
        for u in v['unshadowed']:
            n=num(u,'pixels');check(f'[{name}] 影枠なしの灯{u["lamp"]}: 地面に看板由来の四角がない(差の画素0)',n is not None and n==0,u)
        for s in v['shadowed']:
            check(f'[{name}] 影枠の灯{s["lamp"]}: 変化は全て解析的な投影範囲内・内部の9割以上が暗い・影は連結1面',
                  s['interior']>=12 and s['outside']==0 and s['frac']>=.9 and s['inFoot']>0 and s['largest']>=.9*s['inFoot'],s)
        c=v['combined']
        check(f'[{name}] 8灯同時(影枠3+枠なし5): 変化は3灯の投影範囲の中だけ(離れた複製なし)で実在の影が残る',
              c['slots']==3 and c['outside']==0 and c['largest']>=20,c)
        if 'neg' in v:
            n=v['neg']
            check('負の対照: 影アトラスが空なら内部は暗くならない(検査が鈍感でない)',
                  n['blank']['interior']>=12 and n['blank']['frac']<.1,n['blank'])
            check('負の対照: 影アトラスが空なら8灯同時でも連結20画素以上の影が出ない',
                  n['blankCombined']['largest']<20,n['blankCombined'])
            check('負の対照: 別の灯の投影範囲と突き合わせると範囲外の変化が検出される',
                  n['wrongFootprint']['outside']>=10,n['wrongFootprint'])
    for name,n in r['normal'].items():
        check(f'法線の向きの応答が残る({name})',n['toward']>n['away']+5,n)
    s=r['surface']
    # 環境光を引いた直接光の線形比で判定(閾値は元の 0.5 のまま)。遮蔽が無ければ比は1
    check('物の表面の自己遮蔽(height ray): 光線上の高い柱で直接光が半分未満',
          s['ratio'] is not None and s['directOpen']>0 and s['ratio']<.5,s)
    check('負の対照: 遮蔽なし同士の直接光の比は閾値(0.5)を超える(検査が鈍感でない)',
          s['ratioNegative'] is not None and s['ratioNegative']>.9,s)
    check('対照: 柱の影の経路外の標本は柱があっても変わらない',abs(s['openControl']-s['blockedControl'])<=2,s)
    check('対照: 光線より低い柱(高さ25)は標本を暗くしない',abs(s['low']-s['open'])<=2,s)
    st=r['stats']
    check('GLエラー0',st['errorCount']==0 and st['glErrors']==0 and not st['contextLost'],st)
check('ページ例外0',not errors,errors)
check('結果が得られた',r is not None)
failed=[c for c in checks if not c['ok']]
report.update({'failed':len(failed),'missing':len(set(missing)),'errors':len(errors),'checks':checks})
(OUT/'point-shadow-regression-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(checks)-len(failed)} 成功 / failed={len(failed)} missing={len(set(missing))} errors={len(errors)}')
sys.exit(1 if failed or missing or errors else 0)
