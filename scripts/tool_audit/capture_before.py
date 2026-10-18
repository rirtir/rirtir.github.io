"""変更前の画面と入力データを保存する（一度だけ実行）。"""
import base64
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from browser_support import ARTIFACTS, REPO, local_server


def run():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGBA', (640, 360))
    draw = ImageDraw.Draw(image)
    for box, color in [((0, 0, 319, 179), '#ef4444'), ((320, 0, 639, 179), '#22c55e'), ((0, 180, 319, 359), '#3b82f6'), ((320, 180, 639, 359), '#facc15')]:
        draw.rectangle(box, fill=color)
    image.save(ARTIFACTS / 'colors.png')
    Image.new('RGBA', (1, 1), '#ff0000').save(ARTIFACTS / 'tiny.png')
    Image.new('RGBA', (20, 20), (255, 0, 0, 0)).save(ARTIFACTS / 'transparent.png')
    with local_server() as base, sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width': 1100, 'height': 850}, accept_downloads=True)
        page.goto(base + '/Utility/PDFJoiner/')
        pdf = page.evaluate('''async () => {
          const { PDFDocument, rgb, degrees } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
          const doc = await PDFDocument.create();
          for (const rotation of [0, 90]) {
            const p = doc.addPage([240, 360]);
            for (const [x,y,r,g,b] of [[0,180,1,0,0], [120,180,0,1,0], [0,0,0,0,1], [120,0,1,1,0]])
              p.drawRectangle({ x,y,width:120,height:180,color:rgb(r,g,b) });
            p.drawText('TOP', { x:20,y:325,size:22 });
            p.setRotation(degrees(rotation));
          }
          const bytes = await doc.save();
          return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
        }''')
        (ARTIFACTS / 'sample.pdf').write_bytes(base64.b64decode(pdf))
        for rel, inp, sample in [('Utility/PDFJoiner', '#fileInput', 'sample.pdf'), ('Image/CreateColorPalette', '#file', 'colors.png'), ('Image/Resize', '#fileInput', 'colors.png'), ('Image/Image2Video', '#fileInput', 'colors.png')]:
            page.goto(base + '/' + rel + '/')
            (ARTIFACTS / (rel.split('/')[-1] + '-before.html')).write_bytes((REPO / rel / 'index.html').read_bytes())
            page.locator(inp).set_input_files(str(ARTIFACTS / sample))
            page.wait_for_timeout(1500)
            page.screenshot(path=str(ARTIFACTS / (rel.split('/')[-1] + '-before.png')), full_page=True)
            if rel.endswith('PDFJoiner'):
                page.locator('.controls button').first.click()
                page.wait_for_timeout(1000)
                page.screenshot(path=str(ARTIFACTS / 'PDFJoiner-rotated-before.png'), full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            page.screenshot(path=str(ARTIFACTS / (rel.split('/')[-1] + '-mobile-before.png')), full_page=True)
            page.set_viewport_size({'width':1100,'height':850})
        page.goto(base + '/Utility/DepthPreview/')
        page.screenshot(path=str(ARTIFACTS / 'DepthPreview-before.png'), full_page=True)
        browser.close()


if __name__ == '__main__':
    run()
