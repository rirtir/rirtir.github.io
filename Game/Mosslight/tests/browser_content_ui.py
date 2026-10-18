"""UI integration fixtures, distinct from ordinary-input long play."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'Game/Mosslight/.review/v6/content-ui-fixtures';OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name, ok, details=None):
    checks.append({'name':name,'ok':bool(ok),'details':details})
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1264,'height':828})
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:8765/Game/Mosslight/?debug=1',wait_until='networkidle')
    page.get_by_role('button',name='はじめから',exact=True).click()
    page.wait_for_function('__mosslight.mode === "play"')
    page.evaluate("()=>__mosslight.open('pause')")
    initial=page.evaluate("()=>({missing:[...__mosslight.assets.missing],light:__mosslight.sim.getPlayerLight(__mosslight.state)})")
    check('fresh world has no missing sprites',not initial['missing'],initial)
    check('no surface light without equipment',initial['light']['radius']==0)
    req=page.evaluate("""()=>{const g=__mosslight,s=g.state,p=s.player;
      p.bag=[{id:'herb',n:4},{id:'mushroom',n:2},...Array.from({length:28},()=>({id:'wood',n:99}))];
      s.progress.npcs.cook={joined:true};s.npcs=[{id:'cook',name:'料理番',x:p.x,y:p.y,active:true,basket:{}}];
      s.rev++;return {core:g.sim.requestStatus(s,'cook_herbs'),ui:g.api.requestStatus('cook_herbs'),oldFits:g.sim.canFit(s,'leek_seed',2)};
    }""")
    check('delivery fixture requires space freed by consumption',req['core']['ok'] and not req['oldFits'],req)
    check('UI agrees with atomic delivery status',req['ui']['canDeliver'],req['ui'])
    page.evaluate("()=>__mosslight.open('npc',{id:'cook'})")
    button=page.locator('[data-fk="rq-cook_herbs"]')
    check('delivery button is enabled',button.count()==1 and button.is_enabled())
    button.click()
    after=page.evaluate("()=>{const g=__mosslight,s=g.state;return {done:s.progress.requests.cook_herbs,herb:g.sim.countItem(s,'herb'),mushroom:g.sim.countItem(s,'mushroom'),leek:g.sim.countItem(s,'leek_seed'),carrot:g.sim.countItem(s,'glow_carrot_seed')}}")
    check('real delivery button consumes inputs and grants both rewards',after=={'done':1,'herb':0,'mushroom':0,'leek':2,'carrot':2},after)
    check('completed request removes delivery button',page.locator('[data-fk="rq-cook_herbs"]').count()==0)
    page.screenshot(path=str(OUT/'delivery.png'))
    for width,height in [(390,844),(1440,900),(1264,828)]:
        page.keyboard.press('Escape')
        page.set_viewport_size({'width':width,'height':height})
        page.keyboard.press('KeyJ')
        page.wait_for_timeout(150)
        layout=page.evaluate("()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,dialog:!!document.querySelector('[role=dialog]')})")
        check(f'journal opens without document overflow at {width}',layout['dialog'] and layout['scroll']<=layout['width'],layout)
        page.screenshot(path=str(OUT/f'journal-{width}.png'))
    page.keyboard.press('Escape')
    page.evaluate("()=>{const g=__mosslight;g.state.player.bag[29]=null;g.give('wheat_seed',1)}")
    page.keyboard.press('KeyB')
    page.locator('[data-fk="bt-farm"]').click()
    page.locator('[data-fk="b-plant_wheat"]').click()
    page.wait_for_function("document.querySelector('.hint').classList.contains('show')")
    page.keyboard.press('Escape')
    page.wait_for_function("!__mosslight.state.player.buildMode && !__mosslight.state.preview")
    page.wait_for_timeout(100)
    check('cancelling planting clears its hint immediately',not page.locator('.hint').evaluate("e=>e.classList.contains('show')"))
    page.evaluate("()=>__mosslight.emit({type:'hint',text:'通常の探索案内'})")
    page.wait_for_function("document.querySelector('.hint').textContent==='通常の探索案内'")
    check('no build mode preserves an ordinary hint',page.locator('.hint').evaluate("e=>e.classList.contains('show') && e.textContent==='通常の探索案内'"))
    check('no uncaught browser errors',not errors,errors)
    browser.close()
report={'method':'Injected UI fixtures; not long play','checks':checks,'passed':sum(c['ok'] for c in checks),'failed':sum(not c['ok'] for c in checks),'errors':errors}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':report['passed'],'failed':report['failed'],'failures':[c for c in checks if not c['ok']]},ensure_ascii=False))
raise SystemExit(bool(report['failed']))
