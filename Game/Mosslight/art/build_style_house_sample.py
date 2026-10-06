"""屋根と正面を原寸で組み、見本ボード用の小屋を出力する。"""
from style import Canvas,R2_DIR,load,compose,header,part,frame,finish,ramp

roof=load(R2_DIR/'roofs.json')
facade=load(R2_DIR/'facades.json')
cv=Canvas(104,112)
for x,name in enumerate(('facade_window','facade_door','facade_wall_v2')):
    cv.paste(compose(facade,name),4+x*32,48)
for y in range(3):
    for x in range(3):
        cv.paste(compose(roof,f'roof{y*3+x}'),4+x*32,4+y*16)
# 端材と軒は拡大せず、原寸の木の色面で張り出す。
cv.rect(2,50,100,2,ramp('W',1));cv.rect(2,49,100,1,ramp('W',3))
cv.rect(4,4,96,2,ramp('W',3));cv.rect(4,6,96,1,ramp('W',1))
lines=header((104,112),(52,108))
part(lines,'cottage',cv.rows())
frame(lines,'cottage',[('cottage',0,0)])
finish('house',lines)
