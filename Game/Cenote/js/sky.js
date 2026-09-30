// 空（HDR）。天窓から見える青空と太陽。
import * as THREE from 'three';

export function makeSky(toSun) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: { uToSun: { value: toSun.clone().normalize() }, uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uToSun;
      uniform float uTime;
      float h13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),f.x),mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),f.x),mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.02+7.1; a*=0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float mu = dot(d, uToSun);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 zenith = vec3(0.10, 0.25, 0.66);
        vec3 horizon = vec3(0.50, 0.68, 0.90);
        vec3 sky = mix(horizon, zenith, pow(h, 0.55)) * 3.0;
        // 太陽周辺の大気散乱
        sky += vec3(1.0, 0.86, 0.62) * (pow(max(mu, 0.0), 40.0) * 1.6 + pow(max(mu, 0.0), 6.0) * 0.35);
        // 雲
        vec2 cp = d.xz / (d.y + 0.35) * 1.3 + vec2(uTime * 0.004, 0.0);
        float cl = fbm(vec3(cp * 1.3, 3.0));
        float cm = smoothstep(0.52, 0.78, cl) * smoothstep(0.02, 0.3, d.y);
        vec3 cloud = mix(vec3(2.6, 2.7, 2.9), vec3(4.2, 4.1, 3.9), pow(max(mu, 0.0), 2.0));
        sky = mix(sky, cloud, cm * 0.85);
        // 太陽円盤
        float disc = smoothstep(cos(0.016), cos(0.0105), mu);
        sky += vec3(1.0, 0.96, 0.88) * disc * 260.0 * (1.0 - cm * 0.8);
        gl_FragColor = vec4(sky, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(350, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.noShadow = true;
  return mesh;
}
