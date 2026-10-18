# 魚8種のアイコン

PixelWorkbenchの整数画素で8×8の形を描き、ニアレストネイバーで16×16へ拡大してから輪郭・目・鰓・斑点・ひげを加える。透明な24×24枠とpivot (12,12)を共通にし、バッグ・図鑑・地面に落ちた品の描画へ接続する。画像生成や大きな原画の縮小は使用していない。

小型で細いミノー、丸く背の高いブリーム、曲がったウナギ、ひげのナマズ、長い鼻先のパイクなど、色以外の形でも区別する。プレビューの静止画を原寸で確認し、独立レビューで指摘されたミノーとトラウト、コイとブリームの形の差を追加した。全資産の美術完成を示すものではない。

色の正本は `content_fish_icons7.json`、法線・高さの正本は `normalmaps/content_fish_icons7-*.json`。薄い品として中立法線と低い高さを用い、色と同じalphaを持たせる。独立した8×8段階は `studies/fish-icons7-base8.json` に保存する。既存の主人公や木はこの作業では変更しない。

```text
python Game/Mosslight/art/build_fish_icons7.py
python Game/Mosslight/tests/check_assets.py
python Game/Mosslight/update_runtime_versions.py
```

通常の再出力では `rebuild.py` を使用する。上の生成器は魚の編集可能な正本も更新する。
