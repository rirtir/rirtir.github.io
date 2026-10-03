// SYNESTHESIA — GLSL (WebGL2)
const SEG = 40; // 帯状メッシュの分割数
export const SEGMENTS = SEG;

export const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 uVP;
uniform vec3 uEye;
uniform vec2 uBend;      // x: 横カーブ, y: 起伏
uniform float uMirror;   // 1: 床で反転して描く（映り込み）
uniform float uTime;
uniform vec2 uRes;
uniform float uMul;
float hash11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
vec3 bendP(vec3 p){
  float d = max(0., -p.z);
  float fy = uBend.y*d*d;
  p.x += uBend.x*d*d;
  p.y = fy + p.y * (uMirror > .5 ? -1. : 1.);
  return p;
}
`;

// ---------- 全画面 ----------
export const FS_VERT = COMMON + `
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv = p; gl_Position = vec4(p*2.-1., 0., 1.);
}`;

// ---------- 空 ----------
export const SKY_FS = COMMON + `
in vec2 vUv;
uniform vec3 uCamR, uCamU, uCamF; uniform vec2 uTan; uniform float uShift;
uniform vec3 uColA, uColB, uColC;
uniform vec4 uAud;       // 低,中,高,全体
uniform float uFlash, uBeat, uInten;
out vec4 o;
vec3 skyCol(vec3 d, bool refl){
  float h = d.y;
  vec3 fwd = vec3(0.,0.,-1.);
  // 地平線のグロー
  float hz = exp(-abs(h)*(refl?5.:7.));
  vec3 col = mix(uColA*.12, uColA*.6, smoothstep(-.1,.8,h));
  col += uColB*hz*(.22+.3*uAud.x);
  // 太陽（ポータル）: 前方の円盤
  float cosA = dot(normalize(vec3(d.x, d.y-.07, d.z)), fwd);
  float ang = acos(clamp(cosA,-1.,1.));
  float sunR = .095 + .012*uAud.x;
  float disc = refl ? 0. : smoothstep(sunR, sunR-.012, ang);
  float rings = .5+.5*sin(ang*70. - uTime*1.5);
  float halo = exp(-ang*ang*26.)*(.3+.5*uAud.x+uFlash*.6);
  vec3 sunc = mix(uColB, uColC, smoothstep(-.1,.2,h+.07));
  col += sunc*halo*.8;
  {
    float sy = (d.y-.07)/sunR;
    vec3 sg = mix(uColB*1.5, uColC*1.5+.12, smoothstep(-.9,.9,sy));
    float stp = smoothstep(.0,.12, sin(sy*24.+1.2)+(sy*1.5+.7)*1.15-.55);
    float sm = mix(1., stp, smoothstep(.15,-.45,sy));
    col += sg*disc*sm*(.62+uAud.x*.45);
  }
  if (refl) {
    // 床への映り込みは、円盤ではなく縦に伸びる光の柱として
    float colm = exp(-d.x*d.x*160.)*smoothstep(.0,.35,h)*exp(-h*3.5);
    col += mix(uColB,uColC,.6)*colm*(.55+.5*uAud.x+uFlash*.4)*(.75+.25*vnoise(vec2(d.x*90., h*40.-uTime*.6)));
  }
  // 同心リングの波紋
  float rg = exp(-pow((ang-(.2+fract(uTime*.12)*.7))*10.,2.))*(1.-fract(uTime*.12))*.35*(.3+uAud.x);
  col += uColB*rg;
  // オーロラ
  if (h > .0) {
    vec2 q = d.xz/(h+.35);
    float t = uTime*.04;
    float w = fbm(q*vec2(.9,.6)+vec2(t,0.));
    float band = 0.;
    for (int i=0;i<3;i++){
      if (refl && i>0) break;
      float fi = float(i);
      float y = h*(2.4+fi*.7) + w*1.4 - fi*.55 - .12;
      float n = fbm(vec2(q.x*(1.4+fi*.5)+t*(1.+fi), fi*7.3 + t*.5));
      float curtain = exp(-pow((y-n*.8+.2)*(3.2),2.));
      float streak = .55+.45*vnoise(vec2(q.x*38.+fi*5., uTime*.2));
      band += curtain*streak/(1.+fi*.55);
    }
    float fade = smoothstep(.0,.2,h)*(1.-smoothstep(.6,1.,h));
    vec3 ac = mix(uColB, uColC, clamp(h*1.4+w*.5,0.,1.));
    col += ac*band*fade*(.28+.5*uAud.y+.35*uInten);
  }
  // 星
  if (h > .02 && !refl) {
    vec2 sp = d.xz/(h+.5)*30.;
    vec2 ci = floor(sp), cf = fract(sp)-.5;
    float rnd = hash21(ci);
    float star = smoothstep(.06,.0,length(cf+(vec2(hash21(ci+3.1),hash21(ci+7.7))-.5)*.6)) * step(.86,rnd);
    star *= .5+.5*sin(uTime*(1.+rnd*3.)+rnd*40.);
    col += vec3(.8,.9,1.)*star*(.5+uAud.z)*smoothstep(.02,.3,h)*.9;
  }
  // 遠景の稜線
  float az = atan(d.x, -d.z);
  for (int i=0;i<2;i++){
    float fi=float(i);
    float ridge = (.02 + .07*fbm(vec2(az*(3.+fi*2.)+fi*11.,fi*3.7)))*(1.-fi*.35);
    float m = smoothstep(ridge+.004, ridge-.004, h);
    vec3 rc = mix(uColA*.08, uColB*.22, hz)*(1.-fi*.45);
    col = mix(col, rc, m*(refl?0.:1.));
  }
  return col;
}
void main(){
  vec2 ndc = vUv*2.-1.; ndc.y -= uShift;
  vec3 d = normalize(uCamF + uCamR*ndc.x*uTan.x + uCamU*ndc.y*uTan.y);
  vec3 c = skyCol(d, false);
  c *= 1.+uFlash*.4;
  o = vec4(c,1.);
}`;
export const SKY_FN = SKY_FS.slice(SKY_FS.indexOf('vec3 skyCol'), SKY_FS.indexOf('void main'));

// ---------- 帯（ノーツ・床・ライン・リング） ----------
const SLAB_COMMON = COMMON + `
const int SEG = ${SEG};
`;
export const SLAB_VS = SLAB_COMMON + `
in vec4 aA;   // cx, zNear, zFar, width
in vec4 aB;   // type, p1, p2, p3
in vec4 aC;   // rgba
uniform float uLift;
out vec2 vUv; out vec4 vB; out vec4 vC; out vec3 vW; out vec2 vSize; out float vDist;
void main(){
  int id = gl_VertexID; int side = id & 1; int seg = id >> 1;
  float v = float(seg)/float(SEG);
  float z = mix(aA.y, aA.z, v);
  float x = aA.x + (float(side)-.5)*aA.w;
  float y = uLift + aB.w*0.;
  vec3 p = bendP(vec3(x, y, z));
  vW = vec3(x, y, z);
  vUv = vec2(float(side), v);
  vSize = vec2(aA.w, abs(aA.y-aA.z));
  vB = aB; vC = aC;
  vDist = max(0., -z);
  gl_Position = uVP*vec4(p,1.);
}`;

const FOG = `
float fogK(float d){ return exp(-d*.022); }
float farFade(float d){ return 1.-smoothstep(38.,54.,d); }
`;

export const TAP_FS = COMMON + FOG + `
in vec2 vUv; in vec4 vB; in vec4 vC; in vec3 vW; in vec2 vSize; in float vDist;
out vec4 o;
float sdRB(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
void main(){
  vec2 p = (vUv-.5)*vSize;
  float r = min(vSize.y*.42, .1);
  vec2 hb = vSize*.5 - r;
  float d = sdRB(p, hb, r);
  float aa = fwidth(d)*1.2 + 1e-4;
  float inside = 1.-smoothstep(-aa, aa, d);
  if (inside < .002) discard;
  vec3 col = vC.rgb;
  float kind = vB.x;          // 0 通常, 1 失敗(暗い), 2 ホールド先頭
  float pulse = vB.y;          // 拍・近接での脈動
  float core = clamp(-d/(vSize.y*.5), 0., 1.);
  float rim = exp(-abs(d+.02)*55.);
  vec3 c = col*(.28+.5*core);
  c += col*rim*3.2;
  // V字ハイライト
  float chev = smoothstep(.06,.0,abs(p.y*.9 + abs(p.x)*.30 - .0) );
  c += mix(col, vec3(1.), .6)*chev*.9*core;
  // 中心の白熱
  vec2 cc = p/vec2(vSize.x*.45, vSize.y*.5);
  float center = exp(-dot(cc,cc)*1.6);
  c += mix(col, vec3(1.), .65)*center*1.25;
  // ガラスのような縦グラデ
  c *= .8 + .4*(1.-vUv.y);
  c *= 1. + pulse*.9;
  if (kind > .5 && kind < 1.5) c = mix(vec3(dot(c,vec3(.3,.5,.2))), c, .15)*.28;
  float alpha = 1.;
  if (kind > 2.5) {
    // 判定位置の枠（押下で発光）
    float pr = pulse;
    c = col*(rim*2.2 + .05 + pr*(.9+core*1.6));
    alpha = .55 + pr*.4;
  }
  float fade = farFade(vDist);
  c *= (1.+.03*vDist) * fade * vC.a * uMul;
  o = vec4(c*inside, inside*fade*vC.a*alpha*(kind>2.5?1.:uMul));
}`;

export const HOLD_FS = COMMON + FOG + `
in vec2 vUv; in vec4 vB; in vec4 vC; in vec3 vW; in vec2 vSize; in float vDist;
out vec4 o;
void main(){
  vec2 p = (vUv-.5)*vSize;
  float ax = abs(p.x)/(vSize.x*.5);
  float edge = smoothstep(.82,1.,ax);
  float inside = 1.-smoothstep(.96,1.,ax);
  float act = vB.x;           // 0 待機, 1 保持中, 2 失敗
  float L = vSize.y;
  float flow = .5+.5*sin(vW.z*9. + uTime*(act>.5?-14.:-5.));
  float flow2 = .5+.5*sin(vW.z*3.3 + uTime*-2.);
  vec3 col = vC.rgb;
  vec3 c = col*(.25 + .22*flow + .1*flow2);
  c += col*edge*2.4;
  float core = exp(-ax*ax*5.);
  c += mix(col, vec3(1.), .5)*core*(.35+.35*flow);
  if (act > .5 && act < 1.5) { c *= 2.2; c += vec3(1.)*core*.5; }
  if (act > 1.5) c = vec3(dot(c,vec3(.3,.5,.2)))*.25;
  float fade = farFade(vDist);
  // 先端（遠い側）をやわらかく消す
  float tipFade = smoothstep(0., .08, vUv.y*0. + (1.-vUv.y)) ;
  c *= fade*vC.a*inside*uMul;
  o = vec4(c, inside*fade*vC.a*uMul*(.55+.35*float(act>.5&&act<1.5)));
}`;

export const LINE_FS = COMMON + FOG + `
in vec2 vUv; in vec4 vB; in vec4 vC; in vec3 vW; in vec2 vSize; in float vDist;
out vec4 o;
void main(){
  // 全幅の線（拍線・判定線）。v方向のガウス
  float t = vB.x;
  float y = (vUv.y-.5)*2.;
  float g = exp(-y*y*3.);
  float edge = 1.-smoothstep(.8,1.,abs(vUv.x-.5)*2.);
  float fade = farFade(vDist);
  vec3 c = vC.rgb*g*edge*vC.a*fade;
  o = vec4(c, 1.);
}`;

export const RING_FS = COMMON + `
in vec2 vUv; in vec4 vB; in vec4 vC; in vec3 vW; in vec2 vSize; in float vDist;
out vec4 o;
void main(){
  // 床面の円環（vSize.x を直径とする正方形に描く）
  vec2 p = (vUv-.5)*2.;
  float r = length(p);
  float k = vB.y;                 // 0..1 の進行
  float w = .07 + .05*(1.-k);
  float ring = exp(-pow((r-.82)/w, 2.));
  float fill = 0.;
  float a = vC.a*(1.-k);
  o = vec4(vC.rgb*(ring*a*1.0 + fill*vC.a), 1.);
}`;

export const FLOOR_FS = COMMON + FOG + `
in vec2 vUv; in vec4 vB; in vec4 vC; in vec3 vW; in vec2 vSize; in float vDist;
uniform vec3 uColA, uColB, uColC;
uniform vec4 uAud;
uniform vec4 uLaneGlow;   // 押下の光
uniform vec3 uLaneCol[4];
uniform float uFlash, uBeat, uInten;
uniform float uScroll;    // 進行（world単位）
out vec4 o;
` + SKY_FN + `
void main(){
  float x = vW.x, z = vW.z;
  vec3 V = normalize(vec3(x, 0., z) - uEye);
  vec3 R = reflect(V, vec3(0.,1.,0.));
  // ぼかした反射 (粗さ)
  vec3 refl = skyCol(normalize(R + vec3(vnoise(vec2(x*2.,z*.7))-.5, 0., 0.)*.04), true);
  float cosT = clamp(dot(-V, vec3(0.,1.,0.)),0.,1.);
  float fres = .12 + .88*pow(1.-cosT, 4.);
  vec3 col = vec3(.004,.006,.012)+uColA*.03;
  col += refl*fres*.45*mix(1., .5, smoothstep(8., 36., vDist));
  // レーン
  float lx = x + 2.;          // 0..4
  float lane = floor(clamp(lx, 0., 3.999));
  float lf = fract(lx);
  float fa = fwidth(lx)*1.2;
  // 区切り線
  float dl = min(lf, 1.-lf);
  float div = (1.-smoothstep(0., .025+fa, dl)) * (lane>0. || lf>.5 ? 1. : 0.);
  float outer = 1.-smoothstep(0., .03+fa, abs(lx-0.)) ;
  float outer2 = 1.-smoothstep(0., .03+fa, abs(lx-4.));
  float fadeD = exp(-vDist*.018);
  col += uColB*(div*.55 + (outer+outer2)*1.6)*fadeD*(.7+.6*uAud.x);
  // 進行する格子（時間方向の流れ）
  float gz = fract((z + uScroll)*.5);
  float grid = (1.-smoothstep(0., .05+fwidth(z)*1., abs(gz-.5)*0. + gz))*.5;
  col += uColB*grid*.03*fadeD;
  // 押下レーンの発光（判定線付近から奥へ伸びる）
  float lg = 0.;
  for (int i=0;i<4;i++){ if (float(i)==lane) { lg = uLaneGlow[i]; col += uLaneCol[i]*lg*exp(-max(0.,-z)*.5)*(.08+.2*(1.-abs(lf-.5)*1.6))*.6; } }
  // 判定線付近のぼんやりした光
  col += uColC*exp(-z*z*.5)*.1*(.4+uAud.x);
  // 微細な粒（ガラスの傷）
  col *= .97 + .06*vnoise(vec2(x*40., z*5.));
  float fade = 1.-smoothstep(40.,58.,vDist);
  col = mix(col, uColB*.25*(.4+uAud.x*.4), 1.-fadeD*.0 - fade);
  float alpha = mix(.86, .98, smoothstep(0.,1.,vDist/30.))*(1.-smoothstep(44.,64.,vDist));
  // 端のフェード（レーンの外側は透明に）
  float edgeA = 1.-smoothstep(4.0, 4.9, abs(x)+2.0 - 0.0 + 0.);
  o = vec4(col*alpha, alpha);
}`;

// ---------- ビルボード ----------
export const BILL_VS = COMMON + `
in vec4 aP;   // x,y,z,type
in vec4 aS;   // w,h,p1,p2
in vec4 aC;   // rgba
uniform vec3 uRight, uUp;
out vec2 vUv; out vec4 vP; out vec4 vS; out vec4 vC; out float vDist;
void main(){
  int id = gl_VertexID;
  vec2 q = vec2(float(id&1), float((id>>1)&1));
  float type = aP.w;
  vec3 pos = vec3(aP.xyz);
  vec3 bp = bendP(pos);
  vec3 up = (type > .5 && type < 2.5) ? vec3(0., uMirror>.5?-1.:1., 0.) : uUp;
  vec3 right = uRight;
  vec3 wp;
  if (type > .5 && type < 2.5) {
    // 円柱ビルボード: 下端を pos に置く
    wp = bp + right*(q.x-.5)*aS.x + up*q.y*aS.y;
  } else {
    wp = bp + right*(q.x-.5)*aS.x + up*(q.y-.5)*aS.y;
  }
  vUv = q; vP = aP; vS = aS; vC = aC;
  vDist = max(0., -pos.z);
  gl_Position = uVP*vec4(wp,1.);
}`;

export const BILL_FS = COMMON + `
in vec2 vUv; in vec4 vP; in vec4 vS; in vec4 vC; in float vDist;
out vec4 o;
void main(){
  float type = vP.w;
  vec2 p = vUv*2.-1.;
  vec3 c = vec3(0.);
  float fade = 1.-smoothstep(36.,56.,vDist);
  if (type < .5) {
    // ソフトな光球
    float r2 = dot(p,p);
    float g = exp(-r2*4.5)*(1.-smoothstep(.8,1.,sqrt(r2)));
    c = vC.rgb*g*vC.a;
  } else if (type < 1.5) {
    // スペクトルの柱
    float ex = 1.-smoothstep(.55,1.,abs(p.x));
    float hh = vUv.y;
    float g = ex*(.25+.75*pow(hh,1.6));
    float cap = exp(-pow((1.-hh)*7.,2.))*ex*1.4;
    float base = exp(-hh*9.)*.8*ex;
    c = (vC.rgb*(g*.55+base*.7)*vC.a + mix(vC.rgb, vec3(1.), .15)*cap*vC.a*.8)*.62;
  } else if (type < 2.5) {
    // レーンの光柱（押下）
    float ex = exp(-p.x*p.x*4.5);
    float g = ex*pow(1.-vUv.y, 1.6);
    c = vC.rgb*g*vC.a*1.05;
  } else {
    // 火花
    float r2 = dot(p,p);
    float g = exp(-r2*7.)*(1.-smoothstep(.85,1.,sqrt(r2)));
    c = mix(vC.rgb, vec3(1.), exp(-r2*14.)*.8)*g*vC.a;
  }
  o = vec4(c*fade*uMul, 1.);
}`;

// ---------- ブルーム ----------
export const DOWN_FS = COMMON + `
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
  if(uFirst>.5){
    float lum=dot(r,vec3(.3,.5,.2));
    float k2 = max(lum-.9,0.)/max(lum,1e-4);   // 閾値（ソフトに）
    r *= mix(.25, 1., clamp(k2*1.5,0.,1.)) / (1.+lum*.05);
  }
  o = vec4(r,1.);
}`;
export const UP_FS = COMMON + `
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uW;
out vec4 o;
void main(){
  vec2 t=uTexel; vec2 uv=vUv;
  vec3 r = texture(uTex, uv).rgb*4.;
  r += texture(uTex, uv+t*vec2(-1,0)).rgb*2. + texture(uTex, uv+t*vec2(1,0)).rgb*2. + texture(uTex, uv+t*vec2(0,-1)).rgb*2. + texture(uTex, uv+t*vec2(0,1)).rgb*2.;
  r += texture(uTex, uv+t*vec2(-1,-1)).rgb + texture(uTex, uv+t*vec2(1,-1)).rgb + texture(uTex, uv+t*vec2(-1,1)).rgb + texture(uTex, uv+t*vec2(1,1)).rgb;
  o = vec4(r/16.*uW, 1.);
}`;

// ---------- 合成 ----------
export const COMPOSE_FS = COMMON + `
in vec2 vUv;
uniform sampler2D uScene; uniform sampler2D uBloom;
uniform float uBloomK; uniform float uExposure; uniform float uFlash; uniform float uPunch; uniform float uCA;
uniform vec3 uTint; uniform float uVig; uniform float uFade;
uniform vec3 uAccent; uniform float uShock;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
vec3 sampleAll(vec2 uv){
  return texture(uScene,uv).rgb + texture(uBloom,uv).rgb*uBloomK;
}
void main(){
  vec2 uv=vUv;
  float asp=uRes.x/uRes.y;
  vec2 cc = uv-.5;
  // キックで画面が一瞬ふくらむ
  uv = .5 + cc*(1.-uPunch*.018);
  cc = uv-.5;
  float r2 = dot(cc*vec2(asp,1.), cc*vec2(asp,1.));
  vec2 off = cc*(.0012+.003*r2 + uPunch*.004)*uCA;
  vec3 col;
  col.r = sampleAll(uv+off).r;
  col.g = sampleAll(uv).g;
  col.b = sampleAll(uv-off).b;
  { // 横に伸びる光の筋（アナモルフィック）
    vec3 st = vec3(0.);
    for (int i=-8;i<=8;i++){ if (i==0) continue; st += texture(uBloom, uv+vec2(float(i)*.016,0.)).rgb*exp(-abs(float(i))*.3); }
    col += st*uBloomK*.06*vec3(.75,.9,1.2);
  }
  // 放射状のストリーク（コンボ）
  col += uFlash*uAccent*(1.-r2*.9)*.18;
  col *= uExposure;
  col = aces(col*uTint);
  col *= 1.-uVig*smoothstep(.12,1.15,r2);
  col = pow(col, vec3(1./2.2));
  float n = hash21(gl_FragCoord.xy+fract(uTime)*91.)-.5;
  col += n*(1./255.)*1.6;
  col *= uFade;
  o=vec4(col,1.);
}`;
