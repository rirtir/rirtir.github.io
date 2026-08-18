(() => {
  "use strict";

  const META = {
    "word-wolf": { icon:"🐺", name:"ワードウルフ", min:3, short:"少数派のお題を会話で探す", rule:"各自のお題を秘密に確認して会話します。投票で少数派を当てれば市民、逃げ切ればウルフの得点です。" },
    "ng-word": { icon:"🚫", name:"NGワード", min:2, short:"自分だけ知らない禁止語", rule:"自分以外のNGワードを確認して会話します。誰かが自分のNGワードを言ったら中央の画面で捕まえます。" },
    "unanimous": { icon:"🎯", name:"全員一致", min:2, short:"同じ答えを目指す", rule:"お題から連想する答えを一人ずつ秘密に入力。全員一致で2点、部分一致で1点です。" },
    "majority-predict": { icon:"👥", name:"多数派を読め", min:3, short:"自分の回答と多数派を予想", rule:"二択への自分の回答と、みんなの多数派予想を秘密に入力します。多数派入りと予想的中で各1点です。" },
    "minority-survival": { icon:"🦊", name:"少数派サバイバル", min:3, short:"少ない方へ潜り込む", rule:"二択を秘密に選び、人数が少なかった側だけ2点。同数または全員一致は得点なしです。" },
    "pair-sync": { icon:"🤝", name:"ペアシンクロ", min:3, short:"組になって答えを合わせる", rule:"毎ラウンド組をシャッフル。同じ組の答えが完全一致すれば全員2点です。奇数時は最後が3人組になります。" },
    "telepathy-word": { icon:"🧠", name:"テレパシーワード", min:2, short:"同じ言葉を書いた人数が得点", rule:"相談せず答えを入力。同じ答えの仲間1人につき1点を獲得します。" },
    "five-seconds-three": { icon:"⏱️", name:"5秒で3つ", min:2, short:"5秒以内に3つ答える", rule:"指名された人がお題を確認し、開始から5秒以内に3つ口頭で答えます。成功は2点です。" },
    "taboo-talk": { icon:"🤐", name:"タブー説明", min:2, short:"禁止語を避けて説明", rule:"説明役だけがお題と禁止語を確認。45秒以内に禁止語を使わず当ててもらえれば2点です。" },
    "closest-estimate": { icon:"📏", name:"ぴったり予想", min:2, short:"正解の数値へ一番近づく", rule:"正解を相談せず数値で予想します。最も近い人が2点。同距離なら全員得点です。" },
    "secret-thermometer": { icon:"🌡️", name:"ひみつの温度計", min:3, short:"秘密の位置を例えで伝える", rule:"出題者は0〜100の秘密の位置を、数字を使わないヒントで表現。他の人が位置を当てます。" },
    "bluff-definition": { icon:"📚", name:"ウソ定義選手権", min:3, short:"もっともらしい偽定義を作る", rule:"珍しい言葉へ偽の意味を書き、本物と混ぜて投票。本物を当てると2点、騙した票は1票1点です。" },
    "coop-count": { icon:"🔢", name:"協力カウント", min:2, short:"順番を決めず声をつなぐ", rule:"相談や合図なしで1から順に声を出します。同時発声や連続発声が起きたら1へ戻り、目標到達で全員2点です。" },
    "answer-first-ogiri": { icon:"🤣", name:"答えが先大喜利", min:3, short:"決まった答えに質問を作る", rule:"先に決められた答えに似合う面白い質問を書きます。匿名投票で集めた1票が1点です。" }
  };

  const slug = document.body.dataset.game;
  const meta = META[slug];
  const app = document.getElementById("app");
  const toast = document.getElementById("toast");
  let items = [];
  let draftNames = loadNames();
  let state = { phase:"loading", players:[], scores:{}, round:0, roundLimit:3, used:[] };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  const shuffle = (values) => {
    const result = [...values];
    for (let i=result.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
    return result;
  };
  const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s　]+/g, "");
  const player = (pid) => state.players.find(p => p.id === pid);
  const pname = (pid) => player(pid)?.name || "不明";
  const allIds = () => state.players.map(p => p.id);
  const currentPid = () => state.order[state.turn];
  const addScore = (pid, amount) => { state.scores[pid] = (state.scores[pid] || 0) + amount; };
  const scoreRows = () => [...state.players].sort((a,b) => (state.scores[b.id]||0)-(state.scores[a.id]||0)).map(p => `<div class="score-row"><span>${esc(p.name)}</span><b>${state.scores[p.id]||0} pt</b></div>`).join("");

  function loadNames() {
    try {
      const saved = JSON.parse(localStorage.getItem("party_one_device_names") || "null");
      if (Array.isArray(saved) && saved.length >= 2) return saved.slice(0,12);
    } catch (_) { /* ignore */ }
    return ["プレイヤー1","プレイヤー2","プレイヤー3","プレイヤー4"];
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function shell(content) {
    const round = state.round ? `ROUND ${state.round} / ${state.roundLimit}` : "1台で遊ぶ";
    app.innerHTML = `<div class="topbar"><a href="../../" aria-label="ゲーム一覧へ">←</a><span class="round-chip">${round}</span><button class="ghost" data-action="reset" aria-label="最初から">↻</button></div>
      <section class="surface hero"><div class="game-title"><span class="emoji">${meta.icon}</span><div><h2>${meta.name}</h2><p>${meta.short}</p></div></div></section>
      <section class="surface content">${content}</section>`;
  }

  function renderSetup() {
    const min = meta.min;
    shell(`<p class="phase-label">SET UP</p><h2>遊ぶ人の名前</h2><p>${esc(meta.rule)}</p>
      <div id="nameList">${draftNames.map((name,i) => `<div class="name-row"><span>${i+1}</span><input class="player-name" maxlength="12" value="${esc(name)}" aria-label="プレイヤー${i+1}"><button class="ghost" data-action="remove-player" data-index="${i}" ${draftNames.length<=min?"disabled":""}>×</button></div>`).join("")}</div>
      <button class="ghost wide" data-action="add-player" ${draftNames.length>=12?"disabled":""}>＋ 人を追加</button>
      <div class="field"><label for="roundLimit">ラウンド数</label><select id="roundLimit"><option value="1">1ラウンド</option><option value="3" selected>3ラウンド</option><option value="5">5ラウンド</option><option value="8">8ラウンド</option></select></div>
      <button class="primary wide" data-action="start-game">このメンバーで始める</button>`);
  }

  function syncDraftNames() {
    const inputs = [...document.querySelectorAll(".player-name")];
    if (inputs.length) draftNames = inputs.map(input => input.value);
  }

  function pickPrompt() {
    if (!items.length) return null;
    let index = Math.floor(Math.random()*items.length);
    if (items.length > 1 && state.used.at(-1) === index) index = (index + 1 + Math.floor(Math.random()*(items.length-1))) % items.length;
    state.used.push(index);
    if (state.used.length > 30) state.used.shift();
    return items[index];
  }

  function startGame() {
    syncDraftNames();
    const names = draftNames.map(n => n.trim()).filter(Boolean);
    if (names.length < meta.min) return showToast(`${meta.min}人以上の名前を入れてください`);
    if (new Set(names).size !== names.length) return showToast("同じ名前は使えません");
    const roundLimit = Number(document.getElementById("roundLimit")?.value || 3);
    localStorage.setItem("party_one_device_names", JSON.stringify(names));
    state = { phase:"", players:names.map((name,i)=>({id:`p${i}`,name})), scores:{}, round:0, roundLimit, used:[] };
    state.players.forEach(p => state.scores[p.id]=0);
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.result = null;
    state.answers = {};
    state.votes = {};
    state.tempChoice = null;
    state.tempPrediction = null;
    state.prompt = pickPrompt();
    const ids = allIds();
    if (slug === "word-wolf") {
      const wolf = ids[Math.floor(Math.random()*ids.length)];
      const flip = Math.random() < .5;
      state.wolfIds = [wolf];
      state.assignments = Object.fromEntries(ids.map(id => [id, id===wolf ? (flip?state.prompt.a:state.prompt.b) : (flip?state.prompt.b:state.prompt.a)]));
      return beginTurns("wolf-secret", ids, "wolf-secrets");
    }
    if (slug === "ng-word") {
      const words = shuffle(items).slice(0, ids.length);
      state.assignments = Object.fromEntries(ids.map((id,i)=>[id,words[i]]));
      state.caught = {};
      return beginTurns("ng-secret", ids, "ng-secrets");
    }
    if (["unanimous","telepathy-word"].includes(slug)) return beginTurns(`${slug}-answer`, ids, slug);
    if (slug === "majority-predict") return beginTurns("majority-answer", ids, "majority");
    if (slug === "minority-survival") return beginTurns("minority-answer", ids, "minority");
    if (slug === "pair-sync") {
      const mixed = shuffle(ids); state.groups=[];
      while (mixed.length) { if (mixed.length===3) state.groups.push(mixed.splice(0,3)); else state.groups.push(mixed.splice(0,2)); }
      state.groupByPid={}; state.groups.forEach((group,i)=>group.forEach(id=>state.groupByPid[id]=i));
      return beginTurns("pair-answer", ids, "pair");
    }
    if (slug === "five-seconds-three") { state.active = ids[(state.round-1)%ids.length]; state.phase="five-ready"; return render(); }
    if (slug === "taboo-talk") { state.active = ids[(state.round-1)%ids.length]; state.phase="taboo-pass"; return render(); }
    if (slug === "closest-estimate") return beginTurns("closest-answer", ids, "closest");
    if (slug === "secret-thermometer") {
      state.active=ids[(state.round-1)%ids.length]; state.target=Math.floor(Math.random()*101); state.phase="thermo-pass"; return render();
    }
    if (slug === "bluff-definition") return beginTurns("bluff-write", ids, "bluff-writes");
    if (slug === "coop-count") { state.count=0; state.lastSpeaker=null; state.resets=0; state.target=Math.max(10,ids.length*3); state.phase="coop"; return render(); }
    if (slug === "answer-first-ogiri") return beginTurns("ogiri-write", ids, "ogiri-writes");
  }

  function beginTurns(view, ids, after) {
    state.turnView=view; state.order=[...ids]; state.turn=0; state.afterTurns=after; state.phase="turn-pass"; state.tempChoice=null; state.tempPrediction=null; render();
  }

  function completeTurn() {
    state.turn += 1;
    state.tempChoice=null; state.tempPrediction=null;
    if (state.turn < state.order.length) { state.phase="turn-pass"; return render(); }
    finishTurns(state.afterTurns);
  }

  function finishTurns(kind) {
    if (kind === "wolf-secrets") { state.phase="wolf-discuss"; return render(); }
    if (kind === "wolf-votes") return resolveWolf();
    if (kind === "ng-secrets") { state.phase="ng-discuss"; return render(); }
    if (kind === "unanimous") return resolveText(true);
    if (kind === "telepathy-word") return resolveText(false);
    if (kind === "majority") return resolveMajority();
    if (kind === "minority") return resolveMinority();
    if (kind === "pair") return resolvePair();
    if (kind === "closest") return resolveClosest();
    if (kind === "thermo-guesses") return resolveThermo();
    if (kind === "bluff-writes") return prepareBluffVotes();
    if (kind === "bluff-votes") return resolveBluff();
    if (kind === "ogiri-writes") return prepareOgiriVotes();
    if (kind === "ogiri-votes") return resolveOgiri();
  }

  function turnLabel(view) {
    if (view.includes("secret")) return "秘密のお題を確認";
    if (view.includes("vote")) return "秘密投票";
    if (view.includes("bluff-write")) return "ウソの定義を入力";
    if (view.includes("ogiri-write")) return "質問を入力";
    if (view.includes("thermo-guess")) return "位置を予想";
    return "回答を入力";
  }

  function renderTurnPass() {
    const name = pname(currentPid());
    shell(`<div class="handoff"><div class="avatar">📱</div><p class="phase-label">PASS THE PHONE</p><h2>${esc(name)}さんに<br>スマホを渡す</h2><p>ほかの人は画面を見ないでください。</p><button class="primary wide" data-action="reveal-turn">${esc(name)}です・${turnLabel(state.turnView)}</button></div>`);
  }

  function renderTurnView() {
    const pid=currentPid(), name=pname(pid), p=state.prompt;
    if (state.turnView === "wolf-secret") return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>あなたのお題</h2><div class="prompt-card secret-card"><small>${esc(p.category)}</small><div class="big-word">${esc(state.assignments[pid])}</div></div><p>覚えたら必ず画面を隠して次へ進んでください。</p><button class="primary wide" data-action="turn-done">覚えた・画面を隠す</button>`);
    if (state.turnView === "ng-secret") {
      const others=state.players.filter(x=>x.id!==pid).map(x=>`<div class="answer-item"><strong>${esc(x.name)}</strong>　${esc(state.assignments[x.id])}</div>`).join("");
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>みんなのNGワード</h2><p>自分のNGワードだけは表示されません。</p><div class="answer-list">${others}</div><button class="primary wide" data-action="turn-done">覚えた・画面を隠す</button>`);
    }
    if (state.turnView === "wolf-vote") {
      const options=state.players.filter(x=>x.id!==pid).map(x=>`<button class="choice" data-action="wolf-vote" data-player="${x.id}">${esc(x.name)}</button>`).join("");
      return shell(`<p class="phase-label">SECRET VOTE · ${esc(name)}</p><h2>ウルフだと思う人は？</h2><div class="stack">${options}</div>`);
    }
    if (["unanimous-answer","telepathy-word-answer","pair-answer"].includes(state.turnView)) {
      const group = state.turnView==="pair-answer" ? `<p><strong>今回の組：</strong>${state.groups[state.groupByPid[pid]].map(pname).map(esc).join("・")}</p>` : "";
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>${esc(p)}</h2>${group}<div class="field"><label>相談せず、短い言葉で回答</label><input id="textAnswer" maxlength="40" autocomplete="off" enterkeyhint="done"></div><button class="primary wide" data-action="submit-text">回答して隠す</button>`);
    }
    if (state.turnView === "majority-answer") {
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>${esc(p.question)}</h2><p>まず自分の回答</p><div class="button-row"><button class="choice ${state.tempChoice==='a'?'selected':''}" data-action="select-choice" data-value="a">${esc(p.a)}</button><button class="choice ${state.tempChoice==='b'?'selected':''}" data-action="select-choice" data-value="b">${esc(p.b)}</button></div><p>次に、多数派になると思う方</p><div class="button-row"><button class="choice ${state.tempPrediction==='a'?'selected':''}" data-action="select-prediction" data-value="a">${esc(p.a)}</button><button class="choice ${state.tempPrediction==='b'?'selected':''}" data-action="select-prediction" data-value="b">${esc(p.b)}</button></div><button class="primary wide" data-action="submit-majority">決定して隠す</button>`);
    }
    if (state.turnView === "minority-answer") {
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>${esc(p.question)}</h2><div class="button-row"><button class="choice" data-action="submit-minority" data-value="a">${esc(p.a)}</button><button class="choice" data-action="submit-minority" data-value="b">${esc(p.b)}</button></div>`);
    }
    if (state.turnView === "closest-answer") {
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>${esc(p.question)}</h2><div class="field"><label>数値だけ入力（${esc(p.unit)}）</label><input id="numberAnswer" type="number" step="any" inputmode="decimal" enterkeyhint="done"></div><button class="primary wide" data-action="submit-number">予想して隠す</button>`);
    }
    if (state.turnView === "thermo-guess") {
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>「${esc(state.clue)}」はどの位置？</h2>${meterHtml(null)}<div class="number-now" id="rangeValue">50</div><input id="rangeAnswer" type="range" min="0" max="100" value="50"><button class="primary wide" data-action="submit-range">ここだと思う・隠す</button>`);
    }
    if (state.turnView === "bluff-write") {
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><h2>「${esc(p.word)}」とは？</h2><p>${p.reading?`読み：${esc(p.reading)}。`:""}本物らしいウソの意味を書いてください。</p><div class="field"><label>偽の定義</label><textarea id="textAnswer" maxlength="100"></textarea></div><button class="primary wide" data-action="submit-text">登録して隠す</button>`);
    }
    if (state.turnView === "bluff-vote") {
      const options=state.candidates.map((c,i)=>`<button class="choice" data-action="bluff-vote" data-index="${i}" ${c.owner===pid?"disabled":""}>${esc(c.text)}${c.owner===pid?"（自分の回答）":""}</button>`).join("");
      return shell(`<p class="phase-label">SECRET VOTE · ${esc(name)}</p><h2>本物の意味はどれ？</h2><div class="stack">${options}</div>`);
    }
    if (state.turnView === "ogiri-write") {
      return shell(`<p class="phase-label">ONLY ${esc(name)}</p><p>答えが「${esc(p)}」になる面白い質問を作ります。</p><div class="prompt-card"><small>先に決まっている答え</small><div class="big-word">${esc(p)}</div></div><div class="field"><label>「？」で終わる質問</label><textarea id="textAnswer" maxlength="100"></textarea></div><button class="primary wide" data-action="submit-text">登録して隠す</button>`);
    }
    if (state.turnView === "ogiri-vote") {
      const options=state.candidates.map((c,i)=>`<button class="choice" data-action="ogiri-vote" data-index="${i}" ${c.owner===pid?"disabled":""}>${esc(c.text)}${c.owner===pid?"（自分の回答）":""}</button>`).join("");
      return shell(`<p class="phase-label">SECRET VOTE · ${esc(name)}</p><h2>一番面白い質問は？</h2><div class="prompt-card"><small>答え</small><div class="big-word">${esc(p)}</div></div><div class="stack">${options}</div>`);
    }
  }

  function meterHtml(pin) {
    const p=state.prompt;
    return `<div class="meter">${pin===null?"":`<span class="meter-pin" style="left:${Math.max(0,Math.min(100,pin))}%"></span>`}</div><div class="range-labels"><span>${esc(p.left)}</span><span>${esc(p.right)}</span></div>`;
  }

  function resolveWolf() {
    const tally={}; Object.values(state.votes).forEach(id=>tally[id]=(tally[id]||0)+1);
    const max=Math.max(0,...Object.values(tally));
    const accused=Object.keys(tally).filter(id=>tally[id]===max);
    const caught=state.wolfIds.some(id=>accused.includes(id));
    if (caught) state.players.filter(p=>!state.wolfIds.includes(p.id)).forEach(p=>addScore(p.id,1)); else state.wolfIds.forEach(id=>addScore(id,2));
    const details=state.players.map(p=>`<div class="answer-item"><strong>${esc(p.name)}</strong>　${state.wolfIds.includes(p.id)?"🐺 ウルフ":"市民"}／お題「${esc(state.assignments[p.id])}」／${tally[p.id]||0}票</div>`).join("");
    endRound(caught?"ウルフを発見！":"ウルフの逃げ切り！",details);
  }

  function resolveText(unanimous) {
    const groups={}; Object.entries(state.answers).forEach(([id,value])=>{ const key=normalize(value); (groups[key]??=[]).push(id); });
    if (unanimous && Object.keys(groups).length===1) allIds().forEach(id=>addScore(id,2));
    else Object.values(groups).filter(g=>g.length>=2).forEach(g=>g.forEach(id=>addScore(id,unanimous?1:g.length-1)));
    const details=Object.values(groups).sort((a,b)=>b.length-a.length).map(g=>`<div class="answer-item"><strong>${esc(state.answers[g[0]])}</strong>　${g.map(pname).map(esc).join("・")}（${g.length}人）</div>`).join("");
    endRound(unanimous && Object.keys(groups).length===1?"全員一致！":"答えを公開",details);
  }

  function resolveMajority() {
    const count={a:0,b:0}; Object.values(state.answers).forEach(v=>count[v.choice]++);
    const majority=count.a===count.b?null:(count.a>count.b?"a":"b");
    if (majority) Object.entries(state.answers).forEach(([id,v])=>{ if(v.choice===majority)addScore(id,1); if(v.prediction===majority)addScore(id,1); });
    const details=state.players.map(x=>{const v=state.answers[x.id]; return `<div class="answer-item"><strong>${esc(x.name)}</strong>　${esc(state.prompt[v.choice])}／予想 ${esc(state.prompt[v.prediction])}</div>`;}).join("");
    endRound(majority?`多数派は「${esc(state.prompt[majority])}」`:`${count.a}対${count.b}で同数！`,details);
  }

  function resolveMinority() {
    const count={a:0,b:0}; Object.values(state.answers).forEach(v=>count[v]++);
    const minority=count.a===count.b||count.a===0||count.b===0?null:(count.a<count.b?"a":"b");
    if(minority) Object.entries(state.answers).filter(([,v])=>v===minority).forEach(([id])=>addScore(id,2));
    const details=`<div class="button-row"><div class="answer-item"><strong>${esc(state.prompt.a)}</strong><br>${count.a}人</div><div class="answer-item"><strong>${esc(state.prompt.b)}</strong><br>${count.b}人</div></div>`+state.players.map(x=>`<div class="answer-item"><strong>${esc(x.name)}</strong>　${esc(state.prompt[state.answers[x.id]])}</div>`).join("");
    endRound(minority?`少数派は「${esc(state.prompt[minority])}」`:`得点なし`,details);
  }

  function resolvePair() {
    const details=state.groups.map((group,i)=>{ const same=new Set(group.map(id=>normalize(state.answers[id]))).size===1; if(same)group.forEach(id=>addScore(id,2)); return `<div class="answer-item"><strong>${i+1}組 ${same?"✨一致":""}</strong><br>${group.map(id=>`${esc(pname(id))}「${esc(state.answers[id])}」`).join(" ／ ")}</div>`; }).join("");
    endRound("ペアの答えを公開",details);
  }

  function resolveClosest() {
    const answer=Number(state.prompt.answer); const diffs=Object.fromEntries(Object.entries(state.answers).map(([id,v])=>[id,Math.abs(Number(v)-answer)]));
    const best=Math.min(...Object.values(diffs)); Object.entries(diffs).filter(([,v])=>Math.abs(v-best)<1e-9).forEach(([id])=>addScore(id,2));
    const details=[...state.players].sort((a,b)=>diffs[a.id]-diffs[b.id]).map(p=>`<div class="answer-item"><strong>${esc(p.name)}</strong>　${esc(state.answers[p.id])} ${esc(state.prompt.unit)}（差 ${Number(diffs[p.id].toFixed(3))}）</div>`).join("");
    const url=/^https?:\/\//.test(state.prompt.source_url||"")?state.prompt.source_url:"";
    endRound(`正解は ${esc(state.prompt.answer)} ${esc(state.prompt.unit)}`,details+`<p>${esc(state.prompt.explanation||"")}</p><p class="source-note">出典：${url?`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(state.prompt.source)}</a>`:esc(state.prompt.source||"")}</p>`);
  }

  function resolveThermo() {
    let giverBest=0;
    const details=state.order.map(id=>{ const distance=Math.abs(state.answers[id]-state.target); const pts=distance<=5?3:distance<=10?2:distance<=20?1:0; if(pts)addScore(id,pts); giverBest=Math.max(giverBest,pts); return `<div class="answer-item"><strong>${esc(pname(id))}</strong>　${state.answers[id]}（差 ${distance}）＋${pts}点</div>`; }).join("");
    if(giverBest)addScore(state.active,giverBest);
    endRound(`秘密の位置は ${state.target}`,meterHtml(state.target)+`<p>ヒント「${esc(state.clue)}」／出題：${esc(pname(state.active))}（＋${giverBest}点）</p>`+details);
  }

  function prepareBluffVotes() {
    state.candidates=shuffle([{owner:null,text:state.prompt.definition},...Object.entries(state.answers).map(([owner,text])=>({owner,text}))]);
    beginTurns("bluff-vote",allIds(),"bluff-votes");
  }

  function resolveBluff() {
    const tally=Array(state.candidates.length).fill(0); Object.values(state.votes).forEach(i=>tally[i]++);
    Object.entries(state.votes).forEach(([voter,index])=>{ const c=state.candidates[index]; if(c.owner===null)addScore(voter,2); else addScore(c.owner,1); });
    const details=state.candidates.map((c,i)=>`<div class="answer-item"><strong>${c.owner===null?"✅ 本物":esc(pname(c.owner))}</strong>　${esc(c.text)}（${tally[i]}票）</div>`).join("");
    endRound(`本当の意味：${esc(state.prompt.definition)}`,details+`<p class="source-note">出典：${esc(state.prompt.source||"日本語WordNet 1.1")}</p>`);
  }

  function prepareOgiriVotes() {
    state.candidates=shuffle(Object.entries(state.answers).map(([owner,text])=>({owner,text}))); beginTurns("ogiri-vote",allIds(),"ogiri-votes");
  }

  function resolveOgiri() {
    const tally=Array(state.candidates.length).fill(0); Object.values(state.votes).forEach(i=>tally[i]++);
    state.candidates.forEach((c,i)=>addScore(c.owner,tally[i]));
    const ranked=state.candidates.map((c,i)=>({...c,voteCount:tally[i]})).sort((a,b)=>b.voteCount-a.voteCount);
    const details=ranked.map(c=>`<div class="answer-item"><strong>${esc(pname(c.owner))}・${c.voteCount}票</strong><br>${esc(c.text)} →「${esc(state.prompt)}」</div>`).join("");
    endRound("投票結果",details);
  }

  function endRound(title,body) { state.result={title,body}; state.phase="round-result"; render(); }

  function renderRoundResult() {
    const last=state.round>=state.roundLimit;
    shell(`<p class="phase-label">ROUND RESULT</p><h2>${state.result.title}</h2>${state.result.body}<h3>スコア</h3><div class="scoreboard">${scoreRows()}</div><button class="primary wide" data-action="${last?"show-final":"next-round"}">${last?"最終結果を見る":"次のラウンド"}</button>`);
  }

  function renderFinal() {
    const top=Math.max(...Object.values(state.scores)); const winners=state.players.filter(p=>state.scores[p.id]===top).map(p=>p.name).join("・");
    shell(`<p class="phase-label">GAME SET</p><h2>🏆 ${esc(winners)}</h2><p>${top}点で優勝！</p><div class="scoreboard">${scoreRows()}</div><div class="button-row"><button class="primary" data-action="play-again">同じメンバーで再戦</button><button class="ghost" data-action="reset">メンバー変更</button></div>`);
  }

  function renderSpecial() {
    const p=state.prompt;
    if(state.phase==="wolf-discuss") return shell(`<p class="phase-label">TALK · PHONE DOWN</p><h2>スマホを伏せて話そう</h2><p>直接お題を言わず、共通点や経験を話します。怪しい人が決まったら秘密投票へ。</p><button class="primary wide" data-action="start-wolf-vote">投票を始める</button>`);
    if(state.phase==="ng-discuss") {
      const buttons=state.players.map(x=>`<button class="${state.caught[x.id]?"danger":"choice"}" data-action="ng-catch" data-player="${x.id}" ${state.caught[x.id]?"disabled":""}>${esc(x.name)} ${state.caught[x.id]?"は脱落":"が言った！"}</button>`).join("");
      return shell(`<p class="phase-label">TALK · PHONE CENTER</p><h2>NGワードを言わせよう</h2><p>スマホを中央へ。誰かが自分のNGワードを言ったら、その人のボタンを押します。</p><div class="stack">${buttons}</div><button class="primary wide" data-action="finish-ng">会話終了・答え合わせ</button>`);
    }
    if(state.phase==="five-ready") return shell(`<p class="phase-label">GET READY</p><h2>${esc(pname(state.active))}さんの番</h2><div class="prompt-card"><div class="big-word">${esc(p)}</div></div><p>お題を読んだら、声で3つ答える準備をしてください。</p><button class="primary wide" data-action="start-five">5秒スタート</button>`);
    if(state.phase==="five-running"||state.phase==="five-judge") return shell(`<p class="phase-label">${state.phase==="five-running"?"ANSWER NOW":"TIME UP"}</p><div class="prompt-card"><div class="big-word">${esc(p)}</div></div><div class="timer" id="timer">${Math.max(0,Math.ceil((state.deadline-Date.now())/1000))}</div><div class="button-row"><button class="good" data-action="five-result" data-success="1">3つ言えた</button><button class="danger" data-action="five-result" data-success="0">失敗</button></div>`);
    if(state.phase==="taboo-pass") return shell(`<div class="handoff"><div class="avatar">🤫</div><p class="phase-label">SECRET</p><h2>${esc(pname(state.active))}さんだけ<br>画面を見る</h2><p>お題と禁止ワードが表示されます。</p><button class="primary wide" data-action="reveal-taboo">説明役です・見る</button></div>`);
    if(state.phase==="taboo-secret") return shell(`<p class="phase-label">ONLY EXPLAINER</p><h2>「${esc(p.word)}」を説明</h2><div class="pill-list">${p.taboo.map(x=>`<span class="pill">言っちゃダメ：${esc(x)}</span>`).join("")}</div><p>覚えたら画面を伏せて45秒開始。</p><button class="primary wide" data-action="start-taboo">覚えた・スタート</button>`);
    if(state.phase==="taboo-running"||state.phase==="taboo-judge") return shell(`<p class="phase-label">PHONE DOWN · EXPLAIN</p><h2>${esc(pname(state.active))}さんが説明中</h2><div class="timer" id="timer">${Math.max(0,Math.ceil((state.deadline-Date.now())/1000))}</div><div class="button-row"><button class="good" data-action="taboo-result" data-success="1">当てた！</button><button class="danger" data-action="taboo-result" data-success="0">禁止語／パス</button></div>`);
    if(state.phase==="thermo-pass") return shell(`<div class="handoff"><div class="avatar">🌡️</div><p class="phase-label">SECRET</p><h2>${esc(pname(state.active))}さんだけ<br>秘密の位置を見る</h2><button class="primary wide" data-action="reveal-thermo">出題者です・見る</button></div>`);
    if(state.phase==="thermo-clue") return shell(`<p class="phase-label">ONLY CLUE GIVER</p><h2>秘密の位置は ${state.target}</h2>${meterHtml(state.target)}<div class="field"><label>数字を使わず、この位置を表す例え</label><input id="clueAnswer" maxlength="50" placeholder="例：少しぬるい温泉"></div><button class="primary wide" data-action="submit-clue">ヒントを決めて隠す</button>`);
    if(state.phase==="coop") return shell(`<p class="phase-label">PHONE CENTER · SPEAK</p><h2>${state.target}までつなげよう</h2><div class="number-now">${state.count}</div><p>次の数字を言った人をタップ。同時に言った・数字を間違えた場合は赤いボタンで1へ戻します。</p><div class="button-row">${state.players.map(x=>`<button class="choice" data-action="coop-speak" data-player="${x.id}">${esc(x.name)}</button>`).join("")}</div><button class="danger wide" data-action="coop-reset">かぶった／間違えた</button><p>リセット ${state.resets}回</p>`);
  }

  function render() {
    if (!meta) { app.innerHTML='<p class="error">ゲームが見つかりません。</p>'; return; }
    if(state.phase==="setup") return renderSetup();
    if(state.phase==="turn-pass") return renderTurnPass();
    if(state.phase==="turn-view") return renderTurnView();
    if(state.phase==="round-result") return renderRoundResult();
    if(state.phase==="final") return renderFinal();
    return renderSpecial();
  }

  app.addEventListener("input", event => {
    if(event.target.id==="rangeAnswer") { const label=document.getElementById("rangeValue"); if(label)label.textContent=event.target.value; }
  });

  app.addEventListener("click", event => {
    const button=event.target.closest("[data-action]"); if(!button)return;
    const action=button.dataset.action;
    if(action==="reset") { if(state.phase!=="setup"&&!confirm("ゲームを終了して設定へ戻りますか？"))return; state={phase:"setup",players:[],scores:{},round:0,roundLimit:3,used:[]}; return render(); }
    if(action==="add-player") { syncDraftNames(); if(draftNames.length<12)draftNames.push(`プレイヤー${draftNames.length+1}`); return renderSetup(); }
    if(action==="remove-player") { syncDraftNames(); draftNames.splice(Number(button.dataset.index),1); return renderSetup(); }
    if(action==="start-game") return startGame();
    if(action==="reveal-turn") { state.phase="turn-view"; return render(); }
    if(action==="turn-done") return completeTurn();
    if(action==="select-choice") { state.tempChoice=button.dataset.value; return render(); }
    if(action==="select-prediction") { state.tempPrediction=button.dataset.value; return render(); }
    if(action==="submit-majority") { if(!state.tempChoice||!state.tempPrediction)return showToast("回答と多数派予想を選んでください"); state.answers[currentPid()]={choice:state.tempChoice,prediction:state.tempPrediction}; return completeTurn(); }
    if(action==="submit-minority") { state.answers[currentPid()]=button.dataset.value; return completeTurn(); }
    if(action==="submit-text") {
      const value=document.getElementById("textAnswer")?.value.trim(); if(!value)return showToast("回答を入力してください");
      if(state.turnView==="ogiri-write"&&!/[?？]$/.test(value))return showToast("質問の最後に「？」を付けてください");
      state.answers[currentPid()]=value; return completeTurn();
    }
    if(action==="submit-number") { const input=document.getElementById("numberAnswer"); if(!input||input.value===""||!Number.isFinite(Number(input.value)))return showToast("数値を入力してください"); state.answers[currentPid()]=Number(input.value); return completeTurn(); }
    if(action==="submit-range") { state.answers[currentPid()]=Number(document.getElementById("rangeAnswer").value); return completeTurn(); }
    if(action==="wolf-vote") { state.votes[currentPid()]=button.dataset.player; return completeTurn(); }
    if(action==="start-wolf-vote") return beginTurns("wolf-vote",allIds(),"wolf-votes");
    if(action==="ng-catch") { state.caught[button.dataset.player]=true; showToast(`${pname(button.dataset.player)}さんを捕まえました`); return render(); }
    if(action==="finish-ng") {
      state.players.filter(p=>!state.caught[p.id]).forEach(p=>addScore(p.id,1));
      const details=state.players.map(p=>`<div class="answer-item"><strong>${esc(p.name)}</strong>　NG「${esc(state.assignments[p.id])}」 ${state.caught[p.id]?"❌脱落":"✅生存 ＋1点"}</div>`).join(""); return endRound("NGワード公開",details);
    }
    if(action==="start-five") { state.deadline=Date.now()+5000; state.phase="five-running"; return render(); }
    if(action==="five-result") { const ok=button.dataset.success==="1"; if(ok)addScore(state.active,2); return endRound(ok?"3つ成功！":"惜しい！",`<div class="prompt-card"><div class="big-word">${esc(state.prompt)}</div></div><p>${esc(pname(state.active))} ${ok?"＋2点":"得点なし"}</p>`); }
    if(action==="reveal-taboo") { state.phase="taboo-secret"; return render(); }
    if(action==="start-taboo") { state.deadline=Date.now()+45000; state.phase="taboo-running"; return render(); }
    if(action==="taboo-result") { const ok=button.dataset.success==="1"; if(ok)addScore(state.active,2); const p=state.prompt; return endRound(ok?"伝わった！":"答え合わせ",`<div class="prompt-card"><div class="big-word">${esc(p.word)}</div></div><div class="pill-list">${p.taboo.map(x=>`<span class="pill">${esc(x)}</span>`).join("")}</div><p>${esc(pname(state.active))} ${ok?"＋2点":"得点なし"}</p>`); }
    if(action==="reveal-thermo") { state.phase="thermo-clue"; return render(); }
    if(action==="submit-clue") { const clue=document.getElementById("clueAnswer")?.value.trim(); if(!clue)return showToast("ヒントを入力してください"); if(/[0-9０-９]/.test(clue))return showToast("数字を使わず表現してください"); state.clue=clue; const guessers=allIds().filter(id=>id!==state.active); return beginTurns("thermo-guess",guessers,"thermo-guesses"); }
    if(action==="bluff-vote"||action==="ogiri-vote") { state.votes[currentPid()]=Number(button.dataset.index); return completeTurn(); }
    if(action==="coop-speak") {
      const pid=button.dataset.player;
      if(state.lastSpeaker===pid){ state.count=0; state.lastSpeaker=null; state.resets++; showToast("同じ人が連続したので1から！"); return render(); }
      state.count++; state.lastSpeaker=pid;
      if(state.count>=state.target){ allIds().forEach(id=>addScore(id,2)); return endRound(`${state.target}まで成功！`,`<p>全員に＋2点。リセットは${state.resets}回でした。</p>`); }
      return render();
    }
    if(action==="coop-reset") { state.count=0; state.lastSpeaker=null; state.resets++; showToast("1から再スタート"); return render(); }
    if(action==="next-round") return startRound();
    if(action==="show-final") { state.phase="final"; return render(); }
    if(action==="play-again") { state.round=0; state.scores={}; state.players.forEach(p=>state.scores[p.id]=0); state.used=[]; return startRound(); }
  });

  setInterval(() => {
    if(!["five-running","taboo-running"].includes(state.phase))return;
    const left=Math.max(0,Math.ceil((state.deadline-Date.now())/1000)); const timer=document.getElementById("timer");
    if(timer){timer.textContent=left; timer.classList.toggle("urgent",left<=3);}
    if(left<=0){state.phase=state.phase==="five-running"?"five-judge":"taboo-judge"; render();}
  },200);

  if(!meta){render();return;}
  fetch("prompts.json").then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{items=Array.isArray(data)?data:(data.items||[]); state.phase="setup"; render();}).catch(()=>{app.innerHTML='<p class="error">お題データを読み込めませんでした。ゲーム一覧から開き直してください。</p>';});
})();
