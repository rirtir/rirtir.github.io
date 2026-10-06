# MOSSLIGHT アセット契約

DESIGN.mdの暫定仕様より、実際の `assets/manifest.json` と各 `atlas.json` を優先する。寸法・pivot・フレーム名の正本はこれらのファイルであり、以下は読み方と運用上の注意である。

## manifest と上書き

manifestの形式は `{version:1, tileSize:32, sheets:{シート名:{image,atlas,pivot,names,overrides?}}}`。image/atlasのURLはmanifestのURLを基準に解決する。

基底グループは `tiles` / `props` / `actors` / `icons`。追加シートの `overrides` がグループ名なら、そのフレームを基底グループの同名フレームへ接続する。manifest内の順に適用し、後の同名フレームを採用する。シート順を変えると原画の選択も変わるため、名前順へ並べ替えない。

上書きフレームは元シートの画像・atlas寸法・pivotを保持する。基底グループのpivotを流用したり、すべてを同じ96pxキャンバスと仮定したりしない。UIのアイコンも有効フレームが属する画像URLとatlas寸法で切り出す。

atlasは `{frames:{name:{frame:{x,y,w,h},duration,...}},meta:{pivot,image,size,...}}`。各nameは単一フレーム。連番アニメーションの選択・速度はrendererが管理する。atlasのdurationだけでゲーム内の移動速度や攻撃判定は決まらない。

## 地形と建築

地形の基準タイルは32×32、pivotは0,0。通常地形は `grass` / `darkgrass` / `dirt` / `sand` / `cave` / `moss` / `ruin` / `water` / `deepwater` / `farmland` / `path` の連番を使う。

地形境界はdual-grid用の `edge_{地形名}_{1..15}`。NW=1、NE=2、SW=4、SE=8で32pxセルの四隅を判定する。初期のshore/grassedgerストリップを回転する方式は現行描画の契約ではない。

洞窟壁は接続マスク付きの `cavewall_top0..15` と鉱種ごとの壁面を使う。露頭用のrock/copper/ironを拡大して壁へ並べる方式は採用しない。木造壁の `timber_wall0..15` はN=1、E=2、S=4、W=8の接続マスク。床、崖、屋根、家の正面は専用モジュールを使う。屋根など高さのあるタイルは32×32とは限らず、各atlasの寸法を使う。

## 小物・人物・ボス

樹木・大きな小物は96×96/pivot48,80が多いが、植物、小物、作物、正面壁、道具などは別寸法・pivotを持つ。落ち枝・小石・草は専用の小型原画を使う。家具・植物を一律に縮小して代用しない。

主人公の有効名は `hero_{down|up|left|right}_{idle0..1|walk0..3|attack0..2|roll0..2}`、基準キャンバス32×48/pivot16,40。後のシートによる差し替えを優先する。歩行・攻撃・回避は異なるポーズのフレームを使い、手持ち道具は専用の `tool_{種別}_{素材}_{0..2}` を重ねる。

住人は `npc_{cook|farmer|builder}_{down|up|left|right}_walk0..3`。料理番・農夫・建築士はそれぞれ専用原画を持つ。初期の住人を色だけ変える方式は現行の契約ではない。

通常敵はslime/beetle/wisp/shroomの各0..3。大型ボスは専用の `boss_moss_large0..3` / `boss_crystal_large0..3`、128×128/pivot64,112。小さな初期ボスの拡大を完成用アートとして使用しない。ポーズ・接地・攻撃予兆の読みやすさは実ゲームでも確認する。

## アイコンとUI

アイコンは24×24/pivot12,12。ITEMS.iconでアセット名へ接続し、有効名はmanifestのiconsグループへの上書きから解決する。素材・装備・料理・家具は専用の原画を使う。

UIのpanel/button/selected/disabled/hotbarは24×24の9分割用ピクセル枠。CSS用の `assets/ui/*.png` と、タイトルの `assets/logo/logo.png` も配布物に必要。atlasだけを出力して個別PNGを省略しない。

## 法線・height

manifestのシートに `normal` と `height` が指定されている場合、色の画像と同寸のアトラスを持つ。UIとロゴを除く37組が対象で、欠けるシートは平坦な既定値で描く。alpha・キャンバス寸法・pivot・フレーム名と順序は色のシートと一致させる（`rebuild.py` が確認する）。

- normal: R=nx、G=ny（画面上が+）、B=発光。離散62色。nzはshaderで復元する。
- height: R=高さ（px）、G=粗さ、B=描き込み光の補正gain（128=1.0、0.8〜1.25）。64色。
- 色は固定64色の `art/palette.json`。normalとheightは別の離散パレットで、色パレットとは共有しない。
- 法線はRGB輝度から作らない。alpha境界からの距離と材質・部位の近似で高さを作り、その勾配から求める。gainは旧絵に焼き込まれた左上光の陰影をnormalから弱めるだけで、完全なアルベドの復元ではない。
- 正本は `art/normalmaps/{シート名}-{normal|height}.json`。生成は `art/build_normal_maps.py`、出力は `rebuild.py`。
- 自然物・キャラクターのランダム左右反転は使わない。手持ち工具のleftだけ、normalのXを反転する。

## ソースと再構築

新規AI原画とWorkbenchで描いたドット絵を併用する。原画は `art/masters/`、減色・切り出し・修正後の編集可能ソースは `art/*.json`、保存した生成指示は `art/ART_PROMPTS.md` にある。再量子化前の制作履歴と現在の正本を混同しない。公式参考画像は比較用で、配布素材に含めない。

`python Game/Mosslight/art/rebuild.py --check-only` はソース、フレーム順、pivot、既存atlasの配置を確認する。引数なしのrebuildは保存済みJSONをWorkbenchで再出力する。元のmanifestは書き換えず、シート順、上書き、列数を保つ。生成原画の再取り込みは不要。初期heroシートのみソース名は `hero-animated.json`、他はシートと同名のJSONを使う。

`art/build_assets.py` は初期の4シートを生成しmanifestを置換するため、現在の全アセットの再構築には使わない。生成・組立スクリプトは制作工程の記録であり、単体実行で現在の全アセットが揃うとは限らない。

機械検査と視覚評価を分ける。fallbackは読み込み失敗時のために残し、正常起動ではmissing/failedが空であることを確認する。原寸のシルエット、整数倍率での実画面、アニメーションの接地とループ、昼夜・地下・建築後・ボス戦での読みやすさは別途評価する。
