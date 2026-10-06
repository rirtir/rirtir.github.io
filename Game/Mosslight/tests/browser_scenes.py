"""場面と画面サイズを変えて描画例外・アセット解決・操作到達性を検証する。

画質を採点するテストではない。スクリーンショットは別途、目視レビューに使う。
"""
from pathlib import Path
import argparse
import json
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8765/Game/Mosslight/?debug=1')
args = parser.parse_args()
output = Path(__file__).resolve().parent / 'output'
output.mkdir(parents=True, exist_ok=True)
checks = []
scenes = ['day', 'night', 'indoors', 'lake', 'mine', 'vine', 'ash']


def check(name, ok, detail=None):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ': ' + str(detail)))


SETUP = '''async scene => {
    const {createReviewFixture}=await import(new URL('tests/gameplay.js',location.href).href);
    const type=scene==='indoors'?'inside':(['night','vine','ash'].includes(scene)?scene:'house');
    const f=createReviewFixture(type);
    const debug=window.__mosslight,sim=debug.sim;
    Object.assign(debug.state,f.state);
    if(scene==='lake')sim.teleport(debug.state,'surface',62,72);
    if(scene==='mine') {
      const {isWalkable}=await import(new URL('world.js',location.href).href);
      const m=f.world.underground,candidates=[];
      for(let i=0;i<m.wallKind.length;i++)if(m.wallKind[i]===3) {
        const x=i%m.w,y=Math.floor(i/m.w);
        for(const [dx,dy]of [[0,1],[1,0],[-1,0],[0,-1]])
          if(isWalkable(m,x+dx,y+dy))candidates.push({x:x+dx,y:y+dy,d:Math.hypot(x-24,y-24)});
      }
      candidates.sort((a,b)=>a.d-b.d);
      if(!candidates.length)throw Error('鉱床に接する歩ける場所がない');
      const target=candidates[0];
      sim.teleport(debug.state,'underground',target.x,target.y);
      sim.addItem(debug.state,'lantern_stone',4);
      for(const [dx,dy]of [[-2,0],[2,0],[0,2],[0,-2]])sim.place(debug.state,'lantern_stone',target.x+dx,target.y+dy);
    }
    debug.renderer.snapCamera();
    return {map:debug.state.player.map,houses:debug.state.houses.filter(h=>h.valid).length,
      crops:debug.state.crops.length,boss:debug.state.boss?.bossId||null};
}'''

REACHABLE = '''els => els.map(el=>{
    const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return {label:el.getAttribute('aria-label')||el.textContent.trim(),visible:r.width>0&&r.height>0,hotbar:!!el.closest('.hotbar'),
      reachable:r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&!!hit&&(hit===el||el.contains(hit))};
}).filter(r=>r.visible)'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    for width, height, device in [(1440, 900, 'desktop'), (390, 844, 'portrait')]:
        for scene in scenes:
            label = f'{device} {scene}'
            context = browser.new_context(viewport={'width': width, 'height': height},
                device_scale_factor=1, has_touch=device=='portrait', is_mobile=device=='portrait')
            page = context.new_page()
            page.set_default_timeout(6000)
            errors, console_errors, load_errors = [], [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: console_errors.append(message.text) if message.type=='error' else None)
            page.on('requestfailed', lambda request: load_errors.append(f'{request.url}: {request.failure}'))
            page.on('response', lambda response: load_errors.append(f'HTTP {response.status}: {response.url}') if response.status>=400 else None)
            try:
                page.goto(args.url)
                # タイトルを実際に操作して開始する。debug.startだけでUI状態を飛ばさない。
                page.get_by_role('button', name='はじめから', exact=False).click()
                page.wait_for_function("window.__mosslight?.mode==='play'")
                fixture = page.evaluate(SETUP, scene)
                page.wait_for_timeout(800)
                state = page.evaluate('''() => {
                    const d=__mosslight,c=document.getElementById('game'),v=d.renderer.getView();
                    return {missing:[...d.assets.missing],failed:d.assets.failed.map(String),
                      manifest:d.assets.manifestLoaded,canvas:c.width>0&&c.height>0,
                      viewFinite:[v.x,v.y,v.w,v.h,v.scale].every(Number.isFinite),
                      overflow:document.documentElement.scrollWidth>innerWidth};
                }''')
                check(label+' 場面の地上・地下が正しい', fixture['map']==('underground' if scene in ['mine','vine','ash'] else 'surface'), fixture)
                check(label+' 未解決フレームなし', not state['missing'], state['missing'])
                check(label+' アセット読込失敗なし', state['manifest'] and not state['failed'] and not load_errors, {'failed':state['failed'],'network':load_errors})
                check(label+' キャンバスとカメラが有効', state['canvas'] and state['viewFinite'], state)
                check(label+' 横方向のはみ出しなし', not state['overflow'])
                if scene in ('vine', 'ash'):
                    boss_bar = page.evaluate('''() => {
                        const outer=document.querySelector('.boss-bar').getBoundingClientRect();
                        const inner=document.querySelector('.bar.boss').getBoundingClientRect();
                        return {outer:outer.width,inner:inner.width,left:inner.left,right:inner.right};
                    }''')
                    check(label+' ボス体力バーが親の全幅を使う',
                          boss_bar['inner'] >= boss_bar['outer']*.98 and boss_bar['left']>=0
                          and boss_bar['right']<=width, boss_bar)
                reachable = page.locator('.hud-tr button, .hotbar button').evaluate_all(REACHABLE)
                # 縦画面はバッグとメニューだけをHUDに出し、他の機能はメニューへまとめる。
                check(label+' 表示中のHUDと全8ホットバーを操作できる', len(reachable)>=10 and sum(r['hotbar'] for r in reachable)==8 and all(r['reachable'] for r in reachable), [r for r in reachable if not r['reachable']])
                page.screenshot(path=str(output/f'scene-{device}-{scene}.png'))
                # 座標判定に加え、HUDから実際にメニューを開いて閉じる。
                menu_button = page.get_by_role('button', name='メニュー', exact=False).first
                if device=='portrait': menu_button.tap()
                else: menu_button.click()
                dialog = page.get_by_role('dialog', name='ポーズ', exact=True)
                dialog.wait_for()
                menu_actions = dialog.locator('.menu-list button').evaluate_all('''els=>els.filter(el=>['制作','建築','マップ','日誌'].includes(el.textContent.trim())).map(el=>{
                    const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                    return {label:el.textContent.trim(),reachable:r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&!!hit&&(hit===el||el.contains(hit))};
                })''')
                check(label+' メニューから制作・建築・マップ・日誌へ到達できる', len(menu_actions)==4 and all(r['reachable'] for r in menu_actions), menu_actions)
                resume = dialog.get_by_role('button', name='ゲームに戻る', exact=True)
                check(label+' メニューの戻る操作が画面内', resume.evaluate('el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}'))
                if device=='portrait': resume.tap()
                else: resume.click()
                dialog.wait_for(state='detached')
                check(label+' 実描画・メニュー操作に例外なし', not errors and not console_errors, {'pageerror':errors,'console':console_errors})
            except Exception as error:
                check(label+' 実描画シナリオを完走', False, str(error))
            finally:
                context.close()
    browser.close()

report = {'passed': sum(c['ok'] for c in checks), 'failed': sum(not c['ok'] for c in checks), 'checks': checks}
(output/'browser-scenes.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"{report['passed']} 成功 / {report['failed']} 失敗")
raise SystemExit(report['failed']!=0)
