"""Isolated final-altar fixture; actual DOM completion, movement, and save/continue.

This checks the ending flow, not boss combat or normal-input campaign completion.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'Game/Mosslight/tests/output/endgame-flow'
OUT.mkdir(parents=True, exist_ok=True)
checks = {}
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width':1264, 'height':828})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/Game/Mosslight/?debug=1', wait_until='networkidle')
    page.get_by_role('button', name='はじめから', exact=True).click()
    page.wait_for_function('__mosslight.mode === "play"')
    page.evaluate('''() => {
      const g=__mosslight,s=g.state,p=s.player,l=s.world.underground.landmarks.lighthouse;
      s.progress.lights={forge:true,moss:true,ancient:false};
      s.progress.bosses={vine:true,ash:true};s.progress.braziers=[true,true,true];
      s.progress.crystalsPlaced=3;p.map='underground';p.x=l.x*32+16;p.y=l.y*32+16;
      p.bag=[{id:'ancient_wick',n:1},...Array(29).fill(null)];s.rev++;
      g.open('altar',{id:'ancient'});
    }''')
    page.locator('[data-fk="altar-go"]').click()
    ending = page.get_by_role('dialog', name='エンディング', exact=True)
    ending.wait_for()
    checks['actual_altar_sets_all_lights_and_clear'] = page.evaluate('''() => {
      const s=__mosslight.state;return s.progress.cleared && Object.values(s.progress.lights).every(Boolean);
    }''')
    checks['wick_consumed_once'] = page.evaluate("__mosslight.sim.countItem(__mosslight.state,'ancient_wick') === 0")
    before = page.evaluate('__mosslight.state.playTime')
    page.wait_for_timeout(400)
    checks['ending_pauses_simulation'] = page.evaluate('__mosslight.state.playTime') == before
    for width, height in [(390,844),(1264,828)]:
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(100)
        checks[f'continue_visible_and_no_overflow_{width}'] = page.evaluate('''() => {
          const b=document.querySelector('.ending button').getBoundingClientRect();
          return b.left>=0 && b.right<=innerWidth && b.top>=0 && b.bottom<=innerHeight
            && document.documentElement.scrollWidth<=innerWidth;
        }''')
        page.screenshot(path=str(OUT/f'ending-{width}.png'))
    page.get_by_role('button', name='続ける（自由に暮らす）', exact=True).click()
    checks['continue_closes_ending_and_unpauses'] = page.evaluate('!__mosslight.ui.isPaused()') and ending.count() == 0
    page.wait_for_timeout(400)
    checks['simulation_resumes_after_continue'] = page.evaluate('__mosslight.state.playTime') > before
    page.keyboard.press('KeyJ')
    checks['journal_available_after_ending'] = page.locator('.dialog').count() == 1
    page.keyboard.press('Escape')
    page.keyboard.press('Escape')
    page.get_by_role('button', name='保存してタイトルへ', exact=True).click()
    page.get_by_role('button', name='続きから', exact=False).click()
    page.wait_for_function('__mosslight.mode === "play"')
    checks['saved_clear_persists_without_reopening_ending'] = page.evaluate('''() => {
      const g=__mosslight;return g.state.progress.cleared && Object.values(g.state.progress.lights).every(Boolean)
        && !g.ui.isEnding() && !g.ui.isPaused();
    }''')
    checks['no_pageerrors'] = not errors
    browser.close()
report = {'method':'Final-altar fixture with real DOM input; not normal combat', 'checks':checks,'errors':errors}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':sum(checks.values()),'failed':sum(not x for x in checks.values()),'failures':[k for k,v in checks.items() if not v]},ensure_ascii=False))
raise SystemExit(0 if all(checks.values()) else 1)
