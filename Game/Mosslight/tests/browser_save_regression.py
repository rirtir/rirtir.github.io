"""保存の確認・取消が、現在の採掘済み世界を変更しないことを実ブラウザで検証する。"""
import argparse
import json
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8765/Game/Mosslight/?debug=1')
args = parser.parse_args()
checks = []


def check(name, ok, detail=None):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else ': ' + str(detail)))


def snapshot(page):
    return page.evaluate('''() => {
        const s=__mosslight.state,u=s.world.underground;
        return {walls:[...u.wallKind],terrain:[...u.terrain],mined:[...s.mined.underground],
          progress:s.progress,tools:s.player.tools,bag:s.player.bag,
          position:[s.player.map,s.player.x,s.player.y]};
    }''')


def import_file(page, data, name='save.json'):
    with page.expect_file_chooser() as chooser:
        page.get_by_role('button', name='ファイルから読み込む', exact=True).click()
    chooser.value.set_files({'name': name, 'mimeType': 'application/json', 'buffer': data})


def settings(page):
    page.keyboard.press('Escape')
    page.get_by_role('button', name='設定', exact=True).click()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.get_by_role('button', name='はじめから', exact=False).click()
    page.wait_for_function("__mosslight.mode === 'play'")
    original = page.evaluate('() => JSON.stringify(__mosslight.sim.serialize(__mosslight.state))').encode()
    result = page.evaluate('''() => {
        const {state:s,sim:a}=__mosslight,u=s.world.underground;
        for(const [id,n] of [['branch',3],['stone',3],['fiber',2]])a.addItem(s,id,n);
        const craft=a.craft(s,'pick_stone');
        let target;
        for(let y=2;y<u.h-2&&!target;y++)for(let x=2;x<u.w-2&&!target;x++)if(u.wallKind[y*u.w+x]===1)
          for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(!u.wallKind[(y+dy)*u.w+x+dx]) {
            target={x,y,px:x+dx,py:y+dy};break;
          }
        a.teleport(s,'underground',target.px,target.py);
        for(let i=0;i<2;i++)a.interact(s,{kind:'wall',ref:{wall:1,tx:target.x,ty:target.y}});
        window.reviewTarget=target;
        return {craft:craft.ok,wall:u.wallKind[target.y*u.w+target.x],mined:s.mined.underground[target.y*u.w+target.x]};
    }''')
    check('石ツルハシの制作・土壁の実採掘を準備', result == {'craft': True, 'wall': 0, 'mined': 1}, result)
    settings(page)
    before = snapshot(page)
    mined = page.evaluate('() => JSON.stringify(__mosslight.sim.serialize(__mosslight.state))').encode()
    import_file(page, original)
    confirm = page.get_by_role('alertdialog', name='ファイルから読み込む', exact=True)
    confirm.wait_for()
    check('有効ファイルの確認中も現在世界を保持', snapshot(page) == before)
    confirm.get_by_role('button', name='やめる', exact=True).click()
    check('有効ファイルの取消で現在世界を保持', snapshot(page) == before)
    import_file(page, b'{broken', 'broken.json')
    alert = page.get_by_role('alertdialog', name='読み込めません', exact=True)
    alert.wait_for()
    check('壊れたファイルで現在世界を保持', snapshot(page) == before)
    alert.get_by_role('button', name='閉じる', exact=True).click()
    page.evaluate('(s) => localStorage.setItem("mosslight.save.backup",s)', original.decode())
    page.get_by_role('button', name='バックアップから戻す', exact=True).click()
    confirm = page.get_by_role('alertdialog', name='バックアップから読み込む', exact=True)
    confirm.wait_for()
    check('バックアップ確認中も現在世界を保持', snapshot(page) == before)
    confirm.get_by_role('button', name='やめる', exact=True).click()
    check('バックアップの取消で現在世界を保持', snapshot(page) == before)
    import_file(page, original)
    page.get_by_role('alertdialog', name='ファイルから読み込む', exact=True).get_by_role('button', name='読み込む', exact=True).click()
    page.wait_for_function("!document.querySelector('[role=alertdialog]')")
    check('承認した旧データは未採掘状態へ復元', page.evaluate('''() => {
        const t=reviewTarget,s=__mosslight.state,u=s.world.underground;
        return u.wallKind[t.y*u.w+t.x]===1 && s.mined.underground[t.y*u.w+t.x]===0 && s.player.tools.pick===0;
    }'''))
    check('承認後の世界参照を統一', page.evaluate('() => __mosslight.world === __mosslight.state.world'))
    settings(page)
    import_file(page, mined)
    page.get_by_role('alertdialog', name='ファイルから読み込む', exact=True).get_by_role('button', name='読み込む', exact=True).click()
    page.wait_for_function("!document.querySelector('[role=alertdialog]')")
    check('採掘済みファイルを承認して壁の開口を復元', page.evaluate('''() => {
        const t=reviewTarget,s=__mosslight.state,u=s.world.underground;
        return u.wallKind[t.y*u.w+t.x]===0 && s.mined.underground[t.y*u.w+t.x]===1 && s.player.tools.pick===1;
    }'''))
    page.reload()
    page.get_by_role('button', name='続きから', exact=False).click()
    page.wait_for_function("__mosslight.mode === 'play'")
    check('続きからでも採掘・道具を保持', page.evaluate('() => __mosslight.state.mined.underground.some(v=>v===1) && __mosslight.state.player.tools.pick===1'))
    check('続きからの世界参照を統一', page.evaluate('() => __mosslight.world === __mosslight.state.world'))
    check('保存操作に実行例外なし', not errors, errors)
    browser.close()

print(json.dumps({'passed': sum(c['ok'] for c in checks), 'failed': sum(not c['ok'] for c in checks)}, ensure_ascii=False))
raise SystemExit(any(not c['ok'] for c in checks))
