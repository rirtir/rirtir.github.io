"""汎用変換・メタデータ表示・作曲・ルーレットの主要操作。"""
import json
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from browser_support import ARTIFACTS, local_server
from verify_tools import download, check, CHECKS


def run():
    errors=[]
    with local_server() as base,sync_playwright() as pw:
        b=pw.chromium.launch(channel='chrome',headless=True,args=['--autoplay-policy=no-user-gesture-required'])
        p=b.new_page(viewport={'width':1100,'height':850},accept_downloads=True,reduced_motion='reduce')
        p.on('pageerror',lambda e:errors.append(str(e)))
        p.on('dialog',lambda d:d.accept())
        p.goto(base+'/Utility/MediaConverter/')
        p.locator('#fileInput').set_input_files(str(ARTIFACTS/'sample.webm'))
        p.locator('#format').select_option('png');p.locator('#startBtn').click()
        expect(p.locator('#resultList button')).to_be_visible(timeout=60000)
        assert Image.open(download(p,'#resultList button','converted.png')).size==(320,180)
        p.set_viewport_size({'width':390,'height':844})
        p.wait_for_timeout(150)
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
        p.screenshot(path=str(ARTIFACTS/'MediaConverter-mobile-after.png'),full_page=True)
        p.set_viewport_size({'width':1100,'height':850})
        p.screenshot(path=str(ARTIFACTS/'MediaConverter-after.png'),full_page=True)
        check('メディア変換: WebMからPNGを実ffmpegで出力・スマホ幅の入力後画面も横はみ出しなし')

        p.goto(base+'/Audio/AudioInfo/')
        for name,expected in [('tone.wav','PCM'),('sample.webm','320')]:
            p.locator('#fileInput').set_input_files(str(ARTIFACTS/name))
            expect(p.locator('#info')).not_to_contain_text('解析中',timeout=20000)
            assert expected.lower() in p.locator('#info').inner_text().lower(),p.locator('#info').inner_text()
        check('音声・動画解析: WAVのPCMとWebMの映像サイズを実ファイルから表示')

        p.goto(base+'/Audio/MMLComposer/')
        p.locator('#bSample').click();expect(p.locator('#tOut')).not_to_have_value('')
        before=p.locator('#tOut').input_value()
        # OSの保存ダイアログは開かず、標準ダウンロード経路を実ファイルで確認する。
        p.evaluate('window.showSaveFilePicker=undefined')
        saved=download(p,'#bSaveFile','score.txt').read_text(encoding='utf-8-sig')
        assert before.strip() in saved
        p.locator('#bAdd').click()
        p.locator('#tOut').fill(before);p.locator('#bLoad').click()
        assert p.locator('#tOut').input_value()==before
        p.locator('#bPlay').click();expect(p.locator('#bPlay')).to_contain_text('停止');p.locator('#bPlay').click()
        check('MML作曲: サンプル読込・パート追加・MMLファイル保存復元・再生停止')

        p.goto(base+'/Utility/GohanRoulette/')
        p.locator('#allOff').click();expect(p.locator('#spin')).to_be_disabled()
        p.locator('#allOn').click();p.locator('#spin').click()
        expect(p.locator('#spin')).to_be_enabled(timeout=10000)
        assert p.locator('#pick').inner_text() not in ('','？？？')
        check('ご飯ルーレット: 候補0件では開始不可、候補選択後に抽選結果を表示')
        assert not errors,errors
        b.close()
    (ARTIFACTS/'other-verification.json').write_text(json.dumps({'checks':CHECKS,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':run()
