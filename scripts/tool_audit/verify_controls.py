"""残りのツールの実入力、出力、失敗からの復帰とマイク資源の終了を検証。"""
import io
import json
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from browser_support import ARTIFACTS, local_server
from verify_tools import download, check, CHECKS


def data_tools(page,base):
    page.goto(base+'/Utility/CSSDiffRemovalTool/')
    results=page.evaluate('''()=>{
      const nested='@media(max-width:600px){.x{color:red}} .a{padding:1px}';
      const repeated='.a{color:red}.b{color:blue}.a{background:black}';
      return [removeDuplicatedCSS('.a{color:red;padding:1px}', '.a{color:red}'),
        removeDuplicatedCSS(nested,nested),removeDuplicatedCSS(repeated,repeated),
        removeDuplicatedCSS('.a{content:"a;b";background:url("data:x;a:b")}', '.b{color:red}')];
    }''')
    assert 'color' not in results[0] and 'padding:1px' in results[0]
    assert results[1].startswith('@media') and results[2].count('.a')==2
    assert '"a;b"' in results[3] and 'data:x;a:b' in results[3]
    for target,text in [('dropA','.a{color:red;padding:1px}'),('dropB','.a{color:red}')]:
        with page.expect_file_chooser() as fc: page.locator('#'+target).click()
        fc.value.set_files({'name':'style.css','mimeType':'text/css','buffer':text.encode()})
        expect(page.locator('#'+target)).to_contain_text('読み込み完了')
    assert 'padding' in download(page,'#run','diff.css').read_text(encoding='utf-8')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(ARTIFACTS/'CSSDiffRemovalTool-mobile-after.png'),full_page=True)
    page.set_viewport_size({'width':1100,'height':850})
    page.screenshot(path=str(ARTIFACTS/'CSSDiffRemovalTool-after.png'),full_page=True)
    check('CSS差分: 実ファイル出力、メディアクエリ・同一セレクタの複数規則・引用符内の区切りを維持、390px表示')

    page.goto(base+'/Utility/RealEstate10Kcreatemeta/')
    page.get_by_role('button',name='生成',exact=True).click()
    assert len(page.locator('#output').input_value().splitlines())==181
    page.locator('#fovStep').fill('0');page.get_by_role('button',name='生成',exact=True).click()
    expect(page.locator('#status')).to_contain_text('0以外')
    page.locator('#fovStep').fill('0.0000000001');page.get_by_role('button',name='生成',exact=True).click()
    expect(page.locator('#status')).to_contain_text('10000')
    page.locator('#fovStart').fill('30');page.locator('#fovEnd').fill('120');page.locator('#fovStep').fill('1')
    page.get_by_role('button',name='生成',exact=True).click()
    assert len(download(page,'button:has-text("ダウンロード")','re10k.txt').read_text().splitlines())==91
    page.screenshot(path=str(ARTIFACTS/'RealEstate10Kcreatemeta-after.png'),full_page=True)
    check('RE10K: 既定181行、増加方向91行、0ステップ・極小ステップ・逆方向を即時拒否')

    page.goto(base+'/Utility/RoundRobinString/')
    project={'variables':[{'name':'a.b','order':1,'items':[{'text':'$&','enabled':True},{'text':'猫','enabled':True}]}],'template':'{a.b} / {axb}'}
    page.locator('#jsonFileInput').set_input_files({'name':'vars.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
    expect(page.locator('.varBox')).to_have_count(1)
    page.locator('#generate').click()
    assert page.locator('#output').inner_text()=='$& / {axb}\n猫 / {axb}'
    page.locator('#generateWithCalc').click()
    assert page.locator('#output').inner_text()=='$& / {axb}\n猫 / {axb}'
    saved=json.loads(download(page,'#saveJson','variables.json').read_text(encoding='utf-8'))
    assert saved==project
    page.locator('#jsonFileInput').set_input_files({'name':'broken.json','mimeType':'application/json','buffer':b'{"variables":[{}]}'})
    expect(page.locator('#toast')).to_contain_text('失敗')
    expect(page.locator('.varBox')).to_have_count(1)
    check('総当たり: 記号を含む変数名と$を文字通り置換、JSON保存復元、不正JSONから編集中の内容を保護')

    page.goto(base+'/Utility/jsonl2graph/')
    text='\n'.join(json.dumps({'Progress/kimg':i,'Loss/loss':3-i}) for i in range(3))
    page.locator('#fileInput').set_input_files({'name':'train.jsonl','mimeType':'application/json','buffer':text.encode()})
    expect(page.locator('.js-plotly-plot')).to_have_count(4,timeout=20000)
    page.wait_for_function('Array.from(document.querySelectorAll(".js-plotly-plot")).every(p=>p._fullLayout)')
    page.locator('#fileInput').set_input_files({'name':'bad.jsonl','mimeType':'application/json','buffer':b'{}\ninvalid'})
    expect(page.locator('#status')).to_contain_text('2行目')
    expect(page.locator('.js-plotly-plot')).to_have_count(4)
    page.screenshot(path=str(ARTIFACTS/'jsonl2graph-after.png'),full_page=True)
    check('JSONL: 学習ログから4グラフ、壊れた行番号を表示し前のグラフを維持')


def image_tools(page,base):
    page.goto(base+'/Image/EditSVG/')
    svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="red"><rect transform="translate(10 20)" x="0" y="0" width="30" height="20"/></svg>'
    page.locator('#fileInput').set_input_files({'name':'sample.svg','mimeType':'image/svg+xml','buffer':svg.encode()})
    expect(page.locator('#svgCanvas')).to_have_attribute('viewBox','0 0 100 100')
    expect(page.locator('.layer')).to_have_count(1)
    page.locator('.layer').click()
    out=download(page,'#download','edited.svg').read_text(encoding='utf-8')
    assert 'viewBox="0 0 50 40"' in out,out
    assert 'fill="red"' in out and 'translate(10 20)' in out and 'bbox' not in out
    # 既存transformのある要素を操作しても元の変換を保持。
    page.locator('.moveHandle').dispatch_event('mousedown',{'clientX':300,'clientY':300})
    page.dispatch_event('body','mousemove',{'clientX':310,'clientY':310})
    page.dispatch_event('body','mouseup')
    assert 'translate(10 20)' in page.locator('#svgCanvas>rect').first.get_attribute('transform')
    page.screenshot(path=str(ARTIFACTS/'EditSVG-after.png'),full_page=True)
    check('SVG: viewBoxと継承色を維持、選択ハンドルを保存寸法に含めない、元の変換付き要素を移動できる')

    page.goto(base+'/Image/Line2AlphaConverter/')
    image=Image.new('RGBA',(3,1));image.putdata([(0,0,0,255),(255,255,255,255),(0,0,0,0)])
    data=io.BytesIO();image.save(data,format='PNG')
    page.locator('#fileInput').set_input_files({'name':'line.png','mimeType':'image/png','buffer':data.getvalue()})
    page.wait_for_function('document.querySelector("#canvas").width===3')
    page.locator('input[value=white]').check()
    out=Image.open(download(page,'#download','line.png')).convert('RGBA')
    assert [out.getpixel((i,0))[3] for i in range(3)]==[255,0,0]
    check('線画→透過: 白背景の黒線を抽出し、元の完全透明画素を透明のまま保存')

    page.goto(base+'/Image/PixelArtMaker/')
    page.locator('#newW').fill('8');page.locator('#newH').fill('8');page.locator('#newProjectBtn').click()
    page.locator('#canvas').click()
    out=Image.open(download(page,'#exportBtn','pixel-art.png'))
    assert out.size==(8,8)
    check('ドット絵メーカー: 8×8の新規作成・描画・原寸PNG保存')

    page.goto(base+'/Image/MosaicMask/')
    page.locator('#file').set_input_files(str(ARTIFACTS/'colors.png'))
    expect(page.locator('#dlMask')).to_be_enabled(timeout=20000)
    out=Image.open(download(page,'#dlMask','mosaic-mask.png')).convert('RGBA')
    assert out.size==(640,360)
    assert all(p[0] in (0,255) and p[0]==p[1]==p[2] and p[3]==255 for p in out.getdata())
    check('モザイク検出: 入力画像と同寸法の白黒マスクを保存（検出精度の一般保証は対象外）')

    page.goto(base+'/Image/ImageEffectLayerTool/')
    page.locator('#fileInput').set_input_files(str(ARTIFACTS/'colors.png'))
    expect(page.locator('#btnSave')).to_be_enabled()
    page.set_viewport_size({'width':390,'height':844})
    before=page.locator('#canvas').evaluate('c=>[c.width,c.height]')
    for _ in range(12):page.locator('#btnCompare').click();page.wait_for_timeout(25)
    assert page.locator('#canvas').evaluate('c=>[c.width,c.height]')==before
    page.locator('#addGrid button').first.click()
    page.wait_for_timeout(500)
    assert page.locator('#canvas').evaluate('c=>[c.width,c.height]')==before
    page.set_viewport_size({'width':1100,'height':850})
    page.locator('#btnMenu').click()
    assert Image.open(download(page,'#btnSave','layered.png')).size==(640,360)
    check('レイヤー画像処理: フィルタ追加・PNG保存・スマホ幅で比較切替を繰り返しても画像が縮み続けない')


MIC_MOCK='''
window.mockTracks=[];window.micRequests=0;
class MockAudioContext {
 constructor(){this.sampleRate=48000;this.state='running';this.destination={};}
 resume(){return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
 createMediaStreamSource(){return {connect(){},disconnect(){}};}
 createScriptProcessor(){const p={connect(){},disconnect(){},onaudioprocess:null};window.mockProcessor=p;return p;}
 createAnalyser(){return {fftSize:2048,frequencyBinCount:1024,getByteTimeDomainData(a){a.fill(128)},getByteFrequencyData(a){a.fill(0)}};}
}
window.AudioContext=MockAudioContext;
navigator.mediaDevices.getUserMedia=async()=>{window.micRequests++;const track={readyState:'live',stop(){this.readyState='ended'}};window.mockTracks.push(track);return {getTracks(){return [track]}}};
'''


def microphones(browser,base):
    context=browser.new_context();context.add_init_script(MIC_MOCK)
    p=context.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
    p.route('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2',lambda route:route.fulfill(content_type='text/javascript',body='''export async function pipeline(){return async samples=>{if(!(samples instanceof Float32Array)||samples.length!==96000)throw new Error('invalid samples');window.recognitionCalls=(window.recognitionCalls||0)+1;await new Promise(r=>setTimeout(r,150));return {text:'認識結果'};};}'''))
    p.goto(base+'/Audio/RealTimeWhisper/')
    p.locator('#toggle').click();expect(p.locator('#status')).to_have_text('録音中')
    emit='''()=>{const data=new Float32Array(4096).fill(.2),out=new Float32Array(4096);for(let i=0;i<100;i++)window.mockProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>data},outputBuffer:{getChannelData:()=>out}});}'''
    p.evaluate(emit)
    assert p.evaluate('window.recognitionCalls')==1
    p.locator('#toggle').click();p.wait_for_timeout(200)
    expect(p.locator('#output')).to_have_text('')
    assert p.evaluate('window.mockTracks.every(t=>t.readyState==="ended")')
    p.locator('#toggle').click();expect(p.locator('#status')).to_have_text('録音中')
    p.evaluate(emit);expect(p.locator('#output')).to_contain_text('認識結果')
    p.locator('#toggle').click()
    p.evaluate('()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new Error("denied")}}')
    p.locator('#toggle').click();expect(p.locator('#status')).to_contain_text('開始できません')
    expect(p.locator('#toggle')).to_be_enabled()
    p.screenshot(path=str(ARTIFACTS/'RealTimeWhisper-after.png'),full_page=True)
    check('文字起こし: 16kHz Float32入力・推論重複防止・停止後の結果破棄・全トラック終了・拒否後の再試行（推論とマイクは模擬）')
    p.goto(base+'/Audio/RealTimeAudioAnalyzer/')
    p.locator('#startBtn').click();expect(p.locator('#startBtn')).to_be_disabled()
    p.locator('#stopBtn').click();p.locator('#startBtn').click();p.locator('#stopBtn').click()
    assert p.evaluate('window.mockTracks.every(t=>t.readyState==="ended")&&window.micRequests===2')
    p.screenshot(path=str(ARTIFACTS/'RealTimeAudioAnalyzer-after.png'),full_page=True)
    assert not errors,errors
    check('マイク解析: 二重開始を防止し、開始停止を繰り返しても全トラックが終了（マイクは模擬）')
    context.close()


def run():
    errors=[]
    with local_server() as base,sync_playwright() as pw:
        b=pw.chromium.launch(channel='chrome',headless=True)
        p=b.new_page(viewport={'width':1100,'height':850},accept_downloads=True)
        p.on('pageerror',lambda e:errors.append(str(e)))
        data_tools(p,base);image_tools(p,base);microphones(b,base)
        assert not errors,errors
        b.close()
    (ARTIFACTS/'controls-verification.json').write_text(json.dumps({'checks':CHECKS,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':run()
