# ito P2P

GitHub Pages 上の静的ファイルだけで配信し、WebRTC DataChannel で端末同士を直接接続する ito です。
Render で公開している `ito_online` とは独立しており、既存版には変更を加えていません。

## 遊び方

1. 1台目で「この端末で部屋を作る」を押す。
2. 「参加者を追加」で招待QRを表示する。
3. 参加端末で「招待QRを読み取る」を押し、招待QRを読み取る。
4. 参加端末に表示された回答QRを、ホストの「回答QRを読む」で読み取る。
5. 人数分だけ2〜4を繰り返し、ホストがゲームを開始する。

QRが複数枚に分かれたときは、表示側の「次」ボタンでページを送りながら、すべて読み取ります。
カメラを利用できない場合は接続コードのコピー・貼り付けでも交換できます。

## 通信構成

- GitHub Pages: HTML / CSS / JavaScript / お題 / QRライブラリの静的配信
- WebRTC DataChannel: ゲーム中のP2P通信
- ホスト端末: カード配布、進行、結果判定を行う権威ピア
- QRコード: WebRTC Offer / Answer / ICE候補の手動シグナリング

「STUNを利用する」がオフの場合、`iceServers` は空で、外部の接続補助サービスを利用しません。同じWi-Fi内での利用を想定しています。
オンの場合は `stun:stun.cloudflare.com:3478` を利用して、別ネットワーク間の直接接続も試します。STUNはゲームデータを中継しません。

## 制限事項

- TURNリレーは使わないため、NATやファイアウォールの組み合わせによっては接続できません。
- ホストが画面を閉じる、再読み込みする、スリープするなどすると部屋が終了します。
- 自動再接続とホスト移行には対応していません。
- ゲーム中に切断したプレイヤーは、そのラウンドの対象から除外されます。
- ゲーム進行中に新しく接続した端末は観戦参加になります。
- P2Pのため、接続相手にIPアドレス情報が伝わる場合があります。

## ファイル

- `index.html`: 全画面を持つSPA
- `app.js`: WebRTC、QRシグナリング、画面制御
- `game-core.js`: ホストで動作するゲーム状態・ルール
- `topics.json`: Render版で利用していたお題データのコピー
- `vendor/`: QR生成・読取ライブラリとライセンス

## サードパーティライブラリ

- [qrcode-generator 1.4.4](https://github.com/kazuhikoarase/qrcode-generator) — MIT License
- [jsQR 1.4.0](https://github.com/cozmo/jsQR) — Apache License 2.0

ライセンス全文は `vendor/LICENSE-qrcode-generator.txt` と `vendor/LICENSE-jsQR.txt` に収録しています。
