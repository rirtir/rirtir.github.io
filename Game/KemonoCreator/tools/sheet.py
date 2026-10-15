import sys
from PIL import Image
p=sys.argv[1]
ims=[Image.open(f'{p}_{n}.png').convert('RGB') for n in ['front','side','q34','back']]
w=sum(i.width for i in ims); h=max(i.height for i in ims)
s=Image.new('RGB',(w,h)); x=0
for i in ims: s.paste(i,(x,0)); x+=i.width
s.resize((w*2//3,h*2//3)).save(p+'_sheet_body.png')
ims=[Image.open(f'{p}_{n}.png').convert('RGB') for n in ['face','faceside']]
s=Image.new('RGB',(1400,700)); s.paste(ims[0],(0,0)); s.paste(ims[1],(700,0)); s.save(p+'_sheet_face.png')
