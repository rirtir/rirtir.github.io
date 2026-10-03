// PRISM — GLSL
export const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform vec2 uOrg;
uniform float uScale;
uniform float uTime;
uniform mat2 uRot;
vec4 toClip(vec2 w){ vec2 px=uOrg+uRot*(w*uScale); return vec4(px.x/uRes.x*2.-1., 1.-px.y/uRes.y*2., 0., 1.); }
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
`;

export const COMMONF = COMMON + `vec2 fragWorld(){ return transpose(uRot)*((vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y)-uOrg)/uScale); }
`;

export const FS_VERT = COMMON + `
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv = p; gl_Position = vec4(p*2.-1., 0., 1.);
}`;

// ---------- ビーム ----------
export const BEAM_VS = COMMON + `
uniform float uHalo;
in vec4 aSeg;
in vec4 aCol;
in vec4 aEx;
out vec2 vL; out vec2 vW; flat out float vLen; flat out vec3 vCol; flat out float vSig; flat out float vS0; flat out vec2 vFl;
void main(){
  vec2 p0=aSeg.xy, p1=aSeg.zw; vec2 d=p1-p0; float len=length(d);
  vec2 dir = len>1e-6 ? d/len : vec2(1.,0.); vec2 nrm=vec2(-dir.y,dir.x);
  vec2 c = vec2(float(gl_VertexID&1), float(gl_VertexID>>1))*2.-1.;
  float pad=uHalo;
  float u=(c.x*.5+.5)*(len+2.*pad)-pad;
  float v=c.y*pad;
  vec2 w=p0+dir*u+nrm*v;
  vL=vec2(u,v); vW=w; vLen=len; vCol=aCol.rgb; vSig=aCol.a; vS0=aEx.x; vFl=aEx.yz;
  gl_Position=toClip(w);
}`;
export const BEAM_FS = COMMONF + `
uniform float uHalo; uniform float uReveal;
in vec2 vL; in vec2 vW; flat in float vLen; flat in vec3 vCol; flat in float vSig; flat in float vS0; flat in vec2 vFl;
out vec4 o;
void main(){
  float du = vL.x - clamp(vL.x, 0., vLen);
  if (vL.x < 0. && vFl.x > .5) du = 1e3;
  if (vL.x > vLen && vFl.y > .5) du = 1e3;
  float d = length(vec2(du, vL.y));
  float s = vSig;
  float core = exp(-0.5*d*d/(s*s));
  float mid = exp(-d/(s*2.0))*0.07;
  float n = fbm(vW*2.4 + vec2(uTime*0.07, -uTime*0.05));
  float fade = 1.-smoothstep(uHalo*.25, uHalo, d);
  float halo = exp(-d/(s*5.))*0.035*(0.3+1.4*n)*fade;
  float shimmer = 0.94+0.06*sin(vL.x*5.-uTime*6.+vW.y*3.);
  vec3 c = vCol*(core+mid+halo)*shimmer;
  float lum = max(vCol.r,max(vCol.g,vCol.b));
  c += vec3(1.)*lum*0.5*pow(core,5.)*smoothstep(0.4,2.5,lum);
  float sPos = vS0 + clamp(vL.x, 0., vLen);
  float rv = 1. - smoothstep(uReveal-0.35, uReveal, sPos);
  float head = exp(-pow((sPos-uReveal+0.1)/0.22,2.))*step(sPos,uReveal+0.2)*1.6;
  c = c*rv + vec3(1.,.97,.9)*lum*0.0 + c*head*(1.-rv)*0.0 + vCol*exp(-d/(s*1.5))*head*0.9;
  o = vec4(c, 1.);
}`;

// ---------- スプライト（フレア・火花・リング） ----------
export const SPR_VS = COMMON + `
in vec4 aPos;   // x,y,size,type
in vec4 aCol;   // rgb, alpha
in vec2 aEx;    // rot, param
out vec2 vQ; flat out vec4 vCol; flat out vec4 vInfo; flat out vec2 vEx;
void main(){
  vec2 c = vec2(float(gl_VertexID&1), float(gl_VertexID>>1))*2.-1.;
  vQ=c; vCol=aCol; vInfo=aPos; vEx=aEx;
  float cs=cos(aEx.x), sn=sin(aEx.x);
  vec2 q=vec2(c.x*cs-c.y*sn, c.x*sn+c.y*cs)*aPos.z;
  gl_Position=toClip(aPos.xy+q);
}`;
export const SPR_FS = COMMONF + `
in vec2 vQ; flat in vec4 vCol; flat in vec4 vInfo; flat in vec2 vEx;
out vec4 o;
void main(){
  float t = vInfo.w; float r = length(vQ); float v=0.;
  if(t<0.5){ v = exp(-4.*r*r) ; }
  else if(t<1.5){ float rr=vEx.y; float w=0.07+0.1*(1.-rr); v = exp(-pow((r-0.82)/w,2.)); v*=(1.-smoothstep(0.7,1.,r)*0.0); }
  else if(t<2.5){ vec2 a=abs(vQ); v = exp(-6.*r*r)*1.2 + exp(-a.y*28.-a.x*2.2)*0.9 + exp(-a.x*28.-a.y*2.2)*0.55; }
  else if(t<3.5){ vec2 a=abs(vQ); v = exp(-a.y*40.-a.x*3.)+exp(-a.x*40.-a.y*3.)+exp(-9.*r*r); }
  else { v = exp(-2.5*r*r) * (1.-smoothstep(0.85,1.,r)); }
  if(r>1.) v=0.;
  o = vec4(vCol.rgb*vCol.a*v, 1.);
}`;

// ---------- 背景 ----------
export const BG_FS = COMMONF + `
in vec2 vUv;
uniform sampler2D uBloom;
uniform vec2 uBoard;
uniform float uTray;
uniform float uWinGlow; uniform float uArt;
uniform vec4 uWells[6]; uniform int uNW;
out vec4 o;
float sdRBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
void main(){
  vec2 w = fragWorld();
  vec2 uv = vec2(gl_FragCoord.x/uRes.x, gl_FragCoord.y/uRes.y);
  vec3 glow = textureLod(uBloom, uv, 0.).rgb;
  vec2 ctr = w - uBoard*0.5;
  float dB = sdRBox(ctr, uBoard*0.5, 0.25);
  // 盤外
  float rr = length((gl_FragCoord.xy/uRes - .5)*vec2(uRes.x/uRes.y,1.));
  vec3 col = mix(vec3(0.020,0.026,0.05), vec3(0.005,0.006,0.014), smoothstep(0.1,0.9,rr));
  float neb = fbm(w*0.18 + vec2(uTime*0.004, 0.));
  col += vec3(0.02,0.012,0.04)*neb*neb*1.4*smoothstep(-1.,2.,dB);
  // 盤上（黒い鏡面板）
  float inside = 1.-smoothstep(-0.02,0.02,dB);
  vec3 plate = mix(vec3(0.030,0.040,0.072), vec3(0.012,0.016,0.034), clamp(length(ctr)/10.,0.,1.));
  plate += vec3(0.01,0.012,0.02)*fbm(w*1.3);
  // ドットグリッド（光に反応）
  vec2 wg = w;
  for(int i=0;i<6;i++){ if(i>=uNW) break; vec2 dv=uWells[i].xy-w; float r2=dot(dv,dv); float rr_=sqrt(r2); float q=smoothstep(5.5,0.,rr_); wg += dv*clamp(uWells[i].z*0.35/(r2+0.15),-.9,.9)*q; }
  vec2 gp = fract(wg+0.5)-0.5;
  float dot_ = smoothstep(0.045,0.02,length(gp));
  float lines = max(smoothstep(0.012,0.,abs(gp.x)), smoothstep(0.012,0.,abs(gp.y)))*0.25;
  float gl = dot(glow, vec3(0.3,0.5,0.2));
  vec3 gcol = glow/(0.05+gl)*1.0;
  plate += vec3(0.07,0.09,0.15)*dot_*0.8 + vec3(0.03,0.04,0.07)*lines;
  plate += (dot_*1.2+lines*0.7) * glow * 3.0;
  plate += glow*0.10;
  // ストック置き場
  float tray = smoothstep(uTray-0.02, uTray+0.02, w.y)*(1.-uArt);
  float dash = step(0.5, fract(w.x*2.5));
  float trayEdge = exp(-abs(w.y-uTray)*60.)*(0.35+0.65*dash)*(1.-uArt);
  plate = mix(plate, plate*1.35+vec3(0.006,0.008,0.016), tray);
  plate += vec3(0.10,0.14,0.22)*trayEdge*0.6;
  col = mix(col, plate, inside);
  // 外枠
  float edge = exp(-abs(dB)*90.)*(1.-.75*uArt);
  float edgeSoft = exp(-abs(dB)*10.)*0.06;
  vec3 ec = vec3(0.30,0.40,0.62)*edge*0.55 + vec3(0.2,0.3,0.6)*edgeSoft;
  // 光に反応する外枠
  ec += glow*edge*4.;
  col += ec;
  col += vec3(1.,.95,.8)*uWinGlow*0.012*inside;
  o = vec4(col,1.);
}`;

// ---------- 要素 ----------
export const ELEM_VS = COMMON + `
in vec4 aA;   // x,y,a,type
in vec4 aP;   // params
in vec4 aC;   // tint rgb, state
in vec4 aS;   // sel, hover, locked, extra
out vec2 vP; flat out vec4 fA; flat out vec4 fP; flat out vec4 fC; flat out vec4 fS;
void main(){
  float t=aA.w; float R;
  if(t==9.) R=aP.x*3.2+0.6;
  else if(t==8.) R=aP.x*3.8+0.6;
  else if(t<2.5) R=aP.x*0.5+0.36;
  else if(t<3.5) R=aP.x+0.4;
  else if(t==4. || t==6.) R=length(aP.xy)*0.5+0.4;
  else R=aP.x+0.4;
  vec2 c = vec2(float(gl_VertexID&1), float(gl_VertexID>>1))*2.-1.;
  vec2 off=c*R;
  vP=off; fA=aA; fP=aP; fC=aC; fS=aS;
  gl_Position=toClip(aA.xy+off);
}`;
export const ELEM_FS = COMMONF + `
in vec2 vP; flat in vec4 fA; flat in vec4 fP; flat in vec4 fC; flat in vec4 fS;
uniform vec3 uNorm;
out vec4 o;

vec3 nm2rgb(float l){
  float x = 1.056*exp(-.5*pow((l-599.8)/(l<599.8?37.9:31.0),2.)) + .362*exp(-.5*pow((l-442.0)/(l<442.0?16.0:26.7),2.)) - .065*exp(-.5*pow((l-501.1)/(l<501.1?20.4:26.2),2.));
  float y = .821*exp(-.5*pow((l-568.8)/(l<568.8?46.9:40.5),2.)) + .286*exp(-.5*pow((l-530.9)/(l<530.9?16.3:31.1),2.));
  float z = 1.217*exp(-.5*pow((l-437.0)/(l<437.0?11.8:36.0),2.)) + .681*exp(-.5*pow((l-459.0)/(l<459.0?26.0:13.8),2.));
  vec3 c = vec3(3.2406*x-1.5372*y-.4986*z, -.9689*x+1.8758*y+.0415*z, .0557*x-.2040*y+1.0570*z);
  return max(c,0.)/uNorm;
}
vec3 rainbow(float t){ return .5+.5*cos(6.2832*(t+vec3(0.,.33,.67))); }
float sdBox(vec2 p, vec2 b){ vec2 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,q.y),0.); }
float sdTri(vec2 p,float r){ float h=r*.5; return max(p.y-h, max(dot(p,vec2(.866025,-.5))-h, dot(p,vec2(-.866025,-.5))-h)); }
float sdCap(vec2 p,float hl,float th){ p.x=abs(p.x)-hl; vec2 q=vec2(max(p.x,0.),p.y); return length(q)-th; }
float capTh(float t){ return t<.5 ? .05 : (t<1.5 ? .065 : .085); }
float sdElem(float t, vec2 p){
  if(t<2.5) return sdCap(p, fP.x*.5, capTh(t));
  if(t<3.5) return sdTri(p, fP.x) - 0.0;
  if(t==4. || t==6.) return sdBox(p, fP.xy*.5-.05)-.05;
  return length(p)-fP.x;
}

vec4 glass(float d, vec3 tint, float bevelW, float alpha, float metal){
  vec2 g = vec2(dFdx(d), -dFdy(d)); float glen=length(g); g = glen>1e-7 ? g/glen : vec2(0.);
  float aa = max(fwidth(d)*.8, 1e-4);
  float cov = 1.-smoothstep(-aa,aa,d);
  float depth = clamp(-d/bevelW, 0., 1.);
  float bv = 1.-depth; bv=bv*bv*(3.-2.*bv);
  vec3 n = normalize(vec3(g*bv*1.35, .75));
  vec3 L1 = normalize(vec3(-.45,-.7,.62));
  vec3 L2 = normalize(vec3(.65,.5,.5));
  vec3 V = vec3(0.,0.,1.);
  float s1 = pow(max(dot(n,normalize(L1+V)),0.), 70.);
  float s2 = pow(max(dot(n,normalize(L2+V)),0.), 28.);
  float rim = pow(1.-max(n.z,0.), 2.2);
  vec3 base = vec3(.022,.034,.055) + tint*.07;
  base = mix(base, vec3(.45,.5,.6)*(.5+.5*n.z)*(.4+.6*smoothstep(0.,1.,n.y*-.5+.6)), metal);
  vec3 col = base*(.6+.4*depth);
  col += s1*vec3(1.5,1.6,1.8)*(.7+.6*metal) + s2*vec3(.22,.38,.7)*(.6+.8*metal);
  float ang = atan(g.y,g.x)/6.2832;
  col += rim*(vec3(.14,.2,.3)+.55*rainbow(ang)*(1.-metal*.6))*.9;
  float hair = exp(-abs(d)/.0065);
  col += hair*vec3(.7,.85,1.)*(.8+metal*.8);
  float a = cov*(alpha + bv*.35 + metal*.5);
  return vec4(col*cov, clamp(a,0.,1.));
}

void main(){
  float t = fA.w;
  float cs=cos(fA.z), sn=sin(fA.z);
  vec2 p = vec2(cs*vP.x+sn*vP.y, -sn*vP.x+cs*vP.y);
  float d = sdElem(t, p);
  // 影
  vec2 so = vec2(.07,.11);
  vec2 ps = vec2(cs*(vP.x-so.x)+sn*(vP.y-so.y), -sn*(vP.x-so.x)+cs*(vP.y-so.y));
  float ds = sdElem(t, ps);
  float shadow = exp(-max(ds,0.)*12.)*.5*(1.-smoothstep(-.02,.02,ds)*0.0);
  if(t==8.) shadow *= .6;
  vec4 body = vec4(0.);
  vec3 add = vec3(0.);
  float locked = fS.z;

  if(t<2.5){
    float hl=fP.x*.5; float th=capTh(t);
    if(t<.5){ body = glass(d, vec3(.5), th*1.1, .9, 1.); }
    else if(t<1.5){ body = glass(d, vec3(.2,.5,.9), th*1.1, .55, .6);
      float dash = step(.5, fract(p.x*7.)); body.rgb += vec3(.08,.2,.4)*dash*smoothstep(0.,-.03,d)*.6; }
    else { vec3 tn = fC.rgb; body = glass(d, tn*2.2, th*1.2, .6, .15);
      body.rgb += tn*.9*smoothstep(0.,-th*1.4,d)*(.55+.1*sin(uTime*1.7+p.x*3.)); body.a=max(body.a,.7*smoothstep(.01,-.01,d)); }
    // 中心の軸
    float dc = length(p)-.075;
    float cov = 1.-smoothstep(-.006,.006,dc);
    vec3 pin = locked>.5 ? vec3(.12,.13,.16) : vec3(.9,.95,1.)*.5;
    body.rgb = mix(body.rgb, pin*cov+body.rgb*(1.-cov), cov);
    // 固定のリベット
    if(locked>.5){
      float rv = min(length(p-vec2(hl-.1,0.)), length(p+vec2(hl-.1,0.)))-.022;
      body.rgb = mix(body.rgb, vec3(.03,.035,.05), (1.-smoothstep(-.005,.005,rv))*step(d,-.0));
    }
  } else if(t<3.5){
    body = glass(d, vec3(.4,.6,1.), fP.x*.28, .5, 0.);
    // 内部の屈折っぽい色むら
    float inside = smoothstep(.0,-.05,d);
    float fr = fbm(p*2.5+vec2(uTime*.05));
    body.rgb += rainbow(p.y*1.3+p.x*.5+.2)*.045*inside*(.6+fr);
    if(locked>.5) body.rgb *= .8;
  } else if(t==4.){
    body = glass(d, vec3(.4,.6,1.), .2, .5, 0.);
    float inside = smoothstep(.0,-.05,d);
    body.rgb += rainbow(p.x*.9+.1)*.04*inside;
  } else if(t==5.){
    float r=fP.x;
    body = glass(d, vec3(.4,.6,1.), r*.55, .45, 0.);
    float inside = smoothstep(.0,-.05,d);
    // 玉の中の屈折ハイライト
    vec2 q = vP/r;
    float hl1 = exp(-pow(length(q-vec2(-.35,-.4))/.22,2.));
    float caus = exp(-pow((length(q-vec2(.18,.22))-.5)/.12,2.));
    body.rgb += vec3(1.,1.05,1.2)*hl1*.55*inside + rainbow(atan(q.y,q.x)/6.2832+.2)*caus*.18*inside;
    if(locked>.5) body.rgb *= .8;
  } else if(t==6.){
    // 壁（光を吸収するブロック）
    vec2 gp = d<0. ? p : p;
    body = glass(d, vec3(.1), .14, .98, .35);
    float stripes = step(.5, fract((p.x+p.y)*3.2));
    float inside = smoothstep(.0,-.02,d);
    body.rgb = body.rgb*.6 + vec3(.035,.04,.055)*(.6+.5*stripes)*inside;
    body.a = max(body.a, .97*inside);
  } else if(t==7.){
    float r=fP.x*1.3;
    float dBody = sdBox(p-vec2(-.1*r,0.), vec2(.78*r,.62*r)-.16*r)-.16*r;
    float dNoz = sdBox(p-vec2(.72*r,0.), vec2(.2*r,.3*r)-.05*r)-.05*r;
    float d2 = min(dBody, dNoz);
    body = glass(d2, vec3(.1), r*.42, .98, .22); body.rgb *= .75;
    float inside = smoothstep(.0,-.02,d2);
    vec3 lc = fC.rgb;
    // 発光する口
    vec2 ap = p - vec2(r*.98,0.);
    float apd = length(ap*vec2(1.,1.4));
    add += lc*(exp(-pow(apd/.06,2.))*10. + exp(-apd*9.)*1.1);
    // 本体のカラーライン
    float strip = smoothstep(.03,.0,abs(p.y-r*.36))*step(-.55*r,p.x)*step(p.x,.5*r)*inside;
    body.rgb += lc*strip*1.1;
    // 中央の溝
    float groove = exp(-pow((p.y+.1*r)/.018,2.))*step(-.5*r,p.x)*inside;
    body.rgb = mix(body.rgb, vec3(.02,.025,.035), groove*.6);
    // 後部のレンズ
    float lens = length(p+vec2(r*.56,0.))-.22*r;
    float lc2 = 1.-smoothstep(-.01,.012,lens);
    body.rgb = mix(body.rgb, vec3(.04,.05,.08), lc2*.8*inside);
    body.rgb += lc*exp(-pow(length(p+vec2(r*.56,0.))/(.1*r),2.))*1.8*inside;
    float seam = exp(-pow((p.x-r*.34)/.012,2.))*inside;
    body.rgb += vec3(.5,.6,.8)*seam*.22;
  } else if(t==9.){
    float r=fP.x; float k=fP.y; float dd=length(p);
    float ang=atan(p.y,p.x);
    if(k>0.){
      float disk = 1.-smoothstep(r-.015,r+.015,dd);
      body = vec4(vec3(0.),disk);
      float ring = exp(-pow((dd-r*1.22)/(r*.10),2.));
      float dop = .45+.55*(.5+.5*cos(ang-.8));
      float swirl = .55+.45*sin(ang*2.-dd*9.+uTime*1.8);
      add += vec3(1.,.62,.28)*ring*(1.2+2.2*dop)*swirl;
      add += vec3(1.,.5,.2)*exp(-(dd-r)*4.)*(1.-disk)*.3*(.6+.4*swirl);
      add += vec3(.6,.7,1.)*exp(-pow((dd-r*1.04)/(r*.03),2.))*.9;
      add += vec3(.55,.65,1.)*exp(-pow((dd-r*2.05)/(r*.05),2.))*(.18+.12*sin(ang*5.+uTime));
      add += vec3(.5,.6,1.)*exp(-pow((dd-r*2.9)/(r*.04),2.))*.08;
    } else {
      body = vec4(0.);
      float core = exp(-dd*dd/(r*r*.45));
      float pulse = .5+.5*sin(dd*14.-uTime*3.);
      add += vec3(.65,.85,1.)*(core*2.6 + exp(-(dd-r*.9)*4.)*(1.-core)*.5*pulse*step(dd,r*3.));
      float ring2 = exp(-pow((dd-r*1.05)/(r*.06),2.));
      add += vec3(.8,.9,1.)*ring2*1.2;
    }
  } else {
    // 受光器
    float r=fP.x;
    float fill=fC.w, charge=fS.w, bad=fS.x;
    float dd = length(p);
    body = glass(d, vec3(.2), r*.45, .85, .1);
    float inside=smoothstep(.0,-.02,d);
    float ang = atan(p.y,p.x)/6.2832+.5;
    float tri = abs(ang*2.-1.);
    float lam = mix(fP.y, fP.z, tri);
    vec3 bc = nm2rgb(lam);
    float bandR = abs(dd-(r-.065));
    float ring = exp(-pow(bandR/.038,2.));
    float lit = .22 + .9*fill + 1.4*charge;
    add += bc*ring*lit*1.1;
    // 中央の充填
    vec3 meanC = fC.rgb;
    float cr = r*.62;
    float core = smoothstep(cr,cr*.2,dd);
    float pulse = .85+.15*sin(uTime*7.);
    add += meanC*core*fill*(1.6+charge*2.)*pulse*inside;
    add += vec3(1.,.97,.9)*exp(-pow(dd/(r*.28),2.))*charge*3.*inside;
    add += meanC*exp(-max(d,0.)*7.)*charge*.7*(1.-inside);
    // 受光器の十字照準
    float cross_ = max(exp(-abs(p.x)*90.)*step(abs(p.y),r*.5), exp(-abs(p.y)*90.)*step(abs(p.x),r*.5));
    add += vec3(.25,.35,.5)*cross_*.18*(1.-fill)*inside;
    // 混入色の警告
    float bw = exp(-pow((dd-(r+.045))/.016,2.));
    add += vec3(1.,.25,.15)*bw*bad*(.5+.5*sin(uTime*14.))*1.6;
  }
  // 選択・ホバーの発光
  float sel=fS.x*0.; // 選択表示はオーバーレイで行う
  float hov=fS.y;
  float rimGlow = exp(-max(d,0.)*(t==8.?14.:22.));
  add += vec3(.35,.6,1.)*rimGlow*hov*.5*step(t,6.5);
  // 合成（premultiplied over）
  float sh = shadow*(1.-body.a);
  vec3 rgb = body.rgb + add*step(.0,1.) ;
  float a = body.a + sh*0.0;
  // 影は黒の乗算（アルファ付きの黒）
  float alphaOut = clamp(a + sh, 0., 1.);
  o = vec4(rgb, alphaOut);
}`;

// ---------- 塵 ----------
export const MOTE_VS = COMMON + `
in vec4 aM; // x,y,size,phase
uniform sampler2D uEmit;
uniform sampler2D uBloom;
out vec2 vQ; flat out vec3 vC; flat out float vA;
void main(){
  vec2 c = vec2(float(gl_VertexID&1), float(gl_VertexID>>1))*2.-1.;
  vec2 wp = aM.xy;
  vec2 px = uOrg + uRot*(wp*uScale);
  vec2 uv = vec2(px.x/uRes.x, 1.-px.y/uRes.y);
  vec3 e = textureLod(uEmit, uv, 0.).rgb;
  vec3 b = textureLod(uBloom, uv, 0.).rgb;
  vec3 L = e*.9 + b*1.5;
  float tw = .6+.4*sin(uTime*(1.5+aM.w)+aM.w*40.);
  vC = L*tw*(1.+3.*aM.w);
  vA = 1.;
  vQ = c;
  float s = aM.z*(1.+min(dot(L,vec3(.3,.5,.2)),2.)*.6);
  gl_Position = toClip(wp + c*s);
}`;
export const MOTE_FS = COMMONF + `
in vec2 vQ; flat in vec3 vC; flat in float vA;
out vec4 o;
void main(){ float r=length(vQ); float v=exp(-3.5*r*r)*(1.-smoothstep(.8,1.,r)); o=vec4(vC*v*.55 + vec3(.02,.03,.05)*v*.4,1.); }`;

// ---------- ブルーム ----------
export const DOWN_FS = COMMONF + `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uFirst;
out vec4 o;
vec3 s(vec2 uv){ return texture(uTex, uv).rgb; }
void main(){
  vec2 t=uTexel; vec2 uv=vUv;
  vec3 a=s(uv+t*vec2(-2,-2)), b=s(uv+t*vec2(0,-2)), c=s(uv+t*vec2(2,-2));
  vec3 d=s(uv+t*vec2(-2,0)), e=s(uv), f=s(uv+t*vec2(2,0));
  vec3 g=s(uv+t*vec2(-2,2)), h=s(uv+t*vec2(0,2)), i=s(uv+t*vec2(2,2));
  vec3 j=s(uv+t*vec2(-1,-1)), k=s(uv+t*vec2(1,-1)), l=s(uv+t*vec2(-1,1)), m=s(uv+t*vec2(1,1));
  vec3 r = e*.125 + (a+c+g+i)*.03125 + (b+d+f+h)*.0625 + (j+k+l+m)*.125;
  if(uFirst>.5){ float lum=dot(r,vec3(.3,.5,.2)); r *= 1./(1.+lum*.06); }
  o = vec4(r,1.);
}`;
export const UP_FS = COMMONF + `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uW;
out vec4 o;
void main(){
  vec2 t=uTexel; vec2 uv=vUv;
  vec3 r = texture(uTex, uv).rgb*4.;
  r += texture(uTex, uv+t*vec2(-1,0)).rgb*2. + texture(uTex, uv+t*vec2(1,0)).rgb*2. + texture(uTex, uv+t*vec2(0,-1)).rgb*2. + texture(uTex, uv+t*vec2(0,1)).rgb*2.;
  r += texture(uTex, uv+t*vec2(-1,-1)).rgb + texture(uTex, uv+t*vec2(1,-1)).rgb + texture(uTex, uv+t*vec2(-1,1)).rgb + texture(uTex, uv+t*vec2(1,1)).rgb;
  o = vec4(r/16.*uW, 1.);
}`;
export const STREAK_FS = COMMONF + `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uStep; uniform float uThr;
out vec4 o;
void main(){
  vec3 r=vec3(0.);
  float ws[5]; ws[0]=.2270; ws[1]=.1945; ws[2]=.1216; ws[3]=.0540; ws[4]=.0162;
  for(int i=-4;i<=4;i++){
    vec3 c = texture(uTex, vUv+uStep*float(i)).rgb;
    c = max(c-uThr, 0.);
    r += c*ws[abs(i)];
  }
  o=vec4(r,1.);
}`;
export const STREAK2_FS = COMMONF + `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uStep;
out vec4 o;
void main(){
  vec3 r=vec3(0.);
  float ws[5]; ws[0]=.2270; ws[1]=.1945; ws[2]=.1216; ws[3]=.0540; ws[4]=.0162;
  for(int i=-4;i<=4;i++) r += texture(uTex, vUv+uStep*float(i)).rgb*ws[abs(i)];
  o=vec4(r*1.02,1.);
}`;

// ---------- 合成 ----------
export const COMPOSE_FS = COMMONF + `
in vec2 vUv;
uniform sampler2D uScene; uniform sampler2D uEmit; uniform sampler2D uBloom; uniform sampler2D uStreak;
uniform float uBloomK; uniform float uStreakK; uniform float uExposure; uniform float uFlash;
uniform vec4 uShock; // cx,cy (uv), radius, amp
uniform float uCA;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
vec3 sampleAll(vec2 uv){
  vec3 c = texture(uScene,uv).rgb + texture(uEmit,uv).rgb;
  c += texture(uBloom,uv).rgb*uBloomK + texture(uStreak,uv).rgb*uStreakK;
  return c;
}
void main(){
  vec2 uv=vUv;
  // 衝撃波
  vec2 dv = uv-uShock.xy; float asp=uRes.x/uRes.y; vec2 da=vec2(dv.x*asp,dv.y);
  float dist=length(da);
  float ring = exp(-pow((dist-uShock.z)/.05,2.));
  uv += normalize(da+1e-5)*vec2(1./asp,1.)*ring*uShock.w*.04;
  vec2 cc = uv-.5;
  float r2 = dot(cc*vec2(asp,1.), cc*vec2(asp,1.));
  vec2 off = cc*(.0012+.004*r2)*uCA;
  vec3 col;
  col.r = sampleAll(uv+off).r;
  col.g = sampleAll(uv).g;
  col.b = sampleAll(uv-off).b;
  col += uFlash*vec3(1.,.96,.9)*(1.-r2*.8)*.35 + ring*uShock.w*vec3(.6,.7,1.)*.6;
  col *= uExposure;
  col = aces(col);
  // ビネット
  col *= 1.-.55*smoothstep(.15,1.1,r2);
  col = pow(col, vec3(1./2.2));
  float n = hash21(gl_FragCoord.xy+fract(uTime)*91.)-.5;
  col += n*(1./255.)*1.5;
  o=vec4(col,1.);
}`;
