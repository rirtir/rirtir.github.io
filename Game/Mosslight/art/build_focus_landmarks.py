"""旧遺跡の意匠を大きな石面・柱・金具へ描き直す、採用前のWorkbench試作。

正本とmanifestは変更しない。固定パレットの18色以下、96px、既存pivot/名前を保つ。
"""
import json
import sys

from style import GAME, HEX_OF, Canvas, ramp
from engine import Editor, load, render
from pixelwork import export, save

sys.stdout.reconfigure(encoding='utf-8')

K = ramp('K', 1)
R = [None] + [ramp('R', i) for i in range(1, 6)]
G = [ramp('G', i) for i in (1, 3, 4, 5)]
W = [ramp('W', i) for i in (1, 2, 3)]
C = [ramp('C', i) for i in (2, 4)]
BRASS = ramp('U', 2)
LIGHT = ramp('L', 1)


def slab(cv, x, y, w, h, depth=5):
    """上面・正面・右側面を別の連結面として描く石板。"""
    cv.poly([(x,y),(x+w-7,y-3),(x+w,y+depth-3),(x+7,y+depth)], R[4])
    cv.poly([(x+7,y+depth),(x+w,y+depth-3),(x+w,y+h-3),(x+7,y+h)], R[2])
    cv.poly([(x,y),(x+7,y+depth),(x+7,y+h),(x,y+h-depth)], R[3])
    cv.poly([(x+7,y+depth),(x+18,y+depth-1),(x+18,y+h-1),(x+7,y+h)], R[3])
    cv.poly([(x+w-8,y+depth-2),(x+w,y+depth-3),(x+w,y+h-3),(x+w-8,y+h-2)], R[1])
    cv.rect(x+9,y+depth, max(2,w-22),2,R[4])


def moss(cv,x,y,w=14):
    """枝葉のような数pxの段差を持つ、まとまった苔の面。"""
    cv.poly([(x,y+3),(x+3,y),(x+w-5,y),(x+w-5,y+2),(x+w,y+2),
             (x+w,y+6),(x+w-4,y+6),(x+w-4,y+9),(x+5,y+8),(x+5,y+5),(x,y+5)],G[0])
    cv.poly([(x+2,y+3),(x+5,y+1),(x+w-6,y+1),(x+w-6,y+3),(x+w-2,y+3),
             (x+w-2,y+5),(x+7,y+5),(x+7,y+7),(x+4,y+6),(x+4,y+4)],G[1])
    cv.rect(x+5,y+1,max(2,w-12),2,G[2])
    cv.rect(x+8,y+3,3,2,G[3])


def chip(cv,x,y,side='left'):
    if side=='left':
        cv.poly([(x,y),(x+5,y),(x+5,y+2),(x+2,y+2),(x+2,y+5),(x,y+5)],R[1])
        cv.rect(x+2,y+3,3,2,R[4])
    else:
        cv.poly([(x,y),(x+5,y+2),(x+5,y+5),(x+2,y+5),(x+2,y+2),(x,y+2)],R[1])


def beacon():
    cv=Canvas(96,96)
    # 台座を先に置き、柱の足元が薄い浮遊物に見えないよう接続する。
    slab(cv,25,70,45,10,5)
    slab(cv,31,65,33,9,4)
    cv.poly([(39,44),(55,43),(60,47),(60,66),(54,70),(39,67)],R[1])
    cv.rect(40,47,12,20,R[3]); cv.rect(42,48,6,17,R[4])
    cv.poly([(52,46),(58,48),(58,65),(52,67)],R[2])
    cv.rect(41,57,11,3,W[0]); cv.rect(41,57,10,2,BRASS)
    # 木枠の中に顔のような二眼と中央の灯芯。枠と腕木を石の面から分離。
    cv.rect(33,30,28,17,W[0]); cv.rect(37,32,19,13,K)
    cv.rect(34,31,3,15,W[2]);cv.rect(57,32,3,14,W[1])
    cv.rect(38,32,17,2,W[1]);cv.rect(38,43,17,3,W[1])
    cv.rect(40,36,3,3,C[0]);cv.rect(49,36,3,3,C[0])
    cv.rect(45,36,2,7,BRASS);cv.rect(43,42,6,2,BRASS)
    # 段になった庇。屋根の上面は広い一面、先端の欠けだけ局所化。
    cv.poly([(26,24),(39,15),(52,13),(68,22),(71,27),(60,31),(34,31),(24,28)],R[1])
    cv.poly([(27,24),(39,17),(52,15),(65,22),(57,25),(35,27)],R[4])
    cv.poly([(35,27),(57,25),(68,23),(68,27),(59,30),(34,30),(27,27)],R[2])
    cv.rect(35,26,21,2,R[3]);cv.rect(43,16,10,2,R[5])
    cv.poly([(45,10),(49,9),(51,13),(45,15)],R[3])
    cv.rect(45,10,3,3,BRASS)
    chip(cv,29,25);chip(cv,52,51,'right')
    moss(cv,29,23,14);moss(cv,28,70,15)
    return cv


def ruin_arch():
    cv=Canvas(96,96)
    # 門の内側は透明。暗い内輪と厚い柱で通路の輪郭を読ませる。
    slab(cv,15,71,23,9,4);slab(cv,62,70,23,10,4)
    cv.poly([(20,38),(32,35),(37,43),(34,71),(26,74),(20,69)],R[1])
    cv.poly([(21,40),(29,38),(30,70),(25,71),(21,68)],R[3])
    cv.poly([(29,38),(34,40),(32,69),(30,70)],R[2])
    cv.poly([(63,36),(73,34),(79,40),(77,71),(70,73),(63,68)],R[1])
    cv.poly([(64,40),(72,37),(72,69),(68,71),(64,67)],R[3])
    cv.poly([(72,38),(77,41),(75,69),(72,69)],R[2])
    # 楔形の五つの大石でアーチを構成。細線を全面に描かない。
    blocks=[([(19,39),(24,26),(32,20),(40,27),(34,35),(30,42)],R[3]),
            ([(31,19),(42,13),(48,15),(48,25),(39,29)],R[4]),
            ([(43,13),(54,11),(61,16),(58,27),(48,25)],R[3]),
            ([(61,15),(73,24),(76,31),(67,37),(57,26)],R[4]),
            ([(70,29),(78,33),(80,43),(72,45),(64,38)],R[3])]
    cv.poly([(18,40),(23,25),(40,12),(54,9),(64,14),(77,26),(82,42),
             (71,47),(63,36),(55,28),(46,28),(36,35),(30,45)],R[1])
    for points,col in blocks:cv.poly(points,col)
    cv.poly([(26,28),(33,23),(37,27),(31,34),(24,37)],R[2])
    cv.poly([(64,22),(71,27),(73,31),(69,33),(61,26)],R[2])
    cv.rect(45,15,6,4,R[5]);cv.rect(47,20,4,3,BRASS)
    cv.rect(21,51,8,2,R[2]);cv.rect(65,55,7,2,R[2])
    chip(cv,21,59);chip(cv,72,45,'right')
    moss(cv,33,12,18);moss(cv,16,71,16)
    moss(cv,69,34,12);cv.rect(71,42,3,10,G[0]);cv.rect(72,43,2,6,G[1])
    return cv


def altar():
    cv=Canvas(96,96)
    slab(cv,18,68,62,12,5)
    slab(cv,23,60,52,11,5)
    slab(cv,29,54,40,9,4)
    # 光を受ける左面と暗い右面のある、古い細身の石碑。
    cv.poly([(38,23),(47,13),(57,18),(59,49),(53,55),(38,51)],R[1])
    cv.poly([(40,25),(47,16),(50,19),(50,51),(40,49)],R[3])
    cv.poly([(50,19),(55,20),(57,48),(52,52),(50,51)],R[2])
    cv.poly([(41,24),(47,18),(49,20),(46,25)],R[4])
    cv.rect(42,27,2,15,R[4])
    # 明瞭な刻印。数px幅で、一筆の線を石面全面へ広げない。
    cv.rect(45,30,3,12,C[0]);cv.rect(42,33,9,3,C[0]);cv.rect(44,41,5,2,C[0])
    cv.rect(45,32,2,3,C[1])
    cv.rect(40,47,10,3,W[0]);cv.rect(41,47,8,2,BRASS)
    chip(cv,52,24,'right');chip(cv,65,66,'right');chip(cv,31,74)
    cv.poly([(35,57),(45,54),(58,54),(62,57),(45,60)],R[4])
    moss(cv,20,67,18);moss(cv,55,55,14)
    return cv


def stairs():
    cv=Canvas(96,96)
    # 背面の暗い坑道口、門柱、階段を順に。踏面は手前ほど広く。
    cv.poly([(29,27),(37,20),(63,20),(70,28),(69,52),(29,52)],R[1])
    cv.poly([(33,29),(39,24),(61,24),(66,29),(65,51),(33,51)],K)
    cv.rect(34,30,3,17,R[2])
    cv.poly([(18,30),(28,28),(33,33),(31,66),(22,68),(18,64)],R[1])
    cv.rect(20,32,8,32,R[3]);cv.rect(21,33,3,27,R[4]);cv.rect(28,35,3,30,R[2])
    cv.poly([(67,29),(78,28),(82,34),(80,65),(72,69),(67,64)],R[1])
    cv.rect(68,32,8,31,R[3]);cv.rect(76,33,4,28,R[2])
    slab(cv,16,23,67,10,5)
    cv.poly([(24,22),(31,16),(46,14),(64,15),(77,21),(67,24),(31,26)],R[4])
    cv.poly([(46,16),(58,16),(63,20),(45,22),(37,22)],R[3])
    cv.rect(43,25,12,3,W[0]);cv.rect(45,25,8,2,BRASS)
    # 階段は4枚の大きな踏面と前面。開口の奥から接地点へ向かう。
    for x,y,w in ((29,46,38),(25,54,46),(21,62,54),(17,70,62)):
        slab(cv,x,y,w,10,4)
    # 大きな欠けが階段の機能を妨げないよう、両端にだけ置く。
    chip(cv,21,66);chip(cv,72,74,'right')
    cv.rect(22,42,6,2,R[2]);cv.rect(69,49,7,2,R[2])
    moss(cv,22,19,17);moss(cv,71,59,12);moss(cv,18,70,14)
    return cv


def main():
    source=load(GAME/'art/landmarks.json')
    drawings={'beacon':beacon(),'ruin_arch':ruin_arch(),'altar':altar(),'stairs':stairs()}
    used=sorted({c for cv in drawings.values() for row in cv.g for c in row if c!='.'})
    if len(used)>18:raise ValueError(f'色数超過: {len(used)}')
    lines=['canvas 96 96','pivot 48 80']+[f'palette {c} {HEX_OF[c]}' for c in used]
    for name,cv in drawings.items():
        lines.append(f'part {name} 96 96')
        lines += [f'row {y} 0 {row}' for y,row in enumerate(cv.rows())]
    for old in source['frames']:
        lines += [f'frame {old["name"]} {old["duration"]}',f'tag {old.get("tag","focus")}',f'place sprite {old["name"]} 0 0']
    project=Editor().apply('\n'.join(lines))
    destination=GAME/'assets/r2-preview/landmarks'
    save(project,GAME/'art/r2/landmarks.json')
    report=export(project,destination,previous=source,columns=4)
    for frame in project['frames']:
        render(project,frame)[0].save(destination/f'{frame["name"]}-native.png')
    details={'method':'Workbench Canvas hand-drawn stone planes','colors':len(used),
             'size':project['size'],'pivot':project['pivot'],
             'frames':[{k:f[k] for k in ('name','duration')} for f in project['frames']],
             'warnings':report['warnings']}
    # 古い自動平滑化のレポートも置換し、候補と診断結果を一致させる。
    (destination/'cluster-report.json').write_text(json.dumps(details,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(details,ensure_ascii=False))


if __name__=='__main__':main()
