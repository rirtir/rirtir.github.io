// 苔灯の境 / MOSSLIGHT — 拡張コンテンツの純粋な定義（他モジュールをimportしない。data.js が既存の表へ合流させる）
// 設計: .review/v6/CONTENT_EXPANSION_DESIGN.md / 実契約: .review/v6/DATA_IMPLEMENTATION.md
// 既存ID・既存の並び順・既存の数値は変えず、ここは「加えるだけ」。IDが既存と重なるとdata.jsがthrowする。
// 魚8種には専用のWorkbenchアイコンを使用。その他の追加アイコン・propsは既存の実在nameを暫定で再利用する。

export const CONTENT_VERSION = 1;

// 小さなヘルパ(data.jsのI/Rと同じ形。stackの既定はdata.js側で付ける)
const C = (id, name, icon, cat, desc, extra = {}) => ({ id, name, icon, cat, desc, ...extra });
const R = (out, n, station, inputs, extra = {}) => ({
  id: out, out, n, station, stations: extra.stations || [station], inputs, ...extra,
});

/* ------------------------------------------------------------------ 効果の語彙 */
// 装備(armor/trinket内)の効果キー。activities.getEquipStats が合算する(combat/simulation/lighting はそれだけを読む)
//   speed: 移動速度の加算(0.08=+8%) / def: 被ダメージ減 / light: {radius(タイル),color,intensity,flicker}
//   fishBite: 待機時間の倍率(0.85=15%短縮) / fishWindow: 合わせ窓の加算秒 / satietyRate: 空腹の進みの倍率(0.8=20%減)
//   regen: 10秒あたりのHP回復量
export const EQUIP_STAT_KEYS = ['speed', 'def', 'light', 'fishBite', 'fishWindow', 'satietyRate', 'regen'];
// 料理のbuff。vは加算(既存speed/lightと同じ)。buffは同idなら延長・上書き
//   speed:+v倍 / light:+v半径 / def:+v / regen:+v(HP/10秒) / fishBite:待機×(1+v) (v<0で短縮) / fishWindow:窓+v秒 / satietyRate:空腹の進み×(1+v)
export const BUFF_KINDS = ['speed', 'light', 'def', 'regen', 'fishBite', 'fishWindow', 'satietyRate'];
// 釣り針の時間帯。tod(0=06:00, 600周期)。現行のday表(dawn0-50/day50-275/dusk275-375/night375-550/predawn550-600)を4つに畳んだ表
export const FISH_TIME_RANGES = {
  morning: [[550, 600], [0, 100]],
  day: [[100, 275]],
  dusk: [[275, 375]],
  night: [[375, 550]],
};

/* ------------------------------------------------------------------ アイテム */
// 取得源と用途は §6#1 の検査で強制(新itemはすべて入手元1つ以上+用途1つ以上)
export const CONTENT_ITEMS = [
  // 野生素材(新ノードから)
  C('herb', '薬草', 'flowers', 'material', '野原に生える苦い草。料理・薬・釣り餌になる。'),
  C('honey', '蜂蜜', 'food', 'food', '蜂の巣から採れる甘い蜜。そのままなめてもよい。', { eat: { satiety: 5, hp: 3 } }),
  C('sand', '砂', 'stone', 'material', '砂浜の細かい砂。窯でガラスになる。'),
  C('salt', '岩塩', 'stone', 'material', '岩場で採れる白い塩。料理の味を引き締める。'),
  C('reed', '葦', 'fiber', 'material', '水辺に群れる丈夫な葦。縄や飾りになる。'),
  C('cave_mushroom', '洞窟茸', 'mushroom', 'food', '苔の洞窟に生える青白いキノコ。生では食べにくい。'),
  // 加工素材(織機・窯・燻製器)
  C('rope', '縄', 'fiber', 'material', '葦や繊維を撚った縄。釣り竿や家具に使う。'),
  C('brick', '煉瓦', 'stone', 'material', '窯で焼いた粘土の煉瓦。設置物と護符に使う。'),
  C('glass', 'ガラス', 'crystal', 'material', '砂を溶かして作る透明なガラス。灯と護符に使う。'),
  C('charcoal', '木炭', 'coal', 'material', '木を蒸し焼きにした炭。ガラス焼きと護符に使う。'),
  C('wax', '蝋', 'glowspore', 'material', '蜂蜜や樹脂から取る蝋。灯と油の代わりになる。'),
  C('fish_oil', '魚油', 'water', 'material', '魚から搾った油。外套や灯皿の油の代わりになる。'),
  // 作物(収穫物+種)。種は収穫で2個戻る(植える1個+1個の増え)
  C('flax', '亜麻', 'fiber', 'material', '青い花の咲く亜麻。織機で布になる。'),
  C('flax_seed', '亜麻の種', 'seed', 'seed', '耕した畑に植える。', { plant: 'flax' }),
  C('glow_carrot', '灯人参', 'carrot', 'food', '根がほんのり光る人参。生では青臭い。'),
  C('glow_carrot_seed', '灯人参の種', 'seed', 'seed', '耕した畑に植える。', { plant: 'glow_carrot' }),
  C('pumpkin', '灯南瓜', 'food', 'food', '丸く育つ南瓜。甘みがある。'),
  C('pumpkin_seed', '灯南瓜の種', 'seed', 'seed', '耕した畑に植える。', { plant: 'pumpkin' }),
  C('leek', '苔ねぎ', 'wheat', 'food', '苔の香りのするねぎ。汁物に向く。'),
  C('leek_seed', '苔ねぎの種', 'seed', 'seed', '耕した畑に植える。', { plant: 'leek' }),
  C('bean', '星豆', 'seed', 'food', '星の形の豆。煮込むとやわらかい。'),
  C('bean_seed', '星豆の種', 'seed', 'seed', '耕した畑に植える。', { plant: 'bean' }),
  C('chili', '火辛子', 'berry', 'food', 'ぴりりと辛い赤い実。少量で料理が変わる。'),
  C('chili_seed', '火辛子の種', 'seed', 'seed', '耕した畑に植える。', { plant: 'chili' }),
  // 魚(釣りで得る。生では食べられない)
  C('fish_minnow', '小魚', 'fish_minnow', 'material', '浅瀬にいる小さな魚。焼くと食べられる。'),
  C('fish_goby', 'ハゼ', 'fish_goby', 'material', '朝夕の岸辺に寄る素朴な魚。'),
  C('fish_carp', '苔鯉', 'fish_carp', 'material', '背に苔が生えた鯉。汁物にするとうまい。'),
  C('fish_trout', '湖鱒', 'fish_trout', 'material', '脂ののった鱒。燻製に向く。'),
  C('fish_catfish', '泥ナマズ', 'fish_catfish', 'material', '夕暮れから夜に泥の底で釣れる大きな魚。'),
  C('fish_eel', '光うなぎ', 'fish_eel', 'material', '夕方から夜に光る餌に寄ってくる。'),
  C('fish_bream', '月鯛', 'fish_bream', 'material', '夜の水面に現れる銀色の鯛。良い竿が要る。'),
  C('fish_pike', '影カマス', 'fish_pike', 'material', '夜の水の底の捕食者。良い竿と光る餌が要る。'),
  // 釣具(竿は rod:段階。toolフィールドは使わない=p.toolsの段階表を汚さない)。餌は bait:true
  C('rod_wood', '木の釣り竿', 'fishing_rod', 'tool', '水辺で糸を垂らす。小さな魚が釣れる。', { rod: 1, stack: 1 }),
  C('rod_copper', '銅の釣り竿', 'fishing_rod', 'tool', '合わせの窓が広く、待つ時間も短い。大物にも耐える。', { rod: 2, stack: 1 }),
  C('bait_worm', '虫餌', 'seed', 'material', '薬草に寄る虫。待ち時間が少し短くなる。', { bait: 'worm' }),
  C('bait_glow', '光る餌', 'glowspore', 'material', '光苔を練った餌。夕方・夜に効き、光る魚を呼ぶ。', { bait: 'glow' }),
  // 料理(satiety/hp/buff)。buffは1食1種
  C('grilled_fish', '焼き魚', 'fish', 'food', '小魚を焼いただけの素朴な一品。', { eat: { satiety: 18, hp: 8 } }),
  C('salt_fish', '塩焼き魚', 'fish', 'food', '岩塩を振った香ばしい焼き魚。', { eat: { satiety: 24, hp: 10 } }),
  C('fish_soup', '魚のスープ', 'stew', 'food', '体の中からじんわり回復する。', { eat: { satiety: 34, hp: 16, buff: { id: 'regen', v: 1, time: 120 } } }),
  C('smoked_fish', '燻製魚', 'fish', 'food', '日持ちして腹持ちがよい。しばらくお腹が減りにくい。', { eat: { satiety: 38, hp: 12, buff: { id: 'satietyRate', v: -0.25, time: 240 } } }),
  C('smoked_eel', '燻製うなぎ', 'fish', 'food', '濃い味で目が冴える。携帯灯の照射範囲と、洞窟での視界が広がる。', { eat: { satiety: 30, hp: 20, buff: { id: 'light', v: 1, time: 300 } } }),
  C('fish_stew', '魚のシチュー', 'stew', 'food', '具だくさんで体が締まる。しばらく被ダメージが減る。', { eat: { satiety: 50, hp: 25, buff: { id: 'def', v: 1, time: 240 } } }),
  C('bream_plate', '月鯛の香草皿', 'salad', 'food', '傷によく効く贅沢な皿。', { eat: { satiety: 32, hp: 30 } }),
  C('pike_roll', 'カマスのパン包み', 'bread', 'food', '釣り人向けの弁当。食べると釣りの待ち時間が縮む。', { eat: { satiety: 55, hp: 28, buff: { id: 'fishBite', v: -0.15, time: 300 } } }),
  C('honey_toast', '蜂蜜トースト', 'bread', 'food', '甘くて足取りが軽くなる。', { eat: { satiety: 36, hp: 18, buff: { id: 'speed', v: 0.06, time: 120 } } }),
  C('herb_tea', '薬草茶', 'heart', 'food', '腹は満たさないが、よく温まる。ゆっくり傷が癒える。', { eat: { satiety: 4, hp: 22, buff: { id: 'regen', v: 1.5, time: 150 } } }),
  C('pumpkin_soup', '南瓜のスープ', 'stew', 'food', 'とろりと甘いスープ。', { eat: { satiety: 40, hp: 20 } }),
  C('roast_pumpkin', '焼き南瓜', 'food', 'food', '火に当てるだけで甘くなる。', { eat: { satiety: 24, hp: 10 } }),
  C('carrot_glaze', '灯人参の蜜煮', 'salad', 'food', '目が冴える蜜煮。携帯灯の照射範囲と、洞窟での視界が広がる。', { eat: { satiety: 28, hp: 14, buff: { id: 'light', v: 1, time: 240 } } }),
  C('leek_soup', '苔ねぎ汁', 'stew', 'food', 'あっさりしていて、お腹が減りにくくなる。', { eat: { satiety: 30, hp: 12, buff: { id: 'satietyRate', v: -0.15, time: 180 } } }),
  C('bean_stew', '星豆の煮込み', 'stew', 'food', 'ほくほくの豆の煮込み。', { eat: { satiety: 38, hp: 14 } }),
  C('chili_stew', '火辛子鍋', 'stew', 'food', '辛さで体が熱くなる。足が速くなる。', { eat: { satiety: 42, hp: 18, buff: { id: 'speed', v: 0.12, time: 150 } } }),
  C('spice_skewer', '香辛焼き串', 'food', 'food', '辛子とキノコの串焼き。', { eat: { satiety: 26, hp: 10 } }),
  C('cave_roast', '洞窟茸の網焼き', 'food', 'food', '塩だけで焼くと甘い。', { eat: { satiety: 22, hp: 12 } }),
  C('cave_stew', '洞窟茸のシチュー', 'stew', 'food', '深いうま味。しばらく被ダメージが減る。', { eat: { satiety: 44, hp: 20, buff: { id: 'def', v: 1, time: 240 } } }),
  C('glow_salad', '光苔の和え物', 'salad', 'food', 'さっぱりした和え物。携帯灯の照射範囲と、洞窟での視界が広がる。', { eat: { satiety: 30, hp: 14, buff: { id: 'light', v: 1, time: 200 } } }),
  C('bean_bread', '豆パン', 'bread', 'food', '豆を練り込んだ腹持ちのよいパン。', { eat: { satiety: 34, hp: 12 } }),
  C('potato_gratin', '苔芋のグラタン', 'food', 'food', '熱々で滋味深い。', { eat: { satiety: 35, hp: 15 } }),
  C('sweet_pumpkin_pie', '南瓜と蜂蜜のパイ', 'bread', 'food', '祝いの菓子。じわじわ傷が癒える。', { eat: { satiety: 48, hp: 22, buff: { id: 'regen', v: 1, time: 200 } } }),
  // 装備(armorスロット)
  C('fisher_coat', '漁師の外套', 'armor', 'armor', '被ダメージ −2。釣りの待ち時間と窓に少し有利。', { equip: 'armor', armor: { def: 2, fishBite: 0.9, fishWindow: 0.2 } }),
  C('cloth_hood', '布の頭巾', 'armor', 'armor', '被ダメージ −2。空腹がやや進みにくい。', { equip: 'armor', armor: { def: 2, satietyRate: 0.92 } }),
  // 携帯灯と護符(trinketスロット)。携帯灯は地上の夜にも地下でも有効。作物の「灯」扱いにはしない
  C('lantern', '携帯灯', 'lantern', 'trinket', '光の半径 4。暗い場所でも手元を照らす。', {
    equip: 'trinket', trinket: { light: { radius: 4, color: '#ffd27a', intensity: 0.9, flicker: 0.05 } },
  }),
  C('crystal_lantern', '結晶の携帯灯', 'lantern', 'trinket', '光の半径 6。揺らがない青白い光。', {
    equip: 'trinket', trinket: { light: { radius: 6, color: '#9fe8ff', intensity: 1.0, flicker: 0 } },
  }),
  C('charm_float', '浮きの護符', 'coin', 'trinket', '魚が早く食いつき、合わせの窓が広がる。', { equip: 'trinket', trinket: { fishBite: 0.85, fishWindow: 0.3 } }),
  C('charm_hearth', '竈の護符', 'coin', 'trinket', 'お腹が減りにくい(空腹の進み −20%)。', { equip: 'trinket', trinket: { satietyRate: 0.8 } }),
  C('charm_moss', '苔の護符', 'coin', 'trinket', 'HPが10秒ごとに2ずつ戻る。', { equip: 'trinket', trinket: { regen: 2 } }),
  C('charm_swift', '疾風の護符', 'coin', 'trinket', '移動速度 +6%、被ダメージ −1。', { equip: 'trinket', trinket: { speed: 0.06, def: 1 } }),
  // 設置物(アイテムid = 構造物type)。設備3+飾り6
  C('loom', '織機', 'workbench', 'placeable', '亜麻や葦から布と縄を作る。', { place: 'loom' }),
  C('kiln', '窯', 'furnace', 'placeable', '炭・煉瓦・ガラスを焼く。', { place: 'kiln' }),
  C('smoker', '燻製器', 'stew', 'placeable', '魚を燻し、油や蝋を取る。', { place: 'smoker' }),
  C('rug', '敷物', 'carpet', 'placeable', '床に敷くやわらかな布。', { place: 'rug' }),
  C('shelf', '棚', 'chest', 'placeable', '小物を並べる飾り棚。', { place: 'shelf' }),
  C('statue_moss', '苔の像', 'relic', 'placeable', '苔むした小さな像。ほのかに光る。', { place: 'statue_moss' }),
  C('handcart', '手押し車', 'bag', 'placeable', '荷を積んだままの古い手押し車。', { place: 'handcart' }),
  C('hay_bale', '干し草の束', 'wheat', 'placeable', '刈った葦を束ねた飾り。', { place: 'hay_bale' }),
  C('planter', '花壇', 'flowers', 'placeable', '煉瓦で囲った小さな花壇。', { place: 'planter' }),
];

/* ------------------------------------------------------------------ 設備 */
export const CONTENT_STATIONS = {
  loom: { name: '織機' },
  kiln: { name: '窯' },
  smoker: { name: '燻製器' },
};

/* ------------------------------------------------------------------ レシピ */
// 同じ出力の代替は id を別にする(out は同じ)。r.station/r.stations/r.out/r.n/r.inputs は旧契約のまま
const POT_FIRE = { stations: ['pot', 'campfire'] };
export const CONTENT_RECIPES = [
  // 設備と設置(携帯灯のhand制作は旧saveでも地上で取れる素材だけ)
  R('lantern', 1, 'hand', { wood: 1, resin: 2, fiber: 2, stone: 1 }),
  R('loom', 1, 'workbench', { wood: 6, fiber: 4 }),
  R('kiln', 1, 'workbench', { stone: 10, clay: 4 }),
  R('smoker', 1, 'workbench', { wood: 4, stone: 6, clay: 2 }),
  R('rug', 1, 'workbench', { cloth: 4 }, { stations: ['workbench', 'loom'] }),
  R('shelf', 1, 'workbench', { wood: 6, rope: 1 }),
  R('statue_moss', 1, 'workbench', { stone: 8, glowmoss: 2, brick: 2 }),
  R('handcart', 1, 'workbench', { wood: 6, rope: 2 }),
  R('hay_bale', 1, 'workbench', { reed: 4, rope: 1 }),
  R('planter', 1, 'workbench', { wood: 2, brick: 2, herb: 2 }),
  // 加工(代替を含む)
  R('cloth_flax', 2, 'loom', { flax: 3 }, { out: 'cloth' }),
  R('rope', 2, 'loom', { reed: 3 }),
  R('rope_fiber', 1, 'hand', { fiber: 4 }, { out: 'rope' }),
  R('charcoal', 1, 'kiln', { wood: 2 }),
  R('charcoal_branch', 1, 'kiln', { branch: 4 }, { out: 'charcoal' }),
  R('brick', 2, 'kiln', { clay: 2, branch: 1 }),
  R('glass', 1, 'kiln', { sand: 2, charcoal: 1 }),
  R('glass_bulk', 3, 'kiln', { sand: 5, salt: 1, charcoal: 1 }, { out: 'glass' }),
  R('wax', 1, 'smoker', { honey: 2 }),
  R('wax_resin', 1, 'kiln', { resin: 3 }, { out: 'wax' }),
  R('fish_oil', 1, 'smoker', { fish_minnow: 3 }),
  R('fish_oil_goby', 1, 'smoker', { fish_goby: 3 }, { out: 'fish_oil' }),
  // 救済(古灯の油=moss_oil を詰まらせない別ルート。灯皿は3つで油が要る)
  R('moss_oil_fish', 1, 'smoker', { fish_oil: 2, glowmoss: 1 }, { out: 'moss_oil' }),
  R('moss_oil_wax', 1, 'smoker', { wax: 2, glowmoss: 1 }, { out: 'moss_oil', stations: ['smoker', 'furnace'] }),
  R('moss_oil_resin', 1, 'furnace', { resin: 3, glowmoss: 1 }, { out: 'moss_oil' }),
  R('moss_oil_honey', 1, 'smoker', { honey: 2, glowmoss: 2 }, { out: 'moss_oil' }),
  // 種分け(収穫物1→種2。種を使い切っても畑を再開できる)
  R('flax_seed_split', 2, 'hand', { flax: 1 }, { out: 'flax_seed' }),
  R('glow_carrot_seed_split', 2, 'hand', { glow_carrot: 1 }, { out: 'glow_carrot_seed' }),
  R('pumpkin_seed_split', 2, 'hand', { pumpkin: 1 }, { out: 'pumpkin_seed' }),
  R('leek_seed_split', 2, 'hand', { leek: 1 }, { out: 'leek_seed' }),
  R('bean_seed_split', 2, 'hand', { bean: 1 }, { out: 'bean_seed' }),
  R('chili_seed_split', 2, 'hand', { chili: 1 }, { out: 'chili_seed' }),
  // 釣具
  R('rod_wood', 1, 'hand', { branch: 3, fiber: 3 }),
  R('rod_copper', 1, 'workbench', { wood: 2, rope: 2, copper_bar: 1 }),
  R('bait_worm', 3, 'hand', { herb: 2 }),
  R('bait_glow', 2, 'hand', { glowmoss: 1, fiber: 1 }),
  // 料理(campfire/pot/smoker)
  R('grilled_fish', 1, 'pot', { fish_minnow: 2 }, POT_FIRE),
  R('salt_fish', 1, 'pot', { fish_goby: 1, salt: 1 }, POT_FIRE),
  R('fish_soup', 1, 'pot', { fish_carp: 1, herb: 1, salt: 1 }),
  R('smoked_fish', 1, 'smoker', { fish_trout: 1, salt: 1 }),
  R('smoked_eel', 1, 'smoker', { fish_eel: 1 }),
  R('fish_stew', 1, 'pot', { fish_catfish: 1, leek: 1, glow_carrot: 1 }),
  R('bream_plate', 1, 'pot', { fish_bream: 1, salt: 1, herb: 1 }),
  R('pike_roll', 1, 'pot', { fish_pike: 1, wheat: 2, herb: 1 }),
  R('honey_toast', 1, 'pot', { wheat_bread: 1, honey: 1 }),
  R('herb_tea', 1, 'pot', { herb: 2, honey: 1 }),
  R('pumpkin_soup', 1, 'pot', { pumpkin: 2, salt: 1 }),
  R('roast_pumpkin', 1, 'pot', { pumpkin: 1 }, POT_FIRE),
  R('carrot_glaze', 1, 'pot', { glow_carrot: 2, honey: 1 }),
  R('leek_soup', 1, 'pot', { leek: 2, salt: 1 }),
  R('bean_stew', 1, 'pot', { bean: 3, herb: 1 }),
  R('chili_stew', 1, 'pot', { chili: 1, moss_potato: 2, mushroom: 2 }),
  R('spice_skewer', 1, 'pot', { chili: 1, mushroom: 2, salt: 1 }, POT_FIRE),
  R('cave_roast', 1, 'pot', { cave_mushroom: 2, salt: 1 }, POT_FIRE),
  R('cave_stew', 1, 'pot', { cave_mushroom: 2, moss_potato: 1, herb: 1 }),
  R('glow_salad', 1, 'pot', { glowmoss: 2, leek: 1, herb: 1 }),
  R('bean_bread', 1, 'pot', { wheat: 2, bean: 2 }),
  R('potato_gratin', 1, 'pot', { moss_potato: 2, salt: 1, herb: 1 }),
  R('sweet_pumpkin_pie', 1, 'pot', { pumpkin: 2, wheat: 2, honey: 1 }),
  // 料理の魚違い代替(入力系統が違うので別レシピ)
  R('grilled_fish_goby', 1, 'pot', { fish_goby: 2 }, { out: 'grilled_fish', ...POT_FIRE }),
  R('grilled_fish_carp', 1, 'pot', { fish_carp: 1 }, { out: 'grilled_fish', ...POT_FIRE }),
  R('salt_fish_minnow', 1, 'pot', { fish_minnow: 3, salt: 1 }, { out: 'salt_fish', ...POT_FIRE }),
  R('fish_soup_catfish', 1, 'pot', { fish_catfish: 1, herb: 1, salt: 1 }, { out: 'fish_soup' }),
  R('smoked_fish_carp', 1, 'smoker', { fish_carp: 1, salt: 1 }, { out: 'smoked_fish' }),
  R('fish_stew_trout', 1, 'pot', { fish_trout: 1, leek: 1, bean: 1 }, { out: 'fish_stew' }),
  // 装備・護符・灯
  R('fisher_coat', 1, 'workbench', { cloth: 4, fish_oil: 1, rope: 2 }),
  R('cloth_hood', 1, 'loom', { cloth: 3, rope: 1, herb: 2 }),
  R('crystal_lantern', 1, 'workbench', { glass: 2, copper_bar: 1, glowmoss: 3, wax: 1 }),
  R('charm_float', 1, 'workbench', { rope: 2, glass: 1, fish_carp: 1 }),
  R('charm_hearth', 1, 'workbench', { charcoal: 2, salt: 2, brick: 1 }),
  R('charm_moss', 1, 'workbench', { glowmoss: 4, herb: 3, wax: 1 }),
  R('charm_swift', 1, 'workbench', { reed: 3, fur: 2, rope: 1 }),
];

/* ------------------------------------------------------------------ 資源ノード(NODES契約: hit/solid/再生/drops) */
// regenは既存の1〜1.5倍(既存 120〜360秒、地下結晶など再生なしを除く)。sprite は details/props に実在するname
export const CONTENT_NODES = {
  herb: {
    name: '薬草', verb: '摘む', sprite: 'fern_small', hp: 1, sway: true,
    drops: [{ item: 'herb', n: 2 }, { item: 'leek_seed', n: 1, chance: 0.08 }, { item: 'glow_carrot_seed', n: 1, chance: 0.06 }],
    regen: 240, hit: { w: 30, h: 24 }, spark: true, chip: ['#71905a', '#91d8af'],
  },
  honey_hive: {
    name: '蜂の巣', verb: '採る', sprite: 'log_small', tint: ['#e0b04a', 0.3], hp: 1,
    drops: [{ item: 'honey', n: 2 }, { item: 'bean_seed', n: 1, chance: 0.1 }, { item: 'pumpkin_seed', n: 1, chance: 0.1 }],
    regen: 450, hit: { w: 30, h: 22 }, spark: true, chip: ['#e0b04a', '#b18b53'],
  },
  sand_patch: {
    name: '砂地', verb: '掘る', sprite: 'beachstones', hp: 1, drops: [{ item: 'sand', n: 2 }],
    regen: 300, hit: { w: 30, h: 20 }, spark: true, chip: ['#d1aa68', '#e8dcb0'],
  },
  salt_rock: {
    name: '岩塩', verb: '砕く', sprite: 'loose_stones', tool: 'pick', hardness: 1, hp: 20,
    drops: [{ item: 'salt', n: 2 }, { item: 'chili_seed', n: 1, chance: 0.1 }],
    regen: 450, hit: { w: 30, h: 20 }, chip: ['#e8e4d8', '#91a0a2'],
  },
  reed_bed: {
    name: '葦', verb: '刈る', sprite: 'reeds', hp: 1, sway: true,
    drops: [{ item: 'reed', n: 2 }, { item: 'flax_seed', n: 1, chance: 0.12 }],
    regen: 270, hit: { w: 30, h: 30 }, spark: true, chip: ['#97ad71', '#71905a'],
  },
  cave_mushroom: {
    name: '洞窟茸', verb: '採る', sprite: 'mushroom_small', tint: ['#8fb7ff', 0.4], hp: 1,
    glow: { r: 1.6, color: [130, 170, 255] }, drops: [{ item: 'cave_mushroom', n: 1 }],
    regen: 270, hit: { w: 26, h: 20 }, spark: true, chip: ['#8fb7ff', '#9c87aa'],
  },
};
// 左右反転してよい新ノード型(data.jsのMIRROR_NODE_TYPESへ足す)
export const CONTENT_MIRROR_NODES = ['herb', 'sand_patch', 'reed_bed', 'cave_mushroom'];

/* ------------------------------------------------------------------ 構造物(provides/use/layer/solid/light/sprite) */
export const CONTENT_STRUCTURES = {
  loom: { name: '織機', item: 'loom', sprite: 'workbench', tint: ['#9fd8a0', 0.22], provides: ['loom'], solid: 'box', verb: '使う', use: 'craft' },
  kiln: {
    name: '窯', item: 'kiln', sprite: 'furnace', tint: ['#d69968', 0.3], provides: ['kiln'], solid: 'box', verb: '使う', use: 'craft',
    light: { r: 2.5, color: [255, 140, 60], flicker: 0.6 },
  },
  smoker: {
    name: '燻製器', item: 'smoker', sprite: 'cauldron', provides: ['smoker'], solid: { r: 12 }, verb: '使う', use: 'craft',
    light: { r: 2, color: [255, 160, 80], flicker: 0.8 },
  },
  rug: { name: '敷物', item: 'rug', sprite: 'carpet', layer: 'floor', decor: true },
  shelf: { name: '棚', item: 'shelf', sprite: 'shelf', solid: 'box', decor: true },
  statue_moss: {
    name: '苔の像', item: 'statue_moss', sprite: 'statue', solid: { r: 10 }, decor: true, light: { r: 2.5, color: [130, 230, 190], flicker: 0.3 },
  },
  handcart: { name: '手押し車', item: 'handcart', sprite: 'handcart', solid: { r: 12 }, decor: true },
  hay_bale: { name: '干し草の束', item: 'hay_bale', sprite: 'hay', solid: { r: 10 }, decor: true },
  planter: { name: '花壇', item: 'planter', sprite: 'flowers', decor: true },
};
// 「飾り」として数える構造物type(生活目標: 飾り10設置)。既存の家具を含む
export const DECOR_TYPES = [
  'rug', 'shelf', 'statue_moss', 'handcart', 'hay_bale', 'planter', 'table', 'chair', 'candlestick', 'lantern_stone', 'moss_fountain',
];

/* ------------------------------------------------------------------ 作物 */
// sprite は props の接頭辞(`${sprite}${段階0..3}`。現行は crop_wheat / crop_potato だけ実在=暫定再利用。tintは対応するまで無視してよい)
// 植え直しの循環: 収穫で種が2個戻る(1個は植えた分)。3段階=stages×stageTime秒で成熟。種を失っても *_seed_split で収穫物から種2個
export const CONTENT_CROPS = {
  flax: { name: '亜麻', seed: 'flax_seed', stages: 3, stageTime: 70, sprite: 'crop_wheat', tint: ['#9ec4e8', 0.3], lightBonus: 0.25, harvest: [{ item: 'flax', n: 3 }, { item: 'flax_seed', n: 2 }] },
  glow_carrot: { name: '灯人参', seed: 'glow_carrot_seed', stages: 3, stageTime: 60, sprite: 'crop_potato', tint: ['#ff9a4d', 0.3], lightBonus: 0.25, harvest: [{ item: 'glow_carrot', n: 3 }, { item: 'glow_carrot_seed', n: 2 }] },
  pumpkin: { name: '灯南瓜', seed: 'pumpkin_seed', stages: 3, stageTime: 90, sprite: 'crop_potato', tint: ['#e8a33d', 0.35], lightBonus: 0.25, harvest: [{ item: 'pumpkin', n: 2 }, { item: 'pumpkin_seed', n: 2 }] },
  leek: { name: '苔ねぎ', seed: 'leek_seed', stages: 3, stageTime: 65, sprite: 'crop_wheat', tint: ['#7bd69a', 0.3], lightBonus: 0.25, harvest: [{ item: 'leek', n: 3 }, { item: 'leek_seed', n: 2 }] },
  bean: { name: '星豆', seed: 'bean_seed', stages: 3, stageTime: 75, sprite: 'crop_potato', tint: ['#8fd69a', 0.25], lightBonus: 0.25, harvest: [{ item: 'bean', n: 3 }, { item: 'bean_seed', n: 2 }] },
  chili: { name: '火辛子', seed: 'chili_seed', stages: 3, stageTime: 85, sprite: 'crop_wheat', tint: ['#e8574d', 0.35], lightBonus: 0.25, harvest: [{ item: 'chili', n: 2 }, { item: 'chili_seed', n: 2 }] },
};

/* ------------------------------------------------------------------ 魚 */
// regions: 'shore'=陸地がChebyshev距離2以内の水 / 'deep'=それより沖 / 'cave'=地下の水
//   地下には現行worldが水を生成しないため cave は空(どの魚も使わない)。8種は shore/deep だけで維持する。
// 到達性: 水辺から4cell以内に狙えるので、岸の水(shore)と、岸から3〜4cell沖(deep)の両方が狙える。
//   ただし deep だけでしか釣れない魚は作らない(全種が shore を含む)。deepは shore の魚が大物込みで釣れる沖であって、取得の必須条件にしない。
// bait は必須餌(その餌を使った時だけ表に入る)。bait無しでも各region×各時間帯に minRod1 の魚が1種以上いること(validateで強制)
export const FISH_REGIONS = {
  shore: { name: '岸辺', rule: '陸地がChebyshev距離2以内の水' },
  deep: { name: '沖', rule: '陸地からChebyshev距離3以上の水(岸から3〜4cellで狙える)' },
  cave: { name: '地下の水', rule: '地下の水タイル。現行worldには存在せず、魚は割り当てない', unused: true },
};
export const FISH = {
  minnow: { name: '小魚', item: 'fish_minnow', regions: ['shore'], time: ['morning', 'day', 'dusk', 'night'], minRod: 1, weight: 10, sizeMin: 6, sizeMax: 12 },
  goby: { name: 'ハゼ', item: 'fish_goby', regions: ['shore'], time: ['morning', 'dusk'], minRod: 1, weight: 7, sizeMin: 8, sizeMax: 16 },
  carp: { name: '苔鯉', item: 'fish_carp', regions: ['shore', 'deep'], time: ['morning', 'day', 'dusk'], minRod: 1, weight: 8, sizeMin: 20, sizeMax: 45 },
  trout: { name: '湖鱒', item: 'fish_trout', regions: ['shore', 'deep'], time: ['morning', 'day', 'dusk', 'night'], minRod: 1, weight: 6, sizeMin: 25, sizeMax: 50 },
  catfish: { name: '泥ナマズ', item: 'fish_catfish', regions: ['shore', 'deep'], time: ['dusk', 'night'], minRod: 1, bait: 'bait_worm', weight: 6, sizeMin: 30, sizeMax: 70 },
  eel: { name: '光うなぎ', item: 'fish_eel', regions: ['shore', 'deep'], time: ['dusk', 'night'], minRod: 1, bait: 'bait_glow', weight: 5, sizeMin: 40, sizeMax: 80 },
  bream: { name: '月鯛', item: 'fish_bream', regions: ['shore', 'deep'], time: ['night'], minRod: 2, weight: 4, sizeMin: 30, sizeMax: 60 },
  pike: { name: '影カマス', item: 'fish_pike', regions: ['shore', 'deep'], time: ['night'], minRod: 2, bait: 'bait_glow', weight: 3, sizeMin: 50, sizeMax: 90 },
};
// 竿の段階(rod:1/2)ごとの基本値。activities が読む
export const ROD_STATS = { 1: { window: 0.8, biteMul: 1 }, 2: { window: 1.2, biteMul: 0.85 } };
// 餌ごとの待機倍率。glow は夕・夜だけ効く
export const BAIT_STATS = {
  worm: { biteMul: 0.75, times: null },
  glow: { biteMul: 0.6, times: ['dusk', 'night'] },
};

/* ------------------------------------------------------------------ 納品依頼(住人3人×5件=15件) */
// stage: start=無条件 / furnace=炉の灯 / moss=苔の灯 / seal=封印開放。報酬は一回限り
export const REQUESTS = {
  cook_herbs: { npc: 'cook', stage: 'start', needs: { herb: 4, mushroom: 2 }, reward: { items: { leek_seed: 2, glow_carrot_seed: 2 } }, text: '薬草とキノコを分けてくれ。畑向きの種をお礼に渡そう。' },
  farmer_reeds: { npc: 'farmer', stage: 'start', needs: { reed: 6, fiber: 6 }, reward: { items: { flax_seed: 3, rope: 2 } }, text: '湖岸の葦を集めてほしい。亜麻の種と縄で礼をする。' },
  farmer_minnow: { npc: 'farmer', stage: 'start', needs: { fish_minnow: 3 }, reward: { items: { pumpkin_seed: 3, bait_worm: 3 } }, text: '小魚を3匹。畑の肥やしにするよ。南瓜の種を渡そう。' },
  builder_timber: { npc: 'builder', stage: 'start', needs: { wood: 10, reed: 4 }, reward: { items: { rope: 4, rod_wood: 1 } }, text: '木材と葦を。足場を組みたい。釣り竿を作ってあるから持っていってくれ。' },
  cook_fish: { npc: 'cook', stage: 'furnace', needs: { grilled_fish: 2, honey: 2 }, reward: { items: { bait_glow: 5, salt: 4 } }, text: '焼き魚と蜂蜜を。夜釣りの餌と塩をお返しする。' },
  cook_smoke: { npc: 'cook', stage: 'furnace', needs: { smoked_fish: 1, herb_tea: 1 }, reward: { items: { honey: 3, wax: 2 } }, text: '燻製魚と薬草茶の味見をさせてくれ。蜂蜜と蝋を渡そう。' },
  farmer_harvest: { npc: 'farmer', stage: 'furnace', needs: { pumpkin: 3, leek: 3 }, reward: { items: { glass: 2, bean_seed: 2 } }, text: '南瓜と苔ねぎが育ったら見せて。ガラスと豆の種をあげる。' },
  builder_brick: { npc: 'builder', stage: 'furnace', needs: { brick: 6, charcoal: 3 }, reward: { items: { glass: 3, copper_bar: 1 } }, text: '煉瓦と炭が足りない。ガラスと銅を礼にしよう。' },
  cook_cave: { npc: 'cook', stage: 'moss', needs: { cave_mushroom: 4, fish_trout: 2 }, reward: { items: { fish_oil: 2, honey: 3 } }, text: '洞窟茸と鱒でとびきりの鍋を作る。材料を頼む。' },
  farmer_flax: { npc: 'farmer', stage: 'moss', needs: { cloth: 6, flax: 4 }, reward: { items: { rope: 4, glow_carrot_seed: 3 } }, text: '布と亜麻を。縄と人参の種を渡そう。' },
  builder_glass: { npc: 'builder', stage: 'moss', needs: { glass: 3, brick: 4 }, reward: { items: { glass: 2, wax: 2, copper_bar: 2 } }, text: 'ガラスと煉瓦で窓を作る。礼は材料で。' },
  builder_oil: { npc: 'builder', stage: 'moss', needs: { fish_oil: 2, wax: 2 }, reward: { items: { glowmoss: 6, resin: 4 } }, text: '魚油と蝋で灯を作る。光苔と樹脂を持っていけ。' },
  cook_feast: { npc: 'cook', stage: 'seal', needs: { fish_stew: 1, sweet_pumpkin_pie: 1, pike_roll: 1 }, reward: { items: { honey: 6, wax: 4, glass: 2 } }, text: '封印が開いた祝いの膳を。魚のシチュー、南瓜のパイ、カマスの包みを。' },
  farmer_rare: { npc: 'farmer', stage: 'seal', needs: { fish_bream: 1, fish_eel: 1 }, reward: { items: { fur: 2, reed: 4, rope: 2 } }, text: '夜の魚を見たい。月鯛と光うなぎを。護符の材料を渡そう。' },
  builder_final: { npc: 'builder', stage: 'seal', needs: { brick: 8, glass: 4, charcoal: 4 }, reward: { items: { copper_bar: 3, glass: 3, wax: 2 } }, text: '境に最後の修繕を。煉瓦・ガラス・炭を集めてくれ。' },
};

/* ------------------------------------------------------------------ 図鑑 */
// kind: fish(キーは魚id) / forage(キーはノードtype) / dish(キーは料理item id) / crop(キーは作物kind)。名前はUI用
const EXISTING_DISHES = {
  roast_mushroom: '焼きキノコ', baked_potato: '焼き芋', wheat_bread: '灯麦パン', forest_stew: '森のシチュー', moss_pie: '光苔のパイ', potion: '回復薬',
};
const DISH_ITEM_IDS = [
  'grilled_fish', 'salt_fish', 'fish_soup', 'smoked_fish', 'smoked_eel', 'fish_stew', 'bream_plate', 'pike_roll', 'honey_toast', 'herb_tea',
  'pumpkin_soup', 'roast_pumpkin', 'carrot_glaze', 'leek_soup', 'bean_stew', 'chili_stew', 'spice_skewer', 'cave_roast', 'cave_stew',
  'glow_salad', 'bean_bread', 'potato_gratin', 'sweet_pumpkin_pie',
];
const itemName = (id) => CONTENT_ITEMS.find((it) => it.id === id).name;
export const JOURNAL = {
  fish: Object.fromEntries(Object.entries(FISH).map(([id, f]) => [id, { name: f.name, item: f.item }])),
  forage: {
    herb: { name: '薬草', item: 'herb' }, honey_hive: { name: '蜂の巣', item: 'honey' }, sand_patch: { name: '砂地', item: 'sand' },
    salt_rock: { name: '岩塩', item: 'salt' }, reed_bed: { name: '葦', item: 'reed' }, clay: { name: '粘土地', item: 'clay' },
    cave_mushroom: { name: '洞窟茸', item: 'cave_mushroom' },
  },
  dish: {
    ...Object.fromEntries(Object.entries(EXISTING_DISHES).map(([id, name]) => [id, { name, item: id }])),
    ...Object.fromEntries(DISH_ITEM_IDS.map((id) => [id, { name: itemName(id), item: id }])),
  },
  crop: {
    moss_potato: { name: '苔芋', item: 'moss_potato' }, wheat: { name: '灯麦', item: 'wheat' },
    ...Object.fromEntries(Object.entries(CONTENT_CROPS).map(([k, c]) => [k, { name: c.name, item: c.harvest[0].item }])),
  },
};

/* ------------------------------------------------------------------ 追加の生活目標(6件) */
// metric.kind: journalCount(kind) / requestsDone / decorPlaced(DECOR_TYPES) / ownedAny(items=いずれか所持=種類数)
// 配列駆動の getLifeGoals が読む。達成は state.progress.goals[id] に一度きり保存(既存goalsと同じ)
export const EXTRA_GOALS = [
  { id: 'fish_all', text: '魚を8種類釣る', target: 8, metric: { kind: 'journalCount', journal: 'fish' } },
  { id: 'dish_ten', text: '料理を10種類作る', target: 10, metric: { kind: 'journalCount', journal: 'dish' } },
  { id: 'requests_all', text: '住人の依頼をすべて達成する', target: Object.keys(REQUESTS).length, metric: { kind: 'requestsDone' } },
  { id: 'crops_eight', text: '作物を8種類収穫する', target: 8, metric: { kind: 'journalCount', journal: 'crop' } },
  { id: 'decor_ten', text: '飾りを10個置く', target: 10, metric: { kind: 'decorPlaced', types: DECOR_TYPES } },
  { id: 'lanterns_two', text: '携帯灯を2種類そろえる', target: 2, metric: { kind: 'ownedAny', items: ['lantern', 'crystal_lantern'] } },
];

/* ------------------------------------------------------------------ 新ノードの配置規則(旧worldへの補充) */
// layer: 'surface' | 'underground'(map.id)。biome: TERRAIN_INFO の id(配列のいずれか)。near: 'water'(水タイルが隣接2以内) | 'rock'(岩ノード/岩場が2以内)
// 配列順が生成順で固定。位置は保存せず、種から毎回再現する。
export const SPAWN_RULES = [
  { id: 'herb', node: 'herb', layer: 'surface', biome: ['grass', 'darkgrass'], count: 40, minGap: 2 },
  { id: 'honey', node: 'honey_hive', layer: 'surface', biome: ['darkgrass'], count: 10, minGap: 2 },
  { id: 'clay_shore', node: 'clay', layer: 'surface', biome: ['sand'], near: 'water', count: 20, minGap: 2 },
  { id: 'sand_shore', node: 'sand_patch', layer: 'surface', biome: ['sand'], near: 'water', count: 20, minGap: 2 },
  { id: 'reed_shore', node: 'reed_bed', layer: 'surface', biome: ['sand', 'grass'], near: 'water', count: 25, minGap: 2 },
  { id: 'salt', node: 'salt_rock', layer: 'surface', biome: ['rocky'], near: 'rock', count: 18, minGap: 2 },
  { id: 'cave_mushroom', node: 'cave_mushroom', layer: 'underground', biome: ['moss_floor'], count: 24, minGap: 2 },
];
// 固定候補列の方針(後工程=activities.augmentContentNodes が従う)。旧saveのnode keyを動かさないための規則:
//  1. ruleごとに mulberry32(hash(worldSeed, seedPrefix + rule.id)) で、layer/biome/near が合う全セルを走査順(行優先)に並べ、1回だけ固定シャッフルした「候補列」を作る。
//  2. 候補列を先頭から見て、world生成だけで決まる条件(NODE_TERRAIN・歩行可・既存の生成ノード・gate・safe区域・house半径・spawn2以内・既に採った新ノードとのminGap)を満たす候補だけを count 個まで採る。
//  3. プレイヤー由来の状態(structure・crop・畑)に重なる候補は「配置しない(skip)」。skipした分を後ろの候補で穴埋めしない。
//     → 建築物が増減しても採用済みの他のkeyは動かない。建物を撤去したセルは次回loadで候補に戻る(仕様)。
//  4. 試行は maxTries まで。足りない分は置かない(エラーにしない)。
export const SPAWN_POLICY = { seedPrefix: 'c1:', maxTries: 4000, order: 'rules-array', structureCollision: 'skip-no-backfill' };
