// 苔灯の境 / MOSSLIGHT — 全データ（純粋なデータと小さな参照関数のみ。他モジュールをimportしない）

export const TILE = 32;

/* ------------------------------------------------------------------ 数値 */
export const BALANCE = {
  seed: 0x4D4F5353,
  genVersion: 1,
  tile: TILE,
  mapSize: { surface: [128, 128], underground: [96, 96] },
  step: 1 / 60,
  maxSteps: 5,
  startClock: 80,
  player: {
    hpMax: 100, speed: 4.5, roadBonus: 1.15, shallowMul: 0.6, hungerMul: 0.8,
    // radius: 被弾判定用(戦闘の難度のため据え置き)。footRadius: 足元の円(移動・押し出し・設置の「立っている」判定)。靴の幅に合わせる
    radius: 10, footRadius: 7, reach: 48, buildRange: 6 * TILE, stationRange: 3 * TILE,
    invuln: 0.6, knock: 0.4, actionMove: 0.35,
    rollTime: 0.25, rollDist: 2.5, rollInvuln: 0.2, rollCooldown: 0.8,
    swing: 0.45, hitStart: 0.10, hitEnd: 0.20, hitCone: 100, hitRange: 1.5, hitStop: 0.05,
  },
  hunger: { max: 100, interval: 7.2, sleepCost: 15, starveInterval: 4, starveFloor: 20, eatTime: 0.6 },
  // 時計: 表示時刻 = 6 + tod/25 (1時間=25秒, tod 0 = 06:00)。見た目の太陽(sky.js)と同じ表で、夜の窓・睡眠・BGM を合わせる
  //   dawn 06:00-08:00 / day -17:00 / dusk 17:00-21:00 / night 21:00-04:00(敵の出る窓。175tick) / predawn 04:00-06:00(暗いが敵は出ない)
  day: {
    length: 600, dawn: [0, 50], day: [50, 275], dusk: [275, 375], night: [375, 550], predawn: [550, 600],
    // nightLight/caveLight: 旧 ambientLight 互換の値(0.35..1)。GL の明るさは sky.js の板の表で決まる
    nightLight: 0.35, caveLight: 0.12, caveRadius: 3, sleepFrom: 325, sleepTo: 30,
    // 夜の主人公の光: 灯の代わりにならない小さな手提げ灯(暗い時間だけ。半径タイル・power)。nightRadius は旧名の互換
    nightRadius: 1.4, handLight: { r: 1.4, power: 0.12 },
    musicNight: [325, 475], // 19:00-05:00 の BGM を夜にする窓(main.js が参照できる)
  },
  gather: { bareTime: 0.3, toolTime: 0.4, hitAt: 0.5, retryDelay: 0.9 },
  items: { bagSlots: 30, stack: 99, hotbarSlots: 8, groundLife: 600, magnet: 2 * TILE, pickup: 12, containerSlots: 24 },
  respawn: { playerDistance: 3 * TILE, check: 1 },
  power: { axe: [0, 10, 18, 30], pick: [0, 10, 16, 26] },
  tierNames: ['', '石', '銅', '翠鉄'],
  safe: { radius: 14, radiusAfterForge: 20, spawnGap: [14, 22], spawnCheck: 20 },
  crops: { lightBoost: 1.25, lightRange: 4 },
  explore: { radius: 6 },
  death: { hp: 60, minSatiety: 40, invuln: 2, bagCap: 30 * 99 },
  combat: {
    spawnEvery: 20, leash: 14, despawn: 44, wanderSpeed: 0.5, attackGap: 1.1, projectileLife: 3.2,
    arenaStart: 2, bossHome: 1.5,
  },
  save: { maxStructures: 6000, maxGround: 600, maxFarm: 800, maxNodes: 30000, maxJson: 8000000 },
  npc: { speed: 32 },
};

// 地下の壁の種類(map.wallKind の値)。1〜4は採掘できる。5は遺跡の壁(破壊不可)、6/7は封印扉・闘技場の扉
export const WALL = Object.freeze({ NONE: 0, DIRT: 1, MOSS: 2, COPPER: 3, IRON: 4, RUIN: 5, SEAL: 6, GATE: 7 });
export const WALL_NODE = [null, 'dirt_wall', 'moss_wall', 'copper_wall', 'iron_wall'];

// 構造物の層。'floor'(床・道)と 'object'(家具・壁など)は同じタイルに共存できる
export function layerOf(type) {
  const d = STRUCTURES[type];
  return d && d.layer === 'floor' ? 'floor' : 'object';
}

/* ------------------------------------------------------------------ 地形 */
export const TERRAIN = Object.freeze({
  GRASS: 1, DARKGRASS: 2, DIRT: 3, PATH: 4, SAND: 5, SHALLOW: 6, DEEP: 7, MOSS: 8, ROCKY: 9,
  CLIFF: 10, FARM: 11, CAVE_FLOOR: 12, CAVE_WALL: 13, MOSS_FLOOR: 14, RUIN: 15, BEDROCK: 16,
});

// tile: tiles atlas のname接頭辞。solid: 通れない。speed: 移動倍率。calm/wash: 草地のノイズを抑える描画指定
export const TERRAIN_INFO = [
  { id: 'void', name: '', tile: 'darkgrass', solid: true, speed: 1 },
  { id: 'grass', name: '草地', tile: 'grass', solid: false, speed: 1, calm: '#3d5940', wash: true, step: 'grass' },
  { id: 'darkgrass', name: '森の地面', tile: 'darkgrass', solid: false, speed: 1, calm: '#304936', wash: true, step: 'grass' },
  { id: 'dirt', name: '土', tile: 'dirt', solid: false, speed: 1, step: 'dirt' },
  { id: 'path', name: '道', tile: 'path', solid: false, speed: 1.15, step: 'dirt', road: true },
  { id: 'sand', name: '砂浜', tile: 'sand', solid: false, speed: 1, step: 'sand' },
  { id: 'shallow', name: '浅瀬', tile: 'water', solid: false, speed: 0.6, step: 'water', water: true },
  { id: 'deep', name: '深い水', tile: 'deepwater', solid: true, speed: 1, water: true },
  { id: 'moss', name: '苔の地面', tile: 'moss', solid: false, speed: 1, calm: '#243932', wash: true, step: 'grass' },
  { id: 'rocky', name: '岩場', tile: 'cave', solid: false, speed: 1, step: 'stone' },
  { id: 'cliff', name: '密林', tile: 'darkgrass', solid: true, speed: 1 },
  { id: 'farm', name: '畑', tile: 'farmland', solid: false, speed: 1, step: 'dirt' },
  { id: 'cave_floor', name: '洞窟の床', tile: 'cave', solid: false, speed: 1, step: 'stone' },
  { id: 'cave_wall', name: '洞窟の壁', tile: 'cave', solid: true, speed: 1 },
  { id: 'moss_floor', name: '苔の床', tile: 'moss', solid: false, speed: 1, step: 'grass' },
  { id: 'ruin', name: '遺跡の床', tile: 'ruin', solid: false, speed: 1, step: 'stone' },
  { id: 'bedrock', name: '岩盤', tile: 'cave', solid: true, speed: 1 },
];

/* ------------------------------------------------------------------ アイテム */
export const CATEGORIES = {
  material: '素材', food: '食べ物', seed: '種・苗', tool: '道具', weapon: '武器',
  armor: '防具', trinket: '装飾', placeable: '設置物', key: '大切なもの',
};

const I = (id, name, icon, cat, desc, extra = {}) => [id, {
  id, name, icon, cat, desc, stack: extra.equip ? 1 : BALANCE.items.stack, ...extra,
}];

export const ITEMS = Object.fromEntries([
  // 素材
  I('branch', '枝', 'wood', 'material', '落ち枝。道具の柄や燃料になる。'),
  I('stone', '石', 'stone', 'material', '硬い石。道具や設備の基本。'),
  I('fiber', '繊維', 'fiber', 'material', '草から取れる丈夫な繊維。'),
  I('cloth', '布', 'fiber', 'material', '繊維を編んだ布。'),
  I('resin', '樹脂', 'glowspore', 'material', '木から滲む、ほのかに光る樹脂。'),
  I('wood', '木材', 'wood', 'material', '伐り出した木材。建築と制作に使う。'),
  I('clay', '粘土', 'stone', 'material', '湖岸の粘土。炉や鍋の材料。'),
  I('copper_ore', '銅鉱石', 'copper_ore', 'material', '赤みのある鉱石。精錬炉で溶かす。'),
  I('iron_ore', '翠鉄鉱石', 'iron_ore', 'material', '苔の層で採れる青緑の鉱石。'),
  I('copper_bar', '銅インゴット', 'copper_bar', 'material', '精錬した銅。道具と武具になる。'),
  I('iron_bar', '翠鉄インゴット', 'iron_bar', 'material', '精錬した翠鉄。最も頑丈。'),
  I('glowmoss', '光苔', 'glowspore', 'material', 'やわらかく光る苔。'),
  I('moss_oil', '苔灯油', 'water', 'material', '光苔から搾った灯り用の油。'),
  I('slime_jelly', 'スライムゼリー', 'water', 'material', 'ぷるぷるした緑のゼリー。'),
  I('fur', '毛皮', 'fiber', 'material', '影ギツネ・胞子の小人が落とす柔らかな素材。'),
  I('wing', '翼膜', 'flowers', 'material', '薄くて軽い膜。'),
  I('shell', '甲殻', 'stone', 'material', '岩甲虫の硬い殻。'),
  // 食べ物と種
  I('berry', 'ベリー', 'berry', 'food', 'そのまま食べられる甘酸っぱい実。', { eat: { satiety: 6, hp: 2 } }),
  I('mushroom', 'キノコ', 'mushroom', 'food', '森のキノコ。焼くと食べやすい。'),
  I('moss_potato', '苔芋', 'carrot', 'food', '苔むした土で育つ芋。'),
  I('wheat', '灯麦', 'wheat', 'food', '穂が淡く光る麦。'),
  I('wheat_seed', '灯麦の種', 'seed', 'seed', '耕した畑に植える。', { plant: 'wheat' }),
  I('sapling', '苗', 'seed', 'seed', '苗を持って切り株を調べると、1つ植えて木の再生を60秒に早める。'),
  I('roast_mushroom', '焼きキノコ', 'food', 'food', '香ばしく焼いたキノコ。', { eat: { satiety: 15, hp: 8 } }),
  I('baked_potato', '焼き芋', 'food', 'food', 'ほくほくの焼き芋。', { eat: { satiety: 22, hp: 10 } }),
  I('wheat_bread', '灯麦パン', 'bread', 'food', '素朴で腹持ちのよいパン。', { eat: { satiety: 30, hp: 12 } }),
  I('forest_stew', '森のシチュー', 'stew', 'food', '体が温まる。しばらく足が軽くなる。', { eat: { satiety: 45, hp: 25, buff: { id: 'speed', v: 0.10, time: 180 } } }),
  I('moss_pie', '光苔のパイ', 'salad', 'food', '暗がりで光が少し遠くまで届く。', { eat: { satiety: 35, hp: 15, buff: { id: 'light', v: 2, time: 300 } } }),
  I('potion', '回復薬', 'heart', 'food', '傷にしみる、よく効く薬。', { eat: { satiety: 0, hp: 45 } }),
  // 道具（段階として所持扱い。バッグ枠は使わない）
  I('axe_stone', '石の斧', 'axe', 'tool', '木を伐る。', { tool: 'axe', tier: 1 }),
  I('axe_copper', '銅の斧', 'copper_axe', 'tool', '石の斧より速く伐れる。', { tool: 'axe', tier: 2 }),
  I('axe_iron', '翠鉄の斧', 'iron_axe', 'tool', '一振りで木が倒れる。', { tool: 'axe', tier: 3 }),
  I('pick_stone', '石のツルハシ', 'pickaxe', 'tool', '岩と土壁を砕く。', { tool: 'pick', tier: 1 }),
  I('pick_copper', '銅のツルハシ', 'copper_pickaxe', 'tool', '苔岩の壁も砕ける。', { tool: 'pick', tier: 2 }),
  I('pick_iron', '翠鉄のツルハシ', 'iron_pickaxe', 'tool', '翠鉄の露頭を掘れる。', { tool: 'pick', tier: 3 }),
  I('hoe_stone', '石の鍬', 'pickaxe', 'tool', '地面を耕して畑にする。', { tool: 'hoe', tier: 1 }),
  // 装備
  I('sword_stone', '石の剣', 'sword', 'weapon', '攻撃力 8。', { equip: 'weapon', weapon: { dmg: 8 } }),
  I('sword_copper', '銅の剣', 'copper_sword', 'weapon', '攻撃力 14。', { equip: 'weapon', weapon: { dmg: 14 } }),
  I('sword_iron', '翠鉄の剣', 'iron_sword', 'weapon', '攻撃力 24。', { equip: 'weapon', weapon: { dmg: 24 } }),
  I('tunic_fiber', '繊維の服', 'armor', 'armor', '被ダメージ −1。', { equip: 'armor', armor: { def: 1 } }),
  I('armor_copper', '銅の胸当て', 'copper_armor', 'armor', '被ダメージ −4。', { equip: 'armor', armor: { def: 4 } }),
  I('armor_iron', '翠鉄の鎧', 'iron_armor', 'armor', '被ダメージ −8。', { equip: 'armor', armor: { def: 8 } }),
  I('boots_feather', '軽羽の靴', 'boots', 'trinket', '移動速度 +8%。', { equip: 'trinket', trinket: { speed: 0.08 } }),
  I('charm_shell', '甲殻の護符', 'coin', 'trinket', '被ダメージ −2。', { equip: 'trinket', trinket: { def: 2 } }),
  // 設置物（アイテムid = 構造物type）
  I('torch', 'たいまつ', 'torch', 'placeable', '地面に立てて周りを照らす。', { place: 'torch' }),
  I('workbench', '作業台', 'workbench', 'placeable', '近くで多くの物が作れる。', { place: 'workbench' }),
  I('furnace', '精錬炉', 'furnace', 'placeable', '鉱石や苔を精錬する。', { place: 'furnace' }),
  I('pot', '調理鍋', 'stew', 'placeable', '本格的な料理が作れる。', { place: 'pot' }),
  I('wall_wood', '木の壁', 'wall', 'placeable', '家の壁。', { place: 'wall_wood' }),
  I('door_wood', '木の扉', 'gate', 'placeable', '近づくと自動で開く。', { place: 'door_wood' }),
  I('floor_wood', '木の床', 'floor', 'placeable', '家の床。', { place: 'floor_wood' }),
  I('path_stone', '石畳の道', 'path', 'placeable', '歩きやすい石畳。', { place: 'path_stone' }),
  I('fence_wood', '木の柵', 'fence', 'placeable', '敵を防ぐが、家の壁にはならない。', { place: 'fence_wood' }),
  I('bed', 'ベッド', 'bed', 'placeable', '夕方以降に眠って朝を迎える。', { place: 'bed' }),
  I('chest_wood', '木の箱', 'chest', 'placeable', '24枠の収納。', { place: 'chest_wood' }),
  I('table', 'テーブル', 'workbench', 'placeable', '食卓。', { place: 'table' }),
  I('chair', '椅子', 'workbench', 'placeable', '腰かけ。', { place: 'chair' }),
  I('candlestick', '燭台', 'torch', 'placeable', '光の半径 4。', { place: 'candlestick' }),
  I('lantern_stone', '灯籠', 'lantern', 'placeable', '光の半径 6。', { place: 'lantern_stone' }),
  I('moss_fountain', '苔灯の噴水', 'well', 'placeable', '暮らしを整えた証。やわらかな光が湧く。', { place: 'moss_fountain', reward: true }),
  // 大切なもの（制作不可・消えない・死んでも失わない）
  I('crystal_moss', '光苔結晶', 'relic', 'key', '洞窟の小部屋で光る結晶。', { key: true }),
  I('moss_wick', '苔の灯芯', 'relic', 'key', '母樹から授かった灯芯。', { key: true }),
  I('ancient_wick', '古の灯芯', 'relic', 'key', '古い灯台に捧げる灯芯。', { key: true }),
]);

export function getItem(id) { return ITEMS[id] || null; }

/* ------------------------------------------------------------------ 制作 */
export const STATIONS = {
  hand: { name: '手' },
  workbench: { name: '作業台' },
  furnace: { name: '精錬炉' },
  pot: { name: '調理鍋' },
  campfire: { name: '焚き火' },
};

// 並び順 = 設計書 §3.3 の番号。stations: いずれかが近く(3タイル以内)にあれば作れる
const R = (out, n, station, inputs, extra = {}) => ({
  id: out, out, n, station, stations: extra.stations || [station], inputs, ...extra,
});

export const RECIPES = [
  R('axe_stone', 1, 'hand', { branch: 3, stone: 2, fiber: 2 }),
  R('pick_stone', 1, 'hand', { branch: 3, stone: 3, fiber: 2 }),
  R('sword_stone', 1, 'hand', { branch: 2, stone: 3, fiber: 2 }),
  R('cloth', 1, 'hand', { fiber: 3 }),
  R('torch', 4, 'hand', { branch: 1, resin: 1 }),
  R('workbench', 1, 'hand', { wood: 6, stone: 4 }),
  R('hoe_stone', 1, 'workbench', { branch: 2, stone: 2, fiber: 2 }),
  R('furnace', 1, 'workbench', { stone: 12, clay: 4 }),
  R('pot', 1, 'workbench', { stone: 8, clay: 2 }),
  R('wall_wood', 2, 'workbench', { wood: 2 }),
  R('door_wood', 1, 'workbench', { wood: 4 }),
  R('floor_wood', 4, 'workbench', { wood: 2 }),
  R('path_stone', 4, 'workbench', { stone: 2 }),
  R('fence_wood', 2, 'workbench', { wood: 1, branch: 1 }),
  R('bed', 1, 'workbench', { wood: 6, cloth: 3 }),
  R('chest_wood', 1, 'workbench', { wood: 8 }),
  R('table', 1, 'workbench', { wood: 5 }),
  R('chair', 1, 'workbench', { wood: 3 }),
  R('candlestick', 1, 'workbench', { wood: 1, resin: 2 }),
  R('lantern_stone', 1, 'workbench', { stone: 4, moss_oil: 1 }),
  R('tunic_fiber', 1, 'workbench', { cloth: 4 }),
  R('axe_copper', 1, 'workbench', { copper_bar: 3, wood: 2 }),
  R('pick_copper', 1, 'workbench', { copper_bar: 3, wood: 2 }),
  R('sword_copper', 1, 'workbench', { copper_bar: 4, wood: 1 }),
  R('armor_copper', 1, 'workbench', { copper_bar: 6, cloth: 3 }),
  R('axe_iron', 1, 'workbench', { iron_bar: 3, copper_bar: 1 }),
  R('pick_iron', 1, 'workbench', { iron_bar: 3, copper_bar: 1 }),
  R('sword_iron', 1, 'workbench', { iron_bar: 4, copper_bar: 2 }),
  R('armor_iron', 1, 'workbench', { iron_bar: 6, cloth: 4 }),
  R('boots_feather', 1, 'workbench', { wing: 2, fur: 1 }),
  R('charm_shell', 1, 'workbench', { shell: 3, copper_bar: 1 }),
  R('copper_bar', 1, 'furnace', { copper_ore: 2, wood: 1 }),
  R('iron_bar', 1, 'furnace', { iron_ore: 2, wood: 1 }),
  R('moss_oil', 1, 'furnace', { glowmoss: 2, resin: 1 }),
  R('roast_mushroom', 1, 'pot', { mushroom: 2 }, { stations: ['pot', 'campfire'] }),
  R('baked_potato', 1, 'pot', { moss_potato: 2 }, { stations: ['pot', 'campfire'] }),
  R('wheat_bread', 1, 'pot', { wheat: 3 }),
  R('forest_stew', 1, 'pot', { moss_potato: 2, mushroom: 2, berry: 2 }),
  R('moss_pie', 1, 'pot', { wheat: 2, glowmoss: 2, berry: 2 }),
  R('potion', 1, 'pot', { slime_jelly: 2, berry: 2 }),
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
export function getRecipe(id) { return RECIPE_BY_ID[id] || null; }

/* ------------------------------------------------------------------ 資源ノード */
// hit: マウス選択範囲（足元基準 幅w・高さh）。solid: 衝突円。regen: 再生秒（nullで再生しない）
// sprite/sprites: props のname。scale:0.5 は半分の大きさで描く。tint: 色を重ねる
export const NODES = {
  branch: {
    name: '落ち枝', verb: '拾う', sprite: 'branch', hp: 1, drops: [{ item: 'branch', n: 1 }],
    regen: 180, hit: { w: 28, h: 16 }, spark: true, chip: ['#b18b53', '#765937'],
  },
  pebble: {
    name: '小石', verb: '拾う', sprite: 'pebble', hp: 1, drops: [{ item: 'stone', n: 1 }],
    regen: 180, hit: { w: 26, h: 18 }, spark: true, chip: ['#91a0a2', '#505c67'],
  },
  grass: {
    name: '草', verb: '刈る', sprite: 'grass', hp: 1, sway: true,
    drops: [{ item: 'fiber', n: 2 }, { item: 'wheat_seed', n: 1, chance: 0.1 }],
    regen: 120, hit: { w: 34, h: 24 }, spark: true, chip: ['#71905a', '#527149'],
  },
  berry: {
    name: 'ベリーの茂み', verb: '摘む', sprite: 'berry', depletedSprite: 'bush', hp: 1, sway: true,
    drops: [{ item: 'berry', n: 3 }], regen: 180, hit: { w: 34, h: 26 }, spark: true, chip: ['#b25758', '#527149'],
  },
  mushroom: {
    name: 'キノコ', verb: '採る', sprite: 'mushroom', hp: 1, drops: [{ item: 'mushroom', n: 1 }],
    regen: 200, hit: { w: 26, h: 20 }, spark: true, chip: ['#58b597', '#9c87aa'],
  },
  glowmoss: {
    name: '光苔', verb: '採る', sprite: 'fern', hp: 1, sway: true, glow: { r: 2.4, color: [110, 220, 170] },
    drops: [{ item: 'glowmoss', n: 2 }], regen: 240, hit: { w: 32, h: 26 }, spark: true, chip: ['#58b597', '#91d8af'],
  },
  moss_potato: {
    name: '野生の苔芋', verb: '掘る', sprite: 'crop_potato2', hp: 1, drops: [{ item: 'moss_potato', n: 1 }],
    regen: 300, hit: { w: 28, h: 28 }, spark: true, chip: ['#97ad71', '#765937'],
  },
  tree: {
    name: '木', verb: '伐る', tool: 'axe', hardness: 0, hp: 30, regen: 300, saplingGrow: 60, depletedSprite: 'stump',
    // 当たりは幹の根元の楕円(樹冠は歩行を妨げない)。solid.r=横半径, ry=縦半径(省略時 r×FOOT_ASPECT)。hit は幹と樹冠下部のクリック範囲
    sprites: ['oak', 'oak2', 'pine', 'amber_tree'], solid: { r: 6, ry: 4 }, depletedSolid: { r: 7, ry: 4 }, canopy: true,
    drops: [{ item: 'wood', n: 4 }, { item: 'resin', n: 1 }, { item: 'sapling', n: 1, chance: 0.3 }],
    hit: { w: 30, h: 56 }, chip: ['#977142', '#527149', '#71905a'],
  },
  rock: {
    name: '岩', verb: '砕く', sprite: 'rock', tool: 'pick', hardness: 1, hp: 40, regen: 360,
    solid: { r: 12, ry: 7 }, drops: [{ item: 'stone', n: 5 }], hit: { w: 48, h: 22 }, chip: ['#91a0a2', '#6c7b81', '#505c67'],
  },
  clay: {
    name: '粘土地', verb: '掘る', sprite: 'clay_small', tool: 'pick', hardness: 1,
    hp: 20, regen: 300, drops: [{ item: 'clay', n: 2 }], hit: { w: 30, h: 22 }, chip: ['#d1aa68', '#977142'], clayDots: true,
  },
  copper_deposit: {
    name: '銅鉱床', verb: '砕く', sprite: 'copper', tool: 'pick', hardness: 1, hp: 50, regen: 600,
    solid: { r: 12, ry: 7 }, drops: [{ item: 'copper_ore', n: 3 }], hit: { w: 48, h: 22 }, chip: ['#d69968', '#b27450', '#505c67'],
  },
  // 地下用（次工程で配置・採掘を実装。ここでは数値だけ確定）
  dirt_wall: { name: '土壁', tool: 'pick', hardness: 1, hp: 20, drops: [{ item: 'stone', n: 1 }], regen: null, wall: true },
  moss_wall: { name: '苔岩壁', tool: 'pick', hardness: 2, hp: 40, drops: [{ item: 'stone', n: 2 }], regen: null, wall: true },
  copper_wall: { name: '銅鉱壁', tool: 'pick', hardness: 1, hp: 30, drops: [{ item: 'copper_ore', n: 2 }], regen: null, wall: true },
  iron_wall: { name: '翠鉄鉱壁', tool: 'pick', hardness: 2, hp: 50, drops: [{ item: 'iron_ore', n: 2 }], regen: null, wall: true },
  iron_outcrop: {
    name: '翠鉄の露頭', verb: '砕く', sprite: 'iron', tool: 'pick', hardness: 2, hp: 60, regen: 900,
    solid: { r: 12, ry: 7 }, drops: [{ item: 'iron_ore', n: 3 }], hit: { w: 46, h: 22 }, chip: ['#c0cbbe', '#91a0a2'],
  },
  // 装飾（採集不可）と目印
  decor: { name: '', decor: true },
  border_pine: { name: '', decor: true, sprite: 'pine' },
  tower: {
    name: '境の塔', verb: '見る', landmark: true, sprite: 'beacon', backSprite: 'ruin_arch', solid: { r: 20 },
    hit: { w: 56, h: 74 }, info: '境の塔。三つの灯が戻れば、この火皿にも火が灯るという。',
  },
  forge_altar: {
    name: '炉の祭壇', verb: '調べる', landmark: true, sprite: 'altar', solid: { r: 18 }, hit: { w: 48, h: 60 }, altar: 'forge',
    info: '炉の祭壇。いまは静かに眠っている。いつか、銅と油と温かな料理を捧げよう。',
  },
  cave_stairs: {
    name: '洞窟の入口', verb: '降りる', landmark: true, sprite: 'stairs', hit: { w: 44, h: 36 }, stairs: 'down',
    info: '暗い階段が続いている。灯りと装備を整えてから降りよう。',
  },
  // 地下の仕掛け。状態は state.progress と state.nodes(respawnAt=Infinity で消えた扱い)から決まる
  cave_exit: {
    name: '地上への階段', verb: '昇る', landmark: true, sprite: 'stairs', hit: { w: 44, h: 36 }, stairs: 'up',
    info: '地上の光が差している。',
  },
  moss_altar: {
    name: '苔の祭壇', verb: '捧げる', landmark: true, sprite: 'altar', tint: ['#58b597', 0.28], solid: { r: 18 }, hit: { w: 48, h: 60 },
    altar: 'moss', glow: { r: 3, color: [110, 220, 170] },
    info: '苔むした祭壇。光苔結晶を三つ捧げると、母樹が目を覚ますという。',
  },
  crystal_node: {
    name: '光苔結晶', verb: '取る', sprite: 'crystal', hp: 1, drops: [{ item: 'crystal_moss', n: 1 }], regen: null,
    hit: { w: 34, h: 40 }, glow: { r: 4, color: [140, 240, 220] }, crystal: true, seeThrough: true, chip: ['#8fe6d0', '#58b597'],
  },
  dish: {
    name: '灯皿', verb: '灯す', landmark: true, sprite: 'beacon', solid: { r: 14 }, hit: { w: 44, h: 60 }, dish: true,
    info: '古い灯皿。苔灯油を注げば火が灯りそうだ。',
  },
  lighthouse: {
    name: '古灯台', verb: '調べる', landmark: true, sprite: 'beacon', backSprite: 'ruin_arch', solid: { r: 20 }, hit: { w: 56, h: 74 },
    altar: 'ancient', info: '古い灯台。古の灯芯を置けば、境に最後の灯がともるだろう。',
  },
  seal_door: {
    name: '封印扉', verb: '調べる', landmark: true, sprite: 'ritual_gate', hit: { w: 40, h: 56 }, seal: true,
    info: '封印された扉。炉の灯と苔の灯、二つが戻れば開くという。',
  },
  arena_gate: {
    name: '闘技場の扉', verb: '調べる', landmark: true, sprite: 'ritual_gate', hit: { w: 60, h: 56 }, gate: true,
    info: '闘技場への扉。三つの灯皿に火が灯れば開くだろう。',
  },
  return_vine: {
    name: '帰還の蔓', verb: 'つかむ', landmark: true, sprite: 'fern', scale: 1.4, hit: { w: 44, h: 50 }, vine: true,
    glow: { r: 2.4, color: [110, 220, 170] }, info: '祭壇と炉の祭壇をつなぐ蔓。',
  },
};

/* ------------------------------------------------------------------ 足元の共通アンカー(描画・当たり・クリックで共有) */
// ノード/構造物のスプライトは pivot(=ノードの px,py)を地面の足元として描く。当たりとクリックの基準も同じ足元に置く。
// FOOTPRINTS[スプライト名]: pivot から「根元の中心」への変位 dx,dy(反転しない向きで +x=右)。反転(mirror)した物は dx の符号を反転する。
//   art/measure_footprints.py の計測値で差し替える表。計測前は 0(根元の中心 = pivot)。rx/ry で当たりの楕円を上書きできる。
export const FOOT_ASPECT = 0.55; // 足元の楕円の縦横比(奥行きの圧縮)。solid.ry が無い時は r × この値
export const FOOTPRINTS = {
  oak: { dx: 0, dy: 0 }, oak2: { dx: 0, dy: 0 }, pine: { dx: 0, dy: 0 }, amber_tree: { dx: 0, dy: 0 },
  stump: { dx: 0, dy: 0 },
  rock: { dx: 2, dy: -9, rx: 24, ry: 7 },
  copper: { dx: -4, dy: -9, rx: 24, ry: 7 },
  iron: { dx: -4, dy: -9, rx: 23, ry: 7 },
};
// 決定的に左右反転してよい自然物(型)と、decor のうち反転してよいスプライト。建築物・目印・文字のある物は反転しない
export const MIRROR_NODE_TYPES = new Set([
  'tree', 'rock', 'copper_deposit', 'iron_outcrop', 'berry', 'grass', 'mushroom', 'glowmoss', 'branch', 'pebble', 'clay', 'moss_potato', 'border_pine',
]);
export const MIRROR_SPRITES = new Set(['oak', 'oak2', 'pine', 'amber_tree', 'rock', 'bush', 'berry', 'fern', 'flower', 'flowers', 'log', 'stump', 'barrel', 'mushroom']);
export function baseSprite(name) { return String(name || '').replace(/_v\d+$/, ''); }
export function nodeMirrored(node) {
  if (!node || !node.flip || (node.meta && node.meta.noMirror)) return false;
  const d = NODES[node.type];
  return MIRROR_NODE_TYPES.has(node.type) || !!(d && d.decor && MIRROR_SPRITES.has(baseSprite(node.sprite)));
}
// 足元の楕円の半径。solid は {r, ry?} か数。戻り値は {rx, ry}
export function footEllipse(solid) {
  const rx = typeof solid === 'number' ? solid : solid.r;
  const ry = typeof solid === 'object' && solid.ry != null ? solid.ry : Math.max(3, Math.round(rx * FOOT_ASPECT));
  return { rx, ry };
}
// アンカー(px,py)・反転・スプライト名から根元の中心
export function footCenter(sprite, mirrored, px, py) {
  const f = FOOTPRINTS[baseSprite(sprite)];
  const dx = f ? f.dx : 0, dy = f ? f.dy : 0;
  return { x: px + (mirrored ? -dx : dx), y: py + dy };
}

/* ------------------------------------------------------------------ 構造物 */
// solid: 'box'=タイル全体 / {r}=円(足元の楕円。中心は描く足元 ty*TILE+28)。light: タイル単位の半径。item: 取り壊し時に戻るアイテム
export const STRUCTURES = {
  campfire: {
    name: '焚き火', sprite: 'campfire', station: 'campfire', provides: ['campfire'], solid: { r: 12 }, fixed: true,
    light: { r: 5.5, color: [255, 170, 80], flicker: 1 }, verb: '調理する', use: 'craft',
  },
  workbench: { name: '作業台', item: 'workbench', sprite: 'workbench', provides: ['workbench'], solid: 'box', verb: '使う', use: 'craft' },
  furnace: {
    name: '精錬炉', item: 'furnace', sprite: 'furnace', provides: ['furnace'], solid: 'box', verb: '使う', use: 'craft',
    light: { r: 3, color: [255, 150, 70], flicker: 0.6 },
  },
  pot: {
    name: '調理鍋', item: 'pot', sprite: 'campfire', overlay: 'pot', provides: ['pot', 'campfire'], solid: { r: 12 }, verb: '使う', use: 'craft',
    light: { r: 3.5, color: [255, 170, 80], flicker: 1 },
  },
  wall_wood: { name: '木の壁', item: 'wall_wood', sprite: 'wall', solid: 'box', kind: 'wall' },
  door_wood: { name: '木の扉', item: 'door_wood', sprite: 'gate', solid: 'box', kind: 'door' },
  floor_wood: { name: '木の床', item: 'floor_wood', sprite: 'floor', layer: 'floor' },
  path_stone: { name: '石畳の道', item: 'path_stone', tile: 'ruin', layer: 'floor', speed: 1.15 },
  fence_wood: { name: '木の柵', item: 'fence_wood', sprite: 'fence', solid: 'box', kind: 'fence' },
  bed: { name: 'ベッド', item: 'bed', sprite: 'bed', solid: 'box', verb: '眠る', use: 'sleep' },
  chest_wood: { name: '木の箱', item: 'chest_wood', sprite: 'chest', solid: 'box', container: BALANCE.items.containerSlots, verb: '開ける', use: 'container' },
  table: { name: 'テーブル', item: 'table', sprite: 'workbench', tint: ['#edcd91', 0.18], solid: 'box' },
  chair: { name: '椅子', item: 'chair', sprite: 'workbench', scale: 0.5 },
  candlestick: { name: '燭台', item: 'candlestick', sprite: 'torch', scale: 0.5, light: { r: 4, color: [255, 190, 100], flicker: 0.8 } },
  lantern_stone: { name: '灯籠', item: 'lantern_stone', sprite: 'lantern', solid: { r: 8 }, light: { r: 6, color: [255, 200, 110], flicker: 0.4 } },
  torch: { name: 'たいまつ', item: 'torch', sprite: 'torch', solid: { r: 6 }, light: { r: 3.5, color: [255, 160, 70], flicker: 1 } },
  moss_fountain: {
    name: '苔灯の噴水', item: 'moss_fountain', sprite: 'well', solid: 'box', light: { r: 5, color: [130, 230, 190], flicker: 0.3 },
  },
};

// 作物の成長を早める灯り(4タイル以内)
export const GROWTH_LIGHTS = ['candlestick', 'lantern_stone', 'torch'];

/* ------------------------------------------------------------------ 作物・敵・ボス・NPC・灯 */
export const CROPS = {
  moss_potato: { name: '苔芋', seed: 'moss_potato', stages: 3, stageTime: 60, harvest: [{ item: 'moss_potato', n: 3 }] },
  wheat: { name: '灯麦', seed: 'wheat_seed', stages: 3, stageTime: 80, harvest: [{ item: 'wheat', n: 3 }, { item: 'wheat_seed', n: 2 }] },
};

export const ENEMIES = {
  slime: {
    name: '苔スライム', sprite: 'slime', map: 'surface', cap: 6, hp: 20, def: 0, telegraph: 0.5, attack: 'leap', range: 3, dmg: 6,
    radius: 10, sense: 5, drop: [{ item: 'slime_jelly', n: 1 }], speed: 1.7, atkDur: 0.32, recover: 0.6, color: '#7be08c',
  },
  shroom: {
    // 設計の「影ギツネ」。アセット契約により胞子の小人の見た目で描く
    name: '胞子の小人', alias: 'fox', sprite: 'shroom', map: 'surface', night: true, cap: 4, hp: 35, def: 0, telegraph: 0.6, attack: 'dash',
    range: 5, dmg: 10, radius: 12, sense: 8, drop: [{ item: 'fur', n: 1 }], speed: 2.6, atkDur: 0.34, recover: 0.7, color: '#ff6b5b',
  },
  wisp: {
    // 設計の「穴コウモリ」。迷い火の見た目で描く
    name: '迷い火', alias: 'bat', sprite: 'wisp', map: 'underground', cap: 5, hp: 15, def: 0, telegraph: 0.4, attack: 'dive', range: 4, dmg: 5,
    radius: 10, sense: 6, drop: [{ item: 'wing', n: 1 }], speed: 3, atkDur: 0.36, recover: 0.6, color: '#9fd8ff',
  },
  beetle: {
    name: '岩甲虫', sprite: 'beetle', map: 'underground', layers: ['moss', 'ruin'], cap: 4, hp: 60, def: 3, telegraph: 0.8,
    attack: 'dash', range: 4, recover: 1.2, dmg: 14, radius: 14, sense: 6, drop: [{ item: 'shell', n: 1 }],
    speed: 1.9, atkDur: 0.45, color: '#ffb347',
  },
};

export const BOSSES = {
  vine: {
    name: '苔の母樹ヌシカズラ', sprite: 'boss_moss', hp: 400, def: 0, radius: 36, arena: 7, reward: [{ item: 'moss_wick', n: 1 }, { item: 'iron_ore', n: 10 }],
    attacks: {
      lash: { telegraph: 1.0, length: 6, width: 1, dmg: 18 },
      spore: { telegraph: 1.2, dirs: 8, speed: 3, dmg: 8 },
    },
    phase2: { hpBelow: 0.5, summon: { enemy: 'slime', n: 2, every: 15, max: 4 } },
    rematch: [{ item: 'iron_ore', n: 10 }],
  },
  ash: {
    name: '灰の番人', sprite: 'boss_crystal', hp: 700, def: 4, radius: 36, arena: 7, reward: [{ item: 'ancient_wick', n: 1 }],
    attacks: {
      sweep: { telegraph: 0.7, arc: 120, range: 2.5, dmg: 22 },
      ring: { telegraph: 1.2, dmg: 20, doubleBelow: 0.5 },
      charge: { telegraph: 0.9, dist: 8, stun: 2, stunMul: 1.5, dmg: 24 },
    },
    rematch: [{ item: 'iron_ore', n: 10 }],
  },
  common: { resetDistance: 10, resetTime: 5 },
};

export const NPCS = {
  cook: { name: '料理番 ツグミ', sprite: 'npc_gardener', tint: ['#d97b6a', 0.25], houses: 1, produce: { item: 'baked_potato', every: 300, cap: 5 } },
  farmer: { name: '農夫 アオイ', sprite: 'npc_gardener', houses: 2, plots: 4, every: 20, cap: 40 },
  builder: { name: '大工 ハシバ', sprite: 'npc_builder', houses: 3, needLight: 'forge', produce: [{ item: 'wood', n: 6, cap: 60 }, { item: 'stone', n: 6, cap: 60 }], every: 300 },
  arriveDelay: 10,
};

export const LIGHTS = {
  forge: {
    name: '炉の灯', offer: [{ item: 'copper_bar', n: 4 }, { item: 'moss_oil', n: 2 }, { item: 'forest_stew', n: 1 }], needHouses: 1,
    safeRadius: BALANCE.safe.radiusAfterForge,
  },
  moss: { name: '苔の灯', crystals: 3, boss: 'vine', wick: 'moss_wick' },
  ancient: { name: '古灯', needLights: ['forge', 'moss'], dishes: 3, boss: 'ash', wick: 'ancient_wick' },
};

/* ------------------------------------------------------------------ 配置の手組み */
// 座標は野営地C(40,72)からの相対タイル。野営地を「絵」として組むための指定
export const CAMP_LAYOUT = {
  center: [40, 72],
  spawn: [1, 1],
  forgeAltar: [6, -3],
  tower: [-5, -6],
  lake: { center: [78, 74], radius: 14 },
  cave: [92, 36],
  hollow: [30, 50],
  chest: { at: [-2, -1], items: [{ id: 'wheat_seed', n: 3 }] },
  decor: [
    { sprite: 'sign', at: [3, 1], info: '【苔灯の境】東は湖と洞窟へ、北西の窪地には光苔が咲く。まずは落ちている枝・石・草を拾って道具を作ろう。', name: '立て札', solid: 6 },
    { sprite: 'barrel', at: [-3, -1], solid: 10 },
    { sprite: 'log', at: [2, -1] },
    { sprite: 'log', at: [-2, 2], flip: true },
    { sprite: 'flowers', at: [-1, -2] },
    { sprite: 'flowers', at: [4, 2] },
    { sprite: 'flowers', at: [-4, 0] },
    { sprite: 'flowers', at: [1, 4] },
    { sprite: 'flowers', at: [-6, 3] },
    { sprite: 'flowers', at: [6, 0] },
  ],
  trees: [
    ['oak', -9, -1], ['pine', -10, 3], ['oak2', 9, -3], ['oak', 8, 5], ['pine', 2, -8], ['amber_tree', -7, -5],
    ['oak', 6, -7], ['pine', -3, 8], ['oak2', -8, 6], ['oak', 4, 8],
  ],
  starter: {
    branch: [[-4, -2], [4, -2], [-5, 3], [5, 4], [0, 5], [2, -3]],
    pebble: [[6, -2], [-3, 4], [1, -3], [3, 5], [-6, 1]],
    grass: [[-4, 0], [-4, 2], [-3, 1], [3, 3], [4, 4], [-1, -3], [6, 3]],
    berry: [[-6, -1], [6, 5], [-2, 6]],
    mushroom: [[-6, 5], [7, -3]],
    rock: [[-7, -2], [7, 2]],
  },
};

// 遺跡の手作りテンプレート（地下座標。次工程で壁・床・灯皿・闘技場を生成する）
export const RUIN_TEMPLATE = {
  origin: [56, 30], size: [37, 61],
  seal: [56, 44], arena: { center: [80, 76], radius: 7 }, beacon: [80, 86],
  dishes: [[61, 38], [86, 38], [72, 60]],
  rooms: [
    [57, 38, 12, 12], [69, 43, 14, 3], [76, 34, 14, 18], [78, 52, 3, 16],
    [66, 54, 14, 10], [73, 66, 14, 20], [77, 84, 7, 6],
  ],
};

// 地下の固定配置(地下座標)。結晶の小部屋は苔層の床1マス。主通路の縁から2タイル以内、互いに15タイル以上離す
export const CAVE_LAYOUT = {
  stairs: [10, 10], hub: [24, 24], mossAltar: [24, 70], spawn: [10, 11],
  mossArena: { center: [24, 70], radius: 7 },
  boss: { vine: [24, 66], ash: [80, 76] },
  crystalRooms: [[21, 56], [34, 41], [50, 47]],
  returnVine: { surface: [2, 1], underground: [3, 2] },
  arenaGate: { tiles: [[78, 65], [79, 65], [80, 65]], node: [79, 65] },
  layerSplit: 70,
  guarantee: { copperWalls: 30, ironWalls: 40, outcrops: 6, glowmoss: 44, mushroom: 18 },
};

export const ICON_NAMES = [
  'wood', 'stone', 'fiber', 'berry', 'mushroom', 'seed', 'wheat', 'carrot', 'copper_ore', 'iron_ore', 'crystal', 'coal',
  'copper_bar', 'iron_bar', 'relic', 'glowspore', 'axe', 'pickaxe', 'sword', 'copper_axe', 'copper_pickaxe', 'copper_sword',
  'iron_axe', 'iron_pickaxe', 'iron_sword', 'armor', 'copper_armor', 'iron_armor', 'torch', 'lantern', 'campfire',
  'workbench', 'furnace', 'chest', 'bed', 'house', 'well', 'fence', 'gate', 'wall', 'floor', 'path', 'bridge', 'carpet',
  'flowers', 'beacon', 'bread', 'stew', 'salad', 'fish', 'fishing_rod', 'water', 'coin', 'heart', 'food', 'map', 'journal',
  'hammer', 'bag', 'boots',
];

/* ------------------------------------------------------------------ 検証 */
export function validateData() {
  const errors = [];
  const icons = new Set(ICON_NAMES);
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.id !== id) errors.push(`item ${id}: id不一致`);
    if (!icons.has(it.icon)) errors.push(`item ${id}: 未知のアイコン ${it.icon}`);
    if (it.place && !STRUCTURES[it.place]) errors.push(`item ${id}: 未知の構造物 ${it.place}`);
  }
  if (RECIPES.length !== 40) errors.push(`レシピ数が40ではない: ${RECIPES.length}`);
  const seen = new Set();
  for (const r of RECIPES) {
    if (seen.has(r.id)) errors.push(`recipe ${r.id}: 重複`);
    seen.add(r.id);
    if (!ITEMS[r.out]) errors.push(`recipe ${r.id}: 出力アイテムなし`);
    if (ITEMS[r.out] && ITEMS[r.out].key) errors.push(`recipe ${r.id}: 鍵アイテムは制作不可`);
    for (const s of r.stations) if (!STATIONS[s]) errors.push(`recipe ${r.id}: 未知の設備 ${s}`);
    for (const [k, v] of Object.entries(r.inputs)) {
      if (!ITEMS[k]) errors.push(`recipe ${r.id}: 未知の材料 ${k}`);
      if (!(v > 0)) errors.push(`recipe ${r.id}: 個数が不正 ${k}`);
    }
  }
  for (const [id, s] of Object.entries(STRUCTURES)) {
    if (s.item && !ITEMS[s.item]) errors.push(`structure ${id}: 未知のitem ${s.item}`);
    if (!s.sprite && !s.tile) errors.push(`structure ${id}: 描画指定なし`);
  }
  for (const [id, n] of Object.entries(NODES)) {
    for (const d of n.drops || []) if (!ITEMS[d.item]) errors.push(`node ${id}: 未知のドロップ ${d.item}`);
  }
  for (const [id, c] of Object.entries(CROPS)) {
    if (!ITEMS[c.seed]) errors.push(`crop ${id}: 種なし`);
    for (const h of c.harvest) if (!ITEMS[h.item]) errors.push(`crop ${id}: 未知の収穫物 ${h.item}`);
  }
  for (const [id, e] of Object.entries(ENEMIES)) {
    for (const d of e.drop || []) if (!ITEMS[d.item]) errors.push(`enemy ${id}: 未知のドロップ ${d.item}`);
    if (e.telegraph < 0.4) errors.push(`enemy ${id}: 予兆が0.4秒未満`);
  }
  for (const [id, b] of Object.entries(BOSSES)) {
    if (id === 'common') continue;
    for (const d of [...(b.reward || []), ...(b.rematch || [])]) if (!ITEMS[d.item]) errors.push(`boss ${id}: 未知の報酬 ${d.item}`);
    for (const [name, a] of Object.entries(b.attacks)) if (a.telegraph < 0.4) errors.push(`boss ${id}.${name}: 予兆が0.4秒未満`);
  }
  for (const o of LIGHTS.forge.offer) if (!ITEMS[o.item]) errors.push(`light forge: 未知の供物 ${o.item}`);
  for (const [id, n] of Object.entries(NPCS)) {
    if (id === 'arriveDelay') continue;
    for (const p of [].concat(n.produce || [])) if (!ITEMS[p.item]) errors.push(`npc ${id}: 未知の生産物 ${p.item}`);
  }
  for (const k of ['crystal_moss', 'moss_wick', 'ancient_wick']) if (!ITEMS[k] || !ITEMS[k].key) errors.push(`鍵アイテム ${k} が不正`);
  return { ok: errors.length === 0, errors };
}
