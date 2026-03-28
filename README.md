フォルダを追加して中にindex.htmlを入れることでrirtir.com/フォルダ名/になる。

それをlinks.jsに追加するとポータルサイトに反映される。

2026年3月12日

スタイルを統一したくてcss/common-style.cssを作った。

さらに、common-style.cssと重複した部分を消すためにUtility/CSSDiffRemovalToolを作ったけどなんか、うまくいかない。ダメかも。



2026年3月14日
なんかうまくいった。common-style.cssはボタンとか背景色とか、見た目中心にすべてのサイトで共通するものにした。

common-style2.cssは、そこからさらに特別なUIを用意していない一般的なサイト用に作った。

場合によっては、1と2だけでUIが完成するかも。

カラーパレット抽出のページがゴミだから修正したい。


2026年3月19日
さすがにそろそろローカルで実行してみてからコミットの方がよさそう

2026年3月20日
もう寝るけど、カラーパレットが、色数通りじゃないしダウンロードの解像度終わってるから調整が必要だと思う

2026年3月24日
カラーパレットに、色数をテキストで与えること、1ずつ増減できるボタンを設置すること、最大値を増やすこと、ダウンロードボタン押した後にロード画面を入れること

画像処理ツールのベータを作ったけど、シャドウ・ハイライトが全然思ってる挙動をしない
それはそれで味があるかもしれないから一応残しておくけど要修正
Aviutlの方は自然なのに、今のやつは境界線が見えてて論外
後なんかスマホでやったらどんどんプレビューが小さくなった

ブレインビータ

ブレインビータ

---

This site distributes a WebAssembly build of FFmpeg (ffmpeg-core) which includes FFmpeg components.
FFmpeg is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later,
but some included components are covered by the GNU General Public License (GPL) version 2 or later.
The prebuilt binaries (ffmpeg-core.js / ffmpeg-core.wasm) were obtained from:
https://unpkg.com/@ffmpeg/core@0.12.6/dist/, https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/
<!-- Source code and build instructions for the exact binaries shipped here are available at:
<ここにソースのURL（ソース tarball や GitHub リポジトリ + commit/tag）を記載してください> -->
<!-- See also: https://ffmpeg.org/legal.html -->