export const MODEL = Object.freeze({
  revision: 'dbeb0856cb0b004b484f190bb71dd65876297013',
  filename: 'plamo-3-translate-0.8b-Q4_0.gguf',
  bytes: 547539584,
  directory: 'pocket-translate-model-v1',
});
export const MODEL_URL = `https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/${MODEL.revision}/${MODEL.filename}`;
export const LANGUAGES = [
  ['ja','日本語'],['en','英語'],['zh-hans','中国語（簡体字）'],['zh-hant','中国語（繁体字）'],['ko','韓国語'],['fr','フランス語'],['de','ドイツ語'],['es','スペイン語'],['it','イタリア語'],['ru','ロシア語'],['ar','アラビア語'],['hi','ヒンディー語'],['th','タイ語'],['vi','ベトナム語'],['id','インドネシア語'],['nl','オランダ語'],['pl','ポーランド語'],['hu','ハンガリー語'],['bg','ブルガリア語'],['sk','スロバキア語'],['sl','スロベニア語'],['hr','クロアチア語'],['sr','セルビア語'],['ca','カタルーニャ語'],['et','エストニア語'],['eu','バスク語'],['fa','ペルシア語'],['he','ヘブライ語'],['lt','リトアニア語'],['lv','ラトビア語'],['ms','マレー語'],['sw','スワヒリ語'],['ta','タミル語'],['tl','タガログ語'],['ur','ウルドゥー語'],['bn','ベンガル語'],['az','アゼルバイジャン語'],['be','ベラルーシ語'],['ceb','セブアノ語'],['gu','グジャラート語'],['hy','アルメニア語'],['jv','ジャワ語'],['ka','ジョージア語'],['kk','カザフ語'],['km','クメール語'],['ml','マラヤーラム語'],['mr','マラーティー語'],['my','ビルマ語'],['ne','ネパール語'],['pa','パンジャブ語'],['si','シンハラ語'],['te','テルグ語'],['uz','ウズベク語'],
];
// 原文をPFML3の構造として解釈させない。
export function buildPrompt(text, source, target) {
  if (!text.trim()) throw new Error('翻訳する文章を入力してください。');
  if (text.length > 600) throw new Error('600文字以内に分けて入力してください。');
  if (/<\|plamo:[^|]*\|>/.test(text)) throw new Error('モデル制御トークンを含む文章は翻訳できません。');
  const valid = code => LANGUAGES.some(([id]) => id === code);
  if (!valid(target) || (source !== 'auto' && !valid(source))) throw new Error('言語の指定を確認してください。');
  if (source === target) throw new Error('原文と翻訳先には別の言語を選んでください。');
  return '<|plamo:tag|>dataset<|plamo:msg|>translation' +
    '<|plamo:tag|>input' + (source === 'auto' ? '' : `<|plamo:key|>lang<|plamo:val|>${source}`) +
    `<|plamo:msg|>${text}<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${target}<|plamo:msg|>`;
}
export function formatMB(bytes) { return `${(bytes / 1e6).toFixed(1)} MB`; }
