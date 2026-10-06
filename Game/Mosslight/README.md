# 苔灯の境 / MOSSLIGHT

森に拠点をつくり、地下に眠る灯を取り戻す、2D見下ろしのサバイバルクラフトゲームです。採集、道具の制作、建築、農業、料理、探索、戦闘をブラウザで遊べます。

## 起動

リポジトリのルートで `python -m http.server 8765` を実行し、`http://localhost:8765/Game/Mosslight/` を開きます。ES modulesを使うためHTTP配信が必要です。ビルド工程、外部CDN、サーバー処理はありません。

## 操作

| 操作 | キー |
| --- | --- |
| 移動 | WASD / 矢印 |
| 採集・攻撃・調べる | 左クリック / E / Space |
| 回避 | Shift |
| バッグ | Tab / I |
| 制作・建築 | C / B |
| マップ・日誌 | M / J |
| ホットバー | 1〜8 |
| 閉じる・設定 | Esc |
| 取り壊し・回転 | X / R |

タッチ画面では画面内の移動・行動・回避・メニューボタンを使います。最初は落ち枝、小石、草を拾い、制作画面で石の道具を作ってください。道具は対象に合わせて自動で選びます。

## 保存

このブラウザのlocalStorageに保存します。設定画面からJSONファイルとして書き出せます。プライベートブラウズやサイトデータの削除に備え、進行後は書き出しをご利用ください。インポートは内容を検証してから行います。

## アートと音

この作品向けに新規生成したAI原画と、PixelWorkbenchで直接描いたドット絵を使用しています。原画をPixelWorkbenchへ取り込み、固定パレットへの減色、縮小、切り出し、部品・フレームの組み立てと修正を行っています。原画は `art/masters/`、保存した生成指示は [art/ART_PROMPTS.md](art/ART_PROMPTS.md) にあります。色の正本は保存済みの `art/*.json`、法線・高さの正本は `art/normalmaps/*.json` です。色は固定64色の `art/palette.json` に揃えています。参照作品の公式画面は比較だけに使い、その画像やキャラクターを配布アセットへ転用していません。TinySwordsの配布素材も使っていません。既存のサバイバルクラフトのコード・画像も使っていません。

配布物のPNG/JSONはそのまま使用でき、ゲームの起動にPixelWorkbenchや画像生成サービスは不要です。アセットを再出力する場合はPython 3.10以降、Pillow、およびこのリポジトリの `Image/PixelWorkbench/` が必要です。保存済みJSONを正本として、次の順で確認・再出力します。

```text
python Game/Mosslight/art/rebuild.py --check-only
python Game/Mosslight/art/rebuild.py
python Game/Mosslight/tests/check_assets.py
```

再出力はmanifestのシート順と上書き関係を維持し、アトラス、法線・高さのアトラス、UI個別PNGだけを更新します。原画の再生成・再取り込みは行いません。`art/build_assets.py` などの生成スクリプトは制作工程の記録で、単独実行するとmanifestが初期の4シートへ戻るものがあります。現在の全アセットを再構築する入口として使用しないでください。

PNGは整数倍率で描画します。色アトラスは39シート994フレームで、UIとロゴを除く37組に同寸・同配置・同pivot・同フレーム順の法線とheightがあります。法線は離散62色、heightは64色です。法線・heightはRGB輝度から作らず、alpha境界からの距離と材質・部位の近似で作った簡易な高さを基にしています。旧絵に焼き込まれた左上光の陰影は、法線から求めたgainで弱めるだけで、完全なアルベドの復元ではありません。

## 描画と照明

WebGL2を使える場合は、color・normal・heightの3バッファから照明を合成します。昼は左上固定の太陽、夜と地下は太陽なしです。壁タイルによる遮蔽、太陽の高さ影、局所光の高さ影、粗さによる反射を扱います。局所光はPCで8灯・8レイステップ、タッチ端末（pointer: coarse）で4灯・6ステップです。表示は整数倍率で、UIは照明の対象外です。非対応・サイズ上限超過・context lost中は従来の2D描画に切り替わります。キャラクターと自然物のランダム左右反転は廃止し、手持ち工具の左向きだけnormalのXを反転します。縦390×844のモバイル表示は、フレームバッファの面積・長辺の上限内でGL描画できます。

環境光、ランタン、地下の発光、葉と屋根の透過もゲーム側の描画です。屋根は5×5の論理屋内を覆う範囲で、24px・16pxの屋根モジュールを整数倍率で繰り返して描きます。音はWeb Audioで合成し、外部音源を使いません。詳細は [LIGHTING_PLAN.md](LIGHTING_PLAN.md) を参照してください。

## 開発・検証

Claude Code Opusが設計、Sonnetが実装、Codexが専用アセット・統合・ブラウザ検証を担当しています。設計は `DESIGN.md`、描画時のアセット契約は [ART_CONTRACT.md](ART_CONTRACT.md)。個人の使用枠・実行ごとの使用量は公開対象外のローカル台帳に記録します。単独開発との速度・精度・総トークン消費量の比較測定は行っていません。

HTTPサーバー起動後、`http://localhost:8765/Game/Mosslight/tests/` でゲームルールを検証します。ChromeとPython Playwrightがある場合は `python Game/Mosslight/tests/browser_smoke.py` で実ブラウザの操作・保存・タッチを検証できます。範囲と省略した操作は [tests/TEST_PLAN.md](tests/TEST_PLAN.md) に記載しています。照明の実ブラウザ試験は `python Game/Mosslight/tests/browser_lighting.py` です。機械検査の合格は、造形・動きや参照作品とのビジュアル比較の評価とは別で、Steam作品と同等の品質を示すものではありません。

検証用のAPIは `?debug=1` の場合だけ `window.__mosslight` に公開します。通常のゲームではデバッグ機能を表示しません。

参考にしたのは[Romesteadのレビュー](https://steamcommunity.com/app/1805320/reviews/?browsefilter=toprated)と[Core Keeperのレビュー](https://www.pcgamer.com/games/survival-crafting/core-keeper-review/)です。探索と拠点づくりが互いに役立つ進行、明確な目標、資源の再生、回収できる死亡時の資源袋を設計に取り入れています。
