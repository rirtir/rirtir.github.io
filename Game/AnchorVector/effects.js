import * as THREE from './vendor/three.module.min.js';
import { PALETTE } from './models.js';

const scratch = new THREE.Vector3();

export class EffectsEngine {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.particleLevel = options.particleLevel || 'high';
    this.effects = [];
    this.routePreview = null;
    this.routeDots = [];
  }

  setOptions(options = {}) {
    if ('reducedMotion' in options) this.reducedMotion = Boolean(options.reducedMotion);
    if (options.particleLevel) this.particleLevel = options.particleLevel;
  }

  setRoute(points, status = 'preview') {
    this.clearRoute();
    if (!points || points.length < 2) return;
    const color = status === 'danger' ? PALETTE.amber : status === 'confirmed' ? PALETTE.cyan : PALETTE.blue;
    const positions = [];
    points.forEach((point, index) => {
      const p = point.isVector3 ? point : new THREE.Vector3(...point);
      positions.push(p.x, p.y, p.z);
      if (index > 0) {
        const dot = new THREE.Mesh(
          new THREE.RingGeometry(0.18, 0.24, 18),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, toneMapped: false }),
        );
        dot.position.copy(p);
        dot.renderOrder = 41;
        this.scene.add(dot);
        this.routeDots.push(dot);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: status === 'confirmed' ? 1 : 0.78, depthTest: false, toneMapped: false });
    this.routePreview = new THREE.Line(geometry, material);
    this.routePreview.renderOrder = 40;
    this.scene.add(this.routePreview);
  }

  clearRoute() {
    if (this.routePreview) {
      this.scene.remove(this.routePreview);
      this.routePreview.geometry.dispose();
      this.routePreview.material.dispose();
      this.routePreview = null;
    }
    this.routeDots.forEach((dot) => {
      this.scene.remove(dot);
      dot.geometry.dispose();
      dot.material.dispose();
    });
    this.routeDots.length = 0;
  }

  snapPulse(position, color = PALETTE.blue) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.24, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    ring.position.copy(position);
    ring.renderOrder = 35;
    this.add(ring, 0.32, (object, t) => {
      const scale = 1 + t * 2.8;
      object.scale.setScalar(scale);
      object.material.opacity = 0.95 * (1 - t);
    });
  }

  slash(start, end, critical = false) {
    const from = start.isVector3 ? start : new THREE.Vector3(...start);
    const to = end.isVector3 ? end : new THREE.Vector3(...end);
    const direction = scratch.subVectors(to, from);
    const length = direction.length();
    if (length < 0.01) return;
    const center = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.8, length), critical ? 0.34 : 0.2),
      new THREE.MeshBasicMaterial({ color: critical ? 0xffffff : PALETTE.cyan, transparent: true, opacity: critical ? 0.92 : 0.72, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    plane.position.copy(center);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
    plane.renderOrder = 30;
    this.add(plane, this.reducedMotion ? 0.12 : 0.22, (object, t) => {
      object.scale.y = 1 + t * 2.2;
      object.material.opacity = (critical ? 0.92 : 0.72) * (1 - t);
    });
    if (critical && !this.reducedMotion) {
      const echo = plane.clone();
      echo.geometry = plane.geometry.clone();
      echo.material = plane.material.clone();
      echo.material.color.setHex(PALETTE.blue);
      echo.position.z += 0.08;
      this.add(echo, 0.3, (object, t) => {
        object.scale.y = 0.7 + t * 3.2;
        object.material.opacity = 0.5 * (1 - t);
      });
    }
    this.sparkBurst(center, critical ? PALETTE.cyan : PALETTE.ceramic, critical ? 16 : 9);
  }

  sparkBurst(position, color = PALETTE.cyan, requested = 12) {
    if (this.particleLevel === 'off') return;
    const multiplier = this.particleLevel === 'low' ? 0.4 : this.particleLevel === 'medium' ? 0.7 : 1;
    const count = Math.max(3, Math.round(requested * multiplier));
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i += 1) {
      positions.set([position.x, position.y, position.z], i * 3);
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.4 + Math.random() * 3.2);
      velocities.push(velocity);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 0.1, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    points.renderOrder = 32;
    this.add(points, 0.42, (object, t, dt) => {
      const array = object.geometry.attributes.position.array;
      velocities.forEach((velocity, index) => {
        array[index * 3] += velocity.x * dt;
        array[index * 3 + 1] += velocity.y * dt;
        array[index * 3 + 2] += velocity.z * dt;
        velocity.multiplyScalar(0.95);
      });
      object.geometry.attributes.position.needsUpdate = true;
      object.material.opacity = 0.95 * (1 - t);
    });
  }

  shieldHit(position) {
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.75, 1),
      new THREE.MeshBasicMaterial({ color: PALETTE.coral, wireframe: true, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    );
    shell.position.copy(position);
    this.add(shell, 0.38, (object, t) => {
      object.scale.setScalar(0.7 + t * 1.1);
      object.material.opacity = 0.8 * (1 - t);
      object.rotation.y += 0.05;
    });
    this.sparkBurst(position, PALETTE.coral, 14);
  }

  enemyBreak(position, color = PALETTE.coral, large = false) {
    const count = this.reducedMotion ? 3 : large ? 10 : 6;
    for (let i = 0; i < count; i += 1) {
      const shard = new THREE.Mesh(
        new THREE.TetrahedronGeometry((large ? 0.18 : 0.1) * (0.65 + Math.random() * 0.7), 0),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? color : PALETTE.slate, transparent: true, opacity: 0.9, toneMapped: false }),
      );
      shard.position.copy(position);
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1 + Math.random() * (large ? 4.5 : 2.5));
      this.add(shard, large ? 0.8 : 0.55, (object, t, dt) => {
        object.position.addScaledVector(velocity, dt);
        velocity.multiplyScalar(0.965);
        object.rotation.x += dt * 5;
        object.rotation.y += dt * 3;
        object.scale.setScalar(1 - t * 0.75);
        object.material.opacity = 0.9 * (1 - t);
      });
    }
    this.sparkBurst(position, color, large ? 24 : 13);
  }

  vectorSeal(points) {
    if (!points || points.length < 3) return;
    const shape = new THREE.Shape();
    points.forEach((point, index) => {
      const p = point.isVector3 ? point : new THREE.Vector3(...point);
      if (index === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    });
    shape.closePath();
    const surface = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    const averageZ = points.reduce((sum, point) => sum + (point.z || 0), 0) / points.length;
    surface.position.z = averageZ;
    surface.renderOrder = 25;
    this.add(surface, this.reducedMotion ? 0.25 : 0.52, (object, t) => {
      const scale = t < 0.45 ? 1 + t * 0.12 : Math.max(0.02, 1 - (t - 0.45) / 0.55);
      object.scale.setScalar(scale);
      object.material.opacity = 0.26 * (1 - t);
    });
  }

  nearMiss(position) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 8, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber, wireframe: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
    );
    sphere.position.copy(position);
    this.add(sphere, 0.24, (object, t) => {
      object.scale.setScalar(1 + t * 2);
      object.material.opacity = 0.85 * (1 - t);
    });
  }

  bossPulse(position, color = PALETTE.violet) {
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 0.84, 36),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      );
      ring.position.copy(position);
      this.add(ring, 0.85 + i * 0.12, (object, t) => {
        const delayed = Math.max(0, (t - i * 0.12) / (1 - i * 0.12));
        object.scale.setScalar(0.5 + delayed * 7);
        object.material.opacity = 0.7 * (1 - delayed);
      });
    }
  }

  add(object, duration, update) {
    this.scene.add(object);
    this.effects.push({ object, age: 0, duration, update });
    return object;
  }

  update(delta) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.age += delta;
      const progress = Math.min(1, effect.age / effect.duration);
      effect.update(effect.object, progress, delta);
      if (progress >= 1) {
        this.scene.remove(effect.object);
        effect.object.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
            else child.material.dispose();
          }
        });
        this.effects.splice(i, 1);
      }
    }
  }

  clear() {
    this.clearRoute();
    this.effects.forEach((effect) => {
      this.scene.remove(effect.object);
      effect.object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.effects.length = 0;
  }
}

export default EffectsEngine;
