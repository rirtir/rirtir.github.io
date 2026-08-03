import * as THREE from './vendor/three.module.min.js';
import { AudioEngine } from './audio.js';
import { EffectsEngine } from './effects.js';
import { BOSSES, CHASSIS, DEPTHS, ENEMIES, MODULES } from './data.js';
import { distancePointToSegment, pathLength, pointInPolygonXY, polygonAreaXY, routeHitProfile, SeededRandom } from './logic.js';
import {
  PALETTE,
  createAnchorNode,
  createArenaEnvironment,
  createBossModel,
  createEnemyModel,
  createPlayerModel,
  updateProceduralModel,
} from './models.js';

const ZERO = new THREE.Vector3();
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const MODULE_MAP = new Map(MODULES.map((moduleData) => [moduleData.id, moduleData]));

export class GameEngine {
  constructor(options) {
    this.canvas = options.canvas;
    this.onHud = options.onHud || (() => {});
    this.onBattleEnd = options.onBattleEnd || (() => {});
    this.onDefeat = options.onDefeat || (() => {});
    this.onTutorialGoal = options.onTutorialGoal || (() => {});
    this.onNotice = options.onNotice || (() => {});
    this.onCallout = options.onCallout || (() => {});
    this.onContext = options.onContext || (() => {});
    this.audio = options.audio || new AudioEngine();
    this.settings = { planningSpeed: 0.16, gameSpeed: 1, quality: 'auto', particleLevel: 'high', reducedMotion: false, screenShake: true, cameraGesture: true, colorSymbols: true };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.void);
    this.scene.fog = new THREE.FogExp2(PALETTE.void, 0.014);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 140);
    this.camera.position.set(0, -11.5, 22);
    this.camera.lookAt(ZERO);
    this.cameraTarget = new THREE.Vector3();
    this.cameraYaw = 0;
    this.renderer = this.createRenderer();
    this.effects = new EffectsEngine(this.scene, this.settings);
    this.world = new THREE.Group();
    this.entitiesGroup = new THREE.Group();
    this.hazardsGroup = new THREE.Group();
    this.scene.add(this.world, this.entitiesGroup, this.hazardsGroup);
    this.addLights();

    this.state = 'inactive';
    this.lastFrame = performance.now();
    this.elapsed = 0;
    this.frameId = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.input = { pointerId: null, cameraPointerId: null, planning: false, route: [], selected: [], cancel: false, twoFinger: false, lastX: 0, lastY: 0 };
    this.activePointers = new Map();
    this.environment = null;
    this.player = null;
    this.playerData = null;
    this.anchors = [];
    this.enemies = [];
    this.boss = null;
    this.hazards = [];
    this.wires = [];
    this.delayedActions = [];
    this.execution = null;
    this.arena = null;
    this.options = {};
    this.modules = {};
    this.random = new SeededRandom(1);
    this.routeHistory = [];
    this.battleStats = this.newBattleStats();
    this.battlePar = 1;
    this.ambientHazardTimer = 8;
    this.lastHudAt = 0;
    this.lowFpsSeconds = 0;
    this.renderScale = 1;
    this.tutorialGoalSent = false;
    this.pausedByVisibility = false;
    this.shake = 0;
    this.killerHazard = null;
    this.battleSerial = 0;
    this.boundOrientationChange = () => this.cancelPlanning();

    this.bindInput();
    window.addEventListener('orientationchange', this.boundOrientationChange);
    document.addEventListener('visibilitychange', () => this.handleVisibility());
    this.resize();
    this.frameId = requestAnimationFrame((time) => this.frame(time));
  }

  createRenderer() {
    const context = this.canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!context) throw new Error('WEBGL2_UNAVAILABLE');
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context, antialias: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.34;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.pause('context');
      this.onContext('lost');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.onContext('restored');
      this.resume();
    });
    return renderer;
  }

  addLights() {
    const hemisphere = new THREE.HemisphereLight(0xb7dcf6, 0x10243a, 2.15);
    const key = new THREE.DirectionalLight(0xf2ffff, 4.8);
    key.position.set(-7, -8, 13);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    const rim = new THREE.PointLight(PALETTE.cyan, 28, 34, 1.7);
    rim.position.set(7, 4, 6);
    const enemyRim = new THREE.PointLight(PALETTE.coral, 28, 26, 1.65);
    enemyRim.position.set(-8, 3, 2);
    this.scene.add(hemisphere, key, rim, enemyRim);
  }

  newBattleStats() {
    return { kills: 0, fragments: 0, damageTaken: 0, maxChain: 0, maxSealHits: 0, routeCount: 0, criticals: 0, nearMisses: 0, elapsed: 0 };
  }

  setSettings(settings) {
    Object.assign(this.settings, settings || {});
    this.effects.setOptions(this.settings);
    this.applyQuality();
  }

  applyQuality() {
    const quality = this.settings.quality === 'auto' ? (this.renderScale < 0.9 ? 'low' : 'high') : this.settings.quality;
    const maxRatio = quality === 'low' ? 1 : quality === 'medium' ? 1.35 : 1.75;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio) * this.renderScale);
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.resize();
  }

  startBattle(arena, options = {}) {
    this.clearBattle();
    const battleSerial = this.battleSerial;
    this.arena = structuredClone(arena);
    this.options = {
      chassis: 'lancer',
      modules: {},
      depth: 0,
      mode: 'expedition',
      tutorialGoal: null,
      skinColor: '#43f5d0',
      ...options,
    };
    this.modules = { ...this.options.modules };
    this.random = new SeededRandom(options.seed || 1);
    this.battleStats = this.newBattleStats();
    this.routeHistory = [];
    this.tutorialGoalSent = false;
    this.ambientHazardTimer = 7;
    this.state = 'running';
    this.audio.setMode(arena.boss ? 'boss' : 'combat');
    this.audio.setFlow(0);

    const quality = this.settings.quality === 'auto' ? 'high' : this.settings.quality;
    this.environment = createArenaEnvironment(arena.theme || 'rim', options.seed || 1, quality);
    this.world.add(this.environment);

    this.playerData = {
      chassis: this.options.chassis,
      shields: Math.max(1, Math.min(CHASSIS[this.options.chassis].shield, this.options.shields ?? CHASSIS[this.options.chassis].shield)),
      maxShields: CHASSIS[this.options.chassis].shield,
      flow: 0,
      chain: 0,
      kineticShield: false,
      firstHit: true,
      backTraceReady: false,
      invulnerable: 0,
      flowIdle: 0,
    };
    this.player = createPlayerModel(this.options.chassis);
    this.player.scale.setScalar(1.14);
    this.player.position.fromArray(arena.playerStart || [0, -4, 0]);
    this.player.traverse((child) => {
      if (child.material?.emissive && child.material.emissive.getHex() === PALETTE.cyan) {
        child.material = child.material.clone();
        child.userData.ownedMaterial = true;
        child.material.color.set(this.options.skinColor);
        child.material.emissive.set(this.options.skinColor);
      }
    });
    this.entitiesGroup.add(this.player);

    this.anchors = arena.nodes.map((nodeData) => {
      const model = createAnchorNode(nodeData.locked ? 'danger' : 'neutral');
      model.position.fromArray(nodeData.position);
      model.scale.setScalar(0.82);
      this.entitiesGroup.add(model);
      return { ...nodeData, model, lockTimer: 0 };
    });

    arena.enemies.forEach((enemyData) => this.addEnemy(enemyData));
    if (arena.boss) this.addBoss(arena.boss);
    this.battlePar = this.calculateBattlePar();
    this.cameraTarget.copy(this.player.position).multiplyScalar(0.1);
    this.resize();
    this.emitHud(true);

    if (this.options.tutorialGoal === 'dodge') {
      window.setTimeout(() => {
        if (this.battleSerial === battleSerial && this.state === 'running') this.createHazard({ type: 'sphere', position: this.player.position.clone(), radius: 1.8, delay: 3.2, sourceId: 'tutorial', tutorial: true });
      }, 500);
    }
  }

  addEnemy(enemyData) {
    const model = createEnemyModel(enemyData.type, enemyData.elite);
    model.scale.setScalar(enemyData.elite ? 1.28 : 1.18);
    model.position.fromArray(enemyData.position);
    model.rotation.z = enemyData.facing || 0;
    this.entitiesGroup.add(model);
    const enemy = {
      ...enemyData,
      model,
      dead: false,
      attackTimer: Math.min(enemyData.cooldown, 3.6 + this.random.next() * 2.2),
      stun: 0,
      hitFlash: 0,
      phase: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  addBoss(bossData) {
    const model = createBossModel(bossData.type);
    model.position.fromArray(bossData.position);
    model.scale.setScalar(0.9);
    this.entitiesGroup.add(model);
    this.boss = {
      ...bossData,
      model,
      dead: false,
      attackTimer: 4.2,
      stun: 0,
      phase: 0,
      hitFlash: 0,
    };
  }

  clearBattle() {
    this.battleSerial += 1;
    this.state = 'inactive';
    this.effects.clear();
    this.hazards.forEach((hazard) => this.removeHazard(hazard));
    this.wires.forEach((wire) => {
      if (!wire.model) return;
      this.hazardsGroup.remove(wire.model);
      wire.model.geometry?.dispose();
      wire.model.material?.dispose();
    });
    const geometries = new Set();
    const ownedMaterials = new Set();
    const roots = [
      ...this.world.children,
      ...this.entitiesGroup.children,
      ...this.enemies.map((enemy) => enemy.model),
      this.boss?.model,
    ].filter(Boolean);
    roots.forEach((root) => root.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.userData?.ownedMaterial && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => ownedMaterials.add(material));
      }
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter((material) => material.userData?.owned).forEach((material) => ownedMaterials.add(material));
      }
    }));
    geometries.forEach((geometry) => geometry.dispose());
    ownedMaterials.forEach((material) => material.dispose());
    for (const group of [this.world, this.entitiesGroup, this.hazardsGroup]) {
      while (group.children.length) group.remove(group.children[0]);
    }
    this.environment = null;
    this.player = null;
    this.playerData = null;
    this.anchors = [];
    this.enemies = [];
    this.boss = null;
    this.hazards = [];
    this.wires = [];
    this.delayedActions = [];
    this.execution = null;
    this.input.planning = false;
    this.input.route = [];
    this.input.selected = [];
  }

  bindInput() {
    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.pointerCancel(event));
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  pointerDown(event) {
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === 'mouse' && event.button === 2 && this.settings.cameraGesture) {
      this.input.cameraPointerId = event.pointerId;
      this.input.lastX = event.clientX;
      this.cancelPlanning();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.activePointers.size >= 2 && this.settings.cameraGesture) {
      this.input.twoFinger = true;
      this.cancelPlanning();
      return;
    }
    if (this.state !== 'running' || this.execution || this.input.pointerId !== null) return;
    event.preventDefault();
    try { this.canvas.setPointerCapture?.(event.pointerId); } catch (_) { /* pointer may already be cancelled by the browser */ }
    this.input.pointerId = event.pointerId;
    this.input.planning = true;
    this.input.route = [this.player.position.clone()];
    this.input.selected = [];
    this.input.cancel = false;
    this.input.lastX = event.clientX;
    this.input.lastY = event.clientY;
    this.audio.setPlanning(true);
    this.effects.setRoute(this.input.route, 'preview');
    this.emitHud(true);
  }

  pointerMove(event) {
    const existing = this.activePointers.get(event.pointerId);
    if (existing) {
      existing.x = event.clientX;
      existing.y = event.clientY;
    }
    if (event.pointerId === this.input.cameraPointerId && this.settings.cameraGesture) {
      const delta = event.clientX - this.input.lastX;
      this.cameraYaw = Math.max(-0.6, Math.min(0.6, this.cameraYaw + delta * 0.0025));
      this.input.lastX = event.clientX;
      return;
    }
    if (this.input.twoFinger && this.activePointers.size >= 2 && this.settings.cameraGesture) {
      const points = [...this.activePointers.values()];
      const centerX = (points[0].x + points[1].x) * 0.5;
      const delta = centerX - this.input.lastX;
      this.cameraYaw = Math.max(-0.6, Math.min(0.6, this.cameraYaw + delta * 0.0025));
      this.input.lastX = centerX;
      return;
    }
    if (!this.input.planning || event.pointerId !== this.input.pointerId) return;
    event.preventDefault();
    this.input.lastX = event.clientX;
    this.input.lastY = event.clientY;
    const nearest = this.findCandidate(event.clientX, event.clientY - 22);
    if (!nearest) return;
    if (nearest.id === '__cancel__') {
      this.input.cancel = true;
      this.effects.setRoute([...this.input.route, this.player.position.clone()], 'danger');
      this.emitHud(true);
      return;
    }
    const maxNodes = this.maxRouteNodes();
    if (this.input.selected.length >= maxNodes) return;
    if (this.input.selected.includes(nearest.id)) return;
    const last = this.input.route[this.input.route.length - 1];
    if (last.distanceTo(nearest.position) < 0.35) return;
    this.input.selected.push(nearest.id);
    this.input.route.push(nearest.position.clone());
    this.input.cancel = false;
    this.effects.snapPulse(nearest.position);
    this.effects.setRoute(this.input.route, this.routeDangerous(this.input.route) ? 'danger' : 'preview');
    this.audio.sfx('snap', 0.65);
    this.vibrate(8);
    this.emitHud(true);
  }

  pointerUp(event) {
    this.activePointers.delete(event.pointerId);
    if (event.pointerId === this.input.cameraPointerId) {
      this.input.cameraPointerId = null;
      return;
    }
    if (this.input.twoFinger) {
      if (this.activePointers.size < 2) this.input.twoFinger = false;
      return;
    }
    if (event.pointerId !== this.input.pointerId) return;
    event.preventDefault();
    const route = this.input.route.map((point) => point.clone());
    const selected = [...this.input.selected];
    this.input.pointerId = null;
    this.input.planning = false;
    this.audio.setPlanning(false);
    if (route.length > 1 && !this.input.cancel) this.executeRoute(route, selected);
    else {
      this.effects.clearRoute();
      this.audio.sfx('cancel', 0.5);
    }
    this.input.route = [];
    this.input.selected = [];
    this.emitHud(true);
  }

  pointerCancel(event) {
    this.activePointers.delete(event.pointerId);
    if (event.pointerId === this.input.cameraPointerId) this.input.cameraPointerId = null;
    if (event.pointerId === this.input.pointerId) this.cancelPlanning();
  }

  cancelPlanning() {
    this.input.pointerId = null;
    this.input.planning = false;
    this.input.route = [];
    this.input.selected = [];
    this.effects.clearRoute();
    this.audio.setPlanning(false);
    this.emitHud(true);
  }

  findCandidate(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const candidates = [];
    if (this.input.route.length > 1) candidates.push({ id: '__cancel__', position: this.player.position });
    this.anchors.forEach((anchor) => {
      if (!anchor.locked) candidates.push({ id: anchor.id, position: anchor.model.position });
    });
    if (this.options.tutorialGoal !== 'seal') {
      this.enemies.forEach((enemy) => {
        if (!enemy.dead) candidates.push({ id: enemy.id, position: enemy.model.position });
      });
    }
    if (this.boss && !this.boss.dead) candidates.push({ id: this.boss.id, position: this.boss.model.position });
    let best = null;
    let bestDistance = Math.max(54, Math.min(82, rect.width * 0.09));
    candidates.forEach((candidate) => {
      const projected = candidate.position.clone().project(this.camera);
      const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { ...candidate, position: candidate.position.clone() };
      }
    });
    return best;
  }

  maxRouteNodes() {
    const momentum = this.moduleValue('momentum');
    return 3 + (momentum && this.playerData.flow >= momentum ? 1 : 0);
  }

  routeDangerous(points) {
    if (points.length < 2) return false;
    const end = points[points.length - 1];
    return this.hazards.some((hazard) => !hazard.triggered && hazard.delay < 0.8 && this.hazardContains(hazard, end));
  }

  executeRoute(points, targetIds = [], options = {}) {
    if (this.execution || this.state !== 'running') return;
    this.audio.sfx(options.overtrace ? 'overtrace' : 'route');
    this.effects.setRoute(points, 'confirmed');
    const totalLength = pathLength(points.map((point) => point.toArray()));
    const heavy = this.moduleLevel('heavyVector') > 0;
    let speed = 19 * CHASSIS[this.options.chassis].speed * (heavy ? 0.9 : 1);
    if (options.overtrace && this.options.chassis === 'lancer') speed *= 1.25;
    if (this.playerData.flow >= 75 && this.moduleLevel('overclock')) speed *= 1 + this.moduleValue('overclock') / 100;
    this.execution = {
      points,
      targetIds,
      segment: 0,
      elapsed: 0,
      segmentDuration: Math.max(0.15, Math.min(0.42, points[0].distanceTo(points[1]) / speed)),
      hitIds: new Set(),
      hits: 0,
      kills: 0,
      criticals: 0,
      totalLength,
      overtrace: Boolean(options.overtrace),
      damageMultiplier: options.damageMultiplier || 1,
      previousPoint: points[0].clone(),
    };
    this.battleStats.routeCount += 1;
  }

  updateExecution(delta) {
    const execution = this.execution;
    if (!execution) return;
    execution.elapsed += delta * this.settings.gameSpeed;
    const start = execution.points[execution.segment];
    const end = execution.points[execution.segment + 1];
    const progress = Math.min(1, execution.elapsed / execution.segmentDuration);
    const eased = progress * progress * (3 - 2 * progress);
    this.player.position.lerpVectors(start, end, eased);
    this.player.lookAt(end);
    this.checkActiveHazardsAlongPlayer();
    if (progress < 1) return;

    this.player.position.copy(end);
    const targetId = execution.targetIds[execution.segment];
    this.resolveSegment(start, end, targetId, execution);
    execution.segment += 1;
    execution.elapsed = 0;
    if (execution.segment >= execution.points.length - 1) {
      this.finishRoute(execution);
      return;
    }
    let speed = 19 * CHASSIS[this.options.chassis].speed;
    if (this.moduleLevel('heavyVector')) speed *= 0.9;
    if (execution.overtrace && this.options.chassis === 'lancer') speed *= 1.25;
    execution.segmentDuration = Math.max(0.15, Math.min(0.42, execution.points[execution.segment].distanceTo(execution.points[execution.segment + 1]) / speed));
  }

  resolveSegment(start, end, targetId, execution) {
    const segmentLength = start.distanceTo(end);
    const tensionMultiplier = this.tensionMultiplier(execution);
    const backTraceMultiplier = this.playerData.backTraceReady && this.moduleLevel('backTrace')
      ? 1 + this.moduleValue('backTrace') / 100
      : 1;
    this.playerData.backTraceReady = false;
    const targets = [...this.enemies.filter((enemy) => !enemy.dead), ...(this.boss && !this.boss.dead ? [this.boss] : [])];
    let segmentHitIndex = 0;
    let generatedBackTrace = false;
    targets.forEach((target) => {
      if (distancePointToSegment(target.model.position.toArray(), start.toArray(), end.toArray()) > target.radius + 0.42) return;
      segmentHitIndex += 1;
      const direct = target.id === targetId;
      const hitProfile = routeHitProfile(this.options.chassis, direct, segmentLength);
      const critical = hitProfile.critical;
      const back = this.isBackAttack(target, start);
      const damage = this.calculateDamage(target, segmentLength, execution.hits, critical, back, execution.damageMultiplier * tensionMultiplier * backTraceMultiplier * hitProfile.multiplier);
      this.damageTarget(target, damage, critical, start, end);
      if (critical) execution.criticals += 1;
      execution.hits += 1;
      execution.hitIds.add(target.id);
      if (target.dead) execution.kills += 1;
      if (back) generatedBackTrace = true;

      const carryDistance = this.moduleValue('carry');
      if (carryDistance && !target.id.startsWith('boss-') && !target.dead) {
        const direction = TEMP_A.subVectors(end, start).normalize();
        target.model.position.addScaledVector(direction, carryDistance);
        this.resolveCarryCollision(target);
      }
    });
    if (generatedBackTrace) this.playerData.backTraceReady = true;

    this.checkNearMisses(start, end);
    if (segmentHitIndex === 0) this.effects.slash(start, end, false);
  }

  tensionMultiplier(execution) {
    const maximum = this.moduleValue('tension');
    const index = execution.segment;
    if (!maximum || index < 1) return 1;
    const previous = TEMP_A.subVectors(execution.points[index], execution.points[index - 1]).normalize();
    const current = TEMP_B.subVectors(execution.points[index + 1], execution.points[index]).normalize();
    const turn = Math.acos(THREE.MathUtils.clamp(previous.dot(current), -1, 1));
    return 1 + (maximum / 100) * (turn / Math.PI);
  }

  calculateDamage(target, segmentLength, actionHitIndex, critical, back, multiplier = 1) {
    let damage = CHASSIS[this.options.chassis].damage * multiplier;
    if (critical) damage *= 1.5;
    else damage *= 0.38;
    if (segmentLength >= 8 && this.moduleLevel('longEdge')) damage *= 1 + this.moduleValue('longEdge') / 100;
    if (actionHitIndex > 0 && this.moduleLevel('secondCut')) damage *= 1 + this.moduleValue('secondCut') / 100;
    if (target.hp / target.maxHp <= 0.25 && this.moduleLevel('execute')) damage *= 1 + this.moduleValue('execute') / 100;
    if (this.playerData.firstHit && this.moduleLevel('firstLight')) damage *= this.moduleValue('firstLight');
    if (this.moduleLevel('heavyVector')) damage *= 1 + this.moduleValue('heavyVector') / 100;
    if (this.playerData.flow >= 75 && this.moduleLevel('overclock')) damage *= 1 + this.moduleValue('overclock') / 100;
    if (this.playerData.shields === 1 && this.moduleLevel('lastSignal')) damage *= 1 + this.moduleValue('lastSignal') / 100;
    if (target.type === 'warden' && !back) {
      const pierce = this.moduleValue('piercer') || 0;
      damage *= 1 - Math.max(0.3, 0.8 - pierce / 100);
    }
    this.playerData.firstHit = false;
    return Math.max(0.1, damage);
  }

  isBackAttack(target, attackStart) {
    if (target.type !== 'warden') return false;
    const toStart = TEMP_A.subVectors(attackStart, target.model.position).normalize();
    const forward = TEMP_B.set(Math.cos(target.facing || 0), Math.sin(target.facing || 0), 0);
    return toStart.dot(forward) < -0.15;
  }

  damageTarget(target, damage, critical, start, end) {
    target.hp -= damage;
    target.hitFlash = 0.12;
    this.effects.slash(start, end, critical);
    this.audio.sfx(critical ? 'critical' : 'slash', Math.min(1.3, damage / 3));
    if (critical) this.battleStats.criticals += 1;
    this.addFlow(critical ? 10 : 5);
    if (target.hp <= 0) this.killTarget(target);
  }

  killTarget(target) {
    if (target.dead) return;
    target.dead = true;
    target.hp = 0;
    this.effects.enemyBreak(target.model.position, target.id.startsWith('boss-') ? PALETTE.violet : PALETTE.coral, target.id.startsWith('boss-'));
    this.audio.sfx('break', target.id.startsWith('boss-') ? 1.35 : 0.85);
    this.entitiesGroup.remove(target.model);
    this.hazards.filter((hazard) => hazard.sourceId === target.id && !hazard.triggered).forEach((hazard) => this.removeHazard(hazard));
    this.battleStats.kills += 1;
    const flowTier = Math.min(3, Math.floor(this.playerData.flow / 25));
    this.battleStats.fragments += Math.round((target.reward || 0) * (1 + flowTier * 0.08));
    this.playerData.chain += 1;
    this.battleStats.maxChain = Math.max(this.battleStats.maxChain, this.playerData.chain);
    this.addFlow(target.id.startsWith('boss-') ? 30 : 13);
    this.vibrate(target.id.startsWith('boss-') ? [28, 30, 45] : 18);
    if (this.options.tutorialGoal === 'kill') this.sendTutorialGoal('kill');
    if (target.id.startsWith('boss-')) {
      this.finishBattle(true);
    } else if (this.enemies.every((enemy) => enemy.dead) && !this.boss) {
      this.finishBattle(true);
    }
  }

  resolveCarryCollision(target) {
    const other = this.enemies.find((enemy) => !enemy.dead && enemy !== target && enemy.model.position.distanceTo(target.model.position) < enemy.radius + target.radius);
    if (!other) return;
    const bonus = 1 + (this.moduleValue('collider') || 0) / 100;
    this.damageTarget(target, 1.2 * bonus, false, target.model.position, other.model.position);
    this.damageTarget(other, 1.2 * bonus, false, other.model.position, target.model.position);
  }

  finishRoute(execution) {
    const points = execution.points;
    this.routeHistory = points.map((point) => point.clone());
    const sealDistance = 4.8 * (1 + (this.moduleValue('smallSeal') || 0) / 100) + (this.options.chassis === 'weaver' ? 1.8 : 0);
    const canSeal = points.length >= (this.options.chassis === 'weaver' ? 3 : 4)
      && points[0].distanceTo(points[points.length - 1]) <= sealDistance
      && polygonAreaXY(points.map((point) => point.toArray())) >= 5.5;
    if (canSeal && !execution.overtrace) this.resolveSeal(points);

    if (!execution.overtrace) {
      this.applyArrivalEffects(points, execution.totalLength);
      const afterlineDelay = this.moduleValue('afterline');
      if (afterlineDelay) {
        this.delayedActions.push({ delay: afterlineDelay, type: 'afterline', points: points.map((point) => point.clone()) });
      }
      const liveWireDuration = this.moduleValue('liveWire');
      if (liveWireDuration) this.createWire(points, liveWireDuration);
      if (this.moduleLevel('kineticShield') && execution.totalLength >= this.moduleValue('kineticShield')) this.playerData.kineticShield = true;
      if (this.options.tutorialGoal === 'route') this.sendTutorialGoal('route');
    }

    if (execution.hits > 0) this.playerData.chain += Math.max(0, execution.hits - 1);
    else this.playerData.chain = Math.max(0, this.playerData.chain - 1);
    this.battleStats.maxChain = Math.max(this.battleStats.maxChain, this.playerData.chain);
    if (execution.kills >= 2) this.onCallout({ label: `MULTI ×${execution.kills}`, detail: '一筆撃破', tone: 'success' });
    else if (execution.criticals > 0) this.onCallout({ label: `CORE ×${execution.criticals}`, detail: '弱点直撃', tone: 'critical' });
    else if (execution.hits > 0) this.onCallout({ label: `GRAZE ×${execution.hits}`, detail: '核を直接狙う', tone: 'warning' });
    else this.onCallout({ label: 'MISS', detail: '赤い核へ線を通す', tone: 'warning' });
    this.execution = null;
    this.effects.clearRoute();
    this.emitHud(true);
  }

  resolveSeal(points) {
    const polygon = points.map((point) => point.toArray());
    const targets = [...this.enemies.filter((enemy) => !enemy.dead), ...(this.boss && !this.boss.dead ? [this.boss] : [])];
    let hits = 0;
    targets.forEach((target) => {
      if (!pointInPolygonXY(target.model.position.toArray(), polygon)) return;
      hits += 1;
      this.damageTarget(target, CHASSIS[this.options.chassis].damage * 1.25, false, points[0], points[points.length - 1]);
      if (this.moduleLevel('snare') && !target.dead) target.stun = this.moduleValue('snare');
    });
    this.effects.vectorSeal(points);
    this.audio.sfx('seal', 0.8 + hits * 0.1);
    this.addFlow(16 + (this.moduleValue('closedCircuit') || 0));
    this.battleStats.maxSealHits = Math.max(this.battleStats.maxSealHits, hits);
    if (hits >= 4) this.battleStats.maxSealHits = Math.max(4, this.battleStats.maxSealHits);
    if (this.options.tutorialGoal === 'seal') this.sendTutorialGoal('seal');
  }

  applyArrivalEffects(points, totalLength) {
    const endpoint = points[points.length - 1];
    const shock = this.moduleValue('shockArrival');
    const wall = this.moduleValue('wallbreak');
    if (!shock && !(wall && totalLength >= 12)) return;
    const radius = wall && totalLength >= 12 ? wall + 1.4 : 1.5;
    const damage = CHASSIS[this.options.chassis].damage * ((shock || 30) / 100 + (wall ? 0.35 : 0));
    const targets = [...this.enemies.filter((enemy) => !enemy.dead), ...(this.boss && !this.boss.dead ? [this.boss] : [])];
    targets.forEach((target) => {
      if (target.model.position.distanceTo(endpoint) <= radius + target.radius) this.damageTarget(target, damage, false, endpoint, target.model.position);
    });
    this.effects.nearMiss(endpoint);
  }

  createWire(points, duration) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: this.options.skinColor, transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false });
    const model = new THREE.Line(geometry, material);
    model.renderOrder = 12;
    this.hazardsGroup.add(model);
    this.wires.push({ points: points.map((point) => point.clone()), ttl: duration, maxTtl: duration, tick: 0.1, model });
  }

  updateWires(delta) {
    for (let i = this.wires.length - 1; i >= 0; i -= 1) {
      const wire = this.wires[i];
      wire.ttl -= delta;
      wire.tick -= delta;
      if (wire.tick <= 0) {
        wire.tick = 0.42;
        const targets = this.enemies.filter((enemy) => !enemy.dead);
        targets.forEach((target) => {
          for (let segment = 1; segment < wire.points.length; segment += 1) {
            if (distancePointToSegment(target.model.position.toArray(), wire.points[segment - 1].toArray(), wire.points[segment].toArray()) <= target.radius + 0.22) {
              this.damageTarget(target, 0.38, false, wire.points[segment - 1], wire.points[segment]);
              break;
            }
          }
        });
      }
      if (wire.ttl <= 0) this.wires.splice(i, 1);
      if (wire.model) wire.model.material.opacity = 0.42 * Math.max(0, wire.ttl / wire.maxTtl);
      if (wire.ttl <= 0 && wire.model) {
        this.hazardsGroup.remove(wire.model);
        wire.model.geometry.dispose();
        wire.model.material.dispose();
      }
    }
  }

  activateOvertrace() {
    if (this.state !== 'running' || this.execution || this.playerData.flow < 100 || this.routeHistory.length < 2) return false;
    const multiplier = 1 + (this.moduleValue('reverse') || 0) / 100;
    this.playerData.flow = 0;
    this.executeRoute([...this.routeHistory].reverse().map((point) => point.clone()), [], { overtrace: true, damageMultiplier: multiplier });
    this.audio.setFlow(0);
    this.emitHud(true);
    return true;
  }

  updateEnemies(delta) {
    const depth = DEPTHS[this.options.depth] || DEPTHS[0];
    const targets = [...this.enemies, ...(this.boss ? [this.boss] : [])];
    targets.forEach((enemy) => {
      if (enemy.dead) return;
      updateProceduralModel(enemy.model, this.elapsed, delta);
      if (enemy.hitFlash > 0) enemy.hitFlash -= delta;
      if (this.options.tutorialGoal) return;
      if (enemy.stun > 0) {
        enemy.stun -= delta;
        return;
      }
      enemy.attackTimer -= delta;
      if (enemy.attackTimer <= 0) {
        this.enemyAttack(enemy);
        const base = enemy.id.startsWith('boss-') ? 4.8 - enemy.phase * 0.35 : ENEMIES[enemy.type].cooldown;
        enemy.attackTimer = Math.max(2.2, base / depth.attackMultiplier * (0.85 + this.random.next() * 0.3));
      }
      if (enemy.id.startsWith('boss-')) {
        const definition = BOSSES[enemy.type];
        const phase = Math.min(definition.phases - 1, Math.floor((1 - enemy.hp / enemy.maxHp) * definition.phases));
        if (phase > enemy.phase) {
          enemy.phase = phase;
          this.effects.bossPulse(enemy.model.position);
          this.audio.sfx('warning', 1.2);
          this.shake = this.settings.screenShake ? 0.45 : 0;
        }
      }
    });

    if (this.options.depth >= 10 && !this.options.tutorialGoal) {
      this.ambientHazardTimer -= delta;
      if (this.ambientHazardTimer <= 0) {
        const anchor = this.random.pick(this.anchors.filter((item) => !item.locked));
        if (anchor) this.createHazard({ type: 'sphere', position: anchor.model.position.clone(), radius: 1.5, delay: 2.8, sourceId: 'depth-hazard' });
        this.ambientHazardTimer = 8.5;
      }
    }
  }

  enemyAttack(enemy) {
    const target = this.player.position.clone();
    const source = enemy.model.position.clone();
    const delay = enemy.id.startsWith('boss-') ? Math.max(1.9, 2.8 - enemy.phase * 0.18) : ENEMIES[enemy.type].telegraph;
    switch (enemy.type) {
      case 'lancer':
        this.createHazard({ type: 'line', start: source, end: extendLine(source, target, 1.35), width: 0.7, delay, sourceId: enemy.id });
        break;
      case 'warden':
        this.createHazard({ type: 'line', start: source, end: extendLine(source, target, 1.05), width: 1.1, delay, sourceId: enemy.id });
        break;
      case 'bloom': {
        const anchor = this.random.pick(this.anchors.filter((item) => !item.locked));
        this.createHazard({ type: 'sphere', position: anchor?.model.position.clone() || target, radius: 1.55, delay, sourceId: enemy.id });
        break;
      }
      case 'tether': {
        const anchor = nearestAnchor(this.anchors.filter((item) => !item.locked), target);
        if (anchor) {
          anchor.locked = true;
          anchor.lockTimer = delay + 1.6;
          this.createHazard({ type: 'line', start: source, end: anchor.model.position.clone(), width: 0.45, delay, sourceId: enemy.id, anchorId: anchor.id });
        }
        break;
      }
      case 'mirror':
        if (this.routeHistory.length > 1) this.createHazard({ type: 'path', points: this.routeHistory.map((point) => point.clone()), width: 0.5, delay, sourceId: enemy.id });
        else this.createHazard({ type: 'sphere', position: target, radius: 1.45, delay, sourceId: enemy.id });
        break;
      case 'forge':
        this.createHazard({ type: 'spawn', position: source, radius: 1.2, delay, sourceId: enemy.id });
        break;
      case 'null':
        this.createHazard({ type: 'sphere', position: source, radius: 3.6, delay, sourceId: enemy.id });
        break;
      case 'ringWarden':
      case 'tetraCrown':
      case 'vesperCore':
        this.bossAttack(enemy, source, target, delay);
        break;
      case 'seeker':
      default:
        this.createHazard({ type: 'sphere', position: target, radius: 1.45, delay, sourceId: enemy.id });
    }
  }

  bossAttack(enemy, source, target, delay) {
    const pattern = (enemy.phase + Math.floor(this.elapsed / 3)) % 3;
    if (enemy.type === 'tetraCrown') {
      if (pattern === 0) {
        const baseAngle = this.random.next() * Math.PI;
        const count = Math.min(4, 2 + enemy.phase);
        for (let i = 0; i < count; i += 1) {
          const angle = baseAngle + i * Math.PI / count;
          const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
          this.createHazard({ type: 'line', start: direction.clone().multiplyScalar(-11), end: direction.clone().multiplyScalar(11), width: 0.58, delay: delay + i * 0.24, sourceId: enemy.id });
        }
      } else if (pattern === 1) {
        this.createHazard({ type: 'sphere', position: target, radius: 1.8 + enemy.phase * 0.18, delay, sourceId: enemy.id });
        const opposite = target.clone().multiplyScalar(-0.7);
        this.createHazard({ type: 'sphere', position: opposite, radius: 1.35, delay: delay + 0.42, sourceId: enemy.id });
      } else {
        const anchors = this.random.shuffle(this.anchors).slice(0, Math.min(2 + enemy.phase, 4));
        anchors.forEach((anchor, index) => this.createHazard({ type: 'sphere', position: anchor.model.position.clone(), radius: 1.2, delay: delay + index * 0.2, sourceId: enemy.id }));
      }
      return;
    }

    if (enemy.type === 'vesperCore') {
      if (pattern === 0 && this.routeHistory.length > 1) {
        this.createHazard({ type: 'path', points: this.routeHistory.map((point) => point.clone()), width: 0.62 + enemy.phase * 0.06, delay, sourceId: enemy.id });
      } else if (pattern === 1) {
        const anchors = this.random.shuffle(this.anchors).slice(0, Math.min(3 + enemy.phase, Math.max(3, this.anchors.length - 1)));
        anchors.forEach((anchor, index) => this.createHazard({ type: 'sphere', position: anchor.model.position.clone(), radius: 1.18, delay: delay + index * 0.16, sourceId: enemy.id }));
      } else {
        const angle = this.random.next() * Math.PI;
        const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
        const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0);
        this.createHazard({ type: 'line', start: direction.clone().multiplyScalar(-12), end: direction.clone().multiplyScalar(12), width: 0.8, delay, sourceId: enemy.id });
        this.createHazard({ type: 'line', start: perpendicular.clone().multiplyScalar(-12), end: perpendicular.clone().multiplyScalar(12), width: 0.66, delay: delay + 0.38, sourceId: enemy.id });
      }
      return;
    }

    if (pattern === 0) {
      this.createHazard({ type: 'sphere', position: target, radius: 2 + enemy.phase * 0.2, delay, sourceId: enemy.id });
    } else if (pattern === 1) {
      const angle = this.random.next() * Math.PI;
      const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      this.createHazard({ type: 'line', start: direction.clone().multiplyScalar(-11), end: direction.clone().multiplyScalar(11), width: 0.9 + enemy.phase * 0.12, delay, sourceId: enemy.id });
      if (enemy.phase >= 2) {
        const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0);
        this.createHazard({ type: 'line', start: perpendicular.clone().multiplyScalar(-11), end: perpendicular.clone().multiplyScalar(11), width: 0.7, delay: delay + 0.35, sourceId: enemy.id });
      }
    } else {
      const anchors = this.random.shuffle(this.anchors).slice(0, Math.min(2 + enemy.phase, 4));
      anchors.forEach((anchor, index) => this.createHazard({ type: 'sphere', position: anchor.model.position.clone(), radius: 1.3, delay: delay + index * 0.18, sourceId: enemy.id }));
    }
  }

  createHazard(data) {
    const hazard = { ...data, triggered: false, active: 0, model: null, symbol: null, removed: false };
    const material = new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    if (hazard.type === 'sphere' || hazard.type === 'spawn') {
      hazard.model = new THREE.Mesh(new THREE.RingGeometry(hazard.radius * 0.78, hazard.radius, 40), material);
      hazard.model.position.copy(hazard.position);
    } else if (hazard.type === 'line') {
      const direction = TEMP_A.subVectors(hazard.end, hazard.start);
      const length = direction.length();
      hazard.model = new THREE.Mesh(new THREE.PlaneGeometry(length, hazard.width * 2), material);
      hazard.model.position.copy(TEMP_B.addVectors(hazard.start, hazard.end).multiplyScalar(0.5));
      hazard.model.rotation.z = Math.atan2(direction.y, direction.x);
    } else if (hazard.type === 'path') {
      const geometry = new THREE.BufferGeometry().setFromPoints(hazard.points);
      hazard.model = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.65, depthTest: false, toneMapped: false }));
    }
    if (hazard.model) {
      hazard.model.renderOrder = 15;
      this.hazardsGroup.add(hazard.model);
    }
    if (this.settings.colorSymbols && hazard.type !== 'path') {
      const symbolMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthTest: false, toneMapped: false });
      hazard.symbol = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.36, 3), symbolMaterial);
      if (hazard.position) hazard.symbol.position.copy(hazard.position);
      else hazard.symbol.position.copy(TEMP_A.addVectors(hazard.start, hazard.end).multiplyScalar(0.5));
      hazard.symbol.position.z += 0.08;
      hazard.symbol.rotation.z = Math.PI / 2;
      hazard.symbol.renderOrder = 16;
      this.hazardsGroup.add(hazard.symbol);
    }
    this.hazards.push(hazard);
    this.audio.sfx('warning', 0.42);
    return hazard;
  }

  updateHazards(delta) {
    for (let i = this.hazards.length - 1; i >= 0; i -= 1) {
      const hazard = this.hazards[i];
      if (hazard.removed) {
        this.hazards.splice(i, 1);
        continue;
      }
      if (!hazard.triggered) {
        hazard.delay -= delta;
        if (hazard.model?.material) {
          hazard.model.material.opacity = 0.22 + Math.sin(this.elapsed * 8) * 0.1 + Math.max(0, 0.24 - hazard.delay * 0.06);
          if (hazard.type === 'sphere' || hazard.type === 'spawn') hazard.model.rotation.z += delta * 0.35;
        }
        if (hazard.symbol?.material) hazard.symbol.material.opacity = 0.56 + Math.sin(this.elapsed * 8) * 0.2;
        if (hazard.delay <= 0) this.triggerHazard(hazard);
      } else {
        hazard.active -= delta;
        if (hazard.model?.material) hazard.model.material.opacity = Math.max(0, hazard.active * 2.4);
        if (hazard.symbol?.material) hazard.symbol.material.opacity = Math.max(0, hazard.active * 2.8);
        if (hazard.active <= 0) this.removeHazard(hazard);
      }
    }
    this.anchors.forEach((anchor) => {
      if (!anchor.locked) return;
      anchor.lockTimer -= delta;
      if (anchor.lockTimer <= 0) anchor.locked = false;
    });
  }

  triggerHazard(hazard) {
    hazard.triggered = true;
    hazard.active = 0.28;
    if (hazard.model?.material) {
      hazard.model.material.color.setHex(PALETTE.coral);
      hazard.model.material.opacity = 0.88;
    }
    if (hazard.symbol?.material) {
      hazard.symbol.material.color.setHex(PALETTE.coral);
      hazard.symbol.material.opacity = 1;
    }
    if (hazard.type === 'spawn') {
      if (this.enemies.filter((enemy) => !enemy.dead).length < 8) {
        const definition = ENEMIES.seeker;
        const depth = DEPTHS[this.options.depth] || DEPTHS[0];
        this.addEnemy({
          id: `spawn-${Date.now()}-${Math.floor(this.random.next() * 999)}`,
          type: 'seeker',
          position: [hazard.position.x + 0.9, hazard.position.y, hazard.position.z],
          hp: Math.ceil(definition.hp * depth.hpMultiplier),
          maxHp: Math.ceil(definition.hp * depth.hpMultiplier),
          cooldown: definition.cooldown,
          reward: Math.round(definition.reward * 0.7),
          elite: false,
          radius: definition.radius,
          facing: this.random.next() * Math.PI * 2,
        });
      }
      return;
    }
    if (this.hazardContains(hazard, this.player.position)) this.damagePlayer(hazard);
    else {
      this.battleStats.nearMisses += 1;
      this.addFlow(6 * (1 + (this.moduleValue('nearMiss') || 0) / 100));
      this.effects.nearMiss(this.player.position);
      if (hazard.tutorial) this.sendTutorialGoal('dodge');
    }
  }

  hazardContains(hazard, point) {
    if (hazard.type === 'sphere') return point.distanceTo(hazard.position) <= hazard.radius + 0.35;
    if (hazard.type === 'line') return distancePointToSegment(point.toArray(), hazard.start.toArray(), hazard.end.toArray()) <= hazard.width + 0.32;
    if (hazard.type === 'path') {
      for (let i = 1; i < hazard.points.length; i += 1) {
        if (distancePointToSegment(point.toArray(), hazard.points[i - 1].toArray(), hazard.points[i].toArray()) <= hazard.width + 0.32) return true;
      }
    }
    return false;
  }

  checkActiveHazardsAlongPlayer() {
    this.hazards.forEach((hazard) => {
      if (hazard.triggered && hazard.active > 0 && !hazard.hitPlayer && this.hazardContains(hazard, this.player.position)) {
        hazard.hitPlayer = true;
        this.damagePlayer(hazard);
      }
    });
  }

  checkNearMisses(start, end) {
    this.hazards.forEach((hazard) => {
      if (!hazard.triggered || hazard.nearMissed) return;
      let distance = Infinity;
      if (hazard.type === 'sphere') distance = distancePointToSegment(hazard.position.toArray(), start.toArray(), end.toArray()) - hazard.radius;
      else if (hazard.type === 'line') distance = Math.min(start.distanceTo(hazard.start), end.distanceTo(hazard.end));
      if (distance > 0.35 && distance < 1.15) {
        hazard.nearMissed = true;
        this.battleStats.nearMisses += 1;
        this.addFlow(8 * (1 + (this.moduleValue('nearMiss') || 0) / 100));
        this.effects.nearMiss(this.player.position);
      }
    });
  }

  damagePlayer(hazard) {
    if (this.state !== 'running' || this.playerData.invulnerable > 0) return;
    if (this.playerData.kineticShield) {
      this.playerData.kineticShield = false;
      this.effects.shieldHit(this.player.position);
      this.audio.sfx('confirm', 0.7);
      return;
    }
    if (this.options.chassis === 'bulwark' && this.input.planning && this.playerData.planGuard > 0) return;
    this.playerData.shields -= 1;
    this.playerData.invulnerable = 1.2;
    this.playerData.chain = 0;
    this.playerData.flow = Math.max(0, this.playerData.flow - 32);
    this.playerData.flowIdle = 0;
    this.battleStats.damageTaken += 1;
    this.effects.shieldHit(this.player.position);
    this.audio.sfx('hit');
    this.shake = this.settings.screenShake ? 0.48 : 0;
    this.vibrate([35, 24, 45]);
    this.killerHazard = hazard.type;
    this.emitHud(true);
    if (this.playerData.shields <= 0) this.finishBattle(false);
  }

  removeHazard(hazard) {
    if (hazard.removed) return;
    hazard.removed = true;
    if (hazard.anchorId) {
      const anchor = this.anchors.find((item) => item.id === hazard.anchorId);
      if (anchor) anchor.locked = false;
    }
    if (hazard.model) {
      this.hazardsGroup.remove(hazard.model);
      hazard.model.geometry?.dispose();
      hazard.model.material?.dispose();
    }
    if (hazard.symbol) {
      this.hazardsGroup.remove(hazard.symbol);
      hazard.symbol.geometry?.dispose();
      hazard.symbol.material?.dispose();
    }
  }

  updateDelayed(delta) {
    for (let i = this.delayedActions.length - 1; i >= 0; i -= 1) {
      const action = this.delayedActions[i];
      action.delay -= delta;
      if (action.delay > 0) continue;
      if (action.type === 'afterline' && this.execution) {
        action.delay = 0.1;
        continue;
      }
      if (action.type === 'afterline') this.executeRoute(action.points, [], { overtrace: true, damageMultiplier: 0.5 });
      this.delayedActions.splice(i, 1);
    }
  }

  addFlow(amount) {
    this.playerData.flow = Math.max(0, Math.min(100, this.playerData.flow + amount));
    this.playerData.flowIdle = 0;
    this.audio.setFlow(this.playerData.flow);
  }

  moduleLevel(id) {
    return Math.max(0, Math.min(3, this.modules[id] || 0));
  }

  moduleValue(id) {
    const level = this.moduleLevel(id);
    if (!level) return 0;
    return MODULE_MAP.get(id)?.values[level - 1] || 0;
  }

  calculateBattlePar() {
    const criticalDamage = CHASSIS[this.options.chassis].damage * 1.5 * (this.options.chassis === 'lancer' ? 1.35 : 1);
    if (this.boss) return Math.max(6, Math.ceil(this.boss.maxHp / criticalDamage));
    const requiredHits = this.enemies.map((enemy) => Math.max(1, Math.ceil(enemy.maxHp / criticalDamage)));
    if (!requiredHits.length) return 1;
    return Math.max(Math.max(...requiredHits), Math.ceil(requiredHits.reduce((sum, value) => sum + value, 0) / this.maxRouteNodes()));
  }

  battleRank() {
    const routesOver = this.battleStats.routeCount - this.battlePar;
    if (routesOver <= 0 && this.battleStats.damageTaken === 0) return 'S';
    if (routesOver <= 1 && this.battleStats.damageTaken <= 1) return 'A';
    if (routesOver <= 3) return 'B';
    return 'C';
  }

  predictRoute(points) {
    if (!points || points.length < 2) return { hits: 0, cores: 0 };
    const targets = [...this.enemies.filter((enemy) => !enemy.dead), ...(this.boss && !this.boss.dead ? [this.boss] : [])];
    let hits = 0;
    for (let index = 1; index < points.length; index += 1) {
      targets.forEach((target) => {
        if (distancePointToSegment(target.model.position.toArray(), points[index - 1].toArray(), points[index].toArray()) <= target.radius + 0.42) hits += 1;
      });
    }
    const cores = this.input.selected.filter((id) => id.startsWith('enemy') || id.startsWith('boss-') || id.startsWith('spawn-')).length;
    return { hits, cores };
  }

  finishBattle(victory) {
    if (this.state !== 'running') return;
    this.state = victory ? 'victory' : 'defeat';
    this.cancelPlanning();
    this.hazards.forEach((hazard) => this.removeHazard(hazard));
    this.audio.sfx(victory ? 'victory' : 'defeat');
    const rank = victory ? this.battleRank() : 'C';
    const rankBonus = victory ? ({ S: 40, A: 24, B: 10, C: 0 }[rank] || 0) : 0;
    this.battleStats.fragments += rankBonus;
    const result = {
      victory,
      bossId: this.boss?.type || null,
      ...this.battleStats,
      par: this.battlePar,
      rank,
      rankBonus,
      shields: Math.max(0, this.playerData.shields),
      noDamage: this.battleStats.damageTaken === 0,
    };
    const battleSerial = this.battleSerial;
    window.setTimeout(() => {
      if (this.battleSerial !== battleSerial) return;
      if (victory) this.onBattleEnd(result);
      else this.onDefeat({ ...result, killer: this.killerHazard });
    }, victory ? 900 : 700);
  }

  revive() {
    if (this.state !== 'defeat') return false;
    this.state = 'running';
    this.playerData.shields = 1;
    this.playerData.invulnerable = 2;
    this.playerData.flow = 0;
    this.emitHud(true);
    return true;
  }

  sendTutorialGoal(goal) {
    if (this.tutorialGoalSent || this.options.tutorialGoal !== goal) return;
    this.tutorialGoalSent = true;
    this.state = 'tutorialComplete';
    this.cancelPlanning();
    window.setTimeout(() => this.onTutorialGoal(goal), 420);
  }

  pause(reason = 'manual') {
    if (this.state !== 'running') return;
    this.previousState = this.state;
    this.state = 'paused';
    this.pauseReason = reason;
    this.cancelPlanning();
    this.emitHud(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.lastFrame = performance.now();
    this.audio.resume();
    this.emitHud(true);
  }

  handleVisibility() {
    if (document.hidden && this.state === 'running') {
      this.pausedByVisibility = true;
      this.pause('visibility');
    } else if (!document.hidden && this.pausedByVisibility && this.state === 'paused' && this.pauseReason === 'visibility') {
      this.pausedByVisibility = false;
      this.resume();
    }
  }

  frame(time) {
    const rawDelta = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    this.elapsed += rawDelta;
    const nullActive = this.enemies.some((enemy) => !enemy.dead && enemy.type === 'null');
    const calmReduction = this.moduleValue('calmCore') / 100;
    let planningScale = Math.max(0.05, this.settings.planningSpeed * (1 - calmReduction));
    if (nullActive) planningScale = Math.max(0.32, planningScale);
    const timeScale = this.input.planning ? planningScale : 1;
    const gameDelta = rawDelta * timeScale * this.settings.gameSpeed;

    if (this.state === 'running') {
      this.battleStats.elapsed += rawDelta;
      if (this.playerData.invulnerable > 0) this.playerData.invulnerable -= rawDelta;
      if (this.options.chassis === 'bulwark') this.playerData.planGuard = this.input.planning ? Math.max(0, (this.playerData.planGuard ?? 0.5) - rawDelta) : 0.5;
      if (this.execution) this.updateExecution(rawDelta);
      this.updateEnemies(gameDelta);
      this.updateHazards(gameDelta);
      this.updateWires(gameDelta);
      this.updateDelayed(gameDelta);
      if (!this.input.planning && !this.execution && this.playerData.flow > 0) {
        this.playerData.flowIdle += rawDelta;
        if (this.playerData.flowIdle > 6 && !(this.playerData.shields === 1 && this.moduleLevel('lastSignal'))) {
          this.playerData.flow = Math.max(0, this.playerData.flow - rawDelta * 1.6);
          this.audio.setFlow(this.playerData.flow);
        }
      }
    }

    if (this.player) updateProceduralModel(this.player, this.elapsed, rawDelta);
    this.effects.update(rawDelta);
    this.updateCamera(rawDelta);
    this.renderer.render(this.scene, this.camera);
    this.trackPerformance(rawDelta);
    this.emitHud(false, time);
    this.frameId = requestAnimationFrame((next) => this.frame(next));
  }

  updateCamera(delta) {
    if (!this.player || this.input.planning) return;
    const desired = TEMP_A.copy(this.player.position).multiplyScalar(0.06);
    this.cameraTarget.lerp(desired, 1 - Math.exp(-delta * 3));
    const rect = this.canvas.getBoundingClientRect();
    const portrait = rect.height > rect.width;
    const base = new THREE.Vector3(...(portrait ? [0, -19.2, 36] : [0, -10.5, 20])).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
    let shakeX = 0; let shakeY = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - delta * 2.8);
      shakeX = (Math.random() - 0.5) * this.shake;
      shakeY = (Math.random() - 0.5) * this.shake;
    }
    this.camera.position.set(base.x + this.cameraTarget.x + shakeX, base.y + this.cameraTarget.y * 0.3 + shakeY, base.z);
    this.camera.lookAt(this.cameraTarget.x, this.cameraTarget.y, 0);
  }

  trackPerformance(delta) {
    if (!delta) return;
    if (delta > 1 / 26) this.lowFpsSeconds += delta;
    else this.lowFpsSeconds = Math.max(0, this.lowFpsSeconds - delta * 0.5);
    if (this.settings.quality === 'auto' && this.lowFpsSeconds > 4 && this.renderScale > 0.72) {
      this.renderScale = Math.max(0.7, this.renderScale - 0.15);
      this.lowFpsSeconds = 0;
      this.applyQuality();
      this.onNotice('描画負荷に合わせて解像度を調整しました。', 'info');
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.fov = height > width ? 58 : 48;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  emitHud(force = false, time = performance.now()) {
    if (!this.playerData || (!force && time - this.lastHudAt < 80)) return;
    this.lastHudAt = time;
    const alive = this.enemies.filter((enemy) => !enemy.dead).length + (this.boss && !this.boss.dead ? 1 : 0);
    const bossHp = this.boss ? Math.max(0, this.boss.hp / this.boss.maxHp) : null;
    const prediction = this.predictRoute(this.input.route);
    this.onHud({
      state: this.state,
      shields: this.playerData.shields,
      maxShields: this.playerData.maxShields,
      flow: this.playerData.flow,
      chain: this.playerData.chain,
      alive,
      bossHp,
      planning: this.input.planning,
      routeNodes: this.input.route.length ? this.input.route.length - 1 : 0,
      maxRouteNodes: this.maxRouteNodes(),
      routeLength: this.input.route.length > 1 ? pathLength(this.input.route.map((point) => point.toArray())) : 0,
      routeHits: prediction.hits,
      routeCores: prediction.cores,
      routeCount: this.battleStats.routeCount,
      par: this.battlePar,
      overtraceReady: this.playerData.flow >= 100 && this.routeHistory.length > 1,
      kineticShield: this.playerData.kineticShield,
      fragments: this.battleStats.fragments,
    });
  }

  vibrate(pattern) {
    if (this.settings.haptics && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern);
  }

  destroy() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('orientationchange', this.boundOrientationChange);
    this.clearBattle();
    this.renderer.dispose();
  }
}

function extendLine(start, target, factor) {
  return new THREE.Vector3().subVectors(target, start).multiplyScalar(factor).add(start);
}

function nearestAnchor(anchors, point) {
  let result = null;
  let distance = Infinity;
  anchors.forEach((anchor) => {
    const next = anchor.model.position.distanceTo(point);
    if (next < distance) {
      distance = next;
      result = anchor;
    }
  });
  return result;
}

export default GameEngine;
