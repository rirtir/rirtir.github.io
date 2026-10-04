# エンジンと表示の契約

実装の参照先は `data.js` / `world.js`。シミュレーションはDOMと音声を使用しません。UI・描画・音は同じGameを読み、イベント列をそれぞれのカーソルで読み取ります。

## 起動と更新

```js
import {DATA} from './data.js';
import {Game} from './world.js';
const game = new Game(DATA);
game.newGame({slot:1, seed:'MOSS-123', difficulty:'standard'});
game.update(1 / 60);
```

`main.js`は固定60Hz、1フレーム最大5ステップで進行します。`input`は `moveX` / `moveY`、`held`（primary/interact/dodge/remove）、1ステップ限りの `pressed:Set`、`pointer:{x,y,tx,ty}`。メニュー入力はUIが捕捉し、`setPaused(reason,on)`の理由集合で進行を止めます。`mode`はtitle/playing/dead/ending。`readOnly`は保存・進行の操作権喪失を表します。

## UIからの操作

| 操作 | API |
| --- | --- |
| ホットバー | `selectHotbar(0..7)` |
| 持ち物 | `moveItem(from,to)`, `transferStack(ref)`, `splitStack(ref)`, `dropStack(ref)`, `useItem(ref)`, `unequipArmor()` |
| 収納 | `depositAll()`（バッグ部分だけ）, `depositMatching()`, `takeAll()`, `closeContainer()` |
| クラフト | `stationsNear()`, `getRecipeView()`, `canCraft(id)`, `craft(id,times)` |
| 植樹・苗床 | `plantAt(tileX,tileY,seedKey)` |
| 帰還 | `startReturn()`, `cancelChannel()` |
| 死亡・終幕 | `respawn()`, `offerHearts()`, `skipEndingAnim()`, `finishEnding()` |
| 設定 | `applySettings(settings)` |

`ref`は `{box:'inv'|'chest',i:index}` または `{box:'armor'}`。持ち物は `{id:itemKey,n:count}` / null。返り値は基本 `{ok,reason?}`、クラフトの `made` は生成した個数です。`getEquipmentStats()`は自動切り替えの設定を含む実際のattack/defense/miningTier/chopPower/heatを返します。

HUD・地図・記録には `getHUD()` / `getObjective()` / `getMapData()` / `getCodex()` / `getAchievements()` / `getEndingStats()`を使用します。UIはこれらのデータを編集しません。

## 描画と音

`getRenderState()`はtitleではnull、それ以外ではtileAt関数、player、objects、enemies、effects、explored、visible、aim、buildPreview、questMarkerを持つ再利用可能な表示用オブジェクトを返します。タイルの `ground` / `wall` / `build` は元の素材キー、`biome`は描画用0..2です。ワールドとプレイヤーの実biomeは1..3です。

Rendererは原画ドットを整数拡大します。`screenToWorld(clientX,clientY)`はカメラ・整数倍率・画面揺れを含めて座標を変換します。オブジェクトのcrop/stage/dark、ハザード形状、鏡像戦の本体の状態も参照して描きます。輪の危険域は `[r-width/2,r+width/2]`、gapAngle/gapWidthは安全な扇形です。

`pollEvents(lastSeq)`で最新イベントを取得し、各利用側が最後のseqを保存します。ログは256件まで。`worldId`の変更で各利用側のカーソル・演出を初期化します。AudioEngineは最初のユーザー操作で `unlock()`し、`setEnabled(bool)` / `setVolume(0..1)` / `update(game,dt)`を使用します。

## 保存と操作権

`toSave()`はJSON化可能なスナップショット。`validateSave(obj)` / `parseSaveText(text)`は構造・数値・経路・素材・固定オブジェクトの位置などを検証します。`loadFromSave(obj,slot)`は検証後に置き換え、失敗時には現行ワールドを維持します。

`SaveStore`は3スロットと直前の正常なバックアップを管理します。`write(slot,save,{lock})`は検証後に操作権を再確認します。ブラウザ保存を拒否する環境ではメモリへ退避します。永続保存の可否と書き込み失敗をUIが通知し、JSONを書き出せます。

`TabLock`は8秒のリース、2秒の更新、BroadcastChannel/storage通知で同時タブを管理します。他タブへ引き継いだ古いタブは、自動で操作権を奪い返しません。引き継ぐときは最新の正常な保存を読み込みます。BFCacheに入る際は所有記録を維持し、復帰時に所有者を再確認します。

## 原画の再生成

`dev/make_pixel_art.py`でオリジナル33種、`dev/pack_dungeon.py`でCC0原画370フレームを再生成・梱包できます。梱包時の縮小・補間はありません。`tests/art_check.py`がパレット・二値透過・全CC0フレームのRGBA一致を検証します。
