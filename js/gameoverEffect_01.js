function showGameoverEffect(overlayId, pos = {}) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  const {
    x = '50%',
    y = '50%'
  } = pos;

  // ===== ラッパー =====
  const wrapper = document.createElement('div');
  wrapper.className = 'gameoverEffectWrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.left = x;
  wrapper.style.top = y;
  wrapper.style.transform = 'translate(-50%, -50%)'; // 中心基準
  wrapper.style.textAlign = 'center';
  wrapper.style.width = '100%';
  overlay.appendChild(wrapper);

  // ===== テキスト =====
  const text = document.createElement('div');
  text.className = 'gameoverText';
  text.innerText = 'GAME OVER';
  wrapper.appendChild(text);
}

function closeGameoverEffect(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;

  const wrappers = overlay.querySelectorAll('.gameoverEffectWrapper');
  wrappers.forEach(w => w.remove());
}
