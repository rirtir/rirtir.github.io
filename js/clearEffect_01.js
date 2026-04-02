function showClearEffect(overlayId = 'clearOverlay', pos = {}) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  const {
    x = '50%',
    y = '50%'
  } = pos;

  // ===== ラッパー =====
  const wrapper = document.createElement('div');
  wrapper.className = 'clearEffectWrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.left = x;
  wrapper.style.top = y;
  wrapper.style.transform = 'translate(-50%, -50%)'; // 中心基準
  wrapper.style.textAlign = 'center';
  wrapper.style.width = '100%';
  overlay.appendChild(wrapper);

  // ===== テキスト =====
  const text = document.createElement('div');
  text.className = 'clearText';
  text.innerText = 'CLEAR';
  wrapper.appendChild(text);

  // ===== 横ライン =====
  const line = document.createElement('div');
  line.className = 'clearLine';
  wrapper.appendChild(line);

  // ===== パーティクル =====
  const particles = [];

  const spreadX = 1.0; // ← 横広がり
  const spreadY = 0.5; // ← 縦広がり

  for(let i=0;i<30;i++){
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = '50%';
    p.style.top = '50%';
    wrapper.appendChild(p);

    const angle = Math.random() * Math.PI * 2;
    const radius = 80 + Math.random() * 80;

    particles.push({
      el: p,
      endX: Math.cos(angle) * radius * spreadX,
      endY: Math.sin(angle) * radius * spreadY,
      delay: Math.random() * 100,
    });
  }

  const duration = 400;
  const fadeStart = 100;
  const totalTime = 600;

  const startTime = performance.now();

  function easeOut(t, k=4) {
    return 1 - Math.pow(1 - t, k);
  }

  function easeIn(t) {
    return Math.pow(t, 3);
  }

  function animate(now) {
    const elapsed = now - startTime;

    // ===== ライン伸びる =====
    if(elapsed > 100){
      const t = Math.min(1, (elapsed - 100) / 400);
      line.style.height = ((1 - easeOut(t)) * 30) + 'px';
    }

    particles.forEach(p => {
      const tRaw = (elapsed - p.delay) / duration;
      const t = Math.max(0, Math.min(1, tRaw));

      const moveT = easeOut(t, 3);
      const x = p.endX * moveT;
      const y = p.endY * moveT;

      let fadeT = (elapsed - p.delay - fadeStart) / (totalTime - fadeStart);
      fadeT = Math.max(0, Math.min(1, fadeT));
      const fade = easeIn(fadeT);

      const scale = 1 - fade;
      const opacity = 1 - fade;

      p.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      p.el.style.opacity = opacity;
    });

    if(elapsed < totalTime){
      requestAnimationFrame(animate);
    } else {
      // パーティクルだけ削除
      particles.forEach(p => p.el.remove());
    }
  }

  requestAnimationFrame(animate);
}

function closeClearEffect(overlayId = 'clearOverlay') {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;

  const wrappers = overlay.querySelectorAll('.clearEffectWrapper');
  wrappers.forEach(w => w.remove());
}
