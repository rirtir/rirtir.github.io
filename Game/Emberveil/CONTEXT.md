# 共同開発の文脈

この文書はClaudeへ渡した実装時の文脈です。主要実装終了後の統合・独立レビューで契約を拡張しています。最終的なAPIは [API.md](API.md) を参照してください。現在のtileAtには素材キーとchasm/void、能力表示にはgetEquipmentStats、RendererにはgetItemIconURLもあります。現在の描画は正規化した状態に加えて、作物とハザード等の読み取り専用の実状態も参照します。

対象は `Game/Emberveil/`。既存ゲームは参照・変更しない。素のHTML/CSS/ES modules、GitHub Pagesでビルド不要、UIとコメントは日本語。共通CSSを `../../css/common-style.css` として先に読み込む。body背景、buttonのflex/padding/border-radius/font、h1フォントサイズが共通定義されているので本作CSSは `.game-app` 内またはbody.emberveilに限定して上書きする。

Codex担当: `render.js`, `audio.js`, `assets/`, `tests/`, `dev/`, README、ルートlinks.js。Claudeはこれらを変更しない。Sonnet担当: `data.js`, `world.js`, `ui.js`, `main.js`, `index.html`, `style.css`。合意したAPIを変える場合は `API.md` を書いてCodexに伝える。コマンド実行、ネットワーク、別エージェントの起動、git操作、対象外のファイル編集は行わない。

Renderer API: `new Renderer(canvas, game)`, `await renderer.load()`, `renderer.resize()`, `renderer.render(dt)`, `renderer.screenToWorld(clientX,clientY)` → `{x,y}` (タイル座標)。`renderer.zoom` = 初期2、1～3。`renderer.reducedMotion` = bool。`renderer.drawMinimap(canvas, large=false)`。`renderer` はgame状態を変更しない。

## 描画データの受け渡し（DESIGNと異なる場合こちらを優先）

world.jsのGameに `getRenderState()` を実装し、シミュレーション内部の設計は保ったまま以下の読み取り専用オブジェクトを返す。配列は変換済みをキャッシュするか、参照を返すこと。

- `width,height`: タイル数。`tileAt(x,y)` → `{kind,biome,ore}`。kindはfloor/wall/water/lava/bridge/woodfloor/stonefloor/farm、biomeは0/1/2、oreはnull/copper/crystal/ember。掘った壁・橋・床は最新の状態を返す。
- `player`: `{x,y,faceX,faceY,moving,attackTimer,invuln,dead}`。タイル座標。dead中も位置を返す。
- `objects`: 描画可能な資源・設置物・祭壇・墓をまとめた配列。各 `{id,kind,x,y,hp,maxHp,growth}`。kindはtree/mushroom/violet/goldtree/copper/crystal/ember/roots/workbench/furnace/chest/cabin/altar/arch/farm/logs/campfire/torch/bed/wall/gravestone。wallはtileAtでwallでもよい。x,yはタイル中央の小数座標。木の成長・農園の進行などgrowthは0～1。
- `enemies`: 敵と活動中ボスをまとめた配列。各 `{id,kind,x,y,hp,maxHp,faceX,moving,hitTimer,boss,telegraph}`。kindはslime/skeleton/orc/chort/warden_moss/warden_crystal/warden_ember。bossはbool、telegraphはnullまたは `{kind:'circle'|'cone'|'line',x,y,radius,angle,width,progress}`。攻撃予告の世界座標と危険範囲。ボスspriteの対応はrendererが決める。
- `effects`: 任意の短時間視覚イベント `{kind,x,y,text,age,duration,color}`。kindはhit/slash/pickup/hurt/build/dodge/fish/heal/death/victory、age/durationは秒。world.jsでageを更新し期限後に除去、rendererは変更しない。
- `explored`: 128x128フラット配列の0/1、`visible(x,y)` → bool（任意。なければプレイヤーから13タイル以内を可視とする）。タイトル表示時には既知領域も表示し、霧で真っ暗にしない。
- `aim`: `{x,y}`（タイル座標）、`buildPreview`: nullまたは`{kind,x,y,valid}`（設置可能性判定はworld.js）。`time`: 経過秒。`mode`: title/playing/paused/dead/ending。`questMarker`: nullまたは `{x,y}`。

Codexのrender.jsはこの読み取り専用契約だけに依存。Rendererに実体Gameを渡し、ゲーム側のDOMやクラフトや収納には本来の内部APIを使う。Sonnetは内部API詳細をAPI.mdにも記述すること。`renderer.drawMinimap`はexploredとtileAtを使用。

Audio API: `new AudioEngine()`, `await audio.unlock()`, `audio.setEnabled(bool)`, `audio.update(game,dt)`, `audio.play(name)`。効果音名 mine/chop/attack/hurt/pickup/craft/build/eat/dodge/fish/boss/victory/ui。初回ユーザー操作でunlockする。audio.jsを変更せず利用する。

ビジュアル: ユーザー追記『ドット風ではなく厳密なドット絵』を最優先。2倍程度に整数拡大する低解像度Canvas。画像の縮小による疑似ドットは禁止。元のドット素材と整数座標・固定パレットの直接描画のみ。ゲーム画面はimageSmoothingEnabled=false、CSS image-rendering:pixelated。UI以外にSVG/絵文字/ベクター図形/アンチエイリアスや非整数スケールを使わない。苔の地下庭園、青緑の発光茸、琥珀色の灯火、紫の結晶、石の遺跡。UIはほぼ黒の緑紺背景、細い金色の枠、淡いクリーム文字、セリフの英語見出しと読みやすい日本語本文。HUDは余白多め、小ぶりでゲーム景色を遮らない。開始画面もrendererで描画された動く庭園を背景とし、落ち着いた大きなタイトル、短い導入、新しい旅/続きから/設定/遊び方/クレジット。全部を一枚の常設UIに詰めない。

アセット: `assets/pixel-atlas.png` + `assets/pixel-atlas.json` は固定パレットで1ドットずつ直接描画したオリジナル素材。`assets/dungeon/*.png` は0x72のCC0配布。キャラクターknight_m/elf_f/elf_m/lizard_m、敵tiny_zombie/skelet/orc_warrior/chort、ボスbig_zombie/ogre/big_demon、装備weapon_*、アイテムflask_*。通常のキャラはidle/run各4フレーム。Rendererが読み込んで描画する。UIアイコンには利用可。AtlasのCSS画像をUIアイコンにする必要はない。生成AIの庭園画像は不採用。

必要な異常系: localStorageが拒否されても起動し警告、壊れたデータは正常スロットを守る、読み込み前に厳密に検証、同時タブはownerリース＋操作権の明示引き継ぎ、document.hiddenとポーズとダイアログ時の停止、dtの上限、keyのblurリセット、touch pointercancelとpointercapture管理、canvas座標はrenderer.screenToWorldを使用、会話フォーカスとEscape復帰。スマホは安全領域を考慮し歩行用ジョイスティックとアクションボタンがHUD/hotbarと重ならないこと。
