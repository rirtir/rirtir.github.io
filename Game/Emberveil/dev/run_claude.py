"""制限付きClaude CLI呼び出し。成果物と使用量のみを保存する。"""
import argparse, datetime, json, pathlib, subprocess, time, sys, threading

parser = argparse.ArgumentParser()
parser.add_argument('phase')
parser.add_argument('--model', default='sonnet')
parser.add_argument('--readonly', action='store_true')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
cli = sorted((pathlib.Path.home()/'.vscode/extensions').glob('anthropic.claude-code-*-win32-x64/resources/native-binary/claude.exe'), key=lambda p:p.stat().st_mtime)[-1]
prompt = (root/'dev'/f'{args.phase}-prompt.txt').read_text(encoding='utf-8')
cmd = [str(cli), '--safe-mode','--restricted','--strict-mcp-config','--tools', 'Read,Glob,Grep' if args.readonly else 'Read,Glob,Grep,Edit,Write', '--allowedTools', 'Read,Glob,Grep' if args.readonly else 'Read,Glob,Grep,Edit,Write', '--permission-mode','dontAsk' if args.readonly else 'acceptEdits','--permission-prompts','none','--no-session-persistence','--model',args.model,'--effort','high','--output-format','stream-json','--verbose','--include-partial-messages','-p',prompt]
start=time.time()
record={'phase':args.phase,'requested_model':args.model,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
proc=subprocess.Popen(cmd,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding='utf-8',errors='replace')
print(f'Started {args.phase}: PID {proc.pid}',flush=True)
stderr=[]
def drain_stderr():
    for err in proc.stderr:
        stderr.append(err)
        if len(stderr)>30: stderr.pop(0)
threading.Thread(target=drain_stderr,daemon=True).start()
characters=0;next_progress=4000
for line in proc.stdout:
    try: event=json.loads(line)
    except ValueError: continue
    if event.get('type')=='stream_event':
        delta=event.get('event',{}).get('delta',{})
        characters+=len(delta.get('text',''))+len(delta.get('thinking',''))+len(delta.get('partial_json',''))
        if characters>=next_progress:
            print(f'Generation progress: {characters} characters',flush=True);next_progress=characters+4000
    if event.get('type')=='system' and event.get('subtype')=='init':
        record['model']=event.get('model'); print('Model: '+str(record['model']),flush=True)
    if event.get('type')=='assistant':
        for block in event.get('message',{}).get('content',[]):
            if block.get('type')=='tool_use': print(block['name']+' '+str(block.get('input',{}).get('file_path',block.get('input',{}).get('path',''))),flush=True)
    if event.get('type')=='result':
        for key in ['is_error','usage','modelUsage','duration_ms','duration_api_ms','num_turns','permission_denials','total_cost_usd','subtype']:
            record[key]=event.get(key)
        (root/'dev'/f'{args.phase}-result.txt').write_text(event.get('result',''),encoding='utf-8')
        if args.phase=='design' and not event.get('is_error'):
            (root/'DESIGN.md').write_text(event.get('result',''),encoding='utf-8')
code=proc.wait(); record.update(exit_code=code,elapsed_seconds=round(time.time()-start,2),finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
(root/'dev'/f'{args.phase}-usage.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(record,ensure_ascii=False),flush=True)
if code or record.get('is_error') or 'usage' not in record:
    print(''.join(stderr)[-2000:],file=sys.stderr); sys.exit(code or 1)
