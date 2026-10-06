"""有効なフレームを一つも持たない旧シートだけをロード一覧から外す。画像とソースは削除しない。"""
from pathlib import Path
import argparse, json

GAME=Path(__file__).resolve().parents[1]
BASE={'tiles','props','actors','icons'}

def effective(sheets):
    groups={}
    for key,definition in sheets.items():
        target=definition.get('overrides',key)
        frames=groups.setdefault(target,{})
        for name in definition['names']:
            frames[name]=key
    return groups

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    path=GAME/'assets/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'))
    before=effective(manifest['sheets'])
    redundant=[]
    for key,definition in manifest['sheets'].items():
        target=definition.get('overrides',key)
        if key not in BASE and all(before[target].get(name)!=key for name in definition['names']):
            redundant.append(key)
    kept={key:value for key,value in manifest['sheets'].items() if key not in redundant}
    assert effective(kept)==before, '有効なフレームが変わるため、更新を中止しました'
    if args.apply:
        manifest['sheets']=kept
        path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'removed':redundant,'remaining':len(kept),'applied':args.apply},ensure_ascii=False))
