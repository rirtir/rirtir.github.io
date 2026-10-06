# 残工程の共通契約

各担当はこの契約を優先し、同じファイルを同時編集しない。既存ゲームは参照しない。

## 所有権

- Claude core-rest: simulation.js、world.js、settlement.js。必要ならcombat.js/progression.jsなど新しいロジック用モジュールを追加可。data.jsは必要な仕様追加のみ可。main/ui/renderer/audio/HTML/CSS/art/assetsは編集しない。
- Claude ui-rest: main.js、ui.js、style.css、index.html。simulation/world/data/settlement/renderer/audio/art/assetsは編集しない。
- Codex: renderer.js、audio.js、art/assets、tests、統合修正。Core/UI完了後の統合で他ファイルを変更する。

## ロジックの公開API

既存simulation.jsの公開APIを壊さない。新しい関数はsimulation.jsからexportする。引数のstateはmainが閉包にするのでUIは直接扱わない。

- `selectBuild(state,type,rot=0)`: アイテムの構造物type、または特殊なfarm/plant_wheat/plant_potato/demolish/nullを指定する。持ち物と距離の条件は通常どおり。state.player.buildMode等の実行中のモードを変更し、stepの入力で選択位置に設置/耕す/植える/取り壊す。右クリック/キャンセルで解除。
- `canBuild(state,type,x,y)` → `{ok,reason}`。プレビューと行動に同じ判定を使う。
- `till(state,x,y)` / `plant(state,kind,x,y)` / `harvest(state,crop)` → `{ok,reason?}`。
- `collectResident(state,id)` → `{ok,reason?}`。
- `restoreLight(state,id)`（forge/moss/ancient）→ `{ok,reason?}`。素材・鍵・距離・進行条件をここで確認する。
- `bossRematch(state,id)`（vine/ash）→ `{ok,reason?}`。
- `getHouseStatus(state)` → `{valid:number,total:number,houses:[{id,valid,reasons,cells,minX,maxX,minY,maxY,bed,safe,...}]}`。
- `getLifeGoals(state)` → `[{id,text,value,target}]`。
- `getJournal(state)` → `{objective:{text,items},lights:[{id,name,done,requirements:[{text,done,current?,target?}]}],goals:[{id,text,value,target}],story:string}`。
- `getObjective(state)` は既存の `{text,items:[{id,n,have}]}` を維持し、各段階に対応。
- 既存 `serialize/validateSave/createState` は追加状態を保存・復元。`validateSave` は `{ok,save,errors,warnings?}` を返す。

## 描画/表示に渡す状態

既存構造を維持。地図idはsurface/underground、物の座標x,yはタイル座標、人物のx,yはpixel。ノードは既存px/py。

- `state.crops`: `[{map,x,y,kind,growth,lastClock}]`。kind=moss_potato/wheat、growthは成長した秒数。CROPS.stageTime*stagesで成熟。
- `state.farmland`: `[{map,x,y}]`。耕した地面のoverlay。
- `state.houses`: `[{id,map,cells:[[tx,ty]],minX,maxX,minY,maxY,x,y,valid,safe,reasons,bed,doors,lights}]`。
- `state.npcs`: `[{id,name,sprite,tint?,map,x,y,house,basket,active,sleeping?}]`。恒久状態はprogress.npcs。
- `state.explored`: `{surface:Uint8Array,underground:Uint8Array}`。タイルインデックスの0/1。半径6で自動開示。地図では未踏を隠す。
- `state.enemies`: `[{id,type,name,sprite,map,x,y,hp,maxHp,def,radius,boss?,phase?,telegraph?,...}]`。telegraphは0..1の進行またはnull、攻撃範囲の情報はstate.telegraphsに統一。
- `state.telegraphs`: `[{kind:'circle'|'ring'|'line'|'cone',map,x,y,x2?,y2?,radius?,width?,angle?,arc?,remaining,duration,color?}]`。描画のみ。シミュレーションで攻撃判定。
- `state.projectiles`: `[{map,x,y,vx,vy,radius,color?,life,...}]`。
- `state.boss`: 活動中ボスまたはnull（state.enemiesの該当要素と同じ）。ボスHPバーはこの値を使う。
- `state.deathBag`: `{map,x,y,items:[{id,n}]}` またはnull。
- 地下壁の描画に追加のmap属性が必要なら core-restの結果で報告する。rendererは地形がsolidかどうかからまず壁を描けるようにする。
- `state.preview` は既存 `{type,x,y,ok,reason,rot}`、farm等の特殊typeも使用。rendererは専用の畑・カーソルを描く。

## UI/音/保存のイベント

既存msg/hint/gain/hit/deplete/pickup/craft/place/remove等は維持。

- `{type:'open',panel:'altar',id:'forge'|'moss'|'ancient'}` → UIで要求/供物/復元ボタン。
- `{type:'open',panel:'npc',id}` → 住人の仕事・籠・受取ボタン。
- `{type:'open',panel:'rematch',id:'vine'|'ash'}` → 再戦確認。
- `{type:'ending'}` → エンディングと続けるボタン。ここでシミュレーションは停止。
- `{type:'save'}` → mainの保存。
- `{type:'light',id}` / `{type:'bossStart',id}` / `{type:'bossDead',id}` / `{type:'death'}` / `{type:'harvest'}` / `{type:'plant'}` / `{type:'sleep'}`。

audio.jsはCodexが作成済み。`createAudio()` の `unlock/play/setMusic/setVolumes/handleEvents/setPaused/destroy` をmainで接続。イベントと音の対応はmainで実装してよい。音楽mode=day/night/cave/ruin/boss/ending、音量master/music/sfx=0..1。ユーザー操作前は開始しない。音の非対応や拒否はゲームを止めない。

## 保存

mainがlocalStorage I/OとJSONファイル入出力を担当。simulationが検証・正規化を担当。セーブ失敗は常設メッセージ。壊れたJSON・未来version・巨大ファイル・不正座標・NaN相当・未知ID・無効レイヤーの重なりを拒否/正規化して、読込失敗時は元のstateと保存データを保持。明示した確認UIを経てから読込を反映。自動保存は60秒、重要イベント、visibility/beforeunload。タイトルの続きからは実際の保存日時・灯数・プレイ時間を表示。

## 実装後

各担当は実装した関数・状態・まだ残った事項を短く報告。自己申告で完了にせず、Codexがブラウザで主進行・各異常系・タッチ・見た目を検証し、レビュー後修正する。
