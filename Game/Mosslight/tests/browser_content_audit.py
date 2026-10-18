"""独立監査の保存回帰。実 UI の二重タブ操作と、通常採集 API の保存上限を検証する。

python Game/Mosslight/tests/browser_content_audit.py
既存ゲームにはアクセスしない。セットアップの材料付与・移動は明示的に API を使い、
長時間の手動プレイ時間と混同しない。失敗も JSON に残し、終了コードを非ゼロにする。
"""
import argparse
import json
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8765/Game/Mosslight/?debug=1')
args = parser.parse_args()
checks = []


def check(name, ok, detail):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + ': ' + json.dumps(detail, ensure_ascii=False))


def start(page):
    page.goto(args.url)
    page.get_by_role('button', name='はじめから', exact=False).click()
    page.wait_for_function("window.__mosslight?.mode==='play'")


def menu_save(page):
    page.keyboard.press('Escape')
    page.get_by_role('button', name='保存する', exact=True).click()
    page.keyboard.press('Escape')


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1264, 'height': 828})
    a = context.new_page()
    start(a)
    menu_save(a)
    b = context.new_page()
    b.goto(args.url)
    b.get_by_role('button', name='続きから', exact=False).click()
    b.wait_for_function("window.__mosslight?.mode==='play'")
    a.bring_to_front()
    lost = a.get_by_role('alertdialog', name='別のタブでゲームが開かれました')
    if lost.count():
        lost.get_by_role('button', name='最新の保存から再開', exact=True).click()
    a.evaluate("() => {for(const [id,n] of [['branch',3],['stone',2],['fiber',2]]) __mosslight.api.addItem(__mosslight.state,id,n);}")
    a.keyboard.press('c')
    a.locator('[data-id="axe_stone"]').click()
    a.get_by_role('button', name='×1を作る', exact=True).click()
    check('A の実 UI 制作で斧が得られる', a.evaluate('__mosslight.state.player.tools.axe') == 1, {})
    a.keyboard.press('Escape')
    menu_save(a)
    before = a.evaluate("JSON.parse(localStorage.getItem('mosslight.save.v1')).player.tools.axe")
    backup_before = a.evaluate("localStorage.getItem('mosslight.save.backup')")
    b.bring_to_front()
    lost = b.get_by_role('alertdialog', name='別のタブでゲームが開かれました')
    guarded = lost.count() > 0
    if guarded:
        clock = b.evaluate('__mosslight.state.time.clock')
        pos = b.evaluate('__mosslight.state.player.x')
        b.keyboard.down('ArrowRight')
        b.wait_for_timeout(250)
        b.keyboard.up('ArrowRight')
        check('所有権を失ったタブの時計と実移動入力が止まる',
              b.evaluate('__mosslight.state.time.clock') == clock and b.evaluate('__mosslight.state.player.x') == pos, {})
        check('旧タブの保存 API と pagehide 保存を拒否する',
              not b.evaluate("() => {const result=__mosslight.save();window.dispatchEvent(new Event('pagehide'));return result;}"), {})
    else:
        menu_save(b)
        b.wait_for_timeout(30)
        menu_save(b)
    after = b.evaluate("JSON.parse(localStorage.getItem('mosslight.save.v1')).player.tools.axe")
    backup = b.evaluate("JSON.parse(localStorage.getItem('mosslight.save.backup')).player.tools.axe")
    check('古いタブの保存で新しい進行とバックアップを失わない', before == 1 and after == 1,
          {'before': before, 'after': after, 'backup': backup})
    if guarded:
        check('旧タブ拒否時に既存バックアップも変えない',
              b.evaluate("localStorage.getItem('mosslight.save.backup')") == backup_before, {})
        lost.get_by_role('button', name='最新の保存から再開', exact=True).click()
        check('所有権の再取得で最新の斧を読み込む', b.evaluate('__mosslight.state.player.tools.axe') == 1, {})
    context.close()

    context = browser.new_context(viewport={'width': 1264, 'height': 828})
    page = context.new_page()
    start(page)
    result = page.evaluate("""async () => {
      const {createReviewFixture}=await import('./tests/gameplay.js');
      const {BALANCE,NODES}=await import('./data.js');
      const d=__mosslight,api=d.sim,{state}=createReviewFixture('house');
      for(const slot of [...state.player.bag])if(slot)api.removeItem(state,slot.id,slot.n);
      api.addItem(state,'stone',BALANCE.items.stack*BALANCE.items.bagSlots);
      const initialGround=state.groundItems.length;
      const types={},targets=state.world.surface.nodes.filter(n=>NODES[n.type]?.drops?.length&&!NODES[n.type]?.landmark);
      let harvested=0,hits=0;
      for(const node of targets){
        if(!api.nodeAlive(state,node))continue;
        if(!api.teleport(state,'surface',node.tx,node.ty))continue;
        let strikes=0;
        while(api.nodeAlive(state,node)&&strikes++<10){api.interact(state,{kind:'node',ref:node});hits++;}
        if(!api.nodeAlive(state,node)){harvested++;types[node.type]=(types[node.type]||0)+1;}
        if(state.groundItems.length>BALANCE.save.maxGround)break;
      }
      Object.assign(d.state,state);
      const validation=api.validateSave(api.serialize(d.state));
      const saved=d.save();
      const quantities=s=>{
        const t={};for(const x of s.player.bag)if(x)t[x.id]=(t[x.id]||0)+x.n;
        for(const g of s.groundItems)t[g.item]=(t[g.item]||0)+g.n;
        return Object.fromEntries(Object.entries(t).sort());
      };
      const original=quantities(state),loaded=validation.ok?api.createState(state.world,validation.save):null;
      return {harvested,hits,types,initialGround,ground:state.groundItems.length,limit:BALANCE.save.maxGround,
        validation:validation.ok,errors:validation.errors,saved,quantities:original,
        quantityPreserved:loaded&&JSON.stringify(original)===JSON.stringify(quantities(loaded))};
    }""")
    check('通常採集 API で得た地上ドロップを保存可能に保つ', result['validation'] and result['saved'], result)
    check('採集ドロップの保存・復元で item 別総量が変わらない', result['quantityPreserved'], result['quantities'])
    context.close()
    browser.close()

out = Path(__file__).resolve().parents[1] / '.review/v6/game-audit'
out.mkdir(parents=True, exist_ok=True)
(out / 'browser_content_audit.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(1 if any(not c['ok'] for c in checks) else 0)
