(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  const item=(name,sprite,description,extra={})=>({name,sprite,description,stack:99,...extra});
  const items={
    branch:item("枝","branch","道具や焚き火の基本素材。"),wood:item("木材","wood","建築と加工に使う丈夫な木。"),stone:item("石","stone","道具、床、炉の材料。"),
    fiber:item("繊維","fiber","縄や布へ加工できる草の繊維。"),berry:item("陽ベリー","berry","そのまま食べられる甘い実。",{food:10,water:4}),seed:item("サンルートの種","seed","畑へ植えると3朝で育つ。"),
    resin:item("樹脂","resin","灯りと上位道具に使う樹液。"),shell:item("貝殻","shell","浜辺で拾える装飾素材。"),fish:item("青すじ魚","fish","焚き火で焼ける魚。",{fish:true}),
    fish_sun:item("ひだまり鯛","fish_sun","昼の浅瀬にいる暖色の魚。",{fish:true}),fish_moon:item("月しずく魚","fish_moon","夕夜の潮だまりに現れる魚。",{fish:true}),
    fish_rain:item("雨つぶ魚","fish_rain","小雨の日によく釣れる魚。",{fish:true}),fish_rock:item("いわひれ","fish_rock","岩丘の岸に棲む重い魚。",{fish:true}),fish_glow:item("きらめき魚","fish_glow","ごく稀に光る島の魚。",{fish:true}),
    fish_leaf:item("このは魚","fish_leaf","森沿いの水辺へ流れ着く緑の魚。",{fish:true}),fish_coral:item("さんごヒメ","fish_coral","暖かな浜で泳ぐ珊瑚色の魚。",{fish:true}),
    fish_star:item("ほしはね魚","fish_star","晴れた夜だけ水面を跳ねる魚。",{fish:true}),fish_prism:item("プリズム魚","fish_prism","完成した灯台の光へ集う幻の魚。",{fish:true}),
    cooked_fish:item("焼き魚","cooked_fish","香ばしい。体力も少し戻る。",{food:36,heal:10}),cooked_berry:item("焼きベリー","cooked_berry","温めて甘みが増した。",{food:18}),
    water:item("淡水","water","潤いを大きく回復する。",{water:40}),ore:item("銅鉱","ore","炉で銅塊へ精錬できる。"),copper_bar:item("銅塊","copper_bar","上位道具と灯台部品の素材。"),
    crystal:item("光晶","crystal","岩丘に眠る明るい結晶。"),light_shard:item("光のかけら","light_shard","灯台が生み出す特別な素材。"),sunroot:item("サンルート","sunroot","煮込むと元気が出る根菜。",{food:14}),
    soup:item("サンルートスープ","soup","満腹と潤いを満たし、元気が続く。",{food:55,water:20,staminaBuff:120}),glow_skewer:item("きらめき串","glow_skewer","体力を戻し、しばらく周囲を照らす。",{food:42,heal:25,glow:120}),
    rope:item("丈夫なロープ","rope","上位設備に使う編み縄。"),herb:item("潮風ハーブ","herb","浜辺に香る料理素材。"),
    slime_gel:item("芽しずく","resin","芽スライムが残す、ひんやりした薬の素材。"),thorn_seed:item("トゲ種","seed","トゲウリの硬い種。料理と護りの素材になる。"),
    crab_meat:item("泡ガニの身","fish","浜の生き物から分けてもらった滋味のある食材。",{food:8}),moss_shell:item("苔甲羅","shell","苔甲虫の丈夫で軽い抜け殻。"),
    wisp_essence:item("潮明かり","crystal","浜辺の光精が残す淡い灯り。"),crystal_dust:item("光晶の粉","crystal","晶羽蛾の羽からこぼれる青紫の粉。"),
    herbal_wrap:item("島草の包帯","fiber","傷口に当てると体力が戻る。",{heal:18}),crab_soup:item("泡ガニのスープ","soup","潮の香りの温かなスープ。体力も戻る。",{food:44,water:14,heal:18}),
    sun_tonic:item("陽だまり薬","water","芽しずくとハーブを煮た回復薬。",{heal:32,staminaBuff:90}),thorn_skewer:item("トゲ実串","glow_skewer","香ばしい実と種の串焼き。",{food:28,heal:12}),
    moonbean_seed:item("月豆の種","moonbean_seed","畑で月豆を育てる。",{seedCrop:"moonbean"}),moonbean:item("月豆","moonbean","夜色の栄養豊かな豆。",{food:16}),
    tide_seed:item("潮メロンの種","tide_seed","畑で潮メロンを育てる。",{seedCrop:"tide_melon"}),tide_melon:item("潮メロン","tide_melon","水分をたっぷり含む果実。",{food:12,water:24}),
    field_ration:item("探検サンド","field_ration","遠出向けの腹持ちする食事。",{food:46,heal:8}),moon_tea:item("月豆茶","moon_tea","潤いと集中力を取り戻す。",{food:18,water:38,staminaBuff:180}),
    tide_salad:item("潮風サラダ","tide_salad","瑞々しい島野菜の一皿。",{food:34,water:34}),prism_stew:item("三光シチュー","prism_stew","島の実りを煮込んだごちそう。",{food:80,water:45,heal:40,staminaBuff:300,glow:180}),
    prism_forest:item("森のプリズム","prism_forest","育つ光を宿す。",{key:true}),prism_tide:item("潮のプリズム","prism_tide","満ちる光を宿す。",{key:true}),prism_rock:item("岩のプリズム","prism_rock","眠る光を宿す。",{key:true}),
    axe:item("石斧","axe","木を切れる。壊れない。",{tool:"axe",power:1,unique:true}),copper_axe:item("銅斧","axe","広い範囲を素早く伐採する。",{tool:"axe",power:2,unique:true}),
    pickaxe:item("石つるはし","pickaxe","岩と鉱床を掘れる。",{tool:"pickaxe",power:1,unique:true}),copper_pickaxe:item("銅つるはし","pickaxe","鉱石を素早く掘れる。",{tool:"pickaxe",power:2,unique:true}),
    spear:item("木槍","spear","島の生き物を鎮める武器。",{tool:"weapon",power:1,unique:true}),light_spear:item("光槍","spear","光晶を穂先にした強い槍。",{tool:"weapon",power:2,unique:true}),
    rod:item("釣り竿","rod","水辺で魚を釣れる。",{tool:"rod",power:1,unique:true}),watering_can:item("じょうろ","watering_can","井戸で満たし畑へ水をまく。",{tool:"water",power:1,unique:true}),
    copper_watering_can:item("銅じょうろ","watering_can","周囲の畑にも水をまける。",{tool:"water",power:2,unique:true}),hammer:item("木槌","hammer","建築の配置・移動・解体に使う。",{tool:"hammer",power:1,unique:true}),
    sun_axe:item("陽光の斧","sun_axe","木立を一振りで整える最高級の斧。",{tool:"axe",power:4,unique:true,masterwork:true}),
    sun_pickaxe:item("陽光のつるはし","sun_pickaxe","鉱床を一振りで砕く最高級の道具。",{tool:"pickaxe",power:4,unique:true,masterwork:true}),
    sun_spear:item("陽光の槍","sun_spear","穏やかな光を放つ最高級の槍。",{tool:"weapon",power:4,unique:true,masterwork:true}),
    sun_rod:item("星結びの竿","sun_rod","珍しい魚を呼ぶ最高級の釣り竿。",{tool:"rod",power:3,unique:true,masterwork:true}),
    sun_watering_can:item("虹雲じょうろ","sun_watering_can","広い畑へ一度に散水する。",{tool:"water",power:4,unique:true,masterwork:true}),
  };

  const recipe=(name,output,count,cost,station="hand",description="")=>({name,output,count,cost,station,description});
  const recipes=[
    recipe("石斧","axe",1,{branch:3,stone:3},"hand","木を切って木材を集めよう。"),
    recipe("石つるはし","pickaxe",1,{branch:3,stone:4},"hand","岩や鉱床を掘れる。"),
    recipe("木槍","spear",1,{branch:4,fiber:2,stone:1},"hand","小石の穂先を付けた、身を守るための軽い槍。"),
    recipe("木槌","hammer",1,{wood:5},"hand","木材だけで組める建築用の木槌。"),
    recipe("島草の包帯","herbal_wrap",1,{herb:2,fiber:1},"hand","手早く体力を18回復できる。"),
    recipe("焼きベリー","cooked_berry",1,{berry:2},"campfire","焚き火で甘く焼く。"),
    recipe("焼き魚","cooked_fish",1,{fish:1},"campfire","魚を香ばしく焼く。"),
    recipe("釣り竿","rod",1,{branch:5,fiber:5},"workbench","水辺で使う。"),
    recipe("じょうろ","watering_can",1,{wood:3,copper_bar:1},"workbench","井戸で水を汲める。"),
    recipe("銅斧","copper_axe",1,{wood:3,copper_bar:4,resin:1},"workbench","伐採が速くなる。"),
    recipe("銅つるはし","copper_pickaxe",1,{wood:3,copper_bar:4},"workbench","採掘が速くなる。"),
    recipe("光槍","light_spear",1,{wood:4,copper_bar:2,crystal:3},"workbench","番人にも有効な光の穂先。"),
    recipe("銅じょうろ","copper_watering_can",1,{wood:2,copper_bar:5},"workbench","周囲9マスへ散水する。"),
    recipe("銅塊","copper_bar",1,{ore:2,wood:1},"furnace","銅鉱を精錬する。"),
    recipe("サンルートスープ","soup",1,{sunroot:2,water:1,berry:1},"campfire","元気が長く続く料理。"),
    recipe("きらめき串","glow_skewer",1,{fish_glow:1,sunroot:1},"campfire","光をまとえる特別料理。"),
    recipe("丈夫なロープ","rope",2,{fiber:3},"hand","上位の設備を組むための縄。"),
    recipe("探検サンド","field_ration",1,{berry:2,sunroot:1},"campfire","長い探索に向く携帯食。"),
    recipe("月豆茶","moon_tea",1,{moonbean:2,water:1},"campfire","集中力が長く続く温かな飲み物。"),
    recipe("潮風サラダ","tide_salad",1,{tide_melon:2,herb:1},"campfire","満腹と潤いを同時に満たす。"),
    recipe("三光シチュー","prism_stew",1,{sunroot:2,moonbean:1,tide_melon:1,fish:1},"campfire","島のすべての恵みを使う最高の料理。"),
    recipe("泡ガニのスープ","crab_soup",1,{crab_meat:1,herb:1,water:1},"campfire","満腹・潤い・体力を一緒に戻す。"),
    recipe("陽だまり薬","sun_tonic",1,{slime_gel:2,berry:1,herb:1},"campfire","体力を大きく回復し、しばらく元気が続く。"),
    recipe("トゲ実串","thorn_skewer",1,{thorn_seed:1,berry:2},"campfire","敵から得た素材で作る回復料理。"),
    recipe("光晶磨き","crystal",1,{crystal_dust:3},"furnace","晶羽蛾の粉を光晶へ固める。"),
    recipe("陽光の斧","sun_axe",1,{copper_axe:1,light_shard:5,crystal:5},"workbench","灯台完成後に作れる最高級の斧。"),
    recipe("陽光のつるはし","sun_pickaxe",1,{copper_pickaxe:1,light_shard:5,crystal:5},"workbench","灯台完成後に作れる最高級の採掘具。"),
    recipe("陽光の槍","sun_spear",1,{light_spear:1,light_shard:7,copper_bar:5},"workbench","灯台完成後に作れる最高級の槍。"),
    recipe("星結びの竿","sun_rod",1,{rod:1,light_shard:4,copper_bar:4,rope:2},"workbench","希少魚との出会いを増やす。"),
    recipe("虹雲じょうろ","sun_watering_can",1,{copper_watering_can:1,light_shard:4,copper_bar:4},"workbench","周囲25マスへ散水できる。"),
  ];

  const building=(name,sprite,size,cost,description,extra={})=>({name,sprite,size,cost,description,...extra});
  const buildings={
    campfire:building("焚き火","campfire",[1,1],{branch:5,stone:4},"料理と夜の目印。",{station:"campfire",solid:false}),
    workbench:building("作業台","workbench",[2,1],{wood:8,stone:4},"道具と家具を制作する。",{station:"workbench"}),
    furnace:building("炉","furnace",[2,2],{stone:12,wood:5},"銅鉱を精錬する。",{station:"furnace"}),
    chest:building("木箱","chest",[1,1],{wood:8,fiber:2},"素材を24枠分しまう。",{storage:24}),
    bed:building("ふかふかベッド","bed",[2,1],{wood:8,fiber:12},"朝まで眠り、復帰地点にする。",{sleep:true}),
    plot:building("畑","plot",[1,1],{wood:1,fiber:1},"種を植えて作物を育てる。",{solid:false,farm:true}),
    well:building("井戸ポンプ","well",[2,2],{stone:10,wood:6,copper_bar:2},"淡水とじょうろの水を得る。",{water:true}),
    lantern:building("陽だまりランタン","lantern",[1,1],{wood:2,resin:2,crystal:1},"夜を明るくし、畑を助ける。",{solid:false,light:true}),
    wood_floor:building("木の床",null,[1,1],{wood:2},"歩きやすい床。",{solid:false,tile:"wood_floor"}),
    stone_floor:building("石の床",null,[1,1],{stone:3},"丈夫な石床。",{solid:false,tile:"stone_floor"}),
    fence:building("木の柵",null,[3,1],{wood:3},"見た目どおり横3マスをふさぐ低い柵。"),
    gate:building("木の門",null,[2,1],{wood:3,fiber:1},"横2マスの通り抜けられる拠点の門。",{solid:false}),
    bridge:building("小さな橋",null,[1,1],{wood:4,fiber:1},"浅瀬を渡れるようにする。",{solid:false,bridge:true}),
    flag:building("風の旗",null,[1,1],{fiber:4,wood:2,shell:2},"島評価を彩る装飾。",{solid:false,decor:true}),
    bench:building("木のベンチ",null,[2,1],{wood:5},"海を眺める装飾。",{decor:true}),
    flowerpot:building("光花の鉢",null,[1,1],{stone:2,seed:1,light_shard:1},"灯台完成後の特別装飾。",{solid:false,decor:true,postgame:true}),
    sun_banner:building("太陽のタペストリー",null,[1,1],{fiber:6,light_shard:2},"風に光模様が浮かぶ特別装飾。",{solid:false,decor:true,postgame:true}),
    shell_chime:building("貝殻の風鈴",null,[1,1],{shell:8,wood:2,light_shard:1},"潮風に澄んだ音を返す特別装飾。",{solid:false,decor:true,postgame:true}),
    prism_arch:building("プリズムアーチ",null,[2,1],{stone:8,crystal:4,light_shard:3},"三色の光を落とす特別装飾。",{decor:true,postgame:true}),
    rain_collector:building("雨集め樽",null,[1,1],{wood:6,rope:2},"雨をため、晴れの日にも淡水を得る。",{water:true,solid:false}),
    sprinkler:building("光粒スプリンクラー",null,[1,1],{copper_bar:5,crystal:2,rope:2},"朝に周囲の畑へ自動で水をまく。",{solid:false,autoWater:3}),
    greenhouse:building("陽だまり温室",null,[3,3],{wood:18,crystal:6,rope:6},"中と周囲の作物を毎朝必ず育てる。",{solid:false,greenhouse:3}),
    request_board:building("島のおねがい掲示板",null,[2,1],{wood:8,rope:2},"日替わりのおねがいをすぐ確認できる。",{commission:true}),
    waystone:building("陽光の道標",null,[1,1],{stone:10,crystal:4,light_shard:2},"建てた道標と安全地点の間を移動する。",{travel:true,solid:false,postgame:true}),
    trophy_plinth:building("記章の飾り台",null,[1,1],{stone:6,copper_bar:2},"集めた記章を誇らしく飾る。",{decor:true}),
    sun_dial:building("ひまわり日時計",null,[2,2],{stone:8,copper_bar:3,crystal:1},"島の時を彩る大きな装飾。",{decor:true}),
    beacon_garden:building("星灯りの庭",null,[3,3],{light_shard:8,crystal:8,moonbean:6,tide_melon:6},"灯台の光を花として咲かせる究極の庭。",{decor:true,postgame:true,solid:false}),
    healing_totem:building("島草の癒やし柱",null,[1,1],{wood:6,herb:5,moss_shell:2},"朝ごとに一度、そっと体力を回復する。",{art:"flowerpot",healStation:28,solid:false}),
    moss_rug:building("苔編みマット",null,[2,1],{fiber:5,moss_shell:2},"足元を柔らかく彩る苔色の敷物。",{art:"wood_floor",decor:true,solid:false}),
    wisp_lantern:building("潮明かりの灯籠",null,[1,1],{wood:2,shell:3,wisp_essence:2},"浜辺の光を閉じ込めた青白い灯り。",{art:"lantern",decor:true,light:true,solid:false}),
    warden_banner:building("番人の旗",null,[1,1],{fiber:6,resin:2,crystal_dust:3},"島を守った記念の大きな旗。",{art:"sun_banner",decor:true,solid:false}),
  };

  const enemies={
    slime:{name:"芽スライム",sprite:"slime",hp:14,speed:18,damage:8,range:18,notice:.8,drop:{fiber:[1,2],slime_gel:[1,2]},biome:"grass",attack:"touch"},
    thorn:{name:"トゲウリ",sprite:"thorn",hp:22,speed:11,damage:10,range:55,notice:1.0,drop:{berry:[1,2],seed:[0,1],thorn_seed:[1,2]},biome:"forest",attack:"seed"},
    crab:{name:"泡ガニ",sprite:"crab",hp:28,speed:12,damage:12,range:22,notice:.9,drop:{shell:[1,2],crab_meat:[1,2]},biome:"beach",attack:"touch"},
    rockling:{name:"石ころ獣",sprite:"rockling",hp:34,speed:16,damage:14,range:45,notice:1.1,drop:{stone:[2,4],ore:[0,1],crystal_dust:[0,1]},biome:"rock",attack:"charge"},
    moss_beetle:{name:"苔甲虫",sprite:"moss_beetle",combatCell:0,hp:30,speed:15,damage:11,range:38,notice:.9,drop:{moss_shell:[1,2],resin:[0,1]},biome:"forest",attack:"charge"},
    sand_wisp:{name:"潮の光精",sprite:"sand_wisp",combatCell:1,hp:24,speed:9,damage:9,range:62,notice:1.05,drop:{wisp_essence:[1,2],shell:[0,1]},biome:"beach",attack:"bubble"},
    crystal_moth:{name:"晶羽蛾",sprite:"crystal_moth",combatCell:2,hp:27,speed:13,damage:11,range:64,notice:1.1,drop:{crystal_dust:[1,3],crystal:[0,1]},biome:"rock",attack:"crystal"},
    forest_warden:{name:"森の番人",sprite:"forest_warden",hp:110,speed:13,damage:16,range:42,notice:1.15,drop:{resin:[4,6],moss_shell:[2,3]},boss:true,biome:"forest",attack:"forest"},
    stone_warden:{name:"岩丘の番人",sprite:"stone_warden",hp:130,speed:10,damage:18,range:50,notice:1.25,drop:{crystal:[4,6],crystal_dust:[3,5]},boss:true,biome:"rock",attack:"crystal_burst"},
  };

  const objectives=[
    {id:"gather",title:"枝と石を集めよう",detail:"枝 3 / 石 3",check:s=>Math.max(s.stats.gatheredBranch,s.inventory.branch||0)>=3&&Math.max(s.stats.gatheredStone,s.inventory.stone||0)>=3},
    {id:"axe",title:"石斧を作ろう",detail:"バッグからクラフトできる",check:s=>(s.inventory.axe||0)>0||(s.inventory.copper_axe||0)>0},
    {id:"hammer",title:"木槌を作ろう",detail:"木材5だけで手作りできる",check:s=>(s.inventory.hammer||0)>0},
    {id:"campfire",title:"焚き火を置こう",detail:"建築メニューから配置",check:s=>s.buildings.some(b=>b.type==="campfire")},
    {id:"cook",title:"食べ物を焼こう",detail:"焼き魚などの料理は体力も回復する",check:s=>s.stats.cooked>0},
    {id:"workbench",title:"作業台を建てよう",detail:"木材 8 / 石 4",check:s=>s.buildings.some(b=>b.type==="workbench")},
    {id:"lighthouse",title:"古い灯台を調べよう",detail:"島の中央にある大きな塔",check:s=>s.progress.lighthouseSeen},
    {id:"base",title:"灯台の台座を修理しよう",detail:"木材 20 / 石 20",check:s=>s.progress.lighthouseStage>=1},
    {id:"lens",title:"灯台のレンズ枠を作ろう",detail:"銅塊 8 / 光晶 5",check:s=>s.progress.lighthouseStage>=2},
    {id:"prisms",title:"三つの自然プリズムを集めよう",detail:"森・潮・岩の地域課題",check:s=>s.progress.prisms.forest&&s.progress.prisms.tide&&s.progress.prisms.rock},
    {id:"ending",title:"灯台を再点灯しよう",detail:"三つの光を灯台へ",check:s=>s.progress.lighthouseStage>=4},
    {id:"free",title:"陽だまりの島で暮らそう",detail:"島評価30・熟練10・記憶8を目指そう",check:s=>false},
  ];

  const achievements=[
    ["first_craft","手のひら工房","初めてクラフトした"],["first_night","星空の下","初めて夜を越した"],["first_cook","島の朝ごはん","初めて料理した"],
    ["first_build","小さな拠点","初めて建築した"],["first_harvest","芽吹きの日","初めて作物を収穫した"],["fish3","釣りびより","魚を3種類釣った"],
    ["fish6","島の釣り名人","魚図鑑を完成した"],["forest","森へお返し","森のプリズムを得た"],["tide","潮を待つ","潮のプリズムを得た"],
    ["rock","風車石の歌","岩のプリズムを得た"],["lighthouse","光の帰る場所","灯台を再点灯した"],["no_hit","やさしい勝利","番人を無傷で鎮めた"],
    ["dodge30","風の足どり","攻撃を30回回避した"],["all_recipes","島の職人","全レシピを一度作った"],["map100","雲ひとつない地図","島を100%踏破した"],
    ["rating15","最高の島暮らし","島評価を15にした"],["day10","十度目の朝","10日暮らした"],["plant100","百本の木陰","100本分の自然を育てた"],
    ["relic1","砂の中の光","島の記憶を初めて見つけた"],["relic4","記憶をたどる旅","島の記憶を4つ見つけた"],["relic8","ルミナの記憶","島の記憶をすべて見つけた"],
    ["commission1","はじめてのお手伝い","島のおねがいを初めて達成した"],["commission10","頼れる島人","おねがいを10件達成した"],["commission30","ルミナの支え手","おねがいを30件達成した"],
    ["mastery5","腕の見せどころ","いずれかの熟練度を5にした"],["mastery10","ひとつの道の達人","いずれかの熟練度を10にした"],["all_mastery5","六つの手仕事","全熟練度を5以上にした"],
    ["fish10","海の友だち","魚図鑑10種を完成した"],["rating30","光あふれる島","島評価を30にした"],["day30","三十度目の朝","30日暮らした"],
    ["build50","島づくり名人","建築を50回行った"],["gather500","恵みの担い手","素材を500個集めた"],["all_masterwork","陽光の職人","最高級の道具を5種類揃えた"],
  ].map(([id,name,desc])=>({id,name,desc}));

  const mastery=[
    {id:"gather",name:"採集",metric:s=>s.stats.gathered,thresholds:[0,15,40,80,140,230,350,500,700,950,1250],perk:"素材の追加獲得率が上がる"},
    {id:"craft",name:"工作",metric:s=>s.stats.crafted+s.stats.built,thresholds:[0,6,15,28,45,70,100,140,190,250,330],perk:"制作時に素材が戻ることがある"},
    {id:"farm",name:"農耕",metric:s=>s.stats.planted+s.stats.harvested*2,thresholds:[0,5,14,28,50,80,120,170,230,300,400],perk:"収穫量が増える"},
    {id:"fish",name:"釣り",metric:s=>s.stats.fishCaught,thresholds:[0,3,8,16,28,45,65,90,120,160,210],perk:"金色の帯が広がる"},
    {id:"combat",name:"守り",metric:s=>s.stats.enemiesCalmed+s.stats.dodges*.25,thresholds:[0,3,8,16,28,45,65,90,120,160,210],perk:"攻撃力と無敵時間が伸びる"},
    {id:"explore",name:"探索",metric:s=>s.explored.filter(Boolean).length+s.stats.relics*20,thresholds:[0,12,28,50,80,115,155,200,245,285,324],perk:"移動速度が上がる"},
  ];

  const upgrades=[
    {id:"vitality",name:"丈夫な体",cost:2,desc:"最大体力 +20"},{id:"breath",name:"風の呼吸",cost:2,desc:"最大スタミナ +20"},
    {id:"forager",name:"目利き",cost:3,desc:"手採集で追加素材"},{id:"logger",name:"木立の友",cost:3,desc:"木材を追加獲得"},
    {id:"miner",name:"石読み",cost:3,desc:"石・鉱石を追加獲得"},{id:"angler",name:"潮読み",cost:3,desc:"釣りの成功帯が拡大"},
    {id:"farmer",name:"豊作の手",cost:4,desc:"作物の収穫量 +1"},{id:"cook",name:"おかわり",cost:4,desc:"料理が時々2個完成"},
    {id:"craftsman",name:"端材活用",cost:4,desc:"制作時に素材が一部戻る"},{id:"guardian",name:"光の構え",cost:5,desc:"攻撃力 +25%"},
    {id:"runner",name:"島風の靴",cost:5,desc:"移動速度 +12%"},{id:"beacon",name:"灯台守の朝",cost:6,desc:"毎朝の光のかけら +1"},
  ];

  const commissions=[
    {id:"gather",name:"浜辺の資材集め",metric:"gathered",goal:18,reward:2,desc:"素材を集める"},
    {id:"craft",name:"手仕事の日",metric:"crafted",goal:4,reward:2,desc:"アイテムを作る"},
    {id:"cook",name:"みんなの朝ごはん",metric:"cooked",goal:3,reward:2,desc:"料理を作る"},
    {id:"build",name:"島を整えよう",metric:"built",goal:3,reward:2,desc:"建築を行う"},
    {id:"fish",name:"潮の調査",metric:"fishCaught",goal:4,reward:3,desc:"魚を釣る"},
    {id:"calm",name:"生き物の見回り",metric:"enemiesCalmed",goal:5,reward:3,desc:"生き物を鎮める"},
    {id:"plant",name:"緑を増やそう",metric:"planted",goal:5,reward:2,desc:"種を植える"},
    {id:"harvest",name:"実りの便り",metric:"harvested",goal:4,reward:3,desc:"作物を収穫する"},
  ];

  const relics=[
    ["浜風のガラス","最初の浜を見守った青い欠片。"],["木漏れ日のボタン","古い作業着に残った小さな記憶。"],
    ["潮騒のコイン","満ち引きの印が刻まれている。"],["渡り鳥の羽飾り","南の岬で光を受ける。"],
    ["石工の星釘","灯台を組んだ職人の道具。"],["雨粒の小瓶","光雨を一滴だけ閉じ込めた。"],
    ["風車の歯車","岩丘の風を覚えている。"],["夜明けのレンズ片","ルミナ島の朝を映す最後の欠片。"],
  ].map(([name,desc],id)=>({id,name,desc}));
  const outfits=[
    {id:"island",name:"島職人",colors:["#2CB9A8","#FFD166"],desc:"ヒナのお気に入り。最初から選べる。",check:s=>true},
    {id:"grove",name:"木漏れ日",colors:["#4FAF72","#FFD166"],desc:"森の光を映した緑の仕事着。",check:s=>s.progress.prisms.forest},
    {id:"tide",name:"潮風",colors:["#71DCE1","#EF6A67"],desc:"魚を6種類見つけると選べる。",check:s=>Object.keys(s.fishCaught).length>=6},
    {id:"starlight",name:"星明かり",colors:["#A99BE8","#71DCE1"],desc:"島の記憶を4つ見つけると選べる。",check:s=>s.progress.relics.filter(Boolean).length>=4},
    {id:"keeper",name:"灯台守",colors:["#FFF4C7","#FFD166"],desc:"灯台を完成すると選べる。",check:s=>s.progress.lighthouseStage>=4},
  ];

  LI.DATA={items,recipes,buildings,enemies,objectives,achievements,mastery,upgrades,commissions,relics,outfits,
    fish:["fish","fish_sun","fish_moon","fish_rain","fish_rock","fish_glow","fish_leaf","fish_coral","fish_star","fish_prism"],
    weather:[{id:"sunny",name:"晴れ"},{id:"rain",name:"小雨"},{id:"glow",name:"光雨"}],
    credits:{title:"陽だまりクラフト — LUMINA ISLE",version:"3.1.0",author:"rirtir / OpenAI Codex",year:"2026"}
  };
})();
