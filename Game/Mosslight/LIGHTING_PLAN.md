# LIGHTING_PLAN（設計Opus / 実装Sonnet: renderer.js・lighting.js / アセット・統合検証Codex）

## 実装との対応（2026-10-06）

以下の設計案のうち、実装・manifest・`renderer.js`・`lighting.js` と食い違う箇所は実装を優先する。

- 色・normal・heightは同寸・同配置・同pivot・同フレーム順。色シート39・994フレーム、normal/heightはUI・ロゴを除く37組。色は固定64色（`art/palette.json`）、normalは離散62色、heightは64色。
- normalはRGB輝度から作らない。heightはalpha距離と材質・部位の近似で、gainは旧絵の左上焼き込みをnormalから弱めるだけ。完全なアルベド復元ではない。
- 光は、昼の左上固定の太陽、夜・地下のsun=0、壁タイル遮蔽、太陽の高さ影、局所光の高さ影、粗さ反射。局所光はPC 8灯/8ステップ、pointer:coarse 4灯/6ステップ。
- 整数拡大で描き、UIは照明の外。framebufferは長辺960以内かつ面積960×540以内（縦390×844も範囲内でGL可）。超過・非対応・context lost中は2D fallback。
- 自然物・キャラクターのランダム左右反転は削除済み。手持ち工具のleftだけnormalのXを反転する。`name_v0..v2` の変種選択は納品済みの絵だけが対象で、未納品は `v0` のみ。
- 屋根の旧「105px」制約は撤回した。5×5の論理屋内を覆えず室内が外へ露出したため。現在の屋根は上端 `t*TILE-12`、下端 `b*TILE+28-FACADE_H+2`（`FACADE_H=56`）で、24px・16pxの屋根モジュールを整数で反復する。
- P1・P2は実装済み。`getLightingStats()` の `ms.gl` はCPUのGL発行時間で、GPU時間ではない。RAF中央値約16.7msは、headless Chromeの同一PCとそのモバイルエミュレーションでの値であり、物理端末の速度は保証しない。
- 検証結果は `tests/TEST_PLAN.md` を参照。機械テストの合格はSteam同等の品質を証明しない。

ユーザーの照明要望は旧計画の「lighting禁止」より優先する。静的ES modulesと2D描画を維持し、WebGL2は後段の合成だけに使う。開始は別Sonnetのrenderer/world編集が終わってから。

## 1. 描画パイプライン
GLモード時は`ctx`を等倍のcolorCvへ差し替える（transformは`1,0,0,1,-camX,-camY`、camは整数）。`blit`は同じ座標へ`fr.nimg`/`fr.himg`をnormalCv/heightCvにも描く。blit以外の塗り（接地影・telegraph）はcolorCvだけに描く。lighting.jsが3枚とタイル遮蔽テクスチャをuploadし、1quadを描いて可視canvasへnearest・×Sで転写する。その後でvignette・flies・particles・focus・preview・文字をS倍で描く。framebufferの上限は長辺960・面積960×540。上限超過・非対応・context lost中は現行の2D lightPassを使う。GL時は2Dの暗幕とglowを描かない（二重照明の防止）。`screenToWorld`/`worldToScreen`と入力処理は変えない。

## 2. テクスチャ契約
manifestのsheetに`normal`と`height`を追加する。元画像と同じ寸法・frame配置・pivot・frame名にする。欠落時は平坦な既定値を使う。
- normal: R=nx、G=ny（画面上方向が+）、B=発光（火・紙灯・focus輪郭）。nzはshaderで復元する。
- height: R=高さ0〜64px、G=roughness、B=描き込み光の補正gain（128=1.0、0.8〜1.25に制限）。

Codexの`art/build_normal_maps.py`で、樹冠・岩はalphaシルエットの距離ドームにWorkbenchで描く補正heightfieldを足し、地面は材質パレットごとに0〜2pxの起伏を付ける。normalは高さの勾配から作り、RGB輝度の微分は使わない。火や紙の明るさは高さに入れない。これは2.5Dの近似で、完全な3D形状ではない。

## 3. 反転と描き込み光
自然物のランダム左右反転（renderer 548/583/591/612-617/643/782）は廃止し、hashで`name_v0..v2`を選ぶ（未納品の間はv0のみ）。worldの`node.flip`は残っていても無視する。主人公と道具の向き別flipは維持し、normal版はR=255-Rにする。描き込み陰影の補正gainは、Codexが元のnormalと左上の参照光Lrefから事前に計算してheight Bへ焼く。gainは画素ごと反転されるので、反転後も正しく効く。輪郭線・AO・色相シフトは除去できない。新規の絵は描き込みを弱めにし、既存の絵はgainの上限内でstyle-boardと比較して揃える。

## 4. 光モデル
`out = albedo·gain·(sky + sun·max(0,N·Ls)·影 + Σ局所光) + 発光`
- 昼: Lsは左上固定(-0.5, 0.5, 0.7)。全物体の影が同じ方向に落ちる。朝夕は現行の`warm`でsunの色温度を補間する。天候はuniformの予約だけ。
- 夜・地下: sun=0。skyは最低値（夜=nightLight相当の青、地下=caveLight）。arenaLiftは現行どおりskyへ加算する。
- 局所光: 色×(1-d/r)²×max(0,N·Ll)×flicker（calm時は揺らぎ0）。光源までの間をタイル遮蔽（固体壁・屋内）で8サンプル判定し、壁越しには照らさない。屋内ではsunを切り、skyを0.6倍にする。
- 影はheight bufferを光の方向へstep走査して作る。大きなbloomは使わない。
- 品質: mobile（pointer:coarse）は4灯/6step、PCは8灯/8step。上限を超えた灯は寄与の小さい順に切る。GLが中央値6ms超を3窓続けたら自動で2Dへ戻す。

## 5. 工程
P1: flip廃止、描画順の変更、normal＋太陽＋局所光（タイル遮蔽）＋太陽の一方向影、2D fallback。P2: 局所光のheight ray影、gain調整。P1の検証が通るまでP2に入らない。

## 6. 検証（seed・clock 200/420/520・`view.cam`・calmを固定し、before/afterを比較）
1. 昼: 全物体の陰影と影が左上光で揃い、反転がない
2. 夜: 光源のない領域が暗く、statsでsun=0。地下もsun=0
3. 光源を岩の左右へ動かすと照らされる面が入れ替わる。主人公のleft/rightでnormal表示のnxが反転する
4. 地面に低い起伏と方向のある陰影が出る
5. PCとmobileでglErrors=0。120frameの中央値でGLがPC≤2ms、mobile≤4ms

## API
| API | 内容 |
|---|---|
| `createLighting(opts)` → `L` / `null` | lighting.js。WebGL2が使えなければnull |
| `L.render(color, normal, height, occ, u)` | 1quadを描いてGL canvasを返す |
| `L.resize(w,h)` / `L.dispose()` | context lost/restoredで再生成 |
| `renderer.setLightingMode('auto'\|'gl'\|'2d')` | 既定はauto |
| `renderer.setLightingDebug('off'\|'normal'\|'height'\|'shadow'\|'light')` | 検証用の表示 |
| `renderer.getLightingStats()` | `{mode, reason, lights, culled, steps, w, h, ms:{scene,upload,gl,copy}, glErrors, contextLost}`。getErrorは60frameごと（debug時は毎frame） |

参考: https://registry.khronos.org/webgl/specs/latest/2.0/ ／ https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Lighting_in_WebGL
