import {
  ACHIEVEMENTS,
  BOSSES,
  CHASSIS,
  FINAL_UNLOCKS_AT_DEPTH3,
  GAME_VERSION,
  INITIAL_MODULES,
  INITIAL_UNLOCKS_AFTER_ENDING,
  MODES,
  MODULES,
  SAVE_SCHEMA,
  SKINS,
} from './data.js';

const PRIMARY_KEY = 'anchorVector_save_v1';
const BACKUP_KEY = 'anchorVector_save_v1_backup';
const TEMP_KEY = 'anchorVector_save_v1_tmp';

export function createDefaultSave() {
  const now = new Date().toISOString();
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const prefersContrast = window.matchMedia?.('(prefers-contrast: more)').matches || false;
  return {
    schemaVersion: SAVE_SCHEMA,
    gameVersion: GAME_VERSION,
    createdAt: now,
    updatedAt: now,
    settings: {
      master: 0.75,
      music: 0.42,
      sfx: 0.78,
      muted: false,
      haptics: true,
      planningSpeed: 0.16,
      gameSpeed: 1,
      quality: 'auto',
      particleLevel: prefersReduced ? 'low' : 'high',
      reducedMotion: prefersReduced,
      highContrast: prefersContrast,
      colorSymbols: true,
      cameraGesture: true,
      screenShake: !prefersReduced,
    },
    progress: {
      tutorialCompleted: false,
      normalEnding: false,
      trueEnding: false,
      maxDepthUnlocked: 0,
      maxDepthCleared: -1,
      unlockedChassis: ['lancer'],
      unlockedModes: ['expedition'],
      unlockedModules: [...INITIAL_MODULES],
      seenModules: [],
      records: [],
      achievements: [],
      fragments: 0,
      cores: 0,
      unlockedSkins: ['cyan'],
      activeSkin: 'cyan',
    },
    stats: {
      runs: 0,
      victories: 0,
      defeats: 0,
      retreats: 0,
      kills: 0,
      bosses: {},
      maxChain: 0,
      maxSealHits: 0,
      noDamageClears: 0,
      chassisClears: {},
      chassisDepths: {},
      endlessBest: 0,
      dailyDates: [],
      dailyBest: {},
      totalFragments: 0,
      playSeconds: 0,
    },
    activeRun: null,
  };
}

export class SaveManager {
  constructor(onNotice = () => {}) {
    this.onNotice = onNotice;
    this.data = null;
    this.dirty = false;
    this.saveTimer = 0;
  }

  load() {
    const primary = this.readKey(PRIMARY_KEY);
    if (primary.ok) {
      this.data = this.normalize(primary.value);
      return { data: this.data, recovered: false, isNew: false };
    }
    const backup = this.readKey(BACKUP_KEY);
    if (backup.ok) {
      this.data = this.normalize(backup.value);
      this.writeNow(false);
      this.onNotice('バックアップからセーブを復旧しました。', 'warning');
      return { data: this.data, recovered: true, isNew: false };
    }
    this.data = createDefaultSave();
    this.writeNow(false);
    if (primary.exists || backup.exists) this.onNotice('セーブを復旧できなかったため、新規データを作成しました。', 'error');
    return { data: this.data, recovered: false, isNew: true };
  }

  readKey(key) {
    let raw = null;
    try {
      raw = localStorage.getItem(key);
      if (!raw) return { ok: false, exists: false };
      const value = JSON.parse(raw);
      return { ok: validateSave(value), exists: true, value };
    } catch (error) {
      return { ok: false, exists: raw !== null, error };
    }
  }

  normalize(value) {
    const defaults = createDefaultSave();
    const result = deepMerge(defaults, value);
    const moduleIds = new Set(MODULES.map((item) => item.id));
    const chassisIds = new Set(Object.keys(CHASSIS));
    const modeIds = new Set(Object.keys(MODES));
    const skinIds = new Set(SKINS.map((item) => item.id));
    const achievementIds = new Set(ACHIEVEMENTS.map((item) => item.id));
    result.schemaVersion = SAVE_SCHEMA;
    result.gameVersion = GAME_VERSION;
    for (const key of ['master', 'music', 'sfx']) result.settings[key] = clampNumber(result.settings[key], 0, 1, defaults.settings[key]);
    result.settings.planningSpeed = closestNumber(result.settings.planningSpeed, [0.08, 0.16, 0.25], defaults.settings.planningSpeed);
    result.settings.gameSpeed = closestNumber(result.settings.gameSpeed, [0.8, 1], defaults.settings.gameSpeed);
    if (!['auto', 'high', 'medium', 'low'].includes(result.settings.quality)) result.settings.quality = defaults.settings.quality;
    if (!['high', 'low', 'off'].includes(result.settings.particleLevel)) result.settings.particleLevel = defaults.settings.particleLevel;
    for (const key of ['muted', 'haptics', 'reducedMotion', 'highContrast', 'colorSymbols', 'cameraGesture', 'screenShake']) result.settings[key] = Boolean(result.settings[key]);
    result.progress.unlockedModules = unique(result.progress.unlockedModules).filter((id) => moduleIds.has(id));
    result.progress.unlockedChassis = unique(result.progress.unlockedChassis).filter((id) => chassisIds.has(id));
    result.progress.unlockedModes = unique(result.progress.unlockedModes).filter((id) => modeIds.has(id));
    result.progress.records = unique(result.progress.records).filter((index) => Number.isInteger(index) && index >= 0 && index < 12);
    result.progress.achievements = unique(result.progress.achievements).filter((id) => achievementIds.has(id));
    result.progress.unlockedSkins = unique(result.progress.unlockedSkins).filter((id) => skinIds.has(id));
    if (!skinIds.has(result.progress.activeSkin) || !result.progress.unlockedSkins.includes(result.progress.activeSkin)) result.progress.activeSkin = 'cyan';
    result.progress.maxDepthUnlocked = integerInRange(result.progress.maxDepthUnlocked, 0, 12, 0);
    result.progress.maxDepthCleared = integerInRange(result.progress.maxDepthCleared, -1, 12, -1);
    for (const key of ['fragments', 'cores']) result.progress[key] = integerInRange(result.progress[key], 0, Number.MAX_SAFE_INTEGER, 0);
    for (const key of ['runs', 'victories', 'defeats', 'retreats', 'kills', 'maxChain', 'maxSealHits', 'noDamageClears', 'endlessBest', 'totalFragments', 'playSeconds']) {
      result.stats[key] = integerInRange(result.stats[key], 0, Number.MAX_SAFE_INTEGER, 0);
    }
    result.stats.bosses = sanitizeCountMap(result.stats.bosses, Object.keys(BOSSES), 0, Number.MAX_SAFE_INTEGER);
    result.stats.chassisClears = sanitizeCountMap(result.stats.chassisClears, Object.keys(CHASSIS), 0, Number.MAX_SAFE_INTEGER);
    result.stats.chassisDepths = sanitizeCountMap(result.stats.chassisDepths, Object.keys(CHASSIS), -1, 12);
    result.stats.dailyDates = unique(result.stats.dailyDates).filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
    result.stats.dailyBest = Object.fromEntries(Object.entries(result.stats.dailyBest || {}).filter(([date, score]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Number(score))).map(([date, score]) => [date, Math.max(0, Math.round(Number(score)))]));
    result.activeRun = sanitizeActiveRun(result.activeRun, moduleIds, chassisIds, modeIds);
    this.applyMilestones(result);
    return result;
  }

  applyMilestones(data = this.data) {
    const progress = data.progress;
    if (progress.normalEnding) {
      addUnique(progress.unlockedChassis, 'weaver');
      addUnique(progress.unlockedModes, 'daily');
      INITIAL_UNLOCKS_AFTER_ENDING.forEach((id) => addUnique(progress.unlockedModules, id));
    }
    if (progress.maxDepthCleared >= 3) {
      addUnique(progress.unlockedChassis, 'bulwark');
      addUnique(progress.unlockedModes, 'endless');
      FINAL_UNLOCKS_AT_DEPTH3.forEach((id) => addUnique(progress.unlockedModules, id));
    }
    if (progress.maxDepthCleared >= 6) addUnique(progress.unlockedModes, 'bossRush');
    if (progress.trueEnding) addUnique(progress.unlockedSkins, 'white');
    progress.maxDepthUnlocked = Math.max(0, Math.min(12, progress.maxDepthUnlocked | 0));
  }

  markDirty(immediate = false) {
    this.dirty = true;
    window.clearTimeout(this.saveTimer);
    if (immediate) this.writeNow();
    else this.saveTimer = window.setTimeout(() => this.writeNow(), 280);
  }

  writeNow(makeBackup = true) {
    if (!this.data) return false;
    try {
      this.applyMilestones();
      this.data.updatedAt = new Date().toISOString();
      const serialized = JSON.stringify(this.data);
      if (makeBackup) {
        const current = localStorage.getItem(PRIMARY_KEY);
        if (current) localStorage.setItem(BACKUP_KEY, current);
      }
      localStorage.setItem(TEMP_KEY, serialized);
      const verified = JSON.parse(localStorage.getItem(TEMP_KEY));
      if (!validateSave(verified)) throw new Error('temporary save validation failed');
      localStorage.setItem(PRIMARY_KEY, serialized);
      localStorage.removeItem(TEMP_KEY);
      this.dirty = false;
      return true;
    } catch (error) {
      this.onNotice('セーブに失敗しました。端末の空き容量やプライベートモードを確認してください。', 'error');
      return false;
    }
  }

  exportText() {
    this.writeNow();
    return JSON.stringify(this.data, null, 2);
  }

  importText(text) {
    const value = JSON.parse(text);
    if (!validateSave(value)) throw new Error('対応していないセーブ形式です。');
    this.data = this.normalize(value);
    if (!this.writeNow()) throw new Error('セーブを書き込めませんでした。');
    return this.data;
  }

  reset() {
    localStorage.removeItem(PRIMARY_KEY);
    localStorage.removeItem(BACKUP_KEY);
    localStorage.removeItem(TEMP_KEY);
    this.data = createDefaultSave();
    this.writeNow(false);
    return this.data;
  }

  download(filename = 'anchor-vector-save.json') {
    const blob = new Blob([this.exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function validateSave(value) {
  return Boolean(
    value && typeof value === 'object'
    && Number.isInteger(value.schemaVersion)
    && value.schemaVersion >= 1 && value.schemaVersion <= SAVE_SCHEMA
    && value.settings && typeof value.settings === 'object'
    && value.progress && typeof value.progress === 'object'
    && value.stats && typeof value.stats === 'object'
  );
}

function deepMerge(defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? [...value] : [...defaults];
  if (!defaults || typeof defaults !== 'object') return value === undefined ? defaults : value;
  if (!Object.keys(defaults).length) return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  const output = { ...defaults };
  if (!value || typeof value !== 'object') return output;
  for (const key of Object.keys(defaults)) output[key] = deepMerge(defaults[key], value[key]);
  return output;
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function unique(list) {
  return [...new Set(Array.isArray(list) ? list : [])];
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function integerInRange(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

function closestNumber(value, choices, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return choices.reduce((best, choice) => Math.abs(choice - number) < Math.abs(best - number) ? choice : best, choices[0]);
}

function sanitizeCountMap(value, allowedKeys, minimum, maximum) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(allowedKeys.filter((key) => key in source).map((key) => [key, integerInRange(source[key], minimum, maximum, minimum)]));
}

function sanitizeActiveRun(value, moduleIds, chassisIds, modeIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!modeIds.has(value.mode) || !chassisIds.has(value.chassis) || !Number.isFinite(Number(value.seed))) return null;
  if (!Array.isArray(value.encounters) || !value.modules || typeof value.modules !== 'object') return null;
  const run = { ...value };
  run.depth = integerInRange(run.depth, 0, 12, 0);
  run.current = integerInRange(run.current, 0, Number.MAX_SAFE_INTEGER, 0);
  run.seed = Number(run.seed) >>> 0;
  run.modules = Object.fromEntries(Object.entries(run.modules).filter(([id]) => moduleIds.has(id)).map(([id, level]) => [id, integerInRange(level, 1, 3, 1)]));
  for (const key of ['fragments', 'kills', 'damageTaken', 'maxChain', 'maxSealHits', 'retries']) run[key] = integerInRange(run[key], 0, Number.MAX_SAFE_INTEGER, 0);
  run.shields = integerInRange(run.shields, 0, 99, 1);
  run.maxShields = integerInRange(run.maxShields, 1, 99, CHASSIS[run.chassis].shield);
  run.risk = clampNumber(run.risk, 0.5, 100, 1);
  run.bosses = unique(run.bosses).filter((id) => id in BOSSES);
  run.pendingModules = Array.isArray(run.pendingModules) ? unique(run.pendingModules).filter((id) => moduleIds.has(id)).slice(0, 3) : null;
  run.pendingGate = Boolean(run.pendingGate);
  return run;
}

export const SAVE_KEYS = Object.freeze({ primary: PRIMARY_KEY, backup: BACKUP_KEY, temp: TEMP_KEY });
