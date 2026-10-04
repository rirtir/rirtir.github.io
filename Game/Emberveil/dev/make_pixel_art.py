"""整数座標・固定パレット・アンチエイリアスなしのオリジナルドット絵。

Pillowのnative-resolution描画のみ。生成画像の縮小・写真の変換・補間はしない。
"""
from PIL import Image, ImageDraw
from pathlib import Path
import math, random, json

ROOT=Path(__file__).resolve().parents[1]/'assets'
P={
 'ink':'#141c2c','shadow':'#1d2b35','slate0':'#253641','slate1':'#354954','slate2':'#4b6166','slate3':'#70847d','slate4':'#a0ada0',
 'bark0':'#2b272e','bark1':'#463334','bark2':'#634a3b','bark3':'#8b6746','bark4':'#b39158',
 'green0':'#1d3438','green1':'#294b40','green2':'#3c6548','green3':'#588552','green4':'#80a35c','green5':'#b7c979',
 'teal0':'#13333f','teal1':'#1e5360','teal2':'#267d80','teal3':'#49af9d','teal4':'#82ddbd','teal5':'#ceeed2',
 'purple0':'#2d2448','purple1':'#48315f','purple2':'#714b80','purple3':'#a46d9c','purple4':'#d99aba','purple5':'#f4c5cd',
 'gold0':'#604236','gold1':'#996139','gold2':'#c88b48','gold3':'#e8b35b','gold4':'#ffdc8c','cream':'#fff0c2',
 'red0':'#4f2a36','red1':'#924331','red2':'#d36737','red3':'#f99a49','red4':'#ffd275','blue':'#88abc1',
}
C=lambda k:P.get(k,k)
def rect(d,box,c,outline=None):d.rectangle(box,fill=C(c),outline=C(outline) if outline else None)
def poly(d,points,c,outline=None):d.polygon(points,fill=C(c)); d.line(points+[points[0]],fill=C(outline),width=1) if outline else None
def line(d,points,c,w=1):d.line(points,fill=C(c),width=w)
def ellipse(d,box,c,outline=None):d.ellipse(box,fill=C(c),outline=C(outline) if outline else None)
def fern(d,x,y,c='green3'):
 line(d,[(x,y),(x,y-9)],'green1')
 for i in range(4):
  z=y-2-i*2;line(d,[(x,z),(x-3+i//2,z-2)],c);line(d,[(x,z),(x+3-i//2,z-2)],c)
def cluster(d,x,y,r,pal,seed=0):
 pts=[(x-r,y+1),(x-r+2,y-r//2),(x-r//2,y-r),(x+2,y-r-1),(x+r-2,y-r//2),(x+r+1,y),(x+r-1,y+r//2),(x+3,y+r//2+2),(x-r//2,y+r//2)]
 poly(d,pts,pal[0],'ink')
 poly(d,[(x-r+2,y),(x-r//2,y-r+2),(x+1,y-r+1),(x+r-2,y-r//2),(x+3,y+2),(x-r//2,y+3)],pal[1])
 poly(d,[(x-r+3,y-2),(x-r//2,y-r+2),(x+1,y-r+2),(x+4,y-r//2),(x-1,y-1)],pal[2])
 line(d,[(x-r//2,y-r+3),(x-1,y-r+2),(x+2,y-r+4)],pal[3])
 if r>8:line(d,[(x-5,y+2),(x-1,y),(x+3,y+1)],pal[2])
 # 葉の面は孤立したノイズでなく、2～5ドットの小さな葉群として置く。
 for dx,dy in [(-r//2,-r//2),(0,-r+4),(r//2-2,-r//2),(-r+4,0),(1,-2),(r//2,1),(-3,r//2-2)]:
  lx=x+dx;ly=y+dy
  line(d,[(lx-2,ly+1),(lx-1,ly),(lx+1,ly),(lx+2,ly+1)],pal[2])
  rect(d,(lx,ly-1,lx+1,ly),pal[3] if dy<-r//3 else pal[1])
  rect(d,(lx-1,ly+2,lx+1,ly+2),pal[0])
def tree(d,gold=False):
 pal=['gold0','gold1','gold2','gold3'] if gold else ['green1','green2','green3','green4']
 poly(d,[(21,85),(27,79),(31,64),(31,42),(26,26),(34,26),(40,44),(43,65),(52,80),(65,86),(48,88),(39,82),(34,89),(22,89),(10,91)],'bark1','ink')
 poly(d,[(27,84),(34,72),(34,52),(30,33),(34,34),(39,53),(38,73),(46,86),(37,82),(32,87)],'bark3')
 line(d,[(35,41),(37,59),(34,77),(28,84)],'bark4')
 line(d,[(40,64),(46,72),(53,79),(60,82)],'bark2',3)
 for x,y in [(31,58),(36,67),(33,75),(42,75),(49,80),(25,85)]:
  line(d,[(x,y),(x+2,y+3),(x+1,y+5)],'bark0');line(d,[(x+2,y),(x+3,y+3)],'bark4')
 line(d,[(34,55),(24,43),(15,36)],'bark2',4)
 line(d,[(38,45),(49,34),(57,27)],'bark2',4)
 # 葉はまとまった形と陰影を一つずつ描く。
 for i,(x,y,r) in enumerate([(18,38,15),(58,35,15),(11,25,12),(32,39,16),(47,23,18),(64,20,10),(24,18,18),(40,11,15),(39,28,18),(17,17,11)]):cluster(d,x,y,r,pal,i)
 for x,y in [(14,35),(58,29),(25,28),(47,35)]:
  for z in range(0,20,4):line(d,[(x,y+z),(x-1,y+z+3)],pal[1]);rect(d,(x-2,y+z+2,x,y+z+3),pal[2])
 for x,y in [(20,61),(52,50),(39,72)]:
  line(d,[(x,y-8),(x,y)],'bark3');rect(d,(x-2,y,x+2,y+5),'gold1');rect(d,(x-1,y+1,x+1,y+4),'gold4');rect(d,(x,y+1,x,y+2),'cream')
 for x in [16,47,63]:fern(d,x,89)
def shroom(d,x,y,w,h,pal):
 poly(d,[(x-3,y),(x-2,y-h+5),(x+2,y-h+4),(x+4,y),(x+8,y+2),(x-6,y+3)],pal[1],'ink')
 line(d,[(x,y-2),(x,y-h+6)],pal[3],2)
 pts=[(x-w//2,y-h+5),(x-w//2+2,y-h),(x-w//3,y-h-7),(x-3,y-h-12),(x+4,y-h-11),(x+w//3,y-h-5),(x+w//2,y-h+3),(x+w//2-2,y-h+7),(x+3,y-h+10),(x-w//3,y-h+9)]
 poly(d,pts,pal[0],'ink')
 poly(d,[(x-w//2+2,y-h+3),(x-w//3,y-h-5),(x-2,y-h-10),(x+4,y-h-9),(x+w//3,y-h-3),(x+w//2-2,y-h+2),(x+4,y-h+4),(x-w//3,y-h+5)],pal[2])
 line(d,[(x-w//2+2,y-h+4),(x-w//3,y-h+7),(x+2,y-h+8),(x+w//2-2,y-h+4)],pal[4],2)
 for dx in range(-w//3,w//3,4):line(d,[(x+dx,y-h+7),(x,y-h+11)],pal[1])
 for dx,dy in [(-7,-3),(1,-7),(7,0),(-3,2)]:rect(d,(x+dx,y-h+dy,x+dx+1,y-h+dy+1),pal[4])
 for dx,dy in [(-w//3,-1),(-3,-8),(w//4,-2),(3,3)]:
  line(d,[(x+dx,y-h+dy),(x+dx+2,y-h+dy-1),(x+dx+3,y-h+dy)],pal[3])
def mushrooms(d,purple=False):
 pal=['purple0','purple1','purple2','purple3','purple5'] if purple else ['teal0','teal1','teal2','teal3','teal5']
 ellipse(d,(10,76,69,93),'green0')
 shroom(d,42,78,51,45,pal);shroom(d,19,88,27,24,pal);shroom(d,59,87,26,25,pal);shroom(d,36,93,19,15,pal)
 for x,y in [(9,87),(65,92),(27,91)]:fern(d,x,y,'purple3' if purple else 'teal3')
def glowcaps(d):
 pal=['teal0','teal1','teal2','teal3','teal5']
 shroom(d,37,89,20,17,pal);shroom(d,26,93,14,10,pal);shroom(d,48,94,13,11,pal)
def rock(d,ore='copper'):
 poly(d,[(10,86),(12,69),(21,61),(24,52),(45,49),(56,59),(63,65),(68,83),(61,90),(26,93)],'slate1','ink')
 poly(d,[(13,69),(25,54),(44,52),(39,66),(25,79),(13,81)],'slate2')
 poly(d,[(40,66),(47,54),(56,62),(58,79),(48,89),(32,90)],'slate0')
 line(d,[(24,55),(34,54),(39,57)],'slate3',2);line(d,[(13,71),(13,78)],'slate3')
 line(d,[(39,65),(43,75),(38,82)],'ink');line(d,[(57,67),(51,77),(52,84)],'ink')
 pal=['gold1','gold2','gold3','gold4'] if ore=='copper' else ['red1','red2','red3','red4']
 for x,y in [(28,62),(20,75),(42,73),(54,82),(32,87)]:
  poly(d,[(x-4,y),(x-1,y-4),(x+3,y-2),(x+4,y+3),(x,y+5)],pal[0],'ink');rect(d,(x-1,y-2,x+2,y+1),pal[2]);rect(d,(x,y-2,x+1,y-1),pal[3])
 fern(d,13,90);fern(d,66,89)
def crystal(d,purple=False):
 pal=['purple1','purple2','purple3','purple4','purple5'] if purple else ['teal1','teal2','teal3','teal4','teal5']
 ellipse(d,(15,80,69,92),'slate0')
 for x,y,w,h in [(25,86,15,34),(52,84,14,38),(37,91,23,59),(62,89,13,20)]:
  poly(d,[(x-w//2,y-h+9),(x,y-h),(x+w//2,y-h+8),(x+w//2,y-7),(x,y),(x-w//2,y-6)],pal[0],'ink')
  poly(d,[(x,y-h+1),(x+w//2-1,y-h+8),(x+2,y-2),(x,y-1)],pal[2])
  poly(d,[(x-w//2+1,y-h+9),(x-1,y-h+2),(x,y-3),(x-w//2+1,y-7)],pal[1])
  line(d,[(x-1,y-h+2),(x,y-h+17),(x,y-7)],pal[4])
  line(d,[(x-w//2+2,y-h+12),(x-2,y-h+8)],pal[3])
 for x in [17,57]:fern(d,x,92,pal[2])
def roots(d):
 poly(d,[(9,88),(22,81),(29,58),(46,59),(53,77),(65,85),(69,90),(45,89),(38,84),(24,91)],'bark1','ink')
 ellipse(d,(28,51,49,64),'bark3','ink');ellipse(d,(31,54,46,61),'bark4');ellipse(d,(35,56,43,60),'bark2')
 line(d,[(33,64),(29,78),(22,87)],'bark3',3);line(d,[(42,63),(48,80),(60,85)],'bark3',3)
 for x,y in [(25,73),(45,74),(36,67)]:cluster(d,x,y,7,['green0','green1','green2','green3'])
 fern(d,14,91);fern(d,58,91)
def workbench(d):
 for x in [14,54]:rect(d,(x,68,x+5,90),'bark1');rect(d,(x,68,x+1,89),'bark3')
 poly(d,[(9,59),(52,53),(69,63),(66,70),(15,77),(9,72)],'bark2','ink')
 poly(d,[(10,59),(51,54),(68,63),(17,71)],'bark3')
 for z in range(3):line(d,[(14,61+z*3),(52,56+z*3),(63,63+z*2)],'bark1')
 rect(d,(17,45,22,59),'bark2');rect(d,(55,39,60,57),'bark2');poly(d,[(17,44),(59,38),(59,44),(17,50)],'bark3','ink')
 for x in [26,35,44]:line(d,[(x,45),(x,55)],'slate3',2);rect(d,(x-2,44,x+2,46),'slate0')
 line(d,[(29,62),(42,60)],'slate4',2);rect(d,(39,56,43,59),'slate2')
 ellipse(d,(53,54,60,62),'gold1','ink');rect(d,(55,53,58,59),'gold4')
 rect(d,(20,77,50,84),'bark2');rect(d,(21,78,49,80),'bark3');fern(d,64,91)
def furnace(d):
 rect(d,(33,31,45,50),'slate0');rect(d,(34,32,37,49),'slate2');ellipse(d,(31,28,46,34),'slate2','ink');ellipse(d,(34,29,43,32),'ink')
 poly(d,[(19,88),(16,67),(23,52),(52,51),(62,67),(62,85),(55,92),(27,92)],'slate1','ink')
 poly(d,[(17,67),(24,53),(38,52),(32,64),(32,88),(23,89)],'slate2');line(d,[(24,56),(52,55)],'slate3');line(d,[(18,66),(60,65)],'slate0',2)
 poly(d,[(31,87),(31,74),(35,68),(44,68),(50,74),(50,87)],'ink','slate3')
 rect(d,(33,78,48,86),'red0');poly(d,[(34,85),(36,74),(39,80),(43,71),(47,84)],'red2');poly(d,[(37,85),(40,76),(44,84)],'gold4')
 line(d,[(17,78),(29,78)],'slate0');line(d,[(52,77),(62,77)],'slate0');rect(d,(62,68,71,80),'bark2');line(d,[(63,68),(69,70),(69,77),(63,80)],'bark4');rect(d,(20,91,60,94),'slate0')
def chest(d):
 poly(d,[(14,89),(14,70),(21,60),(53,60),(65,70),(65,89),(55,94),(24,94)],'bark1','ink')
 poly(d,[(15,70),(22,62),(52,62),(64,70),(53,75),(25,75)],'bark3');rect(d,(17,77,52,92),'bark2')
 poly(d,[(55,76),(64,72),(64,88),(55,92)],'bark0')
 for x in [23,48]:rect(d,(x,65,x+3,92),'gold1');line(d,[(x,66),(x,90)],'gold3');rect(d,(x,78,x+3,79),'gold4')
 line(d,[(16,75),(54,75),(64,71)],'ink',2);rect(d,(33,75,39,83),'gold2');rect(d,(35,78,37,81),'ink')
 line(d,[(29,86),(42,86)],'bark3')
def cabin(d):
 poly(d,[(9,86),(9,55),(37,44),(67,56),(67,87),(39,94)],'bark1','ink')
 poly(d,[(10,57),(37,49),(37,91),(10,84)],'bark2');poly(d,[(39,48),(66,57),(66,86),(39,92)],'bark0')
 for y in range(60,86,6):line(d,[(10,y),(37,y+4),(66,y-4)],'bark3')
 poly(d,[(4,55),(32,21),(45,24),(75,55),(40,65)],'green0','ink')
 poly(d,[(5,54),(32,23),(43,26),(39,63)],'slate1');poly(d,[(44,27),(73,54),(41,62)],'slate0')
 for y in range(31,58,5):line(d,[(30-(y-31)//2,y),(41,y+6),(50+(y-31)//2,y+3)],'slate2')
 for x,y in [(24,43),(34,30),(54,50),(39,53)]:cluster(d,x,y,6,['green0','green1','green2','green4'])
 rect(d,(57,26,65,42),'slate1');rect(d,(57,26,65,28),'slate3')
 rect(d,(20,65,29,88),'ink');rect(d,(21,66,28,86),'bark1');rect(d,(24,67,26,85),'bark3');rect(d,(26,77,27,78),'gold4')
 poly(d,[(45,68),(58,65),(58,79),(45,82)],'gold1','ink');poly(d,[(47,69),(56,67),(56,78),(47,80)],'gold4');line(d,[(51,68),(51,80)],'bark1');line(d,[(47,74),(56,72)],'bark1')
 poly(d,[(14,88),(31,88),(35,94),(17,94)],'slate2');line(d,[(17,91),(32,91)],'slate4');fern(d,62,93)
def altar(d):
 ellipse(d,(6,55,74,94),'slate0','ink');ellipse(d,(6,52,74,89),'slate2','ink');ellipse(d,(12,56,68,84),'slate0');ellipse(d,(14,57,66,81),'teal2');ellipse(d,(16,59,64,80),'slate1')
 for a in range(0,360,40):
  rad=math.radians(a);x=40+int(math.cos(rad)*23);y=68+int(math.sin(rad)*10);line(d,[(x-1,y-1),(x+1,y+1)],'teal4')
 rect(d,(30,63,49,74),'slate0');ellipse(d,(27,60,52,70),'slate3','ink')
 poly(d,[(31,55),(40,28),(49,54),(43,66),(36,65)],'teal1','ink');poly(d,[(40,29),(48,54),(42,64),(40,58)],'teal3');poly(d,[(39,32),(32,55),(39,62)],'teal2');line(d,[(40,31),(40,58)],'teal5')
 for x,y in [(11,68),(65,66)]:rect(d,(x-2,y-7,x+2,y),'bark1');poly(d,[(x-3,y-7),(x,y-15),(x+3,y-7)],'red2');rect(d,(x,y-11,x+1,y-8),'gold4')
def arch(d):
 for x in [15,52]:rect(d,(x,45,x+13,91),'slate1','ink');rect(d,(x+1,46,x+5,90),'slate2')
 poly(d,[(14,50),(17,33),(28,24),(52,24),(63,34),(67,48),(52,49),(49,39),(31,39),(28,49)],'slate1','ink')
 poly(d,[(17,47),(20,34),(30,27),(48,27),(59,35),(62,46),(54,45),(50,37),(30,37),(26,46)],'slate2')
 for x,y in [(17,61),(53,60),(15,77),(52,78)]:line(d,[(x,y),(x+13,y)],'slate0');line(d,[(x+3,y),(x+3,y+12)],'slate0')
 line(d,[(32,26),(32,35)],'slate0');line(d,[(47,26),(47,35)],'slate0');line(d,[(20,36),(28,41)],'slate0');line(d,[(52,39),(61,35)],'slate0')
 for x,y,r in [(21,40,8),(35,25,9),(56,69,6),(18,87,8)]:cluster(d,x,y,r,['green0','green1','green2','green4'])
 line(d,[(22,40),(21,55),(24,64),(23,73)],'green2');fern(d,62,94)
def farm(d):
 poly(d,[(6,73),(44,61),(74,76),(39,94),(6,83)],'bark1','ink');poly(d,[(10,74),(43,65),(68,77),(39,89)],'bark0')
 line(d,[(7,74),(39,91),(73,77)],'bark3',2);line(d,[(7,74),(44,62),(73,76)],'bark4')
 for x,y in [(24,73),(42,71),(57,77),(38,82)]:
  cluster(d,x,y,7,['green0','green1','green2','green4']);line(d,[(x-3,y-2),(x,y+2),(x+3,y-1)],'green5')
 for x,y in [(53,86),(62,83)]:rect(d,(x,y,x+2,y+2),'red2');rect(d,(x,y,x,y),'red4')
def logs(d):
 for x,y in [(20,80),(37,79),(27,90),(48,89)]:
  poly(d,[(x-7,y-3),(x+13,y-12),(x+20,y-7),(x+7,y+4)],'bark1','ink');line(d,[(x+1,y-4),(x+14,y-9)],'bark3',2);ellipse(d,(x-8,y-5,x+8,y+6),'bark3','ink');ellipse(d,(x-5,y-3,x+5,y+4),'bark4');ellipse(d,(x-2,y-1,x+2,y+2),'bark2')
 rect(d,(56,66,60,87),'bark2');line(d,[(57,65),(58,86)],'bark4');poly(d,[(51,66),(55,58),(65,61),(66,69),(59,72)],'slate2','ink');line(d,[(52,65),(56,59),(64,62)],'slate4');fern(d,11,92)

def herb(d,kind='moss'):
 if kind=='moss':
  for x,y in [(29,94),(37,94),(44,93),(51,92)]:fern(d,x,y,'green4')
  for x in [29,41,49]:rect(d,(x,94,x+3,95),'green1')
 elif kind=='grain':
  for x,y in [(29,91),(36,94),(43,90),(50,94)]:
   line(d,[(x,y),(x-2,y-19)],'green3')
   for k in range(4):
    rect(d,(x-4,y-19+k*3,x-2,y-17+k*3),'gold2');rect(d,(x-1,y-18+k*3,x+1,y-16+k*3),'gold3')
   line(d,[(x,y-6),(x+4,y-10)],'green4')
 else:
  for x,y in [(29,93),(40,90),(50,94)]:
   line(d,[(x,y),(x,y-13)],'green2');poly(d,[(x,y-8),(x-7,y-13),(x-8,y-9),(x-2,y-5)],'green3','green1');poly(d,[(x,y-10),(x+7,y-15),(x+9,y-12),(x+3,y-6)],'green4','green1')
   if kind=='pepper':poly(d,[(x+3,y-6),(x+5,y-8),(x+7,y-4),(x+5,y+1)],'red2','red0');rect(d,(x+4,y-6,x+4,y-3),'red4')
   else:ellipse(d,(x-4,y-3,x+3,y+2),'gold1','ink');rect(d,(x-2,y-3,x,y-2),'gold3')
def rubble(d):
 for x,y,r in [(26,90,7),(35,92,9),(44,91,8),(52,93,6)]:
  poly(d,[(x-r,y),(x-r+2,y-r//2),(x,y-r),(x+r,y-r//2),(x+r,y+1),(x,y+3)],'slate1','ink');line(d,[(x-r+2,y-r//2),(x,y-r),(x+r-1,y-r//2)],'slate3')
def pot(d,plant=False):
 if plant:
  poly(d,[(30,85),(50,85),(47,94),(33,94)],'bark2','ink');rect(d,(29,83,50,86),'bark3','ink')
  for x,y in [(34,82),(41,82),(46,81)]:fern(d,x,y,'green4')
 else:
  for x,y in [(29,93),(46,92)]:rect(d,(x,y-9,x+3,y),'bark1')
  poly(d,[(28,78),(51,78),(49,91),(31,91)],'slate1','ink');ellipse(d,(26,74,53,81),'slate2','ink');ellipse(d,(29,75,50,79),'gold0');rect(d,(34,77,36,78),'green4');rect(d,(43,76,45,77),'red2')
  line(d,[(30,74),(27,69),(32,65),(46,65),(52,71),(49,75)],'slate3');line(d,[(33,81),(33,87)],'slate3');rect(d,(33,92,47,94),'red1')
def lamp(d,cryst=False):
 rect(d,(36,92,44,94),'slate2');rect(d,(39,72,41,91),'slate1');rect(d,(31,61,49,65),'slate1','ink');poly(d,[(31,65),(35,58),(45,58),(49,65)],'slate2','ink')
 rect(d,(33,66,47,79),'gold1' if not cryst else 'teal1','ink');rect(d,(36,67,44,77),'gold4' if not cryst else 'teal4');rect(d,(38,68,41,75),'cream' if not cryst else 'teal5');rect(d,(31,79,49,82),'slate2','ink');line(d,[(35,67),(35,77)],'slate3');line(d,[(45,67),(45,77)],'slate3')
def stool(d):
 for x in [31,44]:rect(d,(x,85,x+3,94),'bark1');rect(d,(x,86,x,93),'bark3')
 ellipse(d,(27,79,52,87),'bark2','ink');ellipse(d,(29,79,50,83),'bark3');line(d,[(30,81),(48,81)],'bark4')
def table(d):
 for x in [22,51]:rect(d,(x,79,x+4,94),'bark1');rect(d,(x,79,x,93),'bark3')
 poly(d,[(17,73),(44,65),(62,75),(36,84),(17,80)],'bark2','ink');poly(d,[(18,73),(44,66),(61,75),(36,81)],'bark3');line(d,[(22,73),(43,68),(56,75)],'bark4');line(d,[(29,76),(50,71)],'bark1');rect(d,(35,70,41,74),'gold1');rect(d,(36,69,40,72),'gold4')
def banner(d,kind='moss'):
 pal={'moss':['green1','green3','green5'],'crystal':['purple1','purple3','purple5'],'ember':['red1','red2','gold4']}[kind]
 rect(d,(38,42,40,95),'bark2');rect(d,(39,42,39,94),'bark4');rect(d,(27,47,53,49),'gold1');rect(d,(28,47,52,47),'gold3')
 poly(d,[(29,50),(51,50),(51,82),(40,88),(29,82)],pal[0],'ink');rect(d,(30,51,50,79),pal[1]);line(d,[(31,51),(31,80)],pal[2]);poly(d,[(36,64),(40,58),(44,64),(40,71)],pal[2]);rect(d,(34,94,45,95),'slate2')
def hearth(d,mini=False):
 ellipse(d,(7,70,72,95),'slate0','ink');ellipse(d,(9,65,70,87),'slate2','ink');ellipse(d,(16,67,63,81),'gold1');ellipse(d,(19,68,60,79),'ink')
 for x in [20,53]:
  rect(d,(x,41,x+7,72),'slate1','ink');rect(d,(x,42,x+2,70),'slate3');rect(d,(x-2,39,x+9,43),'gold1','ink');line(d,[(x-1,40),(x+8,40)],'gold3')
 poly(d,[(27,44),(32,26),(48,26),(54,44),(50,65),(32,65)],'red0','ink');poly(d,[(29,44),(35,28),(45,28),(51,44),(46,62),(34,62)],'gold1');poly(d,[(32,45),(40,30),(48,45),(43,59),(36,59)],'gold3');line(d,[(40,31),(40,55)],'cream',2)
 for a in range(0,360,45):
  x=40+int(math.cos(math.radians(a))*22);y=74+int(math.sin(math.radians(a))*6);rect(d,(x,y,x+2,y+1),'gold4')


FUNCS=[('tree',tree),('mushroom',mushrooms),('violet',lambda d:mushrooms(d,True)),('goldtree',lambda d:tree(d,True)),('copper',rock),('crystal',crystal),('ember',lambda d:rock(d,'ember')),('roots',roots),('workbench',workbench),('furnace',furnace),('chest',chest),('cabin',cabin),('altar',altar),('arch',arch),('farm',farm),('logs',logs),
 ('moss',herb),('grain',lambda d:herb(d,'grain')),('tuber',lambda d:herb(d,'tuber')),('pepper',lambda d:herb(d,'pepper')),('rubble',rubble),('cookpot',pot),('moss_pot',lambda d:pot(d,True)),('lamp_brass',lamp),('lamp_crystal',lambda d:lamp(d,True)),('stool',stool),('table',table),('banner_moss',banner),('banner_crystal',lambda d:banner(d,'crystal')),('banner_ember',lambda d:banner(d,'ember')),('hearth',hearth),('glowcap',glowcaps),('crystal_violet',lambda d:crystal(d,True))]
atlas=Image.new('RGBA',(320,math.ceil(len(FUNCS)/4)*96),(0,0,0,0));frames={}
for i,(name,fn) in enumerate(FUNCS):
 sprite=Image.new('RGBA',(80,96),(0,0,0,0));fn(ImageDraw.Draw(sprite))
 box=sprite.getbbox();x=i%4*80;y=i//4*96;atlas.paste(sprite,(x,y));frames[name]=[x+box[0],y+box[1],box[2]-box[0],box[3]-box[1]]
ROOT.mkdir(exist_ok=True,parents=True);atlas.save(ROOT/'pixel-atlas.png')
(ROOT/'pixel-atlas.json').write_text(json.dumps({'image':'pixel-atlas.png','width':atlas.width,'height':atlas.height,'palette':list(P.values()),'native_pixel_art':True,'sprites':frames},indent=2),encoding='utf-8')
colors=atlas.getcolors(100000);assert all(color[3] in (0,255) for count,color in colors)
assert len(colors)<=len(P)+1
print('Native pixel atlas:',atlas.size,'colors:',len(colors),'alpha: 0/255 only; no resampling')
