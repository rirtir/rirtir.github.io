// =====================
// 読み込んだSVGの無害化
// =====================
// SVGファイルにはスクリプトやイベント属性を書けるため、ページへ追加する前に
// 実行されうる部分だけを取り除く。見た目に関わる要素（style・グラデーション等）は残す。
// 戻り値は取り除いた要素・属性の数。

function sanitizeSVG(root){

const SVG_NS = "http://www.w3.org/2000/svg"
// SVG以外で、ページ上で動作しうる名前空間（HTMLの<img onerror>や<iframe>など）
const ACTIVE_NS = ["http://www.w3.org/1999/xhtml", "http://www.w3.org/1998/Math/MathML"]
const BLOCKED = ["script", "foreignobject", "iframe", "embed", "object", "handler", "listener"]
const ANIMATIONS = ["animate", "set", "animatemotion", "animatetransform", "animatecolor"]
const URL_ATTRS = ["href", "src", "action", "formaction", "data"]

let removed = 0

// 「java\tscript:」のように空白や制御文字を挟んでもブラウザは解釈するので、除いてから判定する
function unsafeUrl(value){
const v = value.replace(/[\u0000- \u007f-\u009f]+/g, "").toLowerCase()
if(!/^[a-z][a-z0-9+.-]*:/.test(v))return false
return !/^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,])/.test(v)
}

function cleanAttributes(el){
for(const attr of Array.from(el.attributes)){
const name = attr.localName.toLowerCase()
if(name.startsWith("on") || (URL_ATTRS.includes(name) && unsafeUrl(attr.value))){
el.removeAttributeNode(attr)
removed++
}
}
}

function walk(el){
cleanAttributes(el)
for(const child of Array.from(el.children)){
const name = child.localName.toLowerCase()
// アニメーションでリンク先やイベントを書き換えて実行させる手口を防ぐ
const target = (child.getAttribute("attributeName") || "").trim().toLowerCase()
const blocked = ACTIVE_NS.includes(child.namespaceURI)
|| (child.namespaceURI === SVG_NS && BLOCKED.includes(name))
|| (ANIMATIONS.includes(name) && (/(^|:)href$/.test(target) || target.startsWith("on")))
if(blocked){
child.remove()
removed++
continue
}
walk(child)
}
}

walk(root)
return removed

}
