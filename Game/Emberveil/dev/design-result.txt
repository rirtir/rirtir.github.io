# 残り火の深庭 / EMBERVEIL 設計書

> 2Dドット絵・見下ろし型のサバイバルクラフト／静的 GitHub Pages 向け。素の HTML / CSS / JavaScript（ES Modules）で作り、外部ライブラリは使わない。
> 担当：設計 Claude Opus／シミュレーション・UI Claude Sonnet／描画・音・アセット Codex

---

## 0. 前提と未確認事項

- 作業場所は `Game/Emberveil/` だけ。既存作品（LuminaIsle）は参照・流用しない。
- **共通 CSS（`../../css/common-style.css`）はまだ中身を確認できていない。** 設計時のツール制限で作業ディレクトリの外を読めなかったため。UI 担当（Sonnet）は `game.css` を書く前に必ず読み、§16 の方針で上書きする範囲を確定すること。
- この設計書に出てくる数値はすべて**設計上の目標値**。プレイ時間 30〜90 分も狙いであり、計測した結果ではない。
- 用語：「タイル」は 1 マス（16px の元絵）。座標の単位はタイルで、`x` は右、`y` は下が正。角度はラジアンで、0 が東、時計回りが正。

---

## 1. ゲーム概要

### 1.1 コンセプト
地下深くにある庭園「深庭（ふかにわ）」を温めていた炉心が消えた。最後の灯守（ひもり／Lamplighter）であるプレイヤーは、灯の祠で目を覚ます。苔庭・結晶洞・灼熱遺跡を掘り進み、炎を封じたまま歪んでしまった三体の守護者を鎮めて三つの核を集め、炉心を再び灯す。エンディングのあとは、明るくなった深庭で自由に建築を続けられる。

### 1.2 体験の柱
1. **灯りが安全地帯になる**：敵は暗闇で湧く。松明や灯籠を置いた場所は敵が湧かない拠点になり、作物も育つ。灯りを広げることが前進そのもの。
2. **濃密で迷わない進行**：目標チェーン、目標方向の矢印、予告付きのボス戦がある。ソフトロック（詰み）しないことを構造で保証する。
3. **静かで美しい洞窟**：湿った岩、青緑に光る菌、温かな灯火、水面に映る金色の反射、奥行きのあるパララックス、漂う粒子。

### 1.3 ゲームループ
探索（暗闇・敵・資源） → 採集・採掘 → 拠点でクラフト・料理・農業・釣り → 装備のティアを上げる → 封印門・ボス → 次のバイオームへ。

### 1.4 進行の骨格（線形・寄り道あり）

| 段階 | 場所 | 主な目的 | 推奨装備 | 目標時間（設計値） |
|---|---|---|---|---|
| 序 | 灯の祠（中央） | 道具・焚き火・作業台 | 石 | 5〜10分 |
| 1 | 苔庭 MOSS GARDEN | 銅装備 → 守護者モルグ | 銅（T2） | 10〜25分 |
| 2 | 結晶洞 CRYSTAL HOLLOW | 結晶装備・橋 → 守護者プリズマ | 結晶（T3） | 10〜25分 |
| 3 | 灼熱遺跡 SCORCHED RUINS | 耐熱・灼鋼 → 守護者イグナル | 灼鋼（T4） | 10〜30分 |
| 結 | 祠 | 炉心に三つの核を捧げる → エンディング | — | — |
| 後 | 全域 | 自由建築 | — | 無制限 |

---

## 2. ファイル構成と担当

```
Game/Emberveil/
  index.html     … Sonnet（DOM骨格）
  game.css       … Sonnet（共通CSSの限定的上書き）
  data.js        … Sonnet（定義のみ。ロジック禁止）
  world.js       … Sonnet（ワールド生成・シミュレーション・保存・検証）
  ui.js          … Sonnet（DOM UI・メニュー・HUD・タッチボタン・地図）
  main.js        … Sonnet（起動・入力・固定ステップ・App統括）
  render.js      … Codex（Canvas描画・カメラ・粒子・光・パララックス）
  audio.js       … Codex（WebAudio。合成音を推奨）
  assets/        … Codex（スプライト等。読み込みに失敗しても動くこと）
  DESIGN.md      … 本書
```

- モジュールは ES Modules（`<script type="module" src="./main.js">`）。GitHub Pages 上で動けばよく、`file://` での直接起動は対象外。
- 依存方向（循環禁止）：
  - `data.js` ← 全員が読む
  - `world.js` → `data.js`
  - `ui.js` → `data.js`。`world.js` のクラスは型として引数で受け取るだけ
  - `render.js` / `audio.js` → `data.js` のみ。`game` はコンストラクタ引数か `update` 引数で受け取る
  - `main.js` → 全モジュール
- **sim は描画・音・DOM を一切知らない。** sim から外への通知はイベントログ（§13.6）だけで行う。
- `data.js` のキー（item/object/tile/enemy/boss/sound 名）は**担当間の契約**。変更するときは本書を更新し、追加は末尾に限る。
- `data.js` は `Object.freeze` で再帰的に凍結して export する。

---

## 3. 世界観・テキスト

### 3.1 固有名詞

| 日本語 | 英語 | 説明 |
|---|---|---|
| 残り火の深庭 | EMBERVEIL | タイトル |
| 深庭 | The Deep Garden | 舞台全体 |
| 灯守 | Lamplighter | プレイヤー |
| 灯の祠 | Hearth Shrine | 中央の拠点。固定レイアウト |
| 炉心 | The Hearthcore | 祠の中心。消えた炉 |
| 苔庭 | MOSS GARDEN | 中央円盤のバイオーム |
| 結晶洞 | CRYSTAL HOLLOW | 西側のバイオーム |
| 灼熱遺跡 | SCORCHED RUINS | 東側のバイオーム |
| 苔の核 | Verdant Ember | 守護者1の報酬（鍵） |
| 晶の核 | Prism Ember | 守護者2の報酬（鍵） |
| 灼の核 | Cinder Ember | 守護者3の報酬（鍵） |
| 遺灰袋 | Ember Satchel | 死亡時に落とす袋 |

### 3.2 導入テキスト（新規開始時。スキップ可）
1. 深庭は、かつてひとつの炉心に温められていた。 / *The Deep Garden was once warmed by a single Hearthcore.*
2. 三体の守護者は炎を分かち、封じたまま、長い眠りのうちに歪んでしまった。 / *Three guardians sealed its flame — and twisted in their long sleep.*
3. 最後の灯守よ。残り火を集め、炉心をふたたび灯せ。 / *Last Lamplighter, gather the embers. Light the Hearth again.*

### 3.3 エンディングテキスト
1. 三つの核が炉心に還り、深庭に朝のような光が満ちた。 / *The embers return, and light like morning fills the Garden.*
2. 苔は息を吹き返し、結晶は歌い、遺跡の炉は静かに眠る。 / *The moss breathes, the crystals sing, the old furnaces rest.*
3. ここはもう、あなたの庭だ。 / *This garden is yours now.*

### 3.4 UI の言語
- 画面見出しは「日本語 — ENGLISH」の形式（例：「持ち物 — INVENTORY」）。英語は字間を広げた小さめの大文字で、補助色にする。
- `data.js` のすべての定義に `name`（日本語）と `en`（英語）を持たせる。図鑑・ボス名・バイオーム名の表示では英語を副題として並べる。

---

## 4. ワールド生成

### 4.1 基本
- サイズは **128×128**。外周 3 タイルは基盤岩（破壊不可）。
- 各レイヤーは `Uint8Array(16384)`。インデックスは `idx = y*128 + x`。
- **seed** は文字列（1〜32 文字。制御文字は除去）。数値に変換するときは FNV-1a 32bit を使う（`hashSeed(str)`）。
- 乱数は `mulberry32`。生成の各段階で `rngFor(tag) = mulberry32(hashSeed(seed + ':' + tag))` のように**段ごとに独立した乱数列**を使い、ある段を変えても他の段に影響が波及しないようにする。
- ノイズは seed 付きの値ノイズで、fbm 3 オクターブ。
- 同じ seed と同じ `GEN_VERSION` からは完全に同じワールドが生成される。`Math.random` は生成でもシミュレーションでも使用禁止。
- 新規開始時の seed 欄の既定値はランダムなコード（例 `MOSS-4821`）。初回プレイ向けのおすすめ固定 seed として **`HEARTH`** ボタンを置く。

### 4.2 生成手順（`generateWorld(seedStr)`）

1. **バイオーム**：`n = fbm(x/24, y/24)`（-1..1）、`d = hypot(x-64, y-64) + n*5`。
   - `d < 34` → 苔庭(1)
   - それ以外で `x + n*3 < 64` → 結晶洞(2)、それ以外 → 灼熱遺跡(3)
   - 祠スタンプと苔庭アリーナの外接矩形（+2 マージン）は強制的に苔庭にする。
2. **基本地形**：壁はバイオームごとの基岩（苔庭 `rock_wall`、結晶洞 `hard_rock`、灼熱遺跡 `burnt_rock`）。床はバイオームの基本床。
3. **洞窟**：`fbm(x/10, y/10) > 閾値`（苔庭 -0.05、結晶洞 0.00、灼熱遺跡 -0.02）の場所を開ける。その後セルオートマトンを 3 回（周囲 8 マスの壁が 5 以上なら壁、3 以下なら空き）。苔庭では、空きに接する壁のうち `fbm2 > 0.3` を `loam_wall`（素手で掘れる土壁）にする。
4. **バイオーム境界**：Chebyshev 距離 1 以内に別のバイオームがあるタイルを `seal_stone`（破壊不可）にする。結晶洞と灼熱遺跡も直接はつながらない。外周 3 タイルは `bedrock`。
5. **アンカー**（すべて `world.anchors` に保存）：
   - 祠中心は `(64,64)` 固定。開始地点は `(64,66)`。
   - 苔庭アリーナ中心：`rngFor('anchor')` で北 `(64+jx, 40)` か南 `(64+jx, 88)` を選ぶ。`jx ∈ [-8,8]`。
   - 結晶門：祠から西へ行の `y = 64+j`（`j ∈ [-6,6]`）を走査し、最初にぶつかる境界帯に 3 タイル幅で置く。
   - 灼熱門：同様に東へ走査する。
   - 結晶洞アリーナ中心：北西 `(18+jx, 22+jy)` か南西 `(18+jx, 106+jy)`。`jx, jy ∈ [-3,3]`。
   - 灼熱遺跡アリーナ中心：北東 `(110+jx, 22+jy)` か南東 `(110+jx, 106+jy)`。
6. **スタンプ**：祠（§4.3）と、アリーナ 15×15（§4.4）を上書きで配置する。スタンプのタイルには `flags.protected` を立てる。
7. **通路**：次の 5 区間を A* でつなぎ、幅 3 で掘る。コストは `1 + fbm*3` とし、適度に蛇行させる。`seal_stone` は門とアリーナ入口以外は通れない。掘った通路のタイルには `flags.corridor` を立てる。
   - 祠 → 苔庭アリーナ入口
   - 祠 → 結晶門 → 結晶洞アリーナ入口
   - 祠 → 灼熱門 → 灼熱遺跡アリーナ入口
8. **意図的な障害**：
   - 結晶門 → アリーナ通路の 40% と 75% 地点に、通路と直交する**幅 2 の裂け目帯**を置く。帯は両側へ壁にぶつかるか 12 タイルに達するまで伸ばす。必要な橋は合計 4 枚。
   - 灼熱門 → アリーナ通路の 50% 地点に**幅 2 の溶岩帯**を置く。必要な石橋は 2 枚。
   - 周囲の壁を掘って迂回してもよい。正解ルートは 1 つに限らない。
9. **液体**：
   - 苔庭：池を 6〜10 個。
   - 結晶洞：地底湖 1 つと、`|fbm| < 0.04` の筋状の裂け目。
   - 灼熱遺跡：`|fbm| < 0.05` の溶岩の川と、温泉 3〜5 個。
   - 通路（意図的な障害を除く）とスタンプには液体を置かない。
10. **鉱脈**：空きから 2 タイル以内にある壁を対象に、クラスタ化したノイズで置換する。置換率は次のとおり。
    - 苔庭：銅 4%、石炭 3%
    - 結晶洞：結晶 5%、石炭 1.5%、銅 1%
    - 灼熱遺跡：灼鉱 5%、黒曜岩 3%、石炭 2%
11. **自然物**（空き床に置く。スタンプは除外。**移動を妨げる物は通路タイルに置かない**）：
    - 苔庭：巨大茸 5%、光茸 4%、苔草 6%、瓦礫 1%、野生灯芋 0.8%、野生苔麦 0.6%
    - 結晶洞：晶花 3%、光茸 2%、巨大茸 1.5%、野生苔麦 0.6%
    - 灼熱遺跡：瓦礫 2%、野生炎唐辛子 0.8%、巨大茸 0.5%
12. **保証の補填**（§4.5）。
13. **検証**（§4.6）。失敗したら L 字の直線通路で強制的に補修し、再検証する。補修した通路は構造上必ず条件を満たす。
14. 戻り値：`{world, report}`。`report` には各保証の実数・補修の有無・必要な橋の数を入れる（デバッグ表示用）。

### 4.3 灯の祠スタンプ（17×17、左上が (56,56)。全 seed で同一）

凡例：`,` 苔床／`.` 祠の床／`#` 岩壁／`o` 銅鉱脈／`k` 石炭脈／`T` 巨大茸／`g` 光茸／`f` 苔草／`R` 瓦礫／`u` 野生灯芋／`w` 水／`t` 祠の松明（保護）／`S` 古い収納箱（保護）／`C` 炉心アンカー（2×2、`c` は炉心が占有するセル）

```
r0  ##,,T,,,,,,,T,,##
r1  #o,,,,,g,,,,,,,k#
r2  ,,,R,,,,,,,,,R,,,
r3  T,,,,.......,,,,T
r4  ,,,,.t.....t.,,,,
r5  ,f,,.........,,f,
r6  ,,,,....S....,,,,
r7  ,,u,...Cc....,u,,
r8  ,,,,...cc....,,,,
r9  ,,,,.........,,,,
r10 ,f,,.........,,f,
r11 T,,,.t.....t.,,,T
r12 ,,,,,.......,,,,,
r13 ,,R,,,,,,,,,,,R,,
r14 ,www,,,,,,,,,g,,,
r15 ,www,,,,,,,,,,,,,
r16 ##,,T,,,,,,,T,,##
```

- 炉心は (63,63)〜(64,64)。開始地点は (64,66)。古い収納箱は (64,62)。
- **配置禁止（protected）**：炉心とその周囲 1 マス（4×4）、収納箱、祠の松明 4 本、開始地点 (64,66)、瓦礫 4 か所。祠のそれ以外は自由に建築できる。
- 古い収納箱の中身：`torch ×4`、`roast_glowcap ×3`、`capwood ×4`。
- 祠の松明 4 本は点灯済みで、撤去できない。祠中心から半径 14 タイルは敵が湧かない。
- 池は 6 タイル（r14〜r15 の 1〜3 列）。最初の釣り場になる。

### 4.4 アリーナスタンプ（15×15）
- 外周 1 マスは `seal_stone`。通路に面した辺の中央に幅 3 の入口がある。内側 13×13 は床。中央に `altar`（祭壇。ボスの出現点で、移動を妨げない）を置く。
- 全タイルに `flags.arena` と `flags.protected` を立てる（設置・採掘・撤去は不可）。
- 結晶洞アリーナ：中心から (±4, ±4) の 4 か所に `seal_stone` の柱を置く（光線を遮る）。
- 灼熱遺跡アリーナ：内側の局所座標 `lx, ly`（0..12）が両方とも奇数のタイルを `vent`（噴気口）にする（計 36 マス）。グループ A は `(lx+ly)%4==2`、グループ B は `(lx+ly)%4==0`。

### 4.5 資源保証（不足した分は `rngFor('guarantee')` の決定的な候補順で補う）

| 範囲 | 保証内容 |
|---|---|
| 祠リング（祠中心から距離 9〜18、スタンプ外） | 巨大茸 ≥10、光茸 ≥8、苔草 ≥8、瓦礫 ≥4、露出した銅鉱脈 ≥6、露出した石炭脈 ≥4、露出した土壁 ≥8、野生灯芋 ≥2、野生苔麦 ≥2 |
| 結晶門の内側 14 タイル以内（最初の裂け目より手前） | 結晶脈 ≥6、石炭脈 ≥3、巨大茸 ≥4、晶花 ≥3、釣りができる水 ≥4 |
| 灼熱門の内側 14 タイル以内（溶岩帯より手前） | 灼鉱脈 ≥6、黒曜岩 ≥4、石炭脈 ≥4、巨大茸 ≥3、温泉 ≥4、瓦礫 ≥3 |
| バイオーム全体 | 苔庭：銅 ≥45・石炭 ≥30／結晶洞：結晶 ≥45・石炭 ≥15／灼熱遺跡：灼鉱 ≥45・黒曜岩 ≥25・石炭 ≥15／全域：巨大茸 ≥120 |

- 「露出」は 4 近傍に歩行可能な床があること。
- 補填の手順：候補タイルを「距離 → タイル番号のハッシュ」で並べ、先頭から必要数だけ置き換える。

### 4.6 生成時の検証（ソフトロック対策の一部）
0-1 BFS で次を確かめる。歩行可能タイルはコスト 0。採掘で通れる壁（硬度 ≤ 区間ごとの想定ティア）はコスト 0 で通過可。橋を架けられる液体はコスト 1。`seal_stone`・`bedrock` は通れない。門は「開いている」とみなす。

| 区間 | 想定ティア | 橋の上限 |
|---|---|---|
| 祠 → 苔庭アリーナ | T1 | 0 |
| 祠 → 結晶門 | T1 | 0 |
| 結晶門 → 結晶アリーナ | T2 | 6 |
| 祠 → 灼熱門 | T1 | 0 |
| 灼熱門 → 灼熱アリーナ | T3 | 6 |

条件を満たさない区間があれば、§4.2-13 のとおり補修する。

---

## 5. タイル・オブジェクト定義

タイル ID は `data.js` 配列のインデックス。**末尾追加のみ。並べ替え禁止。**

### 5.1 地面レイヤー `ground`

| id | key | 名前 / EN | 歩行 | 液体 | 釣り | 架橋 | 足音 |
|---|---|---|---|---|---|---|---|
| 0 | void | — | × | — | — | — | — |
| 1 | moss_floor | 苔床 / Moss Floor | ○ | — | — | — | moss |
| 2 | loam_floor | 土の床 / Loam Floor | ○ | — | — | — | moss |
| 3 | stone_floor | 岩床 / Stone Floor | ○ | — | — | — | stone |
| 4 | crystal_floor | 晶床 / Crystal Floor | ○ | — | — | — | crystal |
| 5 | ash_floor | 灰床 / Ash Floor | ○ | — | — | — | ash |
| 6 | ruin_floor | 遺跡の石畳 / Ruin Tiles | ○ | — | — | — | stone |
| 7 | shrine_floor | 祠の床 / Shrine Floor | ○ | — | — | — | stone |
| 8 | vent | 噴気口 / Vent | ○ | — | — | — | stone |
| 9 | water | 水 / Water | × | water | ○ | 木・石 | — |
| 10 | hot_spring | 温泉 / Hot Spring | × | water | ○ | 木・石 | — |
| 11 | chasm | 裂け目 / Chasm | × | chasm | — | 木・石 | — |
| 12 | lava | 溶岩 / Lava | × | lava | — | 石のみ | — |

液体はすべて通行不可。プレイヤーが液体に入る状況は衝突判定上起こらない。溶岩・水は飛行する敵だけが越えられる。

### 5.2 壁レイヤー `wall`

| id | key | 名前 / EN | 硬度 | 耐久 | 産出 | 備考 |
|---|---|---|---|---|---|---|
| 0 | none | — | — | — | — | |
| 1 | loam_wall | 土壁 / Loam Wall | 0 | 3 | loam 1 | 素手で掘れる |
| 2 | rock_wall | 岩壁 / Rock | 1 | 6 | stone 1 | |
| 3 | copper_vein | 銅鉱脈 / Copper Vein | 1 | 8 | copper_ore 2〜3 | |
| 4 | coal_vein | 石炭脈 / Coal Seam | 1 | 8 | coal 2〜3 | |
| 5 | hard_rock | 硬岩 / Hard Rock | 2 | 10 | stone 1 | 結晶洞の基岩 |
| 6 | crystal_vein | 結晶脈 / Prism Vein | 2 | 12 | crystal 2〜3 | 弱く発光 |
| 7 | burnt_rock | 焼岩 / Burnt Rock | 2 | 12 | stone 1 | 灼熱遺跡の基岩 |
| 8 | obsidian_rock | 黒曜岩 / Obsidian | 3 | 14 | obsidian 1 | |
| 9 | ember_vein | 灼鉱脈 / Ember Vein | 3 | 16 | ember_ore 2〜3 | 発光 |
| 10 | bedrock | 基盤岩 / Bedrock | ∞ | — | — | 外周 |
| 11 | seal_stone | 封印岩 / Sealstone | ∞ | — | — | 境界・アリーナ・柱 |
| 12 | gate_crystal | 結晶の封印門 / Prism Seal | ∞ | — | — | 苔の核で開く |
| 13 | gate_ember | 灼熱の封印門 / Cinder Seal | ∞ | — | — | 晶の核で開く |
| 14 | arena_barrier | 守護者の結界 / Ward | ∞ | — | — | 戦闘中だけ入口に出る |
| 15 | wall_wood | 菌木の壁 / Capwood Wall | 0 | 6 | 撤去で回収 | 設置物 |
| 16 | wall_stone | 石の壁 / Stone Wall | 0 | 10 | 撤去で回収 | 設置物 |
| 17 | wall_glass | 結晶ガラスの壁 / Prism Glass | 0 | 6 | 撤去で回収 | 設置物・光を通す |
| 18 | wall_brick | 灼煉瓦の壁 / Cinder Brick | 0 | 12 | 撤去で回収 | 設置物 |
| 19 | wall_gold | 金縁の壁 / Gilded Wall | 0 | 12 | 撤去で回収 | 設置物・エンディング後 |

- **採掘のルール**：ツルハシのティア < 硬度 なら掘れない（トースト「硬すぎる — ○○のツルハシが必要」とイベント `mineBlocked`）。1 回の振りで `power` ぶん耐久が減る。0 になったら壊れて産出物を落とす。
- 削り途中の耐久は `world.wallDamage` に入れ、5 秒間攻撃がなければ元に戻る。
- 産出数の幅（2〜3 など）は sim 乱数（`game.rngState`）で決める。
- 設置物の壁（15〜19）はツルハシで壊すか、撤去（R）で 100% 回収できる。

### 5.3 建築レイヤー `build`

| id | key | 名前 / EN | 置ける場所 |
|---|---|---|---|
| 0 | none | — | — |
| 1 | floor_wood | 菌木の床 / Capwood Floor | 歩行可能な地面 |
| 2 | floor_stone | 石畳 / Flagstone | 同上 |
| 3 | floor_crystal | 晶タイル / Prism Tile | 同上 |
| 4 | floor_brick | 灼煉瓦の床 / Cinder Floor | 同上 |
| 5 | floor_gold | 金縁の床 / Gilded Floor | 同上（エンディング後） |
| 6 | bridge_wood | 木橋 / Capwood Bridge | water / hot_spring / chasm |
| 7 | bridge_stone | 石橋 / Stone Bridge | water / hot_spring / chasm / lava |

橋の上は歩行できる。床は見た目と足音が変わるだけで、効果はない。

### 5.4 オブジェクト（`world.objects`。1 タイル 1 個。炉心だけ 2×2）

| key | 名前 / EN | 塞ぐ | 種別 | 状態フィールド | 光 |
|---|---|---|---|---|---|
| cap_tree | 巨大茸 / Capgiant | ○（切り株×） | 伐採 hp8 | `stump, regrowT` | — |
| glowcap | 光茸の群れ / Glowcap Patch | × | 採集 | `spent, regrowT` | teal r3 s0.55 |
| moss_grass | 苔草 / Moss Tuft | × | 採集 | `spent, regrowT` | — |
| rubble | 瓦礫 / Rubble | ○（spent×） | 採掘 hp4 | `spent, regrowT` | — |
| crystal_cluster | 晶花 / Prism Bloom | ○ | 採掘 hp6 | `spent, regrowT` | crystal r4 s0.6 |
| wild_tuber | 野生の灯芋 / Wild Glow Tuber | × | 採集 | `spent, regrowT` | — |
| wild_grain | 野生の苔麦 / Wild Moss Grain | × | 採集 | `spent, regrowT` | — |
| wild_pepper | 野生の炎唐辛子 / Wild Ember Pepper | × | 採集 | `spent, regrowT` | — |
| sapling | 茸の幼体 / Cap Sprout | × | 成長 180s で cap_tree | `growT` | — |
| core | 炉心 / Hearthcore | ○ | 調べる | `restored` | 再生後 gold r14 s1.4 |
| altar | 守護者の祭壇 / Guardian Altar | × | 調べる（伝承） | `boss` | 撃破後 r4 |
| satchel | 遺灰袋 / Ember Satchel | × | 回収 | `items[]` | ember r2 s0.4 |
| workbench | 作業台 / Workbench | ○ | ステーション | — | — |
| campfire | 焚き火 / Campfire | ○ | ステーション | — | warm r7 s1.1 |
| furnace | 炉 / Furnace | ○ | ステーション | — | ember r4 s0.6 |
| cookpot | 料理台 / Cookpot | ○ | ステーション | — | — |
| planter | 苗床 / Planter | ○ | 農業 | `crop, growT, stage` | — |
| chest | 収納箱 / Chest | ○ | 収納 16 枠 | `items[16], starter` | — |
| bed | ベッド / Bed | ○ | 睡眠・復活地点 | — | — |
| torch | 松明 / Torch | × | 照明 | `shrine` | warm r6 s1.0 |
| lamp_brass | 真鍮の灯籠 / Brass Lantern | ○ | 照明 | — | gold r8 s1.0 |
| lamp_crystal | 晶灯 / Prism Lamp | ○ | 照明 | — | crystal r9 s1.0 |
| brazier | 灼鋼の篝火 / Cinder Brazier | ○ | 照明 | — | ember r10 s1.2 |
| table | 菌木の机 / Capwood Table | ○ | 装飾 | — | — |
| stool | 菌木の椅子 / Capwood Stool | × | 装飾 | — | — |
| moss_pot | 苔の鉢 / Moss Pot | × | 装飾 | — | teal r2 s0.3 |
| banner_moss | 苔冠の旗 / Moss-Crown Banner | × | 装飾 | — | — |
| banner_crystal | 聖歌の旗 / Choir Banner | × | 装飾 | — | — |
| banner_ember | 火夫の旗 / Stoker Banner | × | 装飾 | — | — |
| core_model | 炉心の模型 / Hearth Model | ○ | 装飾 | — | gold r5 s0.7 |

- 「塞ぐ ○」は移動を妨げる（衝突判定は 1 タイル全体）。
- 自然物の再生時間（秒）：巨大茸 300、光茸 180、苔草 240、瓦礫 150、晶花 400、野生植物 360。再生する位置にプレイヤー・敵・設置物があるときは再生を延期する（2 秒ごとに再判定）。
- 光の色は `warm | teal | crystal | ember | gold` の 5 種。

---

## 6. アイテム

### 6.1 共通
- スタック上限：素材 99／種 99／設置物 99（家具系は 20）／食料・魚 20／薬 10／道具・武器・防具 1。
- **耐久度はない**（煩雑さを避け、紛失による詰みを防ぐ）。
- 持ち物は 32 枠。0〜7 がホットバー、8〜31 がバックパック。防具枠が別に 1 つある。
- **鍵アイテム（三つの核）は持ち物に入らない。** `progress.hearts` に記録され、捨てる・預ける・死亡で落とすことはできない。

### 6.2 素材

| key | 名前 / EN | 主な入手 |
|---|---|---|
| capwood | 菌木材 / Capwood | 巨大茸 4 |
| stone | 石 / Stone | 岩壁・瓦礫 2 |
| loam | 苔土 / Moss Loam | 土壁 |
| fiber | 苔繊維 / Moss Fiber | 苔草 2 |
| glowcap | 光茸 / Glowcap | 光茸の群れ 2（食べられる・植えられる） |
| gel | 菌粘液 / Spore Gel | スライム・蛾 |
| chitin | 甲殻 / Chitin | ダニ・甲虫・トカゲ |
| copper_ore | 銅鉱石 / Copper Ore | 銅鉱脈・瓦礫 20% |
| coal | 石炭 / Coal | 石炭脈・瓦礫 15%・炭焼き |
| copper_ingot | 銅インゴット / Copper Ingot | 炉 |
| crystal | 結晶片 / Prism Shard | 結晶脈・晶花 1 |
| obsidian | 黒曜石 / Obsidian | 黒曜岩・亡者 50% |
| ember_ore | 灼鉱石 / Ember Ore | 灼鉱脈・亡者 30% |
| emberite | 灼鋼インゴット / Emberite Ingot | 炉 |
| cap_spore | 茸の胞子 / Cap Spore | 伐採 30%（苔床・土の床に植えると幼体になる） |

**すべての素材は再生可能な入手経路を持つ**（§15）。

### 6.3 種と作物

| 種 key | 作物 | 成長（秒） | 収穫量 | 入手 |
|---|---|---|---|---|
| seed_tuber 灯芋の種芋 / Tuber Seed | tuber 灯芋 / Glow Tuber | 240 | 2〜3 + 種 1（30% でさらに +1） | 野生灯芋 |
| seed_grain 苔麦の種 / Grain Seed | grain 苔麦 / Moss Grain | 300 | 3〜4 + 種 1（30% +1） | 野生苔麦（種 2） |
| seed_pepper 炎唐辛子の種 / Pepper Seed | pepper 炎唐辛子 / Ember Pepper | 360 | 2 + 種 1（30% +1） | 野生炎唐辛子 |
| glowcap（そのまま植える） | glowcap | 180 | 3（種の返却なし） | — |

### 6.4 魚（タグ `fish`）

| key | 名前 / EN | 水域 | 重み |
|---|---|---|---|
| fish_trout | 洞ヤマメ / Cave Trout | 苔庭の水 | 55 |
| fish_lumen | 光鱗魚 / Lumenscale | 苔庭の水 | 42 |
| fish_shrimp | 霧エビ / Mist Shrimp | 結晶洞の水 | 55 |
| fish_catfish | 水晶ナマズ / Prism Catfish | 結晶洞の水 | 42 |
| fish_eel | 熱泉ウナギ / Spring Eel | 温泉 | 55 |
| fish_carp | 灰鱗鯉 / Ashscale Carp | 温泉 | 42 |
| fish_golden | 黄金の残り火魚 / Golden Emberfin | 全水域 | 3（晶の核を得た後のみ。それ以前は 0） |

水域は、釣り糸を垂らしたタイルの `biome` で決まる。

### 6.5 食料・薬

| key | 名前 / EN | 空腹 | HP | バフ | 作り方 |
|---|---|---|---|---|---|
| glowcap | 光茸 | +8 | +2 | — | 生 |
| tuber | 灯芋 | +10 | +3 | — | 生 |
| grain | 苔麦 | +4 | 0 | — | 生 |
| pepper | 炎唐辛子 | +3 | 0 | — | 生 |
| fish_*（金以外） | 生魚 | +8 | +2 | — | 生 |
| fish_golden | 黄金の残り火魚 | +10 | +10 | — | 生 |
| roast_glowcap | 焼き光茸 / Roast Glowcap | +18 | +6 | — | 焚き火 |
| roast_tuber | 焼き灯芋 / Roast Tuber | +26 | +8 | — | 焚き火 |
| roast_fish | 焼き魚 / Grilled Fish | +24 | +10 | — | 焚き火 |
| bread | 苔麦パン / Moss Bread | +36 | +12 | — | 料理台 |
| stew | 洞窟シチュー / Cavern Stew | +50 | +25 | 再生 60s | 料理台 |
| jelly | 霜晶ゼリー / Frostprism Jelly | +14 | +4 | 耐熱 300s | 料理台 |
| pepper_fish | 炎唐辛子の焼き魚 / Ember Fish | +36 | +12 | 活力 120s | 料理台 |
| golden_feast | 黄金の宴 / Golden Feast | 全回復 | 全回復 | 再生・耐熱・活力 各 180s | 料理台 |
| salve | 癒しの灯薬 / Lamp Salve | 0 | +40 | — | 料理台（使用後 1.5s のクールダウン） |

- 食事は 0.6 秒の動作で、その間は移動速度 ×0.5。空腹も HP も満タンのときは食べない（トースト）。
- バフ：
  - 再生 regen：HP +1/s
  - 耐熱 heat：灼熱のペナルティを無効化
  - 活力 vigor：スタミナ回復 ×1.5
  - 安眠 rested：空腹の減少 ×0.7、180s（睡眠で付与）
- 同時にかかるバフは最大 5 種。同じバフを重ねたら残り時間を最大値で上書きする。

### 6.6 道具・武器・防具（ティア表）

ティア：T1 石 → T2 銅 → T3 結晶 → T4 灼鋼。

**ツルハシ（pick）**

| key | 名前 / EN | 採掘ティア | power | 振り(s) |
|---|---|---|---|---|
| （素手） | — | 0 | 1 | 0.35 |
| pick_stone | 石のツルハシ / Stone Pick | 1 | 2 | 0.32 |
| pick_copper | 銅のツルハシ / Copper Pick | 2 | 3 | 0.30 |
| pick_crystal | 結晶のツルハシ / Prism Pick | 3 | 4 | 0.28 |
| pick_ember | 灼鋼のツルハシ / Emberite Pick | 3 | 6 | 0.26 |

**斧（axe）**：素手 power 1、石 3、銅 4、結晶 5、灼鋼 7。振りはツルハシと同じ。巨大茸は hp 8 なので、素手でも 8 回で切れる（詰み防止）。

**剣（sword）**

| key | 名前 / EN | 攻撃 | 振り(s) | スタミナ | 射程 | 弧 | 貫通 | 特殊 |
|---|---|---|---|---|---|---|---|---|
| （素手） | — | 3 | 0.35 | 6 | 1.2 | 90° | 0 | — |
| sword_stone | 石の剣 / Stone Blade | 10 | 0.45 | 8 | 1.5 | 110° | 0 | — |
| sword_copper | 銅の剣 / Copper Blade | 16 | 0.42 | 8 | 1.5 | 110° | 0 | — |
| sword_crystal | 結晶の剣 / Prism Blade | 26 | 0.40 | 9 | 1.6 | 110° | 2 | — |
| sword_ember | 灼鋼の剣 / Emberite Blade | 40 | 0.40 | 10 | 1.6 | 120° | 3 | 燃焼 3dps × 3s |

- ツルハシ・斧を武器として振った場合、攻撃は同ティアの剣の 50%（切り捨て）、スタミナは剣と同じ。
- **連撃**：振りの終了から 0.35 秒以内に次を振ると連撃が続く。3 段目は攻撃 ×1.4、ノックバック ×2。
- 当たり判定は振り開始から 40% の時点で一度だけ行い、扇形の内側の敵すべてに当たる。

**防具（armor）**

| key | 名前 / EN | 防御 | 特性 |
|---|---|---|---|
| armor_moss | 苔布の衣 / Mosscloth Garb | 2 | — |
| armor_copper | 銅の鎧 / Copper Mail | 5 | — |
| armor_crystal | 結晶の鎧 / Prism Plate | 9 | 耐熱 |
| armor_ember | 灼鋼の鎧 / Emberite Plate | 14 | 耐熱・燃焼無効 |

**その他**：`fishing_rod` 釣竿 / Fishing Rod。

### 6.7 ダメージ式
- 被ダメージ：`final = max(ceil(raw*0.25), raw - def) × 難易度倍率`。最低 1。
- 与ダメージ：`max(1, atk - max(0, enemyDef - pierce))`。
- 燃焼は防御を無視して 1 秒ごとに入る。燃焼無効なら効かない。

---

## 7. プレイヤー

### 7.1 ステータスと数値（`DATA.BALANCE.player`）

| 項目 | 値 |
|---|---|
| 移動速度 | 4.2 タイル/s（攻撃・食事中 ×0.5） |
| 当たり半径 | 0.30 |
| HP | 初期 100。核 1 つにつき +20（最大 160） |
| スタミナ | 100。回復 32/s（消費から 0.6s 後に開始） |
| 息切れ | スタミナ 0 で発生し、20 まで回復するまで攻撃・回避ができない |
| 空腹 | 最大 100、開始時 80。減少 0.1/s |
| 灼熱 | 灼熱遺跡で耐熱がないとき、空腹の減少 ×2・スタミナ回復 ×0.6。HUD に警告を出す |
| 飢餓 | 空腹 0 のとき HP -0.5/s、スタミナ回復 ×0.5 |
| HP 自然回復 | 空腹 ≥50 かつ 5s 被弾なし → 0.5/s。空腹 ≥80 → 1.0/s |
| 被弾後の無敵 | 0.6s。被ノックバック 0.4 タイル |
| 回避 | 0.28s で 2.6 タイル、無敵 0.22s、スタミナ 22、終了後 0.15s 再使用不可 |
| 採掘・伐採のスタミナ | 1 / 2（1 振りあたり） |
| 調べる距離 | 1.6（中心 → タイル中心） |
| ポインタ操作の距離 | 2.2 |
| ステーションの距離 | **3.5**（中心 → ステーションのタイル中心。ユークリッド距離） |
| 拾う距離 | 1.2。2.0 以内のドロップは 8 タイル/s で吸い寄せる |
| 手持ちの灯り | r3.5 s0.7（松明を選択中は r6 s1.0） |

### 7.2 狙う対象（`player.target`）
- 毎ステップ計算する。基本は向いている方向 1.0 タイル先の点を含むタイル。そこが操作対象でなければ、向きに近い順に左右の隣接タイルを試す。
- ポインタで指定した場合は、そのタイルが優先される（距離 2.2 以内）。
- 種別：`enemy | wall | object | water | ground | build`。`label`（対象名）と `action`（§12.3 の動詞キー）を持つ。

### 7.3 主行動（J / Space / タップ）の解決順（道具の自動切替が ON のとき）
1. 選択中が「設置物・食料・薬・種・釣竿」なら、その使用（設置・食事・植える・投げる）。
2. 前方の弧の中、射程内に敵がいれば、**持ち物の中で最良の武器**で攻撃する（選択スロットは変えない）。
3. 対象が採掘できる壁・瓦礫・晶花なら最良のツルハシ。
4. 対象が巨大茸なら最良の斧。
5. 対象が採集物なら素手で採集（0.3s）。
6. それ以外は、選択中のアイテム（なければ素手）で空振り。

自動切替が OFF のときは、選択中のアイテムだけで判定する（対応しない対象は空振り）。

### 7.4 死亡と回収
- HP が 0 になると死亡演出（1.2s）が流れ、`mode='dead'` になる。
- **落とすのはバックパック（8〜31）の中身だけ。** ホットバー 8 枠と防具は手元に残るので、道具の紛失で閉じ込められることはない。
- 遺灰袋は世界に 1 つだけ。未回収の古い袋があれば、その中身を新しい袋に**統合**する（何も消えない）。袋の容量は 64 スタックで、同じアイテムはまとめる（アイテム定義の数を考えると溢れない）。
- 袋の置き場所：死亡地点から BFS で最も近い、歩行可能・非保護・非アリーナのタイル。アリーナ内で死んだ場合はアリーナ入口の外側。
- 復活地点：有効なベッドの隣の空きタイル。なければ祠の開始地点。
- 復活時の状態：HP は最大値の 50%、スタミナ満タン、空腹は `max(現在値, 40)`。復活地点から 10 タイル以内の敵は消す。
- 袋は消えない。地図にマーカーを出す。調べると全部持ち物へ戻し、入りきらない分は袋に残る。

### 7.5 帰還（灯へ帰る）
- ポーズメニューから実行する。4.0 秒の詠唱で、移動入力か被弾で中断。完了すると復活地点へ移動する。費用はなく、ボス戦中も使える（ボスはリセット）。
- **閉じ込め全般への最終手段。**

---

## 8. 建築・設置・撤去・収納

### 8.1 設置
- ホットバーで設置物を選び、主行動を押すと、狙っている前方タイル（またはポインタで指したタイル）に置く。
- 狙いのタイルには常にゴースト（`player.placePreview {x, y, item, valid}`）を表示する。
- 設置の条件：
  - 範囲内であること、`flags.protected` / `arena` / `noBuild` ではないこと
  - オブジェクト：歩行可能な地面か床の上で、壁・オブジェクト・遺灰袋がない
  - 壁・塞ぐオブジェクト：プレイヤーや敵の当たり円と重ならない
  - 床：歩行可能な地面で、建築レイヤーが 0（重ね置き不可）
  - 橋：液体の種類が対応していて、建築レイヤーが 0
- 置けない理由はトーストで出す（「ここには置けない」「水や裂け目の上にしか架けられない」など）。

### 8.2 撤去（R / 撤去ボタン）
- 自分で置いたオブジェクト・壁・床・橋が対象。**道具は不要**で、100% 回収する（持ち物が満杯なら足元にドロップ）。
- 中身のある収納箱は撤去できない。苗床に作物があれば、種を 1 つ返す。
- プレイヤーが上に立っている橋、敵が上にいる橋は撤去できない。
- 自然物・保護対象・遺灰袋は撤去できない。

### 8.3 収納箱
- 16 枠。調べると収納画面が開き、sim は停止する。
- 操作：選んで移す／全部入れる（バックパックのみ）／同じ物を入れる（箱に既にある種類だけ）／全部取る。
- 個数の上限は 64 箱（超えると設置を拒否し、トースト）。

### 8.4 ベッド
- 調べると睡眠。8 タイル以内に敵がいれば眠れない。
- 効果：1.5s 暗転 → HP・スタミナ全快、空腹 -15、ゲーム時間 +120s（作物・再生が進む）、復活地点をこのベッドに設定、安眠バフ、オートセーブ。
- 再び眠れるのは 60s 後。

---

## 9. クラフト

### 9.1 ルール
- 材料は**持ち物から**消費する（収納箱からは取らない）。
- ステーションは距離 3.5 以内にある種類だけ有効。`station: null` は手作業でどこでも作れる。
- クラフトは即時。×1／×5／最大 を選べる。完成品が入りきらなければ足元にドロップする。
- タグ材料（`#fish`）は、持ち物の先頭のスロットから順に消費する。
- `unlock` 付きのレシピは条件を満たすまで一覧に出さない。

### 9.2 レシピ表（id は基本的に出力の key と同じ）

**手作業（station: null）**

| id | 出力 | 材料 |
|---|---|---|
| workbench | 作業台 ×1 | capwood 6, stone 4 |
| campfire | 焚き火 ×1 | capwood 3, stone 3 |
| pick_stone | 石のツルハシ | capwood 3, stone 3 |
| axe_stone | 石の斧 / Stone Axe | capwood 3, stone 2 |
| sword_stone | 石の剣 | capwood 2, stone 4 |
| torch | 松明 ×2 | capwood 1, glowcap 1 |

**焚き火（campfire）**

| id | 出力 | 材料 |
|---|---|---|
| roast_glowcap | 焼き光茸 | glowcap 1 |
| roast_tuber | 焼き灯芋 | tuber 1 |
| roast_fish | 焼き魚 | #fish 1（金は除く） |

**作業台（workbench）**

| id | 出力 | 材料 | 解放 |
|---|---|---|---|
| chest | 収納箱 | capwood 8, stone 2 | |
| planter | 苗床 | capwood 4, loam 4 | |
| bed | ベッド | capwood 8, fiber 6 | |
| furnace | 炉 | stone 12, loam 4 | |
| cookpot | 料理台 | stone 6, copper_ingot 2, capwood 2 | |
| fishing_rod | 釣竿 | capwood 3, fiber 3 | |
| bridge_wood | 木橋 ×2 | capwood 3, fiber 1 | |
| bridge_stone | 石橋 ×2 | stone 4, copper_ingot 1 | |
| wall_wood | 菌木の壁 ×1 | capwood 1 | |
| floor_wood | 菌木の床 ×2 | capwood 1 | |
| wall_stone | 石の壁 ×1 | stone 1 | |
| floor_stone | 石畳 ×2 | stone 1 | |
| wall_glass | 結晶ガラスの壁 ×2 | crystal 1 | |
| floor_crystal | 晶タイル ×4 | crystal 1 | |
| wall_brick | 灼煉瓦の壁 ×2 | obsidian 1, stone 1 | |
| floor_brick | 灼煉瓦の床 ×4 | obsidian 1, stone 1 | |
| lamp_brass | 真鍮の灯籠 | copper_ingot 1, glowcap 2 | |
| lamp_crystal | 晶灯 | crystal 2, copper_ingot 1 | |
| brazier | 灼鋼の篝火 | emberite 1, stone 4 | |
| table | 菌木の机 | capwood 4 | |
| stool | 菌木の椅子 | capwood 2 | |
| moss_pot | 苔の鉢 | loam 2, fiber 2 | |
| armor_moss | 苔布の衣 | fiber 10, gel 3 | |
| pick_copper | 銅のツルハシ | copper_ingot 3, capwood 2 | |
| axe_copper | 銅の斧 / Copper Axe | copper_ingot 2, capwood 2 | |
| sword_copper | 銅の剣 | copper_ingot 4, capwood 1 | |
| armor_copper | 銅の鎧 | copper_ingot 6, fiber 4, chitin 2 | |
| pick_crystal | 結晶のツルハシ | crystal 5, copper_ingot 2 | |
| axe_crystal | 結晶の斧 / Prism Axe | crystal 4, copper_ingot 1 | |
| sword_crystal | 結晶の剣 | crystal 7, copper_ingot 2 | |
| armor_crystal | 結晶の鎧 | crystal 10, copper_ingot 3, chitin 4 | |
| pick_ember | 灼鋼のツルハシ | emberite 4, crystal 2 | |
| axe_ember | 灼鋼の斧 / Emberite Axe | emberite 3, crystal 1 | |
| sword_ember | 灼鋼の剣 | emberite 6, crystal 3, obsidian 2 | |
| armor_ember | 灼鋼の鎧 | emberite 7, obsidian 4, chitin 4 | |
| banner_moss | 苔冠の旗 | fiber 4, capwood 2 | boss_moss |
| banner_crystal | 聖歌の旗 | fiber 4, crystal 2 | boss_crystal |
| banner_ember | 火夫の旗 | fiber 4, obsidian 2 | boss_ember |
| floor_gold | 金縁の床 ×8 | emberite 1, stone 2 | core |
| wall_gold | 金縁の壁 ×4 | emberite 1, stone 2 | core |
| core_model | 炉心の模型 | emberite 2, crystal 2 | core |

**炉（furnace）**

| id | 出力 | 材料 |
|---|---|---|
| copper_ingot | 銅インゴット ×2 | copper_ore 3, coal 1 |
| emberite | 灼鋼インゴット ×1 | ember_ore 2, coal 1 |
| charcoal | 石炭 ×1 | capwood 3 |

**料理台（cookpot）**

| id | 出力 | 材料 |
|---|---|---|
| bread | 苔麦パン | grain 3 |
| stew | 洞窟シチュー | #fish 1, tuber 1, glowcap 1 |
| jelly | 霜晶ゼリー | crystal 1, gel 2, glowcap 1 |
| pepper_fish | 炎唐辛子の焼き魚 | pepper 1, #fish 1 |
| salve | 癒しの灯薬 | glowcap 2, gel 1 |
| golden_feast | 黄金の宴 | fish_golden 1, tuber 2, grain 2 |

### 9.3 必要量の目安（設計上の検算）
- 推奨ルート（銅のツルハシ・剣・鎧、料理台、結晶のツルハシ・剣・鎧）の銅インゴットは 22 本。銅鉱石 33（鉱脈 2〜3 個として約 13〜17 か所）と石炭 11 が要る。苔庭の銅 ≥45 か所は十分な余裕がある。
- 灼鋼の剣と鎧で灼鋼インゴット 13 本 → 灼鉱石 26（約 9〜13 か所）。灼熱遺跡の灼鉱 ≥45 か所で足りる。
- 必要な橋は木橋 4 枚（菌木材 6・苔繊維 2）と石橋 2 枚（石 4・銅 1）。

---

## 10. 農業・釣り・料理

### 10.1 農業
- 苗床に種を持って主行動、または調べると植える。種を持っていないときは、UI が種の選択ダイアログ（ボタン一覧）を開く → `game.plantAt(x, y, seedKey)`。
- 段階は 0〜3。成長時間を 3 等分して進む。**苗床タイルの `world.light` が 0.35 以上のときだけ成長**し、足りなければ苗床に「暗すぎる」アイコン（`planter.dark = true`）を出す。
- 段階 3 で調べると収穫（§6.3）。
- エンディング後は成長速度 ×1.5。睡眠による 120s の早送りも反映する。

### 10.2 釣り
1. 釣竿を選び、前方 2 タイル以内の水・温泉に向かって主行動 → 0.4s で投げる（`fishCast`）。
2. 待ち時間は 2.0〜6.0s（sim 乱数）。
3. 当たりの合図（`fishBite`、頭上に「！」）→ 受付は 0.9s（穏やかなら 1.3s）。受付中に主行動を押せば釣れる（`fishCatch`）。
4. 合図の前に押すと「早すぎた」となり、待ち時間を +1.0s してやり直し（`fishMiss {reason:'early'}`）。
5. 受付を過ぎると「逃げられた」で終了（`fishMiss {reason:'late'}`）。
6. 移動・被弾・メニューを開くと中断。
- タイミングを押すだけで、ドラッグやドット単位の精度は要らない。動き低減の設定でも合図は静止表示で分かる。

### 10.3 料理
§9.2 のとおり。焚き火は「キャンプ」として光・料理・安全地帯を兼ねる。料理台は銅を手に入れてからの上位調理。

---

## 11. 敵とボス

### 11.1 共通 AI
- **状態**：`idle → wander → chase → windup（予告） → attack → recover → (chase)`。ほかに `hurt` / `flee` / `return` / `dead`。
- **感知**：感知距離内で、タイルのレイキャストで視線が通ればプレイヤーを発見する。
- **経路**：プレイヤーを中心とする 41×41 の窓で BFS のフローフィールドを作る。作り直すのは 0.3s ごと、またはプレイヤーのタイルが変わったとき。地上用と飛行用の 2 枚を持ち、飛行用は液体を通れる。敵は勾配を下るように動く。
- **分離**：敵同士は半径 0.8 以内で押し返し合う。
- **光を避ける**：`lightFear` を持つ敵は `world.safeLight >= 0.6` のタイルに入らない。追跡中にそのようなタイルが行き先になったら、待機して周回する。
- **距離を保つ**：遠隔型の敵は理想距離を保ち、近づかれると後退し、横移動する。
- **回避行動**：`dodger` を持つ敵は、プレイヤーが 2 タイル以内で攻撃を振り始めると横に跳ぶ（クールダウン 3s）。
- **帰還**：住処から 18 タイル以上離れたか、プレイヤーを 5s 見失ったら、住処へ戻って全回復する。
- **接触ダメージはない。** ダメージは必ず予告付きの攻撃から発生する。
- **出現**：
  - 3.5s ごとに判定する。プレイヤーから 11〜18 タイル、プレイヤーと同じバイオーム、歩行可能、`world.safeLight < 0.45` で、祠から 14 タイル・ベッドから 6 タイル・アリーナの外。
  - 上限：苔庭 9、結晶洞 11、灼熱遺跡 11。エンディング後は半分。
  - プレイヤーから 30 タイル以上離れた状態が 10s 続いた敵は消す。

### 11.2 雑魚敵

| key | 名前 / EN | 生息 | HP | 攻撃 | 防御 | 速度 | 感知 | 予告(s) | 行動 | 特性 | ドロップ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| moss_slime | 苔スライム / Moss Slime | 苔庭 | 20 | 7 | 0 | 1.8 | 6 | 0.55 | 跳びかかり（円 r0.9） | lightFear | gel 1 (70%) |
| cave_bat | 洞コウモリ / Cave Bat | 苔庭・結晶洞 | 12 | 5 | 0 | 3.2 | 8 | 0.45 | 急降下（線 3） | 飛行・命中後 1.2s 退避 | gel 1 (25%) |
| moss_mite | 苔ダニ / Moss Mite | 苔庭 | 30 | 9 | 1 | 2.2 | 6 | 0.70 | 突進（線 4、速度 6） | lightFear | chitin 1 (80%) |
| prism_beetle | 晶甲虫 / Prism Beetle | 結晶洞 | 60 | 13 | 3 | 2.0 | 7 | 0.70 | 突進（線 5、速度 7） | lightFear | chitin 2, crystal 1 (40%) |
| mirror_moth | 鏡蛾 / Mirror Moth | 結晶洞 | 34 | 10 | 0 | 2.6 | 9 | 0.60 | 晶弾 1 発（速度 6） | 飛行・距離 4〜6・dodger | gel 1 |
| ember_husk | 炉守の亡者 / Ember Husk | 灼熱遺跡 | 90 | 20 | 4 | 1.5 | 6 | 0.85 | 叩きつけ（円 r1.6） | — | obsidian 1 (50%), ember_ore 1 (30%) |
| magma_newt | 溶岩トカゲ / Magma Newt | 灼熱遺跡 | 55 | 12 | 2 | 2.4 | 8 | 0.60 | 火球（速度 5.5、燃焼 3s） | 距離 3〜5・dodger | chitin 1, coal 1 (50%) |

- 予告は `game.hazards` に `owner:'enemy'` の warn 形状として出す。描画はボスと共通のコードで行う。
- 攻撃後の硬直（recover）は 0.6s。この間に受けるダメージは ×1.2。

### 11.3 ボス共通
- アリーナの内側（入口から 1 タイル以上奥）に入ると戦闘開始。入口が `arena_barrier` になり、登場演出（2.0s、`bossIntro`、名前の帯）が入る。登場演出の間はボスが攻撃しない。
- 行動は「攻撃を選ぶ（直前と同じ攻撃は重み ×0.3） → 予告 → 発動 → 硬直 1.0〜1.6s」の繰り返し。
- 予告時間は難易度「穏やか」で ×1.25。第 2 段階では ×0.85（穏やか ×1.25 と掛け合わせる）。
- **予告は必ず形状を地面に描く**（`hazards`。warn のあいだ塗りが 0 から 1 まで進む）。加えて、ボス本体の予備動作をアニメーションで見せる。
- プレイヤーの死亡・帰還、またはアリーナ外への脱出（結界があるので通常は起きない）でボスは全回復してリセットされ、結界が消える（`bossReset`）。
- 撃破すると 2.5s の消滅演出（`dying`） → `bossDefeated`。核は `progress.hearts` へ入り、最大 HP +20（HP も 20 回復）、旗のレシピ解放、報酬素材は持ち物へ（溢れた分はドロップ）、結界が消える。封印門は自動で開き、`gateOpen` の演出とトーストが出る。オートセーブ。
- ボス戦中は手動セーブ不可、オートセーブもしない。

### 11.4 守護者1：苔冠のモルグ / MORGH, THE MOSS-CROWNED
- 苔庭アリーナ。2×2（半径 0.9）。HP 480、防御 1、速度 1.6。
- 攻撃：
  - **根の突き上げ / Root Eruption**：予告 0.9s（地面に亀裂の光）。プレイヤー方向とその ±20° に、長さ 7・幅 0.8 の線を 3 本。発動 0.35s、ダメージ 18。第 2 段階は 5 本（±10°・±20°）。
  - **胞子の輪 / Spore Ring**：予告 1.0s（冠が青緑に膨らむ）。半径 1→7 へ 1.4s で広がる環（厚さ 0.6）。50° の安全な隙間があり、隙間の向きは予告中から表示する。ダメージ 14。回避の無敵でも抜けられる。
  - **突進 / Charge**：予告 0.8s（前脚で地面を掻く）。幅 1.6・長さ 10 の線を表示し、速度 9 で直進。ダメージ 22。壁に当たると 1.6s 気絶（`stunned`）し、その間は被ダメージ ×1.5。
- 第 2 段階（HP 50% 以下、`bossPhase`）：苔スライムを 2 体、1 回だけ召喚する。
- 報酬：苔の核、旗、capwood 10・copper_ore 6・fiber 6。

### 11.5 守護者2：虚晶の聖歌プリズマ / PRISMA, THE HOLLOW CHOIR
- 結晶洞アリーナ。浮遊（半径 0.8）。HP 760、防御 4、速度 2.0。
- 攻撃：
  - **屈折光線 / Refraction Beam**：予告 1.0s。細い破線と、薙ぎ払う向きの弧矢印を表示。発動すると幅 0.6 の光線が 1.0s で 50° を薙ぐ。0.25s ごとに 16 ダメージ。**柱で遮られる**（レイキャストが `seal_stone` で止まる。遮られた後の長さを `shape.length` に毎ステップ反映する）。第 2 段階は往復する（計 2.0s）。
  - **結晶雨 / Shard Rain**：予告 1.1s。円（r1.0）を 8 個。うち 3 個は予告開始時のプレイヤー位置付近、5 個はランダム。ダメージ 24。第 2 段階は 12 個。
  - **鏡像 / Mirror Split**：予告 0.8s（明滅。動き低減では明滅せず輪郭が太る）。本体がアリーナ内のランダムな位置へ移り、分身を 2 体出す（`boss.decoys`、HP 1）。分身は 1.5s ごとに晶弾を 3 方向へ撃つ（速度 6、ダメージ 14）。**本体だけ 0.8s ごとに金色の反射が光る**（描画担当は `decoy.real` を見ない。`boss.glintT` が 0 に戻るタイミングで光らせる）。本体に当てるか 8s 経つと終わる。分身は叩くと砕ける。
- 第 2 段階：HP 50% 以下。
- 報酬：晶の核、旗、crystal 8・gel 4。

### 11.6 守護者3：最後の火夫イグナル / IGNAR, THE LAST STOKER
- 灼熱遺跡アリーナ。2×2（半径 1.0）。HP 1100、防御 6、速度 1.4。
- 攻撃：
  - **炉の吐息 / Furnace Breath**：予告 1.0s（口が赤熱）。70° の扇（射程 5）。発動 1.2s、0.25s ごとに 18 ダメージ＋燃焼。第 2 段階では発動中に 40° 首を振る。
  - **溶鉄の衝撃 / Slag Shockwave**：予告 0.9s（両腕を振り上げる。着弾点に円 r2）。着弾で 32 ダメージ。続けて広がる環を 2 つ（速度 4、厚さ 0.5、ダメージ 22、隙間なし）。回避の無敵で抜ける。
  - **噴気 / Vent Eruption**：予告 1.2s（グループ A の噴気口が光る） → 噴出 0.6s（ダメージ 26） → グループ B で同じことを繰り返す。第 2 段階は A → B → A の 3 波。
- 第 2 段階（HP 40% 以下）：炉守の亡者を 2 体、1 回だけ召喚する。
- 報酬：灼の核、旗、emberite 4・obsidian 4。

### 11.7 推奨装備での検算（設計値）
- モルグ（T2、HP 100、防御 5）：根の突き上げ 13／胞子の輪 9／突進 17。剣 15 ダメージで 32 回。
- プリズマ（T3、HP 120、防御 9）：光線 7/tick／結晶雨 15／晶弾 5。剣 24 で 32 回。
- イグナル（T4、HP 140、防御 14）：吐息 4/tick／衝撃 18／環 8／噴気 12。剣 37 で 30 回。

### 11.8 予告の視認性
- 予告形状の色はテーマ別（苔：青緑、結晶：青白、灼熱：橙）。**色だけで区別させず**、斜線のハッチと輪郭の破線を必ず描く。
- 設定「予告を強調」が ON なら輪郭を 2px 太くし、不透明度を上げる。
- warn の塗りの進み具合は `hazard.t / hazard.warn`。

---

## 12. 操作

### 12.1 キーボード（`DATA.KEYBINDS`。`event.code` で判定する）

| アクション | キー | 備考 |
|---|---|---|
| up/down/left/right | W A S D / 矢印 | 8 方向。斜めは正規化する |
| primary（使う・攻撃） | Space / J | 押し続けると繰り返す |
| interact（調べる） | E / K / Enter | |
| dodge（回避） | Shift / L | |
| remove（撤去） | R | |
| quickHeal（すぐ回復） | Q | HP 50% 未満なら灯薬、それ以外は空腹を最も満たす食料 |
| hot1〜hot8 | 1〜8 | |
| hotPrev / hotNext | Z / X / ホイール | |
| inventory | Tab / I | プレイ中のみ（メニュー内の Tab はフォーカス移動に使う） |
| craft | C | 持ち物画面のクラフトタブ |
| map | M | |
| codex | G | 持ち物画面の図鑑タブ |
| pause | Esc / P | |

**メニュー内**
- 項目移動：矢印 / WASD（ロービングフォーカス）。Tab / Shift+Tab は通常のフォーカス移動
- 決定：Enter / Space / J
- 戻る：Esc / Backspace
- タブ切替：Q / E / PageUp / PageDown

### 12.2 マウスとタッチ（**ドラッグ不要**）
- 画面をクリック／タップ → `renderer.screenToWorld` で座標に変換し、`input.pointer` に入れる。
  - 2.2 タイル以内：その方向を向き、対象の種類に応じて主行動か調べるを実行する（調べられるオブジェクトで、近くに敵がいなければ「調べる」を優先）。
  - それより遠い：A*（最大 400 ノード、経路は 60 タイルまで）で自動歩行する。着いたら、対象が操作可能なら 1 回だけ実行する。移動入力で自動歩行は解除。
- タッチ用ボタン（ui.js が生成。押している間だけ有効で、スワイプは不要）：
  - 左下に 3×3 の方向パッド（中央は空き）。1 ボタン 56px 以上。
  - 右下に「使う」（大 72px）、「調べる」「回避」「撤去」「回復」。
  - 上部にホットバー（タップで選択）、「持ち物」「地図」「ポーズ」。
- `touch-action: none` はキャンバスとタッチボタンにだけ付ける。メニューは通常どおりスクロールでき、ページ送りのボタンも用意する。
- タッチボタンの表示：設定「自動」なら、`(pointer: coarse)` か最後の入力がタッチのときに表示する。

### 12.3 操作ヒント（HUD 左下）
`player.target.action` を表示する。動詞キーは `attack 攻撃 / mine 採掘 / chop 伐採 / gather 採集 / harvest 収穫 / open 開ける / inspect 調べる / sleep 眠る / plant 植える / fish 釣る / place 置く / remove 撤去 / offer 捧げる / recover 回収 / craft 作業`。キー表示は最後の入力デバイスに合わせて切り替える（例：「J 採掘：銅鉱脈」／タッチでは「使う 採掘：銅鉱脈」）。

---

## 13. API 契約（最重要）

### 13.1 起動とループ（main.js）

```js
import { DATA } from './data.js';
import { Game, SaveStore, TabLock, loadSettings, saveSettings } from './world.js';
import { UI } from './ui.js';
import { Renderer } from './render.js';
import { AudioEngine } from './audio.js';

const STEP = 1/60, MAX_STEPS = 5;
// 1) settings = loadSettings(store)   2) game = new Game(DATA); game.applySettings(settings)
// 3) renderer = new Renderer(canvas, game); audio = new AudioEngine(); input = new Input(game)
// 4) ui = new UI(game, { app, input, renderer, audio, store }); ui.init(); ui.showScreen('boot')
// 5) await renderer.load()  ← reject しても続行（main が catch してフォールバック表示を出す）
// 6) renderer.resize(); ui.showScreen('title'); requestAnimationFrame(frame)
// 最初の pointerdown / keydown で audio.unlock(); audio.setEnabled(settings.soundOn)
```

```js
function frame(now){
  const dt = Math.min((now - last) / 1000, 0.25); last = now;
  if (game.isSimRunning()) {
    acc += dt; let n = 0;
    while (acc >= STEP && n < MAX_STEPS) { game.update(STEP); input.endStep(); acc -= STEP; n++; }
    if (n === MAX_STEPS) acc = 0;
  } else { acc = 0; input.endStep(); }
  safe(() => renderer.render(dt)); safe(() => audio.update(game, dt)); safe(() => ui.update(dt));
  app.tick(dt);            // オートセーブ・タブロックの鼓動
  requestAnimationFrame(frame);
}
```

- `safe()` は try/catch で、例外を `console.error` に出すだけ。どれか 1 つの担当の不具合でループ全体が止まらないようにする。
- `resize`・`orientationchange` で `renderer.resize(); ui.onResize()` を呼ぶ。
- `visibilitychange`（hidden）でプレイ中なら `ui.showScreen('pause')` とオートセーブ（可能な場合）。`pagehide` でもオートセーブし、タブロックを解放する。

### 13.2 Input（main.js 内のクラス。ui.js にも渡す）

```js
class Input {
  constructor(game)          // game.input に InputState を設定する
  setHeld(action, on)        // 押下状態（キー、タッチボタンの pointerdown/up/cancel）
  pulse(action)              // 押した瞬間（そのステップで1回だけ）
  setPointer(clientX, clientY) // renderer.screenToWorld で変換して pointer に入れる
  endStep()                  // pressed と pointer を消す
  device                     // 'keyboard' | 'mouse' | 'touch'（最後に使った入力）
}
// InputState（game.input。main だけが書き、game は読むだけ）
{ moveX, moveY,                 // -1..1。斜めは長さ 1 に正規化
  held: { primary, interact, dodge, remove },   // boolean
  pressed: Set<string>,         // 'primary','interact','dodge','remove','quickHeal','hot1'..'hot8','hotPrev','hotNext'
  pointer: null | { x, y, tx, ty } }  // ワールド座標（浮動小数）とタイル座標
```

キー入力の振り分け：`ui.isCapturingInput()` が true ならメニュー用アクション（`up/down/left/right/confirm/back/tabPrev/tabNext` と、メニュー開閉キー）を `ui.onAction(a)` に渡す。false ならゲーム入力にし、メニュー開閉キー（`inventory/craft/map/codex/pause`）だけは `ui.onAction` に渡す。キーボードイベントは、テキスト入力欄（seed 欄・JSON 欄）にフォーカスがあるときは横取りしない。

### 13.3 App（main.js。UI が呼ぶライフサイクル操作）

```js
app.storageAvailable                  // boolean（起動時に検査）
app.newGame(slot, { seed, difficulty }) → { ok, error }
app.continueSlot(slot, { takeover=false }) → { ok, error, locked }   // locked: 別タブ使用中
app.loadBackup(slot)                  → { ok, error }
app.saveNow({ auto=false })           → { ok, error }    // game.canSave() と TabLock を確認する
app.exportCurrent()                   → string（JSON）
app.exportSlot(slot)                  → string | null
app.downloadText(text, filename)      // Blob + a[download]
app.importText(text, slot)            → { ok, error, summary }   // 検証してから書き込む
app.previewImport(text)               → { ok, error, summary }
app.deleteSlot(slot)                  → { ok }
app.listSlots()                       → SlotInfo[]  // store.listSlots の結果
app.quitToTitle({ save=true })
app.setSettings(partial)              // game.applySettings + 保存 + audio.setEnabled 等
app.tick(dt)                          // オートセーブ（sim が動いている時間で 60s ごと）
```

### 13.4 Game（world.js）— プロパティ

**別途書かない限り、render / ui / audio からは読み取り専用。**

```js
class Game {
  data            // DATA
  version         // '1.0.0'
  mode            // 'title' | 'playing' | 'dead' | 'ending'
  paused          // boolean（pauseReasons が空でなければ true）
  pauseReasons    // Set<string>（'menu','map','chest','dialog','hidden','readonly'）
  readOnly        // boolean（タブ引き継ぎで保存を禁止された状態）
  slot            // 1 | 2 | 3 | null
  worldId         // int。新しいワールドを読み込むたびに +1（描画のキャッシュ破棄の目印）
  settings        // Settings（§17.1）
  difficulty      // 'gentle' | 'standard'
  seed            // string
  time            // sim 秒（睡眠で +120）
  playTime        // 実際に sim が動いた秒数
  rngState        // uint32（sim の乱数状態。保存する）
  world           // World | null
  player          // Player | null
  enemies         // Enemy[]
  boss            // BossFight | null（戦闘中だけ）
  projectiles     // Projectile[]（上限 64）
  hazards         // Hazard[]（上限 48）
  drops           // Drop[]（上限 300）
  progress        // Progress（§14.1）
  stats           // Stats
  input           // InputState（main が書く）
  openContainer   // null | idx（開いている収納箱のタイル番号）
  channel         // null | { kind:'return', t, dur }
  fishing         // null | { phase:'cast'|'wait'|'bite', t, wait, x, y }
  ending          // null | { t, phase:'absorb'|'bloom'|'text' }
  eventSeq        // int
}
```

**World**

```js
class World {
  width, height                        // 128, 128
  ground, wall, build                  // Uint8Array
  biome                                // Uint8Array（0 境界, 1 苔庭, 2 結晶洞, 3 灼熱遺跡）
  flags                                // Uint8Array（bit0 protected, bit1 arena, bit2 corridor, bit3 hub, bit4 noBuild）
  explored                             // Uint8Array（0/1）
  light                                // Float32Array（静的な光の合計 0..1.5。環境光を含む）
  safeLight                            // Float32Array（設置した光と炉心だけ。敵出現の判定用）
  lights                               // LightSource[] { x, y, r, s, color, kind }（中心はタイル中心）
  objects                              // Map<idx, WorldObject>
  wallDamage                           // Map<idx, { dmg, max, t }>
  anchors                              // { hub, start, arenas:{moss,crystal,ember}:{cx,cy,x0,y0,x1,y1,door:{x,y,dir}}, gates:{crystal,ember}:{tiles:[{x,y}]} }
  chunkVersion                         // Uint32Array(64)（16×16 チャンク、横8×縦8。変更されたチャンクだけ +1）
  lightVersion, exploredVersion        // int
  idx(x,y); inBounds(x,y)
  groundAt(x,y); wallAt(x,y); buildAt(x,y); biomeAt(x,y); objectAt(x,y)
  lightAt(x,y)                         // 範囲外は 0
  isSolid(x,y)                         // 壁あり／塞ぐオブジェクト／液体（橋なし）／範囲外
  isWalkable(x,y, flying=false)        // flying なら液体も可（壁は不可）
}
```

- WorldObject は `{ type, x, y, ...状態 }`（§5.4 の状態フィールド）。炉心は 4 セルすべてで同じオブジェクトを参照する（`objects` に 4 キーで登録。保存は 1 件）。
- 光の計算：光源ごとに、固体でないタイル（ガラス壁は透過）を BFS で半径 r まで広げ、`s*(1-d/r)^1.4` を加算して 1.5 で頭打ち。光源の追加・削除のときは、その影響範囲だけ再計算する。環境光：苔庭 0.08、結晶洞 0.12、灼熱遺跡 0.16。エンディング後は +0.30。溶岩は「溶岩以外に接している溶岩タイル」だけを光源（ember r3 s0.6）として登録する。

**Player**

```js
{ x, y, vx, vy, radius, angle, dir8 /*0=E,1=SE,2=S,…,7=NE*/, moving,
  hp, maxHp, stamina, maxStamina, hunger, maxHunger, exhausted,
  inventory /* (Slot|null)[32] */, selected /*0..7*/, armor /* key|null */,
  action: { type:'idle'|'walk'|'attack'|'mine'|'chop'|'gather'|'dodge'|'eat'|'cast'|'fish'|'hurt'|'channel'|'sleep'|'dead',
            t, dur, item, combo /*0..2*/ },
  invulnT, hurtT, burnT, buffs /* [{id,t}] */,
  spawn: { x, y, kind:'hub'|'bed' },
  target: null | { x, y, kind, label, action },
  placePreview: null | { x, y, item, valid },
  autoPath: null | { pts:[{x,y}], i },
  inHeat, biome }
// Slot = { id: itemKey, n: int }
```

**Enemy / BossFight / Hazard / Projectile / Drop**

```js
Enemy { id, type, x, y, vx, vy, radius, hp, maxHp, state, stateT, angle, flying,
        home:{x,y}, attack:null|{kind, t, warn, dur, angle}, hitFlashT }
BossFight { id:'moss'|'crystal'|'ember', key:'morgh'|'prisma'|'ignar', name, en,
        x, y, radius, hp, maxHp, def, phase:1|2,
        state:'intro'|'idle'|'telegraph'|'attack'|'recover'|'stunned'|'dying', stateT,
        attack:null|{ name, t, warn, dur }, angle, glintT,
        decoys:[{ id, x, y, alive }], arena:{x0,y0,x1,y1}, hitFlashT, tookDamage /* プレイヤーが被弾したか */ }
Hazard { id, owner:'boss'|'enemy', kind, theme:'moss'|'crystal'|'ember',
        phase:'warn'|'active', t, warn, active, dmg, tick /*0なら単発*/,
        shape: {type:'circle',x,y,r}
             | {type:'ring',x,y,r,width,gapAngle?,gapWidth?}
             | {type:'line',x,y,angle,length,width}
             | {type:'cone',x,y,angle,spread,range} }
Projectile { id, kind:'shard'|'fireball'|'decoyShard'|'mothShard', theme, x, y, vx, vy, r, dmg, life }
Drop { id, item, n, x, y, t }   // 600s で消える（遺灰袋は Drop ではない）
```

`kind` の一覧：`root, sporeRing, charge, beam, shardRain, breath, slam, shockRing, vent, slimeHop, batDive, miteCharge, beetleCharge, huskSlam`。sim は形状（半径・角度・長さ）を毎ステップ更新し、描画は現在値をそのまま描く。

### 13.5 Game — メソッド

**ライフサイクル**

| メソッド | 戻り値 | 説明 |
|---|---|---|
| `constructor(DATA)` | — | `mode='title'`、`world=null` |
| `newGame({slot, seed, difficulty})` | void | ワールド生成、初期化、`mode='playing'`、`worldId++` |
| `loadFromSave(save, slot)` | `{ok, error}` | **検証済み**のオブジェクトを受け取る。一時インスタンスで組み立ててから入れ替える（途中で失敗しても元の状態は壊れない） |
| `toSave()` | SaveObject | §14 のスキーマ |
| `resetToTitle()` | void | `mode='title'`、`world=null`、`worldId++` |
| `update(dt)` | void | 固定ステップ |
| `isSimRunning()` | boolean | `!paused && mode ∈ {playing, dead, ending}` |
| `setPaused(reason, on)` | void | 理由ごとに付け外しする |
| `canSave()` | `{ok, reason}` | `reason ∈ 'boss','dead','ending','title','readonly'` |
| `applySettings(s)` | void | |
| `pollEvents(sinceSeq)` | Event[] | `seq > sinceSeq` を古い順に返す |

**プレイヤー操作（UI から）**

| メソッド | 戻り値 |
|---|---|
| `selectHotbar(i)` | void |
| `moveItem(from, to)` | `{ok, reason}` — 参照は `{box:'inv', i}` / `{box:'chest', i}` / `{box:'armor'}`。同じ種類なら合流、違えば入れ替える |
| `transferStack(from)` | `{ok}` — 開いている箱 ⇄ 持ち物の空きへ移す |
| `splitStack(ref)` | `{ok}` |
| `dropStack(ref)` | `{ok}` |
| `useItem(ref)` | `{ok, reason}` — 食べる、装備する、ホットバーへ移す |
| `unequipArmor()` | `{ok, reason}` |
| `depositAll()` / `depositMatching()` / `takeAll()` | `{ok, moved}` |
| `closeContainer()` | void |
| `getRecipeView()` | `RecipeView[]` |
| `canCraft(id)` | `{ok, times, missing:[{key,need,have}], station}` |
| `craft(id, times)` | `{ok, made, reason}` |
| `plantAt(x, y, seedKey)` | `{ok, reason}` |
| `startReturn()` / `cancelChannel()` | `{ok, reason}` |
| `respawn()` | void（`dead` → `playing`） |
| `offerHearts()` | `{ok, reason}` — 3 つそろっていれば `mode='ending'` |
| `finishEnding()` | void（`ending` → `playing`、`endingSeen=true`） |
| `skipEndingAnim()` | void |

**表示用の問い合わせ**

```js
getHUD() → { hp, maxHp, stamina, maxStamina, hunger, maxHunger, exhausted,
  buffs:[{id,name,t}], heat:boolean, biome:{id,name,en},
  prompt:null|{action, label}, boss:null|{name,en,hp,maxHp,phase},
  channel:null|{kind,progress}, fishing:null|{phase}, hotbar:Slot[8], selected }
getObjective() → { id, index, text, en, target:null|{x,y}, final:boolean }
getMapData() → { explored:Uint8Array, markers:[{kind:'player'|'hub'|'bed'|'satchel'|'altar'|'gate'|'objective'|'chest', x, y, label, state}] }
getCodex() → [{ category, key, unlocked, name, en, desc, where }]
getAchievements() → [{ id, unlocked, name, en, desc }]
getEndingStats() → { playTime, deaths, crafted, mined, fish, difficulty }
itemCount(key) / tagCount(tag)
stationsNear() → Set<string>
```

`RecipeView`：`{ id, station, stationOk, out:{key,n,name,en}, ingredients:[{key|tag,name,need,have}], times /*作れる最大数*/, category }`

### 13.6 イベントログ（sim から外への唯一の通知手段）
- `game.events` は直近 256 件のリングバッファ。各要素は `{ seq, t, type, ...payload }`。
- renderer / audio / ui は**それぞれ自分の `lastSeq` を持ち**、`pollEvents(lastSeq)` で取得する。消費しても他の担当に影響しない。`worldId` が変わったら `lastSeq = game.eventSeq` に合わせる。
- 座標はタイル単位の浮動小数。

| type | payload | 主な消費者 |
|---|---|---|
| swing | who, item, x, y, angle | R A |
| hit | target:'enemy'\|'boss'\|'player'\|'decoy', id, x, y, dmg, kind, combo | R A |
| playerHurt | dmg, x, y, source | R A U |
| enemyDie | id, enemyType, x, y | R A |
| dodge | x, y, angle | R A |
| mineHit | x, y, wall, ratio | R A |
| mineBlocked | x, y, wall, need | A U |
| tileBreak | x, y, wall | R A |
| chop / treeFall | x, y | R A |
| gather / harvest | x, y, objType, item | R A |
| pickup | item, n | A U |
| craft | recipe, item, n | A U |
| place / remove | x, y, item, layer | R A |
| eat | item | A |
| buff | id | U |
| chestOpen / chestClose | idx, x, y | A U |
| fishCast / fishBite / fishCatch / fishMiss | x, y, item, reason | R A U |
| plant / cropReady | x, y, crop | R A |
| sleep | x, y | R A U |
| step | x, y, surface | A（0.32s ごと） |
| splash | x, y | R A |
| bossIntro / bossPhase / bossStun / bossDefeated / bossReset | bossId, phase | R A U |
| bossTelegraph / bossAttack | bossId, attack | R A |
| hazard | id, kind, phase | R A |
| gateOpen | gate, x, y | R A U |
| death / respawn | cause, x, y | R A U |
| satchelRecovered | — | A U |
| channelStart / channelCancel / channelDone | kind | R A U |
| biomeEnter | biome, first | A U |
| heat | on | U |
| objective | id, index | A U |
| achievement | id | A U |
| codex | category, key | U |
| hint | id | U |
| coreRestore | phase | R A U |
| ending | — | U |
| toast | text, kind:'info'\|'warn'\|'error' | U |
| save / saveFail | slot, auto, reason | U |

（R = renderer、A = audio、U = ui）

### 13.7 Renderer（render.js、Codex）

```js
export class Renderer {
  constructor(canvas, game)
  async load()                       // アセットの読み込み。一部が失敗しても resolve する（欠けたものはフォールバックで描く）
  resize()                           // CSS サイズ × devicePixelRatio に合わせる。整数倍のスケールを選び直す
  render(dt)                         // game を読むだけ。例外を外に投げない
  screenToWorld(clientX, clientY)    // → { x, y }（タイル座標・浮動小数）。world が null なら null
  camera                             // { x, y, scale }（読み取り専用。UI 用）
  getItemIconURL(itemKey)            // 任意：→ dataURL | null。UI は null なら文字アイコンで代用する
}
```

- `game.mode` が `'title'` のとき（`world == null`）はタイトル用の背景（洞窟のパララックスと粒子）を描く。`'ending'` のときは `game.ending` に従って演出を描く。
- **sim の状態を一切書き換えない。** 粒子・カメラ・画面の揺れ・ダメージ数字・タイルキャッシュはすべて renderer の内部状態。
- 見た目の判定に使うもの：`player.action.type/t/dur`、`enemy.state/stateT`、`boss.state/attack`、`hazards`、`projectiles`、`drops`、`world.*`、`player.target`、`player.placePreview`、`game.getObjective().target`（画面外なら画面端に矢印）、`settings.reduceMotion / screenShake / showDamageNumbers / highContrastTelegraph`。
- 欠けたスプライトのフォールバック：`data.js` の `mapColor` で塗った矩形と輪郭。

### 13.8 AudioEngine（audio.js、Codex）

```js
export class AudioEngine {
  constructor()
  unlock()                   // ユーザー操作の中で AudioContext を作るか resume する
  setEnabled(bool)           // false ならマスターをミュートし、新しい発音もしない
  setVolume(v)               // 任意：0..1。UI は存在するときだけ呼ぶ
  update(game, dt)           // イベントを poll して効果音を鳴らす。環境音と音楽を状態に追従させる
  play(name)                 // 名前で単発の効果音。知らない名前は無視する
}
```

- 外部の音声ファイルに依存しない WebAudio の合成を推奨する（ファイルを使う場合も、読み込みに失敗したら無音で続行する）。
- `play()` の名前（UI から呼ぶものと、イベントの対応表で使うもの）：
  `ui_move, ui_confirm, ui_back, ui_error, ui_tab, step_moss, step_stone, step_crystal, step_ash, swing, hit_enemy, hit_player, enemy_die, dodge, mine_hit, mine_break, mine_blocked, chop, tree_fall, gather, pickup, craft, place, remove, eat, chest_open, chest_close, fish_cast, fish_bite, fish_catch, fish_miss, plant, harvest, sleep, fire, telegraph, boss_intro, boss_phase, boss_defeat, gate_open, core_restore, achievement, objective, death, respawn, save, error`
- `update` で扱う状態：`game.mode`、`player.biome`（環境音のレイヤー：苔庭は水滴と微風、結晶洞は共鳴音、灼熱遺跡は低いうなりとパチパチ音）、`game.boss`（緊張感のある層）、HP 25% 未満（静かな心音）、`progress.coreRestored`（明るい和音）、`game.paused`（音楽 -12dB）。

### 13.9 UI（ui.js、Sonnet）

```js
export class UI {
  constructor(game, { app, input, renderer, audio, store })
  init()                         // DOM 構築と、イベントの登録
  update(dt)                     // HUD 更新（DOM は 10Hz まで。イベント発生時は即時）、イベントを poll
  showScreen(name, params)       // §16.2
  closeScreen()
  onAction(action) → boolean     // メニュー操作。処理したら true
  isCapturingInput() → boolean   // メニュー・ダイアログが開いているか
  toast(text, kind, { persist, actions })
  onResize()
}
```

UI は sim の状態を直接書き換えない。必ず `game.*` と `app.*` のメソッドを通す。例外は `game.setPaused` だけで、画面を開閉したときに UI が呼ぶ。

---

## 14. 保存

### 14.1 セーブデータのスキーマ（version 1）

```jsonc
{
  "format": "emberveil-save",
  "version": 1,
  "genVersion": 1,
  "savedAt": "2026-..-..T..:..:..Z",
  "meta": { "seed": "HEARTH", "difficulty": "standard", "playTime": 1234.5,
            "hearts": 1, "coreRestored": false, "objective": "..." },
  "game": { "time": 0, "playTime": 0, "rngState": 123456789, "difficulty": "standard", "seed": "HEARTH" },
  "world": {
    "w": 128, "h": 128,
    "ground": [id, count, id, count, ...],   // RLE
    "wall":   [ ... ], "build": [ ... ],
    "explored": "base64(2048 bytes の bitset)",
    "anchors": { ... },
    "objects": [ { "t": "chest", "x": 64, "y": 62, "items": [ ... ], "starter": true }, ... ],
    "drops": [ { "item": "stone", "n": 3, "x": 60.5, "y": 61.2, "t": 12 } ]
  },
  "player": { "x": 64.5, "y": 66.5, "angle": 1.57, "hp": 100, "maxHp": 100, "stamina": 100,
              "hunger": 80, "inventory": [ null, { "id": "torch", "n": 4 }, ... 32要素 ],
              "selected": 0, "armor": null, "buffs": [ { "id": "regen", "t": 30 } ],
              "spawn": { "x": 64, "y": 66, "kind": "hub" } },
  "progress": {
    "hearts": { "moss": false, "crystal": false, "ember": false },
    "gates": { "crystal": false, "ember": false },
    "coreRestored": false, "endingSeen": false, "objective": 0,
    "flags": { "openedStarter": false, "enteredCrystal": false, "enteredEmber": false },
    "unlocks": [], "hintsSeen": [],
    "codex": { "item": [], "enemy": [], "fish": [], "boss": [], "biome": [] },
    "achievements": []
  },
  "stats": { "mined": {}, "crafted": {}, "placed": {}, "obtained": {}, "killed": {}, "fish": {},
             "harvested": 0, "cooked": {}, "deaths": 0, "satchels": 0, "bridges": 0, "lights": 0, "builds": 0 }
}
```

- 敵・投射物・ハザード・ボス戦の状態は保存しない（読み込み後に湧き直す）。ボスは `progress.hearts` から判定する。
- 遺灰袋は `objects` の `t: "satchel"` として保存する。
- 炉心は `objects` に 1 件（アンカー座標）だけ保存する。

### 14.2 検証（`validateSave(obj) → { ok, errors[], save }`）
- **方針**：構造・型・ID の誤りは**全体を拒否**する（部分的な読み込みはしない）。連続値の範囲外は**丸める**。最後に意味の整合を**修復**する。

| 項目 | 上限・条件 |
|---|---|
| 読み込むテキスト | 3,000,000 文字以下（`JSON.parse` の前に確認） |
| format / version | `'emberveil-save'`、1 ≤ version ≤ SAVE_VERSION（新しい版は拒否：「新しいバージョンのデータです」） |
| seed | 文字列 1〜32 文字。制御文字は除去 |
| w / h | 128 と完全に一致 |
| RLE | 偶数長、32,768 要素以下。id は整数で定義の範囲内、count は 1〜16384、合計がちょうど 16384 |
| explored | base64。復号して 2048 バイトちょうど |
| objects | 8,000 件以下。`t` は定義済み、x / y は 0〜127 の整数、タイルの重複なし。収納箱 64 個以下 |
| 箱・袋の items | 箱はちょうど 16 要素、袋は 64 要素以下。各要素は null か `{id: 定義済み, n: 1..stack}` |
| planter | crop は null か作物キー、stage 0〜3、growT 0〜10000 |
| 再生タイマー類 | 0〜1000（丸める） |
| drops | 300 件以下、座標 0〜128、t 0〜600 |
| player.x/y | 1〜127 の有限数 |
| maxHp | 100 + 20 × 核の数（不一致は修正） |
| hp / stamina / hunger | 0〜各最大値（丸める） |
| inventory | ちょうど 32 要素 |
| armor | null か防具のキー |
| selected | 0〜7 |
| buffs | 8 件以下、id は定義済み、t は 0〜900 |
| spawn | 範囲内 |
| codex の各配列 | 256 件以下、既知のキー、重複を除去 |
| achievements | 64 件以下、既知の ID |
| unlocks / hintsSeen | 既知の値だけ |
| objective | 0〜目標数-1 |
| stats の各マップ | 既知のキーだけ、値は 0〜1e9 の整数 |
| time / playTime | 0〜1e8 |
| 数値全般 | `Number.isFinite` でなければ拒否 |

**修復**
- アンカーからスタンプ（祠・アリーナ・柱・噴気口）と境界を再適用する。保護タイルは元に戻す。
- 開いた門はタイルを床にし、閉じた門はタイルを門にする。炉心と古い収納箱がなければ再配置する。
- プレイヤーが固体の中にいれば、BFS で最も近い歩行可能なタイルへ移す（なければ開始地点）。
- 光と safeLight は全再計算する。

### 14.3 保存先（localStorage）

| キー | 内容 |
|---|---|
| `emberveil.v1.slot1`〜`slot3` | セーブ本体 |
| `emberveil.v1.slotN.bak` | 直前のセーブ（上書きする前に退避） |
| `emberveil.v1.settings` | 設定（検証あり。不正なら既定値に戻す） |
| `emberveil.v1.achievements` | 全セーブ共通の解除済み実績 |
| `emberveil.v1.lock.slotN` | タブロック |
| `emberveil.v1.lastSlot` | 「続きから」の対象 |

**書き込み手順**
1. `game.toSave()` で作る。
2. 自分の出力を `validateSave` に通す（壊れたデータを書かないため）。
3. ロックの所有者を確認する。
4. 現在の本体を `.bak` へコピーする。
5. `setItem`。

例外（QuotaExceeded / SecurityError）は `{ok:false, error}` で返す。

**読み込み**：本体を検証し、失敗したら「データが壊れています」と表示して `.bak` からの復元を提案する（`.bak` も検証する）。

**オートセーブ**：sim が動いている時間で 60s ごと。加えて睡眠、ボス撃破後、門が開いたとき、炉心に捧げた直後、hidden / pagehide のとき。いずれも `canSave()` が ok の場合だけ。

### 14.4 保存できないときの通知
- 起動時にテスト用キーで set / remove を試し、失敗したら `app.storageAvailable=false`。タイトルに常設の帯を出す：「この環境では保存できません。ポーズメニューの『書き出し』で進行を保存してください」。その場合もゲームはメモリ上のスロットで遊べる。
- 保存に失敗したら、閉じるまで消えないトースト「保存できませんでした — 書き出しで退避してください」と［書き出し］ボタンを出す。

### 14.5 JSON の書き出し・読み込み
- **書き出し**：ファイル名は `emberveil-slotN-YYYYMMDD-HHMM.json`。ダウンロードと、読み取り専用の textarea 表示（全選択ボタン付き。対応環境ならクリップボードへコピー）の両方を用意する。
- **読み込み**：`<input type="file" accept=".json,application/json">` と、貼り付け用の textarea のどちらでも可。検証 → 概要の表示（seed・プレイ時間・核の数）→ 保存先スロットを選ぶ → 上書き確認 → 書き込み。

### 14.6 同時タブ対策（TabLock）
- ロックの値は `{ tabId, ts }`。鼓動は 2s ごと、8s 更新がなければ失効とみなす。
- スロットを開くとき：他のタブが有効なロックを持っていれば、ダイアログ「このセーブは別のタブで開かれています」［引き継ぐ］［戻る］を出す。
- 引き継ぐ：ロックを自分の tabId で上書きし、BroadcastChannel `emberveil` で `{type:'takeover', slot, tabId}` を送る（BroadcastChannel がなければ `storage` イベントで代用）。
- 奪われた側：`readOnly=true`、`setPaused('readonly')`、オーバーレイ「別のタブで再開されました。このタブでは保存されません」［タイトルへ］。
- 保存のたびにロックの所有者を確認する。他のタブに奪われていたら保存を中止して読み取り専用に移る。
- `pagehide` で自分のロックを削除する。

```js
export class TabLock { constructor(storeNs); acquire(slot,{takeover}) → {ok, heldByOther}; heartbeat(); release(); isOwner(slot); onLost(cb) }
export class SaveStore { isAvailable(); listSlots() → [{slot, exists, corrupt, hasBackup, summary}];
  write(slot, saveObj) → {ok,error}; read(slot) → {ok, save, error}; readBackup(slot); remove(slot);
  getGlobalAchievements(); addGlobalAchievement(id) }
export function validateSave(obj) ; export function loadSettings(store) ; export function saveSettings(store, s)
export function generateWorld(seedStr) ; export function hashSeed(str)
```

---

## 15. ソフトロック対策（まとめ）

| リスク | 対策 |
|---|---|
| 最初に道具がない | 瓦礫（素手で採掘可・祠に 4 か所・再生 150s）で石、素手 8 回で巨大茸から菌木材。石の道具は手作業で作れる |
| 道具の紛失 | 耐久度なし。死亡してもホットバーと防具は残る。捨てたものはドロップとして拾い直せる |
| 資源の枯渇 | 全素材に再生する経路がある：菌木（茸の再生・胞子）、石（壁・瓦礫）、銅（瓦礫 20%）、石炭（炭焼き・瓦礫）、結晶（晶花の再生）、灼鉱・黒曜石（亡者のドロップ・敵は湧き続ける）、甲殻・粘液（敵）、食料（農業・釣り・光茸の再生） |
| 鍵の消失 | 核は `progress.hearts` に入る。持ち物の外にあるので、落とす・預ける・捨てることはできない |
| 橋の不足 | 必須ルートは木橋 4・石橋 2。材料は再生可能で、橋は撤去すれば 100% 戻る。迂回して掘ることも可能 |
| 閉じ込め | 帰還（いつでも・無料）、撤去は道具不要、土壁は素手で掘れる。破壊不可の壁は境界・外周・アリーナだけ |
| ボスに行けない | 生成時に通路を確保し、BFS で検証する。アリーナとその入口は保護されており、自然物が通路に再生することもない |
| ボスに勝てない | 何度でも挑戦できる。料理・灯薬・装備更新・「穏やか」への随時切替で調整できる |
| 目標が進まない | 目標の達成条件は「累計の統計か、それ以降の進行フラグ」で判定し、番号は戻らない |
| 遺灰袋が回収できない場所に落ちる | 歩行可能・非保護・非アリーナのタイルへ BFS で移す |
| ボス戦中のセーブ破損 | 戦闘中は保存しない |
| データの破損 | 検証・バックアップ・入れ替え式の読み込み |

---

## 16. UI 設計

### 16.1 DOM 骨格（index.html）

```html
<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>残り火の深庭 / EMBERVEIL</title>
<link rel="stylesheet" href="../../css/common-style.css">
<link rel="stylesheet" href="./game.css">
</head><body class="ev-page">
<div id="ev-root" class="ev">
  <canvas id="ev-canvas" aria-label="ゲーム画面"></canvas>
  <div id="ev-hud" class="ev-hud" hidden></div>
  <div id="ev-touch" class="ev-touch" hidden></div>
  <div id="ev-overlay" class="ev-overlay"></div>
  <div id="ev-toasts" class="ev-toasts" aria-live="polite"></div>
</div>
<noscript>このゲームにはJavaScriptが必要です。</noscript>
<script type="module" src="./main.js"></script>
</body></html>
```

Codex はキャンバスだけを扱い、DOM は扱わない。

### 16.2 画面と状態遷移

| 画面 | 表示 | sim | 遷移先 |
|---|---|---|---|
| boot | 読み込み中 | 停止 | title |
| title | ロゴ「残り火の深庭 / EMBERVEIL」、続きから／はじめから／セーブ管理／設定／実績／クレジット／サイトへ戻る | — | slots, newGame, settings, achievementsGlobal, credits |
| slots | 3 スロット（seed・プレイ時間・核 x/3・最終保存・難易度・破損表示）、読み込み／新規／書き出し／削除／JSON 読み込み／バックアップから復元 | — | newGame, import, lockDialog, intro, title |
| newGame | seed 入力（ランダム／HEARTH）、難易度、開始 | — | intro |
| intro | 導入 3 行（スキップ可） | 停止 | hud |
| hud | HUD とタッチボタン | 動作 | pause, inventory, map, chest, dialog, dead, ending |
| pause | 再開／設定／灯へ帰る／保存する／書き出し／クレジット／タイトルへ | 停止 | hud, settings, credits, title |
| inventory | タブ：持ち物・装備／クラフト／図鑑／実績／目標 | 停止 | hud |
| chest | 箱 16 枠と持ち物 32 枠 | 停止 | hud |
| map | 全体地図・凡例・カーソル | 停止 | hud |
| dialog | 確認（捧げる、上書き、削除、種の選択） | 停止 | 呼び出し元 |
| dead | 「灯が消えた / YOUR LIGHT FADED」、死因、遺灰袋の位置、［灯をともし直す］ | 演出のみ | hud |
| ending | 演出 → 本文 → 統計 → ［クレジットへ］ | ending のみ | credits |
| credits | スタッフロール（自動スクロール。動き低減では静止とページボタン） | 停止 | 呼び出し元、またはエンディング後は hud（自由建築） |
| settings | §17.1 | 停止 | 呼び出し元 |
| lockDialog | 別タブで使用中 | — | slots, hud |
| readonly | 引き継がれた | 停止 | title |
| import / exportView | JSON の入出力 | 停止 | 呼び出し元 |

**Esc（戻る）の挙動**
- hud → pause
- pause → hud
- inventory / chest / map → hud
- dialog → 閉じる
- settings / credits → 呼び出し元
- slots / newGame → title
- title → 何もしない
- dead / ending → 何もしない（ボタンで操作する）

メニュー開閉キーは、同じ画面が開いていれば閉じる（トグル）。

### 16.3 HUD
- **左上**：HP（残り火の赤）、スタミナ（青緑）、空腹（金）の細いバーと数値。その下にバフアイコンと残り秒数。灼熱の警告。
- **右上**：ミニマップ 120×120（40×40 タイル、0.25s ごとに更新）と、その下に目標の文。
- **上中央**：ボス戦中は日本語名と英語副題、HP バー、段階の印。トースト。
- **下中央**：ホットバー 8 枠（選択中は金枠、個数を表示）。帰還・釣りの進捗リング。
- **左下**：操作ヒント（§12.3）。
- バイオームに入ったとき：初回は中央に大きな帯（「苔庭 — MOSS GARDEN」）、2 回目以降は小さく。

### 16.4 持ち物（ドラッグなし）
- スロットを選ぶ（クリック／Enter）と「持ち上げ」状態になり、別のスロットを選ぶと移動・入れ替え・合流。
- 選択中のスロットの詳細パネルに［使う／装備］［ホットバーへ］［半分に分ける］［捨てる］を出す。
- 装備欄：防具枠と、現在の能力（攻撃・防御・採掘ティア・伐採力・耐熱）。
- アイテムアイコンは `renderer.getItemIconURL`。null なら `mapColor` の四角と名前の 1 文字。

### 16.5 クラフト
- 左にステーションのタブ（手作業／焚き火／作業台／炉／料理台）。近くにないステーションには「近くにありません」と表示する。
- 右にレシピの行：アイコン、名前と英語、材料（持っている数/必要数。足りなければ赤＋記号）、［×1］［×5］［最大］。
- 「作れる物だけ」の切り替え。ステーションを「調べる」と、そのステーションのタブを開いた状態で表示する。

### 16.6 地図
- 512×512 の canvas（1 タイル 4px、縦横比を保って縮小）。ui.js が `getMapData()` と `DATA` の `mapColor` で描く。
- 未踏破は描かない（霧）。踏破済みは `explored`。
- マーカー：現在地・祠・ベッド・遺灰袋・発見済みの祭壇・門・目標。矢印キーかボタンでカーソルを動かすとマーカー名を読み上げ表示する。
- 探索：0.25s ごとにプレイヤーの周囲半径 7 と、半径 12 以内で `light ≥ 0.5` のタイルを `explored` にする。

### 16.7 目標（`DATA.OBJECTIVES`。順に表示し、達成判定は累計統計か進行フラグ）

| # | id | 文 | 達成条件 | 目標地点 |
|---|---|---|---|---|
| 0 | wake | 祠の古い収納箱を開けよう | flags.openedStarter | 収納箱 |
| 1 | gather | 菌木材6と石4を集めよう | 所持が条件以上、または crafted.pick_* ≥1 | — |
| 2 | pick | 石のツルハシを作ろう | crafted pick_* ≥1 | — |
| 3 | campfire | 焚き火を置こう | placed.campfire ≥1 | — |
| 4 | bench | 作業台を置こう | placed.workbench ≥1 | — |
| 5 | copper | 銅鉱石を6つ集めよう | obtained.copper_ore ≥6 | 最寄りの踏破済み銅鉱脈 |
| 6 | smelt | 炉で銅インゴットを作ろう | crafted.copper_ingot ≥1 | — |
| 7 | gear | 銅の剣かツルハシを作ろう | crafted sword_copper / pick_copper ≥1 | — |
| 8 | bed | ベッドを置いて復活地点にしよう | placed.bed ≥1 | — |
| 9 | boss1 | 苔の祭壇で守護者を鎮めよう | hearts.moss | 苔庭アリーナ入口 |
| 10 | crystalGate | 西の結晶門を抜けよう | flags.enteredCrystal | 結晶門 |
| 11 | crystalPick | 結晶のツルハシを作ろう | crafted pick_crystal ≥1 | — |
| 12 | bridge | 裂け目に橋を架けよう | stats.bridges ≥1、または hearts.crystal | 最初の裂け目 |
| 13 | boss2 | 結晶洞の守護者を鎮めよう | hearts.crystal | 結晶アリーナ |
| 14 | heat | 灼熱に備えよう（結晶の鎧か霜晶ゼリー） | crafted armor_crystal / armor_ember、cooked.jelly ≥1、または hearts.ember | — |
| 15 | emberGate | 東の灼熱門を抜けよう | flags.enteredEmber | 灼熱門 |
| 16 | emberite | 灼鋼インゴットを作ろう | crafted.emberite ≥1、または hearts.ember | — |
| 17 | boss3 | 灼熱遺跡の守護者を鎮めよう | hearts.ember | 灼熱アリーナ |
| 18 | core | 炉心に三つの核を捧げよう | coreRestored | 炉心 |
| 19 | free | 深庭を自由に築こう | （最終。達成なし） | — |

英語副題も `data.js` に持たせる（例：`Quell the guardian at the Moss Altar`）。

### 16.8 図鑑
- カテゴリ：素材／道具・装備／食べ物／生き物／魚／守護者／土地。
- 入手・遭遇・釣果・訪問で解放される。未解放は「？？？」と表示する。
- 各項目に名前・英語・説明（2 行）・出現場所。

### 16.9 実績（20 個）

| id | 名前 / EN | 条件 |
|---|---|---|
| first_light | 最初の灯 / First Light | 焚き火を置く |
| toolmaker | 道具職人 / Toolmaker | T2 の道具を作る |
| deep_digger | 掘り進む者 / Deep Digger | 壁を 300 掘る |
| angler | 深庭の釣り人 / Angler | 5 種類の魚を釣る |
| gardener | 苔の庭師 / Gardener | 15 回収穫する |
| chef | 地底の料理人 / Underground Chef | 料理台のレシピをすべて作る |
| builder | 灯の建築家 / Architect | 建材と装飾を 150 個置く |
| lamplighter | 点灯夫 / Lamplighter | 照明を 25 個置く |
| ferryman | 渡し守 / Ferryman | 橋を 10 個置く |
| guardian_moss | 苔冠を鎮めて / Moss-Crown Quelled | モルグを撃破 |
| guardian_crystal | 聖歌の終わり / The Choir Falls Silent | プリズマを撃破 |
| guardian_ember | 最後の火夫 / The Last Stoker Rests | イグナルを撃破 |
| untouched | 無傷の儀 / Untouched | 守護者を無傷で倒す（`boss.tookDamage=false`） |
| recovered | 灯は消えず / Not Extinguished | 遺灰袋を回収する |
| hearth | 炉心再生 / Hearth Reborn | 炉心を再生する |
| swift | 速き灯守 / Swift Keeper | プレイ時間 45 分以内に再生 |
| steadfast | 揺るがぬ灯 / Steadfast | 「標準」で、一度も死なずに再生 |
| golden | 黄金の残り火 / Golden Ember | 黄金の残り火魚を釣る |
| feast | 宴 / Feast | 黄金の宴を食べる |
| chronicler | 深庭の記録者 / Chronicler | 図鑑の 80% を解放する |

実績はセーブごとに記録し、全セーブ共通の一覧（`emberveil.v1.achievements`）にも追加する。タイトルからは共通の一覧を見られる。

### 16.10 ヒント（各セーブで 1 回だけ。トースト）
`move`（開始時）、`gather`、`craft`（最初に作れるようになったとき）、`station`（ステーション不足で作れなかったとき）、`dark`（初めて暗所に入ったとき：「灯りの近くでは敵が湧かない」）、`telegraph`（初めて予告を見たとき：「光る範囲から離れるか、回避で抜けよう」）、`heat`、`bridge`（裂け目から 3 タイル以内に入ったとき）、`fish`（釣竿を持って水に近づいたとき）、`satchel`（死亡後）、`return`（初めて死亡したとき、または閉じ込められているらしいとき）。

### 16.11 クレジット
- 『残り火の深庭 / EMBERVEIL』
- 企画・ゲームデザイン — Claude Opus（Anthropic）
- シミュレーション・UI 実装 — Claude Sonnet（Anthropic）
- アート・描画・サウンド — Codex（OpenAI）
- 制作・監修 — rirtir
- 技術 — HTML / CSS / JavaScript（外部ライブラリ不使用）
- Thanks for playing.

---

## 17. 設定・アクセシビリティ

### 17.1 設定項目（`emberveil.v1.settings`）

| key | 表示 | 型 / 既定値 |
|---|---|---|
| soundOn | 音 / Sound | bool / true |
| volume | 音量 | 0〜10 の整数 / 7（± ボタン） |
| reduceMotion | 動きを減らす / Reduce Motion | bool / `prefers-reduced-motion` の値 |
| screenShake | 画面の揺れ | bool / true（reduceMotion 中は無効扱い） |
| difficulty | 難易度（現在のセーブに適用） | 'gentle' / 'standard'（いつでも変更可） |
| autoTool | 道具の自動切替 | bool / true |
| showDamageNumbers | ダメージ数値 | bool / true |
| highContrastTelegraph | 予告を強調 | bool / false |
| objectiveArrow | 目標の方向を表示 | bool / true |
| uiScale | UI の大きさ | 100 / 125 / 150 |
| touchControls | タッチ操作ボタン | 'auto' / 'on' / 'off' |

キー割り当ては表示のみ（変更はできない）。

### 17.2 難易度の倍率

| | 被ダメージ | 予告時間 | 空腹の減少 | ボスHP | 釣りの受付 |
|---|---|---|---|---|---|
| 穏やか / Gentle | ×0.6 | ×1.25 | ×0.7 | ×0.85 | 1.3s |
| 標準 / Standard | ×1.0 | ×1.0 | ×1.0 | ×1.0 | 0.9s |

### 17.3 動きを減らす
- 描画：画面の揺れなし、全画面の点滅なし、粒子 ×0.3、パララックスの強さ ×0.2、予告は脈動させず静止した塗りで表示、ヒットストップは 30ms、画面端の矢印は揺らさない。
- UI：トランジションとアニメーションなし（`.ev-reduce-motion` クラスと `@media (prefers-reduced-motion)`）。クレジットは自動スクロールしない。

### 17.4 その他
- メニューの操作要素はすべて `<button>` などの標準要素で、`:focus-visible` で金の輪郭を表示する。
- タッチの押せる範囲は 44px 以上。トーストは `aria-live`。ダイアログは `role="dialog"` とフォーカストラップ。
- 予告は色だけに頼らない（§11.8）。

---

## 18. 美術・描画仕様（Codex 向け）

### 18.1 基本
- 元絵は 16px タイル。画面上は**整数倍**で拡大し、`imageSmoothingEnabled=false`。表示範囲は横 20〜32 タイル、縦 12〜18 タイルになるように倍率を選ぶ。
- スプライトの大きさ：プレイヤー・雑魚 16×16（コウモリ・蛾は 16×16、亡者は 16×24）。ボスは 32×32（モルグ・イグナル）と 24×24（プリズマ）。アイテムアイコン 16×16。
- 描画の基準点：アクターは足元の中心（`x, y`）、タイルは左上。
- スプライトキーの規約：`tile.<groundKey>`、`wall.<wallKey>`、`build.<buildKey>`、`obj.<objectKey>`、`item.<itemKey>`、`enemy.<enemyKey>`、`boss.<bossKey>`、`player`、`fx.<name>`。`data.js` の各定義に `sprite` を置く（既定は規約どおり）。
- 壁は 4bit の autotile。下側が空いている壁には 8px の正面（擬似的な高さ）を描く。**当たり判定は常にタイルの格子**で、見た目のはみ出しは判定に影響しない。

### 18.2 描画順
1. 深層のパララックス（地層・遠くの発光。裂け目とマップ外に見える。カメラに対して 0.5 倍で動く）
2. 地面（16×16 チャンクのキャッシュ。`chunkVersion` が変わったら作り直す）
3. 建築の床・橋
4. 地面の装飾（苔の斑、水たまり、水面の金の反射）
5. 予告（warn 状態の hazards）
6. y ソートした層：壁の正面、オブジェクト、ドロップ、アクター、ボス
7. 発動中の hazards、投射物
8. 粒子
9. 光：暗さを乗算で重ね、光源の色を加算で重ねる。`world.lights` と `world.light` を使い、プレイヤーの灯りは描画時に動的に加える
10. 前景のパララックス（垂れた根・水滴。1.15 倍、低い不透明度）
11. 画面効果：周辺減光、被弾時の縁の赤み、低 HP 表示、ダメージ数字、狙いの枠、設置のゴースト、目標の矢印

### 18.3 パレット（基準。追加しても構わないが、全体の調子は守る）

| 用途 | 色 |
|---|---|
| 深い闇 | #07090c #0b0f14 #121a21 #1a2630 |
| 岩 | #2a3540 #3b4a56 #56656f #7c8a90 |
| 苔 | #1f3a2c #2e5a3c #4b7f45 #7fae5a #b5d77a |
| 発光菌（青緑） | #1d6f73 #2fb3a6 #6ff0d2 #c8fff2 |
| 結晶 | #3a3f8f #5c6fd6 #8fb4ff #d8e6ff #b48ce0 |
| 残り火・金 | #5a2414 #a8431c #e0742a #f7b54a #ffe39a |
| 溶岩 | #ff5a1f #ffd36b |
| 水 | #12303f #1e5266 #3c8fa3 |
| UI | 面 #10161c（不透明度 85%）、線 #c9a45a、文字 #ece4d0、補助 #9aa7a8、危険 #e0583a |

### 18.4 バイオームの美術方針
- **祠**：古い石畳に金の象嵌。消えた炉心は黒い鉄と灰。再生後は金色の脈動と、周囲の苔に金の照り返し。
- **苔庭**：濡れた暗い岩に厚い苔の縁。青緑に光る茸、滴る水、池に映る灯の金色の揺らぎ、巨大茸の傘の裏の発光。
- **結晶洞**：藍と菫の岩、青白い結晶柱。縁にごく控えめな分光。裂け目の底にパララックスの奥行き、低い霧。
- **灼熱遺跡**：黒い玄武岩と赤錆の煉瓦、溶岩の川、昇る火の粉、遺構の金の装飾、熱気の揺らぎ（動き低減では止める）。

### 18.5 粒子（上限 600、動き低減では 180）
胞子（青緑・ゆっくり上昇）、水滴、火の粉、結晶のきらめき、採掘の破片（壁の色）、命中の火花、足元の土埃、回避の残像、焚き火の煙、釣りの波紋、核の吸収、炉心再生の光の波。

### 18.6 演出の要件
- 採掘のひび：`wallDamage.dmg/max` で 3 段階。
- 被弾：白く光る 0.1s。
- 撃破：粒子とともに消える。
- ボスの第 2 段階：色調の変化。
- 鏡像の本体：0.8s ごとに金のきらめき（`boss.glintT`）。
- 炉心再生：`ending.phase` が `absorb`（核が飛び込む） → `bloom`（光の波が地図全体へ広がる）。

---

## 19. 音（Codex 向け）
- 音色の方針：静かで湿った空気感。柔らかなパッドと五音音階のまばらな旋律。打撃音は短く乾いた音。UI 音は控えめなガラス・木の音。
- バイオームの環境音と音楽を 2〜3 秒でクロスフェードする。ボス戦は打楽器の脈動を加える。エンディング後は長調の明るい層に変える。
- 予告音（`telegraph`）は攻撃の種類ごとに音程を変え、聞くだけでも予告に気づけるようにする。
- `setEnabled(false)` のときは完全に無音で、AudioContext もできるだけ suspend する。

---

## 20. CSS 方針（game.css）
- 共通 CSS を先に読み込み、ゲームの CSS は**`.ev` と `.ev-page` の配下だけ**に適用する（共通 CSS そのものは変更しない）。
- `body.ev-page` で上書きするのは `margin:0; overflow:hidden; background:#07090c; height:100dvh` だけ。共通 CSS のヘッダーやナビがゲーム画面と干渉する場合は、`.ev-page` の配下で非表示または位置調整にとどめる（**実装時に共通 CSS を読んで確定**）。
- CSS 変数：`--ev-bg --ev-panel --ev-line(#c9a45a) --ev-text --ev-sub --ev-teal --ev-ember --ev-danger --ev-scale`。
- フォント：システムフォントのみ（`"Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",system-ui,sans-serif`）。英語の副題は `letter-spacing:.18em; font-size:.72em; text-transform:uppercase; color:var(--ev-sub)`。
- 重なり順：canvas 0、hud 10、touch 20、overlay 30、toasts 40、dialog 50。
- `env(safe-area-inset-*)` に対応する。`user-select:none` はゲーム領域だけ（入力欄は除く）。
- 見た目：細い金の線、半透明の暗い面、角丸は 2px 以下、影は控えめに。ドット絵と喧嘩しない静かな画面にする。

---

## 21. 時間・数値の一覧（`DATA.BALANCE`）

| 区分 | 値 |
|---|---|
| 固定ステップ | 1/60s、1 フレーム最大 5 ステップ |
| オートセーブ | 60s |
| ドロップの消滅 | 600s（遺灰袋は消えない） |
| 自然物の再生 | 茸 300 / 光茸 180 / 苔草 240 / 瓦礫 150 / 晶花 400 / 野生植物 360 / 幼体 180 |
| 敵の出現 | 3.5s 間隔、11〜18 タイル、上限 9 / 11 / 11、消去は 30 タイル・10s |
| 安全地帯 | 祠 14 タイル、ベッド 6 タイル、safeLight ≥ 0.45 |
| 光 | 環境光 0.08 / 0.12 / 0.16、エンディング後 +0.30、苗床に必要な光 0.35 |
| 睡眠 | +120s、空腹 -15、再使用 60s、8 タイル以内に敵がいると不可 |
| 帰還 | 4.0s |
| 釣り | 投げる 0.4s、待ち 2〜6s、受付 0.9 / 1.3s、早すぎたら +1s |
| 上限 | 敵 14（ボス戦の召喚を含む）、投射物 64、ハザード 48、ドロップ 300、粒子 600、オブジェクト 8000、箱 64 |
| 生成 | 世界 128²、苔庭の半径 34、スタンプ 17² / 15²、通路幅 3、必須の橋：木 4・石 2 |

---

## 22. 担当別の完了条件

**Sonnet（data / world / ui / main / index / css）**
- 同じ seed から常に同じワールドができる。生成レポートの保証項目がすべて満たされている。
- §4〜§12 のすべての要素が実際に遊べる：採掘、採集、クラフト、設置、撤去、収納、農業、釣り、料理、睡眠、死亡と回収、3 ボス、エンディング、自由建築。
- §13 の API をこの名前と型どおりに実装している。renderer / audio が無くても、空のスタブで動く。
- すべての画面と操作がキーボードだけで行える。タッチもドラッグなしで行える。
- 保存・検証・バックアップ・JSON 入出力・タブロック・保存不可の通知が §14 のとおり動く。

**Codex（render / audio / assets）**
- §13.7 と §13.8 の API を満たしている。`game` を書き換えない。例外を外に投げない。アセットが欠けてもフォールバックで描く。
- §18 の描画順・パレット・粒子・光・パララックス・予告の描画（ハッチと輪郭）・動き低減に対応している。
- `data.js` のすべてのキーに対して何かしらの見た目と音（またはフォールバック）がある。

**共通**
- `data.js` のキーと ID は末尾追加のみ。契約を変えるときは本書を更新してから行う。