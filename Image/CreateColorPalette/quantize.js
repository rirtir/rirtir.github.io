// Workerで解析・原寸変換を行い、操作画面を止めない。
function distance(a, b) { return 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2; }
function nearest(color, palette) {
  let best = 0, min = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = distance(color, palette[i]);
    if (d < min) { min = d; best = i; }
  }
  return best;
}
function average(colors) {
  const sum = [0, 0, 0];
  let weight = 0;
  for (const c of colors) { weight += c[3]; for (let j = 0; j < 3; j++) sum[j] += c[j] * c[3]; }
  return sum.map(v => Math.round(v / weight));
}
function extract(data, requested, method) {
  const histogram = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    histogram.set(key, (histogram.get(key) || 0) + data[i + 3] / 255);
  }
  const colors = [...histogram].map(([key, n]) => [key >> 16, (key >> 8) & 255, key & 255, n]).sort((a, b) => b[3] - a[3]);
  const count = Math.min(requested, colors.length);
  if (count === 0) return [];
  if (colors.length <= requested) return colors.map(c => c.slice(0, 3));
  let palette;
  if (method === 'rgb') palette = colors.slice(0, count).map(c => c.slice(0, 3));
  else if (method === 'median') {
    const boxes = [colors.slice()];
    while (boxes.length < count) {
      boxes.sort((a, b) => b.length - a.length);
      const box = boxes.shift();
      const ranges = [0, 1, 2].map(j => {
        let min = 255, max = 0;
        for (const c of box) { min = Math.min(min, c[j]); max = Math.max(max, c[j]); }
        return max - min;
      });
      const dim = ranges.indexOf(Math.max(...ranges));
      box.sort((a, b) => a[dim] - b[dim]);
      const mid = Math.ceil(box.length / 2);
      boxes.push(box.slice(0, mid), box.slice(mid));
    }
    palette = boxes.map(average);
  } else {
    palette = [colors[0].slice(0, 3)];
    const distances = colors.map(() => Infinity);
    while (palette.length < count) {
      let best = 0, score = -1;
      for (let i = 0; i < colors.length; i++) {
        distances[i] = Math.min(distances[i], distance(colors[i], palette[palette.length - 1]));
        const value = distances[i] * Math.sqrt(colors[i][3]);
        if (value > score) { score = value; best = i; }
      }
      palette.push(colors[best].slice(0, 3));
    }
    for (let iteration = 0; iteration < 6; iteration++) {
      const groups = Array.from({ length: count }, () => []);
      for (const c of colors) groups[nearest(c, palette)].push(c);
      palette = groups.map((g, i) => g.length ? average(g) : palette[i]);
    }
  }
  // 同じ色を「別の1色」として補充しない。利用できる異なる色だけを補う。
  palette = [...new Map(palette.map(c => [c.join(','), c])).values()];
  const seen = new Set(palette.map(c => c.join(',')));
  for (const c of colors) {
    if (palette.length >= count) break;
    const rgb = c.slice(0, 3), key = rgb.join(',');
    if (!seen.has(key)) { palette.push(rgb); seen.add(key); }
  }
  return palette;
}
function remap(data, palette) {
  if (!palette.length) return data;
  const cache = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let color = cache.get(key);
    if (!color) {
      color = palette[nearest([data[i], data[i + 1], data[i + 2]], palette)];
      // 大きい写真でもキャッシュが無制限に増えないようにする。
      if (cache.size < 100000) cache.set(key, color);
    }
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
  return data;
}
self.onmessage = ({ data: job }) => {
  try {
    const pixels = new Uint8ClampedArray(job.pixels);
    const palette = job.type === 'extract' ? extract(pixels, job.count, job.method) : job.palette;
    remap(pixels, palette);
    self.postMessage({ id: job.id, palette, width: job.width, height: job.height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) { self.postMessage({ id: job.id, error: error.message }); }
};
