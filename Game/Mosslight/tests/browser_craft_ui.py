"""Explicit inventory fixtures; separate from the persistent normal-input play."""
import json,pathlib,hashlib
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'Game/Mosslight/tests/output/craft-ui'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='chrome',headless=True)
    p=b.new_page(viewport={'width':1264,'height':828})
    errors=[]
    p.on('pageerror',lambda e:errors.append(str(e)))
    p.goto('http://127.0.0.1:8765/Game/Mosslight/?debug=1',wait_until='networkidle')
    p.get_by_role('button',name='はじめから',exact=True).click()
    p.wait_for_function('__mosslight.mode==="play"')
    p.evaluate("()=>__mosslight.give('fiber',15)")
    p.keyboard.press('c')
    p.locator('[data-fk="tab-all"]').click()
    p.locator('[data-fk="r-cloth"]').click()
    p.locator('[data-fk="make-5"]').click()
    p.evaluate("()=>__mosslight.give('fiber',3)")
    p.wait_for_timeout(350)
    after_five={'one_enabled':p.locator('[data-fk="make-1"]').is_enabled(),'five_enabled':p.locator('[data-fk="make-5"]').is_enabled()}
    p.screenshot(path=str(OUT/'after-five.png'))
    if after_five['one_enabled']:
        p.locator('[data-fk="make-1"]').click()
    after_one=p.evaluate("()=>[__mosslight.sim.countItem(__mosslight.state,'fiber'),__mosslight.sim.countItem(__mosslight.state,'cloth')]")
    p.keyboard.press('Escape')
    p.evaluate("()=>{const s=__mosslight.state;s.player.bag=[{id:'fiber',n:15},...Array.from({length:29},()=>({id:'stone',n:99}))];s.rev++}")
    p.keyboard.press('c')
    p.locator('[data-fk="tab-all"]').click()
    p.locator('[data-fk="r-cloth"]').click()
    p.wait_for_timeout(250)
    full={'one_enabled':p.locator('[data-fk="make-1"]').is_enabled(),'five_enabled':p.locator('[data-fk="make-5"]').is_enabled(),'body':p.locator('.dialog').inner_text()}
    p.screenshot(path=str(OUT/'full-bag.png'))
    if full['five_enabled']:
        p.locator('[data-fk="make-5"]').click()
    after_batch=p.evaluate("()=>[__mosslight.sim.countItem(__mosslight.state,'fiber'),__mosslight.sim.countItem(__mosslight.state,'cloth'),__mosslight.sim.countItem(__mosslight.state,'stone')]")
    checks={
      'one_after_five_enabled':after_five['one_enabled'],
      'unaffordable_five_disabled':not after_five['five_enabled'],
      'single_craft_quantities':after_one==[0,6],
      'full_single_disabled':not full['one_enabled'],
      'full_batch_enabled':full['five_enabled'],
      'full_batch_quantities':after_batch==[0,5,99*29],
      'capacity_and_batch_explained':'バッグ' in full['body'] and '×5なら' in full['body'],
      'no_pageerror':not errors,
    }
    report={'checks':checks,'after_five':after_five,'full_bag':full,'after_one':after_one,'after_batch':after_batch,'pageerrors':errors,'hashes':{n:hashlib.sha256((ROOT/'Game/Mosslight'/n).read_bytes()).hexdigest() for n in ['main.js','ui.js','simulation.js']}}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':sum(checks.values()),'failed':sum(not v for v in checks.values()),'failures':[k for k,v in checks.items() if not v]}))
    b.close()
    raise SystemExit(0 if all(checks.values()) else 1)
