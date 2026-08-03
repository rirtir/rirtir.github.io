(function(){
  "use strict";
  const LI=window.LI=window.LI||{};
  const item=(name,sprite,description,extra={})=>({name,sprite,description,stack:99,...extra});
  const items={
    branch:item("枝","branch","道具や焚き火の基本素材。"),wood:item("木材","wood","建築と加工に使う丈夫な木。"),stone:item("石","stone","道具、床、炉の材料。"),
    fiber:item("繊維","fiber","縄や布へ加工できる草の繊維。"),berry:item("陽ベリー","berry","そのまま食べられる甘い実。",{food:10,water:4}),seed:item("サンルートの種","seed","畑へ植えると3朝で育つ。"),
    resin:item("樹脂","resin","灯りと上位道具に使う樹液。"),shell:item("貝殻","shell","浜辺で拾える装飾素材。"),fish:item("青すじ魚","fish","焚き火で焼ける魚。",{fish:true}),
    fish_sun:item("ひだまり鯛","fish","昼の浅瀬にいる暖色の魚。",{fish:true}),fish_moon:item("月しずく魚","fish","夕夜の潮だまりに現れる魚。",{fish:true}),
    fish_rain:item("雨つぶ魚","fish","小雨の日によく釣れる魚。",{fish:true}),fish_rock:item("いわひれ","fish","岩丘の岸に棲む重い魚。",{fish:true}),fish_glow:item("きらめき魚","fish","ごく稀に光る島の魚。",{fish:true}),
    cooked_fish:item("焼き魚","cooked_fish","香ばしい。体力も少し戻る。",{food:36,heal:10}),cooked_berry:item("焼きベリー","cooked_berry","温めて甘みが増した。",{food:18}),
    water:item("淡水","water","潤いを大きく回復する。",{water:40}),ore:item("銅鉱","ore","炉で銅塊へ精錬できる。"),copper_bar:item("銅塊","copper_bar","上位道具と灯台部品の素材。"),
    crystal:item("光晶","crystal","岩丘に眠る明るい結晶。"),light_shard:item("光のかけら","light_shard","灯台が生み出す特別な素材。"),sunroot:item("サンルート","sunroot","煮込むと元気が出る根菜。",{food:14}),
    soup:item("サンルートスープ","soup","満腹と潤いを満たし、元気が続く。",{food:55,water:20,staminaBuff:120}),glow_skewer:item("きらめき串","glow_skewer","体力を戻し、しばらく周囲を照らす。",{food:42,heal:25,glow:120}),
    prism_forest:item("森のプリズム","prism_forest","育つ光を宿す。",{key:true}),prism_tide:item("潮のプリズム","prism_tide","満ちる光を宿す。",{key:true}),prism_rock:item("岩のプリズム","prism_rock","眠る光を宿す。",{key:true}),
    axe:item("石斧","axe","木を切れる。壊れない。",{tool:"axe",power:1,unique:true}),copper_axe:item("銅斧","axe","広い範囲を素早く伐採する。",{tool:"axe",power:2,unique:true}),
    pickaxe:item("石つるはし","pickaxe","岩と鉱床を掘れる。",{tool:"pickaxe",power:1,unique:true}),copper_pickaxe:item("銅つるはし","pickaxe","鉱石を素早く掘れる。",{tool:"pickaxe",power:2,unique:true}),
    spear:item("木槍","spear","島の生き物を鎮める武器。",{tool:"weapon",power:1,unique:true}),light_spear:item("光槍","spear","光晶を穂先にした強い槍。",{tool:"weapon",power:2,unique:true}),
    rod:item("釣り竿","rod","水辺で魚を釣れる。",{tool:"rod",power:1,unique:true}),watering_can:item("じょうろ","watering_can","井戸で満たし畑へ水をまく。",{tool:"water",power:1,unique:true}),
    copper_watering_can:item("銅じょうろ","watering_can","周囲の畑にも水をまける。",{tool:"water",power:2,unique:true}),hammer:item("木槌","hammer","建築の配置・移動・解体に使う。",{tool:"hammer",power:1,unique:true}),
  };

  const recipe=(name,output,count,cost,station="hand",description="")=>({name,output,count,cost,station,description});
  const recipes=[
    recipe("石斧","axe",1,{branch:3,stone:3},"hand","木を切って木材を集めよう。"),
    recipe("石つるはし","pickaxe",1,{branch:3,stone:4},"hand","岩や鉱床を掘れる。"),
    recipe("木槍","spear",1,{branch:4,fiber:2},"hand","身を守るための軽い槍。"),
    recipe("焼きベリー","cooked_berry",1,{berry:2},"campfire","焚き火で甘く焼く。"),
    recipe("焼き魚","cooked_fish",1,{fish:1},"campfire","魚を香ばしく焼く。"),
    recipe("釣り竿","rod",1,{branch:5,fiber:5},"workbench","水辺で使う。"),
    recipe("木槌","hammer",1,{wood:4,stone:2},"workbench","建築を始める道具。"),
    recipe("じょうろ","watering_can",1,{wood:3,copper_bar:1},"workbench","井戸で水を汲める。"),
    recipe("銅斧","copper_axe",1,{wood:3,copper_bar:4,resin:1},"workbench","伐採が速くなる。"),
    recipe("銅つるはし","copper_pickaxe",1,{wood:3,copper_bar:4},"workbench","採掘が速くなる。"),
    recipe("光槍","light_spear",1,{wood:4,copper_bar:2,crystal:3},"workbench","番人にも有効な光の穂先。"),
    recipe("銅じょうろ","copper_watering_can",1,{wood:2,copper_bar:5},"workbench","周囲9マスへ散水する。"),
    recipe("銅塊","copper_bar",1,{ore:2,wood:1},"furnace","銅鉱を精錬する。"),
    recipe("サンルートスープ","soup",1,{sunroot:2,water:1,berry:1},"campfire","元気が長く続く料理。"),
    recipe("きらめき串","glow_skewer",1,{fish_glow:1,sunroot:1},"campfire","光をまとえる特別料理。"),
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
    fence:building("木の柵",null,[1,1],{wood:2},"拠点を囲う低い柵。"),
    gate:building("木の門",null,[1,1],{wood:3,fiber:1},"通り抜けられる拠点の門。",{solid:false}),
    bridge:building("小さな橋",null,[1,1],{wood:4,fiber:1},"浅瀬を渡れるようにする。",{solid:false,bridge:true}),
    flag:building("風の旗",null,[1,1],{fiber:4,wood:2,shell:2},"島評価を彩る装飾。",{solid:false,decor:true}),
    bench:building("木のベンチ",null,[2,1],{wood:5},"海を眺める装飾。",{decor:true}),
    flowerpot:building("光花の鉢",null,[1,1],{stone:2,seed:1,light_shard:1},"灯台完成後の特別装飾。",{solid:false,decor:true,postgame:true}),
    sun_banner:building("太陽のタペストリー",null,[1,1],{fiber:6,light_shard:2},"風に光模様が浮かぶ特別装飾。",{solid:false,decor:true,postgame:true}),
    shell_chime:building("貝殻の風鈴",null,[1,1],{shell:8,wood:2,light_shard:1},"潮風に澄んだ音を返す特別装飾。",{solid:false,decor:true,postgame:true}),
    prism_arch:building("プリズムアーチ",null,[2,1],{stone:8,crystal:4,light_shard:3},"三色の光を落とす特別装飾。",{decor:true,postgame:true}),
  };

  const enemies={
    slime:{name:"芽スライム",sprite:"slime",hp:14,speed:18,damage:8,range:18,notice:.8,drop:{fiber:[1,2]},biome:"grass"},
    thorn:{name:"トゲウリ",sprite:"thorn",hp:22,speed:11,damage:10,range:55,notice:1.0,drop:{berry:[1,2],seed:[0,1]},biome:"forest"},
    crab:{name:"泡ガニ",sprite:"crab",hp:28,speed:12,damage:12,range:22,notice:.9,drop:{shell:[1,2]},biome:"beach"},
    rockling:{name:"石ころ獣",sprite:"rockling",hp:34,speed:16,damage:14,range:45,notice:1.1,drop:{stone:[2,4],ore:[0,1]},biome:"rock"},
    forest_warden:{name:"森の番人",sprite:"forest_warden",hp:110,speed:13,damage:16,range:42,notice:1.15,drop:{resin:[4,6]},boss:true,biome:"forest"},
    stone_warden:{name:"岩丘の番人",sprite:"stone_warden",hp:130,speed:10,damage:18,range:50,notice:1.25,drop:{crystal:[4,6]},boss:true,biome:"rock"},
  };

  const objectives=[
    {id:"gather",title:"枝と石を集めよう",detail:"枝 3 / 石 3",check:s=>s.stats.gatheredBranch>=3&&s.stats.gatheredStone>=3},
    {id:"axe",title:"石斧を作ろう",detail:"バッグからクラフトできる",check:s=>(s.inventory.axe||0)>0||(s.inventory.copper_axe||0)>0},
    {id:"campfire",title:"焚き火を置こう",detail:"建築メニューから配置",check:s=>s.buildings.some(b=>b.type==="campfire")},
    {id:"cook",title:"食べ物を焼こう",detail:"焚き火の近くでクラフト",check:s=>s.stats.cooked>0},
    {id:"workbench",title:"作業台を建てよう",detail:"木材 8 / 石 4",check:s=>s.buildings.some(b=>b.type==="workbench")},
    {id:"lighthouse",title:"古い灯台を調べよう",detail:"島の中央にある大きな塔",check:s=>s.progress.lighthouseSeen},
    {id:"base",title:"灯台の台座を修理しよう",detail:"木材 20 / 石 20",check:s=>s.progress.lighthouseStage>=1},
    {id:"lens",title:"灯台のレンズ枠を作ろう",detail:"銅塊 8 / 光晶 5",check:s=>s.progress.lighthouseStage>=2},
    {id:"prisms",title:"三つの自然プリズムを集めよう",detail:"森・潮・岩の地域課題",check:s=>s.progress.prisms.forest&&s.progress.prisms.tide&&s.progress.prisms.rock},
    {id:"ending",title:"灯台を再点灯しよう",detail:"三つの光を灯台へ",check:s=>s.progress.lighthouseStage>=4},
    {id:"free",title:"陽だまりの島で暮らそう",detail:"島評価15を目指せる",check:s=>false},
  ];

  const achievements=[
    ["first_craft","手のひら工房","初めてクラフトした"],["first_night","星空の下","初めて夜を越した"],["first_cook","島の朝ごはん","初めて料理した"],
    ["first_build","小さな拠点","初めて建築した"],["first_harvest","芽吹きの日","初めて作物を収穫した"],["fish3","釣りびより","魚を3種類釣った"],
    ["fish6","島の釣り名人","魚図鑑を完成した"],["forest","森へお返し","森のプリズムを得た"],["tide","潮を待つ","潮のプリズムを得た"],
    ["rock","風車石の歌","岩のプリズムを得た"],["lighthouse","光の帰る場所","灯台を再点灯した"],["no_hit","やさしい勝利","番人を無傷で鎮めた"],
    ["dodge30","風の足どり","攻撃を30回回避した"],["all_recipes","島の職人","全レシピを一度作った"],["map100","雲ひとつない地図","島を100%踏破した"],
    ["rating15","最高の島暮らし","島評価を15にした"],["day10","十度目の朝","10日暮らした"],["plant100","百本の木陰","100本分の自然を育てた"],
  ].map(([id,name,desc])=>({id,name,desc}));

  LI.DATA={items,recipes,buildings,enemies,objectives,achievements,
    fish:["fish","fish_sun","fish_moon","fish_rain","fish_rock","fish_glow"],
    weather:[{id:"sunny",name:"晴れ",icon:"☀"},{id:"rain",name:"小雨",icon:"☂"},{id:"glow",name:"光雨",icon:"✦"}],
    credits:{title:"陽だまりクラフト — LUMINA ISLE",version:"1.0.0",author:"rirtir / OpenAI Codex",year:"2026"}
  };
})();
