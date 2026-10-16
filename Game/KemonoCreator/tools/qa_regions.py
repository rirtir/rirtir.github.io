# 部位ごとの裏返り（ランダム組み合わせ）
import numpy as np, sys, qa_morphs as Q
from collections import Counter
meta,P,F,D=Q.load()
raw=open('../assets/body.bin','rb').read()
l=meta['layout']['skinIndex']; si=np.frombuffer(raw,dtype=np.uint8,count=int(np.prod(l['shape'])),offset=l['offset']).reshape(-1,4)
bones=[b['name'].split('.')[0] for b in meta['bones']]
fb=np.array([bones[si[f[0],0]] for f in F])
n0=Q.face_n(P,F); rng=np.random.default_rng(1); keys=list(meta['sliders'].keys())
cnt=Counter(); cases=Counter()
for t in range(200):
    vals={k: float(rng.uniform(-1,1)) if rng.random()<0.6 else 0.0 for k in keys}
    V=P+np.tensordot(Q.weights(meta,vals),D,axes=1)
    bad=np.sum(Q.face_n(V,F)*n0,axis=1)<=0
    for b in set(fb[bad]): cases[b]+=1
    for b in fb[bad]: cnt[b]+=1
print('flipped tris by region:', cnt.most_common())
print('cases (of 200) with flips in region:', cases.most_common())
