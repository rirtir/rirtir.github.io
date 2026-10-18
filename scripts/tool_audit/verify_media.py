"""画像・動画・音声を実Chrome/ffmpeg.wasmで書き出し、内容を再読込する。"""
import base64
import io
import json
import math
import struct
import wave
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from browser_support import ARTIFACTS, local_server
from verify_tools import download, check, CHECKS


def alpha_resize(page, base):
    # 透明色と半透明色を含む入力。
    image=Image.new('RGBA',(4,2));image.putdata([(255,255,255,255),(255,0,0,128),(0,0,255,0),(255,0,0,255)]*2)
    buf=io.BytesIO();image.save(buf,format='PNG');payload={'name':'alpha.png','mimeType':'image/png','buffer':buf.getvalue()}
    page.goto(base+'/Image/AlphaTool/')
    page.locator('#fileInput').set_input_files(payload)
    page.wait_for_function('document.querySelector("canvas").width===4')
    page.locator('#smooth').evaluate('(el)=>{el.value=0;el.dispatchEvent(new Event("input"))}')
    for mode in ('original','alpha','edge','result'):
        page.locator('#viewMode').select_option(mode)
        out=Image.open(download(page,'#downloadAlpha',f'alpha-{mode}.png')).convert('RGBA')
        assert out.getpixel((0,0))[3]==0
        assert out.getpixel((1,0))[3]==128
        assert out.getpixel((2,0))[3]==0
    page.locator('#fileInput').set_input_files(str(ARTIFACTS/'colors.png'))
    page.wait_for_function('document.querySelector("canvas").width===640')
    page.locator('#threshold').fill('30')
    page.locator('#viewMode').select_option('alpha')
    out=Image.open(download(page,'#downloadAlpha','alpha-reload.png')).convert('RGBA')
    assert out.tobytes()==Image.open(ARTIFACTS/'colors.png').convert('RGBA').tobytes()
    page.locator('#viewMode').select_option('result')
    page.screenshot(path=str(ARTIFACTS/'AlphaTool-after.png'),full_page=True)
    check('透過: 元の透明度を維持し、元画像/アルファ表示中も処理結果を書き出す。画像入替で前の状態を残さない')

    page.goto(base+'/Image/Resize/')
    page.locator('#fileInput').set_input_files(str(ARTIFACTS/'colors.png'))
    expect(page.locator('#widthInput')).to_have_value('640')
    for mode in ('average','bilinear','bicubic','lanczos'):
        page.locator(f'input[value={mode}]').check()
        page.locator('input[value="0.5"]').check()
        actual=Image.open(download(page,'#downloadBtn',f'resize-{mode}.png'))
        assert actual.size==(320,180)
    page.screenshot(path=str(ARTIFACTS/'Resize-after.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(ARTIFACTS/'Resize-mobile-after.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':1100,'height':850})
    page.locator('#widthInput').fill('0');expect(page.locator('#downloadBtn')).to_be_disabled()
    page.locator('#widthInput').fill('10');expect(page.locator('#downloadBtn')).to_be_enabled()
    page.locator('#fileInput').set_input_files(str(ARTIFACTS/'tiny.png'))
    page.wait_for_function('document.querySelector("#info").textContent.includes("1 x 1")')
    page.locator('input[value="0.125"]').check()
    expect(page.locator('#widthInput')).to_have_value('1');expect(page.locator('#heightInput')).to_have_value('1')
    assert Image.open(download(page,'#downloadBtn','resize-tiny.png')).size==(1,1)
    page.locator('#fileInput').set_input_files(payload)
    page.wait_for_function('document.querySelector("#info").textContent.includes("4 x 2")')
    page.locator('input[value="2.0"]').check()
    page.locator('input[value=lanczos]').check()
    actual=Image.open(download(page,'#downloadBtn','resize-alpha.png')).convert('RGBA')
    assert actual.size==(8,4)
    check('リサイズ: 全4方式のPNG寸法・空欄/0からの復帰・1px縮小・半透明Lanczos')


def make_media(page):
    for name,color in [('frame0.png','red'),('frame1.png','blue')]:Image.new('RGB',(320,180),color).save(ARTIFACTS/name)
    with wave.open(str(ARTIFACTS/'tone.wav'),'wb') as wav:
        wav.setparams((1,2,48000,0,'NONE','not compressed'))
        wav.writeframes(b''.join(struct.pack('<h',round(10000*math.sin(2*math.pi*440*i/48000))) for i in range(48000)))
    data=page.evaluate('''async () => {
      const {FFmpeg}=await import('/ffmpeg/index.js');const ff=new FFmpeg();
      await ff.load({coreURL:new URL('/ffmpeg/ffmpeg-core.js',location.href).href,wasmURL:new URL('/ffmpeg/ffmpeg-core.wasm',location.href).href,classWorkerURL:new URL('/ffmpeg/worker.js',location.href).href});
      for(const name of ['frame0.png','frame1.png','tone.wav'])await ff.writeFile(name,new Uint8Array(await(await fetch('/.local/tool-audit/'+name)).arrayBuffer()));
      const code=await ff.exec(['-y','-framerate','2','-i','frame%d.png','-i','tone.wav','-c:v','libvpx','-c:a','libopus','-t','1','sample.webm']);
      if(code!==0)throw new Error('fixture ffmpeg failed '+code);
      const result=Array.from(await ff.readFile('sample.webm'));ff.terminate();return result;
    }''')
    path=ARTIFACTS/'sample.webm';path.write_bytes(bytes(data));return path


def media_tests(page,base):
    page.goto(base+'/Image/Video2Image/')
    path=make_media(page)
    page.locator('#fileInput').set_input_files(str(path))
    expect(page.locator('#download')).to_be_enabled(timeout=15000)
    image=Image.open(download(page,'#download','video-first.png')).convert('RGB')
    assert image.size==(320,180) and image.getpixel((160,90))[0]>200
    page.locator('#slider').fill('0.8')
    expect(page.locator('#download')).to_be_enabled()
    image=Image.open(download(page,'#download','video-seek.png')).convert('RGB')
    assert image.getpixel((160,90))[2]>200,image.getpixel((160,90))
    page.screenshot(path=str(ARTIFACTS/'Video2Image-after.png'),full_page=True)
    page.locator('#fileInput').set_input_files({'name':'broken.mp4','mimeType':'video/mp4','buffer':b'bad'})
    expect(page.locator('#status')).to_contain_text('読み込めません')
    expect(page.locator('#download')).to_be_disabled()
    check('動画→画像: 読込・シーク後に追加の画像化操作なしで正しいフレームを保存。不正動画で古い画像を保存しない')

    page.goto(base+'/Image/Image2Video/')
    odd=ARTIFACTS/'a-odd.png';Image.new('RGB',(321,181),'red').save(odd)
    page.locator('#fileInput').set_input_files([str(odd),str(ARTIFACTS/'colors.png')])
    expect(page.locator('#generateBtn')).to_be_enabled()
    page.screenshot(path=str(ARTIFACTS/'Image2Video-after.png'),full_page=True)
    page.locator('#generateBtn').click()
    expect(page.locator('#downloadBtn')).to_be_visible(timeout=90000)
    movie=download(page,'#downloadBtn','images.mp4')
    dimensions=page.evaluate('''async path=>{
      const v=document.createElement('video');v.src=path;
      await new Promise((res,rej)=>{v.onloadedmetadata=res;v.onerror=rej});
      return [v.videoWidth,v.videoHeight,v.duration];
    }''',base+'/.local/tool-audit/images.mp4')
    assert dimensions[:2]==[322,182],dimensions
    assert abs(dimensions[2]-2/12)<.02,dimensions
    page.locator('#generateBtn').click()
    expect(page.locator('#downloadBtn')).to_be_visible(timeout=90000)
    page.locator('#fps').fill('24');expect(page.locator('#downloadBtn')).to_be_hidden()
    check('画像→動画: サイズ混在/奇数寸法の画像を実ffmpegでMP4化・FPSに一致する長さ・再生成・設定変更で古い出力を無効化')

    page.goto(base+'/Audio/Video2Audio/')
    page.locator('#fileInput').set_input_files(str(path))
    expect(page.locator('#extractBtn')).to_be_visible()
    for mode in ('wav','mp3','original'):
        page.locator('#mode').select_option(mode)
        page.locator('#extractBtn').click()
        expect(page.locator('#downloadBtn')).to_be_visible(timeout=90000)
        output=download(page,'#downloadBtn',f'audio-{mode}.bin')
        result=page.evaluate('''async path=>{
          const ctx=new AudioContext(),data=await(await fetch(path)).arrayBuffer();
          const audio=await ctx.decodeAudioData(data),samples=audio.getChannelData(0);
          let sum=0;for(const s of samples)sum+=s*s;
          await ctx.close();return {duration:audio.duration,rms:Math.sqrt(sum/samples.length)};
        }''',base+'/.local/tool-audit/'+output.name)
        assert .9<result['duration']<1.6 and result['rms']>.1,result
    page.screenshot(path=str(ARTIFACTS/'Video2Audio-after.png'),full_page=True)
    check('動画→音声: WAV/MP3/元のOpusを再デコードし、長さと音量を照合（MP3が無音化しない）')
    surround=ARTIFACTS/'surround.wav'
    with wave.open(str(surround),'wb') as wav:
        wav.setparams((6,2,48000,0,'NONE','not compressed'))
        wav.writeframes(b''.join(struct.pack('<hhhhhh',0,0,round(10000*math.sin(2*math.pi*440*i/48000)),0,0,0) for i in range(48000)))
    page.locator('#fileInput').set_input_files(str(surround))
    expect(page.locator('#info')).to_contain_text('surround.wav')
    page.locator('#mode').select_option('mp3');page.locator('#extractBtn').click()
    expect(page.locator('#downloadBtn')).to_be_visible(timeout=30000)
    output=download(page,'#downloadBtn','surround.mp3')
    amplitude=page.evaluate('''async path=>{const ctx=new AudioContext(),audio=await ctx.decodeAudioData(await(await fetch(path)).arrayBuffer());let sum=0;for(const s of audio.getChannelData(0))sum+=s*s;await ctx.close();return Math.sqrt(sum/audio.length)}''',base+'/.local/tool-audit/'+output.name)
    assert amplitude>.05,amplitude
    check('MP3: 5.1chのセンターだけにある音声をステレオへ混ぜ、台詞の脱落を防ぐ')


def run():
    errors=[]
    with local_server() as base,sync_playwright() as pw:
        b=pw.chromium.launch(channel='chrome',headless=True,args=['--autoplay-policy=no-user-gesture-required'])
        p=b.new_page(viewport={'width':1100,'height':850},accept_downloads=True)
        p.on('pageerror',lambda e:errors.append(str(e)))
        alpha_resize(p,base)
        media_tests(p,base)
        assert not errors,errors
        b.close()
    (ARTIFACTS/'media-verification.json').write_text(json.dumps({'checks':CHECKS,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':run()
