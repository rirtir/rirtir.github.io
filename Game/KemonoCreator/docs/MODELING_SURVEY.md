# キャラクターモデル／キャラクリのつくり方 調査（ケモノキャラクリ向け）

調査日: 2026-10-16
対象: `Game/KemonoCreator`（SDF 由来の単一ボディメッシュ + 約68個のモーフターゲット + 手続き生成の耳・毛束・尻尾・鼻）

## 0. 概要

### 0.1 この文書の読み方

各項目に確度を付けています。

- **[一次]** 公式ドキュメント・登壇資料・マニュアルなど、作り手本人の資料を読んで確認した内容
- **[二次]** 解説記事・販売ページ・フォーラム・検索結果の要約など、第三者の記述
- **[推測]** 出典がなく、調査者（Claude）の推論や一般知識。実装前に検証が必要

### 0.2 先に結論

1. **スライダー同士が干渉する主因は「全頂点に効く差分」を足し合わせていること。** 商用のキャラクリ（Second Life、The Sims 4、MetaHuman、Character Creator）は、スライダーごとに影響領域を分けるか、ボーン・モーフ・補正形状を併用して役割を分けている。単一の全身モーフを足すだけの作りはほとんど見当たらなかった。
2. **三角形の反転は「各スライダーが単独では正常でも、足すと壊れる」性質のもの。** 調査した範囲に、ブレンドシェイプの足し算が反転しないことを保証する手法は無かった（探した範囲では未発見）。現実的な対策は、(a) 影響領域を滑らかな重みで絞る、(b) 差分を滑らかにする、(c) 組み合わせをサンプリングして反転を検出し、スライダー範囲か補正形状で潰す、の3つ。
3. **耳が浮いて見えるのは、接合部の作りの問題。** 別メッシュの耳は、根元を頭に埋め込み、頭側にも土台の盛り上がりを作り、接合部の法線・影・輪郭線を整える。一般的な方法。ケモノ専用の公開解説は少なく、一般の人体・動物頭部モデリングの知見からの推測が多い。
4. **アニメ調で顔を魅力的に見せる決め手は「アーティストの意図で制御すること」。** Guilty Gear Xrd の登壇資料（[一次]）では、顔の法線を手作業で作り込み、頂点カラーで影の閾値と輪郭線の太さを制御している。角度ごとに顔を変形させる View-Dependent Deformation という考え方もある。
5. **筋肉質・肥満体は、スライダーの極端値で作るより、専用のベース形状を用意して間を補間する方が安全。** BLUE PROTOCOL は体型 S/M/L の3種で、L は男女とも筋肉質な専用モデルアセットを用意している（[一次]、CEDEC 2021 の記事）。

---

## 1. キャラクリの設計方式

### 1.1 方式の整理

| 方式 | 得意 | 弱点 | 使っている例 |
|---|---|---|---|
| ボーンのスケール／移動 | 軽い。スキニングと服の追従が楽。頂点数に依存しない。 | 変形が粗い。ボーンが無い所は動かせない。スケールで滑らかな形を作りにくい。 | BLUE PROTOCOL の顔（ボーン）、Second Life の体 |
| ブレンドシェイプ（モーフ） | 自由な形を出せる。ボーンが届かない所も動かせる。 | 頂点数に比例して重い。足し合わせで干渉・破綻しやすい。 | VRoid の表情、Daz の顔・体、Sims 4 の一部 |
| ボーン + モーフの併用 | 粗い構造はボーン、細部はモーフ。 | 設計が複雑。評価順に注意。 | The Sims 4、Character Creator、MetaHuman |
| 補正形状（ポーズ空間変形、JCM） | 組み合わせや関節の曲げで壊れる部分を直す。 | 作る手間。組み合わせ数が増える。 | MetaHuman、Daz |

### 1.2 個別の事例

**BLUE PROTOCOL（CEDEC 2021）** [一次相当: GameBusiness.jp の講演レポート]
- 顔は眉・目・鼻・口・輪郭の5部位で、各パーツにボーンが入っている。
- ブレンドシェイプは「頂点数が増えるほど負荷が大きくなる」ため、多数のキャラが同一画面に出る本作には不向きと判断し、ボーンを採用した。
- 体型は S/M/L の3種。身長スライダーに合わせて頭の大きさや肩幅が変わる。L は男女ともやや筋肉質で、専用モデルアセットを用意している。
- アバターは髪・上半身・下半身・手・足・帽子・後頭部・顔パーツ群・アンダーウェアの9部位とアクセサリで構成される。体や顔の基準アセットに合わせて衣装を作る。太さの違いは接続部に「しぼり」を入れて貫通を防ぐ。
- 作成中のキャラをクリエイト画面で5体（全身用2体、顔用3体）用意し、それぞれの前にカメラを置いて2Dテクスチャとして表示している。このプロジェクトの「顔の3面プレビュー」の元ネタ。
- https://www.gamebusiness.jp/article/2021/08/27/18980.html
- https://www.gamespark.jp/article/2021/08/27/111420.html

**Second Life の外見エディタ** [一次: 公式 Wiki]
- スライダーは3種類に分かれる。ボーン駆動（身長・腕の長さなど）、コリジョンボリューム駆動（体脂肪・胸筋・お尻など）、モーフのみ（顔・目・耳・鼻・口・あごのほとんど）。
- つまり「骨格の比率はボーン、肉づきはコリジョンボリューム、顔の細部はモーフ」と役割を分けている。
- https://wiki.secondlife.com/wiki/Appearance_Editor_and_affeced_bones

**The Sims 4（GDC 2015、Sri Nair 氏）** [一次: 講演概要のみ。本編は会員限定で未確認]
- 概要によれば、データ駆動のセレクタとモディファイアで、モーフターゲット・ボーン駆動の変形・「デフォメーションマップ」を併用している。
- 同じ体の領域を占めるアセット同士に表示の優先順位を付ける仕組み（アセットペアリング）で、貫通を避ける。
- 体を直接つまんで引っ張る操作（ダイレクトマニピュレーション）がある。
- https://gdcvault.com/play/1022085/Innovations-in-The-Sims-4
- ファンツール MorphMaker の説明では、ベースメッシュと変形後メッシュの差から BGEO ファイルを作り、スカルプトとして登録する。モーフが「ベースとの差分」であることと整合する [二次]。https://simscommunity.info/2018/07/10/learning-your-tools-the-sims-4-morphmaker/2

**MetaHuman** [二次: 検索結果の要約。Epic の公式ページ自体は全文を読めていない]
- DNA ファイルは定義・振る舞い・ジオメトリの層に分かれる。ジオメトリの層は別なので、同じリグの振る舞いを形の違うキャラに適用できる。
- RigLogic が、少数の入力から、関節の変形・ブレンドシェイプの重み・補正式を計算する。複数の表情の組み合わせで壊れる部分は、ポーズ空間変形（PSD）の補正式で直す。
- ネックのサブリグの例では、RBF ソルバが 3 つの関節を入力に、37 個の定義済みポーズから 18 個の補正式を駆動する。
- https://dev.epicgames.com/documentation/metahuman/metahuman-dna-rig-definition-and-rig-operation
- https://80.lv/articles/epic-revealed-the-tech-side-of-metahuman-creator-face-rigs/
- https://dev.epicgames.com/documentation/metahuman/updating-neck-rbf-setup-tool-drivers-for-expression-editor

**Character Creator（Reallusion）** [一次: マニュアル]
- 表情のアーティファクトは「ボーン位置の調整」または「補正スライダーのモーフ結果の編集」で直す。左右対称の特徴には、編集結果を同時に反映できる。
- 旧版（CC2）のマニュアルに、Heavy スライダーが体と顔をまとめて太らせる、という記述がある。体型の極端な変化を顔にも連動させる実例。
- https://manual.reallusion.com/Character-Creator-5/Content/ENU/5.0/05-HD-Character/Refining-Expressions-by-Bones-or-Corrective-Morphs.htm
- https://manual.reallusion.com/Character_Creator_2/ENU/2.0/06_Body/Adjusting_Body_Shapes.htm

**Daz Studio（Genesis 8）** [二次: 製品ページ]
- 関節制御モーフ（JCM）で、関節を曲げたときの皮膚・筋肉の形を直す。体型セットには「50個以上の JCM」を含む例がある。
- 他社製の JCM を混ぜると干渉して姿勢が崩れることがある、という注意書きがある。
- 顔モーフには「目を閉じたとき」の補正が組み込まれている例がある。
- https://daz3d.com/catalog/product/view/id/59059-DAZ

**VRoid Studio** [二次]
- 内部実装の公式資料は見つからなかった。コミュニティの記述では、全モデルが同じベースメッシュを共有するため、表情のブレンドシェイプを別モデルに移せる。頂点の並びを外部ツールで崩すと壊れる。顔エディタの眉・瞳の調整はテクスチャや配置の調整に見える。
- 「同じトポロジーを共有する」ことが、パーツ交換・表情移植・モーフの足し算を成立させる前提になっている。
- https://liftedpixel.notion.site/Blendshape-Work-4c4d9d15188d43398f33ccb5244aabef

**調べたが技術的な一次資料が見つからなかったもの**
- Black Desert、Final Fantasy XIV、Monster Hunter、Soulcalibur、マビノギモバイル。報道やフォーラムの推測のみで、内部方式の裏付けは取れなかった。
- Black Desert は「顔の約35か所の引っ張り点を XYZ スライダーで位置・回転・大きさ調整できる」というプレイヤーの整理がある [二次、公式仕様ではない]。ボーン駆動に近い作りと推測されるが、確認できていない。
- FFXIV は、体をボーンでスケールしているという主張と、ボーンが無い部位は動かせないという主張がフォーラムで割れている [二次、推測]。
- これらは「ボーン方式の方が頂点数に依存せず軽い」という BLUE PROTOCOL の説明（[一次相当]）と整合するが、個別のゲームの実装としては断定できない。

### 1.3 スライダーの干渉を防ぐ方法

調査で確認できた、または一般に使われているもの。

1. **影響領域の分離。** Blender のシェイプキーには頂点グループで影響範囲を絞る設定がある [一次: Blender マニュアル]。https://docs.blender.org/manual/ja/3.3/animation/shape_keys/shape_keys_panel.html
   - 各スライダーの差分に、領域ごとの滑らかな重み（0〜1）を掛ける。領域の境目は広めにぼかす。
   - 領域が重なる頂点は両方の差分が効くので、重なりを狭くする。
2. **役割分担。** Second Life のように、粗い骨格比率はボーン、細部はモーフと分ける [一次]。ボーンのスケールは、モーフと違って足し算ではなく掛け算なので、組み合わせの挙動が読みやすい（[推測]）。
3. **補正形状（コレクティブ）。** MetaHuman や Daz の方式 [二次]。組み合わせで壊れる箇所を、その組み合わせのときだけ効く形状で直す。
4. **左右・領域の同時編集。** 対称性は Character Creator の補正スライダーが対応 [一次]。
5. **評価順に注意。** Blender ではシェイプキーの変形がアーマチュアの変形より先に行われ、積み重なる [二次: Blender Artists]。three.js でも morph → skinning の順（[推測]、three.js のスキニング処理の一般知識）。

### 1.4 メッシュの反転（三角形の裏返り）を避ける方法

**確認できたこと**
- ブレンドシェイプの重みは通常 0〜1 に制限されるが、それだけでは足し合わせた結果が反転しないことは保証されない [二次: 特許文書の記述と検索結果の要約]。
- 線形補間によるモーフィングで、フォールドオーバー（折り返し）が起きることは知られている。検出・修正の研究はあるが、対応関係の側で完全に解決する手法は未解決とされている [二次: Merz ら, WSCG 2015]。https://dspace.zcu.cz/bitstream/11025/29677/1/Merz.pdf
- Delta Mush のような平滑化は、アーティファクトを目立たなくするが、反転した要素は直せない [二次: 検索結果の要約。Laplacian 平滑化は反転要素を解消できないという特許文書の記述]。https://help.autodesk.com/cloudhelp/2027/ENU/Maya-Tech-Docs/Nodes/deltaMush.html
- 学術的には、局所的に単射（反転しない）なマッピングを保証する手法がある（Weber & Zorin 2014、Smith & Schaefer 2015）。ただしこれらは UV 展開（パラメータ化）の文脈の研究で、ブレンドシェイプ用ではない。そのまま使えるわけではない。
  - https://cims.nyu.edu/~dzorin/papers/weber2014lip.pdf
  - https://people.engr.tamu.edu/schaefer/research/bijective.pdf

**実務的な対策**（出典は上記の事実からの推論。[推測]）
- 反転は、近い頂点が逆向きに動くと起きる。差分を滑らかにし、領域の重みの傾きを小さくすると起きにくい。
- 三角形ごとの向き（法線がベースと逆向きになっていないか）や面積比を、スライダーの組み合わせをサンプリングして検査し、問題の組み合わせを洗い出す。
- 洗い出した組み合わせに対して、スライダー範囲を狭める、補正形状を足す、のどちらかで潰す。
- 「影響領域に重みを掛けた、アフィン変換（拡大縮小・移動）による変形」は、ヤコビアンの行列式を解析的に確認でき、スライダー範囲の上限を計算で決められる。SDF の再抽出で差分を作る方式より、反転の条件を読みやすい。

---

## 2. トポロジーとケモノ頭部

### 2.1 一般的なトポロジーの原則

**確認できたこと** [二次]
- エッジループは筋肉の動く方向に沿わせる。目と口の周りは、特にループを多めにする。動く領域は密に、動きの少ない頬などは疎にする。（Blender Artists の「動物キャラクターのモデリング」スレッド、トポロジー批評スレッド）
  - https://blenderartists.org/t/help-with-modeling-an-anthropomorphic-animal/702074
  - https://blenderartists.org/t/critical-feedback-topology-head/630640
- 極（ポール）は避けられないが、できるだけ減らす。口の端が尖る形は問題になりやすいので、口は閉じた輪にする。
- 人間と動物の顔は、骨と筋肉の仕組みが似ているので、トポロジーも似たものになる、という指摘がある。
- 先にスカルプトで形を決めてから、その上にリトポロジー（きれいな格子を張り直す）する進め方が勧められている。
- マズルを先に作ると頬の位置が決めやすい。頬は最も難しい部位になりやすい。正面・側面の正投影だけでなく、斜め（3/4）から確認する。
  - https://blenderartists.org/t/learning-face-topology/647631

**ケモノ顔に特有の点**
- 日本語・英語とも、ケモノ頭部のトポロジーを体系的に解説した公開資料は、今回の検索ではほとんど見つからなかった。VRChat のケモノアバター（Rexouium、Nardoragon など）の内部トポロジーを解説したページも見つけられていない。
- Nardoragon の販売ページには Blender 3.6 のファイルが付属し、ポリゴン数は 4/5 本指ベースで約5万と記載されている [二次: 販売ページ]。https://nardoiri.gumroad.com/l/Nardoragon
- 現実的には、購入してメッシュを開いて確認するのが最も確実。公開情報だけでは、実際のループの取り方は確認できない。

### 2.2 マズルの作り方

- 検索で見つかったのは、既存アバターにマズルを足すシェイプキー専用のアセット（BOOTH の「Kemono Blend Shapes」など）のみ。内容は「マズルのシェイプキーだけ」と明記されている [二次]。https://booth.pm/ja/items/6099566
- 一般論としては、目の周りの輪、鼻の周りの輪、口の周りの輪を作ってから、マズルをその輪の延長として前に押し出す（[推測]）。マズルを伸ばすと、鼻・口のループが引き伸ばされるので、ループの数を多めにしておく。
- **このプロジェクトに関係する点**: 現在はマーチングキューブ → 間引きで得たトポロジーなので、目・口・マズルのループが無い。スライダーで目の領域が変形する一因になっている可能性が高い（[推測]）。

### 2.3 耳の付け方

**確認できたこと** [二次]
- 人体の耳のチュートリアルでは、耳を別パーツとして作り、最外周のループを引き出してから頭に接続する。接続部は完全にきれいなループにならなくてもよい。根元は動かないので、多少乱れても気にならない。
  - https://hub.packtpub.com/character-head-modeling-blender-part-2-2
  - https://blenderartists.org/t/wip-childs-head-topology-goes-wild-around-ear/606376
- あるモデリング記録では、牙・目・眉・鼻を別オブジェクトにしていた。https://blogs.ulster.ac.uk/jasminesheppard/?p=728
- 毛が多い動物では、接合部を毛や毛束で隠せるので、接合部が多少粗くても目立ちにくい（検索結果の補足。[推測]）。

**浮いて見える原因と対策**（[推測]。一般的な3Dモデリングの知見による。アニメ調では特に目立つ）
- 原因1: 耳の根元が頭の表面と接しているだけで、頭の中に埋まっていない。回転・位置を変えると隙間が見える。
- 原因2: 頭側に耳の土台（盛り上がり）が無く、平らな面から耳が生えているように見える。
- 原因3: トゥーン影・輪郭線が耳と頭で分断される。反転ハル輪郭線は、接合部に耳の輪郭が出て「別パーツ」に見える。
- 対策:
  - 耳の根元を頭の中に深く埋める（耳の幅の3分の1〜半分程度）。根元の縁を少し広げて「スカート」状にする。
  - 頭側の SDF に耳の土台（丸いコーン）を滑らかな和で足し、耳の根元が収まる盛り上がりを作る。SDF 方式なので、耳の位置スライダーと土台の位置を同期できる。
  - 耳の根元に頂点カラーなどで影の閾値を与え、根元を暗くする（Xrd の方法。3.2 参照）。輪郭線の太さも頂点カラーで根元だけ細くする。
  - 耳の根元の周りに毛の房（耳毛・頬毛）を重ねて接合部を隠す。

### 2.4 毛束・頬毛

- VRChat のケモノアバターでは、毛はカード（板ポリゴン + アルファ）で作られることが多い。シェル（多層）は VR では近距離で見られるため、サンプル数が必要で重くなり、グルーミングもできない、という説明がある [二次: 制作者の記述]。https://irc.pcper.com/vrchat-fur-tutorial.html
- 頬毛を別アセットとして売る例（FBX + 物理 + テクスチャ）がある。https://pherezin.gumroad.com/l/hyenidfluffs
- カード生成のアドオンもある（RT FurCraft など。有料）。https://phcgm.gumroad.com/l/ztpcz
- このプロジェクトは、手続き生成の毛束を使っているので、方向性としては同じ。違いは、アニメ調では「束のシルエット」を先に決めること。写実的な毛の再現より、数本の大きな房の形が印象を決める（[推測]）。

### 2.5 SDF 由来のメッシュとリトポロジー

- 検索では、SDF 由来のメッシュのリトポロジー専用の資料は見つからなかった [二次]。
- 一般的なクワッドリメッシュの選択肢: Blender 内蔵の QuadriFlow（均一なサイズの四角形）、Instant Meshes（無料、ガイドの描き込み対応）、Quad Remesher（有料）、QuadWild。顔のように「ループを強制したい部分」は、ガイドを手で入れる必要がある、とされる（販売元の記述なので割り引いて読む）。
  - https://www.blendernation.com/2015/11/16/instant-meshes-a-free-qaud-based-autoretopology-program/
  - https://superrendersfarm.com/article/quad-remesher-blender-retopology
- 自動のクワッドリメッシュは、目・口の周りの輪を自動では作らない。手で入れるか、顔のランドマークを使った自前の分割が必要（[推測]）。

---

## 3. アニメ調の顔を全角度で魅力的に見せる

### 3.1 Guilty Gear Xrd（GDC 2015、Junya C. Motomura 氏） [一次: 登壇資料 PDF を読了]

- 原則は「3Dっぽいものを全部消す」。シェーダの数学は常に「正しい」が、「正しい」だけでは足りない。画面上のすべては、計算の結果ではなく意図的な選択であるべき、という趣旨。
- セルシェーディングは、光が当たるか当たらないかの二択なので、法線のわずかな差が大きなまだら模様になる。顔は特に、手作業で法線を作り込む必要がある。主要な部位のほぼすべてで法線を編集した。
- シェーダが使う3つ（閾値・光のベクトル・法線）を、すべてアーティストが制御する。
  - 閾値: 頂点カラーの1チャンネルを閾値のオフセットに使う。影になりやすい場所（遮蔽される場所）を塗り分け、0にすれば常に影になる。
  - 光のベクトル: キャラクターごとに専用のライトベクトルを持つ。
  - 法線: 手作業で編集する。
- ディテールは、法線マップではなく頂点の属性（頂点法線・頂点カラー・UV）に入れる。頂点属性は線形補間されるので、解像度に依存しない。ただし頂点数が必要で編集が大変。
- 輪郭線は反転ハル法。頂点カラーで幅を制御し、場所によっては消す。
- モデルのポリゴン数は平均約4万三角形。
- アニメーションでは、各キーフレームでメッシュを変形し、わざと不完全にする。「顔のパーツは自然な位置を保たない」（Expressiveness over accuracy）。
- https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf
- 講演ページ: https://gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The
- 補足として、Maya で法線・頂点カラーの編集ツールを自作し、顔を「常に同じ明るさになる領域」に分け、領域ごとに1つの法線を共有させた、という制作者の記事がある [二次: Sketchfab の記事]。https://sketchfab.com/blogs/community/art-spotlight-here-at-last

### 3.2 顔の法線の整え方（Blender 側のツール） [二次]

- 顔を丸めて見せるために、描画しない単純な形（球など）の法線を顔にコピーする方法が知られている。Blender のデータ転送（Data Transfer）モディファイアで法線を転送できる。ただし古い Blender では結果が不安定という報告があり、Polycount では「Xrd の顔のように影が『ぱきっ』と決まらない」という指摘も出ている。
- BNPR Abnormal（無料アドオン）は「球状化（Sphereize Normals）」ボタンで顔の法線を球に寄せる。写実的なモデルでは違和感が出るという注意書きがある。https://bnpr.gitbook.io/bnpr/shaders/toon-shading-nbpr-abnormal-normal-sphering
- Fondant の Custom Normals（有料）の Pro 版には、顔用のプロキシ（リグ付きのカーブ）がある。https://fondanttools.gumroad.com/
- このプロジェクトは既に「表面から少し離れた点の SDF 勾配」で滑らかな法線を作っており、球状化に近いことができている。顔だけ別の半径で強く丸める（顔プロキシ法線）のは、既存の仕組みの延長で実現できる（[推測]）。

### 3.3 顔の影マップ（原神型の SDF 顔影） [二次]

- 光の水平方向の角度に応じて顔の影の境目が動くように、あらかじめ塗った影の閾値テクスチャを使う方法。左右反転のために R チャンネルと反転した G チャンネルを使う実装例がある。頭ボーンの向きを取得する必要がある。
- 制約: Y 軸回転にしか対応できない。
- https://scrapbox.io/onigiri-tiken/%E3%80%90Unity%E3%80%91%E3%82%B7%E3%82%A7%E3%83%BC%E3%83%80%E3%83%BC%EF%BC%9AlilToon%E3%81%A7SDF%E3%82%92%E4%BD%BF%E3%81%A3%E3%81%9F%E9%A1%94%E5%BD%B1
- https://github.com/NoiRC256/URPSimpleGenshinShaders
- このプロジェクトは顔の変形がスライダーで大きく変わるので、固定テクスチャの影マップは合わない。変形に追従するには、顔の表面座標（頭の中心からの方向など）から影の境目を計算する方式が必要（[推測]）。

### 3.4 角度によって顔の形を変える（View-Dependent Deformation）

- アニメの顔は、正面と横顔で「3Dとして正しい形」と違う形になっていることが多い。これを3Dで再現するのが View-Dependent Deformation（視点依存変形）。Rademacher（1999）の研究が元で、2.5D の漫画モデルへの応用が Fukusato ら（2022）にある。
  - https://isgwww.cs.uni-magdeburg.de/~stefans/npr/entry-Rademacher-1999-VDG.html
  - https://deepai.org/publication/view-dependent-formulation-of-2-5d-cartoon-models
- Blender アドオンの Camkeys（旧 Cam-Shape-Matic）は、カメラの角度でシェイプキーを駆動し、アニメ顔の「正面と横顔が合わない」問題に使われている [二次: 販売ページ]。https://blendermarket.com/products/camkeys
- このプロジェクトに当てはめる案（[推測]）: 頬・あご・マズルの先・耳の角度に対して、カメラの向きに応じて混ぜる補正モーフ（斜め用、横顔用）を数個用意する。顔の3面プレビューで3つの角度が同時に見えるので、角度ごとに別のモーフ強度が必要になる（カメラが複数あるので、頭ごとに別のメッシュのコピーが要る可能性がある）。

### 3.5 BLUE PROTOCOL の顔まわり [二次]

- ホクロはポリゴンで作り、専用シェーダでカメラから遠いほど大きく表示して視認性を確保している。遠景でも「顔が見える」ための工夫。
- 幼い少女系は目以外の「正解」の幅が狭く、まつ毛を含むメイクの調整などで目の情報量を増やして差を出した。中年男性は目が小さく、目での差別化が難しいと語られている。
- 出典は 1.2 の GameBusiness.jp。耳の実装や髪の見せ方の詳細は、記事に記述が無かった。

---

## 4. 実践の提案の前提

### 4.1 このプロジェクトの現状（README と調査から）

- 各スライダーは、両端のパラメータで SDF を作り直し、プリミティブごとの対応で頂点を移して新しい表面に投影した差分。これは全頂点に効く（ただしプリミティブの移動量が小さい場所では差分も小さい）。
- 滑らかな和（smooth union）の影響で、マズルのプリミティブを動かすと、近い頭のプリミティブの境目の形も変わる。目の位置・形はシェーダ内で表面の位置から描いているため、表面が伸びると目の形が変わる（[推測]。コードは読んでいない）。
- 耳・毛束・尻尾・鼻は別メッシュで、モーフ後の表面を探してボーンに取り付けている。

### 4.2 提案が前提にしている制約

- 手彫りのスカルプトはしない。Python / Blender で生成する。
- 公開版は three.js なので、モーフの数や頂点数に実行時コストがかかる。BLUE PROTOCOL がボーンを選んだ理由（頂点数に比例して重い）は、ブラウザでも同様に当てはまる（[推測]）。

---

## 5. このプロジェクトへの具体的な提案

優先度の高い順。（a)〜(e) は依頼の項目に対応。

### (a) スライダーの領域分離

**1. 差分に「領域の重み」を掛ける。** `build_body.py` で、各スライダーに影響領域を宣言し、頂点ごとの重み（0〜1、滑らかな減衰）を差分に掛けてから書き出す。
   - 領域の例: マズル、頭蓋、目の周り、耳の土台、あご、頬。
   - 「マズルの長さ」は、目の周りの重みを 0 にする。目の周りは、マズルが伸びても動かない「保護領域」として扱う。
   - 重みの境目は広くぼかす（反転を起こしにくくする。提案 4 参照）。

**2. 目の描画を表面の伸びから切り離す。** 目はシェーダ内で表面の位置から描いているので、表面が伸びると形が変わる。
   - 頂点属性として、モーフに追従しない「目用の座標」（ベース形状での頭座標）を持たせ、目はこの座標で描く、または、目の周りの重みを 0 にして表面の伸びを防ぐ。両方併用が安全。
   - 目のスライダー（大きさ・位置・つり目）だけが、この座標を更新する。

**3. 目的が違うスライダーはボーン／変換に分ける。** 頭の大きさ・マズルの全体の長さ・耳の位置・角度など、粗い変更は、領域の重み付きアフィン変換（拡大縮小・回転・移動）として表現する。重みを掛けたアフィン変換は、足し合わせでも挙動が読みやすい（[推測]）。モーフは、細かい形（頬のふくらみ、鼻筋の高さなど）に限る。Second Life や Sims 4 が、方式を併用している点（1.2）と同じ考え方。

### (b) 反転の防止

**4. 反転の自動検査をビルドに入れる。** 三角形ごとの向き（ベースの法線との内積が負）と面積比を検査する。
   - 検査対象: 単独のスライダーの両端、全スライダーの両端の組み合わせ（ランダムに数千件）、プリセット（16種の種族）、体型タイプ。
   - 閾値を超えた組み合わせを、ログに残し、どのスライダーの組み合わせか特定する。

**5. 差分を滑らかにしてから書き出す。** 領域の重みと、差分そのものの平滑化（頂点間の Laplacian 平滑化）を、差分に対して行う。メッシュそのものの平滑化は反転を直さない（1.4）ので、差分に対して行う。
   - 目・口の周りは、細かい形が欲しいので、平滑化を弱める。

**6. 反転する組み合わせはスライダー範囲で縛る。** 検査で見つかった組み合わせは、(i) スライダーの範囲を狭める、(ii) 実行時に、特定の組み合わせの強度を自動で下げる、(iii) 補正形状を足す、のどれかで潰す。(iii) は MetaHuman や Daz の補正形状と同じ考え方。

**7. SDF の再投影が原因の反転を疑う。** 各スライダーは「プリミティブごとの対応で頂点を移してから新しい表面に投影」するので、薄い部分や凹みで投影先が不連続になると、近い頂点が逆向きに動く可能性がある（[推測]。コードは読んでいない）。投影の移動量に上限を付ける、投影後に差分を平滑化する、が候補。

### (c) 耳の自然な取り付け

**8. 耳の土台を頭の SDF に入れる。** 耳の位置・角度のスライダーに連動して、頭の SDF に耳の根元の丸いコーンを滑らかな和で足す。耳メッシュの根元は、この盛り上がりの中に埋め込む。耳が浮いて見える主因（2.3 の原因1・2）への直接の対策。
   - 耳を足した SDF を使って、モーフを作り直す必要がある。ビルドに時間がかかる（README では約10分）。

**9. 耳メッシュの根元を、頭の中に埋め込む。** 耳の幅の3分の1〜半分程度を頭の内側に入れ、根元の縁を広げた「スカート」状にする。頭の表面から耳の根元までの距離を、ビルドや実行時に検査する。

**10. 接合部のシェーディングを整える。** 耳の根元の頂点カラー（または頂点属性）で、(i) 影の閾値を下げて根元を暗くする（Xrd 方式、3.1）、(ii) 輪郭線の太さを根元で細くする、(iii) 根元の法線を頭の法線に寄せる。
   - 輪郭線は反転ハル法なので、接合部で耳と頭の輪郭が両方出て「別パーツ」に見える。(ii) の効果が大きいと予想される（[推測]）。

**11. 耳の周りに毛の房を重ねる。** 耳毛・頬毛・髪の房で接合部を隠す。アニメ調では、この見せ方が自然。

### (d) 頭・マズルの造形の改善

**12. 顔の解剖学的なプリミティブを増やす。** 眉骨、頬骨、マズルの上のふくらみ、鼻筋、マズルと額の段差（ストップ）、あご先、目のくぼみ（引き算）、上唇のライン。どれも「小さいプリミティブ + 小さい滑らかさ」で足す。現状の形の乏しさは、プリミティブの粒度が荒いことが大きい（[推測]）。顔の3面（正面・斜め・横）で見て、シルエットが「ケモノらしい」かを確認しながら調整する。

**13. 頭だけグリッドを細かくする。** 4.5mm グリッド全体を細かくすると重いので、頭の領域だけ、細かいグリッド（例: 2〜3mm）で抽出する、または、頭の SDF を別に抽出して首で結合する。

**14. 頭のトポロジーを作り直す。** 今のメッシュは、間引きで得たもので、目・口・マズルのループが無い。QuadriFlow や Instant Meshes で顔だけ四角形主体にリメッシュし、目・口の輪を手動のガイドで入れる案がある（2.5）。ただし、モーフはベースメッシュの頂点に対応するので、リメッシュしたら、全モーフを作り直す必要がある。優先度は (a)(b)(c) の後。

**15. 顔の法線を専用に作る。** 顔だけ、別の半径で SDF 勾配をぼかす（球状化に近い）、または、顔の中心に置いたプロキシ形状の法線に寄せる（3.2）。目・鼻・口の周りが、影で汚れないことを優先する。

**16. 角度に応じた補正モーフを少数用意する。** 斜めと横顔で、頬・あご・マズルの先・耳を調整する（3.4）。実装コストが高いので、優先度は低い。

### (e) ガチムチ・巨漢の体

**17. 体型の「原型」を3〜5個用意して補間する。** BLUE PROTOCOL の S/M/L のように、細身・標準・筋肉質・巨漢の専用の形（同じトポロジー）を作り、隣り合う原型の間を補間する。極端なスライダー値で作るより、形が安定する（1.2、[推測]を含む）。

**18. 筋肉は個別のプリミティブで作る。** 僧帽筋・三角筋・大胸筋・広背筋・上腕二頭筋・上腕三頭筋・前腕・大腿四頭筋・ふくらはぎ・腹直筋を、別々のプリミティブとし、それぞれ大きさを持たせる。筋肉の数だけ、スライダー（または体型原型の差）を作る。腹筋は、割れ目を引き算のプリミティブで入れる。

**19. 肥満は、大きな滑らかさで作る。** 体脂肪は、滑らかな和の半径を大きくして、低周波の形（お腹・胸・腰・二の腕・太もも）で作る。お腹の垂れ下がりは、別のモーフ（下向きの重力）で表す。Character Creator の Heavy スライダーのように、体型の変化を顔にも連動させる（1.2）。

**20. 関節の曲げで壊れる部分は、補正形状で直す。** 太い腕を曲げると、脇や肘の内側が潰れる。Daz の JCM（1.2）と同じ考え方で、曲げ角度に連動する補正形状を、極端な体型の原型にだけ付ける（[推測]）。実行時のコストを考えて、数個に絞る。

**21. 服は体の膨らませた殻なので、極端な体型で貫通しやすい。** BLUE PROTOCOL は、接続部に「しぼり」を入れ、干渉する部分を非表示にしている（1.2）。このプロジェクトでも、体型が大きいときは服の膨らみ量を増やす、袖口や裾に「しぼり」を入れる、が候補。

### 進め方の目安

1. まず 4（反転の検査）と 1（領域の重み）。原因の切り分けと、干渉の解消が最優先。検査があれば、他の提案の効果も測れる。
2. 次に 8〜10（耳）。見た目の改善が大きい。
3. 続けて 12・15（顔の造形・法線）。
4. 17〜20（体型）は、体型の原型の作り方を決めてから。
5. 14・16 は効果が大きい一方でコストも大きい。残りが片付いてから判断する。

---

## 付録: 調査の限界

- 公式資料を直接読めたのは、Guilty Gear Xrd の登壇資料（PDF）、BLUE PROTOCOL の講演レポート、Second Life の Wiki、Blender・Reallusion のマニュアル、Sketchfab の記事など。MetaHuman、Sims 4（GDC 本編）、BLUE PROTOCOL の講演スライド、CGWORLD の記事（本文）は、全文を読めていない。
- Black Desert、FFXIV、Monster Hunter、Soulcalibur、マビノギモバイルのキャラクリ内部方式は、技術的な一次資料が見つからなかった。
- VRChat のケモノアバター（Rexouium、Nardoragon など）のトポロジーの解説は見つからなかった。実際のメッシュを確認するのが確実。
- 「ブレンドシェイプの足し算が反転しないことの保証」は、調査した範囲で見つからなかった。提案 4〜7 は、検査と範囲の制限という実務的な対策に絞っている。
- 第5章の提案は、このプロジェクトのコード（`build_body.py` など）を読まずに、README の記述だけから推論している。実装前にコードで確認すること。
- 検索ツールの要約を介した情報が多い。URL は検索結果に出たものを記載しているが、一部（特に MetaHuman、Daz、Reallusion）は要約のみで本文を直接読んでいない。

## 出典一覧

- Guilty Gear Xrd 登壇資料 PDF: https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf
- GDC Vault（Xrd）: https://gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The
- Sketchfab（Xrd 風シェーディングの制作記事）: https://sketchfab.com/blogs/community/art-spotlight-here-at-last
- BLUE PROTOCOL CEDEC 2021: https://www.gamebusiness.jp/article/2021/08/27/18980.html / https://www.gamespark.jp/article/2021/08/27/111420.html
- Second Life Wiki: https://wiki.secondlife.com/wiki/Appearance_Editor_and_affeced_bones
- GDC Vault（Sims 4）: https://gdcvault.com/play/1022085/Innovations-in-The-Sims-4
- Sims 4 MorphMaker: https://simscommunity.info/2018/07/10/learning-your-tools-the-sims-4-morphmaker/2
- MetaHuman: https://dev.epicgames.com/documentation/metahuman/metahuman-dna-rig-definition-and-rig-operation / https://80.lv/articles/epic-revealed-the-tech-side-of-metahuman-creator-face-rigs/ / https://dev.epicgames.com/documentation/metahuman/updating-neck-rbf-setup-tool-drivers-for-expression-editor
- Reallusion: https://manual.reallusion.com/Character-Creator-5/Content/ENU/5.0/05-HD-Character/Refining-Expressions-by-Bones-or-Corrective-Morphs.htm / https://manual.reallusion.com/Character_Creator_2/ENU/2.0/06_Body/Adjusting_Body_Shapes.htm
- Daz: https://daz3d.com/catalog/product/view/id/59059-DAZ
- VRoid（コミュニティ記述）: https://liftedpixel.notion.site/Blendshape-Work-4c4d9d15188d43398f33ccb5244aabef
- Blender マニュアル（シェイプキー）: https://docs.blender.org/manual/ja/3.3/animation/shape_keys/shape_keys_panel.html
- Blender Artists: https://blenderartists.org/t/help-with-modeling-an-anthropomorphic-animal/702074 / https://blenderartists.org/t/critical-feedback-topology-head/630640 / https://blenderartists.org/t/learning-face-topology/647631 / https://blenderartists.org/t/wip-childs-head-topology-goes-wild-around-ear/606376
- 耳のモデリング: https://hub.packtpub.com/character-head-modeling-blender-part-2-2
- 動物モデルの制作記録: https://blogs.ulster.ac.uk/jasminesheppard/?p=728
- VRChat ケモノ関連: https://booth.pm/ja/items/6099566 / https://nardoiri.gumroad.com/l/Nardoragon / https://pherezin.gumroad.com/l/hyenidfluffs / https://phcgm.gumroad.com/l/ztpcz / https://irc.pcper.com/vrchat-fur-tutorial.html
- リメッシュ: https://www.blendernation.com/2015/11/16/instant-meshes-a-free-qaud-based-autoretopology-program/ / https://superrendersfarm.com/article/quad-remesher-blender-retopology
- 顔の法線ツール: https://bnpr.gitbook.io/bnpr/shaders/toon-shading-nbpr-abnormal-normal-sphering / https://fondanttools.gumroad.com/
- 顔の影（SDF）: https://scrapbox.io/onigiri-tiken/%E3%80%90Unity%E3%80%91%E3%82%B7%E3%82%A7%E3%83%BC%E3%83%80%E3%83%BC%EF%BC%9AlilToon%E3%81%A7SDF%E3%82%92%E4%BD%BF%E3%81%A3%E3%81%9F%E9%A1%94%E5%BD%B1 / https://github.com/NoiRC256/URPSimpleGenshinShaders
- 視点依存変形: https://isgwww.cs.uni-magdeburg.de/~stefans/npr/entry-Rademacher-1999-VDG.html / https://deepai.org/publication/view-dependent-formulation-of-2-5d-cartoon-models / https://blendermarket.com/products/camkeys
- 反転・フォールドオーバー: https://dspace.zcu.cz/bitstream/11025/29677/1/Merz.pdf / https://cims.nyu.edu/~dzorin/papers/weber2014lip.pdf / https://people.engr.tamu.edu/schaefer/research/bijective.pdf / https://help.autodesk.com/cloudhelp/2027/ENU/Maya-Tech-Docs/Nodes/deltaMush.html
