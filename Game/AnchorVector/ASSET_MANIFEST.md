# ANCHOR//VECTOR — 最終アセット台帳

状態記号: `[x] 完了` / `[-] 設計判断により不要`

## 1. 生成画像

- [x] `assets/key-art-source.png` — built-in imagegen出力原本、1536×1024、文字なし
- [x] `assets/key-art.webp` — タイトル用最適化版、82KB
- [x] `assets/og-image.jpg` — ポータル/OG版、1200×630、121KB
- [x] 文字、透かし、第三者ロゴ、不要なUI混入なしを目視確認

## 2. 3Dモデル（`models.js` 手続き生成）

- [x] LANCER / WEAVER / BULWARK
- [x] SEEKER / LANCER / WARDEN / BLOOM / TETHER / MIRROR / FORGE / NULL
- [x] RING WARDEN / TETRA CROWN / VESPER CORE
- [x] anchor node / route beacon / fragment / core
- [x] outer rim / fracture / core の3環境キットと星野
- [-] 外部glTF — 初回転送量と画風統一のため、全モデルをコード生成

## 3. UI・SVG

- [x] HTML/CSSタイトルマーク
- [x] `assets/ui-icons.svg` — システム、資源、機体、モジュール、モードのSVGスプライト
- [x] shield / FLOW / CHAIN / boss / route HUD
- [x] 安全円環、危険三角、敵角形の色覚補助
- [-] 静止画チュートリアル図 — 実際の3D戦場で操作する4段階訓練へ統合

## 4. VFX（コード生成）

- [x] route preview / danger / confirmed trail
- [x] node snap、slash、critical、spark、shield hit
- [x] enemy break、VECTOR SEAL、near miss、boss phase pulse
- [x] telegraph sphere / line / replay path / spawn
- [x] FLOW HUD/BGM段階、victory/defeat、Reduced Motion代替

## 5. 音響（`audio.js` Web Audio生成）

- [x] audio unlock、master/music/sfx buses、compressor
- [x] hangar / combat / boss / ending の生成BGM
- [x] FLOW 25/50/75の適応レイヤー
- [x] UI、warning、route、snap、slash、critical、hit、break、seal、overtrace、victory、defeat、unlock
- [-] 外部音源ファイル — 権利と通信依存を避け、必要音をリアルタイム合成

## 6. 文書・権利

- [x] `assets/IMAGE_PROMPT.md` に最終画像生成プロンプトを保存
- [x] Three.js 0.185.1 `vendor/three.module.min.js`、SHA-256 `86BCEE248B64F44BCFC23C331AE74619061957D59CAB040171DCB6FB5900BEB6`
- [x] Three.js 0.185.1 `vendor/three.core.min.js`、SHA-256 `05B2609338C76CD65DAF74F3AC515BC9A5045E1B3B33EDC07D8C9BD55250FA90`
- [x] `vendor/THREE-LICENSE.txt` にMITライセンスを同梱
- [x] Three.js以外の外部由来素材なし

必須未完了: なし。
