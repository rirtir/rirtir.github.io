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



---

This site distributes a WebAssembly build of FFmpeg (ffmpeg-core) which includes FFmpeg components.
FFmpeg is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later,
but some included components are covered by the GNU General Public License (GPL) version 2 or later.
The prebuilt binaries (ffmpeg-core.js / ffmpeg-core.wasm / ffmpeg-core.worker.js) were obtained from:
https://unpkg.com/@ffmpeg/core@0.11.0/dist/
<!-- Source code and build instructions for the exact binaries shipped here are available at:
<ここにソースのURL（ソース tarball や GitHub リポジトリ + commit/tag）を記載してください> -->
<!-- See also: https://ffmpeg.org/legal.html -->