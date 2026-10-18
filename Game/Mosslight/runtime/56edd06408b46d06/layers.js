// 構造物の層(床・道 / 物体)と、畑・作物の索引。依存: data.js のみ。
// 床(layer:'floor')と物体(壁・家具・灯りなど)は同じタイルに共存できる。
//   state.floorIndex[map]  : Map(タイルindex → 床・道)
//   state.structIndex[map] : Map(タイルindex → 物体)  ※rendererは物体だけをこちらから引く
//   state.farmIndex[map]   : Map(タイルindex → 畑)
//   state.cropIndex[map]   : Map(タイルindex → 作物)
import { STRUCTURES, layerOf } from './data.js';

const MAP_IDS = ['surface', 'underground'];

export function createIndexes() {
  const make = () => Object.fromEntries(MAP_IDS.map((id) => [id, new Map()]));
  return { structIndex: make(), floorIndex: make(), farmIndex: make(), cropIndex: make() };
}

const tileIndex = (state, mapId, x, y) => {
  const m = state.world.maps[mapId];
  return m && x >= 0 && y >= 0 && x < m.w && y < m.h ? y * m.w + x : -1;
};

export function objectAt(state, mapId, x, y) {
  const i = tileIndex(state, mapId, x, y);
  return i < 0 ? null : state.structIndex[mapId].get(i) || null;
}

export function floorAt(state, mapId, x, y) {
  const i = tileIndex(state, mapId, x, y);
  return i < 0 ? null : state.floorIndex[mapId].get(i) || null;
}

// 物体を優先し、なければ床を返す
export function structureAt(state, mapId, x, y) {
  return objectAt(state, mapId, x, y) || floorAt(state, mapId, x, y);
}

export function farmAt(state, mapId, x, y) {
  const i = tileIndex(state, mapId, x, y);
  return i < 0 ? null : state.farmIndex[mapId].get(i) || null;
}

export function cropAt(state, mapId, x, y) {
  const i = tileIndex(state, mapId, x, y);
  return i < 0 ? null : state.cropIndex[mapId].get(i) || null;
}

function bumpStructures(state) {
  state.structRev = (state.structRev || 0) + 1;
  if (state.timers) state.timers.housing = 0; // 家判定は次のステップで必ず取り直す
  state.rev++;
}

// 構造物を登録する。同じ層の同じタイルがすでに埋まっていれば何もせず null
export function addStructureRecord(state, rec) {
  const def = STRUCTURES[rec.type];
  const i = tileIndex(state, rec.map, rec.x, rec.y);
  if (!def || i < 0) return null;
  const idx = layerOf(rec.type) === 'floor' ? state.floorIndex : state.structIndex;
  if (idx[rec.map].has(i)) return null;
  state.structures.push(rec);
  idx[rec.map].set(i, rec);
  if (rec.type === 'door_wood') state.doors.push(rec);
  if (def.container && !state.containers[rec.id]) state.containers[rec.id] = new Array(def.container).fill(null);
  bumpStructures(state);
  return rec;
}

export function removeStructureRecord(state, s) {
  const i = tileIndex(state, s.map, s.x, s.y);
  const at = state.structures.indexOf(s);
  if (at >= 0) state.structures.splice(at, 1);
  const idx = layerOf(s.type) === 'floor' ? state.floorIndex : state.structIndex;
  if (i >= 0 && idx[s.map].get(i) === s) idx[s.map].delete(i);
  if (s.type === 'door_wood') {
    const d = state.doors.indexOf(s);
    if (d >= 0) state.doors.splice(d, 1);
  }
  delete state.containers[s.id];
  bumpStructures(state);
}

export function addFarmRecord(state, map, x, y) {
  const i = tileIndex(state, map, x, y);
  if (i < 0 || state.farmIndex[map].has(i)) return null;
  const f = { map, x, y };
  state.farmland.push(f);
  state.farmIndex[map].set(i, f);
  state.rev++;
  return f;
}

export function removeFarmRecord(state, f) {
  const i = tileIndex(state, f.map, f.x, f.y);
  const at = state.farmland.indexOf(f);
  if (at >= 0) state.farmland.splice(at, 1);
  if (i >= 0 && state.farmIndex[f.map].get(i) === f) state.farmIndex[f.map].delete(i);
  state.rev++;
}

export function addCropRecord(state, c) {
  const i = tileIndex(state, c.map, c.x, c.y);
  if (i < 0 || state.cropIndex[c.map].has(i)) return null;
  state.crops.push(c);
  state.cropIndex[c.map].set(i, c);
  state.rev++;
  return c;
}

export function removeCropRecord(state, c) {
  const i = tileIndex(state, c.map, c.x, c.y);
  const at = state.crops.indexOf(c);
  if (at >= 0) state.crops.splice(at, 1);
  if (i >= 0 && state.cropIndex[c.map].get(i) === c) state.cropIndex[c.map].delete(i);
  state.rev++;
}
