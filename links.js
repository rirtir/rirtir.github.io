const data = [
    {
        category: "ゲーム",
        links: [
            {
                title: "ケモノキャラクリ — アニメ調3Dの獣人キャラ作成",
                url: "https://rirtir.com/Game/KemonoCreator/",
                desc: "顔・毛並み・耳や尻尾・体型まで細かく作り込める。撮影モードつき。",
                tags: ["ソロ", "3D", "キャラクリ", "ゲーム"],
                thumb: "assets/thumbs/KemonoCreator.webp",
                main: true,
            },
            {
                title: "苔灯の境 — MOSSLIGHT",
                url: "https://rirtir.com/Game/Mosslight/",
                desc: "森に拠点を築き、地下の三つの灯を取り戻すドット絵サバイバルクラフト。",
                tags: ["ソロ", "サバイバルクラフト", "ドット絵", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/Mosslight.webp",
                main: true,
            },
            {
                title: "残り火の深庭 — EMBERVEIL",
                url: "https://rirtir.com/Game/Emberveil/",
                desc: "地下庭園を掘り進め、炉心を再生するドット絵サバイバルクラフト。",
                tags: ["ソロ", "サバイバルクラフト", "ドット絵", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/Emberveil.webp",
                main: false,
            },
            {
                title: "星の芽の庭 — 放置・育成ゲーム",
                url: "https://rirtir.com/Game/StarSproutGarden/",
                desc: "夜の温室で星の植物を育てる。オフライン中も育つ。",
                tags: ["ソロ", "放置", "育成", "ゲーム"],
                thumb: "assets/thumbs/StarSproutGarden.webp",
                main: false,
            },
            {
                title: "SYNESTHESIA — 音が光になるリズムゲーム",
                url: "https://rirtir.com/Game/Synesthesia/",
                desc: "手持ちの曲から譜面を自動生成。オリジナル5曲も収録。",
                tags: ["ソロ", "リズム", "音楽", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/Synesthesia.webp",
                main: true,
            },
            {
                title: "PRISM — 光を導くパズル",
                url: "https://rirtir.com/Game/Prism/",
                desc: "鏡やプリズムで虹の光を受光器へ。ステージエディタつき。",
                tags: ["ソロ", "パズル", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/Prism.webp",
                main: true,
            },
            {
                title: "セノーテ ― 光の降る地下の泉",
                url: "https://rirtir.com/Game/Cenote/",
                desc: "地下の泉をリアルタイム3Dで散策。水中にも潜れる。",
                tags: ["ソロ", "3D", "散策", "ゲーム"],
                thumb: "assets/thumbs/Cenote.webp",
                main: false,
            },
            {
                title: "ANCHOR//VECTOR — 星環の残響",
                url: "https://rirtir.com/Game/AnchorVector/",
                desc: "時間を遅くして斬撃の軌道を描く3Dアクション・ローグライト。",
                tags: ["ソロ", "3Dアクション", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/AnchorVector.webp",
                main: false,
            },
            {
                title: "黎明列車 ― 七夜の終着点",
                url: "https://rirtir.com/Game/DawnTrain/",
                desc: "装甲列車を指揮して七夜を越える戦術RPG。",
                tags: ["ソロ", "戦術RPG", "物語", "ゲーム"],
                thumb: "assets/thumbs/DawnTrain.webp",
                main: false,
            },
            {
                title: "陽だまりクラフト — LUMINA ISLE",
                url: "https://rirtir.com/Game/LuminaIsle/",
                desc: "島で採集・建築・釣りをして灯台を灯すドット絵サバイバルクラフト。",
                tags: ["ソロ", "サバイバルクラフト", "ドット絵", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/LuminaIsle.webp",
                main: false,
            },
            {
                title: "ito",
                url: "https://rirtir.com/Game/ito/",
                desc: "互いの数字を当てろ",
                tags: ["みんなで", "スマホ一台", "わいわい", "ゲーム"],
                main: false,
            },
            {
                title: "みんなのミニゲーム集",
                url: "https://rirtir.com/Game/PartyGames/",
                desc: "スマホ1台でもオンラインでも遊べる、会話中心のミニゲーム16本。",
                tags: ["みんなで", "スマホ一台", "スマホ複数台", "オンライン", "わいわい", "ゲーム"],
                thumb: "assets/thumbs/PartyGames.webp",
                main: true,
            },
            {
                title: "ボブジテン",
                url: "https://rirtir.com/Game/bob/",
                desc: "相手のお題を当てろ",
                tags: ["みんなで", "スマホ一台", "わいわい", "ゲーム"],
                main: false,
            },
            {
                title: "ito-online",
                url: "https://ito-online.onrender.com/",
                desc: "itoのオンライン対戦版",
                tags: ["みんなで", "スマホ一台", "わいわい", "ゲーム"],
                main: false,
            },
            {
                title: "ito P2P",
                url: "https://rirtir.com/Game/ito_p2p/",
                desc: "QRでスマホ同士を直接接続する、サーバーレス版ito（実験版）",
                tags: ["みんなで", "スマホ複数台", "P2P", "わいわい", "ゲーム"],
                thumb: "assets/thumbs/ito_p2p.webp",
                main: false,
            },
            {
                title: "ブレインビータ",
                url: "https://rirtir.com/Game/BrainVita/",
                desc: "玉を飛び越して消していくゲーム。楽しいよ",
                tags: ["ソロ", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/BrainVita.webp",
                main: true,
            },
            {
                title: "ぽっちゃりタイガー",
                url: "https://pochari-tiger.onrender.com/",
                desc: "制作中（ベータ版）",
                tags: ["ふたりで", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/pochari.webp",
                main: false,
            },
            {
                title: "インクリメンタルゲーム",
                url: "https://rirtir.com/Game/incremental/",
                desc: "制作中（デモ版）",
                tags: ["ソロ", "やり込み", "ゲーム"],
                main: false,
            },
            {
                title: "パズル",
                url: "https://rirtir.com/Game/puzzle/",
                desc: "任意の画像、任意の難易度で遊べるパズルゲーム",
                tags: ["ソロ", "ゲーム"],
                thumb: "assets/thumbs/puzzle.webp",
                main: true,
            },
            {
                title: "ブロックパズル",
                url: "https://rirtir.com/Game/BlockPuzzle/",
                desc: "ブロックを並べ替えて完成させるゲーム",
                tags: ["ソロ", "ゲーム"],
                thumb: "assets/thumbs/BlockPuzzle.webp",
                main: true,
            },
            {
                title: "エアーホッケー",
                url: "https://rirtir.com/Game/AirHockey/",
                desc: "エアーホッケーゲーム。難易度選択可能。",
                tags: ["ソロ", "ゲーム"],
                thumb: "assets/thumbs/AirHockey.webp",
                main: false,
            },
            {
                title: "ノノグラム",
                url: "https://rirtir.com/Game/Nonogram/",
                desc: "ピクセルアートのやつ。自分でステージを追加可能。",
                tags: ["ソロ", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/Nonogram.webp",
                main: true,
            },
            {
                title: "テレパシーオンライン",
                url: "https://telepath-online.onrender.com",
                desc: "テレパシーで相手と意思疎通するゲーム。制作中（ベータ版）",
                tags: ["みんなで", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/telepath.webp",
                main: false,
            },
            {
                title: "グラビティゴルフ",
                url: "https://rirtir.com/Game/GravityGolf/",
                desc: "惑星の重力で曲がる宇宙ゴルフ。全54ホール収録。",
                tags: ["ソロ", "やり込み", "ゲーム"],
                thumb: "assets/thumbs/GravityGolf.webp",
                main: false,
            },
        ]
    },
    {
        category: "画像処理",
        links: [
            {
                title: "画像処理ツール",
                url: "https://rirtir.com/Image/ImageEffectLayerTool/",
                desc: "様々なエフェクトを重ねることができるツール（ベータ版）",
                tags: ["画像", "画像処理", "オフライン"],
                thumb: "assets/thumbs/ImageEffectLayerTool.webp",
                main: true,
            },
            {
                title: "輝度値→アルファ変換",
                url: "https://rirtir.com/Image/Line2AlphaConverter/",
                desc: "グレースケール画像を透過画像にする。線画を線だけにするなど。",
                tags: ["画像", "画像処理", "透過", "オフライン"],
                thumb: "assets/thumbs/Line2AlphaConverter.webp",
                main: true,
            },
            {
                title: "画像透過ツール",
                url: "https://rirtir.com/Image/AlphaTool/",
                desc: "画像の一部を透過する。透過したい箇所をタップして透過可能。",
                tags: ["画像", "画像処理", "透過", "オフライン"],
                thumb: "assets/thumbs/AlphaTool.webp",
                main: true,
            },
            {
                title: "画像リサイズツール",
                url: "https://rirtir.com/Image/Resize/",
                desc: "画像のサイズを自由に変更できるツール",
                tags: ["画像", "画像処理", "オフライン"],
                thumb: "assets/thumbs/Resize.webp",
                main: true,
            },
            {
                title: "動画から画像抽出",
                url: "https://rirtir.com/Image/Video2Image/",
                desc: "動画から任意のフレームを抜き出す。",
                tags: ["画像", "動画", "オフライン"],
                thumb: "assets/thumbs/Video2Image.webp",
                main: true,
            },
            {
                title: "画像連番から動画作成",
                url: "https://rirtir.com/Image/Image2Video/",
                desc: "画像を複数入力して動画を作成",
                tags: ["画像", "動画", "オフライン"],
                thumb: "assets/thumbs/Image2Video.webp",
                main: false,
            },
            {
                title: "画像からカラーパレット抽出",
                url: "https://rirtir.com/Image/CreateColorPalette/",
                desc: "画像から主要な色を抽出（調整中）",
                tags: ["画像", "画像処理", "オフライン"],
                thumb: "assets/thumbs/CreateColorPalette.webp",
                main: false,
            },
            {
                title: "モザイク検出ツール",
                url: "https://rirtir.com/Image/MosaicMask/",
                desc: "モザイクのかかっている箇所をマスク画像として出力可能。",
                tags: ["画像", "画像処理", "オフライン"],
                thumb: "assets/thumbs/MosaicMask.webp",
                main: false,
            },
            {
                title: "ドット絵メーカー",
                url: "https://rirtir.com/Image/PixelArtMaker/",
                desc: "簡単なドット絵を作成できるツール",
                tags: ["画像", "画像処理", "お絵描き", "オフライン"],
                thumb: "assets/thumbs/PixelArtMaker.webp",
                main: true,
            }
        ]
    },
    {
        category: "音声処理",
        links: [
            {
                title: "MMLコードメーカー",
                url: "https://rirtir.com/Audio/MMLComposer/",
                desc: "ピアノロールで作曲し、マビノギ形式のMMLを出力。和音の自動生成つき。",
                tags: ["音楽", "作曲", "MML", "マビノギ", "オフライン"],
                thumb: "assets/thumbs/MMLComposer.webp",
                main: true,
            },
            {
                title: "動画から音声抽出",
                url: "https://rirtir.com/Audio/Video2Audio/",
                desc: "動画から音声ファイルを抽出する。オリジナル、mp3、wavから選べる。",
                tags: ["音声", "動画", "オフライン"],
                thumb: "assets/thumbs/Video2Audio.webp",
                main: true,
            },
            {
                title: "音声・動画解析ツール",
                url: "https://rirtir.com/Audio/AudioInfo/",
                desc: "音声・動画のコーデック、解像度、FPS、ビットレート、コンテナ形式などを表示する。波形とFFTも表示。",
                tags: ["音声", "動画", "音声処理", "オフライン"],
                thumb: "assets/thumbs/AudioInfo.webp",
                main: false,
            },
            {
                title: "リアルタイム音声解析",
                url: "https://rirtir.com/Audio/RealTimeAudioAnalyzer/",
                desc: "マイク音声の波形とFFTを表示する",
                tags: ["音声", "音声処理", "オフライン"],
                thumb: "assets/thumbs/RealTimeAudioAnalyzer.webp",
                main: false,
            },
            {
                title: "リアルタイム文字起こし",
                url: "https://rirtir.com/Audio/RealTimeWhisper/",
                desc: "音声から文字起こしをする。調整中",
                tags: ["音声", "音声処理", "オフライン"],
                thumb: "assets/thumbs/RealTimeWhisper.webp",
                main: false,
            }
        ]
    },
    {
        category: "ユーティリティ",
        links: [
            {
                title: "動画の無劣化トリミング",
                url: "https://rirtir.com/Utility/VideoTrimmer/",
                desc: "動画を送信せずキーフレーム単位で切り出し。iPhone・PC対応。",
                tags: ["動画", "トリミング", "無劣化", "iPhone", "オフライン"],
                main: false,
            },
            {
                title: "メディア変換ツール",
                url: "https://rirtir.com/Utility/MediaConverter/",
                desc: "動画・音声・画像を好きな形式に変換。AviUtl向けの変換にも。",
                tags: ["動画", "音声", "画像", "変換", "オフライン"],
                thumb: "assets/thumbs/MediaConverter.webp",
                main: true,
            },
            {
                title: "PDF結合・分割ツール",
                url: "https://rirtir.com/Utility/PDFJoiner/",
                desc: "PDFを結合・分割。パスワード付きPDFにも対応。完全ローカル処理で安心。",
                tags: ["PDF", "結合", "分割", "オフライン"],
                thumb: "assets/thumbs/PDFJoiner.webp",
                main: true,
            },
            {
                title: "文字列の総当たりツール",
                url: "https://rirtir.com/Utility/RoundRobinString/",
                desc: "複数の変数と候補を登録し、テンプレートに埋め込んで全パターンの文章を自動生成できるツール。数式にも対応",
                tags: ["個人用"],
                thumb: "assets/thumbs/RoundRobinString.webp",
                main: true,
            },
            {
                title: "CSS重複削除ツール",
                url: "https://rirtir.com/Utility/CSSDiffRemovalTool/",
                desc: "CSSの被りをなくすためのツール",
                tags: ["個人用"],
                thumb: "assets/thumbs/CSSDiffRemovalTool.webp",
                main: false,
            },
            {
                title: "jsonlをグラフ化",
                url: "https://rirtir.com/Utility/jsonl2graph/",
                desc: "jsonlの学習結果をグラフに起こすだけのツール。完全に研究用",
                tags: ["個人用"],
                thumb: "assets/thumbs/jsonl2graph.webp",
                main: false,
            },
            {
                title: "深度マッププレビュー＆一括ZIPツール",
                url: "https://rirtir.com/Utility/DepthPreview/",
                desc: "深度マップをプレビューし、複数のファイルを一括でZIP形式でダウンロードするツール。完全に研究用",
                tags: ["個人用", "画像処理"],
                thumb: "assets/thumbs/DepthPreview.webp",
                main: false,
            },
            {
                title: "RE10Kメタデータ作成ツール",
                url: "https://rirtir.com/Utility/RealEstate10Kcreatemeta/",
                desc: "RE10Kのメタデータを作成するツール。完全に研究用",
                tags: ["個人用"],
                thumb: "assets/thumbs/RealEstate10Kcreatemeta.webp",
                main: false,
            },
            {
                title: "ご飯ルーレット",
                url: "https://rirtir.com/Utility/GohanRoulette/",
                desc: "ランダムに食事の候補を提示するツール",
                tags: [],
                thumb: "assets/thumbs/GohanRoulette.webp",
                main: false,
            }
        ]
    },
    {
        category: "リンク",
        links: [
            {
                title: "GitHub",
                url: "https://github.com/rirtir/rirtir.github.io",
                desc: "このページのリポジトリ",
                tags: [],
                main: false,
            },
            {
                title: "バグ報告・要望送信フォーム",
                url: "https://forms.gle/FKudrSHsjtNdhamq9",
                desc: "バグ報告や要望を送信するフォーム",
                tags: [],
                main: false
            }
        ]
    },
    {
        category: "おすすめサイト",
        links: [
            {
                title: "Squoosh",
                url: "https://squoosh.app/",
                desc: "PNG/JPEG/WebP/AVIFなどへ変換。リサイズも可能",
                tags: ["画像", "圧縮"],
                main: true,
            },
            {
                title: "TinyPNG",
                url: "https://tinypng.com/",
                desc: "PNG/JPEG画像を圧縮",
                tags: ["画像", "圧縮"],
                main: true,
            },
            {
                title: "Gravit Designer",
                url: "https://gravitdesign.com/index.html",
                desc: "ブラウザでSVG編集が可能",
                tags: ["画像", "SVG"],
                main: true,
            },
            {
                title: "Blob Maker",
                url: "https://www.blobmaker.app/",
                desc: "ブラウザで流体シェイプのSVGが作れる",
                tags: ["画像", "SVG"],
                main: true,
            },
            {
                title: "Dottorie",
                url: "https://amix-design.com/asoboad/tools/d-dottorie/",
                desc: "ブラウザでドット絵が作れる",
                tags: ["画像", "ドット絵", "ピクセルアート"],
                main: true,
            },
        ]
    }
]

const content = document.getElementById("content")

function render(){

    content.innerHTML = ""

    data.forEach(cat => {

        const filteredLinks = cat.links.filter(link=>{
            return showAll || link.main
        })

        if(filteredLinks.length === 0) return

        const section = document.createElement("div")
        section.className = "category"

        const title = document.createElement("h2")
        title.textContent = cat.category
        section.appendChild(title)

        const grid = document.createElement("div")
        grid.className = "links"

        filteredLinks.forEach(link=>{
            const a = document.createElement("a")
            a.href = link.url
            a.className = "card"
            a.target = "_blank"
            a.rel = "noopener"

            a.innerHTML = `
<strong>${link.title}</strong>
<p>${link.desc}</p>
<div>${link.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
`

            // サムネイルは文字の後ろに薄く敷く。読み込めなければ通常のカードに戻す
            if(link.thumb){
                const img = document.createElement("img")
                img.className = "thumb"
                img.src = link.thumb
                img.alt = ""
                img.loading = "lazy"
                img.decoding = "async"
                img.onerror = ()=>{
                    img.remove()
                    a.classList.remove("has-thumb")
                }
                a.classList.add("has-thumb")
                a.prepend(img)
            }

            grid.appendChild(a)
        })

        section.appendChild(grid)
        content.appendChild(section)
    })
}

document.getElementById("search").oninput = (e)=>{
    const keyword = e.target.value.toLowerCase()

    content.querySelectorAll(".card").forEach(card=>{
        card.style.display =
            card.innerText.toLowerCase().includes(keyword)
            ? "block"
            : "none"
    })
}

let showAll = false

const btnMain = document.getElementById("btnMain")
const btnAll = document.getElementById("btnAll")

btnMain.onclick = () => {
    showAll = false
    btnMain.classList.add("active")
    btnAll.classList.remove("active")
    render()
}

btnAll.onclick = () => {
    showAll = true
    btnAll.classList.add("active")
    btnMain.classList.remove("active")
    render()
}

render()
