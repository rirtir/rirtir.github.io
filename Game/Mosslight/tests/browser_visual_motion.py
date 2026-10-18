"""通常起動と実キー入力の画面を同期記録する。画像は人がレビューする。

機械検査は環境依存の照明無効化、地形の暫定置換、JSエラーに限定する。
連続画像の見た目をこのスクリプトの終了コードだけで合格にはしない。
"""
import argparse,base64,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright

def main():
    a=argparse.ArgumentParser();a.add_argument('--base',default='http://127.0.0.1:8765');a.add_argument('--out',default=str(Path(__file__).parent/'output/visual-motion'));args=a.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True);reports=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        for width,height,dpr in [(1264,828,1),(1279,828,1),(1280,828,1),(1440,900,1),(1264,828,2),(390,844,1)]:
            folder=out/f'{width}x{height}-dpr{dpr}';folder.mkdir(exist_ok=True)
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=dpr)
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(args.base+'/Game/Mosslight/?debug=1')
            started=time.monotonic();page.get_by_role('button',name='はじめから',exact=False).click();page.wait_for_function("__mosslight.mode==='play'")
            rows=[]
            for action,keys in [('start',[]),('east',['d']),('stop',[]),('west',['a']),('northeast',['w','d']),('southwest',['s','a']),('stop',[])]:
                for key in keys:page.keyboard.down(key)
                for i in range(4):
                    # 画像とcameraを一つの評価で読む。screenshot呼出しの間の進行をずれとして誤判定しない。
                    row=page.evaluate('''()=>{const d=__mosslight,p=d.state.player;return {image:document.getElementById('game').toDataURL(),wall:performance.now(),clock:d.state.time.clock,player:{x:p.x,y:p.y,dir:p.dir,moving:p.moving},view:d.renderer.getView(),visual:d.renderer.getVisualStats()}}''')
                    (folder/f'{len(rows):03d}-{action}.png').write_bytes(base64.b64decode(row.pop('image').split(',',1)[1]))
                    row.update(action=action,keys=keys.copy(),index=len(rows));rows.append(row);page.wait_for_timeout(35)
                for key in keys:page.keyboard.up(key)
            report={'viewport':[width,height],'dpr':dpr,'seconds':time.monotonic()-started,'errors':errors,'rows':rows,
                    'lightingReasons':list(dict.fromkeys(r['visual']['lighting']['reason'] for r in rows)),
                    'activeModes':list(dict.fromkeys(r['visual']['lighting']['active'] for r in rows)),
                    'fallbackMax':max(r['visual']['ground']['fallback'] for r in rows),
                    'missing':page.evaluate('[...__mosslight.assets.missing]')}
            report['runtime_ok']=not errors and not report['missing'] and report['activeModes']==['gl'] and report['fallbackMax']==0
            (folder/'trace.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            reports.append({k:v for k,v in report.items() if k!='rows'});print(json.dumps(reports[-1],ensure_ascii=False),flush=True);page.close()
        browser.close()
    (out/'summary.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
    if not all(r['runtime_ok'] for r in reports):raise SystemExit(1)

if __name__=='__main__':main()
