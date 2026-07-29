# 黎明列車 2.1 画像・音声資産台帳

最終更新: 2026-07-29 / 状態: 画像28点・BGM 5曲・効果音12点を採用、画面実装済み

## 生成・利用方針

- 生成手段: OpenAI 組み込み `image_gen`
- 生成モード: `stylized-concept`（ゲーム用コンセプトアート／プロダクションアート）
- 画像内文字: 生成しない。題字・数値・アイコンはHTML/CSS/SVGで実装する。
- 保存形式: 生成原寸PNGから、品質88・method 6のWebPへ変換。
- 最終容量: WebP 28点で約7.6MB。全ファイルをローカル同梱し、外部URLや実行時生成には依存しない。
- 採用基準: 顔・手・車輪・線路・機械構造に破綻がないこと、章色と琥珀光がアートガイドに一致すること、UIを重ねても焦点が競合しないこと。

## 採用資産

| 区分 | ファイル | 用途 | 寸法 | 状態 |
|---|---|---|---|---|
| キーアート | `assets/art/key/title-train.webp` | タイトル・導入 | 1672×941 | 採用 |
| 列車断面 | `assets/art/train/train-cutaway.webp` | 旅・戦闘・整備 | 1942×809 / RGBA | 黒背景を除去した透過版を採用 |
| 章背景 | `assets/art/backgrounds/chapter-1-ash-yard.webp` | 灰の始発駅 | 1672×941 | 採用 |
| 章背景 | `assets/art/backgrounds/chapter-2-canal.webp` | 沈みゆく運河都市 | 1672×941 | 採用 |
| 章背景 | `assets/art/backgrounds/chapter-3-iron-forest.webp` | 鉄喰いの森 | 1672×941 | 採用 |
| 章背景 | `assets/art/backgrounds/chapter-4-black-crystal.webp` | 黒晶坑道 | 1672×941 | 採用 |
| 章背景 | `assets/art/backgrounds/chapter-5-ice-plain.webp` | 白夜氷原 | 1672×941 | 採用 |
| 章背景 | `assets/art/backgrounds/chapter-6-twin-capital.webp` | 双子首都 | 1672×941 | 採用 |
| 章背景 | `assets/art/backgrounds/chapter-7-lighthouse.webp` | 東端灯台 | 1672×941 | 採用 |
| 背景 | `assets/art/backgrounds/garage.webp` | 車内整備工廠 | 1672×941 | 採用 |
| 人物肖像 | `assets/art/portraits/{kureha,gaku,mina,sui,nagi,teto,rikka,orun}.webp` | 会話・戦術・編成 | 972×1619 | 8点採用 |
| ボス | `assets/art/bosses/{varga,nereis,ferroa,mole,isberg,alba,nox}.webp` | ボス登場・戦術駒 | 972×1619 または1122×1402 | 7点採用 |
| 結末 | `assets/art/endings/{ignite,divide,weave}.webp` | 3種エンディング | 1672×941 | 3点採用 |

## 実際に用いた共通プロンプト核

```text
Use case: stylized-concept.
Asset type: 2D narrative strategy game production art.
Hand-painted graphic realism with Japanese woodblock-like decisive contours,
textured gouache and charcoal, late-industrial railway world, grounded materials
and practical clothing. Nocturnal cinematic lighting; the only saturated light
is amber from the artificial sun core. Palette: obsidian black, soot gray, bone
paper, tarnished brass, restrained chapter accent. Deliberate readable silhouette,
coherent railway engineering, production-ready game art. No text, letters, logo,
or watermark. Avoid pixel art, 8-bit aesthetics, glossy generic sci-fi, neon
cyberpunk, decorative gears, chibi proportions, gacha excess, steampunk costume
cliché, malformed hands, disconnected wheels or rails.
```

## 個別プロンプトセット（共通核への追記）

### キーアートと列車

- `title-train`: 黒い装甲蒸気列車を右向きの三分の二側面で配置。機関中央に檻状の人工太陽、上空に巨大な夜蝕、右奥に東端灯台。左下は題字用の静かな暗部。壮大だが英雄ポスターの誇張は避ける。
- `train-cutaway`: 機関車と5つのモジュール車両を厳密な横向き正投影で連結。各車両の三層内部を見せ、砲・工房・医務・機関装置を機能的に描く。暗い無地背景、透視図的な歪みなし。2.1で背景色 `#0e0e0e` をクロマキーとして抽出し、列車本体の暗部を保護した透過WebPへ差し替えた。

### 背景

- `chapter-1-ash-yard`: 灰に埋もれた巨大操車場、壊れた信号塔、遠い工業都市、橙の地平線。下部に横方向の線路。
- `chapter-2-canal`: 水没した運河都市、水門、石造橋、雨と青緑の反射、下部に堤防上の線路。
- `chapter-3-iron-forest`: 廃車と線路を根に変える金属樹海、信号灯の胞子、苔色の差し色。
- `chapter-4-black-crystal`: 光を吸う黒晶坑道、崩れたアーカイブ設備、紫灰の結晶反射、線路トンネル。
- `chapter-5-ice-plain`: 凍結した避難灯と集落、吹雪、青白い氷原、地平線上の細い暖色光。
- `chapter-6-twin-capital`: 首都を二分する高架複線、並走可能な長い直線、白い官僚建築と煤けた市街。
- `chapter-7-lighthouse`: 黒い海、崖上の巨大灯台、空と海を巻く夜蝕渦、終着線。
- `garage`: 暗い車両工廠、検査灯、工具台、蒸気、油染み、列車を横から収められる開けた中央部。

### 人物肖像

全員を縦長の腰上肖像、同じ列車内・同じ画材・同じ琥珀逆光で統一。顔、体格、年代、職能道具を重複させない。

- `kureha`: 30代の女性車掌兼指揮官。黒い実用外套、赤褐色の襟、真鍮の切符鋏、冷静な正面視。
- `gaku`: 60代の男性機関士。煤けた作業着、革エプロン、大型スパナと圧力計、疲れた責任感。
- `mina`: 20代後半の女性砲手。短髪、厚い射撃外套、照準器、軍歴を感じる硬い姿勢。
- `sui`: 30代の女性医師。実用的な医療外套、革の救急鞄と包帯、強い共感と決断力。
- `nagi`: 20代前半の斥候。細身の防水外套、信号灯と双眼鏡、運河育ちの軽快さ。
- `teto`: 10代半ばの信号聴取者。大きめの保守外套、手作り受信機とケーブル、警戒と好奇心。
- `rikka`: 30代の坑道爆破技師。頑丈な作業服、保護眼鏡、起爆器と工具、豪胆な笑み。
- `orun`: 40代の避難灯統計官。層状の防寒服、記録板と計算尺、数字の向こうを見る慎重さ。

### ボス

縦長の脅威肖像。環境と機能が一目で異なる実用機械／異形生物として描き、通常敵より大きな暗部と章色を持たせる。

- `varga`: 前面装甲と巨大砲を備えた黒い略奪機関、赤い布片、灰の操車場。
- `nereis`: 水門と融合した多脚の水圧獣、青緑の濁流と配管。
- `ferroa`: 廃車を幹にした群体母樹、信号核、金属根と苔色の発光。
- `mole`: 黒晶鎧の巨大掘削機、王冠状ドリル、紫灰の粉塵。
- `isberg`: 線路下から出る氷殻巨獣、機関熱へ向く青白い裂け目。
- `alba`: 白い装甲列車の正面、規律的な砲列、双子首都の高架線。
- `nox`: 灯台を覆う夜蝕核、機械と雲の境界が曖昧な巨大球、紫黒の引力線。

### エンディング

- `ignite`: 灯台から放たれた一本の朝が西へ走り、列車と街を金橙色に照らす。犠牲を伴う強い夜明け。
- `divide`: 暁核が七つの小さな灯へ分かれ、夜の大地に孤立した安全圏を結ぶ。静かな猶予。
- `weave`: 夜蝕が紫金の薄明の網へ書き換わり、街・線路・列車を有機的につなぐ。夜と朝が共存する新しい空。

## 実装確認

- タイトル、導入、旅、会話、路線、戦闘、整備、ボス、終幕に実装済み。
- 1440×900および390×844でトリミングを確認済み。
- 全WebPがHTTP 200で読み込まれ、実行時の外部通信はない。
- PNG生成原本は実装確認後に除外し、公開物にはWebPだけを残す。
- 列車断面はRGBA、アルファ範囲0～255、四隅アルファ0を確認。章背景上へ合成した1366×768画面で黒い矩形が残らないことを確認した。

## オリジナル音源

外部の楽曲・録音素材・効果音ライブラリは使っていない。`tools/generate_audio.py` が、加算合成、ノイズ励振、物理モデリング風の撥弦、フィルター、反射残響から32kHzステレオVorbisをオフライン生成する。ゲーム中は完成済みのOggを再生するだけで、実行時合成や外部通信は行わない。

### BGM

| ファイル | 場面 | 長さ | 主な音色 |
|---|---|---:|---|
| `assets/audio/bgm/title.ogg` | タイトル・導入 | 64秒 | 低音弦、柔らかいピアノ、遠い金属共鳴 |
| `assets/audio/bgm/journey.ogg` | 旅・会話・路線・整備 | 64秒 | 擦弦、撥弦、木管、低い車輪リズム |
| `assets/audio/bgm/battle.ogg` | 通常戦 | 48秒 | 弦の反復、胴鳴り、金属打音 |
| `assets/audio/bgm/boss.ogg` | ボス戦 | 56秒 | 低音弦、重い膜鳴り、不規則な鉄音 |
| `assets/audio/bgm/ending.ogg` | 結末 | 64秒 | ピアノ、木管、広がる弦 |

全曲はループ境界の160msをゼロクロスへ寄せ、デコード後の境界ジャンプを0.002未満に抑えている。場面変更時は `audio.js` が約1.15秒でクロスフェードする。

### 効果音

`assets/audio/sfx/` に `confirm`、`lever`、`cancel`、`paper`、`story`、`move`、`attack`、`hit`、`repair`、`steam`、`victory`、`defeat` の12点を同梱する。矩形波、ノコギリ波、単音ビープ、勝利アルペジオは使用せず、紙、木、鉄、蒸気、車体の胴鳴りを複数の帯域へ分けて重ねている。

### 音源検証

- 17ファイルすべてを32kHz・2chとして完全デコードし、無音・クリップ・破損がないことを確認。
- Chromeの `file://` と静的HTTP配信で17/17のメタデータ読込、タイトルBGMの実再生を確認。
- `title → journey → battle → boss → ending` の切替、ミュート停止、復帰、BGM/効果音の個別音量保存を確認。
