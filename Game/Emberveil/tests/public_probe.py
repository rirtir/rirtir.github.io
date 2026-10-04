"""push後の公開実体・操作・保存復元・ポータル登録を検証する。"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import hashlib,json,datetime,time,sys

url=sys.argv[1]if len(sys.argv)>1 else 'https://rirtir.com/Game/Emberveil/'
base=Path(__file__).resolve().parents[1]
out=base/'tests'/'screenshots';out.mkdir(exist_ok=True)
checks=[];errors=[]
def check(name,ok,detail=None):
    assert ok,f'{name}: {detail}'
    checks.append(name)
with sync_playwright()as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    ctx=browser.new_context(viewport={'width':1440,'height':900});page=ctx.new_page()
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text)if m.type=='error'else None)
    page.goto(url,wait_until='networkidle');page.wait_for_function('window.emberveil&&emberveil.renderer.ready',timeout=30000)
    stamp=str(int(time.time()))
    for name in ['index.html','data.js','world.js','ui.js','main.js','render.js','terrain.js','visuals.js','item-icons.js','lighting.js','audio.js','style.css','assets/pixel-atlas.png','assets/dungeon-atlas.png']:
        response=ctx.request.get(url+name+'?verify='+stamp)
        check('published '+name,response.ok and hashlib.sha256(response.body()).digest()==hashlib.sha256((base/name).read_bytes()).digest(),response.status)
    page.screenshot(path=str(out/'public-title.png'))
    page.locator('#btn-new-game').click();page.locator('#newgame-seed').fill('PUBLIC-CHECK');page.locator('#btn-newgame-start').click();page.locator('#btn-end-secondary').click()
    check('published game starts',page.evaluate("emberveil.game.mode==='playing'&&!emberveil.game.paused"))
    x=page.evaluate('emberveil.game.player.x');page.keyboard.down('KeyD');page.wait_for_timeout(350);page.keyboard.up('KeyD')
    check('published keyboard moves',page.evaluate('emberveil.game.player.x')>x+.2)
    for key,panel in [('Tab','inventory'),('KeyC','craft'),('KeyM','map'),('KeyG','codex')]:
        page.keyboard.press(key);check('published '+panel,page.locator('#panel-'+panel).is_visible());page.keyboard.press('Escape')
    save=page.evaluate('emberveil.app.saveNow({auto:false})');check('published persistent save',save['ok']and save.get('durable',True),save)
    saved=page.evaluate('({seed:emberveil.game.seed,x:emberveil.game.player.x,y:emberveil.game.player.y})')
    page.screenshot(path=str(out/'public-game.png'));page.reload(wait_until='networkidle');page.wait_for_function('window.emberveil&&emberveil.renderer.ready')
    page.locator('#btn-continue').click();page.wait_for_function("emberveil.game.mode==='playing'")
    restored=page.evaluate('({seed:emberveil.game.seed,x:emberveil.game.player.x,y:emberveil.game.player.y})')
    check('published reload restores',saved==restored,[saved,restored]);check('published console clean',not errors,errors)
    portal=ctx.new_page();portal.goto('https://rirtir.com/',wait_until='networkidle')
    check('portal entry',portal.locator('a[href="https://rirtir.com/Game/Emberveil/"]').count()>0)
    browser.close()
report={'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':url,'checks':checks,'count':len(checks),'errors':errors}
(base/'dev'/'public-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
