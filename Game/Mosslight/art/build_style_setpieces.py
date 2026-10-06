"""蔓の床は枝分かれした根の帯、灰の床は欠けた石版としてWorkbenchで描く。"""
from style import Canvas,ramp,finish,build_lines

def stroke(cv,points,width,color):
    for (x0,y0),(x1,y1) in zip(points,points[1:]):
        count=max(abs(x1-x0),abs(y1-y0),1)
        for step in range(count+1):
            x=round(x0+(x1-x0)*step/count); y=round(y0+(y1-y0)*step/count)
            cv.rect(x-width//2,y-width//2,width,width,color)

def main():
    roots=Canvas(64,56)
    lines=[([(2,13),(13,18),(23,17),(33,25),(44,29),(59,39)],5),
           ([(16,19),(18,29),(28,33),(38,44),(46,47)],3),
           ([(33,25),(38,18),(49,17),(57,9)],3)]
    for points,width in lines:
        stroke(roots,points,width+2,ramp('G',1))
        stroke(roots,points,width,ramp('W',1))
        stroke(roots,[(x,y-1) for x,y in points],max(1,width-2),ramp('W',2))
    for x,y in [(9,16),(25,19),(35,25),(47,30)]:
        roots.rect(x,y-3,5,2,ramp('G',3)); roots.rect(x+1,y-4,2,2,ramp('G',4))
    slab=Canvas(64,56)
    slab.poly([(12,25),(35,21),(53,31),(48,41),(24,45),(9,36)],ramp('R',1))
    slab.poly([(12,23),(35,19),(53,29),(48,36),(23,41),(9,32)],ramp('R',3))
    stroke(slab,[(12,23),(35,19),(53,29)],1,ramp('R',4))
    stroke(slab,[(30,21),(32,26),(27,31),(31,39)],1,ramp('R',1))
    slab.rect(16,27,8,2,ramp('R',2)); slab.rect(39,30,6,2,ramp('R',2))
    finish('setpieces',build_lines((64,56),(32,40),[('moss_roots',roots),('ruin_fragment',slab)]))

if __name__=='__main__': main()
