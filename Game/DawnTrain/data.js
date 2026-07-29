"use strict";

window.DT = window.DT || {};

(function (DT) {
  const crew = {
    kureha: {
      id: "kureha", name: "クレハ", short: "ク", role: "車掌", color: "#e9ad58",
      maxHp: 12, damage: 2, range: 1,
      passive: { id: "conductor", name: "車掌の眼", text: "選んだ敵の行動予告を詳しく確認できる" },
      skills: [
        { id: "order", name: "号令", text: "3マス以内の味方にAP+1", kind: "grantAp", power: 1, range: 3, ap: 1, steam: 1, cooldown: 3 },
        { id: "exchange", name: "配置転換", text: "味方と場所を交換し、双方に障壁1", kind: "swapAlly", power: 1, range: 4, ap: 1, steam: 0, cooldown: 2 }
      ]
    },
    gaku: {
      id: "gaku", name: "ガク", short: "ガ", role: "機関士", color: "#68b9b0",
      maxHp: 14, damage: 2, range: 1,
      passive: { id: "mechanic", name: "現場修理", text: "通常修理の回復量+1" },
      skills: [
        { id: "overrepair", name: "徹底修理", text: "今いる車両の耐久を6回復し、腐食を取り除く", kind: "repairCar", power: 6, range: 0, ap: 2, steam: 1, cooldown: 2 },
        { id: "stoke", name: "焚き増し", text: "蒸気+3", kind: "gainSteam", power: 3, range: 0, ap: 2, steam: 0, cooldown: 3 }
      ]
    },
    mina: {
      id: "mina", name: "ミナ", short: "ミ", role: "護衛", color: "#7896d8",
      maxHp: 16, damage: 3, range: 1,
      passive: { id: "guard", name: "前衛", text: "各戦闘で最初に受けるダメージ-2" },
      skills: [
        { id: "shove", name: "制圧打", text: "隣接敵へ3ダメージを与え1マス押す", kind: "damagePush", power: 3, range: 1, ap: 1, steam: 0, cooldown: 2 },
        { id: "fortify", name: "不退", text: "自身に障壁5。同じ車両の敵を引きつける", kind: "selfGuard", power: 5, range: 0, ap: 1, steam: 1, cooldown: 3 }
      ]
    },
    sui: {
      id: "sui", name: "スイ", short: "ス", role: "医師", color: "#7acb91",
      maxHp: 10, damage: 1, range: 2,
      passive: { id: "triage", name: "応急処置", text: "戦闘終了時、生存している出撃者のHPを1回復" },
      skills: [
        { id: "treat", name: "遠隔治療", text: "3マス以内の味方を5回復", kind: "healAlly", power: 5, range: 3, ap: 1, steam: 1, cooldown: 2 },
        { id: "revive", name: "蘇生処置", text: "戦闘不能の味方をHP4で復帰させる", kind: "reviveAlly", power: 4, range: 2, ap: 2, steam: 2, cooldown: 4 }
      ]
    },
    nagi: {
      id: "nagi", name: "ナギ", short: "ナ", role: "斥候", color: "#78cde6",
      maxHp: 10, damage: 2, range: 4,
      passive: { id: "scout", name: "先読み", text: "増援が1ラウンド早く表示される" },
      skills: [
        { id: "snipe", name: "狙撃", text: "5マス以内の敵へ5ダメージ", kind: "damage", power: 5, range: 5, ap: 2, steam: 0, cooldown: 2 },
        { id: "mark", name: "照準共有", text: "敵を2ラウンド標的にし、受けるダメージを+1", kind: "markEnemy", power: 2, range: 5, ap: 1, steam: 1, cooldown: 3 }
      ]
    },
    teto: {
      id: "teto", name: "テト", short: "テ", role: "夜聴き", color: "#b695de",
      maxHp: 11, damage: 2, range: 2,
      passive: { id: "nightSense", name: "夜の声", text: "夜蝕系敵から受けるダメージ-1" },
      skills: [
        { id: "delay", name: "信号遅延", text: "敵1体の今ラウンドの意図を中断", kind: "stunEnemy", power: 1, range: 4, ap: 1, steam: 2, cooldown: 3 },
        { id: "purge", name: "逆位相信号", text: "同じ車両にいる敵全員へ3ダメージ", kind: "areaDamage", power: 3, range: 0, ap: 2, steam: 1, cooldown: 2 }
      ]
    },
    rikka: {
      id: "rikka", name: "リッカ", short: "リ", role: "発破師", color: "#dc8c63",
      maxHp: 13, damage: 3, range: 1,
      passive: { id: "breacher", name: "破砕", text: "装甲を持つ敵へのダメージ+1" },
      skills: [
        { id: "blast", name: "指向爆破", text: "対象と隣接する敵へ3ダメージ", kind: "splashDamage", power: 3, range: 2, ap: 2, steam: 1, cooldown: 2 },
        { id: "mine", name: "設置爆薬", text: "空き区画に罠を置き、次に入った敵へ5ダメージ", kind: "placeMine", power: 5, range: 2, ap: 1, steam: 0, cooldown: 3 }
      ]
    },
    orun: {
      id: "orun", name: "オルン", short: "オ", role: "記録官", color: "#c1b3a4",
      maxHp: 10, damage: 2, range: 3,
      passive: { id: "archive", name: "戦況記録", text: "戦闘報酬の部品+1" },
      skills: [
        { id: "analyze", name: "構造解析", text: "敵へ2ダメージ、装甲と障壁を解除", kind: "analyzeEnemy", power: 2, range: 4, ap: 1, steam: 1, cooldown: 2 },
        { id: "refresh", name: "再指示", text: "味方の固有技の再使用待ちを2ラウンド短縮", kind: "refreshAlly", power: 2, range: 3, ap: 1, steam: 2, cooldown: 4 }
      ]
    }
  };

  const cars = {
    engine: {
      id: "engine", name: "黎明機関車", short: "機", color: "#d59a4b", maxHp: 24,
      operation: { name: "過給運転", text: "蒸気2を使って蒸気3を得る", kind: "gainSteam", cost: 2, power: 3 }
    },
    cannon: {
      id: "cannon", name: "砲台車", short: "砲", color: "#9e6664", maxHp: 18,
      operation: { name: "主砲", text: "任意の敵へ3ダメージ", kind: "damageEnemy", cost: 2, power: 3, range: 99 }
    },
    workshop: {
      id: "workshop", name: "工房車", short: "工", color: "#618b82", maxHp: 20,
      operation: { name: "緊急修理", text: "任意の車両を4修理", kind: "repairAnyCar", cost: 2, power: 4 }
    },
    medbay: {
      id: "medbay", name: "医務車", short: "医", color: "#6fa27e", maxHp: 17,
      operation: { name: "治療台", text: "同じ車両の味方を4回復", kind: "healSameCar", cost: 2, power: 4 }
    },
    shield: {
      id: "shield", name: "障壁車", short: "壁", color: "#667db0", maxHp: 19,
      operation: { name: "展開障壁", text: "任意の車両に障壁4", kind: "shieldCar", cost: 2, power: 4 }
    },
    observatory: {
      id: "observatory", name: "観測車", short: "観", color: "#5d8fa1", maxHp: 15,
      operation: { name: "照準補助", text: "敵を2ラウンド標的にする", kind: "markEnemy", cost: 1, power: 2, range: 99 }
    },
    passenger: {
      id: "passenger", name: "客車", short: "客", color: "#8d725e", maxHp: 21,
      operation: { name: "声援", text: "士気1を使い味方全員に障壁1", kind: "teamShield", cost: 0, morale: 1, power: 1 }
    },
    thermal: {
      id: "thermal", name: "蓄熱車", short: "蓄", color: "#a45f46", maxHp: 18,
      operation: { name: "放熱", text: "蓄熱を消費して蒸気を2得る", kind: "releaseHeat", cost: 0, power: 2 }
    }
  };

  const enemies = {
    raider: { id: "raider", name: "襲撃兵", short: "襲", color: "#b85a55", maxHp: 5, damage: 2, range: 1, ai: "crew" },
    gunner: { id: "gunner", name: "射手", short: "射", color: "#a86758", maxHp: 4, damage: 2, range: 3, ai: "crew" },
    saboteur: { id: "saboteur", name: "破壊工作員", short: "破", color: "#c77c46", maxHp: 6, damage: 3, range: 0, ai: "car" },
    leech: { id: "leech", name: "吸熱虫", short: "吸", color: "#875d9e", maxHp: 4, damage: 1, range: 1, ai: "steam", drain: 2 },
    armor: { id: "armor", name: "装甲兵", short: "装", color: "#6c747b", maxHp: 9, damage: 3, range: 1, ai: "crew", armor: 1 },
    parasite: { id: "parasite", name: "寄生核", short: "寄", color: "#798d53", maxHp: 7, damage: 2, range: 0, ai: "car", corrosion: 1 },
    signaler: { id: "signaler", name: "信号機兵", short: "信", color: "#8466a6", maxHp: 5, damage: 1, range: 3, ai: "support" },
    bomber: { id: "bomber", name: "爆薬兵", short: "爆", color: "#ba4d61", maxHp: 6, damage: 4, range: 2, ai: "bomb" },
    varga: { id: "varga", name: "略奪機関バルガ", short: "Ｖ", color: "#cf4e43", maxHp: 28, damage: 4, range: 3, ai: "bossVarga", boss: true, armor: 1 },
    nereis: { id: "nereis", name: "水門獣ネレイス", short: "Ｎ", color: "#438ea8", maxHp: 44, damage: 4, range: 3, ai: "boss", boss: true },
    ferroa: { id: "ferroa", name: "群体母樹フェロア", short: "Ｆ", color: "#6d8b52", maxHp: 52, damage: 4, range: 4, ai: "boss", boss: true },
    mole: { id: "mole", name: "穿孔王モール", short: "Ｍ", color: "#86705f", maxHp: 58, damage: 5, range: 2, ai: "boss", boss: true, armor: 1 },
    isberg: { id: "isberg", name: "氷殻巨獣イスベルグ", short: "Ｉ", color: "#70a5ba", maxHp: 64, damage: 5, range: 3, ai: "boss", boss: true, armor: 1 },
    alba: { id: "alba", name: "装甲列車アルバ", short: "Ａ", color: "#b2aa97", maxHp: 68, damage: 5, range: 5, ai: "boss", boss: true, armor: 2 },
    nox: { id: "nox", name: "夜蝕核ノクス", short: "Ｘ", color: "#694f87", maxHp: 84, damage: 6, range: 5, ai: "boss", boss: true, armor: 2 }
  };

  const events = {
    c1_intro: {
      id: "c1_intro", chapter: 1, scene: "yard", kicker: "FIRST NIGHT", title: "灰の始発駅",
      pages: [
        { speaker: "記録", text: "太陽が消えて十九年。西から迫る夜蝕を止めるため、最後の制御核「暁核」が黎明列車に積み込まれた。" },
        { speaker: "ガク", text: "暁核は積んだ。東端灯台まで七夜。止まれば、夜蝕に追いつかれる。" },
        { speaker: "クレハ", text: "全員乗ったね。黎明列車、予定どおり出発する。" }
      ]
    },
    c1_signal: {
      id: "c1_signal", chapter: 1, scene: "signal", kicker: "灰の信号所", title: "消えない信号",
      pages: [
        { speaker: "ミナ", text: "前方の信号だけが生きている。誰かがこちらを誘導しているみたいだ。" },
        { speaker: "ガク", text: "誘いでも罠でも線路は一本だ。砲台の角度だけ合わせておけ。" }
      ],
      choices: [
        { label: "信号所の生存者を捜す", detail: "医療品+1、士気+1。次戦の敵が1体増える", effects: { medkits: 1, morale: 1, flag: "c1_rescue", encounterFlag: "c1_extra_enemy" } },
        { label: "停車せず先を急ぐ", detail: "燃料+1。列車の損傷を避ける", effects: { fuel: 1, flag: "c1_hurried" } }
      ]
    },
    c1_outro: {
      id: "c1_outro", chapter: 1, scene: "dawn", kicker: "第一夜の終わり", title: "最初の境界",
      pages: [
        { speaker: "記録", text: "略奪機関の残骸を越え、列車は灰の境界を抜けた。西の駅は、ほどなく夜へ沈んだ。" },
        { speaker: "ガク", text: "一夜目でこの有様か。だが、列車は走っている。それでいい。" },
        { speaker: "クレハ", text: "次は運河都市。灯台まで、あと六夜。" }
      ]
    }
  };

  const encounters = {
    c1_safe: {
      id: "c1_safe", chapter: 1, name: "旧貨物線の影", objective: { type: "defeat", text: "襲撃者をすべて退ける" },
      intro: "廃貨物車の陰から、線路荒らしが飛び乗ってきた。",
      spawns: [
        { round: 1, type: "raider", side: "rear", lane: 0 },
        { round: 1, type: "raider", side: "rear", lane: 2 },
        { round: 3, type: "gunner", side: "rear", lane: 1 }
      ],
      reward: { scrap: 5, medkits: 1, morale: 0 }
    },
    c1_risky: {
      id: "c1_risky", chapter: 1, name: "崩落高架線", objective: { type: "defeat", text: "破壊工作員を排除する" },
      intro: "近道の高架は崩れかけている。敵は列車ではなく、連結器を狙っている。",
      spawns: [
        { round: 1, type: "saboteur", side: "rear", lane: 1 },
        { round: 2, type: "raider", side: "rear", lane: 0 },
        { round: 2, type: "raider", side: "front", lane: 2 },
        { round: 4, type: "saboteur", side: "rear", lane: 2 }
      ],
      hazard: { type: "roughTrack", every: 3, damage: 1, text: "崩落区間: 3ラウンドごとに全車両へ1損傷" },
      reward: { scrap: 9, medkits: 0, morale: 0 }
    },
    c1_switchyard: {
      id: "c1_switchyard", chapter: 1, name: "第三操車場", objective: { type: "survive", rounds: 6, text: "6ラウンド終了まで機関車を守る" },
      intro: "切替器が動くまで六ラウンド。四方の保線路から敵が集まる。",
      spawns: [
        { round: 1, type: "raider", side: "front", lane: 1 },
        { round: 2, type: "gunner", side: "rear", lane: 0 },
        { round: 3, type: "saboteur", side: "rear", lane: 2 },
        { round: 4, type: "raider", side: "front", lane: 0 },
        { round: 5, type: "gunner", side: "rear", lane: 2 }
      ],
      reward: { scrap: 7, medkits: 1, morale: 1 }
    },
    c1_elite: {
      id: "c1_elite", chapter: 1, name: "夜盗の検問", objective: { type: "defeat", text: "装甲兵を含む検問隊を突破する" },
      intro: "装甲を着込んだ夜盗が線路を塞ぐ。正面からの小さな攻撃は通りにくい。",
      spawns: [
        { round: 1, type: "armor", side: "rear", lane: 1 },
        { round: 1, type: "gunner", side: "rear", lane: 0 },
        { round: 2, type: "raider", side: "front", lane: 2 },
        { round: 4, type: "saboteur", side: "rear", lane: 2 }
      ],
      reward: { scrap: 10, medkits: 1, morale: 0 }
    },
    c1_boss: {
      id: "c1_boss", chapter: 1, name: "略奪機関バルガ", objective: { type: "boss", text: "略奪機関バルガを停止させる" },
      intro: "巨大な略奪機関が後部へ連結した。砲口が列車を順に狙っている。",
      spawns: [
        { round: 1, type: "varga", side: "rear", lane: 1 },
        { round: 2, type: "raider", side: "front", lane: 0 },
        { round: 4, type: "gunner", side: "rear", lane: 2 },
        { round: 6, type: "raider", side: "front", lane: 2 }
      ],
      reward: { scrap: 14, medkits: 2, morale: 1, unlockCar: "medbay" }
    }
  };

  const chapters = [
    {
      id: "chapter1", number: 1, name: "灰の始発駅", short: "始発", tint: "#d09353",
      summary: "暁核を積み、略奪者が支配する灰の操車場を抜ける。",
      steps: [
        { type: "event", id: "c1_intro" },
        {
          type: "route", id: "c1_route", title: "最初の分岐",
          text: "旧貨物線は遠回りだが安定している。崩落高架線は危険だが、放棄された資材庫を通る。",
          options: [
            { id: "safe", title: "旧貨物線", detail: "長いが足場は安定している。基本戦術を確認できる。", battle: "c1_safe", cost: { fuel: 2 }, reward: "部品5・医療品1", danger: "危険度 低" },
            { id: "risky", title: "崩落高架線", detail: "線路から車体へ損傷を受けるが、多くの部品を回収できる。", battle: "c1_risky", cost: { fuel: 1 }, reward: "部品9", danger: "危険度 高" }
          ]
        },
        { type: "event", id: "c1_signal" },
        { type: "battle", id: "c1_switchyard" },
        { type: "garage", title: "夜盗の検問に備える" },
        { type: "battle", id: "c1_elite" },
        { type: "boss", id: "c1_boss" },
        { type: "upgrade", options: ["reinforced", "boiler", "arsenal"] },
        { type: "event", id: "c1_outro" },
        { type: "chapterEnd" }
      ]
    },
    { id: "chapter2", number: 2, name: "沈みゆく運河都市", short: "運河", tint: "#4b9eb5", summary: "水門が壊れた都市で、救助と進路確保を両立する。", steps: [] },
    { id: "chapter3", number: 3, name: "鉄喰いの森", short: "樹海", tint: "#6f9a62", summary: "列車を蝕む金属樹海と、夜の声を聞く子ども。", steps: [] },
    { id: "chapter4", number: 4, name: "黒晶坑道", short: "坑道", tint: "#8c76aa", summary: "光を吸う坑道で、十九年前の記録を探す。", steps: [] },
    { id: "chapter5", number: 5, name: "白夜氷原", short: "氷原", tint: "#83b7c7", summary: "熱を分け合い、凍った難民線を越える。", steps: [] },
    { id: "chapter6", number: 6, name: "双子首都", short: "首都", tint: "#b6a97b", summary: "並走する白線列車と、夜明けの使い道を争う。", steps: [] },
    { id: "chapter7", number: 7, name: "東端灯台", short: "灯台", tint: "#d16e62", summary: "旅のすべてを背負い、夜蝕の中心へ向かう。", steps: [] }
  ];

  DT.DATA = {
    title: "黎明列車 ― 七夜の終着点",
    version: "2.1.0",
    saveVersion: 1,
    crew,
    cars,
    enemies,
    events,
    encounters,
    chapters,
    lanes: ["上部通路", "中央通路", "下部通路"]
  };
})(window.DT);
