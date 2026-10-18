"""PDF出力の再読込、PNGの画素・寸法、NPYからのZIPを実ブラウザで検証。"""
import base64
import io
import json
import zipfile
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from browser_support import ARTIFACTS, local_server

CHECKS = []


def check(name):
    CHECKS.append(name)
    print('PASS ' + name, flush=True)


def download(page, selector, name):
    with page.expect_download(timeout=30000) as event:
        page.locator(selector).click()
    path = ARTIFACTS / name
    event.value.save_as(str(path))
    return path


def ready_pdf(page, count):
    expect(page.locator('.page')).to_have_count(count)
    expect(page.locator('.page canvas[data-ready=true]')).to_have_count(count, timeout=30000)
    expect(page.locator('#downloadBtn')).to_be_enabled()


def inspect_pdf(page, path):
    return page.evaluate('''async bytes => {
      const pdfjs = await import('/Utility/PDFJoiner/vendor/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/Utility/PDFJoiner/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({data: new Uint8Array(bytes)}).promise;
      const result = [];
      for (let i=1;i<=doc.numPages;i++) {
        const p = await doc.getPage(i), v = p.getViewport({scale:1});
        const c = document.createElement('canvas'); c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);
        const ctx=c.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
        const pixels = [[.15,.15],[.85,.15],[.15,.85],[.85,.85]].map(([x,y])=>Array.from(ctx.getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data));
        result.push({width:v.width*p.userUnit,height:v.height*p.userUnit,rotation:p.rotate,pixels,
          text:(await p.getTextContent()).items.map(t=>t.str).join(' '),annotations:(await p.getAnnotations()).length});
      }
      await doc.destroy(); return result;
    }''', list(path.read_bytes()))


def pdf_tests(page, base):
    page.goto(base + '/Utility/PDFJoiner/')
    if not (ARTIFACTS / 'sample.pdf').exists():
        raise RuntimeError('capture_before.pyを先に実行してください')
    page.locator('#fileInput').set_input_files(str(ARTIFACTS / 'sample.pdf'))
    ready_pdf(page, 2)
    page.screenshot(path=str(ARTIFACTS / 'PDFJoiner-after.png'), full_page=True)
    page.locator('.page').first.get_by_role('button', name='時計回り', exact=False).click()
    ready_pdf(page, 2)
    page.screenshot(path=str(ARTIFACTS / 'PDFJoiner-rotated-after.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(ARTIFACTS / 'PDFJoiner-mobile-after.png'), full_page=True)
    page.set_viewport_size({'width':1100,'height':850})
    result = inspect_pdf(page, download(page, '#downloadBtn', 'rotated.pdf'))
    assert [(p['width'],p['height']) for p in result] == [(360,240),(360,240)]
    expected = [[0,0,255,255],[255,0,0,255],[255,255,0,255],[0,255,0,255]]
    assert all(p['pixels'] == expected and 'TOP' in p['text'] for p in result), result
    check('PDF: 元の90度回転と追加90度回転が同じ向きになり、出力もプレビュー通り・テキスト維持')
    # 0/90/180/270度、CropBox、注釈、UserUnitの混在PDF。
    encoded = page.evaluate('''async () => {
      const {PDFDocument,PDFName,PDFNumber,PDFString,degrees,rgb} = PDFLib;
      const doc = await PDFDocument.create();
      for(let i=0;i<6;i++) {
        const p=doc.addPage([240,360]); p.setRotation(degrees((i%4)*90));
        for(const [x,y,r,g,b] of [[0,180,1,0,0],[120,180,0,1,0],[0,0,0,0,1],[120,0,1,1,0]])
          p.drawRectangle({x,y,width:120,height:180,color:rgb(r,g,b)});
        p.drawText('TEXT-'+i,{x:45,y:240,size:15});
        if(i===4) p.setCropBox(20,40,200,280);
        if(i===5) p.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));
        const link=doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[30,50,80,90],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of('https://example.com')}});
        p.node.set(PDFName.of('Annots'),doc.context.obj([doc.context.register(link)]));
      }
      return Array.from(await doc.save());
    }''')
    fixture = ARTIFACTS / 'mixed.pdf'; fixture.write_bytes(bytes(encoded))
    page.reload()
    page.locator('#fileInput').set_input_files(str(fixture))
    ready_pdf(page, 6)
    for mode in ('original', 'fitWidth', 'fitHeight'):
        page.locator(f'input[value={mode}]').check()
        out = inspect_pdf(page, download(page, '#downloadBtn', f'{mode}.pdf'))
        assert [p['rotation'] for p in out] == [0,90,180,270,0,90]
        assert all(p['annotations'] == 1 and f'TEXT-{i}' in p['text'] for i,p in enumerate(out)), out
        assert all(all(pixel[3] == 255 for pixel in p['pixels']) for p in out)
        if mode == 'fitWidth': assert max(p['width'] for p in out) - min(p['width'] for p in out) < .01, out
        if mode == 'fitHeight': assert max(p['height'] for p in out) - min(p['height'] for p in out) < .01, out
        check(f'PDF: {mode}で全回転角・切抜き・UserUnit・リンク注釈・テキストを維持')
    page.locator('.page').first.locator('button').nth(3).click()
    ready_pdf(page, 6)
    assert '2ページ' in page.locator('.page-title').first.inner_text()
    page.locator('.page').first.locator('button').nth(1).click()
    ready_pdf(page, 5)
    page.locator('#fileInput').set_input_files({'name':'broken.pdf','mimeType':'application/pdf','buffer':b'broken'})
    expect(page.locator('#status')).to_contain_text('読込失敗')
    ready_pdf(page, 5)
    page.locator('#fileInput').set_input_files(str(fixture))
    ready_pdf(page, 11)
    check('PDF: 並べ替え・削除・壊れたPDFのエラー回復・同名再追加')


def palette_tests(page, base):
    page.goto(base + '/Image/CreateColorPalette/')
    page.locator('#file').set_input_files(str(ARTIFACTS / 'colors.png'))
    expect(page.locator('#download')).to_be_enabled()
    expect(page.locator('.color')).to_have_count(4)
    page.screenshot(path=str(ARTIFACTS / 'CreateColorPalette-after.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(ARTIFACTS / 'CreateColorPalette-mobile-after.png'), full_page=True)
    page.set_viewport_size({'width':1100,'height':850})
    for image_name in ('colors.png','tiny.png','transparent.png'):
        for method in ('rgb','median','kmeans'):
            page.locator('#method').select_option(method)
            page.locator('#file').set_input_files(str(ARTIFACTS / image_name))
            expect(page.locator('#download')).to_be_enabled(timeout=15000)
            expected = {'colors.png':4,'tiny.png':1,'transparent.png':0}[image_name]
            expect(page.locator('.color')).to_have_count(expected)
            out = download(page, '#download', f'{method}-{image_name}')
            original, actual = Image.open(ARTIFACTS / image_name).convert('RGBA'), Image.open(out).convert('RGBA')
            assert actual.size == original.size
            assert actual.getchannel('A').tobytes() == original.getchannel('A').tobytes()
            if expected: assert len(actual.getcolors(actual.width * actual.height)) <= expected
    check('パレット: 3方式×4色/1px/全透明画像で重複色なし、原寸・透明度を維持してPNG保存')
    page.locator('#file').set_input_files(str(ARTIFACTS / 'colors.png'))
    expect(page.locator('#download')).to_be_enabled()
    page.locator('#countNumber').fill('256'); page.locator('#countNumber').press('Tab')
    expect(page.locator('#download')).to_be_enabled()
    expect(page.locator('#countNumber')).to_have_value('256')
    page.locator('#decrease').click(); expect(page.locator('#countNumber')).to_have_value('255')
    page.locator('#file').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'bad'})
    expect(page.locator('#status')).to_contain_text('読み込めません')
    expect(page.locator('#download')).to_be_disabled()
    check('パレット: 最大256色の数値入力・1刻み調整・破損画像で古い結果を保存しない')
    rich=Image.new('RGBA',(256,64))
    rich.putdata([(x,y*4,(x*17+y*29)%256,255) for y in range(64) for x in range(256)])
    rich.save(ARTIFACTS/'rich.png')
    page.locator('#countNumber').fill('256');page.locator('#countNumber').press('Tab')
    for method in ('rgb','median','kmeans'):
        page.locator('#method').select_option(method)
        page.locator('#file').set_input_files(str(ARTIFACTS/'rich.png'))
        expect(page.locator('#download')).to_be_enabled(timeout=30000)
        expect(page.locator('.color')).to_have_count(256)
        colors=page.locator('.color').all_text_contents()
        assert len(set(colors))==256
    page.locator('#colorCount').fill('128');page.locator('#colorCount').fill('64');page.locator('#colorCount').fill('2')
    expect(page.locator('#download')).to_be_enabled(timeout=30000)
    expect(page.locator('.color')).to_have_count(2)
    check('パレット: 多色画像を3方式で256色に抽出し、連続変更時は古い計算を中止して最後の指定に一致')


def depth_tests(page, base):
    values = np.array([[0,1,2],[3,np.nan,5]], dtype=np.float32)
    fixtures = []
    for name,array in [('f4',values),('f8',values.astype('>f8')),('fortran',np.asfortranarray(values)),('u2',np.array([[0,1,2],[3,0,5]],dtype=np.uint16)),('constant',np.ones((1,1),dtype=np.float32))]:
        out = io.BytesIO(); np.save(out,array); fixtures.append({'name':name+'.npy','mimeType':'application/octet-stream','buffer':out.getvalue()})
    for version in ((2,0),(3,0)):
        out=io.BytesIO(); np.lib.format.write_array(out,values,version=version)
        fixtures.append({'name':f'v{version[0]}.npy','mimeType':'application/octet-stream','buffer':out.getvalue()})
    page.goto(base + '/Utility/DepthPreview/')
    page.locator('#fileInput').set_input_files(fixtures)
    expect(page.locator('#downloadBtn')).to_be_enabled()
    page.screenshot(path=str(ARTIFACTS / 'DepthPreview-after.png'), full_page=True)
    path = download(page, '#downloadBtn', 'depth.zip')
    with zipfile.ZipFile(path) as archive:
        assert len(archive.namelist()) == len(fixtures)
        pictures = {name: Image.open(io.BytesIO(archive.read(name))).convert('RGBA') for name in archive.namelist()}
        assert all(p.size == (3,2) for name,p in pictures.items() if name != 'constant.png')
        reference = pictures['f4.png'].tobytes()
        assert all(pictures[n].tobytes() == reference for n in ('f8.png','fortran.png','u2.png','v2.png','v3.png'))
    check('深度: NPY v1/v2/v3・float32/64・big endian・uint16・Fortran順・NaN・1pxをZIP内PNGで照合')
    page.locator('#fileInput').set_input_files([fixtures[0],fixtures[0],{'name':'broken.npy','mimeType':'application/octet-stream','buffer':b'bad'}])
    expect(page.locator('#downloadBtn')).to_be_enabled()
    expect(page.locator('#status')).to_contain_text('3ファイル中 2ファイル')
    with zipfile.ZipFile(download(page, '#downloadBtn', 'duplicates.zip')) as archive: assert len(archive.namelist()) == 2
    page.locator('#fileInput').set_input_files({'name':'broken.npy','mimeType':'application/octet-stream','buffer':b'bad'})
    expect(page.locator('#status')).to_contain_text('1ファイル中 0ファイル')
    expect(page.locator('#downloadBtn')).to_be_disabled()
    expect(page.locator('#popup')).to_be_hidden()
    check('深度: 同名ファイルを上書きしない・不正入力でも処理表示を閉じる・古いZIPを残さない')


def run():
    errors, external = [], []
    with local_server() as base, sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width':1100,'height':850}, accept_downloads=True)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:','https:')) and not r.url.startswith(base) else None)
        pdf_tests(page, base)
        palette_tests(page, base)
        depth_tests(page, base)
        assert not errors, errors
        assert not external, external
        check('PDF・パレット・深度の全操作で未処理JSエラー・外部リクエストなし')
        browser.close()
    (ARTIFACTS / 'verification.json').write_text(json.dumps({'checks':CHECKS,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')


if __name__ == '__main__':
    run()
