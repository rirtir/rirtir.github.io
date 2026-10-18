"""同じ入力・同じ画面幅で、作業前HEADと修正後の比較画像を残す。"""
import argparse
import json
from pathlib import Path
import subprocess
import numpy as np
from playwright.sync_api import sync_playwright, expect
from browser_support import ARTIFACTS, REPO, local_server

REPORT = REPO / 'docs/tool-audit-2026-10'
SCENES = [
    ('Utility/PDFJoiner', 'PDFの回転・プレビュー', '元から回転したPDFも同じ向きで表示。回転・削除に加え、ページ番号と並べ替えボタンを表示。', 'desktop'),
    ('Image/CreateColorPalette', 'カラーパレット', '指定数と実際の抽出数を表示し、重複色を並べない。数値入力・±ボタンを追加。', 'desktop'),
    ('Utility/DepthPreview', '深度マップの一括変換', 'クリック選択とファイル数・進行状況を追加。入力後の自動変換はそのまま。', 'desktop'),
    ('Image/Resize', '画像リサイズ', '幅0の入力時は保存を止め、前のプレビューと修正方法を表示。', 'desktop'),
    ('Image/Image2Video', '画像から動画', '読込完了後に枚数を表示。未読込・変換中の動画生成を防ぐ。', 'desktop'),
    ('Image/Video2Image', '動画から画像', '読込とシークの完了後、自動で画像プレビューを更新。画像保存に「画像化」の操作が不要に。', 'desktop'),
    ('Utility/CSSDiffRemovalTool', 'CSS差分のスマホ表示', '横にはみ出していた2つの入力欄を縦に並べ、説明と処理結果を表示。', 'mobile'),
    ('Utility/MediaConverter', 'メディア変換のスマホ表示', '設定と長いコマンドを画面内に折り返す。出力形式を直接選ぶ流れは維持。', 'mobile'),
    ('Image/EditSVG', 'SVG編集', '元のviewBoxに従って表示。既存の変換を保ち、保存範囲に選択ハンドルを含めない。', 'desktop'),
    ('Image/AlphaTool', '画像透過', '初期の対象色を実際の内部値と一致させた。表示モードを変えても透過結果を保存。', 'desktop'),
    ('Audio/Video2Audio', '動画から音声', '完了・失敗の表示を追加。MP3の振幅と元形式での抽出を修正。', 'desktop'),
    ('Audio/RealTimeWhisper', '文字起こし', '初回モデル読込の案内を追加。開始失敗を表示し、停止時にマイクを終了。', 'mobile'),
    ('Audio/RealTimeAudioAnalyzer', 'マイク解析', '解析中・停止の状態を表示。二重開始と停止後に残るマイクを防ぐ。', 'desktop'),
    ('Utility/RealEstate10Kcreatemeta', 'RE10Kデータ生成', '生成行数を表示し、0ステップ・逆方向・大量行の入力を拒否。', 'mobile'),
    ('Utility/jsonl2graph', 'JSONLのグラフ化', '読込行数と壊れたJSONの行番号を表示。エラー時は前のグラフを維持。', 'desktop'),
]


def setup(page, base, rel):
    if rel.endswith('PDFJoiner'):
        page.locator('#fileInput').set_input_files(str(ARTIFACTS/'sample.pdf'))
        expect(page.locator('.page')).to_have_count(2)
        page.wait_for_timeout(800)
        page.locator('.controls button').first.click()
        page.wait_for_timeout(600)
    elif rel.endswith('CreateColorPalette'):
        page.locator('#file').set_input_files(str(ARTIFACTS/'colors.png'));page.wait_for_timeout(800)
    elif rel.endswith(('Resize','Image2Video','AlphaTool')):
        page.locator('#fileInput').set_input_files(str(ARTIFACTS/'colors.png'));page.wait_for_timeout(500)
        if rel.endswith('Resize'):page.locator('#widthInput').fill('0')
    elif rel.endswith('DepthPreview'):
        page.evaluate('''async()=>{const bytes=await(await fetch('/.local/tool-audit/report.npy')).arrayBuffer();const dt=new DataTransfer();dt.items.add(new File([bytes],'depth.npy'));document.querySelector('#dropArea').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));}''')
        expect(page.locator('#downloadBtn')).to_be_enabled()
    elif rel.endswith('Video2Image'):
        page.locator('#fileInput').set_input_files(str(ARTIFACTS/'sample.webm'))
        expect(page.locator('#controls')).to_be_visible();page.wait_for_timeout(300)
        page.locator('#slider').fill('0.8');page.wait_for_timeout(300)
    elif rel.endswith('Video2Audio'):
        page.locator('#fileInput').set_input_files(str(ARTIFACTS/'sample.webm'))
        expect(page.locator('#controls')).to_be_visible()
    elif rel.endswith('EditSVG'):
        svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="#007bff"><rect transform="translate(10 20)" x="0" y="0" width="30" height="20"/></svg>'
        page.locator('#fileInput').set_input_files({'name':'sample.svg','mimeType':'image/svg+xml','buffer':svg.encode()})
        expect(page.locator('.layer')).to_have_count(1)
    elif rel.endswith('RealEstate10Kcreatemeta'):
        page.get_by_role('button',name='生成',exact=True).click()
    elif rel.endswith('jsonl2graph'):
        text='\n'.join(json.dumps({'Progress/kimg':i,'Loss/loss':3-i*.25}) for i in range(8))
        page.locator('#fileInput').set_input_files({'name':'train.jsonl','mimeType':'application/json','buffer':text.encode()})
        expect(page.locator('.js-plotly-plot')).to_have_count(4)
        page.wait_for_timeout(500)


def run():
    (REPORT/'images').mkdir(parents=True,exist_ok=True)
    np.save(ARTIFACTS/'report.npy',np.arange(64*96,dtype=np.float32).reshape(64,96))
    with local_server() as base,sync_playwright() as pw:
        b=pw.chromium.launch(channel='chrome',headless=True,args=['--autoplay-policy=no-user-gesture-required'])
        for rel,title,description,layout in SCENES:
            for phase in ('before','after'):
                p=b.new_page(viewport={'width':390 if layout=='mobile' else 1100,'height':844 if layout=='mobile' else 850},accept_downloads=True)
                if phase=='before':
                    old=subprocess.check_output(['git','show','HEAD:'+rel+'/index.html'],cwd=REPO)
                    p.route(base+'/'+rel+'/',lambda route,request,body=old:route.fulfill(status=200,content_type='text/html; charset=utf-8',body=body))
                p.goto(base+'/'+rel+'/',wait_until='networkidle')
                setup(p,base,rel)
                p.screenshot(path=str(REPORT/'images'/f'{rel.split("/")[-1]}-{phase}.png'),full_page=True)
                p.close()
            print('CAPTURE '+rel,flush=True)
        cards=[]
        for rel,title,description,layout in SCENES:
            name=rel.split('/')[-1]
            cards.append(f'<section id="{name}"><h2>{title}</h2><p>{description}</p><div class="pair {layout}"><figure><figcaption>変更前</figcaption><a href="images/{name}-before.png"><img src="images/{name}-before.png" alt="{title}の変更前"></a></figure><figure><figcaption>変更後</figcaption><a href="images/{name}-after.png"><img src="images/{name}-after.png" alt="{title}の変更後"></a></figure></div></section>')
        html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ツール点検・画面比較</title><style>
        *{box-sizing:border-box}body{margin:0;padding:24px;background:#eef1f5;color:#182230;font-family:system-ui,sans-serif}main{max-width:1440px;margin:auto}h1{font-size:26px}section{background:white;border-radius:12px;padding:20px;margin:24px 0}h2{margin:0 0 10px;font-size:22px}p{line-height:1.7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pair.mobile{max-width:820px;margin:auto}figure{margin:0;min-width:0}figcaption{padding:8px 12px;background:#e8edf5;font-weight:bold;border-radius:6px 6px 0 0}figure:last-child figcaption{background:#dbf3e5}img{display:block;width:100%;height:auto;border:1px solid #ddd}.desktop img{max-height:600px;object-fit:contain;object-position:top;background:#f5f5f5}a{color:inherit}@media(max-width:700px){.pair{grid-template-columns:1fr}body{padding:10px}}
        </style><main><h1>ツール点検：変更前 → 変更後</h1><p>2026年10月19日。同じ入力・同じ画面幅で比較しています。画像をクリックすると原寸で確認できます。</p>'''+''.join(cards)+'</main></html>'
        (REPORT/'comparison.html').write_text(html,encoding='utf-8')
        p=b.new_page(viewport={'width':1450,'height':1100})
        p.goto(base+'/docs/tool-audit-2026-10/comparison.html')
        for name in ('PDFJoiner','CreateColorPalette','MediaConverter'):
            p.locator('#'+name).screenshot(path=str(REPORT/'images'/(name+'-comparison.png')))
        b.close()


if __name__=='__main__':run()
