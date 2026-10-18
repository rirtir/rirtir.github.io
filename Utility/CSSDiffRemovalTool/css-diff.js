// 文字列・コメント・括弧内の区切りを壊さず、元の規則と宣言順を保持する。
function cssParts(text, delimiter) {
  const parts = []; let start = 0, quote = '', comment = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (depth < 0) throw new Error('CSSの括弧が対応していません');
    if (c === delimiter && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  if (quote || comment || depth) throw new Error('CSSの文字列・コメント・括弧が閉じていません');
  parts.push(text.slice(start)); return parts;
}
function cssRules(text) {
  const rules = []; let start = 0, open = -1, depth = 0, parens = 0, quote = '', comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') parens++;
    if (c === ')' || c === ']') parens--;
    if (parens) continue;
    if (c === '{') { if (!depth) open = i; depth++; }
    if (c === '}') {
      depth--;
      if (depth < 0) throw new Error('CSSの括弧が対応していません');
      if (!depth) { rules.push({raw:text.slice(start,i+1),selector:text.slice(start,open).replace(/\/\*[\s\S]*?\*\//g,'').trim(),body:text.slice(open+1,i)});start=i+1; }
    }
    if (c === ';' && !depth) { rules.push({raw:text.slice(start,i+1)});start=i+1; }
  }
  if (depth || parens || quote || comment) throw new Error('CSSの文字列・コメント・括弧が閉じていません');
  if (text.slice(start).trim()) rules.push({raw:text.slice(start)});
  return rules;
}
function cssDeclarations(body) {
  return cssParts(body, ';').map(raw => {
    const parts = cssParts(raw, ':');
    if (parts.length < 2) return {raw};
    const name = parts.shift().replace(/\/\*[\s\S]*?\*\//g,'').trim();
    return {raw,name:name.startsWith('--')?name:name.toLowerCase(),value:parts.join(':').trim()};
  });
}
function removeDuplicatedCSS(a, b) {
  const source = cssRules(a), comparison = cssRules(b);
  // 入れ子・@layer等は外側の文脈と宣言順が意味を持つので原文のまま扱う。
  if ([...source,...comparison].some(r => r.selector?.startsWith('@') || r.body?.includes('{'))) return a;
  const family = name => /^(margin|padding|border|background|font|animation|transition|flex|grid|outline|list-style|text-decoration)(-|$)/.exec(name)?.[1] || name;
  const count = (items, key) => items.reduce((map,item) => { const k=key(item); if(k)map.set(k,(map.get(k)||0)+1); return map; },new Map());
  const selectorsA = count(source,r=>r.selector), selectorsB = count(comparison,r=>r.selector);
  const declarationsA = source.filter(r=>r.body!==undefined).flatMap(r=>cssDeclarations(r.body));
  const propertyCounts = count(declarationsA,d=>d.name&&family(d.name));
  if (propertyCounts.has('all')) return a;
  return source.map(rule => {
    if (!rule.selector || selectorsA.get(rule.selector)!==1 || selectorsB.get(rule.selector)!==1) return rule.raw;
    const match=comparison.find(other=>other.selector===rule.selector);
    if (!match) return rule.raw;
    const other=cssDeclarations(match.body), counts=count(other,d=>d.name);
    const remaining=cssDeclarations(rule.body).filter(d => !d.name || propertyCounts.get(family(d.name))!==1 || counts.get(d.name)!==1 || !other.some(o=>o.name===d.name&&o.value===d.value));
    if (!remaining.some(d=>d.name)) return '';
    return rule.selector+'{'+remaining.map(d=>d.raw).join(';')+'}';
  }).join('\n');
}
