"""独立レビューで発見したUI・保存・入力の不具合を実ページで再検証する。"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import json
import time


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


root = Path(__file__).resolve().parents[3]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/Game/Emberveil/'
checks = []
errors = []
started = time.monotonic()


def check(name, value, detail=None):
    assert value, f'{name}: {detail}'
    checks.append(name)


def launch_game(ctx, seed):
    page = ctx.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.goto(url)
    page.wait_for_function('window.emberveil && emberveil.ui.ready', timeout=30000)
    page.locator('#btn-new-game').click()
    page.locator('#newgame-seed').fill(seed)
    page.locator('#btn-newgame-start').click()
    page.locator('#btn-end-secondary').click()
    return page


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = launch_game(ctx, 'REVIEW-UI')
        check('new game resumes after intro', page.evaluate('!emberveil.game.paused'))

        page.keyboard.press('Tab')
        check('Tab opens inventory', page.evaluate("emberveil.ui.top()?.name==='inventory'"))
        page.keyboard.press('Tab')
        check('Tab navigates within modal', page.evaluate("emberveil.ui.top()?.name==='inventory' && document.querySelector('#modal').contains(document.activeElement)"))
        page.keyboard.press('KeyE')
        check('menu E cycles crafting tab', page.evaluate("emberveil.ui.top()?.name==='craft'"))
        page.keyboard.press('Escape')
        page.wait_for_timeout(65)
        check('Escape resumes simulation', page.evaluate('!emberveil.game.paused'))
        page.keyboard.press('KeyG')
        check('G opens codex', page.evaluate("emberveil.ui.top()?.name==='codex'"))
        page.keyboard.press('KeyG')
        check('G closes codex', page.evaluate('!emberveil.game.paused'))
        for key, action in [('KeyK', 'interact'), ('KeyL', 'dodge')]:
            page.keyboard.down(key)
            state = page.evaluate(f'emberveil.input.state.held.{action}')
            check(f'{key} holds {action}', state)
            page.keyboard.up(key)
            check(f'{key} releases {action}', page.evaluate(f'!emberveil.input.state.held.{action}'))

        # 保存失敗は別スロットへの移動を止め、退避/破棄の選択をゲーム内に出す。
        page.evaluate('''() => {
            window.reviewSwitched=false;window.reviewSave=emberveil.app.saveNow;
            emberveil.app.saveNow=()=>({ok:false,error:'review quota fixture'});
            emberveil.ui.withCurrentSaved(()=>{window.reviewSwitched=true});
        }''')
        page.locator('#confirm-actions .btn--primary').click()
        check('save failure preserves current run', page.evaluate('!window.reviewSwitched && emberveil.game.seed==="REVIEW-UI"'))
        check('save failure offers JSON export', page.locator('#confirm-actions').inner_text().find('書き出す') >= 0)
        page.evaluate('''() => {emberveil.app.saveNow=window.reviewSave;emberveil.ui.closeAll();}''')

        # 成功したメモリ保存でも、永続化できていない場合は黙って離れない。
        page.evaluate('''() => {
            window.reviewSwitched=false;emberveil.app.saveNow=()=>({ok:true,durable:false});
            emberveil.ui.withCurrentSaved(()=>{window.reviewSwitched=true});
        }''')
        page.locator('#confirm-actions .btn--primary').click()
        check('nonpersistent save requires explicit departure', page.evaluate('!window.reviewSwitched'))
        page.evaluate('''() => {emberveil.app.saveNow=window.reviewSave;emberveil.ui.closeAll();}''')

        # 元のバックアップHP30が、現在HP50を保存する処理で消されない。
        page.evaluate('''() => {
            const {game:g,app:a,ui}=emberveil;ui.openScreen('saves');
            g.player.hp=30;a.saveNow();g.player.hp=40;a.saveNow();g.player.hp=50;
            ui.backupFromList(1);
        }''')
        check('backup fixture exists', page.evaluate('emberveil.store.readBackup(1).save.player.hp===30'))
        page.locator('#confirm-actions .btn--danger').click()
        restored = page.evaluate('emberveil.game.player.hp')
        check('current slot restores selected backup', abs(restored - 30) < 0.3, restored)

        result = page.evaluate('''() => {
            const a=emberveil.app,fn=a.store.remove;a.store.remove=()=>({ok:false});
            const result=a.deleteSlot(2);a.store.remove=fn;return result;
        }''')
        check('failed deletion reports failure', result.get('ok') is False, result)

        result = page.evaluate('''async () => {
            const {TabLock}=await import('./world.js');
            const {app:a,store,game:g}=emberveil;
            const text=JSON.stringify(g.toSave());
            const imported=a.importText(text,2);
            const keptCurrent=a.lock.isOwner(1),releasedTarget=!a.lock.isOwner(2);
            const prior=store.getRaw('slot2'),write=store.write;
            const peer=new TabLock('emberveil.v1');let guarded=false;
            store.write=function(slot,save,opts){
                guarded=opts?.lock===a.lock;peer.acquire(slot,{takeover:true});
                return write.call(this,slot,save,opts);
            };
            const raced=a.importText(text,2);store.write=write;
            const unchanged=store.getRaw('slot2')===prior;
            const peerLocks=peer.isOwner(2);peer.release(2);
            localStorage.setItem('emberveil.v1.lock.slot2',JSON.stringify({tabId:'review-future',ts:Date.now()+86400000}));
            const futureRejected=!a.heldByOther(2),deleted=a.deleteSlot(2);
            return {imported,keptCurrent,releasedTarget,guarded,raced,unchanged,peerLocks,futureRejected,deleted,currentAfter:a.lock.isOwner(1)};
        }''')
        check('import obtains and releases temporary target ownership', result['imported']['ok'] and result['keptCurrent'] and result['releasedTarget'], result)
        check('import rechecks ownership at write', result['guarded'] and result['raced']['ok'] is False and result['unchanged'] and result['peerLocks'], result)
        check('future target lease does not block deletion', result['futureRejected'] and result['deleted']['ok'] and result['currentAfter'], result)

        result = page.evaluate('''() => {
            const {game:g,app:a,ui}=emberveil;
            g.giveItem('pick_crystal',1);g.selectHotbar(7);a.setSettings({autoTool:true});
            ui.openScreen('inventory');
            const read=()=>Object.fromEntries([...document.querySelector('#equipment-stats').children].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]));
            const pickAuto=read();g.giveItem('sword_ember',1);a.setSettings({autoTool:false});ui.renderInventory();const emptyManual=read();
            g.selectHotbar(g.player.inventory.findIndex(s=>s?.id==='pick_crystal'));ui.renderInventory();const pickManual=read();
            g.selectHotbar(g.player.inventory.findIndex(s=>s?.id==='sword_ember'));ui.renderInventory();const swordManual=read();
            g.player.buffs=[{id:'heat',t:0}];ui.renderInventory();const expiredHeat=read();
            g.player.buffs=[{id:'heat',t:20}];ui.renderInventory();const activeHeat=read();
            ui.closeAll();return {pickAuto,emptyManual,pickManual,swordManual,expiredHeat,activeHeat};
        }''')
        check('automatic pick attack displays true tool damage', result['pickAuto']['攻撃'] == '13' and '（3）' in result['pickAuto']['採掘ティア'], result)
        check('manual empty hand does not display bag weapon damage', result['emptyManual']['攻撃'] == '3' and result['emptyManual']['採掘ティア'] == '素手（0）', result)
        check('manual equipment uses selected pick and sword', result['pickManual']['攻撃'] == '13' and result['swordManual']['攻撃'] == '40', result)
        check('heat stat excludes expired buff', result['expiredHeat']['耐熱'] == 'なし' and result['activeHeat']['耐熱'] == 'あり', result)

        page.keyboard.press('KeyP')
        page.locator('#btn-pause-settings').click()
        page.locator('#setting-zoom').focus()
        page.keyboard.press('End')
        check('range native End sets integer zoom', page.evaluate('emberveil.renderer.zoom===3 && emberveil.app.prefs.zoom===3'))
        page.locator('#setting-volume').focus()
        page.keyboard.press('Home')
        check('volume range affects audio', page.evaluate('emberveil.audio.volume===0 && emberveil.app.settings.volume===0'))
        page.locator('#setting-reduced-motion').select_option('on')
        check('reduced motion reaches scene and UI', page.evaluate('emberveil.renderer.reducedMotion && document.querySelector("#game-app").dataset.reducedMotion==="on"'))
        page.locator('#setting-touch').select_option('on')
        check('forced touch controls shown', page.evaluate('!document.querySelector("#touch-controls").hidden'))
        page.locator('#setting-left-hand').check()
        check('left hand reverses controls', page.evaluate('getComputedStyle(document.querySelector("#touch-controls")).flexDirection==="row-reverse"'))
        page.locator('#setting-uiscale').select_option('150')
        check('UI scale reaches controls', page.evaluate('document.querySelector("#game-app").dataset.uiScale==="150" && parseFloat(getComputedStyle(document.querySelector("#setting-uiscale")).fontSize)>19'))
        page.evaluate('emberveil.ui.closeAll()')

        # BFCacheは同じJS状態を復帰させる。キャッシュに入るだけでロックを失わない。
        result = page.evaluate('''() => {
            const {app:a,game:g}=emberveil;
            window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
            const held=a.lock.held.has(g.slot)&&a.lock.isOwner(g.slot);
            window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
            return {held,owner:a.lock.isOwner(g.slot),readOnly:g.readOnly};
        }''')
        check('BFCache entry retains existing ownership', result['held'], result)
        check('BFCache return resumes original owner', result['owner'] and not result['readOnly'], result)
        result = page.evaluate('''async () => {
            const {TabLock}=await import('./world.js');const {app:a,game:g,store}=emberveil;
            window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
            const peer=new TabLock('emberveil.v1');peer.acquire(g.slot,{takeover:true});
            const saved=store.getRaw('slot'+g.slot);
            window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
            const denied=a.saveNow({auto:true});
            const result={readOnly:g.readOnly,paused:g.pauseReasons.has('readonly'),peerOwner:peer.isOwner(g.slot),denied:!denied.ok,unchanged:store.getRaw('slot'+g.slot)===saved};
            peer.release(g.slot);return result;
        }''')
        check('BFCache return after takeover remains read only', all(result.values()), result)
        ctx.close()

        mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        page = launch_game(mobile, 'REVIEW-TOUCH')
        page.locator('#touch-stick').wait_for(state='visible')
        stick = page.locator('#touch-stick').bounding_box()
        dodge = page.locator('#touch-dodge').bounding_box()
        sx, sy = stick['x'] + stick['width'] / 2, stick['y'] + stick['height'] / 2
        dx, dy = dodge['x'] + dodge['width'] / 2, dodge['y'] + dodge['height'] / 2
        cdp = mobile.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': sx, 'y': sy, 'id': 1}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': sx + 50, 'y': sy, 'id': 1}]})
        page.wait_for_timeout(80)
        check('touch joystick produces movement', page.evaluate('emberveil.input.state.moveX>.5'))
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': sx + 50, 'y': sy, 'id': 1}, {'x': dx, 'y': dy, 'id': 2}]})
        page.wait_for_timeout(80)
        check('two fingers can move and dodge', page.evaluate('emberveil.input.state.moveX>.5 && emberveil.input.state.held.dodge'))
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        page.wait_for_timeout(80)
        check('touch release clears actions', page.evaluate('emberveil.input.state.moveX===0 && !emberveil.input.state.held.dodge && emberveil.input.pointers.size===0'))
        page.evaluate('emberveil.app.setSettings({uiScale:150})')
        page.locator('#btn-inventory').click()
        check('large mobile UI has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector("#modal").scrollWidth<=document.querySelector("#modal").clientWidth'))
        page.locator('#modal-close').click()
        page.wait_for_timeout(65)
        page.locator('#btn-craft').click()
        geometry = page.evaluate('''() => {const el=document.querySelector('#craft-list');return {count:el.children.length,height:el.getBoundingClientRect().height,overflow:getComputedStyle(el).overflowY};}''')
        check('mobile recipe list leaves detail accessible', geometry['count'] > 20 and geometry['height'] <= 321 and geometry['overflow'] == 'auto', geometry)
        page.locator('#btn-craft-make').scroll_into_view_if_needed()
        check('craft action can be reached on mobile', page.locator('#btn-craft-make').is_visible())
        mobile.close()
        browser.close()
    check('no browser script or console errors', not errors, errors)
finally:
    server.shutdown()

print(json.dumps({'checks': checks, 'count': len(checks), 'elapsed_seconds': round(time.monotonic() - started, 2)}, ensure_ascii=False, indent=2), flush=True)
print('PASS: independently reviewed UI regression scenarios')
