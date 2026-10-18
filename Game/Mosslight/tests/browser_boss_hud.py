"""HUD composition regression with an explicit boss fixture, not a campaign clear.

Run a local HTTP server on port 8765 before invoking this script.
The world location comes from a normal-input play that exposed HUD occlusion.
"""
import io
import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'Game/Mosslight/tests/output/boss-hud'
OUT.mkdir(parents=True, exist_ok=True)
checks = []
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1264, 'height': 828}, device_scale_factor=1)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8765/Game/Mosslight/?debug=1', wait_until='networkidle')
    page.get_by_role('button', name='はじめから', exact=True).click()
    page.wait_for_function('__mosslight.mode === "play"')
    page.evaluate('''() => {
      const g = __mosslight, s = g.state, a = s.world.underground.landmarks.mossAltar;
      s.progress.lights.forge = true;
      g.give('crystal_moss', 3); g.teleport('underground', a.x, a.y);
      g.sim.restoreLight(s, 'moss');
      s.player.x = 805.8084318009485; s.player.y = 2167.103874758614;
      g.renderer.snapCamera();
    }''')
    for width, height in [(1264, 828), (390, 844), (1440, 900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(250)
        for number, key in enumerate(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']):
            # Partial health makes the background visible: it must remain opaque
            # above the moving world, as well as the filled section of the bar.
            page.evaluate('''() => {
              const s = __mosslight.state, e = s.enemies.find(x => x.bossId === 'vine');
              e.hp = e.maxHp / 2;
            }''')
            page.keyboard.press('Tab')
            page.wait_for_timeout(80)
            page.keyboard.press('Escape')
            page.keyboard.down(key)
            page.wait_for_timeout(250)
            page.keyboard.up(key)
            page.wait_for_timeout(250)
            rect = page.locator('.bar.boss').bounding_box()
            name = f'{width}-{number}.png'
            pixels = Image.open(io.BytesIO(page.screenshot(path=str(OUT / name)))).convert('RGB')
            ok = False
            sample = []
            if rect:
                y = round(rect['y'] + rect['height'] / 2)
                sample = [pixels.getpixel((round(rect['x'] + rect['width'] * f), y))
                          for f in (0.7, 0.8, 0.9)]
                ok = all(rgb == (11, 16, 13) for rgb in sample)
            checks.append({'name': name, 'opaque_unfilled_bar': ok, 'pixels': sample})
    browser.close()

report = {'passed': sum(x['opaque_unfilled_bar'] for x in checks),
          'failed': sum(not x['opaque_unfilled_bar'] for x in checks),
          'checks': checks, 'pageerrors': errors,
          'limits': 'Boss and health are fixtures. Movement and bag open/close use real input.'}
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'passed': report['passed'], 'failed': report['failed'], 'pageerrors': errors}))
raise SystemExit(1 if report['failed'] or errors else 0)
