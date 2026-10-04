/* 残り火の深庭 / EMBERVEIL — 定義データ（ロジックなし）。
   キーとIDは担当間の契約。変更は末尾追加のみ。DESIGN.md §5〜§21 に対応。 */

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

const INF = 99; // 破壊不可の硬度

/* ───────── 地面 ───────── */
const GROUND = [
  { id: 0, key: 'void', name: '虚無', en: 'Void', walk: false, liquid: null, fish: false, bridge: null, step: null, mapColor: '#07090c' },
  { id: 1, key: 'moss_floor', name: '苔床', en: 'Moss Floor', walk: true, liquid: null, fish: false, bridge: null, step: 'moss', mapColor: '#2e5a3c' },
  { id: 2, key: 'loam_floor', name: '土の床', en: 'Loam Floor', walk: true, liquid: null, fish: false, bridge: null, step: 'moss', mapColor: '#4a3a2c' },
  { id: 3, key: 'stone_floor', name: '岩床', en: 'Stone Floor', walk: true, liquid: null, fish: false, bridge: null, step: 'stone', mapColor: '#3b4a56' },
  { id: 4, key: 'crystal_floor', name: '晶床', en: 'Crystal Floor', walk: true, liquid: null, fish: false, bridge: null, step: 'crystal', mapColor: '#3a3f8f' },
  { id: 5, key: 'ash_floor', name: '灰床', en: 'Ash Floor', walk: true, liquid: null, fish: false, bridge: null, step: 'ash', mapColor: '#4a3a38' },
  { id: 6, key: 'ruin_floor', name: '遺跡の石畳', en: 'Ruin Tiles', walk: true, liquid: null, fish: false, bridge: null, step: 'stone', mapColor: '#5a4a40' },
  { id: 7, key: 'shrine_floor', name: '祠の床', en: 'Shrine Floor', walk: true, liquid: null, fish: false, bridge: null, step: 'stone', mapColor: '#7c8a90' },
  { id: 8, key: 'vent', name: '噴気口', en: 'Vent', walk: true, liquid: null, fish: false, bridge: null, step: 'stone', mapColor: '#a8431c' },
  { id: 9, key: 'water', name: '水', en: 'Water', walk: false, liquid: 'water', fish: true, bridge: ['wood', 'stone'], step: null, mapColor: '#1e5266' },
  { id: 10, key: 'hot_spring', name: '温泉', en: 'Hot Spring', walk: false, liquid: 'water', fish: true, bridge: ['wood', 'stone'], step: null, mapColor: '#3c8fa3' },
  { id: 11, key: 'chasm', name: '裂け目', en: 'Chasm', walk: false, liquid: 'chasm', fish: false, bridge: ['wood', 'stone'], step: null, mapColor: '#0b0f14' },
  { id: 12, key: 'lava', name: '溶岩', en: 'Lava', walk: false, liquid: 'lava', fish: false, bridge: ['stone'], step: null, mapColor: '#ff5a1f' },
];

/* ───────── 壁 ───────── */
// drop: {item,min,max}。placed: 設置物（撤去で回収）。glass: 光を通す。
const WALL = [
  { id: 0, key: 'none', name: 'なし', en: 'None', hardness: 0, hp: 0, drop: null, mapColor: '#000000' },
  { id: 1, key: 'loam_wall', name: '土壁', en: 'Loam Wall', hardness: 0, hp: 3, drop: { item: 'loam', min: 1, max: 1 }, mapColor: '#6a5240' },
  { id: 2, key: 'rock_wall', name: '岩壁', en: 'Rock', hardness: 1, hp: 6, drop: { item: 'stone', min: 1, max: 1 }, mapColor: '#2a3540' },
  { id: 3, key: 'copper_vein', name: '銅鉱脈', en: 'Copper Vein', hardness: 1, hp: 8, drop: { item: 'copper_ore', min: 2, max: 3 }, ore: 'copper', mapColor: '#c4733a' },
  { id: 4, key: 'coal_vein', name: '石炭脈', en: 'Coal Seam', hardness: 1, hp: 8, drop: { item: 'coal', min: 2, max: 3 }, mapColor: '#14181d' },
  { id: 5, key: 'hard_rock', name: '硬岩', en: 'Hard Rock', hardness: 2, hp: 10, drop: { item: 'stone', min: 1, max: 1 }, mapColor: '#2b3050' },
  { id: 6, key: 'crystal_vein', name: '結晶脈', en: 'Prism Vein', hardness: 2, hp: 12, drop: { item: 'crystal', min: 2, max: 3 }, ore: 'crystal', mapColor: '#8fb4ff' },
  { id: 7, key: 'burnt_rock', name: '焼岩', en: 'Burnt Rock', hardness: 2, hp: 12, drop: { item: 'stone', min: 1, max: 1 }, mapColor: '#3a2622' },
  { id: 8, key: 'obsidian_rock', name: '黒曜岩', en: 'Obsidian', hardness: 3, hp: 14, drop: { item: 'obsidian', min: 1, max: 1 }, mapColor: '#1a1424' },
  { id: 9, key: 'ember_vein', name: '灼鉱脈', en: 'Ember Vein', hardness: 3, hp: 16, drop: { item: 'ember_ore', min: 2, max: 3 }, ore: 'ember', mapColor: '#e0742a' },
  { id: 10, key: 'bedrock', name: '基盤岩', en: 'Bedrock', hardness: INF, hp: 0, drop: null, mapColor: '#07090c' },
  { id: 11, key: 'seal_stone', name: '封印岩', en: 'Sealstone', hardness: INF, hp: 0, drop: null, mapColor: '#56656f' },
  { id: 12, key: 'gate_crystal', name: '結晶の封印門', en: 'Prism Seal', hardness: INF, hp: 0, drop: null, mapColor: '#8fb4ff' },
  { id: 13, key: 'gate_ember', name: '灼熱の封印門', en: 'Cinder Seal', hardness: INF, hp: 0, drop: null, mapColor: '#e0742a' },
  { id: 14, key: 'arena_barrier', name: '守護者の結界', en: 'Ward', hardness: INF, hp: 0, drop: null, mapColor: '#6ff0d2' },
  { id: 15, key: 'wall_wood', name: '菌木の壁', en: 'Capwood Wall', hardness: 0, hp: 6, drop: null, placed: 'wall_wood', mapColor: '#8b6746' },
  { id: 16, key: 'wall_stone', name: '石の壁', en: 'Stone Wall', hardness: 0, hp: 10, drop: null, placed: 'wall_stone', mapColor: '#7c8a90' },
  { id: 17, key: 'wall_glass', name: '結晶ガラスの壁', en: 'Prism Glass', hardness: 0, hp: 6, drop: null, placed: 'wall_glass', glass: true, mapColor: '#b4d0ff' },
  { id: 18, key: 'wall_brick', name: '灼煉瓦の壁', en: 'Cinder Brick', hardness: 0, hp: 12, drop: null, placed: 'wall_brick', mapColor: '#a8431c' },
  { id: 19, key: 'wall_gold', name: '金縁の壁', en: 'Gilded Wall', hardness: 0, hp: 12, drop: null, placed: 'wall_gold', mapColor: '#f7b54a' },
];

/* ───────── 建築レイヤー ───────── */
const BUILD = [
  { id: 0, key: 'none', name: 'なし', en: 'None', mapColor: '#000000' },
  { id: 1, key: 'floor_wood', name: '菌木の床', en: 'Capwood Floor', kind: 'floor', step: 'moss', mapColor: '#8b6746' },
  { id: 2, key: 'floor_stone', name: '石畳', en: 'Flagstone', kind: 'floor', step: 'stone', mapColor: '#7c8a90' },
  { id: 3, key: 'floor_crystal', name: '晶タイル', en: 'Prism Tile', kind: 'floor', step: 'crystal', mapColor: '#8fb4ff' },
  { id: 4, key: 'floor_brick', name: '灼煉瓦の床', en: 'Cinder Floor', kind: 'floor', step: 'ash', mapColor: '#a8431c' },
  { id: 5, key: 'floor_gold', name: '金縁の床', en: 'Gilded Floor', kind: 'floor', step: 'stone', mapColor: '#f7b54a' },
  { id: 6, key: 'bridge_wood', name: '木橋', en: 'Capwood Bridge', kind: 'bridge', bridge: 'wood', step: 'moss', mapColor: '#a07a50' },
  { id: 7, key: 'bridge_stone', name: '石橋', en: 'Stone Bridge', kind: 'bridge', bridge: 'stone', step: 'stone', mapColor: '#9aa7a8' },
];

/* ───────── オブジェクト ─────────
   block: 移動を妨げる／kind: 種別／hp: 採取に要る耐久／regen: 再生秒／light: {color,r,s}
   natural: 自然物（撤去不可）／safe: 敵の出現を止める光（設置した光）／item: 設置に使うアイテム */
const OBJECTS = {
  cap_tree: { key: 'cap_tree', name: '巨大茸', en: 'Capgiant', block: true, kind: 'chop', hp: 8, regen: 300, natural: true, mapColor: '#2fb3a6', render: 'tree' },
  glowcap: { key: 'glowcap', name: '光茸の群れ', en: 'Glowcap Patch', block: false, kind: 'gather', regen: 180, natural: true, light: { color: 'teal', r: 3, s: 0.55 }, mapColor: '#6ff0d2', render: 'mushroom' },
  moss_grass: { key: 'moss_grass', name: '苔草', en: 'Moss Tuft', block: false, kind: 'gather', regen: 240, natural: true, mapColor: '#7fae5a', render: 'roots' },
  rubble: { key: 'rubble', name: '瓦礫', en: 'Rubble', block: true, kind: 'mine', hp: 4, regen: 150, natural: true, mapColor: '#56656f', render: 'logs' },
  crystal_cluster: { key: 'crystal_cluster', name: '晶花', en: 'Prism Bloom', block: true, kind: 'mine', hp: 6, regen: 400, natural: true, light: { color: 'crystal', r: 4, s: 0.6 }, mapColor: '#b48ce0', render: 'crystal' },
  wild_tuber: { key: 'wild_tuber', name: '野生の灯芋', en: 'Wild Glow Tuber', block: false, kind: 'gather', regen: 360, natural: true, crop: 'tuber', mapColor: '#e0a24a', render: 'violet' },
  wild_grain: { key: 'wild_grain', name: '野生の苔麦', en: 'Wild Moss Grain', block: false, kind: 'gather', regen: 360, natural: true, crop: 'grain', mapColor: '#b5d77a', render: 'roots' },
  wild_pepper: { key: 'wild_pepper', name: '野生の炎唐辛子', en: 'Wild Ember Pepper', block: false, kind: 'gather', regen: 360, natural: true, crop: 'pepper', mapColor: '#e0583a', render: 'ember' },
  sapling: { key: 'sapling', name: '茸の幼体', en: 'Cap Sprout', block: false, kind: 'grow', growTime: 180, natural: true, mapColor: '#4b7f45', render: 'mushroom' },
  core: { key: 'core', name: '炉心', en: 'Hearthcore', block: true, kind: 'core', natural: true, light: { color: 'gold', r: 14, s: 1.4, onlyWhen: 'restored' }, safe: true, mapColor: '#f7b54a', render: 'arch' },
  altar: { key: 'altar', name: '守護者の祭壇', en: 'Guardian Altar', block: false, kind: 'altar', natural: true, light: { color: 'teal', r: 4, s: 0.5, onlyWhen: 'boss' }, mapColor: '#c8fff2', render: 'altar' },
  satchel: { key: 'satchel', name: '遺灰袋', en: 'Ember Satchel', block: false, kind: 'satchel', natural: true, light: { color: 'ember', r: 2, s: 0.4 }, mapColor: '#d36737', render: 'gravestone' },
  workbench: { key: 'workbench', name: '作業台', en: 'Workbench', block: true, kind: 'station', station: 'workbench', item: 'workbench', mapColor: '#8b6746', render: 'workbench' },
  campfire: { key: 'campfire', name: '焚き火', en: 'Campfire', block: true, kind: 'station', station: 'campfire', item: 'campfire', light: { color: 'warm', r: 7, s: 1.1 }, safe: true, mapColor: '#e0742a', render: 'campfire' },
  furnace: { key: 'furnace', name: '炉', en: 'Furnace', block: true, kind: 'station', station: 'furnace', item: 'furnace', light: { color: 'ember', r: 4, s: 0.6 }, safe: true, mapColor: '#a8431c', render: 'furnace' },
  cookpot: { key: 'cookpot', name: '料理台', en: 'Cookpot', block: true, kind: 'station', station: 'cookpot', item: 'cookpot', mapColor: '#7c8a90', render: 'furnace' },
  planter: { key: 'planter', name: '苗床', en: 'Planter', block: true, kind: 'farm', item: 'planter', mapColor: '#4a3a2c', render: 'farm' },
  chest: { key: 'chest', name: '収納箱', en: 'Chest', block: true, kind: 'storage', item: 'chest', mapColor: '#a07a50', render: 'chest' },
  bed: { key: 'bed', name: 'ベッド', en: 'Bed', block: true, kind: 'bed', item: 'bed', mapColor: '#2fb3a6', render: 'bed' },
  torch: { key: 'torch', name: '松明', en: 'Torch', block: false, kind: 'light', item: 'torch', light: { color: 'warm', r: 6, s: 1.0 }, safe: true, mapColor: '#f7b54a', render: 'torch' },
  lamp_brass: { key: 'lamp_brass', name: '真鍮の灯籠', en: 'Brass Lantern', block: true, kind: 'light', item: 'lamp_brass', light: { color: 'gold', r: 8, s: 1.0 }, safe: true, mapColor: '#e8b35b', render: 'torch' },
  lamp_crystal: { key: 'lamp_crystal', name: '晶灯', en: 'Prism Lamp', block: true, kind: 'light', item: 'lamp_crystal', light: { color: 'crystal', r: 9, s: 1.0 }, safe: true, mapColor: '#8fb4ff', render: 'torch' },
  brazier: { key: 'brazier', name: '灼鋼の篝火', en: 'Cinder Brazier', block: true, kind: 'light', item: 'brazier', light: { color: 'ember', r: 10, s: 1.2 }, safe: true, mapColor: '#ff5a1f', render: 'campfire' },
  table: { key: 'table', name: '菌木の机', en: 'Capwood Table', block: true, kind: 'decor', item: 'table', mapColor: '#8b6746', render: 'workbench' },
  stool: { key: 'stool', name: '菌木の椅子', en: 'Capwood Stool', block: false, kind: 'decor', item: 'stool', mapColor: '#8b6746', render: 'logs' },
  moss_pot: { key: 'moss_pot', name: '苔の鉢', en: 'Moss Pot', block: false, kind: 'decor', item: 'moss_pot', light: { color: 'teal', r: 2, s: 0.3 }, mapColor: '#4b7f45', render: 'roots' },
  banner_moss: { key: 'banner_moss', name: '苔冠の旗', en: 'Moss-Crown Banner', block: false, kind: 'decor', item: 'banner_moss', mapColor: '#2e5a3c', render: 'torch' },
  banner_crystal: { key: 'banner_crystal', name: '聖歌の旗', en: 'Choir Banner', block: false, kind: 'decor', item: 'banner_crystal', mapColor: '#5c6fd6', render: 'torch' },
  banner_ember: { key: 'banner_ember', name: '火夫の旗', en: 'Stoker Banner', block: false, kind: 'decor', item: 'banner_ember', mapColor: '#a8431c', render: 'torch' },
  core_model: { key: 'core_model', name: '炉心の模型', en: 'Hearth Model', block: true, kind: 'decor', item: 'core_model', light: { color: 'gold', r: 5, s: 0.7 }, mapColor: '#f7b54a', render: 'arch' },
};

// 描画契約（CONTEXT.md）の kind 名への対応。設計のオブジェクトキー → renderer の kind
const RENDER_KIND = {
  cap_tree: 'tree', glowcap: 'mushroom', moss_grass: 'roots', rubble: 'logs', crystal_cluster: 'crystal',
  wild_tuber: 'violet', wild_grain: 'roots', wild_pepper: 'ember', sapling: 'mushroom', core: 'arch', altar: 'altar',
  satchel: 'gravestone', workbench: 'workbench', campfire: 'campfire', furnace: 'furnace', cookpot: 'furnace',
  planter: 'farm', chest: 'chest', bed: 'bed', torch: 'torch', lamp_brass: 'torch', lamp_crystal: 'torch',
  brazier: 'campfire', table: 'workbench', stool: 'logs', moss_pot: 'roots', banner_moss: 'torch',
  banner_crystal: 'torch', banner_ember: 'torch', core_model: 'arch',
};

// 壁の ore → renderer の ore 名
const RENDER_ORE = { copper_vein: 'copper', crystal_vein: 'crystal', ember_vein: 'ember' };

/* ───────── アイテム ─────────
   type: material|seed|crop|food|potion|fish|pick|axe|sword|armor|rod|place
   place: {layer:'object'|'wall'|'floor'|'bridge', key} */
const mat = (key, name, en, desc, color, extra = {}) => ({ key, name, en, type: 'material', stack: 99, desc, mapColor: color, ...extra });
const placeObj = (key, name, en, color, stack = 99, desc = '') => ({ key, name, en, type: 'place', stack, desc, mapColor: color, place: { layer: 'object', key } });
const placeWall = (key, name, en, color, desc = '') => ({ key, name, en, type: 'place', stack: 99, desc, mapColor: color, place: { layer: 'wall', key } });
const placeFloor = (key, name, en, color, desc = '') => ({ key, name, en, type: 'place', stack: 99, desc, mapColor: color, place: { layer: 'floor', key } });
const placeBridge = (key, name, en, color, desc = '') => ({ key, name, en, type: 'place', stack: 99, desc, mapColor: color, place: { layer: 'bridge', key } });
const food = (key, name, en, hunger, hp, color, extra = {}) => ({ key, name, en, type: extra.type || 'food', stack: extra.stack || 20, desc: extra.desc || '', mapColor: color, food: { hunger, hp, ...(extra.food || {}) } });

const ITEMS = {
  // 素材
  capwood: mat('capwood', '菌木材', 'Capwood', '巨大茸から採れる軽くて丈夫な木材。', '#8b6746'),
  stone: mat('stone', '石', 'Stone', '岩壁や瓦礫から採れる。', '#7c8a90'),
  loam: mat('loam', '苔土', 'Moss Loam', '土壁から採れる、湿った苔まじりの土。', '#6a5240'),
  fiber: mat('fiber', '苔繊維', 'Moss Fiber', '苔草から採れる丈夫な繊維。', '#7fae5a'),
  glowcap: { key: 'glowcap', name: '光茸', en: 'Glowcap', type: 'material', stack: 99, desc: '青緑に光る茸。食べられるし、苗床に植えられる。', mapColor: '#6ff0d2', food: { hunger: 8, hp: 2 }, plant: 'glowcap' },
  gel: mat('gel', '菌粘液', 'Spore Gel', 'スライムや蛾から採れるねばつく液。', '#2fb3a6'),
  chitin: mat('chitin', '甲殻', 'Chitin', 'ダニや甲虫、トカゲの硬い殻。', '#a8a070'),
  copper_ore: mat('copper_ore', '銅鉱石', 'Copper Ore', '銅を含む鉱石。炉で溶かす。', '#c4733a'),
  coal: mat('coal', '石炭', 'Coal', '炉の燃料になる黒い塊。', '#2a2f36'),
  copper_ingot: mat('copper_ingot', '銅インゴット', 'Copper Ingot', '炉で精錬した銅。', '#e0924a'),
  crystal: mat('crystal', '結晶片', 'Prism Shard', '淡く光る結晶のかけら。', '#8fb4ff'),
  obsidian: mat('obsidian', '黒曜石', 'Obsidian', '熱で固まった黒いガラス質の石。', '#3a2a4a'),
  ember_ore: mat('ember_ore', '灼鉱石', 'Ember Ore', '内側で火が燻る鉱石。', '#e0742a'),
  emberite: mat('emberite', '灼鋼インゴット', 'Emberite Ingot', '灼鉱石を精錬した赤熱の鋼。', '#ff7a3a'),
  cap_spore: mat('cap_spore', '茸の胞子', 'Cap Spore', '苔床か土の床に植えると幼体が育つ。', '#9fe0c0', { plant: 'sapling' }),
  // 種・作物
  seed_tuber: { key: 'seed_tuber', name: '灯芋の種芋', en: 'Tuber Seed', type: 'seed', stack: 99, desc: '苗床に植えると灯芋が育つ。', mapColor: '#c08a4a', plant: 'tuber' },
  seed_grain: { key: 'seed_grain', name: '苔麦の種', en: 'Grain Seed', type: 'seed', stack: 99, desc: '苗床に植えると苔麦が育つ。', mapColor: '#9fbf6a', plant: 'grain' },
  seed_pepper: { key: 'seed_pepper', name: '炎唐辛子の種', en: 'Pepper Seed', type: 'seed', stack: 99, desc: '苗床に植えると炎唐辛子が育つ。', mapColor: '#d0503a', plant: 'pepper' },
  tuber: food('tuber', '灯芋', 'Glow Tuber', 10, 3, '#e0a24a', { type: 'crop', desc: 'ほのかに温かい根菜。' }),
  grain: food('grain', '苔麦', 'Moss Grain', 4, 0, '#b5d77a', { type: 'crop', desc: 'パンの材料になる穀物。' }),
  pepper: food('pepper', '炎唐辛子', 'Ember Pepper', 3, 0, '#e0583a', { type: 'crop', desc: '舌が痺れるほど辛い。' }),
  // 魚
  fish_trout: food('fish_trout', '洞ヤマメ', 'Cave Trout', 8, 2, '#8fb4a0', { type: 'fish', desc: '苔庭の水に棲む素朴な魚。' }),
  fish_lumen: food('fish_lumen', '光鱗魚', 'Lumenscale', 8, 2, '#6ff0d2', { type: 'fish', desc: '鱗がほのかに光る。' }),
  fish_shrimp: food('fish_shrimp', '霧エビ', 'Mist Shrimp', 8, 2, '#d8e6ff', { type: 'fish', desc: '結晶洞の水に群れる小さなエビ。' }),
  fish_catfish: food('fish_catfish', '水晶ナマズ', 'Prism Catfish', 8, 2, '#8fb4ff', { type: 'fish', desc: '背が結晶のように透き通る。' }),
  fish_eel: food('fish_eel', '熱泉ウナギ', 'Spring Eel', 8, 2, '#e0924a', { type: 'fish', desc: '温泉でしか育たない。' }),
  fish_carp: food('fish_carp', '灰鱗鯉', 'Ashscale Carp', 8, 2, '#9aa7a8', { type: 'fish', desc: '灰色の鱗の大きな鯉。' }),
  fish_golden: food('fish_golden', '黄金の残り火魚', 'Golden Emberfin', 10, 10, '#f7b54a', { type: 'fish', desc: '炉心の残り火を宿した伝説の魚。' }),
  // 料理
  roast_glowcap: food('roast_glowcap', '焼き光茸', 'Roast Glowcap', 18, 6, '#c8a24a', { desc: '香ばしく焼いた光茸。' }),
  roast_tuber: food('roast_tuber', '焼き灯芋', 'Roast Tuber', 26, 8, '#e08a3a', { desc: 'ほくほくに焼けた灯芋。' }),
  roast_fish: food('roast_fish', '焼き魚', 'Grilled Fish', 24, 10, '#d09a5a', { desc: '焚き火で焼いた魚。' }),
  bread: food('bread', '苔麦パン', 'Moss Bread', 36, 12, '#c8b070', { desc: '腹持ちのよいパン。' }),
  stew: food('stew', '洞窟シチュー', 'Cavern Stew', 50, 25, '#b0603a', { desc: '体の芯から温まる。', food: { buff: { id: 'regen', t: 60 } } }),
  jelly: food('jelly', '霜晶ゼリー', 'Frostprism Jelly', 14, 4, '#a8d0ff', { desc: '食べると熱を寄せつけない。', food: { buff: { id: 'heat', t: 300 } } }),
  pepper_fish: food('pepper_fish', '炎唐辛子の焼き魚', 'Ember Fish', 36, 12, '#e0583a', { desc: '体が軽くなる辛い焼き魚。', food: { buff: { id: 'vigor', t: 120 } } }),
  golden_feast: food('golden_feast', '黄金の宴', 'Golden Feast', 0, 0, '#ffe39a', { desc: '全てが満たされる祝宴の料理。', food: { full: true, buffs: [{ id: 'regen', t: 180 }, { id: 'heat', t: 180 }, { id: 'vigor', t: 180 }] } }),
  salve: { key: 'salve', name: '癒しの灯薬', en: 'Lamp Salve', type: 'potion', stack: 10, desc: '傷を一気にふさぐ薬。使用後 1.5 秒は再使用できない。', mapColor: '#ff8a6a', food: { hunger: 0, hp: 40, cooldown: 1.5 } },
  // 道具
  pick_stone: { key: 'pick_stone', name: '石のツルハシ', en: 'Stone Pick', type: 'pick', stack: 1, desc: '岩壁や鉱脈が掘れる。', mapColor: '#9aa7a8', tool: { tier: 1, grade: 1, power: 2, swing: 0.32 } },
  pick_copper: { key: 'pick_copper', name: '銅のツルハシ', en: 'Copper Pick', type: 'pick', stack: 1, desc: '硬岩や結晶脈が掘れる。', mapColor: '#e0924a', tool: { tier: 2, grade: 2, power: 3, swing: 0.30 } },
  pick_crystal: { key: 'pick_crystal', name: '結晶のツルハシ', en: 'Prism Pick', type: 'pick', stack: 1, desc: '黒曜岩や灼鉱脈が掘れる。', mapColor: '#8fb4ff', tool: { tier: 3, grade: 3, power: 4, swing: 0.28 } },
  pick_ember: { key: 'pick_ember', name: '灼鋼のツルハシ', en: 'Emberite Pick', type: 'pick', stack: 1, desc: '最も速く掘れる。', mapColor: '#ff7a3a', tool: { tier: 3, grade: 4, power: 6, swing: 0.26 } },
  axe_stone: { key: 'axe_stone', name: '石の斧', en: 'Stone Axe', type: 'axe', stack: 1, desc: '巨大茸を切り倒す。', mapColor: '#9aa7a8', tool: { tier: 1, grade: 1, power: 3, swing: 0.32 } },
  axe_copper: { key: 'axe_copper', name: '銅の斧', en: 'Copper Axe', type: 'axe', stack: 1, desc: '切れ味のよい銅の斧。', mapColor: '#e0924a', tool: { tier: 2, grade: 2, power: 4, swing: 0.30 } },
  axe_crystal: { key: 'axe_crystal', name: '結晶の斧', en: 'Prism Axe', type: 'axe', stack: 1, desc: '結晶の刃を持つ斧。', mapColor: '#8fb4ff', tool: { tier: 3, grade: 3, power: 5, swing: 0.28 } },
  axe_ember: { key: 'axe_ember', name: '灼鋼の斧', en: 'Emberite Axe', type: 'axe', stack: 1, desc: '一撃で茸が倒れる。', mapColor: '#ff7a3a', tool: { tier: 3, grade: 4, power: 7, swing: 0.26 } },
  sword_stone: { key: 'sword_stone', name: '石の剣', en: 'Stone Blade', type: 'sword', stack: 1, desc: '最初の武器。', mapColor: '#9aa7a8', weapon: { grade: 1, atk: 10, swing: 0.45, stamina: 8, range: 1.5, arc: 110, pierce: 0, burn: false } },
  sword_copper: { key: 'sword_copper', name: '銅の剣', en: 'Copper Blade', type: 'sword', stack: 1, desc: '扱いやすい銅の剣。', mapColor: '#e0924a', weapon: { grade: 2, atk: 16, swing: 0.42, stamina: 8, range: 1.5, arc: 110, pierce: 0, burn: false } },
  sword_crystal: { key: 'sword_crystal', name: '結晶の剣', en: 'Prism Blade', type: 'sword', stack: 1, desc: '硬い敵の守りを貫く。', mapColor: '#8fb4ff', weapon: { grade: 3, atk: 26, swing: 0.40, stamina: 9, range: 1.6, arc: 110, pierce: 2, burn: false } },
  sword_ember: { key: 'sword_ember', name: '灼鋼の剣', en: 'Emberite Blade', type: 'sword', stack: 1, desc: '切った相手を燃やす。', mapColor: '#ff7a3a', weapon: { grade: 4, atk: 40, swing: 0.40, stamina: 10, range: 1.6, arc: 120, pierce: 3, burn: true } },
  armor_moss: { key: 'armor_moss', name: '苔布の衣', en: 'Mosscloth Garb', type: 'armor', stack: 1, desc: '苔繊維を編んだ軽い衣。', mapColor: '#4b7f45', armor: { def: 2, heat: false, burnImmune: false } },
  armor_copper: { key: 'armor_copper', name: '銅の鎧', en: 'Copper Mail', type: 'armor', stack: 1, desc: '甲殻を裏打ちした銅の鎧。', mapColor: '#e0924a', armor: { def: 5, heat: false, burnImmune: false } },
  armor_crystal: { key: 'armor_crystal', name: '結晶の鎧', en: 'Prism Plate', type: 'armor', stack: 1, desc: '熱を逃がす結晶の鎧。', mapColor: '#8fb4ff', armor: { def: 9, heat: true, burnImmune: false } },
  armor_ember: { key: 'armor_ember', name: '灼鋼の鎧', en: 'Emberite Plate', type: 'armor', stack: 1, desc: '炎を寄せつけない赤熱の鎧。', mapColor: '#ff7a3a', armor: { def: 14, heat: true, burnImmune: true } },
  fishing_rod: { key: 'fishing_rod', name: '釣竿', en: 'Fishing Rod', type: 'rod', stack: 1, desc: '水辺に向かって使うと釣れる。', mapColor: '#a07a50' },
  // 設置物
  workbench: placeObj('workbench', '作業台', 'Workbench', '#8b6746', 99, '道具や家具を作れる。'),
  campfire: placeObj('campfire', '焚き火', 'Campfire', '#e0742a', 99, '料理と灯り。敵が寄りつかない。'),
  furnace: placeObj('furnace', '炉', 'Furnace', '#a8431c', 99, '鉱石を精錬する。'),
  cookpot: placeObj('cookpot', '料理台', 'Cookpot', '#7c8a90', 99, '上位の料理が作れる。'),
  planter: placeObj('planter', '苗床', 'Planter', '#4a3a2c', 99, '明るい場所で作物が育つ。'),
  chest: placeObj('chest', '収納箱', 'Chest', '#a07a50', 99, '16 枠の収納。'),
  bed: placeObj('bed', 'ベッド', 'Bed', '#2fb3a6', 99, '眠ると全回復し、復活地点になる。'),
  torch: placeObj('torch', '松明', 'Torch', '#f7b54a', 99, '置くと周囲に敵が湧かなくなる。'),
  lamp_brass: placeObj('lamp_brass', '真鍮の灯籠', 'Brass Lantern', '#e8b35b', 20, '広く温かい灯り。'),
  lamp_crystal: placeObj('lamp_crystal', '晶灯', 'Prism Lamp', '#8fb4ff', 20, '青白く遠くまで届く灯り。'),
  brazier: placeObj('brazier', '灼鋼の篝火', 'Cinder Brazier', '#ff5a1f', 20, '最も明るい灯り。'),
  table: placeObj('table', '菌木の机', 'Capwood Table', '#8b6746', 20, '飾り。'),
  stool: placeObj('stool', '菌木の椅子', 'Capwood Stool', '#8b6746', 20, '飾り。'),
  moss_pot: placeObj('moss_pot', '苔の鉢', 'Moss Pot', '#4b7f45', 20, '淡く光る飾り。'),
  banner_moss: placeObj('banner_moss', '苔冠の旗', 'Moss-Crown Banner', '#2e5a3c', 20, 'モルグを鎮めた証。'),
  banner_crystal: placeObj('banner_crystal', '聖歌の旗', 'Choir Banner', '#5c6fd6', 20, 'プリズマを鎮めた証。'),
  banner_ember: placeObj('banner_ember', '火夫の旗', 'Stoker Banner', '#a8431c', 20, 'イグナルを鎮めた証。'),
  core_model: placeObj('core_model', '炉心の模型', 'Hearth Model', '#f7b54a', 20, '炉心を象った金色の飾り。'),
  wall_wood: placeWall('wall_wood', '菌木の壁', 'Capwood Wall', '#8b6746'),
  wall_stone: placeWall('wall_stone', '石の壁', 'Stone Wall', '#7c8a90'),
  wall_glass: placeWall('wall_glass', '結晶ガラスの壁', 'Prism Glass', '#b4d0ff', '光を通す壁。'),
  wall_brick: placeWall('wall_brick', '灼煉瓦の壁', 'Cinder Brick', '#a8431c'),
  wall_gold: placeWall('wall_gold', '金縁の壁', 'Gilded Wall', '#f7b54a', '炉心を再生した者の壁。'),
  floor_wood: placeFloor('floor_wood', '菌木の床', 'Capwood Floor', '#8b6746'),
  floor_stone: placeFloor('floor_stone', '石畳', 'Flagstone', '#7c8a90'),
  floor_crystal: placeFloor('floor_crystal', '晶タイル', 'Prism Tile', '#8fb4ff'),
  floor_brick: placeFloor('floor_brick', '灼煉瓦の床', 'Cinder Floor', '#a8431c'),
  floor_gold: placeFloor('floor_gold', '金縁の床', 'Gilded Floor', '#f7b54a', '炉心を再生した者の床。'),
  bridge_wood: placeBridge('bridge_wood', '木橋', 'Capwood Bridge', '#a07a50', '水と裂け目に架かる。'),
  bridge_stone: placeBridge('bridge_stone', '石橋', 'Stone Bridge', '#9aa7a8', '溶岩にも架かる。'),
};

/* アイテムの図鑑区分（placeは図鑑に載せない） */
const CODEX_CATEGORIES = [
  { id: 'material', name: '素材', en: 'Materials' },
  { id: 'gear', name: '道具・装備', en: 'Gear' },
  { id: 'food', name: '食べ物', en: 'Food' },
  { id: 'creature', name: '生き物', en: 'Creatures' },
  { id: 'fish', name: '魚', en: 'Fish' },
  { id: 'guardian', name: '守護者', en: 'Guardians' },
  { id: 'land', name: '土地', en: 'Lands' },
];

/* ───────── 魚 ───────── */
const FISH = [
  { key: 'fish_trout', water: 'moss', weight: 55 },
  { key: 'fish_lumen', water: 'moss', weight: 42 },
  { key: 'fish_shrimp', water: 'crystal', weight: 55 },
  { key: 'fish_catfish', water: 'crystal', weight: 42 },
  { key: 'fish_eel', water: 'hot', weight: 55 },
  { key: 'fish_carp', water: 'hot', weight: 42 },
  { key: 'fish_golden', water: 'any', weight: 3, needs: 'crystal' },
];

/* ───────── バフ ───────── */
const BUFFS = {
  regen: { id: 'regen', name: '再生', en: 'Regen', desc: 'HP が毎秒 1 回復する。' },
  heat: { id: 'heat', name: '耐熱', en: 'Heat Ward', desc: '灼熱の影響を受けない。' },
  vigor: { id: 'vigor', name: '活力', en: 'Vigor', desc: 'スタミナ回復 ×1.5。' },
  rested: { id: 'rested', name: '安眠', en: 'Rested', desc: '空腹の減少 ×0.7。' },
};

/* ───────── レシピ ─────────
   in: [{key,n}] or [{tag,n,exclude}]。unlock: null | 'boss_moss' | 'boss_crystal' | 'boss_ember' | 'core' */
const R = (id, station, out, n, ing, category, unlock = null) => ({ id, station, out, n, in: ing, category, unlock });
const I = (key, n) => ({ key, n });
const FISH_TAG = (n, exclude) => ({ tag: 'fish', n, exclude });
const RECIPES = [
  R('workbench', null, 'workbench', 1, [I('capwood', 6), I('stone', 4)], 'station'),
  R('campfire', null, 'campfire', 1, [I('capwood', 3), I('stone', 3)], 'station'),
  R('pick_stone', null, 'pick_stone', 1, [I('capwood', 3), I('stone', 3)], 'tool'),
  R('axe_stone', null, 'axe_stone', 1, [I('capwood', 3), I('stone', 2)], 'tool'),
  R('sword_stone', null, 'sword_stone', 1, [I('capwood', 2), I('stone', 4)], 'tool'),
  R('torch', null, 'torch', 2, [I('capwood', 1), I('glowcap', 1)], 'light'),

  R('roast_glowcap', 'campfire', 'roast_glowcap', 1, [I('glowcap', 1)], 'food'),
  R('roast_tuber', 'campfire', 'roast_tuber', 1, [I('tuber', 1)], 'food'),
  R('roast_fish', 'campfire', 'roast_fish', 1, [FISH_TAG(1, ['fish_golden'])], 'food'),

  R('chest', 'workbench', 'chest', 1, [I('capwood', 8), I('stone', 2)], 'station'),
  R('planter', 'workbench', 'planter', 1, [I('capwood', 4), I('loam', 4)], 'station'),
  R('bed', 'workbench', 'bed', 1, [I('capwood', 8), I('fiber', 6)], 'station'),
  R('furnace', 'workbench', 'furnace', 1, [I('stone', 12), I('loam', 4)], 'station'),
  R('cookpot', 'workbench', 'cookpot', 1, [I('stone', 6), I('copper_ingot', 2), I('capwood', 2)], 'station'),
  R('fishing_rod', 'workbench', 'fishing_rod', 1, [I('capwood', 3), I('fiber', 3)], 'tool'),
  R('bridge_wood', 'workbench', 'bridge_wood', 2, [I('capwood', 3), I('fiber', 1)], 'build'),
  R('bridge_stone', 'workbench', 'bridge_stone', 2, [I('stone', 4), I('copper_ingot', 1)], 'build'),
  R('wall_wood', 'workbench', 'wall_wood', 1, [I('capwood', 1)], 'build'),
  R('floor_wood', 'workbench', 'floor_wood', 2, [I('capwood', 1)], 'build'),
  R('wall_stone', 'workbench', 'wall_stone', 1, [I('stone', 1)], 'build'),
  R('floor_stone', 'workbench', 'floor_stone', 2, [I('stone', 1)], 'build'),
  R('wall_glass', 'workbench', 'wall_glass', 2, [I('crystal', 1)], 'build'),
  R('floor_crystal', 'workbench', 'floor_crystal', 4, [I('crystal', 1)], 'build'),
  R('wall_brick', 'workbench', 'wall_brick', 2, [I('obsidian', 1), I('stone', 1)], 'build'),
  R('floor_brick', 'workbench', 'floor_brick', 4, [I('obsidian', 1), I('stone', 1)], 'build'),
  R('lamp_brass', 'workbench', 'lamp_brass', 1, [I('copper_ingot', 1), I('glowcap', 2)], 'light'),
  R('lamp_crystal', 'workbench', 'lamp_crystal', 1, [I('crystal', 2), I('copper_ingot', 1)], 'light'),
  R('brazier', 'workbench', 'brazier', 1, [I('emberite', 1), I('stone', 4)], 'light'),
  R('table', 'workbench', 'table', 1, [I('capwood', 4)], 'decor'),
  R('stool', 'workbench', 'stool', 1, [I('capwood', 2)], 'decor'),
  R('moss_pot', 'workbench', 'moss_pot', 1, [I('loam', 2), I('fiber', 2)], 'decor'),
  R('armor_moss', 'workbench', 'armor_moss', 1, [I('fiber', 10), I('gel', 3)], 'armor'),
  R('pick_copper', 'workbench', 'pick_copper', 1, [I('copper_ingot', 3), I('capwood', 2)], 'tool'),
  R('axe_copper', 'workbench', 'axe_copper', 1, [I('copper_ingot', 2), I('capwood', 2)], 'tool'),
  R('sword_copper', 'workbench', 'sword_copper', 1, [I('copper_ingot', 4), I('capwood', 1)], 'tool'),
  R('armor_copper', 'workbench', 'armor_copper', 1, [I('copper_ingot', 6), I('fiber', 4), I('chitin', 2)], 'armor'),
  R('pick_crystal', 'workbench', 'pick_crystal', 1, [I('crystal', 5), I('copper_ingot', 2)], 'tool'),
  R('axe_crystal', 'workbench', 'axe_crystal', 1, [I('crystal', 4), I('copper_ingot', 1)], 'tool'),
  R('sword_crystal', 'workbench', 'sword_crystal', 1, [I('crystal', 7), I('copper_ingot', 2)], 'tool'),
  R('armor_crystal', 'workbench', 'armor_crystal', 1, [I('crystal', 10), I('copper_ingot', 3), I('chitin', 4)], 'armor'),
  R('pick_ember', 'workbench', 'pick_ember', 1, [I('emberite', 4), I('crystal', 2)], 'tool'),
  R('axe_ember', 'workbench', 'axe_ember', 1, [I('emberite', 3), I('crystal', 1)], 'tool'),
  R('sword_ember', 'workbench', 'sword_ember', 1, [I('emberite', 6), I('crystal', 3), I('obsidian', 2)], 'tool'),
  R('armor_ember', 'workbench', 'armor_ember', 1, [I('emberite', 7), I('obsidian', 4), I('chitin', 4)], 'armor'),
  R('banner_moss', 'workbench', 'banner_moss', 1, [I('fiber', 4), I('capwood', 2)], 'decor', 'boss_moss'),
  R('banner_crystal', 'workbench', 'banner_crystal', 1, [I('fiber', 4), I('crystal', 2)], 'decor', 'boss_crystal'),
  R('banner_ember', 'workbench', 'banner_ember', 1, [I('fiber', 4), I('obsidian', 2)], 'decor', 'boss_ember'),
  R('floor_gold', 'workbench', 'floor_gold', 8, [I('emberite', 1), I('stone', 2)], 'build', 'core'),
  R('wall_gold', 'workbench', 'wall_gold', 4, [I('emberite', 1), I('stone', 2)], 'build', 'core'),
  R('core_model', 'workbench', 'core_model', 1, [I('emberite', 2), I('crystal', 2)], 'decor', 'core'),

  R('copper_ingot', 'furnace', 'copper_ingot', 2, [I('copper_ore', 3), I('coal', 1)], 'smelt'),
  R('emberite', 'furnace', 'emberite', 1, [I('ember_ore', 2), I('coal', 1)], 'smelt'),
  R('charcoal', 'furnace', 'coal', 1, [I('capwood', 3)], 'smelt'),

  R('bread', 'cookpot', 'bread', 1, [I('grain', 3)], 'food'),
  R('stew', 'cookpot', 'stew', 1, [FISH_TAG(1), I('tuber', 1), I('glowcap', 1)], 'food'),
  R('jelly', 'cookpot', 'jelly', 1, [I('crystal', 1), I('gel', 2), I('glowcap', 1)], 'food'),
  R('pepper_fish', 'cookpot', 'pepper_fish', 1, [I('pepper', 1), FISH_TAG(1)], 'food'),
  R('salve', 'cookpot', 'salve', 1, [I('glowcap', 2), I('gel', 1)], 'food'),
  R('golden_feast', 'cookpot', 'golden_feast', 1, [I('fish_golden', 1), I('tuber', 2), I('grain', 2)], 'food'),
];

const STATIONS = [
  { id: null, name: '手作業', en: 'By Hand' },
  { id: 'campfire', name: '焚き火', en: 'Campfire' },
  { id: 'workbench', name: '作業台', en: 'Workbench' },
  { id: 'furnace', name: '炉', en: 'Furnace' },
  { id: 'cookpot', name: '料理台', en: 'Cookpot' },
];

/* ───────── 作物 ───────── */
const CROPS = {
  tuber: { key: 'tuber', seed: 'seed_tuber', growTime: 240, yield: { item: 'tuber', min: 2, max: 3 }, seedBack: { item: 'seed_tuber', n: 1, bonusChance: 0.3 } },
  grain: { key: 'grain', seed: 'seed_grain', growTime: 300, yield: { item: 'grain', min: 3, max: 4 }, seedBack: { item: 'seed_grain', n: 1, bonusChance: 0.3 } },
  pepper: { key: 'pepper', seed: 'seed_pepper', growTime: 360, yield: { item: 'pepper', min: 2, max: 2 }, seedBack: { item: 'seed_pepper', n: 1, bonusChance: 0.3 } },
  glowcap: { key: 'glowcap', seed: 'glowcap', growTime: 180, yield: { item: 'glowcap', min: 3, max: 3 }, seedBack: null },
};

/* ───────── 敵 ───────── */
// atk: {kind(hazard kind), shape, ...}。warn は予告秒、speed は突進/弾の速度
const ENEMIES = {
  moss_slime: { key: 'moss_slime', name: '苔スライム', en: 'Moss Slime', desc: '光を嫌う苔のかたまり。跳びかかる前に地面が光る。', where: '苔庭', biomes: [1], hp: 20, atk: 7, def: 0, speed: 1.8, sense: 6, radius: 0.4, lightFear: true, flying: false, render: 'slime',
    attack: { kind: 'slimeHop', shape: 'circle', r: 0.9, reach: 2.4, warn: 0.55, active: 0.2, range: 2.6 }, drops: [{ item: 'gel', n: 1, p: 0.7 }], mapColor: '#2fb3a6' },
  cave_bat: { key: 'cave_bat', name: '洞コウモリ', en: 'Cave Bat', desc: '素早く飛び、急降下のあと距離を取る。', where: '苔庭・結晶洞', biomes: [1, 2], hp: 12, atk: 5, def: 0, speed: 3.2, sense: 8, radius: 0.35, lightFear: false, flying: true, render: 'chort',
    attack: { kind: 'batDive', shape: 'line', length: 3, width: 0.8, warn: 0.45, speed: 8, range: 3.0, fleeAfter: 1.2 }, drops: [{ item: 'gel', n: 1, p: 0.25 }], mapColor: '#7c6a9a' },
  moss_mite: { key: 'moss_mite', name: '苔ダニ', en: 'Moss Mite', desc: '硬い殻を持つ。直線に突進する。', where: '苔庭', biomes: [1], hp: 30, atk: 9, def: 1, speed: 2.2, sense: 6, radius: 0.4, lightFear: true, flying: false, render: 'slime',
    attack: { kind: 'miteCharge', shape: 'line', length: 4, width: 0.9, warn: 0.7, speed: 6, range: 3.6 }, drops: [{ item: 'chitin', n: 1, p: 0.8 }], mapColor: '#7a8a4a' },
  prism_beetle: { key: 'prism_beetle', name: '晶甲虫', en: 'Prism Beetle', desc: '背に結晶を負った甲虫。長く突進する。', where: '結晶洞', biomes: [2], hp: 60, atk: 13, def: 3, speed: 2.0, sense: 7, radius: 0.45, lightFear: true, flying: false, render: 'skeleton',
    attack: { kind: 'beetleCharge', shape: 'line', length: 5, width: 1.0, warn: 0.7, speed: 7, range: 4.4 }, drops: [{ item: 'chitin', n: 2, p: 1 }, { item: 'crystal', n: 1, p: 0.4 }], mapColor: '#5c6fd6' },
  mirror_moth: { key: 'mirror_moth', name: '鏡蛾', en: 'Mirror Moth', desc: '距離を保って晶弾を放つ。近づくと跳んで避ける。', where: '結晶洞', biomes: [2], hp: 34, atk: 10, def: 0, speed: 2.6, sense: 9, radius: 0.35, lightFear: false, flying: true, dodger: true, render: 'chort',
    ranged: { min: 4, max: 6 }, attack: { kind: 'mothShard', shape: 'line', length: 9, width: 0.4, warn: 0.6, active: 0.1, projectile: 'mothShard', speed: 6, range: 7 }, drops: [{ item: 'gel', n: 1, p: 1 }], mapColor: '#b4d0ff' },
  ember_husk: { key: 'ember_husk', name: '炉守の亡者', en: 'Ember Husk', desc: '重い腕を叩きつける。灼熱の遺跡を彷徨う。', where: '灼熱遺跡', biomes: [3], hp: 90, atk: 20, def: 4, speed: 1.5, sense: 6, radius: 0.45, lightFear: false, flying: false, render: 'orc',
    attack: { kind: 'huskSlam', shape: 'circle', r: 1.6, reach: 1.3, warn: 0.85, active: 0.15, range: 2.0 }, drops: [{ item: 'obsidian', n: 1, p: 0.5 }, { item: 'ember_ore', n: 1, p: 0.3 }], mapColor: '#a8431c' },
  magma_newt: { key: 'magma_newt', name: '溶岩トカゲ', en: 'Magma Newt', desc: '火球を放つ。近づくと横に跳ぶ。', where: '灼熱遺跡', biomes: [3], hp: 55, atk: 12, def: 2, speed: 2.4, sense: 8, radius: 0.4, lightFear: false, flying: false, dodger: true, render: 'chort',
    ranged: { min: 3, max: 5 }, attack: { kind: 'newtFire', shape: 'line', length: 8, width: 0.4, warn: 0.6, active: 0.1, projectile: 'fireball', speed: 5.5, range: 6, burn: 3 }, drops: [{ item: 'chitin', n: 1, p: 1 }, { item: 'coal', n: 1, p: 0.5 }], mapColor: '#e0742a' },
};

/* ───────── ボス ───────── */
const BOSSES = {
  moss: { id: 'moss', key: 'morgh', name: '苔冠のモルグ', en: 'MORGH, THE MOSS-CROWNED', desc: '苔の冠を戴く守護者。根と胞子と突進で侵入者を退ける。', where: '苔庭のアリーナ', hp: 480, def: 1, speed: 1.6, radius: 0.9, flying: false, theme: 'moss', phase2: 0.5, render: 'warden_moss', mapColor: '#2fb3a6',
    attacks: [
      { name: 'root', kind: 'root', ja: '根の突き上げ', en: 'Root Eruption', warn: 0.9, active: 0.35, dmg: 18, length: 7, width: 0.8 },
      { name: 'sporeRing', kind: 'sporeRing', ja: '胞子の輪', en: 'Spore Ring', warn: 1.0, active: 1.4, dmg: 14, r0: 1, r1: 7, thick: 0.6, gap: 50 },
      { name: 'charge', kind: 'charge', ja: '突進', en: 'Charge', warn: 0.8, active: 1.2, dmg: 22, length: 10, width: 1.6, speed: 9, stun: 1.6 },
    ],
    rewards: [{ item: 'capwood', n: 10 }, { item: 'copper_ore', n: 6 }, { item: 'fiber', n: 6 }], heart: 'moss', unlock: 'boss_moss', gate: 'crystal' },
  crystal: { id: 'crystal', key: 'prisma', name: '虚晶の聖歌プリズマ', en: 'PRISMA, THE HOLLOW CHOIR', desc: '光を折り曲げる浮遊する聖歌。本体は鏡像の中で金色に光る。', where: '結晶洞のアリーナ', hp: 760, def: 4, speed: 2.0, radius: 0.8, flying: true, theme: 'crystal', phase2: 0.5, render: 'warden_crystal', mapColor: '#8fb4ff',
    attacks: [
      { name: 'beam', kind: 'beam', ja: '屈折光線', en: 'Refraction Beam', warn: 1.0, active: 1.0, dmg: 16, tick: 0.25, width: 0.6, sweep: 50, range: 14 },
      { name: 'shardRain', kind: 'shardRain', ja: '結晶雨', en: 'Shard Rain', warn: 1.1, active: 0.25, dmg: 24, r: 1.0, count: 8, near: 3 },
      { name: 'mirror', kind: 'mirror', ja: '鏡像', en: 'Mirror Split', warn: 0.8, active: 8, dmg: 14, decoys: 2, shotEvery: 1.5, shotSpeed: 6, glintEvery: 0.8 },
    ],
    rewards: [{ item: 'crystal', n: 8 }, { item: 'gel', n: 4 }], heart: 'crystal', unlock: 'boss_crystal', gate: 'ember' },
  ember: { id: 'ember', key: 'ignar', name: '最後の火夫イグナル', en: 'IGNAR, THE LAST STOKER', desc: '炉の火を守り続けた巨躯。吐息と溶鉄と噴気を操る。', where: '灼熱遺跡のアリーナ', hp: 1100, def: 6, speed: 1.4, radius: 1.0, flying: false, theme: 'ember', phase2: 0.4, render: 'warden_ember', mapColor: '#ff5a1f',
    attacks: [
      { name: 'breath', kind: 'breath', ja: '炉の吐息', en: 'Furnace Breath', warn: 1.0, active: 1.2, dmg: 18, tick: 0.25, range: 5, spread: 70, swing: 40, burn: 3 },
      { name: 'slam', kind: 'slam', ja: '溶鉄の衝撃', en: 'Slag Shockwave', warn: 0.9, active: 0.2, dmg: 32, r: 2, ringDmg: 22, ringSpeed: 4, ringThick: 0.5, rings: 2 },
      { name: 'vent', kind: 'vent', ja: '噴気', en: 'Vent Eruption', warn: 1.2, active: 0.6, dmg: 26, r: 0.9 },
    ],
    rewards: [{ item: 'emberite', n: 4 }, { item: 'obsidian', n: 4 }], heart: 'ember', unlock: 'boss_ember', gate: null },
};

/* ───────── バイオーム ───────── */
const BIOMES = {
  1: { id: 1, key: 'moss', name: '苔庭', en: 'MOSS GARDEN', desc: '濡れた岩と青緑の茸が灯る、深庭の入り口。', where: '祠を中心とした円盤', ambient: 0.08, enemyCap: 9, wall: 'rock_wall', floor: 'moss_floor', mapColor: '#2e5a3c' },
  2: { id: 2, key: 'crystal', name: '結晶洞', en: 'CRYSTAL HOLLOW', desc: '藍と菫の岩、青白い結晶柱が歌う洞窟。', where: '祠の西', ambient: 0.12, enemyCap: 11, wall: 'hard_rock', floor: 'crystal_floor', mapColor: '#3a3f8f' },
  3: { id: 3, key: 'ember', name: '灼熱遺跡', en: 'SCORCHED RUINS', desc: '黒い玄武岩と溶岩の川が流れる遺構。', where: '祠の東', ambient: 0.16, enemyCap: 11, wall: 'burnt_rock', floor: 'ash_floor', mapColor: '#a8431c' },
};
const BIOME_KEYS = { 1: 'moss', 2: 'crystal', 3: 'ember' };

/* ───────── 灯の祠スタンプ（17×17、左上が (56,56)） ───────── */
const SHRINE_STAMP = {
  x0: 56, y0: 56, size: 17,
  rows: [
    '##,,T,,,,,,,T,,##',
    '#o,,,,,g,,,,,,,k#',
    ',,,R,,,,,,,,,R,,,',
    'T,,,,.......,,,,T',
    ',,,,.t.....t.,,,,',
    ',f,,.........,,f,',
    ',,,,....S....,,,,',
    ',,u,...Cc....,u,,',
    ',,,,...cc....,,,,',
    ',,,,.........,,,,',
    ',f,,.........,,f,',
    'T,,,.t.....t.,,,T',
    ',,,,,.......,,,,,',
    ',,R,,,,,,,,,,,R,,',
    ',www,,,,,,,,,g,,,',
    ',www,,,,,,,,,,,,,',
    '##,,T,,,,,,,T,,##',
  ],
  chest: { x: 64, y: 62, items: [{ id: 'torch', n: 4 }, { id: 'roast_glowcap', n: 3 }, { id: 'capwood', n: 4 }] },
  core: { x: 63, y: 63 },
  start: { x: 64, y: 66 },
  hub: { x: 64, y: 64 },
};

/* ───────── 目標 ───────── */
// target: 目標地点の種類（world.js が解決する）
const OBJECTIVES = [
  { id: 'wake', text: '祠の古い収納箱を開けよう', en: 'Open the old chest in the shrine', target: 'starterChest' },
  { id: 'gather', text: '菌木材6と石4を集めよう', en: 'Gather 6 capwood and 4 stone', target: null },
  { id: 'pick', text: '石のツルハシを作ろう', en: 'Craft a stone pick', target: null },
  { id: 'campfire', text: '焚き火を置こう', en: 'Place a campfire', target: null },
  { id: 'bench', text: '作業台を置こう', en: 'Place a workbench', target: null },
  { id: 'copper', text: '銅鉱石を6つ集めよう', en: 'Gather 6 copper ore', target: 'copperVein' },
  { id: 'smelt', text: '炉で銅インゴットを作ろう', en: 'Smelt a copper ingot in a furnace', target: null },
  { id: 'gear', text: '銅の剣かツルハシを作ろう', en: 'Craft a copper blade or pick', target: null },
  { id: 'bed', text: 'ベッドを置いて復活地点にしよう', en: 'Place a bed to set your respawn', target: null },
  { id: 'boss1', text: '苔の祭壇で守護者を鎮めよう', en: 'Quell the guardian at the Moss Altar', target: 'arena.moss' },
  { id: 'crystalGate', text: '西の結晶門を抜けよう', en: 'Pass through the Prism Seal to the west', target: 'gate.crystal' },
  { id: 'crystalPick', text: '結晶のツルハシを作ろう', en: 'Craft a prism pick', target: null },
  { id: 'bridge', text: '裂け目に橋を架けよう', en: 'Bridge the chasm', target: 'chasm' },
  { id: 'boss2', text: '結晶洞の守護者を鎮めよう', en: 'Quell the guardian of the Crystal Hollow', target: 'arena.crystal' },
  { id: 'heat', text: '灼熱に備えよう（結晶の鎧か霜晶ゼリー）', en: 'Prepare for the heat (prism plate or frost jelly)', target: null },
  { id: 'emberGate', text: '東の灼熱門を抜けよう', en: 'Pass through the Cinder Seal to the east', target: 'gate.ember' },
  { id: 'emberite', text: '灼鋼インゴットを作ろう', en: 'Forge an emberite ingot', target: null },
  { id: 'boss3', text: '灼熱遺跡の守護者を鎮めよう', en: 'Quell the guardian of the Scorched Ruins', target: 'arena.ember' },
  { id: 'core', text: '炉心に三つの核を捧げよう', en: 'Offer the three embers to the Hearthcore', target: 'core' },
  { id: 'free', text: '深庭を自由に築こう', en: 'Build your garden freely', target: null },
];

/* ───────── 実績 ───────── */
const ACHIEVEMENTS = [
  { id: 'first_light', name: '最初の灯', en: 'First Light', desc: '焚き火を置く' },
  { id: 'toolmaker', name: '道具職人', en: 'Toolmaker', desc: '銅の道具を作る' },
  { id: 'deep_digger', name: '掘り進む者', en: 'Deep Digger', desc: '壁を 300 掘る' },
  { id: 'angler', name: '深庭の釣り人', en: 'Angler', desc: '5 種類の魚を釣る' },
  { id: 'gardener', name: '苔の庭師', en: 'Gardener', desc: '15 回収穫する' },
  { id: 'chef', name: '地底の料理人', en: 'Underground Chef', desc: '料理台のレシピをすべて作る' },
  { id: 'builder', name: '灯の建築家', en: 'Architect', desc: '建材と装飾を 150 個置く' },
  { id: 'lamplighter', name: '点灯夫', en: 'Lamplighter', desc: '照明を 25 個置く' },
  { id: 'ferryman', name: '渡し守', en: 'Ferryman', desc: '橋を 10 個置く' },
  { id: 'guardian_moss', name: '苔冠を鎮めて', en: 'Moss-Crown Quelled', desc: 'モルグを撃破' },
  { id: 'guardian_crystal', name: '聖歌の終わり', en: 'The Choir Falls Silent', desc: 'プリズマを撃破' },
  { id: 'guardian_ember', name: '最後の火夫', en: 'The Last Stoker Rests', desc: 'イグナルを撃破' },
  { id: 'untouched', name: '無傷の儀', en: 'Untouched', desc: '守護者を無傷で倒す' },
  { id: 'recovered', name: '灯は消えず', en: 'Not Extinguished', desc: '遺灰袋を回収する' },
  { id: 'hearth', name: '炉心再生', en: 'Hearth Reborn', desc: '炉心を再生する' },
  { id: 'swift', name: '速き灯守', en: 'Swift Keeper', desc: 'プレイ時間 45 分以内に再生' },
  { id: 'steadfast', name: '揺るがぬ灯', en: 'Steadfast', desc: '「標準」で、一度も死なずに再生' },
  { id: 'golden', name: '黄金の残り火', en: 'Golden Ember', desc: '黄金の残り火魚を釣る' },
  { id: 'feast', name: '宴', en: 'Feast', desc: '黄金の宴を食べる' },
  { id: 'chronicler', name: '深庭の記録者', en: 'Chronicler', desc: '図鑑の 80% を解放する' },
];

/* ───────── ヒント ───────── */
const HINTS = {
  move: '移動：WASD / 矢印キー。調べる：E、使う：J / Space。',
  gather: '光る茸や苔草は手で採集できる。巨大茸は素手でも切れる。',
  craft: '材料がそろった。持ち物の「クラフト」から作れる。',
  station: '作業台・炉・料理台・焚き火の近く（3.5 タイル以内）で作れる。',
  dark: '暗がりでは敵が湧く。灯りの近くでは湧かない。松明を置こう。',
  telegraph: '光る範囲から離れるか、回避で抜けよう。',
  heat: '灼熱の地では空腹が早まる。結晶の鎧か霜晶ゼリーで耐熱を。',
  bridge: '裂け目や水には橋を架けられる。橋は撤去すれば全部戻る。',
  fish: '釣竿で水辺に向かって使い、「！」が出たらもう一度押す。',
  satchel: '遺灰袋が落ちている。地図の印を目指して調べよう。',
  return: '閉じ込められたら、ポーズメニューの「灯へ帰る」で祠に戻れる。',
};

const INTRO = [
  { ja: '深庭は、かつてひとつの炉心に温められていた。', en: 'The Deep Garden was once warmed by a single Hearthcore.' },
  { ja: '三体の守護者は炎を分かち、封じたまま、長い眠りのうちに歪んでしまった。', en: 'Three guardians sealed its flame — and twisted in their long sleep.' },
  { ja: '最後の灯守よ。残り火を集め、炉心をふたたび灯せ。', en: 'Last Lamplighter, gather the embers. Light the Hearth again.' },
];
const ENDING_TEXT = [
  { ja: '三つの核が炉心に還り、深庭に朝のような光が満ちた。', en: 'The embers return, and light like morning fills the Garden.' },
  { ja: '苔は息を吹き返し、結晶は歌い、遺跡の炉は静かに眠る。', en: 'The moss breathes, the crystals sing, the old furnaces rest.' },
  { ja: 'ここはもう、あなたの庭だ。', en: 'This garden is yours now.' },
];
const CREDITS = [
  { ja: '残り火の深庭', en: 'EMBERVEIL', title: true },
  { ja: '企画・ゲームデザイン — Claude Opus（Anthropic）' },
  { ja: 'シミュレーション・UI 実装 — Claude Sonnet（Anthropic）' },
  { ja: 'アート・描画・サウンド — Codex（OpenAI）' },
  { ja: '制作・監修 — rirtir' },
  { ja: '技術 — HTML / CSS / JavaScript（外部ライブラリ不使用）' },
  { ja: 'Thanks for playing.' },
];

/* ───────── 操作 ───────── */
const KEYBINDS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  primary: ['Space', 'KeyJ'], interact: ['KeyE', 'KeyK', 'Enter'], dodge: ['ShiftLeft', 'ShiftRight', 'KeyL'],
  remove: ['KeyR'], quickHeal: ['KeyQ'],
  hot1: ['Digit1'], hot2: ['Digit2'], hot3: ['Digit3'], hot4: ['Digit4'], hot5: ['Digit5'], hot6: ['Digit6'], hot7: ['Digit7'], hot8: ['Digit8'],
  hotPrev: ['KeyZ'], hotNext: ['KeyX'],
  inventory: ['Tab', 'KeyI'], craft: ['KeyC'], map: ['KeyM'], codex: ['KeyG'], pause: ['Escape', 'KeyP'],
};

// 操作ヒントの動詞（§12.3）
const ACTIONS = {
  attack: '攻撃', mine: '採掘', chop: '伐採', gather: '採集', harvest: '収穫', open: '開ける', inspect: '調べる',
  sleep: '眠る', plant: '植える', fish: '釣る', place: '置く', remove: '撤去', offer: '捧げる', recover: '回収', craft: '作業',
};

const SOUNDS = ['mine', 'chop', 'attack', 'hurt', 'pickup', 'craft', 'build', 'eat', 'dodge', 'fish', 'boss', 'victory', 'ui'];

/* ───────── 設定の既定値と難易度 ───────── */
const SETTINGS_DEFAULT = {
  soundOn: true, volume: 7, reduceMotion: false, screenShake: true, difficulty: 'standard', autoTool: true,
  showDamageNumbers: true, highContrastTelegraph: false, objectiveArrow: true, uiScale: 100, touchControls: 'auto',
};
const DIFFICULTY = {
  gentle: { id: 'gentle', name: '穏やか', en: 'Gentle', damage: 0.6, warn: 1.25, hunger: 0.7, bossHp: 0.85, fishWindow: 1.3 },
  standard: { id: 'standard', name: '標準', en: 'Standard', damage: 1.0, warn: 1.0, hunger: 1.0, bossHp: 1.0, fishWindow: 0.9 },
};

/* ───────── バランス（§21・§7.1） ───────── */
const BALANCE = {
  step: 1 / 60, maxSteps: 5, autosave: 60, dropLife: 600,
  player: {
    speed: 4.2, actionSlow: 0.5, radius: 0.30, hp: 100, hpPerHeart: 20, maxHpCap: 160, stamina: 100, staminaRegen: 32, staminaDelay: 0.6,
    exhaustResume: 20, hunger: 100, hungerStart: 80, hungerRate: 0.1, heatHungerMul: 2, heatStaminaMul: 0.6, starveDps: 0.5, starveStaminaMul: 0.5,
    regenMid: 0.5, regenHigh: 1.0, regenIdle: 5, invuln: 0.6, knockback: 0.4,
    dodgeTime: 0.28, dodgeDist: 2.6, dodgeInvuln: 0.22, dodgeCost: 22, dodgeCooldown: 0.15,
    mineStamina: 1, chopStamina: 2, interactRange: 1.6, pointerRange: 2.2, stationRange: 3.5, pickupRange: 1.2, magnetRange: 2.0, magnetSpeed: 8,
    lightR: 3.5, lightS: 0.7, torchLightR: 6, torchLightS: 1.0, eatTime: 0.6, gatherTime: 0.3, comboWindow: 0.35, burnDps: 3, hitAt: 0.4,
    spawnHpRatio: 0.5, spawnHunger: 40, deathAnim: 1.2,
  },
  inventory: { slots: 32, hotbar: 8, armor: 1, satchelCap: 64, chestSlots: 16, chestMax: 64 },
  stacks: { material: 99, seed: 99, place: 99, decor: 20, food: 20, fish: 20, crop: 20, potion: 10, tool: 1 },
  wallDamageReset: 5,
  regrow: { cap_tree: 300, glowcap: 180, moss_grass: 240, rubble: 150, crystal_cluster: 400, wild: 360, sapling: 180, retry: 2 },
  rubbleDrops: { stone: 2, copper_ore: 0.2, coal: 0.15 },
  treeDrops: { capwood: 4, cap_spore: 0.3 },
  gatherDrops: { glowcap: 2, moss_grass: 2 },
  crystalDrop: 1,
  light: { crop: 0.35, safe: 0.45, fear: 0.6, endingBoost: 0.3, max: 1.5, restore: { color: 'gold', r: 14, s: 1.4 } },
  spawn: { interval: 3.5, min: 11, max: 18, hubSafe: 14, bedSafe: 6, despawnDist: 30, despawnTime: 10, afterEndingMul: 0.5, enemyMax: 14 },
  enemy: { recover: 0.6, recoverDmgMul: 1.2, sepRadius: 0.8, flowWindow: 41, flowEvery: 0.3, leash: 18, loseSight: 5, dodgeCd: 3, attackCd: 1.2, hurtTime: 0.2 },
  sleep: { skip: 120, hunger: 15, cooldown: 60, enemyRange: 8, fade: 1.5, restedTime: 180 },
  channel: { return: 4.0 },
  fishing: { cast: 0.4, waitMin: 2, waitMax: 6, early: 1.0, range: 2 },
  limits: { enemies: 14, projectiles: 64, hazards: 48, drops: 300, objects: 8000, chests: 64, effects: 96, events: 256 },
  boss: { intro: 2.0, dying: 2.5, recoverMin: 1.0, recoverMax: 1.6, sameAttackWeight: 0.3, phase2Warn: 0.85, arenaDepth: 2 },
  dmg: { armorFloor: 0.25, recoverMul: 1.2, stunMul: 1.5, comboMul: 1.4, comboKb: 2 },
  hearth: { ringMin: 9, ringMax: 18 },
  ending: { absorb: 3, bloom: 4 },
  explore: { every: 0.25, near: 7, lit: 12, litMin: 0.5 },
};

const SIZE = 128;
const VERSION = '1.0.0';
const SAVE_VERSION = 1;
const GEN_VERSION = 1;
const SAVE_FORMAT = 'emberveil-save';

export const DATA = deepFreeze({
  VERSION, SAVE_VERSION, GEN_VERSION, SAVE_FORMAT, SIZE,
  GROUND, WALL, BUILD, OBJECTS, RENDER_KIND, RENDER_ORE, ITEMS, CODEX_CATEGORIES, FISH, BUFFS, RECIPES, STATIONS, CROPS,
  ENEMIES, BOSSES, BIOMES, BIOME_KEYS, SHRINE_STAMP, OBJECTIVES, ACHIEVEMENTS, HINTS, INTRO, ENDING_TEXT, CREDITS,
  KEYBINDS, ACTIONS, SOUNDS, SETTINGS_DEFAULT, DIFFICULTY, BALANCE,
  TITLE: { ja: '残り火の深庭', en: 'EMBERVEIL' },
});
