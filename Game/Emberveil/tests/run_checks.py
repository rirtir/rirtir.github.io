"""原画・生成・進行・保存・ブラウザ・独立レビューの全検証を再実行する。"""
from pathlib import Path
import subprocess,sys,json,time,datetime

base=Path(__file__).resolve().parent
scripts=['art_check.py','render_probe.py','generation_probe.py','game_probe.py','storage_probe.py','progression_probe.py','smoke.py','review_engine_probe.py','review_ui_probe.py','review_visual_probe.py']
results=[]
for script in scripts:
    started=time.monotonic()
    result=subprocess.run([sys.executable,str(base/script)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
    row={'script':script,'passed':result.returncode==0,'seconds':round(time.monotonic()-started,3),'output':result.stdout.strip()}
    results.append(row)
    print(('PASS' if row['passed'] else 'FAIL')+f' {script} ({row["seconds"]}s)',flush=True)
    if not row['passed']:
        print(result.stdout,result.stderr);break
report={'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'platform':'Windows / Google Chrome / Python Playwright','results':results}
(base.parents[0]/'dev'/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
if not all(r['passed'] for r in results)or len(results)!=len(scripts):sys.exit(1)
print(f'PASS: all {len(results)} suites')
