const data = [
    {
        category: "ゲーム",
        links: [
            {
                title: "ito",
                url: "https://rirtir.com/Game/ito/",
                desc: "互いの数字を当てろ",
                tags: ["みんなで", "スマホ一台", "わいわい", "ゲーム"],
                main: true,
            },
            {
                title: "ボブジテン",
                url: "https://rirtir.com/Game/bob/",
                desc: "相手のお題を当てろ",
                tags: ["みんなで", "スマホ一台", "わいわい", "ゲーム"],
                main: true,
            },
            {
                title: "ito-online",
                url: "https://ito-online.onrender.com/",
                desc: "itoのオンライン対戦版",
                tags: ["みんなで", "スマホ一台", "わいわい", "ゲーム"],
                main: false,
            },
            {
                title: "ブレインビータ",
                url: "https://rirtir.com/Game/BrainVita/",
                desc: "玉を飛び越して消していくゲーム。楽しいよ",
                tags: ["ソロ", "やり込み", "ゲーム"],
                main: true,
            },
            {
                title: "ぽっちゃりタイガー",
                url: "https://pochari-tiger.onrender.com/",
                desc: "制作中（ベータ版）",
                tags: ["ふたりで", "やり込み", "ゲーム"],
                main: false,
            },
            {
                title: "インクリメンタルゲーム",
                url: "https://rirtir.com/Game/incremental/",
                desc: "制作中（デモ版）",
                tags: ["ソロ", "やり込み", "ゲーム"],
                main: false,
            }
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
                main: false,
            },
            {
                title: "輝度値→アルファ変換",
                url: "https://rirtir.com/Image/Line2AlphaConverter/",
                desc: "グレースケール画像を透過画像にする。線画を線だけにするなど。",
                tags: ["画像", "画像処理", "透過", "オフライン"],
                main: true,
            },
            {
                title: "画像透過ツール",
                url: "https://rirtir.com/Image/AlphaTool/",
                desc: "画像の一部を透過する。透過したい箇所をタップして透過可能。",
                tags: ["画像", "画像処理", "透過", "オフライン"],
                main: true,
            },
            {
                title: "画像リサイズツール",
                url: "https://rirtir.com/Image/Resize/",
                desc: "画像のサイズを自由に変更できるツール",
                tags: ["画像", "画像処理", "オフライン"],
                main: true,
            },
            {
                title: "動画から画像抽出",
                url: "https://rirtir.com/Image/Video2Image/",
                desc: "動画から任意のフレームを抜き出す。",
                tags: ["画像", "動画", "オフライン"],
                main: true,
            },
            {
                title: "画像連番から動画作成",
                url: "https://rirtir.com/Image/Image2Video/",
                desc: "画像を複数入力して動画を作成",
                tags: ["画像", "動画", "オフライン"],
                main: false,
            },
            {
                title: "画像からカラーパレット抽出",
                url: "https://rirtir.com/Image/CreateColorPalette/",
                desc: "画像から主要な色を抽出（調整中）",
                tags: ["画像", "画像処理", "オフライン"],
                main: false,
            }
        ]
    },
    {
        category: "音声処理",
        links: [
            {
                title: "動画から音声抽出",
                url: "https://rirtir.com/Audio/Video2Audio/",
                desc: "動画から音声ファイルを抽出する。オリジナル、mp3、wavから選べる。",
                tags: ["音声", "動画", "オフライン"],
                main: true,
            },
            {
                title: "音声解析ツール",
                url: "https://rirtir.com/Audio/AudioInfo/",
                desc: "音声のサンプリング周波数やビット深度などを表示する。またFFTも表示。",
                tags: ["音声", "音声処理", "オフライン"],
                main: false,
            },
            {
                title: "リアルタイム音声解析",
                url: "https://rirtir.com/Audio/RealTimeAudioAnalyzer/",
                desc: "マイク音声の波形とFFTを表示する",
                tags: ["音声", "音声処理", "オフライン"],
                main: false,
            },
            {
                title: "リアルタイム文字起こし",
                url: "https://rirtir.com/Audio/RealTimeWhisper/",
                desc: "音声から文字起こしをする。調整中",
                tags: ["音声", "音声処理", "オフライン"],
                main: false,
            }
        ]
    },
    {
        category: "ユーティリティ",
        links: [
            {
                title: "PDF結合・分割ツール",
                url: "https://rirtir.com/Utility/PDFJoiner/",
                desc: "PDFファイルを結合したり分割したりするツール",
                tags: ["PDF", "結合", "分割", "オフライン"],
                main: true,
            },
            {
                title: "文字列の総当たりツール",
                url: "https://rirtir.com/Utility/RoundRobinString/",
                desc: "複数の変数と候補を登録し、テンプレートに埋め込んで全パターンの文章を自動生成できるツール。数式にも対応",
                tags: ["個人用"],
                main: true,
            },
            {
                title: "CSS重複削除ツール",
                url: "https://rirtir.com/Utility/CSSDiffRemovalTool/",
                desc: "CSSの被りをなくすためのツール",
                tags: ["個人用"],
                main: false,
            },
            {
                title: "jsonlをグラフ化",
                url: "https://rirtir.com/Utility/jsonl2graph/",
                desc: "jsonlの学習結果をグラフに起こすだけのツール。完全に研究用",
                tags: ["個人用"],
                main: false,
            },
            {
                title: "RE10Kメタデータ作成ツール",
                url: "https://rirtir.com/Utility/RealEstate10Kcreatemeta/",
                desc: "RE10Kのメタデータを作成するツール。完全に研究用",
                tags: ["個人用"],
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

            a.innerHTML = `
<strong>${link.title}</strong>
<p>${link.desc}</p>
<div>${link.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
`

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