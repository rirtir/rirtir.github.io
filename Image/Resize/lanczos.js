// 透明画素のRGBが周囲へにじまないよう、乗算済みアルファで2回に分けて補間する。
function resizeLanczosPremultiplied(source, target) {
  const sw = source.width, sh = source.height, dw = target.width, dh = target.height;
  const input = source.getContext('2d').getImageData(0, 0, sw, sh).data;
  const ctx = target.getContext('2d'), output = ctx.createImageData(dw, dh);
  const intermediate = new Float32Array(dw * sh * 4);
  function kernel(x) {
    x = Math.abs(x);
    if (x < 1e-8) return 1;
    if (x >= 3) return 0;
    const p = Math.PI * x;
    return 3 * Math.sin(p) * Math.sin(p / 3) / (p * p);
  }
  function weights(from, to) {
    const scale = from / to, filter = Math.max(1, scale);
    return Array.from({ length: to }, (_, i) => {
      const center = (i + .5) * scale - .5;
      const start = Math.max(0, Math.ceil(center - 3 * filter));
      const end = Math.min(from - 1, Math.floor(center + 3 * filter));
      const list = [];
      let sum = 0;
      for (let j = start; j <= end; j++) { const weight = kernel((center - j) / filter); list.push([j, weight]); sum += weight; }
      return list.map(([j, weight]) => [j, weight / sum]);
    });
  }
  const wx = weights(sw, dw), wy = weights(sh, dh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < dw; x++) {
    const to = (y * dw + x) * 4;
    for (const [sx, weight] of wx[x]) {
      const from = (y * sw + sx) * 4, alpha = input[from + 3] / 255;
      for (let j = 0; j < 3; j++) intermediate[to + j] += input[from + j] * alpha * weight;
      intermediate[to + 3] += alpha * weight;
    }
  }
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const to = (y * dw + x) * 4, color = [0, 0, 0, 0];
    for (const [sy, weight] of wy[y]) {
      const from = (sy * dw + x) * 4;
      for (let j = 0; j < 4; j++) color[j] += intermediate[from + j] * weight;
    }
    if (color[3] > 1e-8) for (let j = 0; j < 3; j++) output.data[to + j] = color[j] / color[3];
    output.data[to + 3] = Math.max(0, Math.min(1, color[3])) * 255;
  }
  ctx.putImageData(output, 0, 0);
}
