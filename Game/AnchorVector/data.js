export const GAME_VERSION = '1.1.0';
export const SAVE_SCHEMA = 1;

export const RECORDS = [
  '環状暦 0000 — 保守系統、応答。居住信号、なし。',
  '分離命令は外部からではない。リング自身が選んだ。',
  '落下を避けるには、ひとつであることをやめる必要があった。',
  '切断された区画は、それぞれ別の夜を回り続けている。',
  '回収機は記録を運ぶ。記録は回収機を帰還させない。',
  '航路灯は消えていない。見る者がいなくなっただけだ。',
  '中枢は救難信号を送らなかった。代わりに座標を消した。',
  '最終乗員数、零。最終退避艇数、全艇。',
  '破壊ではなく退避。敗北ではなく選択。',
  'リングは都市を救うため、自らを空から除外した。',
  '残響は命令ではない。完了を待つ記録である。',
  'AV-7、全核を確認。最後の仕事は、帰還ではなく停止。',
];

export const CHASSIS = {
  lancer: {
    id: 'lancer',
    name: 'AV-7 LANCER',
    shortName: 'LANCER',
    description: '長い直線と弱点への直撃に優れる標準機。',
    passive: '10m以上離れた核への直撃威力+35%。',
    unlock: '初期機体',
    shield: 3,
    damage: 2,
    speed: 1,
  },
  weaver: {
    id: 'weaver',
    name: 'AV-3 WEAVER',
    shortName: 'WEAVER',
    description: '閉じた経路と残留ワイヤーを操る技巧機。',
    passive: '小さな経路でもVECTOR SEALが成立。直撃威力-15%。',
    unlock: '通常エンド到達',
    shield: 3,
    damage: 1.7,
    speed: 1.05,
  },
  bulwark: {
    id: 'bulwark',
    name: 'AV-9 BULWARK',
    shortName: 'BULWARK',
    description: '正面防御と衝突攻撃に優れる重装機。',
    passive: '計画開始直後の攻撃を防ぐ。移動速度-10%。',
    unlock: '深度3クリア',
    shield: 4,
    damage: 2.15,
    speed: 0.9,
  },
};

export const MODULE_CATEGORIES = {
  strike: { name: 'STRIKE', jp: '斬撃', icon: 'strike', color: '#43f5d0' },
  wire: { name: 'WIRE', jp: '経路', icon: 'wire', color: '#42b8ff' },
  impact: { name: 'IMPACT', jp: '衝突', icon: 'impact', color: '#ffb84a' },
  flow: { name: 'FLOW', jp: '流動', icon: 'flow', color: '#b889ff' },
};

export const MODULES = [
  module('longEdge', 'strike', 'LONG EDGE', '長い刃', '8m以上の線分威力が{v}%上昇。', [25, 40, 55]),
  module('secondCut', 'strike', 'SECOND CUT', '連鎖斬り', '同一行動の2体目以降への威力が{v}%上昇。', [20, 35, 50]),
  module('backTrace', 'strike', 'BACK TRACE', '背面追跡', '背面攻撃後、次の線分威力が{v}%上昇。', [30, 50, 75]),
  module('piercer', 'strike', 'PIERCER', '盾穿ち', '盾による軽減率を{v}%減少。', [20, 35, 50]),
  module('execute', 'strike', 'EXECUTE', '終端処理', 'HP25%以下への威力が{v}%上昇。', [40, 70, 100], 'rare'),
  module('firstLight', 'strike', 'FIRST LIGHT', '最初の光', '各戦闘の初撃が{v}倍。', [2, 2.5, 3], 'core'),

  module('liveWire', 'wire', 'LIVE WIRE', '残光線', '通過した経路が{v}秒残り、接触ダメージ。', [2, 3, 4]),
  module('smallSeal', 'wire', 'SMALL SEAL', '広域封印', 'VECTOR SEALの成立距離が{v}%拡大。', [20, 35, 50]),
  module('closedCircuit', 'wire', 'CLOSED CIRCUIT', '閉回路', 'SEAL発動ごとにFLOW+{v}。', [8, 12, 16]),
  module('tension', 'wire', 'TENSION', '張力', '経路の折れ角が鋭いほど威力上昇。最大{v}%。', [20, 35, 50]),
  module('afterline', 'wire', 'AFTERLINE', '遅延軌跡', '{v}秒後に経路を残像が再走。', [1.4, 1.1, 0.8], 'rare'),
  module('snare', 'wire', 'SNARE', '環状拘束', '同じ敵を囲むと{v}秒停止。', [2, 3, 4], 'core'),

  module('carry', 'impact', 'CARRY', '搬送衝撃', '小型敵を終点方向へ{v}m運ぶ。', [1.5, 2.4, 3.2]),
  module('collider', 'impact', 'COLLIDER', '対衝突', '敵同士の衝突威力が{v}%上昇。', [50, 90, 140]),
  module('wallbreak', 'impact', 'WALLBREAK', '壁面破砕', '長距離線分の終点で{v}範囲ダメージ。', [1, 1.5, 2]),
  module('shockArrival', 'impact', 'SHOCK ARRIVAL', '到着波', '終点に威力{v}%の衝撃波。', [30, 50, 75]),
  module('heavyVector', 'impact', 'HEAVY VECTOR', '重軌道', '経路速度-10%、威力+{v}%。', [35, 55, 80], 'rare'),
  module('kineticShield', 'impact', 'KINETIC SHIELD', '運動障壁', '{v}m以上の移動後、1回だけ被弾を無効化。', [14, 12, 10], 'core'),

  module('nearMiss', 'flow', 'NEAR MISS', '近接回収', 'ニアミスFLOWが{v}%上昇。', [50, 80, 120]),
  module('momentum', 'flow', 'MOMENTUM', '運動継続', 'FLOW{v}以上で経路点+1。', [60, 50, 40]),
  module('overclock', 'flow', 'OVERCLOCK', '過流動', 'FLOW75以上で速度と威力+{v}%。', [20, 30, 40]),
  module('reverse', 'flow', 'REVERSE', '逆走', 'OVERTRACEの復路威力が{v}%上昇。', [35, 60, 90]),
  module('calmCore', 'flow', 'CALM CORE', '静穏核', '計画中の敵時間をさらに{v}%低下。', [15, 25, 35], 'rare'),
  module('lastSignal', 'flow', 'LAST SIGNAL', '最後の信号', 'シールド1で威力+{v}%、FLOW低下なし。', [25, 40, 60], 'core'),
];

function module(id, category, name, jp, description, values, rarity = 'common') {
  return { id, category, name, jp, description, values, rarity };
}

export function moduleDescription(moduleData, level = 1) {
  const value = moduleData.values[Math.min(2, Math.max(0, level - 1))];
  return moduleData.description.replace('{v}', String(value));
}

export const INITIAL_MODULES = [
  'longEdge', 'secondCut', 'backTrace',
  'liveWire', 'smallSeal', 'closedCircuit',
  'carry', 'collider', 'shockArrival',
  'nearMiss', 'momentum', 'overclock',
];

export const ENEMIES = {
  seeker: enemy('SEEKER', '追尾する範囲弾。予告地点から離れる。', 3, 4.6, 12, 0.58),
  lancer: enemy('LANCER', '長い予告線の後に貫通射撃。', 4, 5.2, 17, 0.64),
  warden: enemy('WARDEN', '正面盾。背後または側面から斬る。', 6, 5.8, 22, 0.72, { shield: true }),
  bloom: enemy('BLOOM', 'アンカーノードへ時限機雷を設置。', 4, 5.5, 18, 0.65),
  tether: enemy('TETHER', 'ノードを一時封鎖する拘束線。', 5, 6, 20, 0.7),
  mirror: enemy('MIRROR', '直前に描いた経路を遅れて攻撃。', 5, 6.4, 24, 0.66),
  forge: enemy('FORGE', 'SEEKERを生産する母機。', 8, 7.2, 30, 0.82),
  null: enemy('NULL', '計画中の時間減速を弱めるエリート。', 12, 7.5, 48, 0.9, { elite: true }),
};

function enemy(name, description, hp, cooldown, reward, radius, extra = {}) {
  return { name, description, hp, cooldown, reward, radius, telegraph: Math.min(3.2, cooldown * 0.56), ...extra };
}

export const BOSSES = {
  ringWarden: { name: 'RING WARDEN', jp: '環状守護機', hp: 44, reward: 180, radius: 3.6, phases: 3 },
  tetraCrown: { name: 'TETRA CROWN', jp: '四面冠', hp: 58, reward: 260, radius: 3.5, phases: 4 },
  vesperCore: { name: 'VESPER CORE', jp: '星環中枢', hp: 76, reward: 420, radius: 4.2, phases: 4 },
};

export const DEPTHS = [
  depth(0, '基準軌道', '標準規則。', 1, 1, 0),
  depth(1, '高密度域', '敵HP+12%。', 1.12, 1, 0),
  depth(2, '残響増幅', '予告が重なる敵が増える。', 1.2, 1.04, 0),
  depth(3, '精鋭混入', 'エリート敵が出現。', 1.28, 1.08, 1),
  depth(4, '遮断航路', '封鎖ノードが1つ増える。', 1.38, 1.1, 1),
  depth(5, '短周期', '敵攻撃間隔-8%。', 1.48, 1.12, 1),
  depth(6, '二重警報', '同時に2種の攻撃予告。', 1.58, 1.16, 2),
  depth(7, '硬化外装', '盾持ちと母機が増える。', 1.72, 1.18, 2),
  depth(8, '逆位相', 'MIRRORの再生速度上昇。', 1.86, 1.22, 2),
  depth(9, '零点干渉', 'NULLが通常戦にも出現。', 2, 1.25, 3),
  depth(10, '崩壊目前', '戦場機雷が周期発生。', 2.15, 1.28, 3),
  depth(11, '中枢防衛', 'ボスが追加攻撃を使用。', 2.32, 1.32, 3),
  depth(12, '最終命令', 'すべての変異が有効。', 2.5, 1.36, 4),
];

function depth(id, name, description, hpMultiplier, attackMultiplier, extraEnemies) {
  return { id, name, description, hpMultiplier, attackMultiplier, extraEnemies };
}

export const MODES = {
  expedition: { id: 'expedition', name: '潜行', description: '7戦を突破して帰還。', icon: 'expedition' },
  daily: { id: 'daily', name: '日替わり航路', description: '本日の固定航路で記録更新。', icon: 'daily', unlock: '通常エンド' },
  endless: { id: 'endless', name: '無限残響', description: '限界まで連戦。', icon: 'endless', unlock: '深度3' },
  bossRush: { id: 'bossRush', name: '中枢連戦', description: 'ボス3機を連続撃破。', icon: 'boss', unlock: '深度6' },
};

export const SKINS = [
  { id: 'cyan', name: '航路色', color: '#43f5d0', price: 0, corePrice: 0 },
  { id: 'amber', name: '警戒色', color: '#ffb84a', price: 250, corePrice: 0 },
  { id: 'violet', name: '中枢色', color: '#b889ff', price: 320, corePrice: 2 },
  { id: 'coral', name: '残響色', color: '#ff5e73', price: 480, corePrice: 4 },
  { id: 'white', name: '無色光', color: '#dce7e5', price: 0, corePrice: 0, unlock: 'trueEnding' },
];

export const ACHIEVEMENTS = [
  achievement('firstKill', '最初の切断', '敵を1体撃破する。'),
  achievement('firstReturn', '帰還信号', '資源を確定して帰還する。'),
  achievement('firstBoss', '環の番人', 'ボスを初めて撃破する。'),
  achievement('clearLancer', '長い刃', 'LANCERで出撃を完遂する。'),
  achievement('clearWeaver', '閉じた線', 'WEAVERで出撃を完遂する。'),
  achievement('clearBulwark', '動く盾', 'BULWARKで出撃を完遂する。'),
  achievement('ringWarden', '三重環停止', 'RING WARDENを撃破する。'),
  achievement('tetraCrown', '四面冠崩壊', 'TETRA CROWNを撃破する。'),
  achievement('vesperCore', '星環の残響', 'VESPER COREを撃破する。'),
  achievement('depth3', '深度3', '深度3を完遂する。'),
  achievement('depth6', '深度6', '深度6を完遂する。'),
  achievement('depth9', '深度9', '深度9を完遂する。'),
  achievement('depth12', '最終命令', '深度12を完遂する。'),
  achievement('chain10', '一筆十閃', 'CHAIN 10へ到達する。'),
  achievement('chain20', '切れない航路', 'CHAIN 20へ到達する。'),
  achievement('seal4', '完全包囲', '1回のSEALで4体を攻撃する。'),
  achievement('noDamage', '無傷帰還', '被弾せず出撃を完遂する。'),
  achievement('modulesHalf', '解析50%', 'モジュール図鑑を半分埋める。'),
  achievement('modulesAll', '全系統解析', '全モジュールを取得する。'),
  achievement('allRecords', '十二の残響', '全記録を回収する。'),
  achievement('daily7', '七日航路', '日替わり航路へ7日参加する。'),
  achievement('endless20', '終わらない線', '無限残響で20戦突破する。'),
  achievement('allChassisDepth6', '三機帰還', '全機体で深度6以上を完遂する。'),
];

function achievement(id, name, description) {
  return { id, name, description };
}

export const TUTORIAL_STEPS = [
  { title: '① 長押し', body: '時間が遅くなる。青い円へなぞって離す。', goal: 'route' },
  { title: '② 赤い核', body: '核を直接なぞって離す。一筆で撃破。', goal: 'kill' },
  { title: '③ 黄から離れる', body: '攻撃予告の外へ移動。', goal: 'dodge' },
  { title: '④ 囲む', body: '3点で敵を囲む。VECTOR SEAL発動。', goal: 'seal' },
];

export const INITIAL_UNLOCKS_AFTER_ENDING = ['execute', 'firstLight', 'afterline', 'snare', 'heavyVector', 'kineticShield'];
export const FINAL_UNLOCKS_AT_DEPTH3 = ['piercer', 'tension', 'wallbreak', 'nearMiss', 'calmCore', 'lastSignal'];
