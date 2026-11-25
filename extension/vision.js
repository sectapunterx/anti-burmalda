"use strict";

// An 8×8 colour grid retains the layout of the sample. Transparent cells do
// not participate, allowing a cutout logo to match different backgrounds.
globalThis.BurmaldaVision = (() => {
  const grid = 8;
  function signature(image) {
    const points = [],
      transparent = [];
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        const px = Math.floor(((x + 0.5) * image.width) / grid);
        const py = Math.floor(((y + 0.5) * image.height) / grid);
        const i = (py * image.width + px) * 4;
        if (image.data[i + 3] >= 200)
          points.push([x, y, ...image.data.slice(i, i + 3)]);
        else if (image.data[i + 3] < 35) transparent.push([x, y]);
      }
    if (points.length < 8)
      throw Error("Слишком мало видимых деталей. Обрежьте прозрачные поля.");
    const mean = [2, 3, 4].map(
      (c) => points.reduce((v, p) => v + p[c], 0) / points.length,
    );
    const contrast = (p) =>
      mean.reduce((v, m, i) => v + Math.abs(p[i + 2] - m), 0);
    let silhouette;
    if (points.reduce((v, p) => v + contrast(p), 0) / points.length < 28) {
      if (transparent.length < 8)
        throw Error("Однотонный образец. Выберите кадр с различимым рисунком.");
      silhouette = { transparent, color: mean.map(Math.round) };
    }
    points.sort((a, b) => contrast(b) - contrast(a));
    return {
      aspect: image.width / image.height,
      points,
      ...(silhouette && { silhouette }),
    };
  }

  function surface(source, width, height, edge = 224) {
    const scale = Math.min(1, edge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function at(image, sig, left, top, width, height, threshold) {
    const { data, width: stride } = image;
    let error = 0,
      close = 0,
      n = 0;
    for (const [x, y, r, g, b] of sig.points) {
      const px = left + Math.floor(((x + 0.5) * width) / grid);
      const py = top + Math.floor(((y + 0.5) * height) / grid);
      const i = (py * stride + px) * 4;
      if (data[i + 3] < 120) return false;
      const delta =
        Math.abs(data[i] - r) +
        Math.abs(data[i + 1] - g) +
        Math.abs(data[i + 2] - b);
      error += delta;
      if (delta <= 105) close++;
      n++;
      if ((n === 5 && error > 620) || error > 66 * sig.points.length)
        return false;
    }
    if (close < n * 0.78) return false;
    if (threshold && 100*(.7*close/n+.3*(1-error/(n*765)))<threshold) return false;
    if (sig.silhouette) {
      const { transparent, color } = sig.silhouette;
      let background = 0;
      for (const [x, y] of transparent) {
        const i =
          ((top + Math.floor(((y + 0.5) * height) / grid)) * stride +
            left +
            Math.floor(((x + 0.5) * width) / grid)) *
          4;
        const distance =
          Math.abs(data[i] - color[0]) +
          Math.abs(data[i + 1] - color[1]) +
          Math.abs(data[i + 2] - color[2]);
        if (data[i + 3] < 100 || distance > 100) background++;
      }
      return background >= transparent.length * 0.75;
    }
    return true;
  }

  const full = { x: 0, y: 0, w: 1, h: 1 };
  function locate(image, sig, threshold) {
    const W = image.width,
      H = image.height;
    if (
      Math.abs(Math.log(W / H / sig.aspect)) < 0.2 &&
      at(image, sig, 0, 0, W, H, threshold)
    )
      return full;
    // Anchor the last window to each edge: corner watermarks are common.
    const max = Math.min(W, H * sig.aspect);
    for (
      let width = max;
      width >= 14 && width / sig.aspect >= 6;
      width /= 1.16
    ) {
      const w = Math.round(width),
        h = Math.min(H, Math.round(width / sig.aspect));
      const dx = Math.max(1, Math.round(w / 14)),
        dy = Math.max(1, Math.round(h / 14));
      for (let y = 0; ; y = Math.min(y + dy, H - h)) {
        for (let x = 0; ; x = Math.min(x + dx, W - w)) {
          if (at(image, sig, x, y, w, h, threshold))
            return { x: x / W, y: y / H, w: w / W, h: h / H };
          if (x === W - w) break;
        }
        if (y === H - h) break;
      }
    }
    return null;
  }

  // Match two distinct ordered keyframes on the media clock, then cover the
  // remainder of that reference clip. A single keyframe masks only that instant.
  function clipMatch(image, rule, time, track) {
    let seen = -1;
    const wiggle = 0.85;
    for (let i = 0; i < rule.frames.length; i++) {
      const { sample } = rule.frames[i];
      if (
        Math.abs(Math.log(image.width / image.height / sample.aspect)) < 0.22 &&
        at(image, sample, 0, 0, image.width, image.height)
      ) {
        seen = i;
        break;
      }
    }
    if (seen >= 0) {
      const offset = rule.frames[seen].time;
      if (
        track.index !== undefined &&
        seen > track.index &&
        Math.abs(
          time - track.time - (offset - rule.frames[track.index].time),
        ) <= wiggle
      ) {
        track.until = time + rule.duration - offset;
      }
      if (seen !== track.index) {
        track.index = seen;
        track.time = time;
      }
    }
    if (track.index !== undefined && time - track.time > rule.duration + wiggle)
      delete track.index;
    return seen >= 0 || time < (track.until ?? -Infinity);
  }
  return { signature, surface, at, locate, clipMatch, full };
})();
