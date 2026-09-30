// 自由飛行カメラ：WASD・マウス（ポインターロック）／タッチ、SDFによる衝突判定つき
import * as THREE from 'three';
import { caveF, WORLD } from './sdf.js';

const _g = [0, 0, 0];

export class FlyControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.speedScale = 1;
    this.radius = 0.42;
    this.enabled = false;
    this.keys = Object.create(null);
    this.underwater = false;
    this.touch = { move: new THREE.Vector2(), moveId: null, lookId: null, lx: 0, ly: 0, ox: 0, oy: 0, up: 0 };
    this.autoDrift = 0; // タイトル画面での微かな揺れ
    this.driftT = 0;
    this._bind();
  }

  setPose(x, y, z, yaw, pitch) {
    this.pos.set(x, y, z);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.vel.set(0, 0, 0);
    this._apply();
  }

  lookAt(x, y, z) {
    const dx = x - this.pos.x, dy = y - this.pos.y, dz = z - this.pos.z;
    this.yaw = this.targetYaw = Math.atan2(-dx, -dz);
    this.pitch = this.targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
    this._apply();
  }

  _bind() {
    const d = this.dom;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.enabled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); });

    d.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') return;
      if (document.pointerLockElement !== d && d.requestPointerLock) {
        try { d.requestPointerLock(); } catch (_) { /* noop */ }
      }
      this._dragging = true;
      this._lx = e.clientX; this._ly = e.clientY;
    });
    window.addEventListener('mouseup', () => { this._dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === d) {
        this._look(e.movementX, e.movementY);
      } else if (this._dragging) {
        this._look(e.clientX - this._lx, e.clientY - this._ly);
        this._lx = e.clientX; this._ly = e.clientY;
      }
    });
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.speedScale = Math.min(6, Math.max(0.15, this.speedScale * Math.exp(-e.deltaY * 0.0012)));
      if (this.onSpeed) this.onSpeed(this.speedScale);
    }, { passive: false });

    // タッチ：左半分＝移動スティック、右半分＝視点
    const t = this.touch;
    d.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const c of e.changedTouches) {
        if (c.clientX < window.innerWidth * 0.5 && t.moveId === null) {
          t.moveId = c.identifier; t.ox = c.clientX; t.oy = c.clientY; t.move.set(0, 0);
        } else if (t.lookId === null) {
          t.lookId = c.identifier; t.lx = c.clientX; t.ly = c.clientY;
        }
      }
    }, { passive: false });
    d.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const c of e.changedTouches) {
        if (c.identifier === t.moveId) {
          const dx = (c.clientX - t.ox) / 60, dy = (c.clientY - t.oy) / 60;
          t.move.set(Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy)));
        } else if (c.identifier === t.lookId) {
          this._look((c.clientX - t.lx) * 1.4, (c.clientY - t.ly) * 1.4);
          t.lx = c.clientX; t.ly = c.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const c of e.changedTouches) {
        if (c.identifier === t.moveId) { t.moveId = null; t.move.set(0, 0); }
        if (c.identifier === t.lookId) t.lookId = null;
      }
    };
    d.addEventListener('touchend', end);
    d.addEventListener('touchcancel', end);
  }

  _look(dx, dy) {
    const s = 0.0022;
    this.targetYaw -= dx * s;
    this.targetPitch -= dy * s;
    this.targetPitch = Math.max(-1.55, Math.min(1.55, this.targetPitch));
  }

  _apply() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    // 視点の滑らかな追従
    const k = 1 - Math.exp(-dt * 22);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    const keys = this.keys;
    let fx = 0, fz = 0, fy = 0;
    if (this.enabled) {
      if (keys.KeyW || keys.ArrowUp) fz += 1;
      if (keys.KeyS || keys.ArrowDown) fz -= 1;
      if (keys.KeyD || keys.ArrowRight) fx += 1;
      if (keys.KeyA || keys.ArrowLeft) fx -= 1;
      if (keys.Space || keys.KeyE) fy += 1;
      if (keys.KeyC || keys.KeyQ || keys.ControlLeft) fy -= 1;
      if (this.touch.moveId !== null) { fx += this.touch.move.x; fz -= this.touch.move.y; }
      fy += this.touch.up;
    }
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // 前方向（視線方向）／右方向
    const fwd = new THREE.Vector3(-sy * cp, sp, -cy * cp);
    const right = new THREE.Vector3(cy, 0, -sy);
    const want = new THREE.Vector3()
      .addScaledVector(fwd, fz)
      .addScaledVector(right, fx)
      .addScaledVector(new THREE.Vector3(0, 1, 0), fy);
    const len = want.length();
    if (len > 1) want.divideScalar(len);

    let speed = 3.6 * this.speedScale;
    if (keys.ShiftLeft || keys.ShiftRight) speed *= 3.2;
    this.underwater = this.pos.y < WORLD.waterY - 0.15;
    if (this.underwater) speed *= 0.72;
    want.multiplyScalar(speed);

    // 加減速（慣性）
    const acc = 1 - Math.exp(-dt * (this.underwater ? 3.2 : 5.5));
    this.vel.lerp(want, acc);
    this.pos.addScaledVector(this.vel, dt);

    // 衝突：SDFの勾配で押し戻す
    for (let it = 0; it < 3; it++) {
      const f = caveF(this.pos.x, this.pos.y, this.pos.z);
      const pen = this.radius + f; // f<0 が空洞。-f が壁までの距離
      if (pen <= 0) break;
      const e = 0.15;
      const gx = caveF(this.pos.x + e, this.pos.y, this.pos.z) - caveF(this.pos.x - e, this.pos.y, this.pos.z);
      const gy = caveF(this.pos.x, this.pos.y + e, this.pos.z) - caveF(this.pos.x, this.pos.y - e, this.pos.z);
      const gz = caveF(this.pos.x, this.pos.y, this.pos.z + e) - caveF(this.pos.x, this.pos.y, this.pos.z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      _g[0] = gx / gl; _g[1] = gy / gl; _g[2] = gz / gl;
      this.pos.x -= _g[0] * pen; this.pos.y -= _g[1] * pen; this.pos.z -= _g[2] * pen;
      // 壁方向の速度成分を除去
      const vd = this.vel.x * _g[0] + this.vel.y * _g[1] + this.vel.z * _g[2];
      if (vd > 0) { this.vel.x -= _g[0] * vd; this.vel.y -= _g[1] * vd; this.vel.z -= _g[2] * vd; }
    }
    if (this.pos.y > 15.0) { this.pos.y = 15.0; if (this.vel.y > 0) this.vel.y = 0; }

    this._apply();
  }
}
