"""Pixel Workbenchの名前付き部品と.dot命令から、専用アセットを再生成する。"""
from pathlib import Path
import json, math, random, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
CLI = ROOT / 'Image/PixelWorkbench/pixelwork.py'
COLORS = {
 '0':'111c24','1':'1c2b2e','2':'243932','3':'304936','4':'3d5940','5':'527149','6':'71905a','7':'97ad71','8':'bbc791',
 '9':'263e49','A':'335766','B':'447b88','C':'63a7ae','D':'9ecbcc','E':'d3e3c6',
 'F':'312d30','G':'443831','H':'5b4735','I':'765937','J':'977142','K':'b18b53','L':'d1aa68','M':'edcd91',
 'N':'39434e','O':'505c67','P':'6c7b81','Q':'91a0a2','R':'c0cbbe',
 'S':'663e38','T':'895242','U':'b27450','V':'d69968','W':'edbc85',
 'X':'5a333d','Y':'853f4b','Z':'b25758','a':'d97b6a','b':'f1a78c',
 'c':'332d4b','d':'4d4167','e':'706086','f':'9c87aa','g':'c4afc8',
 'h':'235c57','i':'358778','j':'58b597','k':'91d8af','l':'d1eed2',
 'm':'785b25','n':'b08232','o':'d7aa4b','p':'f4cf6a','q':'fff0af',
 'r':'513426','s':'83512c','t':'b3783e','u':'df9a4c','v':'ffb954','w':'ffe58c',
 'x':'172c3e','y':'244356','z':'365f76','@':'52899c','+':'80b5c1',
}

class Sheet:
    def __init__(self, name, size, pivot):
        self.name,self.size,self.pivot=name,size,pivot
        self.lines=[f'canvas {size[0]} {size[1]}', f'pivot {pivot[0]} {pivot[1]}']
        self.lines += [f'palette {k} #{v}' for k,v in COLORS.items()]
        self.names=[]
        self.parts=set()
    def cmd(self,*args): self.lines.append(' '.join(map(str,args)))
    def part(self,name,w=None,h=None):
        if name in self.parts:self.cmd('edit',name)
        else:self.cmd('part',name,w or self.size[0],h or self.size[1]);self.parts.add(name)
    def frame(self,name,part=None,x=0,y=0,duration=140,tag='static'):
        self.cmd('frame',name,duration); self.cmd('tag',tag); self.cmd('place','sprite',part or name,x,y); self.names.append(name)
    def rect(self,x,y,w,h,c): self.cmd('rect',x,y,w,h,c)
    def ellipse(self,x,y,w,h,c): self.cmd('ellipse',x,y,w,h,c)
    def pixel(self,x,y,c): self.cmd('pixel',x,y,c)
    def poly(self,points,c): self.cmd('poly',*[v for p in points for v in p],c)
    def line(self,points,c): self.cmd('line',*[v for p in points for v in p],c)
    def export(self):
        folder=GAME/'art'; folder.mkdir(exist_ok=True)
        recipe=folder/(self.name+'.dot'); project=folder/(self.name+'.json')
        recipe.write_text('\n'.join(self.lines)+'\n',encoding='utf-8')
        for args in [('create',str(recipe),'-o',str(project)),('render',str(project),'-o',str(GAME/'assets'/self.name))]:
            result=subprocess.run([sys.executable,str(CLI),*args],capture_output=True,text=True,encoding='utf-8')
            if result.returncode: raise RuntimeError(result.stdout+result.stderr)
            print(result.stdout.strip())
        return {'image':f'{self.name}/atlas.png','atlas':f'{self.name}/atlas.json','pivot':list(self.pivot),'names':self.names}

def tiles():
    s=Sheet('tiles',(32,32),(0,0))
    for kind,base,shades in [('grass','4','34556'),('darkgrass','3','23445'),('dirt','I','HHIJK'),('sand','K','JKLLM'),('cave','N','9NOP'),('moss','2','12345'),('ruin','O','NOPQ'),('water','A','9AB'),('deepwater','y','xyzz'),('farmland','H','GHI'),('path','J','IJKL')]:
        for variant in range(4):
            rng=random.Random(f'{kind}{variant}')
            name=f'{kind}{variant}'; s.part(name); s.rect(0,0,32,32,base)
            if kind=='farmland':
                for y in range(3,32,6): s.rect(0,y,32,2,'G'); s.rect(0,y+2,32,1,'I')
            elif kind=='ruin':
                for y in [0,16]:
                    s.line([(0,y),(31,y)],'N')
                    for x in range(-8 if y else 0,32,16):
                        if x>=0: s.line([(x,y),(x,min(y+15,31))],'N')
            elif kind in ['water','deepwater']:
                for j in range(7):
                    x,y=rng.randrange(2,26),rng.randrange(2,30)
                    s.rect(x,y,rng.randrange(2,6),1,'B' if kind=='water' else 'z')
                    if j<2:s.pixel(x+2,y-1,'C' if kind=='water' else '@')
            else:
                for j in range(24 if kind in ['grass','darkgrass','moss'] else 43):
                    x,y=rng.randrange(32),rng.randrange(32)
                    s.rect(x,y,min(rng.choice([1,1,2,3]),32-x),1,rng.choice(shades))
                if kind in ['grass','darkgrass','moss']:
                    for j in range(4):
                        x,y=rng.randrange(3,29),rng.randrange(3,29)
                        s.line([(x-1,y),(x,y-2),(x+1,y)],'5' if kind=='moss' else '6')
            s.frame(name)
    # 接続境界のための透過草・岸辺。ゲーム側で回転して利用する。
    for kind,c,highlight in [('shore','K','M'),('grassedger','4','6')]:
        s.part(kind)
        for x in range(32):
            depth=3+round(2*math.sin(x*.6))
            s.rect(x,0,1,depth,c); s.pixel(x,depth,highlight)
        s.frame(kind)
    for position in range(9):
        name=f'roof{position}';s.part(name);s.rect(0,0,32,32,'S')
        for y in range(0,32,5):
            s.rect(0,y,32,1,'H');s.rect(0,min(y+1,31),32,1,'U');s.rect(0,min(y+2,31),32,2 if y<30 else 1,'T')
            for x in range(4 if (y//5)%2 else 0,32,8):s.rect(x,min(y+1,31),1,min(4,32-y-1),'S')
        if position%3==0:s.rect(0,0,2,32,'G');s.rect(2,0,1,32,'V')
        if position%3==2:s.rect(29,0,3,32,'G');s.rect(28,0,1,32,'U')
        if position<3:s.rect(0,0,32,2,'V');s.rect(0,2,32,1,'W')
        if position>=6:s.rect(0,29,32,1,'U');s.rect(0,30,32,2,'G')
        s.frame(name)
    return s.export()

def leaf_cluster(s,cx,cy,rw,rh,rng,pal=('2','3','4','5','6','7')):
    x,y=cx-rw//2,cy-rh//2
    s.poly([(x+rw//3,y),(x+rw-4,y+2),(x+rw,y+rh//2),(x+rw-3,y+rh-3),(x+rw//2,y+rh),(x+3,y+rh-3),(x,y+rh//2),(x+3,y+4)],pal[0])
    s.ellipse(x+2,y+1,rw-4,rh-4,pal[1]); s.ellipse(x+3,y+1,rw-8,rh-7,pal[2])
    s.ellipse(x+4,y+2,max(3,rw-12),max(3,rh-10),pal[3])
    for i in range(rw*rh//12):
        px,py=rng.randrange(x+3,x+rw-3),rng.randrange(y+2,y+rh-3)
        if ((px-cx)/(rw*.42))**2+((py-cy)/(rh*.4))**2<1:
            color=pal[4] if py<cy and rng.random()<.6 else rng.choice(pal[1:4])
            s.rect(px,py,rng.choice([1,2,3]),1,color)
            if color==pal[4] and rng.random()<.25:s.pixel(px,py-1,pal[5])

def tree(s,name,seed,pal=None,pine=False):
    r=random.Random(seed); s.part(name)
    s.line([(32,79),(41,72),(49,72),(62,79)],'1')
    s.poly([(42,76),(43,47),(51,47),(54,76),(60,80),(50,79),(45,77),(36,81)],'G')
    s.rect(45,47,5,29,'I'); s.rect(46,48,2,23,'K')
    s.line([(48,66),(37,49),(34,48)],'H'); s.line([(50,59),(59,43),(61,42)],'H')
    for y in range(50,74,5):s.rect(48,y,2,2,'H')
    if pine:
        for cx,cy,w,h in [(48,47,55,28),(47,35,46,28),(48,25,33,26),(48,13,18,22)]:leaf_cluster(s,cx,cy,w,h,r,pal or ('1','2','3','4','5','6'))
    else:
        for cx,cy,w,h in [(28,43,31,27),(67,41,29,29),(45,47,44,29),(32,29,35,27),(63,26,36,32),(46,23,43,34),(46,13,27,20)]:leaf_cluster(s,cx,cy,w,h,r,pal or ('2','3','4','5','6','7'))
    s.frame(name)

def rock(s,name,ore=None):
    s.part(name)
    s.poly([(31,76),(29,64),(35,52),(46,48),(60,54),(65,68),(62,77),(48,81)],'N')
    s.poly([(30,64),(38,53),(47,51),(55,55),(49,69),(34,72)],'P')
    s.poly([(48,51),(59,55),(63,65),(54,71),(47,69)],'O')
    s.line([(35,59),(43,55),(49,56)],'Q');s.line([(35,74),(45,72),(54,75)],'9')
    s.line([(46,56),(43,65),(47,70)],'N')
    s.rect(28,78,4,2,'3');s.rect(58,79,8,1,'4')
    if ore:
        dark,mid,bright=ore
        for x,y in [(37,59),(51,61),(43,72)]:
            s.poly([(x,y),(x+5,y-2),(x+7,y+3),(x+3,y+6),(x-2,y+4)],dark)
            s.rect(x,y,4,3,mid);s.rect(x,y,3,1,bright)
    s.frame(name)

def planks(s,x,y,w,h):
    s.rect(x,y,w,h,'G');s.rect(x+1,y+1,w-2,h-2,'I')
    for yy in range(y+3,y+h-1,5):
        s.rect(x+1,yy,w-2,1,'H')
        if w>4:s.rect(x+2,yy+1,w-4,1,'J')
    s.rect(x+2,y+1,1,h-2,'K')

def props():
    s=Sheet('props',(96,96),(48,80))
    tree(s,'oak',120);tree(s,'oak2',124);tree(s,'pine',125,pine=True);tree(s,'amber_tree',128,('G','H','I','n','o','p'))
    rock(s,'rock');rock(s,'copper',('r','t','V'));rock(s,'iron',('N','Q','R'));rock(s,'crystal',('h','j','l'))
    for name,color in [('berry','Z'),('bush','6'),('fern','j'),('flower','p')]:
        s.part(name);r=random.Random(name)
        for cx,cy in [(38,70),(54,69),(45,62)]:leaf_cluster(s,cx,cy,22,17,r)
        if name in ['berry','flower']:
            for x,y in [(35,68),(47,63),(58,70),(43,74)]:s.rect(x,y,3,3,color);s.pixel(x,y,'b' if name=='berry' else 'q')
        if name=='fern':
            for x in [34,42,50,58]:s.line([(x,77),(x-4,62),(x-8,60)],'6');s.line([(x-3,66),(x+3,62)],'7')
        s.frame(name)
    for stage in range(4):
        name=f'crop{stage}';s.part(name)
        if stage==0:s.line([(46,77),(46,72),(42,69)],'6');s.line([(46,74),(50,70)],'7')
        else:
            for x,y in [(39,77),(48,78),(55,77)]:
                top=y-(9+stage*5);s.line([(x,y),(x-1,top)],'6');s.line([(x-1,y-5),(x-6,y-9)],'7');s.line([(x-1,y-8),(x+4,y-12)],'5')
                s.ellipse(x-3,top,6,6,'o' if stage==3 else '7');s.rect(x-2,top,3,2,'q' if stage==3 else '8')
        s.frame(name)
    s.part('stump');s.ellipse(35,69,26,13,'G');s.rect(38,68,20,9,'H');s.ellipse(36,64,25,10,'K');s.ellipse(39,65,19,6,'L');s.line([(42,68),(46,66),(53,68),(48,70),(42,68)],'I');s.frame('stump')
    s.part('log');planks(s,28,69,39,9);s.ellipse(26,68,9,12,'K');s.ellipse(28,70,5,8,'M');s.frame('log')
    for name in ['workbench','table','chair','pot','chest','bed','furnace','campfire','lantern','torch','well','fence','gate','wall','house','ruin_arch','stairs','beacon','beacon_lit','mushroom','big_mushroom','altar','grave','sign','barrel','bridge','floor','carpet','flowers','crystal_cluster','reeds','loose_stones']:
        s.part(name)
        if name=='workbench':
            planks(s,31,57,5,22);planks(s,61,57,5,22);planks(s,27,54,43,11)
            s.rect(48,50,12,4,'N');s.rect(50,49,8,2,'Q');s.line([(36,55),(42,49),(44,50)],'L');s.rect(32,50,7,3,'P')
        elif name=='table':
            for x in [34,60]:planks(s,x,61,4,19)
            planks(s,31,56,36,11);s.ellipse(42,56,12,4,'M');s.ellipse(44,56,8,3,'I');s.rect(57,54,4,5,'P');s.rect(58,54,2,2,'R')
        elif name=='chair':
            for x in [39,55]:planks(s,x,57,3,23)
            planks(s,38,61,20,7);planks(s,39,48,19,12);s.rect(42,49,3,10,'K');s.rect(48,49,2,10,'G');s.rect(53,49,2,10,'G')
        elif name=='pot':
            for x,y in [(34,76),(57,76),(39,71),(52,71)]:s.ellipse(x,y,8,4,'O');s.rect(x+1,y,5,1,'Q')
            s.poly([(42,78),(40,72),(45,66),(47,69),(51,65),(55,73),(51,78)],'v');s.rect(46,72,4,5,'w')
            s.rect(35,51,3,26,'H');s.rect(60,51,3,26,'H');s.line([(35,52),(49,37),(63,52)],'I');s.line([(38,49),(59,49)],'N');s.line([(48,49),(48,58)],'P')
            s.ellipse(39,59,20,13,'N');s.ellipse(39,56,20,9,'P');s.ellipse(41,57,16,6,'H');s.rect(42,65,3,4,'Q');s.rect(55,64,2,4,'O');s.rect(45,57,3,2,'t');s.pixel(52,58,'7')
        elif name=='chest':
            planks(s,30,59,36,21);s.poly([(30,59),(35,52),(61,52),(66,59)],'J');s.line([(33,56),(62,56)],'L')
            for x in [35,59]:s.rect(x,55,3,24,'N');s.rect(x,55,1,22,'P')
            s.rect(46,64,5,7,'o');s.pixel(48,67,'G')
        elif name=='bed':
            planks(s,32,54,33,26);s.rect(34,57,29,20,'9');s.rect(34,59,29,13,'B');s.rect(35,59,27,2,'C');s.rect(35,54,26,6,'E');s.rect(35,54,26,1,'R');planks(s,31,49,3,32);planks(s,64,49,3,32)
        elif name=='furnace':
            s.poly([(31,77),(30,57),(37,49),(60,49),(67,57),(66,78)],'N');s.rect(33,55,31,22,'O')
            for y in [55,62,70]:s.line([(34,y),(63,y)],'P')
            s.rect(42,59,14,19,'0');s.rect(43,69,12,7,'s');s.rect(45,70,8,5,'v');s.rect(48,72,4,4,'w');s.rect(40,48,16,4,'Q')
        elif name=='campfire':
            for x,y in [(33,74),(39,69),(49,68),(58,72),(57,78),(39,79)]:s.ellipse(x,y,9,5,'O');s.rect(x+1,y,5,1,'Q')
            s.line([(38,75),(57,79)],'I');s.line([(39,80),(55,74)],'J');s.poly([(43,76),(41,67),(46,56),(48,64),(52,59),(57,70),(53,77)],'t');s.poly([(45,76),(45,65),(48,62),(53,71),(51,76)],'v');s.poly([(47,75),(49,67),(52,74)],'w')
        elif name in ['lantern','torch']:
            s.rect(47,56,3,24,'H');s.rect(47,56,1,22,'L');s.rect(40,75,16,4,'G')
            if name=='lantern':
                s.line([(47,58),(47,44),(57,44),(59,47)],'N');s.rect(52,47,12,3,'N');s.rect(53,50,10,15,'m');s.rect(55,51,6,11,'p');s.rect(56,52,3,8,'q');s.rect(52,64,12,3,'N')
            else:s.poly([(44,56),(43,48),(46,42),(47,46),(50,40),(52,51),(50,56)],'v');s.rect(47,48,3,6,'w')
        elif name=='well':
            s.ellipse(28,61,41,20,'N');s.ellipse(29,59,39,16,'P');s.ellipse(34,61,28,9,'0');s.ellipse(36,63,23,6,'A');planks(s,30,38,4,35);planks(s,64,38,4,35);s.poly([(26,40),(47,27),(71,40)],'H');s.poly([(29,39),(47,29),(67,39)],'J');s.line([(48,40),(48,64)],'L')
        elif name in ['fence','gate']:
            for x in [30,62]:planks(s,x,53,4,27);s.poly([(x,53),(x+2,49),(x+4,53)],'L')
            planks(s,29,60,38,4);planks(s,29,71,38,4)
            if name=='gate':s.line([(34,74),(61,58)],'K');s.rect(58,66,3,3,'P')
        elif name=='wall':
            planks(s,31,42,34,38)
            for x in range(33,65,7):s.rect(x,43,1,36,'G');s.rect(x+1,43,1,35,'J')
            s.rect(31,41,34,3,'K');s.rect(31,78,34,2,'G')
        elif name=='house':
            s.rect(19,43,59,37,'G');s.rect(22,45,53,32,'I');s.rect(23,49,51,1,'J');s.rect(23,60,51,1,'H');s.rect(23,70,51,1,'H')
            s.rect(44,55,15,25,'G');s.rect(47,57,10,23,'H');s.rect(49,58,1,20,'J');s.rect(54,68,2,2,'o')
            for x in [27,63]:s.rect(x,52,9,12,'G');s.rect(x+1,53,7,10,'n');s.rect(x+2,54,5,8,'p');s.rect(x+4,53,1,10,'H');s.rect(x+1,58,7,1,'H')
            s.poly([(12,47),(29,19),(69,19),(85,47)],'G');s.poly([(16,44),(31,22),(67,22),(81,44)],'S')
            for y in range(25,44,4):
                inset=(44-y)//2;s.rect(17+inset,y,64-2*inset,2,'T')
                for x in range(22+inset,78-inset,8):s.rect(x,y,1,3,'U')
            s.rect(31,20,38,2,'V');s.rect(64,14,9,18,'N');s.rect(63,13,11,4,'P');s.rect(20,77,57,3,'N');s.rect(45,80,16,3,'P')
        elif name=='ruin_arch':
            for x in [25,60]:s.rect(x,41,12,39,'N');s.rect(x+2,42,9,35,'P')
            s.poly([(25,48),(26,28),(38,19),(61,19),(72,29),(72,48),(60,44),(59,32),(37,32),(37,45)],'O')
            s.line([(29,32),(40,23),(59,23),(68,32)],'Q');s.rect(41,20,14,10,'P');s.rect(46,21,4,6,'j')
            for y in [47,59,71]:s.line([(26,y),(36,y)],'N');s.line([(61,y),(70,y)],'N')
            for x,y in [(24,67),(28,45),(64,54),(67,74)]:s.rect(x,y,4,5,'4');s.pixel(x,y,'6')
        elif name=='stairs':
            s.ellipse(27,56,43,27,'N');s.ellipse(30,57,37,24,'0')
            for j in range(5):s.rect(36+j*2,60+j*4,24-j*4,3,'O');s.rect(36+j*2,60+j*4,24-j*4,1,'P')
            s.rect(28,64,3,5,'j');s.rect(65,66,3,5,'j')
        elif name in ['beacon','beacon_lit','altar']:
            s.ellipse(23,68,50,15,'N');s.ellipse(25,66,46,12,'O');s.ellipse(32,65,32,8,'P')
            s.poly([(37,67),(37,41),(42,34),(53,34),(59,41),(59,67)],'N');s.rect(40,42,16,24,'O');s.rect(41,43,3,20,'Q')
            s.poly([(35,42),(42,29),(55,29),(62,42)],'P');s.poly([(39,40),(45,25),(50,21),(57,40),(49,45)],'h' if name!='beacon_lit' else 'i');s.poly([(43,39),(48,25),(50,24),(53,39),(49,42)],'j' if name!='beacon_lit' else 'k');s.line([(48,30),(47,38)],'l')
            for x,y in [(31,72),(63,72),(47,78)]:s.rect(x,y,4,2,'j' if name=='beacon_lit' else 'N')
        elif name in ['mushroom','big_mushroom']:
            big=name=='big_mushroom';x,y,w,h=(24,35,49,33) if big else (37,61,23,12)
            s.rect(44,y+h-4,8,80-y-h+4,'d');s.rect(46,y+h-4,3,80-y-h+4,'f');s.ellipse(x,y,w,h,'h');s.ellipse(x+1,y,w-3,h-4,'i');s.ellipse(x+3,y+1,w-9,h-8,'j')
            for xx,yy in [(x+7,y+5),(x+w//2,y+3),(x+w-9,y+8)]:s.rect(xx,yy,3,2,'k');s.pixel(xx,yy,'l')
            s.line([(x+3,y+h-4),(x+w-4,y+h-4)],'9')
        elif name=='grave':s.poly([(37,79),(36,63),(40,56),(55,56),(61,63),(60,79)],'N');s.rect(40,60,16,17,'O');s.rect(43,64,10,2,'P');s.rect(47,62,2,10,'P')
        elif name=='sign':planks(s,46,58,4,22);planks(s,30,47,36,17);s.line([(38,54),(57,54),(54,51)],'M');s.line([(57,54),(54,57)],'M')
        elif name=='barrel':
            s.ellipse(34,52,28,9,'L');s.rect(34,56,28,21,'I');s.ellipse(34,72,28,9,'H');s.rect(37,55,2,23,'K');s.rect(54,55,1,23,'H');s.rect(34,61,28,3,'N');s.rect(34,72,28,3,'N');s.ellipse(37,54,22,5,'J')
        elif name in ['bridge','floor']:
            planks(s,32,48,32,32)
            if name=='bridge':s.rect(32,49,2,30,'K');s.rect(62,49,2,30,'K')
        elif name=='carpet':s.rect(32,48,32,32,'X');s.rect(34,50,28,28,'Y');s.rect(36,52,24,24,'Z');s.poly([(48,57),(56,64),(48,71),(40,64)],'o')
        elif name=='flowers':
            for x,y,c in [(37,74,'p'),(47,69,'a'),(59,76,'p'),(51,77,'f')]:s.line([(x,y+3),(x,y-5)],'5');s.rect(x-2,y-6,5,3,c);s.pixel(x,y-5,'q')
        elif name=='crystal_cluster':
            for x,y,h in [(34,79,18),(44,79,32),(54,79,24),(62,78,15)]:s.poly([(x-4,y),(x-3,y-h+5),(x,y-h),(x+4,y-h+4),(x+5,y-3)],'h');s.poly([(x,y-h+2),(x+2,y-h+5),(x+2,y-4),(x-1,y-1)],'j');s.line([(x,y-h+4),(x,y-7)],'l')
        elif name=='reeds':
            for x,h in [(34,19),(40,27),(45,22),(51,32),(58,23),(62,16)]:
                s.line([(x,79),(x-1,79-h)],'5');s.line([(x,73),(x-7,67)],'6');s.line([(x,69),(x+5,61)],'7');s.rect(x-2,78-h,3,8,'I');s.rect(x-2,78-h,1,7,'L')
        elif name=='loose_stones':
            for x,y,w in [(34,76,9),(47,77,12),(59,75,6)]:s.ellipse(x,y,w,4,'N');s.ellipse(x+1,y,w-2,3,'P');s.pixel(x+2,y,'Q')
        s.frame(name)
    for boss in ['boss_moss_large','boss_crystal_large']:
        for i in range(4):
            name=f'{boss}{i}';s.part(name);b=1 if i%2 else 0
            if boss=='boss_moss_large':
                r=random.Random(428)
                for points in [[(42,66),(33,63),(19,74),(9,80),(18,79),(34,73),(45,76)],[(55,66),(68,66),(78,77),(86,81),(74,82),(63,75),(52,75)],[(41,64),(27,47),(21,51),(34,73)],[(56,63),(74,49),(79,54),(62,74)]]:
                    s.poly([(x,y+b)for x,y in points],'G');s.line([(x,y+b-1)for x,y in points[:3]],'I')
                s.poly([(31,76),(33,42),(40,30),(58,30),(66,44),(63,79),(53,84),(44,80),(36,83)],'G')
                s.poly([(36,76),(38,43),(45,34),(56,36),(62,48),(59,77),(50,80),(44,76)],'H')
                s.line([(40,40),(39,54),(43,62),(40,77)],'J');s.line([(53,38),(57,47),(54,61),(56,76)],'I');s.line([(49,47),(48,57),(51,63),(48,74)],'G')
                for cx,cy,w,h in [(23,40,28,24),(72,38,28,25),(36,24,31,29),(61,23,36,29),(48,13,32,25)]:leaf_cluster(s,cx,cy+b,w,h,r)
                s.poly([(32,49+b),(43,47+b),(45,51+b),(37,56+b),(32,54+b)],'2');s.poly([(53,51+b),(65,47+b),(65,55+b),(57,56+b)],'2')
                s.rect(36,51+b,7,3,'o');s.rect(38,51+b,4,2,'q');s.rect(55,51+b,7,3,'o');s.rect(56,51+b,4,2,'q')
                s.poly([(40,65+b),(47,61+b),(57,65+b),(54,70+b),(46,72+b),(40,68+b)],'0');s.rect(44,63+b,2,3,'K');s.rect(50,65+b,2,3,'K')
                for x,y in [(33,63),(59,71),(42,77),(29,72),(66,67)]:s.rect(x,y,5,3,'4');s.rect(x,y,3,1,'7')
                s.ellipse(16,67,7,5,'i');s.pixel(18,68,'k');s.ellipse(76,68,9,5,'i');s.pixel(78,69,'k')
            else:
                s.poly([(23,76),(24,59),(37,57),(41,72),(38,83),(24,83)],'N');s.poly([(57,58),(69,57),(75,74),(72,83),(57,83),(54,72)],'N')
                s.poly([(27,63),(35,63),(36,77),(28,80)],'P');s.poly([(60,62),(66,61),(71,76),(60,80)],'O')
                s.poly([(26,33+b),(36,25+b),(61,24+b),(72,35+b),(66,64),(53,73),(35,66)],'9');s.poly([(32,34+b),(41,29+b),(56,30+b),(65,39+b),(60,62),(50,67),(37,61)],'N')
                s.poly([(35,35+b),(44,31+b),(49,37+b),(44,57),(38,61)],'P');s.poly([(51,37+b),(58,32+b),(63,42+b),(57,61),(48,67)],'O')
                s.poly([(30,32+b),(19,27+b),(9,38+b),(12,55),(22,63),(31,55)],'N');s.poly([(66,32+b),(79,27+b),(88,39+b),(86,54),(75,62),(65,54)],'N')
                s.poly([(17,36+b),(22,31+b),(26,39+b),(22,56),(16,52)],'P');s.poly([(74,33+b),(81,34+b),(84,45),(79,55),(73,52)],'O')
                for x,y,h in [(15,35,21),(28,31,15),(69,30,19),(81,36,24)]:s.poly([(x-5,y),(x-3,y-h+4),(x,y-h),(x+4,y-h+5),(x+4,y-1)],'h');s.poly([(x,y-h+3),(x+2,y-h+6),(x+1,y-1)],'j');s.line([(x,y-h+6),(x,y-4)],'l')
                s.poly([(35,29+b),(36,16+b),(45,9+b),(58,14+b),(65,25+b),(57,38+b),(42,38+b)],'9');s.poly([(39,26+b),(40,18+b),(46,12+b),(55,17+b),(59,26+b),(54,32+b),(42,33+b)],'P')
                s.rect(40,24+b,7,4,'0');s.rect(53,24+b,7,4,'0');s.rect(41,25+b,5,2,'q');s.rect(54,25+b,5,2,'q');s.line([(47,33+b),(54,33+b)],'N')
                s.poly([(43,49),(48,42),(53,49),(48,57)],'h');s.poly([(46,49),(48,45),(50,49),(48,53)],'l')
                s.line([(34,57),(38,54),(39,58)],'j');s.line([(59,55),(56,58),(58,60)],'j')
            s.frame(name,duration=200,tag=boss)
    # 屋根の9分割タイルはtilesでなく独立したprops部品として保管。
    return s.export()

def hero_parts(s,direction):
    # 足、胴、頭、腕を共有し、歩行時に独立して動かす。
    s.part('boot',5,8);s.rect(1,0,3,5,'H');s.rect(0,4,5,4,'G');s.rect(1,4,3,1,'K')
    s.part('boot_stride',6,8);s.rect(1,0,3,4,'H');s.rect(1,4,4,2,'I');s.rect(0,6,6,2,'G');s.rect(2,6,3,1,'K')
    s.part('boot_lift',5,8);s.rect(0,0,5,8,'.');s.rect(1,1,3,3,'I');s.rect(0,3,5,3,'G');s.rect(1,3,3,1,'K')
    s.part('body_'+direction,14,14);s.poly([(2,0),(11,0),(13,4),(12,12),(8,13),(3,12),(0,4)],'9');s.rect(2,2,10,8,'B');s.rect(3,2,2,7,'C');s.rect(1,9,12,3,'H');s.rect(7,9,3,3,'o')
    if direction=='up':s.rect(3,2,8,7,'I');s.rect(4,2,6,1,'L');s.rect(3,6,8,2,'J')
    if direction in ['left','right']:
        s.rect(0,0,14,14,'.');s.poly([(4,0),(10,1),(12,5),(10,12),(4,13),(2,8),(2,3)],'9');s.rect(4,2,6,8,'B');s.rect(4 if direction=='left' else 8,2,2,7,'C');s.rect(3,10,8,2,'H');s.pixel(4 if direction=='left' else 9,10,'o')
    s.part('head_'+direction,16,15);s.poly([(3,3),(5,1),(11,1),(14,4),(14,11),(11,14),(5,14),(2,11),(2,6)],'G');s.rect(4,5,9,7,'V');s.rect(5,6,7,6,'W')
    if direction!='up':
        if direction=='down':s.pixel(6,8,'0');s.pixel(11,8,'0');s.rect(8,11,2,1,'U')
        else:s.pixel(11 if direction=='right' else 5,8,'0');s.pixel(12 if direction=='right' else 3,10,'W')
    else:s.rect(4,5,9,8,'H');s.rect(5,5,3,7,'J')
    s.poly([(1,4),(3,0),(11,0),(14,3),(15,5),(3,6)],'H');s.poly([(3,3),(4,0),(10,0),(13,3)],'K');s.rect(2,4,12,2,'I');s.rect(3,4,10,1,'L');s.rect(10,0,2,4,'4');s.pixel(11,0,'7')
    if direction in ['left','right']:
        s.rect(0,0,16,15,'.');s.poly([(4,2),(11,2),(12,5),(12,11),(9,14),(4,13),(3,9)],'G');s.rect(4,5,7,7,'V');s.rect(5,6,5,5,'W')
        right=direction=='right';s.rect(11 if right else 2,8,2,3,'W');s.pixel(10 if right else 4,7,'0');s.rect(4 if right else 9,5,2,7,'H');s.pixel(10 if right else 4,11,'U')
        s.poly([(2,4),(4,0),(10,0),(13,4)],'K');s.rect(1,4,14,2,'I');s.rect(2,4,12,1,'L');s.rect(5,0,5,1,'M');s.rect(4 if right else 10,0,2,4,'4');s.pixel(5 if right else 10,0,'7')
    s.part('arm',5,10);s.rect(1,0,4,6,'A');s.rect(1,1,1,5,'C');s.rect(1,6,3,3,'V');s.pixel(2,6,'W')
    s.part('scarf',14,5);s.poly([(0,0),(12,0),(13,2),(8,3),(4,2),(2,4),(0,4)],'S');s.rect(2,0,10,1,'a')

def actors():
    s=Sheet('actors',(32,48),(16,40))
    for d in ['down','up','left','right']:
        hero_parts(s,d)
        for mode,count in [('idle',2),('walk',4),('attack',3),('roll',3)]:
            for i in range(count):
                name=f'hero_{d}_{mode}{i}';s.cmd('frame',name,600 if mode=='idle' else 140 if mode!='attack' else 90);s.cmd('tag',f'hero_{d}_{mode}');s.names.append(name)
                bob=1 if mode in ['walk','idle'] and i%2 else 0
                stride=mode=='walk' and i in [1,3]
                s.cmd('place','legL','boot_stride' if stride and i==1 else 'boot_lift' if stride else 'boot',11-(1 if stride and i==1 else 0),32+(1 if stride and i==1 else -1 if stride else 0))
                s.cmd('place','legR','boot_stride' if stride and i==3 else 'boot_lift' if stride else 'boot',17+(1 if stride and i==3 else 0),32+(1 if stride and i==3 else -1 if stride else 0))
                s.cmd('place','body','body_'+d,9,21+bob);s.cmd('place','armL','arm',7,22+bob+(i%2 if mode=='walk' else 0));s.cmd('place','armR','arm',21,22+bob-(i%2 if mode=='walk' else 0))
                s.cmd('place','head','head_'+d,8,8+bob);s.cmd('place','scarf','scarf',9,21+bob)
                if d in ['left','right']:
                    s.cmd('pos','legL',12-(2 if stride and i==1 else 0),32)
                    s.cmd('pos','legR',16+(2 if stride and i==3 else 0),32)
                    s.cmd('pos','armL',12 if d=='right' else 16,22+bob+(2 if stride and i==1 else -1 if stride else 0))
                    s.cmd('pos','armR',17 if d=='right' else 10,22+bob+(-1 if stride and i==1 else 2 if stride else 0))
                if mode=='attack':s.cmd('pos','armR',22-i*3,18+i*2)
                if mode=='roll':s.cmd('pos','head',8,13+i%2);s.cmd('pos','body',9,25);s.cmd('pos','scarf',9,25)
    for kind in ['slime','beetle','wisp','shroom','boss_moss','boss_crystal','npc_builder','npc_gardener']:
        for i in range(4):
            name=f'{kind}{i}';s.part(name);b=i%2
            if kind=='slime':
                s.ellipse(4,26+b,24,14-b,'h');s.ellipse(5,24+b,22,13,'i');s.ellipse(7,25+b,13,6,'j');s.rect(8,26+b,5,2,'k');s.rect(11,32+b,2,3,'0');s.rect(20,32+b,2,3,'0');s.rect(15,36+b,4,1,'h')
            elif kind=='beetle':
                for x in [5,24]:
                    for j,y in enumerate([29,33,37]):s.line([(x,y),(x-3 if x==5 else x+3,y+2+(1 if (i+j)%2 else -1))],'G')
                s.ellipse(7,22+b,18,18,'F');s.ellipse(8,22+b,16,15,'T');s.ellipse(10,23+b,6,11,'U');s.line([(16,24+b),(16,36+b)],'S');s.rect(12,37,9,4,'H');s.pixel(13,38,'p');s.pixel(19,38,'p')
                s.rect(10,24+b,3,2,'V');s.pixel(22,31+b,'I');s.rect(18,25+b,2,6,'S')
            elif kind=='wisp':
                s.poly([(10,34-b),(6,30-b),(9,23-b),(15,16-b),(22,23-b),(26,31-b),(21,36-b),(17,39-b),(13,36-b)],'d');s.ellipse(9,23-b,14,12,'e');s.ellipse(11,24-b,10,8,'f');s.pixel(13,28-b,'l');s.pixel(19,28-b,'l');s.rect(14,32-b,5,2,'d')
            elif kind=='shroom':
                s.rect(12,29+b,9,10,'f');s.rect(11,37,5,3,'d');s.rect(18,37,5,3,'d');s.ellipse(5,18+b,24,16,'h');s.ellipse(6,18+b,22,11,'j');s.rect(10,21+b,4,2,'k');s.rect(20,23+b,3,2,'l');s.pixel(14,33+b,'0');s.pixel(19,33+b,'0')
            elif kind=='boss_moss':
                s.poly([(4,37),(3,26),(8,15+b),(14,10+b),(25,15+b),(30,28),(27,39),(21,40),(16,37),(10,40)],'2');s.ellipse(5,16+b,23,23,'4');s.rect(10,20+b,15,13,'5');s.rect(8,33,6,7,'H');s.rect(21,32,7,8,'H');s.rect(10,25+b,4,3,'p');s.rect(21,25+b,4,3,'p');s.rect(15,32+b,6,3,'2');s.line([(8,19),(4,11),(7,6)],'I');s.line([(23,17),(26,8),(23,4)],'I');s.rect(7,12,5,3,'6');s.rect(22,9,5,3,'7')
            elif kind=='boss_crystal':
                s.poly([(6,37),(3,24),(9,12+b),(16,5+b),(24,12+b),(30,25),(26,39),(16,35)],'c');s.poly([(7,24),(15,9+b),(22,14+b),(25,30),(16,35)],'i');s.poly([(16,10+b),(18,17+b),(17,30),(12,27)],'k');s.line([(14,16),(12,24)],'l');s.rect(10,28,4,2,'q');s.rect(20,28,4,2,'q');s.poly([(3,23),(0,17),(3,14),(7,20)],'j');s.poly([(26,21),(30,12),(31,22)],'j')
            else:
                s.rect(10,30,5,10,'H');s.rect(18,30,5,10,'H');s.rect(8,21+b,18,13,'T' if kind=='npc_builder' else '5');s.rect(10,23+b,4,7,'U' if kind=='npc_builder' else '7');s.rect(12,11+b,13,12,'V');s.rect(13,12+b,11,8,'W');s.rect(14,17+b,2,2,'0');s.rect(22,17+b,2,2,'0');s.rect(10,8+b,16,5,'J');s.rect(7,12+b,22,2,'L');s.rect(12,22+b,12,2,'H');s.rect(6,24+b,3,8,'V');s.rect(25,24+b,3,8,'V')
                s.rect(10,38,5,2,'G');s.rect(18,38,6,2,'G');s.rect(11,30,2,7,'I');s.rect(10,8+b,16,1,'G');s.rect(11,9+b,4,2,'L');s.rect(12,12+b,14,1,'I');s.rect(12,14+b,2,3,'H');s.rect(24,14+b,1,8,'H');s.rect(16,21+b,6,1,'U');s.rect(16,27+b,6,5,'I' if kind=='npc_builder' else 'H');s.pixel(17,28+b,'L');s.rect(9,23+b,1,9,'S' if kind=='npc_builder' else '3')
            s.frame(name,duration=160,tag=kind)
    return s.export()

def icons():
    s=Sheet('icons',(24,24),(12,12))
    names=['wood','stone','fiber','berry','mushroom','seed','wheat','carrot','copper_ore','iron_ore','crystal','coal','copper_bar','iron_bar','relic','glowspore','axe','pickaxe','sword','copper_axe','copper_pickaxe','copper_sword','iron_axe','iron_pickaxe','iron_sword','armor','copper_armor','iron_armor','torch','lantern','campfire','workbench','furnace','chest','bed','house','well','fence','gate','wall','floor','path','bridge','carpet','flowers','beacon','bread','stew','salad','fish','fishing_rod','water','coin','heart','food','map','journal','hammer','bag']
    for name in names:
        s.part(name)
        if 'axe' in name or 'pickaxe' in name or 'sword' in name or name in ['hammer','fishing_rod']:
            metal='U' if 'copper' in name else 'Q' if 'iron' in name else 'P'
            s.line([(5,20),(17,5)],'G');s.line([(6,20),(18,5)],'K')
            if 'sword' in name:s.poly([(9,15),(16,4),(19,2),(21,4),(19,8),(12,17)],metal);s.line([(12,13),(19,4)],'R');s.line([(6,12),(14,19)],'o')
            elif 'pick' in name:s.poly([(9,5),(13,2),(19,3),(22,8),(20,7),(16,5)],metal);s.line([(10,4),(15,3),(20,6)],'R')
            elif 'axe' in name:s.poly([(13,3),(20,4),(22,9),(17,12),(13,9)],metal);s.line([(21,6),(21,9),(18,11)],'R')
            elif name=='hammer':s.rect(11,3,11,7,'P');s.rect(12,3,9,2,'R')
            else:s.line([(18,4),(21,8),(20,18)],'E');s.pixel(20,19,'Z')
        elif 'armor' in name:
            col='T' if 'copper' in name else 'P' if 'iron' in name else 'I';s.poly([(5,4),(9,3),(12,7),(16,3),(20,5),(21,11),(17,12),(17,21),(7,21),(7,12),(3,11)],'G');s.rect(7,7,10,13,col);s.rect(8,7,3,10,'U' if 'copper' in name else 'Q' if 'iron' in name else 'K');s.rect(8,17,9,2,'H')
        elif name in ['wood','fiber']:
            if name=='wood':s.poly([(3,17),(15,4),(21,8),(9,21)],'H');s.poly([(5,16),(15,6),(18,8),(8,19)],'J');s.ellipse(3,15,7,7,'L');s.ellipse(5,17,3,3,'I');s.line([(10,16),(16,10)],'K')
            else:
                for x in [8,12,16]:s.line([(12,21),(x,7),(x+4,2)],'6');s.line([(x,9),(x-5,5)],'7')
                s.rect(9,15,7,3,'K')
        elif name in ['stone','copper_ore','iron_ore','coal']:
            s.poly([(3,18),(4,9),(10,4),(18,6),(22,15),(17,21),(8,22)],'N');s.poly([(5,10),(11,6),(16,7),(13,17),(5,17)],'P');s.poly([(16,7),(20,15),(16,19),(13,17)],'O')
            if name!='stone':
                for x,y in [(9,10),(15,15)]:s.rect(x,y,4,4,'t' if name=='copper_ore' else 'Q' if name=='iron_ore' else '0');s.pixel(x,y,'V' if name=='copper_ore' else 'R' if name=='iron_ore' else 'N')
        elif name in ['copper_bar','iron_bar']:
            s.poly([(3,17),(7,8),(19,6),(22,15),(17,20)],'S' if name=='copper_bar' else 'N');s.poly([(5,15),(8,9),(18,8),(20,14),(16,17)],'U' if name=='copper_bar' else 'Q');s.line([(8,9),(18,8)],'W' if name=='copper_bar' else 'R')
        elif name in ['crystal','relic','glowspore','beacon']:
            s.poly([(7,20),(4,10),(11,2),(18,5),(21,16),(13,22)],'h');s.poly([(7,11),(11,4),(14,5),(15,18),(12,20)],'j');s.line([(11,6),(9,13),(10,17)],'l')
            if name=='relic':s.rect(3,18,18,3,'o');s.rect(4,17,16,1,'q')
        elif name in ['berry','mushroom','seed','wheat','carrot','bread','stew','salad','fish','food']:
            if name=='berry':
                for x,y in [(5,10),(12,7),(13,15)]:s.ellipse(x,y,8,7,'Y');s.ellipse(x,y,6,5,'Z');s.pixel(x+1,y+1,'b')
                s.line([(8,10),(12,5),(18,5)],'6')
            elif name=='mushroom':s.rect(10,12,5,9,'f');s.ellipse(3,3,19,12,'i');s.ellipse(4,3,17,9,'j');s.rect(7,6,4,2,'l')
            elif name in ['wheat','seed']:
                for x in [8,12,16]:s.line([(11,21),(x,5)],'K');s.ellipse(x-2,4,5,9,'o');s.rect(x-1,5,2,3,'q')
            elif name=='carrot':s.poly([(4,20),(9,8),(18,6),(17,13)],'t');s.poly([(5,18),(11,9),(16,8),(12,13)],'v');s.line([(16,7),(15,2),(19,4),(21,1)],'6')
            elif name=='bread':s.ellipse(3,7,19,14,'I');s.ellipse(4,6,17,12,'o');s.line([(7,10),(9,8)],'M');s.line([(12,10),(14,8)],'M');s.line([(17,11),(18,9)],'M')
            elif name=='fish':s.poly([(3,13),(8,8),(15,8),(20,4),(19,11),(22,15),(17,16),(13,19),(6,17)],'A');s.ellipse(5,9,12,8,'C');s.pixel(7,12,'0');s.line([(12,11),(14,15)],'B')
            else:s.ellipse(3,9,19,12,'H');s.ellipse(3,7,19,8,'K');s.ellipse(5,8,15,5,'t' if name=='stew' else '5');s.rect(8,8,3,2,'7');s.rect(14,9,3,2,'v')
        elif name in ['torch','lantern','campfire']:
            s.line([(10,22),(12,10)],'K');s.poly([(8,13),(6,7),(10,1),(12,6),(16,3),(18,10),(14,16)],'t');s.poly([(10,12),(11,5),(15,10),(13,14)],'v');s.rect(11,9,2,4,'w')
        elif name=='heart':s.poly([(3,7),(6,4),(10,4),(12,7),(15,4),(19,4),(22,7),(21,13),(12,22),(3,13)],'Y');s.poly([(4,8),(7,5),(10,5),(12,8),(17,5),(20,8),(19,13),(12,19),(5,13)],'Z');s.rect(6,7,3,2,'b')
        elif name in ['coin','water']:s.ellipse(3,3,18,18,'n' if name=='coin' else 'A');s.ellipse(5,4,14,14,'p' if name=='coin' else 'C');s.line([(9,7),(7,10),(8,14)],'q' if name=='coin' else 'D')
        elif name in ['map','journal','bag']:
            s.rect(4,3,16,19,'H');s.rect(6,4,12,17,'M' if name!='bag' else 'J');s.rect(7,6,10,1,'K');s.line([(8,10),(14,8),(15,13),(10,16)],'I');s.rect(4,4,2,17,'J')
        else:
            # 家具アイコンは同じ木材・金属パレットでミニチュア化。
            s.rect(3,9,18,11,'G');s.rect(4,10,16,9,'I');s.rect(5,10,3,7,'K');s.rect(4,14,16,1,'H');s.rect(3,8,18,2,'L')
            if name in ['house','wall']:s.poly([(2,9),(11,2),(22,9)],'S');s.line([(4,8),(11,3),(20,8)],'U');s.rect(10,13,5,7,'G')
            if name in ['furnace','well']:s.rect(4,9,16,12,'O');s.rect(8,13,8,7,'0');s.rect(9,16,6,3,'v' if name=='furnace' else 'B')
            if name in ['fence','gate']:s.rect(6,2,2,20,'L');s.rect(17,2,2,20,'L');s.rect(6,5,13,3,'J');s.rect(6,13,13,3,'J')
            if name=='bed':s.rect(4,5,16,14,'B');s.rect(5,5,14,4,'E')
        s.frame(name)
    return s.export()

def main():
    manifest={'version':1,'tileSize':32,'sheets':{}}
    for name,fn in [('tiles',tiles),('props',props),('actors',actors),('icons',icons)]:manifest['sheets'][name]=fn()
    (GAME/'assets/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print('ALL',sum(len(v['names']) for v in manifest['sheets'].values()),'frames')

if __name__=='__main__':main()
