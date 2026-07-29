"use strict";

(function (DT) {
  const D = DT.DATA;

  function makeEncounter(id, chapter, name, objective, intro, spawns, reward, hazard = null) {
    return { id, chapter, name, objective, intro, spawns, reward, ...(hazard ? { hazard } : {}) };
  }

  D.upgrades = {
    reinforced: { id: "reinforced", name: "強化外板", text: "全車両の最大耐久+3、耐久を3回復", kind: "carMaxHp", power: 3 },
    boiler: { id: "boiler", name: "高圧ボイラー", text: "最大蒸気+1、戦闘開始時の蒸気+1", kind: "steam", power: 1 },
    arsenal: { id: "arsenal", name: "徹甲弾支給", text: "乗員の通常攻撃ダメージ+1", kind: "crewDamage", power: 1 },
    fieldCare: { id: "fieldCare", name: "巡回診療", text: "戦闘終了時、生存した出撃者を追加で1回復", kind: "afterHeal", power: 1 },
    salvage: { id: "salvage", name: "回収班", text: "戦闘後に得られる部品+2", kind: "bonusScrap", power: 2 },
    barrier: { id: "barrier", name: "出発前防護", text: "戦闘開始時、全車両に障壁2", kind: "startBarrier", power: 2 },
    efficient: { id: "efficient", name: "節炭運転", text: "章開始時に燃料+2、砲台車の主砲消費-1", kind: "efficiency", power: 1 },
    resolve: { id: "resolve", name: "夜明けの誓い", text: "士気が5以上なら全乗員の最大HP+2", kind: "crewMaxHp", power: 2 }
  };

  Object.assign(D.events, {
    c2_intro: {
      id: "c2_intro", chapter: 2, scene: "canal", kicker: "SECOND NIGHT", title: "沈みゆく運河都市",
      pages: [
        { speaker: "記録", text: "運河都市リュネでは、壊れた水門より早く夜蝕が迫っていた。避難列車はすでに満員だった。" },
        { speaker: "スイ", text: "病院に動けない人が残っている。線路を開けるだけでは、ここへ来た意味がない。" },
        { speaker: "クレハ", text: "水門も救助も、両方間に合わせる。止まった分は、その先で取り戻す。" }
      ]
    },
    c2_dilemma: {
      id: "c2_dilemma", chapter: 2, scene: "hospital", kicker: "水位上昇まで二十分", title: "最後の搬送艇",
      pages: [
        { speaker: "ナギ", text: "搬送艇は一隻だけ。病院の患者を運べば、排水区の作業員は歩いて逃げることになる。" },
        { speaker: "スイ", text: "どちらにも時間がない。選んだ方を、必ず列車まで連れて帰ろう。" }
      ],
      choices: [
        { label: "病院へ搬送艇を回す", detail: "医療品+2、患者を救助。排水戦の浸水が早まる", effects: { medkits: 2, morale: 1, rescued: "canal_patients", flag: "c2_hospital_saved", encounterFlag: "c2_fast_flood" } },
        { label: "排水区の作業員を救う", detail: "部品+5、作業員を救助。次戦の浸水を遅らせる", effects: { scrap: 5, morale: 1, rescued: "canal_workers", flag: "c2_workers_saved" } }
      ]
    },
    c2_join: {
      id: "c2_join", chapter: 2, scene: "canal", kicker: "水門制御塔", title: "水路の案内人",
      pages: [
        { speaker: "ナギ", text: "水に沈んだ線路でも、東まで案内できる。斥候が要るなら、灯台まで連れていく。" },
        { speaker: "クレハ", text: "それなら一緒に来て。今からあなたも、黎明列車の乗員だ。" }
      ],
      choices: [
        { label: "ナギを斥候として迎える", detail: "ナギが加入。遠くの敵を狙え、増援も早く分かる", effects: { joinCrew: "nagi", morale: 1, flag: "nagi_joined" } }
      ]
    },
    c2_outro: {
      id: "c2_outro", chapter: 2, scene: "water", kicker: "第二夜の終わり", title: "水面の星",
      pages: [
        { speaker: "記録", text: "水門が閉じ、運河に灯る避難灯は夜蝕の中で小さな星になった。" },
        { speaker: "スイ", text: "全員ではない。でも、数で呼ぶのはやめよう。助けた人には一人ずつ名前がある。" },
        { speaker: "クレハ", text: "次は鉄喰いの森。列車の傷を直したら、また出発しよう。" }
      ]
    },
    c3_intro: {
      id: "c3_intro", chapter: 3, scene: "forest", kicker: "THIRD NIGHT", title: "鉄喰いの森",
      pages: [
        { speaker: "記録", text: "金属を根に変える樹木が、線路も廃列車も飲み込んでいた。森の奥から、古い信号音が聞こえる。" },
        { speaker: "ガク", text: "腐食は殴っても止まらん。付着した核を剥がし、車体を直しながら抜けるぞ。" }
      ]
    },
    c3_teto: {
      id: "c3_teto", chapter: 3, scene: "forest", kicker: "信号音の発生源", title: "夜の声を聞く子",
      pages: [
        { speaker: "テト", text: "森は列車を食べたいんじゃない。『返して』って言ってる。昔、ここから光を取った人に。" },
        { speaker: "ガク", text: "その信号を知っているのか。……塔の保守符号だ。" },
        { speaker: "テト", text: "近くにいれば、少しだけ黙らせられる。私も連れていって。" }
      ],
      choices: [
        { label: "テトを夜聴きとして迎える", detail: "テトが加入。敵の行動を止め、寄生核をまとめて攻撃できる", effects: { joinCrew: "teto", record: "forest_signal", morale: 1, flag: "teto_joined" } }
      ]
    },
    c3_choice: {
      id: "c3_choice", chapter: 3, scene: "forest", kicker: "旧制御苗床", title: "燃やすか、読むか",
      pages: [
        { speaker: "ナギ", text: "苗床ごと焼けば安全に通れる。でも、この信号記録も灰になる。" },
        { speaker: "テト", text: "記録を持ち出すなら、森を刺激しないで。少し遠回りになる。" }
      ],
      choices: [
        { label: "苗床を焼いて線路を開く", detail: "燃料+2、次戦の寄生敵が減る", effects: { fuel: 2, flag: "c3_burned" } },
        { label: "制御記録を回収する", detail: "制御記録1つ、士気+1。次戦に増援", effects: { record: "nursery_record", morale: 1, flag: "c3_recorded", encounterFlag: "c3_extra_parasite" } }
      ]
    },
    c3_outro: {
      id: "c3_outro", chapter: 3, scene: "forest", kicker: "第三夜の終わり", title: "森が返したもの",
      pages: [
        { speaker: "記録", text: "母樹が止まると、耳を刺していた森の信号は、かすかな寝息へ変わった。" },
        { speaker: "テト", text: "夜は空っぽじゃない。壊れた命令を、今もずっと繰り返してる。" },
        { speaker: "ガク", text: "なら命令を書き直せるかもしれん。黒晶坑道に、旧塔の記録庫がある。" }
      ]
    },
    c4_intro: {
      id: "c4_intro", chapter: 4, scene: "mine", kicker: "FOURTH NIGHT", title: "黒晶坑道",
      pages: [
        { speaker: "記録", text: "黒晶は光だけでなく通信も吸う。列車は前照灯の届かない坑道へ入った。" },
        { speaker: "ガク", text: "ここには事故当日の保守記録がある。俺が消したつもりの記録だ。" }
      ]
    },
    c4_rikka: {
      id: "c4_rikka", chapter: 4, scene: "mine", kicker: "閉鎖採掘区", title: "発破の合図",
      pages: [
        { speaker: "リッカ", text: "あの掘削音を止めたいんだろ。壁ごと吹き飛ばしていいなら、道を作れる。" },
        { speaker: "ミナ", text: "列車まで巻き込まない保証は？" },
        { speaker: "リッカ", text: "保証の代わりに、私も乗る。失敗したら一緒に埋まるだけだ。" }
      ],
      choices: [
        { label: "リッカに発破を任せる", detail: "リッカが加入。複数の敵を攻撃し、爆薬の罠も置ける", effects: { joinCrew: "rikka", morale: 1, flag: "rikka_joined" } }
      ]
    },
    c4_record: {
      id: "c4_record", chapter: 4, scene: "archive", kicker: "黎明塔保守記録 19-07", title: "切断命令",
      pages: [
        { speaker: "記録音声", text: "西部塔を制御網から切り離す。東部への夜蝕の拡大を阻止。承認者――保守主任ガク。" },
        { speaker: "ガク", text: "あの日、救える街を数字で選んだ。正しかったとは言わん。だが、選ばなければ全部消えていた。" }
      ],
      choices: [
        { label: "記録を列車へ持ち帰る", detail: "制御記録1つ。ガクの過去も含めて判断材料にする", effects: { record: "mine_record", morale: -1, flag: "c4_truth_kept" } },
        { label: "記録を坑道へ残す", detail: "士気+1。この記録は灯台で使えない", effects: { morale: 1, flag: "c4_truth_left" } }
      ]
    },
    c4_outro: {
      id: "c4_outro", chapter: 4, scene: "mine", kicker: "第四夜の終わり", title: "暗闇を抜けて",
      pages: [
        { speaker: "クレハ", text: "過去を消すために灯台へ行くんじゃない。同じ過ちを繰り返さないために行く。" },
        { speaker: "ガク", text: "……了解、車掌。白夜氷原まで機関を保たせる。" }
      ]
    },
    c5_intro: {
      id: "c5_intro", chapter: 5, scene: "ice", kicker: "FIFTH NIGHT", title: "白夜氷原",
      pages: [
        { speaker: "記録", text: "凍った線路の両側には、避難灯を囲む小さな集落が続いていた。暖房を止めれば、朝を待たずに人が死ぬ。" },
        { speaker: "スイ", text: "蒸気を戦闘だけに使わないで。客車へ熱を回す時間も必要よ。" }
      ]
    },
    c5_orun: {
      id: "c5_orun", chapter: 5, scene: "refuge", kicker: "第九避難灯", title: "記録を運ぶ者",
      pages: [
        { speaker: "オルン", text: "いつ、どの避難灯が消えるのか。記録は全部ここにあります。灯台で判断するなら、この数字を置いていかないでください。" },
        { speaker: "クレハ", text: "記録ごと乗って。数字の向こうにいる人たちのことも、私たちに教えて。" }
      ],
      choices: [
        { label: "オルンを記録官として迎える", detail: "オルンが加入。敵の防御を崩し、味方の技を早く再使用できる", effects: { joinCrew: "orun", record: "refuge_network", flag: "orun_joined" } }
      ]
    },
    c5_choice: {
      id: "c5_choice", chapter: 5, scene: "ice", kicker: "白線列車からの通信", title: "熱を分ける",
      pages: [
        { speaker: "イリヤ", text: "こちらの暖房車が損傷した。燃料を三つ渡せば、氷殻巨獣の弱点座標を共有する。" },
        { speaker: "ミナ", text: "元上官です。約束は守る。でも、こちらの燃料も多くない。" }
      ],
      choices: [
        { label: "白線へ燃料を渡す", detail: "燃料-3、士気+2。氷殻巨獣の装甲が弱くなる", effects: { fuel: -3, morale: 2, flag: "c5_helped_alba" }, requires: { resources: { fuel: 3 } } },
        { label: "黎明列車の燃料を残す", detail: "燃料+1。氷殻巨獣の装甲は強いまま", effects: { fuel: 1, flag: "c5_refused_alba" } }
      ]
    },
    c5_outro: {
      id: "c5_outro", chapter: 5, scene: "ice", kicker: "第五夜の終わり", title: "二本の列車",
      pages: [
        { speaker: "イリヤ", text: "灯台は避難灯の網を止める。朝が届くまでの数日、遠い集落から凍る。それでも点火するのか。" },
        { speaker: "クレハ", text: "答えは灯台で出す。だから、あなたも灯台まで来て。" },
        { speaker: "イリヤ", text: "なら首都で待つ。白線は暁核を諦めない。" }
      ]
    },
    c6_intro: {
      id: "c6_intro", chapter: 6, scene: "capital", kicker: "SIXTH NIGHT", title: "双子首都",
      pages: [
        { speaker: "記録", text: "首都を二分する高架線で、黎明列車と白線は並んだ。どちらも東端へ続く一本の軌道を譲らない。" },
        { speaker: "ミナ", text: "白線が撃つ直前には、狙われた場所に照準光が出ます。見えてからでも退避できます。" }
      ]
    },
    c6_ilya: {
      id: "c6_ilya", chapter: 6, scene: "capital", kicker: "中央連絡橋", title: "誰のための朝か",
      pages: [
        { speaker: "イリヤ", text: "暁核を七つに分ければ、避難灯は三十年もつ。その間に別の方法を探せる。世界全体を賭ける必要はない。" },
        { speaker: "テト", text: "夜の命令を書き直せたら、核を燃やさなくていい。記録があれば道を探せる。" }
      ],
      choices: [
        { label: "灯台で三つの方法を検討すると約束する", detail: "白線との対話を続け、最後の戦いで支援を得る", effects: { morale: 1, flag: "c6_promise" } },
        { label: "暁核を守り、点火を優先する", detail: "部品+6。最後の戦いで白線の支援を得られない", effects: { scrap: 6, flag: "c6_ignite_priority" } }
      ]
    },
    c6_outro: {
      id: "c6_outro", chapter: 6, scene: "capital", kicker: "第六夜の終わり", title: "同じ東へ",
      pages: [
        { speaker: "記録", text: "砲撃が止むと、二本の列車は壊れた連絡橋を一本ずつ渡った。勝者はなく、どちらも東を向いていた。" },
        { speaker: "イリヤ", text: "次に会うのは灯台だ。その時は、選んだ答えを聞かせてもらう。" }
      ]
    },
    c7_intro: {
      id: "c7_intro", chapter: 7, scene: "lighthouse", kicker: "FINAL NIGHT", title: "東端灯台",
      pages: [
        { speaker: "記録", text: "海と空の境が消え、夜蝕は巨大な渦となって灯台を包んでいた。七夜の終着点は、その中心にある。" },
        { speaker: "クレハ", text: "出会った人も、交わした約束も、全部ここまで連れてきた。全員、最後の戦いへ。" }
      ]
    },
    c7_truth: {
      id: "c7_truth", chapter: 7, scene: "lighthouse", kicker: "灯台制御室", title: "夜明けの設計図",
      pages: [
        { speaker: "オルン", text: "灯台の点火、暁核の分割、それに夜蝕の命令を書き換える編光。集めた記録から、実行できる方法を調べます。" },
        { speaker: "ガク", text: "どれを選んでも代償はある。今度は、俺ひとりで決めるつもりはない。" }
      ],
      choices: [
        { label: "全員で三つの方法を確かめる", detail: "制御記録と仲間に応じて、決戦後の選択肢が増える", effects: { morale: 1, flag: "c7_briefed" } }
      ]
    },
    c7_decision: {
      id: "c7_decision", chapter: 7, scene: "dawn", kicker: "暁核・最終命令", title: "夜明けを選ぶ",
      pages: [
        { speaker: "クレハ", text: "黎明列車、東端灯台に到着。ここから先へ運ぶのは暁核じゃない。私たちが選んだ未来だ。" }
      ],
      choices: [
        { label: "灯台を点火する", detail: "恒久的な朝を西へ広げる。避難灯は停止する", effects: { ending: "ignite", flag: "ending_ignite" } },
        { label: "暁核を七つの避難灯へ分ける", detail: "夜の中で人々を守り、次の解決を託す", effects: { ending: "divide", flag: "ending_divide" } },
        { label: "夜蝕の命令を編み直す", detail: "制御記録3つとテトまたはオルンが必要", effects: { ending: "weave", flag: "ending_weave" }, requires: { records: 3, anyCrew: ["teto", "orun"] } }
      ]
    }
  });

  Object.assign(D.encounters, {
    c2_embankment: makeEncounter("c2_embankment", 2, "北堤防線", { type: "defeat", text: "堤防線の敵を排除する" }, "水位は低いが、狭い堤防から射手が乗り込む。", [
      { round: 1, type: "raider", side: "rear", lane: 1 }, { round: 1, type: "gunner", side: "rear", lane: 0 },
      { round: 3, type: "gunner", side: "front", lane: 2 }, { round: 4, type: "saboteur", side: "rear", lane: 1 }
    ], { scrap: 7, medkits: 1, fuel: 1 }),
    c2_hospital: makeEncounter("c2_hospital", 2, "水没病院線", { type: "defeat", text: "搬送路を確保する" }, "浸水した病院回廊から敵と濁流が押し寄せる。", [
      { round: 1, type: "raider", side: "front", lane: 0 }, { round: 1, type: "raider", side: "rear", lane: 2 },
      { round: 2, type: "leech", side: "rear", lane: 1 }, { round: 4, type: "saboteur", side: "rear", lane: 0 },
      { round: 5, type: "gunner", side: "front", lane: 2 }
    ], { scrap: 10, medkits: 2, fuel: 0 }, { type: "flood", every: 2, damage: 2, text: "浸水: 偶数ラウンドに予告レーンへ2ダメージ" }),
    c2_sluice: makeEncounter("c2_sluice", 2, "中央排水門", { type: "survive", rounds: 7, text: "7ラウンド終了まで排水門を守る" }, "水門が閉じるまで、列車が制御塔の盾になる。", [
      { round: 1, type: "raider", side: "rear", lane: 0 }, { round: 2, type: "leech", side: "front", lane: 2 },
      { round: 3, type: "saboteur", side: "rear", lane: 1 }, { round: 4, type: "gunner", side: "front", lane: 0 },
      { round: 5, type: "raider", side: "rear", lane: 2 }, { round: 6, type: "saboteur", side: "front", lane: 1 }
    ], { scrap: 9, medkits: 1, fuel: 2, morale: 1 }, { type: "flood", every: 2, damage: 2, text: "浸水: 偶数ラウンドに予告レーンへ2ダメージ" }),
    c2_floodgate: makeEncounter("c2_floodgate", 2, "西水門の巣", { type: "defeat", text: "吸熱虫の巣を除去する" }, "水門を温める蒸気へ吸熱虫が群がっている。", [
      { round: 1, type: "leech", side: "rear", lane: 0 }, { round: 1, type: "leech", side: "rear", lane: 2 },
      { round: 2, type: "raider", side: "front", lane: 1 }, { round: 3, type: "signaler", side: "rear", lane: 1 },
      { round: 5, type: "leech", side: "front", lane: 0 }
    ], { scrap: 11, medkits: 1, fuel: 1 }),
    c2_boss: makeEncounter("c2_boss", 2, "水門獣ネレイス", { type: "boss", text: "ネレイスを排水路へ落とす" }, "水圧で膨れた夜蝕獣が、三本の水路から列車へ覆いかぶさる。", [
      { round: 1, type: "nereis", side: "rear", lane: 1 }, { round: 2, type: "leech", side: "front", lane: 0 },
      { round: 4, type: "raider", side: "rear", lane: 2 }, { round: 6, type: "leech", side: "front", lane: 1 },
      { round: 8, type: "saboteur", side: "rear", lane: 0 }
    ], { scrap: 16, medkits: 2, fuel: 2, morale: 1, unlockCar: "shield" }, { type: "flood", every: 2, damage: 3, text: "大浸水: 偶数ラウンドに予告レーンへ3ダメージ" }),

    c3_ridge: makeEncounter("c3_ridge", 3, "乾いた尾根線", { type: "defeat", text: "樹海の斥候群を退ける" }, "腐食の薄い尾根を、寄生核が追ってくる。", [
      { round: 1, type: "parasite", side: "rear", lane: 1 }, { round: 1, type: "raider", side: "front", lane: 0 },
      { round: 3, type: "gunner", side: "rear", lane: 2 }, { round: 4, type: "parasite", side: "rear", lane: 0 }
    ], { scrap: 8, medkits: 1, fuel: 1 }, { type: "corrosion", every: 3, damage: 2, text: "腐食: 3ラウンドごとに最も損傷した車両へ2損傷" }),
    c3_nursery: makeEncounter("c3_nursery", 3, "旧制御苗床", { type: "defeat", text: "苗床の寄生核を除去する" }, "制御記録の周囲で、金属根が車両へ伸びる。", [
      { round: 1, type: "parasite", side: "rear", lane: 0 }, { round: 1, type: "parasite", side: "rear", lane: 2 },
      { round: 2, type: "signaler", side: "front", lane: 1 }, { round: 4, type: "armor", side: "rear", lane: 1 },
      { round: 6, type: "parasite", side: "front", lane: 0 }
    ], { scrap: 13, medkits: 0, fuel: 1 }, { type: "corrosion", every: 2, damage: 2, text: "強腐食: 偶数ラウンドに最も損傷した車両へ2損傷" }),
    c3_rootway: makeEncounter("c3_rootway", 3, "根の回廊", { type: "survive", rounds: 7, text: "7ラウンド、切断作業を守る" }, "前後の根を切るまで、列車は森の中心で停止する。", [
      { round: 1, type: "parasite", side: "front", lane: 1 }, { round: 2, type: "raider", side: "rear", lane: 0 },
      { round: 3, type: "signaler", side: "rear", lane: 2 }, { round: 4, type: "parasite", side: "front", lane: 0 },
      { round: 5, type: "armor", side: "rear", lane: 1 }, { round: 6, type: "parasite", side: "front", lane: 2 }
    ], { scrap: 11, medkits: 1, fuel: 2 }, { type: "corrosion", every: 2, damage: 2, text: "腐食: 偶数ラウンドに車両損傷" }),
    c3_hunters: makeEncounter("c3_hunters", 3, "鉄葉の狩場", { type: "defeat", text: "信号機兵を優先排除する" }, "増幅信号が寄生核を硬化させている。", [
      { round: 1, type: "signaler", side: "rear", lane: 1 }, { round: 1, type: "parasite", side: "rear", lane: 0 },
      { round: 2, type: "armor", side: "front", lane: 2 }, { round: 4, type: "signaler", side: "rear", lane: 2 },
      { round: 5, type: "parasite", side: "front", lane: 0 }
    ], { scrap: 13, medkits: 1, fuel: 1 }, { type: "corrosion", every: 3, damage: 3, text: "腐食: 3ラウンドごとに3損傷" }),
    c3_boss: makeEncounter("c3_boss", 3, "群体母樹フェロア", { type: "boss", text: "フェロアの信号核を破壊する" }, "無数の廃車を幹にした母樹が、列車を新しい枝にしようとしている。", [
      { round: 1, type: "ferroa", side: "rear", lane: 1 }, { round: 2, type: "parasite", side: "front", lane: 0 },
      { round: 3, type: "parasite", side: "rear", lane: 2 }, { round: 5, type: "signaler", side: "front", lane: 1 },
      { round: 7, type: "parasite", side: "rear", lane: 0 }
    ], { scrap: 18, medkits: 2, fuel: 2, morale: 1, unlockCar: "passenger" }, { type: "corrosion", every: 2, damage: 3, text: "母樹の根: 偶数ラウンドに3損傷" }),

    c4_lamps: makeEncounter("c4_lamps", 4, "保守灯線", { type: "defeat", text: "保守灯を再点灯する" }, "古い保守灯の周りだけ、射線を確保できる。", [
      { round: 1, type: "armor", side: "rear", lane: 1 }, { round: 1, type: "gunner", side: "rear", lane: 0 },
      { round: 3, type: "bomber", side: "front", lane: 2 }, { round: 5, type: "gunner", side: "rear", lane: 2 }
    ], { scrap: 9, medkits: 1, fuel: 1 }, { type: "darkness", every: 3, damage: 0, text: "暗闇：3ラウンドごとに敵の攻撃先が一部隠れる" }),
    c4_archive_line: makeEncounter("c4_archive_line", 4, "記録庫支線", { type: "defeat", text: "記録庫への支線を確保する" }, "完全な暗闇で爆薬兵の導火線だけが見える。", [
      { round: 1, type: "bomber", side: "rear", lane: 1 }, { round: 1, type: "armor", side: "front", lane: 0 },
      { round: 2, type: "gunner", side: "rear", lane: 2 }, { round: 4, type: "bomber", side: "front", lane: 1 },
      { round: 6, type: "signaler", side: "rear", lane: 0 }
    ], { scrap: 14, medkits: 0, fuel: 1 }, { type: "darkness", every: 2, damage: 1, text: "落石：偶数ラウンドに予告された区画と車両へ1ダメージ" }),
    c4_crossing: makeEncounter("c4_crossing", 4, "盲目分岐", { type: "survive", rounds: 8, text: "8ラウンド終了まで転轍機を守る" }, "線路を切り替える間、前後の暗闇から足音が迫る。", [
      { round: 1, type: "raider", side: "front", lane: 0 }, { round: 2, type: "bomber", side: "rear", lane: 2 },
      { round: 3, type: "armor", side: "rear", lane: 1 }, { round: 4, type: "gunner", side: "front", lane: 2 },
      { round: 6, type: "bomber", side: "rear", lane: 0 }, { round: 7, type: "armor", side: "front", lane: 1 }
    ], { scrap: 12, medkits: 1, fuel: 2 }, { type: "darkness", every: 2, damage: 1, text: "落石: 偶数ラウンドに損傷" }),
    c4_drillguard: makeEncounter("c4_drillguard", 4, "掘削衛兵", { type: "defeat", text: "掘削衛兵を停止させる" }, "装甲兵が爆薬兵の照準を塞いで前進する。", [
      { round: 1, type: "armor", side: "rear", lane: 0 }, { round: 1, type: "armor", side: "rear", lane: 2 },
      { round: 2, type: "bomber", side: "rear", lane: 1 }, { round: 4, type: "signaler", side: "front", lane: 1 },
      { round: 6, type: "gunner", side: "front", lane: 0 }
    ], { scrap: 15, medkits: 1, fuel: 1 }, { type: "darkness", every: 3, damage: 2, text: "天井崩落: 3ラウンドごとに2損傷" }),
    c4_boss: makeEncounter("c4_boss", 4, "穿孔王モール", { type: "boss", text: "モールの掘削装甲を破る" }, "黒晶を鎧にした掘削機が、列車ごと坑道を埋めようとする。", [
      { round: 1, type: "mole", side: "rear", lane: 1 }, { round: 2, type: "bomber", side: "front", lane: 0 },
      { round: 4, type: "armor", side: "rear", lane: 2 }, { round: 6, type: "bomber", side: "front", lane: 1 },
      { round: 8, type: "signaler", side: "rear", lane: 0 }
    ], { scrap: 20, medkits: 2, fuel: 2, morale: 1, unlockCar: "observatory" }, { type: "darkness", every: 2, damage: 2, text: "穿孔振動: 偶数ラウンドに2損傷" }),

    c5_refuge_line: makeEncounter("c5_refuge_line", 5, "避難灯線", { type: "defeat", text: "避難灯へ続く線路を守る" }, "暖房管へ吸熱虫が集まり、客車の温度が下がる。", [
      { round: 1, type: "leech", side: "rear", lane: 0 }, { round: 1, type: "leech", side: "rear", lane: 2 },
      { round: 3, type: "armor", side: "front", lane: 1 }, { round: 5, type: "signaler", side: "rear", lane: 1 }
    ], { scrap: 10, medkits: 2, fuel: 1 }, { type: "freeze", every: 1, damage: 0, text: "凍結: ラウンド開始時の蒸気-1" }),
    c5_glacier: makeEncounter("c5_glacier", 5, "氷河短絡線", { type: "defeat", text: "氷河が崩れる前に敵を排除" }, "近道は薄い氷の上だ。砲撃のたび線路が軋む。", [
      { round: 1, type: "armor", side: "rear", lane: 1 }, { round: 1, type: "bomber", side: "front", lane: 0 },
      { round: 2, type: "leech", side: "rear", lane: 2 }, { round: 4, type: "armor", side: "front", lane: 2 },
      { round: 6, type: "bomber", side: "rear", lane: 0 }
    ], { scrap: 16, medkits: 0, fuel: 2 }, { type: "freezeCrack", every: 3, damage: 3, text: "氷割れ: 3ラウンドごとに全車両へ3損傷" }),
    c5_heatline: makeEncounter("c5_heatline", 5, "暖房管制所", { type: "survive", rounds: 8, text: "8ラウンド終了まで熱供給を維持" }, "蒸気を奪う敵を退けながら、避難灯へ熱を送り続ける。", [
      { round: 1, type: "leech", side: "front", lane: 1 }, { round: 2, type: "leech", side: "rear", lane: 0 },
      { round: 3, type: "signaler", side: "rear", lane: 2 }, { round: 4, type: "armor", side: "front", lane: 0 },
      { round: 6, type: "leech", side: "rear", lane: 1 }, { round: 7, type: "bomber", side: "front", lane: 2 }
    ], { scrap: 13, medkits: 2, fuel: 2, morale: 1 }, { type: "freeze", every: 1, damage: 0, text: "熱供給: 最大蒸気が一時的に-1" }),
    c5_whitepack: makeEncounter("c5_whitepack", 5, "白霜の群れ", { type: "defeat", text: "氷殻兵の群れを突破する" }, "装甲に霜を重ねた敵が、吸熱虫を盾に進む。", [
      { round: 1, type: "armor", side: "rear", lane: 0 }, { round: 1, type: "armor", side: "rear", lane: 2 },
      { round: 2, type: "leech", side: "rear", lane: 1 }, { round: 4, type: "signaler", side: "front", lane: 1 },
      { round: 6, type: "bomber", side: "front", lane: 0 }
    ], { scrap: 17, medkits: 1, fuel: 1 }, { type: "freeze", every: 1, damage: 0, text: "凍結: ラウンド開始時の蒸気-1" }),
    c5_boss: makeEncounter("c5_boss", 5, "氷殻巨獣イスベルグ", { type: "boss", text: "イスベルグの氷殻を砕く" }, "線路の下から巨獣が現れ、熱源である機関車を狙う。", [
      { round: 1, type: "isberg", side: "rear", lane: 1 }, { round: 2, type: "leech", side: "front", lane: 0 },
      { round: 4, type: "armor", side: "rear", lane: 2 }, { round: 6, type: "leech", side: "front", lane: 1 },
      { round: 8, type: "bomber", side: "rear", lane: 0 }
    ], { scrap: 22, medkits: 2, fuel: 3, morale: 1, unlockCar: "thermal" }, { type: "freezeCrack", every: 3, damage: 3, text: "氷震: 3ラウンドごとに全車両へ3損傷" }),

    c6_lower: makeEncounter("c6_lower", 6, "下層環状線", { type: "defeat", text: "砲撃観測員を排除する" }, "建物の影は多いが、信号機兵が白線の砲撃を導く。", [
      { round: 1, type: "signaler", side: "rear", lane: 1 }, { round: 1, type: "armor", side: "front", lane: 0 },
      { round: 3, type: "gunner", side: "rear", lane: 2 }, { round: 5, type: "bomber", side: "front", lane: 1 }
    ], { scrap: 12, medkits: 1, fuel: 1 }, { type: "bombard", every: 3, damage: 3, text: "並走砲撃: 3ラウンドごとに予告車両へ3損傷" }),
    c6_upper: makeEncounter("c6_upper", 6, "上層直通線", { type: "defeat", text: "直通線の装甲隊を突破する" }, "遮蔽物のない高架で、白線の砲口がこちらを追う。", [
      { round: 1, type: "armor", side: "rear", lane: 0 }, { round: 1, type: "armor", side: "rear", lane: 2 },
      { round: 2, type: "signaler", side: "front", lane: 1 }, { round: 4, type: "bomber", side: "rear", lane: 1 },
      { round: 6, type: "gunner", side: "front", lane: 0 }
    ], { scrap: 18, medkits: 0, fuel: 2 }, { type: "bombard", every: 2, damage: 3, text: "集中砲撃: 偶数ラウンドに予告車両へ3損傷" }),
    c6_bridge: makeEncounter("c6_bridge", 6, "中央連絡橋", { type: "survive", rounds: 8, text: "8ラウンド、連絡橋を渡り切る" }, "白線と夜蝕、二方向からの攻撃を受けながら橋を進む。", [
      { round: 1, type: "armor", side: "front", lane: 1 }, { round: 2, type: "signaler", side: "rear", lane: 0 },
      { round: 3, type: "bomber", side: "rear", lane: 2 }, { round: 5, type: "armor", side: "front", lane: 0 },
      { round: 6, type: "gunner", side: "rear", lane: 1 }, { round: 7, type: "bomber", side: "front", lane: 2 }
    ], { scrap: 15, medkits: 1, fuel: 2 }, { type: "bombard", every: 2, damage: 3, text: "並走砲撃: 偶数ラウンドに3損傷" }),
    c6_honor: makeEncounter("c6_honor", 6, "白線先遣隊", { type: "defeat", text: "先遣隊の指揮系統を止める" }, "二体の信号機兵が装甲隊の意図を同期している。", [
      { round: 1, type: "signaler", side: "rear", lane: 0 }, { round: 1, type: "signaler", side: "rear", lane: 2 },
      { round: 2, type: "armor", side: "rear", lane: 1 }, { round: 4, type: "bomber", side: "front", lane: 0 },
      { round: 5, type: "armor", side: "front", lane: 2 }, { round: 7, type: "gunner", side: "rear", lane: 1 }
    ], { scrap: 19, medkits: 1, fuel: 1 }, { type: "bombard", every: 3, damage: 4, text: "精密砲撃: 3ラウンドごとに4損傷" }),
    c6_boss: makeEncounter("c6_boss", 6, "装甲列車アルバ", { type: "boss", text: "アルバの主動力を停止させる" }, "白い装甲列車が真横へ並ぶ。車両砲と乗り込み隊が同時に動く。", [
      { round: 1, type: "alba", side: "rear", lane: 1 }, { round: 2, type: "signaler", side: "front", lane: 0 },
      { round: 4, type: "armor", side: "rear", lane: 2 }, { round: 6, type: "bomber", side: "front", lane: 1 },
      { round: 8, type: "signaler", side: "rear", lane: 0 }, { round: 10, type: "armor", side: "front", lane: 2 }
    ], { scrap: 24, medkits: 2, fuel: 3, morale: 1 }, { type: "bombard", every: 2, damage: 4, text: "アルバ主砲: 偶数ラウンドに4損傷" }),

    c7_shore: makeEncounter("c7_shore", 7, "東岸保守線", { type: "defeat", text: "灯台保守線を再接続する" }, "過去の敵影を写した夜蝕が、線路の記憶から現れる。", [
      { round: 1, type: "parasite", side: "rear", lane: 0 }, { round: 1, type: "leech", side: "rear", lane: 2 },
      { round: 2, type: "armor", side: "front", lane: 1 }, { round: 4, type: "bomber", side: "rear", lane: 1 },
      { round: 6, type: "signaler", side: "front", lane: 0 }
    ], { scrap: 14, medkits: 2, fuel: 1 }, { type: "night", every: 3, damage: 3, text: "夜蝕：3ラウンドごとに環境効果が切り替わる" }),
    c7_control: makeEncounter("c7_control", 7, "海底制御線", { type: "defeat", text: "第三制御記録を回収する" }, "海面下の制御室で、夜蝕が記録そのものを守る。", [
      { round: 1, type: "signaler", side: "rear", lane: 1 }, { round: 1, type: "bomber", side: "front", lane: 0 },
      { round: 2, type: "parasite", side: "rear", lane: 2 }, { round: 4, type: "armor", side: "front", lane: 1 },
      { round: 6, type: "leech", side: "rear", lane: 0 }, { round: 7, type: "bomber", side: "front", lane: 2 }
    ], { scrap: 20, medkits: 1, fuel: 1, record: "lighthouse_record" }, { type: "night", every: 2, damage: 3, text: "濃い夜蝕：偶数ラウンドに環境攻撃" }),
    c7_stair: makeEncounter("c7_stair", 7, "灯台螺旋線", { type: "survive", rounds: 9, text: "9ラウンドで灯台上層へ到達" }, "過去六夜の環境が夜蝕の中で順に再現される。", [
      { round: 1, type: "armor", side: "front", lane: 1 }, { round: 2, type: "parasite", side: "rear", lane: 0 },
      { round: 3, type: "leech", side: "rear", lane: 2 }, { round: 4, type: "bomber", side: "front", lane: 0 },
      { round: 6, type: "signaler", side: "rear", lane: 1 }, { round: 7, type: "armor", side: "front", lane: 2 },
      { round: 8, type: "bomber", side: "rear", lane: 0 }
    ], { scrap: 17, medkits: 2, fuel: 2 }, { type: "night", every: 2, damage: 3, text: "夜蝕再現：偶数ラウンドに複数の環境攻撃" }),
    c7_guard: makeEncounter("c7_guard", 7, "暁核防衛戦", { type: "defeat", text: "暁核へ達する敵を全排除" }, "灯台の目前で全ての敵信号が暁核へ集中する。", [
      { round: 1, type: "signaler", side: "rear", lane: 0 }, { round: 1, type: "signaler", side: "rear", lane: 2 },
      { round: 2, type: "armor", side: "front", lane: 1 }, { round: 3, type: "leech", side: "rear", lane: 1 },
      { round: 5, type: "bomber", side: "front", lane: 0 }, { round: 6, type: "parasite", side: "rear", lane: 2 },
      { round: 8, type: "armor", side: "front", lane: 1 }
    ], { scrap: 21, medkits: 2, fuel: 1 }, { type: "night", every: 2, damage: 4, text: "夜蝕集中: 偶数ラウンドに4損傷" }),
    c7_boss: makeEncounter("c7_boss", 7, "夜蝕核ノクス", { type: "boss", text: "ノクスを停止し最終命令を送る" }, "灯台を覆う夜が一つの核へ収束する。七夜すべての判断を使う最後の戦い。", [
      { round: 1, type: "nox", side: "rear", lane: 1 }, { round: 2, type: "parasite", side: "front", lane: 0 },
      { round: 3, type: "leech", side: "rear", lane: 2 }, { round: 5, type: "signaler", side: "front", lane: 1 },
      { round: 7, type: "bomber", side: "rear", lane: 0 }, { round: 9, type: "armor", side: "front", lane: 2 },
      { round: 11, type: "signaler", side: "rear", lane: 1 }
    ], { scrap: 0, medkits: 0, fuel: 0, morale: 1 }, { type: "night", every: 2, damage: 4, text: "終末夜蝕：偶数ラウンドに複数の環境攻撃" })
  });

  D.chapters[1].steps = [
    { type: "event", id: "c2_intro" },
    { type: "route", id: "c2_route", title: "水上の二路線", text: "北堤防線は安全だが遠い。水没病院線には救助物資が残る。", options: [
      { id: "embankment", title: "北堤防線", detail: "安定した堤防を遠回りする。", battle: "c2_embankment", cost: { fuel: 2 }, reward: "部品7・医療品1・燃料1", danger: "危険度 中" },
      { id: "hospital", title: "水没病院線", detail: "浸水が進む病院へ入り、物資と患者を探す。", battle: "c2_hospital", cost: { fuel: 1 }, reward: "部品10・医療品2", danger: "危険度 高" }
    ] },
    { type: "event", id: "c2_dilemma" }, { type: "battle", id: "c2_sluice" }, { type: "event", id: "c2_join" },
    { type: "garage", title: "水門獣に備える" }, { type: "battle", id: "c2_floodgate" }, { type: "boss", id: "c2_boss" },
    { type: "upgrade", options: ["reinforced", "fieldCare", "boiler"] }, { type: "event", id: "c2_outro" }, { type: "chapterEnd" }
  ];
  D.chapters[2].steps = [
    { type: "event", id: "c3_intro" },
    { type: "route", id: "c3_route", title: "樹海の二路線", text: "乾いた尾根は遠い。苗床には制御記録が残る。", options: [
      { id: "ridge", title: "乾いた尾根線", detail: "腐食の薄い外縁を進む。", battle: "c3_ridge", cost: { fuel: 2 }, reward: "部品8・医療品1・燃料1", danger: "危険度 中" },
      { id: "nursery", title: "旧制御苗床", detail: "強い腐食を受けるが、記録庫へ近い。", battle: "c3_nursery", cost: { fuel: 1 }, reward: "部品13・燃料1", danger: "危険度 高" }
    ] },
    { type: "event", id: "c3_teto" }, { type: "event", id: "c3_choice" }, { type: "battle", id: "c3_rootway" },
    { type: "garage", title: "母樹の信号へ備える" }, { type: "battle", id: "c3_hunters" }, { type: "boss", id: "c3_boss" },
    { type: "upgrade", options: ["arsenal", "salvage", "barrier"] }, { type: "event", id: "c3_outro" }, { type: "chapterEnd" }
  ];
  D.chapters[3].steps = [
    { type: "event", id: "c4_intro" },
    { type: "route", id: "c4_route", title: "闇の二路線", text: "保守灯線は遠回り。記録庫支線には事故記録が残る。", options: [
      { id: "lamps", title: "保守灯線", detail: "残った照明を頼りに進む。", battle: "c4_lamps", cost: { fuel: 2 }, reward: "部品9・医療品1・燃料1", danger: "危険度 中" },
      { id: "archive", title: "記録庫支線", detail: "完全な暗闇を抜け、旧塔記録庫へ向かう。", battle: "c4_archive_line", cost: { fuel: 1 }, reward: "部品14・燃料1", danger: "危険度 高" }
    ] },
    { type: "event", id: "c4_rikka" }, { type: "battle", id: "c4_crossing" }, { type: "event", id: "c4_record" },
    { type: "garage", title: "掘削王に備える" }, { type: "battle", id: "c4_drillguard" }, { type: "boss", id: "c4_boss" },
    { type: "upgrade", options: ["boiler", "efficient", "reinforced"] }, { type: "event", id: "c4_outro" }, { type: "chapterEnd" }
  ];
  D.chapters[4].steps = [
    { type: "event", id: "c5_intro" },
    { type: "route", id: "c5_route", title: "氷原の二路線", text: "避難灯線は救助に寄れる。氷河短絡線は危険だが速い。", options: [
      { id: "refuge", title: "避難灯線", detail: "集落を結ぶ線路で熱と人を運ぶ。", battle: "c5_refuge_line", cost: { fuel: 2 }, reward: "部品10・医療品2・燃料1", danger: "危険度 中" },
      { id: "glacier", title: "氷河短絡線", detail: "崩落前の氷河を一気に渡る。", battle: "c5_glacier", cost: { fuel: 1 }, reward: "部品16・燃料2", danger: "危険度 高" }
    ] },
    { type: "event", id: "c5_orun" }, { type: "battle", id: "c5_heatline" }, { type: "event", id: "c5_choice" },
    { type: "garage", title: "氷殻巨獣に備える" }, { type: "battle", id: "c5_whitepack" }, { type: "boss", id: "c5_boss" },
    { type: "upgrade", options: ["fieldCare", "resolve", "barrier"] }, { type: "event", id: "c5_outro" }, { type: "chapterEnd" }
  ];
  D.chapters[5].steps = [
    { type: "event", id: "c6_intro" },
    { type: "route", id: "c6_route", title: "首都の上下線", text: "下層線は遮蔽物が多い。上層線は短いが砲撃に晒される。", options: [
      { id: "lower", title: "下層環状線", detail: "建物の影を縫って遠回りする。", battle: "c6_lower", cost: { fuel: 2 }, reward: "部品12・医療品1・燃料1", danger: "危険度 中" },
      { id: "upper", title: "上層直通線", detail: "白線の砲火の中を正面突破する。", battle: "c6_upper", cost: { fuel: 1 }, reward: "部品18・燃料2", danger: "危険度 高" }
    ] },
    { type: "event", id: "c6_ilya" }, { type: "battle", id: "c6_bridge" }, { type: "garage", title: "白線との決戦に備える" },
    { type: "battle", id: "c6_honor" }, { type: "boss", id: "c6_boss" },
    { type: "upgrade", options: ["arsenal", "efficient", "resolve"] }, { type: "event", id: "c6_outro" }, { type: "chapterEnd" }
  ];
  D.chapters[6].steps = [
    { type: "event", id: "c7_intro" },
    { type: "route", id: "c7_route", title: "灯台への最終分岐", text: "東岸保守線は列車を守れる。海底制御線には最後の記録がある。", options: [
      { id: "shore", title: "東岸保守線", detail: "地上の保守設備を再接続しながら進む。", battle: "c7_shore", cost: { fuel: 2 }, reward: "部品14・医療品2・燃料1", danger: "危険度 高" },
      { id: "control", title: "海底制御線", detail: "濃い夜蝕を抜け、第三制御記録を回収する。", battle: "c7_control", cost: { fuel: 1 }, reward: "部品20・制御記録", danger: "危険度 極高" }
    ] },
    { type: "event", id: "c7_truth" }, { type: "battle", id: "c7_stair" }, { type: "garage", title: "最後の戦いに備える" },
    { type: "battle", id: "c7_guard" }, { type: "boss", id: "c7_boss" }, { type: "event", id: "c7_decision" }, { type: "epilogue" }
  ];

  // 資源は前進の判断材料にする。安全路線は収支均衡、危険路線は燃料を増やせる。
  const riskyRoutes = new Set(["c2_hospital", "c3_nursery", "c4_archive_line", "c5_glacier", "c6_upper", "c7_control"]);
  for (const encounter of Object.values(D.encounters).filter(item => item.chapter >= 2)) {
    if (encounter.reward.scrap) encounter.reward.scrap = Math.ceil(encounter.reward.scrap * 0.75);
    if (encounter.reward.medkits) encounter.reward.medkits = 1;
    encounter.reward.fuel = 0;
    if (encounter.objective.type === "survive" || encounter.objective.type === "boss" || riskyRoutes.has(encounter.id)) encounter.reward.fuel = 1;
  }
  D.encounters.c7_boss.reward.fuel = 0;

  D.version = "2.1.1";
})(window.DT);
