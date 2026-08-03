import { ACHIEVEMENTS, BOSSES, CHASSIS, DEPTHS, ENEMIES, MODULES } from './data.js';
import {
  SeededRandom,
  chooseModuleCandidates,
  distancePointToSegment,
  generateArena,
  generateEndlessEncounter,
  generateRun,
  hashString,
  pointInPolygonXY,
  polygonAreaXY,
  routeHitProfile,
} from './logic.js';
import { createArenaEnvironment, createBossModel, createEnemyModel, createPlayerModel } from './models.js';
import { createDefaultSave, SaveManager, validateSave } from './save.js';

export function runSelfTests() {
  const results = [];
  const test = (name, callback) => {
    try {
      callback();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  };

  test('content-counts', () => {
    equal(Object.keys(CHASSIS).length, 3);
    equal(Object.keys(ENEMIES).length, 8);
    equal(Object.keys(BOSSES).length, 3);
    equal(MODULES.length, 24);
    equal(DEPTHS.length, 13);
    assert(ACHIEVEMENTS.length >= 20, 'achievement count');
  });

  test('seed-repeatability', () => {
    equal(hashString('VESPER'), hashString('VESPER'));
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);
    for (let i = 0; i < 100; i += 1) equal(a.next(), b.next());
  });

  test('run-generation', () => {
    for (let depth = 0; depth <= 12; depth += 1) {
      const runA = generateRun('expedition', depth, 9000 + depth);
      const runB = generateRun('expedition', depth, 9000 + depth);
      equal(JSON.stringify(runA), JSON.stringify(runB));
      equal(runA.encounters.length, 7);
      equal(runA.encounters[6].type, 'boss');
      runA.encounters.filter((entry) => ['battle', 'elite', 'boss'].includes(entry.type)).forEach((entry) => {
        const arena = generateArena(entry, depth);
        assert(arena.nodes.length >= 7, 'arena nodes');
        if (entry.type === 'boss') assert(Boolean(arena.boss), 'boss exists');
        else assert(arena.enemies.length >= 2, 'enemies exist');
      });
    }
  });

  test('mode-generation', () => {
    const rush = generateRun('bossRush', 6, 321);
    equal(rush.encounters.length, 3);
    equal(rush.encounters.map((entry) => entry.bossId).join(','), 'ringWarden,tetraCrown,vesperCore');
    const dailyA = generateRun('daily', 2, 777);
    const dailyB = generateRun('daily', 2, 777);
    equal(JSON.stringify(dailyA), JSON.stringify(dailyB));
    for (let index = 0; index < 15; index += 1) {
      const encounter = generateEndlessEncounter(555, index, 3);
      equal(encounter.index, index);
      if ((index + 1) % 5 === 0) equal(encounter.type, 'boss');
      else assert(encounter.type === 'battle' || encounter.type === 'elite', 'endless encounter type');
    }
  });

  test('geometry-boundaries', () => {
    near(distancePointToSegment([1, 1, 0], [0, 0, 0], [2, 0, 0]), 1);
    near(distancePointToSegment([3, 0, 0], [0, 0, 0], [2, 0, 0]), 1);
    const triangle = [[0, 0, 0], [4, 0, 0], [0, 4, 0]];
    near(polygonAreaXY(triangle), 8);
    assert(pointInPolygonXY([1, 1, 0], triangle), 'inside polygon');
    assert(!pointInPolygonXY([4, 4, 0], triangle), 'outside polygon');
  });

  test('direct-core-rule', () => {
    const randomLongCrossing = routeHitProfile('lancer', false, 14);
    assert(!randomLongCrossing.critical, 'long graze must not become critical');
    equal(randomLongCrossing.multiplier, 1);
    const aimedLongStrike = routeHitProfile('lancer', true, 14);
    assert(aimedLongStrike.critical, 'selected core must be critical');
    near(aimedLongStrike.multiplier, 1.35);
    const otherChassis = routeHitProfile('weaver', true, 14);
    assert(otherChassis.critical, 'direct core remains critical');
    equal(otherChassis.multiplier, 1);
    const firstArena = generateArena({ index: 0, type: 'battle', seed: 42, theme: 'rim' }, 0);
    equal(firstArena.enemies.map((enemy) => enemy.type).join(','), 'seeker,lancer');
    const secondArena = generateArena({ index: 1, type: 'battle', seed: 43, theme: 'rim' }, 0);
    equal(secondArena.enemies[0].type, 'warden');
  });

  test('module-candidates', () => {
    const ids = MODULES.map((entry) => entry.id);
    const candidates = chooseModuleCandidates(ids, {}, 33);
    equal(candidates.length, 3);
    equal(new Set(candidates).size, 3);
    const capped = Object.fromEntries(ids.map((id) => [id, 3]));
    equal(chooseModuleCandidates(ids, capped, 33).length, 0);
  });

  test('save-schema', () => {
    const save = createDefaultSave();
    assert(validateSave(save), 'default save valid');
    assert(validateSave(JSON.parse(JSON.stringify(save))), 'round trip valid');
    assert(!validateSave({ schemaVersion: 99 }), 'invalid save rejected');
    save.stats.bosses.ringWarden = 4;
    save.stats.chassisClears.lancer = 2;
    save.stats.dailyBest['2026-08-03'] = 1234;
    const normalized = new SaveManager().normalize(JSON.parse(JSON.stringify(save)));
    equal(normalized.stats.bosses.ringWarden, 4);
    equal(normalized.stats.chassisClears.lancer, 2);
    equal(normalized.stats.dailyBest['2026-08-03'], 1234);
  });

  test('procedural-model-factories', () => {
    Object.keys(CHASSIS).forEach((id) => assert(createPlayerModel(id).children.length > 0, `player ${id}`));
    Object.keys(ENEMIES).forEach((id) => assert(createEnemyModel(id, id === 'null').children.length > 0, `enemy ${id}`));
    Object.keys(BOSSES).forEach((id) => assert(createBossModel(id).children.length > 0, `boss ${id}`));
    ['rim', 'fracture', 'core'].forEach((id) => assert(createArenaEnvironment(id, 7, 'low').children.length > 0, `environment ${id}`));
  });

  const passed = results.filter((result) => result.ok).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}

function assert(value, message) {
  if (!value) throw new Error(message || 'assertion failed');
}

function equal(actual, expected) {
  if (!Object.is(actual, expected)) throw new Error(`expected ${expected}, got ${actual}`);
}

function near(actual, expected, epsilon = 1e-6) {
  if (Math.abs(actual - expected) > epsilon) throw new Error(`expected near ${expected}, got ${actual}`);
}

export default runSelfTests;
