// キャラクリ項目の定義（UI はここから自動生成する）
// type: range / select / color / toggle
const R = (id, label, min = -1, max = 1, def = 0, step = 0.01, extra = {}) => ({ id, label, type: 'range', min, max, def, step, ...extra });
const S = (id, label, options, def) => ({ id, label, type: 'select', options, def });
const C = (id, label, def) => ({ id, label, type: 'color', def });
const T = (id, label, def) => ({ id, label, type: 'toggle', def });

export const CATEGORIES = [
  { id: 'preset', label: 'プリセット', icon: '★', groups: [] },
  {
    id: 'body', label: '体型', icon: '体', groups: [
      { label: '全体', items: [R('height', '身長', 0.86, 1.14, 1.0, 0.005), R('muscle', '筋肉', 0, 1, 0.35), R('fat', '肉づき', -1, 1, 0), R('belly', 'お腹', 0, 1, 0)] },
      { label: '上半身', items: [R('shoulderW', '肩幅'), R('chest', '胸板の厚み'), R('pecs', '胸筋'), R('waist', 'ウエスト'), R('torsoLen', '胴の長さ'), R('neckThick', '首の太さ'), R('neckLen', '首の長さ')] },
      { label: '腕・手', items: [R('armLen', '腕の長さ'), R('armThick', '腕の太さ'), R('handSize', '手の大きさ')] },
      { label: '下半身', items: [R('hipW', '腰幅'), R('glutes', 'お尻'), R('legLen', '脚の長さ'), R('legThick', '脚の太さ'), R('calf', 'ふくらはぎ'), R('footSize', '足の大きさ')] },
    ],
  },
  {
    id: 'head', label: '頭・顔', icon: '顔', groups: [
      { label: '頭の形', items: [R('headSize', '頭の大きさ'), R('headW', '頭の幅'), R('craniumH', '頭頂の高さ'), R('forehead', 'おでこ'), R('brow', '眉骨')] },
      { label: '輪郭', items: [R('cheek', '頬のふくらみ'), R('jaw', 'あご・のど'), R('stop', '額とマズルの段差')] },
    ],
  },
  {
    id: 'muzzle', label: 'マズル', icon: '鼻', groups: [
      { label: 'マズル', items: [R('muzLen', '長さ', -1, 1, 0), R('muzW', '太さ（幅）'), R('muzH', '厚み（高さ）'), R('muzTaper', '先端の細さ'), R('muzDrop', '角度（下向き）'), R('bridge', '鼻筋の高さ')] },
      { label: '口まわり', items: [R('padSize', '上唇のふくらみ'), R('jawLen', '下あごの長さ')] },
    ],
  },
  {
    id: 'eyes', label: '目', icon: '目', groups: [
      { label: '形', items: [R('eyeSize', '大きさ', 0.014, 0.032, 0.021, 0.0005), R('eyeAspect', '縦の幅', 0.35, 1.25, 0.78), R('eyeTilt', 'つり目 ↔ たれ目', -0.45, 0.55, 0.14), R('eyeUpper', '上まぶたの丸み', 0.25, 1.5, 0.7), R('eyeLower', '下まぶたの深さ', 0.1, 0.95, 0.45)] },
      { label: '位置', items: [R('eyeX', '間隔', -0.012, 0.012, 0, 0.0005), R('eyeY', '高さ', -0.014, 0.014, 0, 0.0005)] },
      { label: '瞳', items: [R('irisSize', '瞳の大きさ', 0.3, 1.0, 0.62), R('irisY', '瞳の上下', -0.4, 0.4, 0.0), S('pupilType', '瞳孔の形', ['丸', '縦長', 'なし', '横長'], 0), R('pupilSize', '瞳孔の大きさ', 0, 0.95, 0.42), C('irisTop', '瞳の色（上）', '#2d6a3a'), C('irisBot', '瞳の色（下）', '#b8e05a'), R('highlight', 'ハイライト', 0, 1.6, 1.0), C('sclera', '白目の色', '#fbfaf6')] },
      { label: 'まぶた・まつげ', items: [R('lidW', 'まぶたの線の太さ', 0.3, 2.2, 1.0), R('lashes', 'まつげ', 0, 1, 0.0), C('lidColor', '線の色', '#2a1c1a')] },
      { label: '眉', items: [S('browType', '眉の種類', ['なし', '線', '麻呂眉', '太眉'], 1), R('browY', '眉の高さ', -0.5, 0.6, 0), R('browAngle', '眉の角度', -0.6, 0.6, 0.1), R('browW', '眉の太さ', 0.4, 1.8, 1.0), C('browColor', '眉の色', '#3a2a22')] },
    ],
  },
  {
    id: 'mouth', label: '鼻・口', icon: '口', groups: [
      { label: '鼻', items: [S('noseType', '鼻の形', ['犬', '猫', '熊', 'ハート', '丸'], 0), R('noseSize', '大きさ', 0.6, 1.6, 1.0), R('noseW', '横幅', 0.6, 1.6, 1.0), R('noseH', '高さ', 0.6, 1.5, 1.0), R('noseY', '上下', -0.012, 0.012, 0, 0.0005), R('noseZ', '前後', -0.012, 0.01, 0, 0.0005), C('noseColor', '鼻の色', '#2b2224'), R('noseGloss', 'つや', 0, 1.5, 1.0)] },
      { label: '口', items: [R('mouthY', '口の高さ', -0.05, -0.018, -0.034, 0.0005), R('mouthCorner', '口の長さ', 0.0, 0.7, 0.3), R('smile', '口角', -1, 1, 0.25), R('mouthW', '線の太さ', 0.6, 3.0, 1.6), R('omega', 'ω口', 0, 1, 0.0), T('philtrum', '鼻下の線', true), R('fang', '牙', 0, 1, 0.0), R('fangX', '牙の位置', 0.006, 0.03, 0.016, 0.0005)] },
      { label: 'ヒゲ', items: [S('whiskers', 'ヒゲ', ['なし', '2本', '3本', '4本'], 0), R('whiskerLen', '長さ', 0.5, 1.8, 1.0), R('whiskerCurve', 'たれ具合', -1, 1, 0.3), C('whiskerColor', 'ヒゲの色', '#f6f2ea'), T('whiskerDots', 'ヒゲの点', false)] },
    ],
  },
  {
    id: 'ears', label: '耳', icon: '耳', groups: [
      { label: '形', items: [S('earType', '耳の種類', ['とがり耳', '大きいとがり耳', '猫耳', '丸耳', '垂れ耳', 'うさぎ耳'], 0), R('earSize', '大きさ', 0.6, 1.5, 1.0), R('earW', '横幅', 0.6, 1.5, 1.0), R('earH', '長さ', 0.6, 1.6, 1.0), R('earRound', '丸み', 0, 1, 0.25), R('earCup', 'くぼみ', 0, 1, 0.5), R('earFold', '先の垂れ', 0, 1, 0)] },
      { label: '位置・角度', items: [R('earX', '左右の位置', -1, 1, 0), R('earY', '上下の位置', -1, 1, 0), R('earOut', '外への傾き', -1, 1, 0), R('earBack', '後ろへの傾き', -1, 1, 0), R('earTurn', '向き', -1, 1, 0)] },
      { label: '毛と色', items: [R('earFluff', '耳の中の毛', 0, 1, 0.6), C('earInner', '耳の内側', '#f0d2c4'), R('earTipAmt', '耳先の色の範囲', 0, 0.6, 0.0), C('earTipColor', '耳先の色', '#3b2a22')] },
    ],
  },
  {
    id: 'hair', label: '髪・たてがみ', icon: '髪', groups: [
      { label: '頭の毛', items: [S('hairStyle', '髪型', ['なし', 'ツンツン', '前髪', 'オールバック', 'ワイルド', 'モヒカン', '長髪'], 1), R('hairLen', '長さ', 0.4, 1.8, 1.0), R('hairVol', 'ボリューム', 0.5, 1.6, 1.0), R('hairSharp', '毛先の鋭さ', 0, 1, 0.6), R('hairMess', 'ランダムさ', 0, 1, 0.35), R('hairFlow', '流れ（前↔後）', -1, 1, 0)] },
      { label: '色', items: [T('hairUseFur', '毛色と同じ', true), C('hairColor', '髪の色', '#8b5a34'), R('hairTipAmt', '毛先の色の範囲', 0, 0.8, 0.0), C('hairTipColor', '毛先の色', '#f4e6d4')] },
      { label: '顔まわり', items: [S('cheekFluff', '頬毛', ['なし', '小', '大', '二段'], 2), R('cheekLen', '頬毛の長さ', 0.5, 1.8, 1.0), R('cheekSpread', '頬毛の広がり', -1, 1, 0), R('mane', 'たてがみ', 0, 1, 0), R('maneLen', 'たてがみの長さ', 0.5, 1.8, 1.0), R('beard', 'あごの毛', 0, 1, 0)] },
    ],
  },
  {
    id: 'fur', label: '体毛', icon: '毛', groups: [
      { label: '毛の房', items: [R('chestFluff', '胸毛', 0, 1, 0.5), R('chestLen', '胸毛の長さ', 0.5, 1.8, 1.0), R('neckRuff', '首まわりの毛', 0, 1, 0.3), R('shoulderFluff', '肩の毛', 0, 1, 0), R('backMane', '背中の毛', 0, 1, 0), R('elbowTuft', 'ひじの毛', 0, 1, 0.4), R('wristTuft', '手首の毛', 0, 1, 0.3), R('ankleTuft', 'かかとの毛', 0, 1, 0.3)] },
      { label: '毛並み', items: [R('furFringe', '輪郭の毛のふさふさ', 0, 1, 0.3), R('furDens', '輪郭の毛の細かさ', 0.6, 1.8, 1.0), R('tuftSharp', '房の鋭さ', 0, 1, 0.6), R('tuftWide', '房の太さ', 0.6, 1.6, 1.0), R('furJag', '影の毛並み表現', 0, 1, 0.35), R('jag', '模様の境目のギザギザ', 0, 1, 0.5)] },
    ],
  },
  {
    id: 'tail', label: '尻尾', icon: '尾', groups: [
      { label: '形', items: [S('tailType', '尻尾の種類', ['狼', '狐', '猫', '獅子', '熊', 'うさぎ', 'なし'], 0), R('tailLen', '長さ', 0.5, 1.6, 1.0), R('tailThick', '太さ', 0.5, 1.6, 1.0), R('tailFluff', 'ふさふさ', 0, 1, 0.6), R('tailUp', '上げ具合', -1, 1, 0), R('tailCurl', '巻き', -1, 1, 0.1)] },
      { label: '色と動き', items: [R('tailTipAmt', '先の色の範囲', 0, 0.7, 0.0), C('tailTipColor', '先の色', '#f4e6d4'), R('tailSway', '揺れ', 0, 1, 0.5)] },
    ],
  },
  {
    id: 'color', label: '毛色・模様', icon: '色', groups: [
      { label: '毛色', items: [C('furMain', 'メインの毛色', '#c98a52'), C('furSub', 'サブ（腹・マズル）', '#f4e6d4'), C('furAccent', '手足の先', '#4a3426'), C('padColor', '肉球', '#4b3a3c')] },
      { label: '塗り分け', items: [R('bellyW', '腹・胸の幅', 0, 1.4, 0.55), R('muzzleCover', 'マズルの色の範囲', 0, 1, 0.45), R('cheekWhite', '頬の色', 0, 1, 0), R('sockArm', '手の先の色', 0, 1, 0.0), R('sockLeg', '足の先の色', 0, 1, 0.0)] },
      { label: '模様', items: [S('pattern', '模様', ['なし', '縞', '斑点', 'ぶち'], 0), C('patternColor', '模様の色', '#3b2a22'), R('patternScale', '模様の大きさ', 0.5, 2.0, 1.0), R('patternAmt', '模様の量', 0, 1, 0.5), R('backMark', '背中の色', 0, 1, 0), R('eyeMask', '目のまわり', 0, 1, 0), R('foreheadMark', '額の模様', 0, 1, 0)] },
    ],
  },
  {
    id: 'outfit', label: '服', icon: '服', groups: [
      { label: '上', items: [S('top', '上の服', ['なし', 'タンクトップ', 'Tシャツ', '長袖'], 0), C('topColor', '色', '#3d5a80'), R('topNeck', '襟ぐり', 0, 1, 0.3)] },
      { label: '下', items: [S('bottom', '下の服', ['ショートパンツ', 'ハーフパンツ', 'ロングパンツ'], 1), C('bottomColor', '色', '#2e3440'), T('belt', 'ベルト', true), C('beltColor', 'ベルトの色', '#7a5230')] },
      { label: '小物', items: [T('scarf', 'スカーフ', false), C('scarfColor', 'スカーフの色', '#c8423b'), T('bracelet', '腕輪', false), C('accColor', '腕輪の色', '#d9b45a')] },
    ],
  },
  {
    id: 'pose', label: 'ポーズ・表情', icon: '動', groups: [
      { label: 'ポーズ', items: [S('pose', 'ポーズ', ['自然体', 'Aポーズ', '腰に手', '手を挙げる'], 0), T('idle', '待機モーション', true), T('lookCam', 'カメラを見る', true)] },
      { label: '表情', items: [S('expr', '表情', ['ふつう', '笑顔', 'にっこり', '怒り', '驚き', 'ジト目', '目閉じ'], 0), R('mouthOpen', '口の開き', 0, 1, 0), T('blink', 'まばたき', true)] },
    ],
  },
  {
    id: 'view', label: '表示・ライト', icon: '光', groups: [
      { label: '表示', items: [S('theme', '背景', ['明るいスタジオ', '星空ステージ'], 0), T('faceViews', '顔の3面プレビュー', true), T('faceViewExpr', '3面プレビューで表情を変える', true), T('turntable', '自動で回転', false)] },
      { label: '絵づくり', items: [R('outlineW', '輪郭線の太さ', 0, 3.5, 1.6), R('anime', 'アニメ度（影の硬さ）', 0, 1, 0.75), R('shadeHue', '影の色味（暖↔寒）', -1, 1, 0.35), R('shadeDark', '影の濃さ', 0, 1, 0.45), R('rim', 'リムライト', 0, 1.5, 0.5), R('faceSoft', '顔の影をやわらかく', 0, 1, 0.45)] },
      { label: 'ライト', items: [R('lightAz', 'ライトの向き', -1.5, 1.5, -0.55), R('lightEl', 'ライトの高さ', 0.1, 1.3, 0.62)] },
    ],
  },
];

export const ITEMS = {};
for (const c of CATEGORIES) for (const g of c.groups) for (const it of g.items) ITEMS[it.id] = it;

export const DEFAULT_STATE = Object.fromEntries(Object.values(ITEMS).map(it => [it.id, it.def]));

// 種族プリセット（DEFAULT_STATE との差分）
export const PRESETS = [
  {
    name: '狼', sub: 'オオカミ', swatch: ['#7d7f86', '#e9e6e0'], s: {
      muzLen: 0.45, muzW: -0.1, muzH: -0.05, muzTaper: 0.2, stop: 0.2, cheek: 0.2, earType: 0, earSize: 1.0, earH: 1.1, earRound: 0.15,
      furMain: '#7d7f86', furSub: '#ece9e4', furAccent: '#4b4c52', patternColor: '#3f4046', backMark: 0.55, cheekWhite: 1, muzzleCover: 0.55, bellyW: 0.6,
      irisTop: '#7a5a12', irisBot: '#f2c33a', eyeTilt: 0.3, eyeAspect: 0.66, browType: 1, hairStyle: 4, cheekFluff: 2, tailType: 0, neckRuff: 0.6, chestFluff: 0.7,
      noseType: 0, mouthCorner: 0.22, fang: 0.4, muscle: 0.5, shoulderW: 0.3,
    },
  },
  {
    name: '柴犬', sub: 'しばいぬ', swatch: ['#d38a43', '#fbf1e2'], s: {
      muzLen: 0.0, muzW: 0.1, muzTaper: 0.1, stop: 0.4, cheek: 0.45, earType: 0, earSize: 0.85, earRound: 0.35, earCup: 0.7, earOut: 0.2,
      furMain: '#d38a43', furSub: '#fbf1e2', furAccent: '#d38a43', cheekWhite: 1, muzzleCover: 0.75, bellyW: 0.7, browType: 2, browColor: '#fbf1e2', browW: 0.9, browY: -0.1,
      irisTop: '#2a170e', irisBot: '#6b3d1f', eyeAspect: 0.85, eyeTilt: 0.05, irisSize: 0.78, pupilSize: 0.5, hairStyle: 1, hairLen: 0.6, cheekFluff: 1,
      tailType: 0, tailCurl: 1.0, tailUp: 1.0, tailFluff: 0.5, smile: 0.7, mouthCorner: 0.26, fat: 0.15, muscle: 0.25,
    },
  },
  {
    name: '狐', sub: 'キツネ', swatch: ['#e07a2e', '#fff6ec'], s: {
      muzLen: 0.55, muzW: -0.35, muzH: -0.3, muzTaper: 0.65, stop: -0.2, headW: -0.1, earType: 1, earSize: 1.2, earH: 1.15, earRound: 0.1,
      furMain: '#e07a2e', furSub: '#fff6ec', furAccent: '#2f2422', sockArm: 0.78, sockLeg: 0.62, earTipAmt: 0.35, earTipColor: '#2f2422', muzzleCover: 0.6, cheekWhite: 1, bellyW: 0.6,
      irisTop: '#7a3b0a', irisBot: '#f4b23c', eyeTilt: 0.4, eyeAspect: 0.6, pupilType: 1, pupilSize: 0.5, tailType: 1, tailTipAmt: 0.25, tailTipColor: '#fff6ec',
      hairStyle: 2, cheekFluff: 3, chestFluff: 0.8, muscle: 0.2, fat: -0.3, shoulderW: -0.2,
    },
  },
  {
    name: '猫', sub: 'ネコ', swatch: ['#9a9590', '#f1ece6'], s: {
      muzLen: -0.85, muzW: 0.1, muzH: -0.25, muzTaper: -0.2, padSize: 0.7, stop: 0.6, jawLen: -0.4, headSize: 0.15, cheek: 0.35, earType: 2, earSize: 1.0, earRound: 0.2,
      furMain: '#9a9590', furSub: '#f1ece6', furAccent: '#f1ece6', patternColor: '#5d5853', pattern: 1, patternAmt: 0.45, sockArm: 0.82, sockLeg: 0.7,
      irisTop: '#3d7a3a', irisBot: '#d8ee7a', eyeAspect: 0.85, eyeTilt: 0.25, pupilType: 1, pupilSize: 0.35, irisSize: 0.75, noseType: 3, noseSize: 0.75, omega: 0.7, mouthCorner: 0.45,
      whiskers: 3, tailType: 2, hairStyle: 1, hairLen: 0.6, cheekFluff: 1, chestFluff: 0.3, muscle: 0.2,
    },
  },
  {
    name: '虎', sub: 'トラ', swatch: ['#e58a2a', '#2a1e18'], s: {
      muzLen: -0.45, muzW: 0.45, muzH: 0.2, padSize: 0.8, stop: 0.5, headW: 0.25, headSize: 0.1, cheek: 0.6, jaw: 0.4, earType: 3, earSize: 0.85,
      furMain: '#e58a2a', furSub: '#fbf3e6', furAccent: '#e58a2a', patternColor: '#241a16', pattern: 1, patternAmt: 0.55, patternScale: 1.0, cheekWhite: 1, muzzleCover: 0.7, bellyW: 0.75, earTipAmt: 0.25, earTipColor: '#241a16',
      irisTop: '#7a5a12', irisBot: '#f6d23a', eyeAspect: 0.7, eyeTilt: 0.2, noseType: 1, noseColor: '#c97a6e', whiskers: 3, mouthCorner: 0.42, fang: 0.5,
      tailType: 2, tailThick: 1.25, tailTipAmt: 0.12, tailTipColor: '#241a16', hairStyle: 4, cheekFluff: 3, cheekLen: 1.3, muscle: 0.85, shoulderW: 0.6, chest: 0.5, armThick: 0.5, neckThick: 0.5,
    },
  },
  {
    name: '獅子', sub: 'ライオン', swatch: ['#d4a25c', '#7a4a24'], s: {
      muzLen: -0.3, muzW: 0.45, muzH: 0.3, padSize: 0.7, stop: 0.4, headW: 0.2, cheek: 0.4, jaw: 0.5, earType: 3, earSize: 0.8,
      furMain: '#d4a25c', furSub: '#f2e2c4', furAccent: '#d4a25c', muzzleCover: 0.6, bellyW: 0.5, irisTop: '#6a4a10', irisBot: '#e8b83a', eyeAspect: 0.62, eyeTilt: 0.1,
      noseType: 1, noseColor: '#a8645a', noseSize: 1.2, hairStyle: 4, hairUseFur: false, hairColor: '#7a4a24', hairLen: 1.2, mane: 1, maneLen: 1.3, cheekFluff: 0,
      tailType: 3, muscle: 0.9, shoulderW: 0.7, chest: 0.6, armThick: 0.6, legThick: 0.4, neckThick: 0.7, fang: 0.3, beard: 0.5,
    },
  },
  {
    name: '熊', sub: 'クマ', swatch: ['#6b4a34', '#b88a62'], s: {
      muzLen: -0.2, muzW: 0.5, muzH: 0.35, muzTaper: -0.4, stop: 0.9, headW: 0.35, headSize: 0.1, cheek: 0.7, jaw: 0.6, earType: 3, earSize: 0.75, earY: -0.2,
      furMain: '#6b4a34', furSub: '#b88a62', furAccent: '#6b4a34', muzzleCover: 0.95, bellyW: 0.0, irisTop: '#1e120c', irisBot: '#4a2e1c', irisSize: 0.85, eyeAspect: 0.85, eyeSize: 0.018,
      noseType: 2, noseSize: 1.3, mouthCorner: 0.12, browType: 3, hairStyle: 1, hairLen: 0.5, cheekFluff: 1, chestFluff: 0.4, tailType: 4,
      fat: 0.6, belly: 0.6, muscle: 0.55, shoulderW: 0.5, armThick: 0.7, legThick: 0.7, neckThick: 0.9, neckLen: -0.6, height: 1.06,
    },
  },
  {
    name: '兎', sub: 'ウサギ', swatch: ['#f2efe9', '#c9b8ae'], s: {
      muzLen: -0.9, muzW: -0.1, muzH: -0.3, padSize: 0.5, stop: 0.8, headSize: 0.2, cheek: 0.5, earType: 5, earSize: 1.0,
      furMain: '#f2efe9', furSub: '#ffffff', furAccent: '#f2efe9', earInner: '#f3c6c4', irisTop: '#8a1e2e', irisBot: '#f05a6e', irisSize: 0.85, eyeAspect: 0.95, eyeTilt: -0.05,
      noseType: 4, noseColor: '#e89aa0', noseSize: 0.6, omega: 0.9, mouthCorner: 0.5, fang: 0, tailType: 5, hairStyle: 2, hairLen: 0.8, cheekFluff: 1,
      muscle: 0.15, fat: -0.2, shoulderW: -0.3, height: 0.94,
    },
  },
  {
    name: '黒豹', sub: 'パンサー', swatch: ['#2a2830', '#4a4652'], s: {
      muzLen: -0.5, muzW: 0.0, muzH: -0.1, padSize: 0.6, stop: 0.5, cheek: 0.2, earType: 2, earSize: 0.85, earRound: 0.45,
      furMain: '#2c2a32', furSub: '#3a3842', furAccent: '#2c2a32', patternColor: '#1c1a20', pattern: 2, patternAmt: 0.35, muzzleCover: 0.3, bellyW: 0.0,
      irisTop: '#1f6a8a', irisBot: '#8ae8f0', eyeTilt: 0.35, eyeAspect: 0.6, pupilType: 1, lidColor: '#0c0a0e', noseType: 1, noseColor: '#1a181c', whiskers: 2, whiskerColor: '#8a8690',
      tailType: 2, tailLen: 1.3, hairStyle: 3, cheekFluff: 0, chestFluff: 0, muscle: 0.75, fat: -0.4, shoulderW: 0.3, waist: -0.5,
    },
  },
  {
    name: 'ハスキー', sub: 'ハスキー', swatch: ['#5a6070', '#f4f5f7'], s: {
      muzLen: 0.25, muzW: 0.0, stop: 0.3, cheek: 0.3, earType: 0, earSize: 0.95, earRound: 0.2,
      furMain: '#5a6070', furSub: '#f4f5f7', furAccent: '#f4f5f7', cheekWhite: 1, muzzleCover: 0.8, bellyW: 0.9, sockArm: 0.8, sockLeg: 0.6, foreheadMark: 0.8, eyeMask: 0.0, backMark: 0,
      irisTop: '#2a6ab0', irisBot: '#bfe6ff', eyeTilt: 0.2, eyeAspect: 0.7, browType: 2, browColor: '#f4f5f7', hairStyle: 1, cheekFluff: 2, tailType: 0, tailCurl: 0.6, tailUp: 0.4, tailTipAmt: 0.2, tailTipColor: '#f4f5f7',
      chestFluff: 0.8, neckRuff: 0.6, muscle: 0.45,
    },
  },
  {
    name: 'ドーベルマン', sub: 'ドーベル', swatch: ['#1f1a1c', '#b5652e'], s: {
      muzLen: 0.6, muzW: -0.25, muzH: -0.1, muzTaper: 0.3, stop: 0.5, cheek: -0.3, earType: 1, earSize: 1.05, earH: 1.2, earW: 0.85, earRound: 0.05,
      furMain: '#1f1a1c', furSub: '#b5652e', furAccent: '#b5652e', bellyW: 0.25, muzzleCover: 0.45, sockArm: 0.82, sockLeg: 0.75, browType: 2, browColor: '#b5652e', browW: 0.7,
      irisTop: '#3a1e0c', irisBot: '#b06a2a', eyeTilt: 0.3, eyeAspect: 0.62, lidColor: '#080606', hairStyle: 0, cheekFluff: 0, chestFluff: 0, neckRuff: 0, elbowTuft: 0, wristTuft: 0, ankleTuft: 0,
      tailType: 2, tailLen: 0.6, tailFluff: 0.0, muscle: 0.75, fat: -0.5, waist: -0.4, furJag: 0.1,
    },
  },
  {
    name: 'ハイエナ', sub: 'ハイエナ', swatch: ['#b39a74', '#4a3a2c'], s: {
      muzLen: 0.15, muzW: 0.35, muzH: 0.3, muzTaper: -0.2, stop: 0.6, headW: 0.1, cheek: 0.3, jaw: 0.4, earType: 3, earSize: 1.0, earH: 1.15, earRound: 0.7,
      furMain: '#b39a74', furSub: '#d8c8a8', furAccent: '#3a2e24', patternColor: '#4a3a2c', pattern: 2, patternAmt: 0.6, patternScale: 1.2, muzzleCover: 0.0, bellyW: 0.3, sockLeg: 0.75, sockArm: 0.8,
      irisTop: '#4a2e10', irisBot: '#c8902a', eyeTilt: 0.1, hairStyle: 5, hairUseFur: false, hairColor: '#3a2e24', backMane: 0.9, tailType: 3, fang: 0.6, smile: 0.6, mouthCorner: 0.1,
      shoulderW: 0.5, muscle: 0.6, legLen: -0.3, armLen: 0.2,
    },
  },
];
