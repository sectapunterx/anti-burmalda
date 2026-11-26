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

  function pixels(width, height, crop) {
    if (!crop) return [0, 0, width, height];
    const x = Math.min(width - 1, Math.round(crop.x * width));
    const y = Math.min(height - 1, Math.round(crop.y * height));
    return [x, y,
      Math.max(1, Math.min(width, Math.round((crop.x + crop.w) * width)) - x),
      Math.max(1, Math.min(height, Math.round((crop.y + crop.h) * height)) - y)];
  }
  function surface(source, width, height, edge = 224, crop) {
    const scale = Math.min(1, edge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    return ctx.getImageData(...pixels(w, h, crop));
  }
  const clipEdge = 768;
  // Keep early samples close together even when the selected interval is long.
  function sampleTimes(duration, limit = 32) {
    const count = Math.min(limit, Math.max(3, Math.ceil(duration * 2)));
    const early = Math.min(6, count);
    const step = Math.min(.55, duration / count);
    return Array.from({length: count}, (_, i) => i < early ? (i + .15) * step :
      early * step + (i - early + .15) * (duration - early * step) / (count - early));
  }
  function clipSurface(video, crop) {
    return surface(video, video.videoWidth, video.videoHeight, crop ? clipEdge : 224, crop);
  }
  // Only anchor timestamps to identifiable recordings, never to a channel or a live playlist.
  function clipSource(video) {
    if (!Number.isFinite(video.duration) || video.srcObject) return null;
    const page = new URL(location.href);
    if (/(^|\.)twitch\.tv$/.test(page.hostname)) {
      if (!video.closest("[data-a-target='video-player'],[data-test-selector='video-player__video-container']")) return null;
      const id = /^\/videos\/(\d+)\/?$/.exec(page.pathname)?.[1];
      return id ? "twitch:" + id : null;
    }
    if (/(^|\.)youtube(?:-nocookie)?\.com$/.test(page.hostname)) {
      if (!video.matches(".html5-video-player video.html5-main-video") ||
          video.closest(".ytp-live,.ad-showing,.ad-interrupting")) return null;
      const id = page.pathname === "/watch" ? page.searchParams.get("v") :
        /^\/(?:shorts|embed)\/([\w-]+)/.exec(page.pathname)?.[1];
      return id && /^[\w-]{11}$/.test(id) ? "youtube:" + id : null;
    }
    if (!/^https?:\/\//i.test(video.currentSrc)) return null;
    const url = new URL(video.currentSrc);
    return !url.search && /\.(mp4|webm|ogv|mov|m4v)$/i.test(url.pathname) ? url.origin + url.pathname : null;
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
    const seen = [];
    const wiggle = 0.85;
    const bounds = pixels(image.width, image.height, rule.crop);
    for (let i = 0; i < rule.frames.length; i++) {
      const { sample } = rule.frames[i];
      if (
        Math.abs(Math.log(bounds[2] / bounds[3] / sample.aspect)) < 0.22 &&
        at(image, sample, ...bounds)
      ) {
        seen.push(i);
      }
    }
    if (track.indices && time - track.lastSeen > rule.duration + wiggle)
      delete track.indices;
    if (seen.length) {
      const sameScene = track.indices?.some(index => seen.includes(index));
      if (track.indices && !sameScene) {
        // A still section can span several reference samples. Its first and
        // last observations bracket the transition even when playback joined mid-hold.
        const next = seen.find(index => track.indices.some(previous => {
          const elapsed = rule.frames[index].time - rule.frames[previous].time;
          return elapsed > 0 && elapsed >= time - track.lastSeen - wiggle &&
            elapsed <= time - track.firstSeen + wiggle;
        }));
        if (next !== undefined) track.until = time + rule.duration - rule.frames[next].time;
      }
      if (!sameScene) track.firstSeen = time;
      track.indices = seen;
      track.lastSeen = time;
    }
    return seen.length > 0 || time < (track.until ?? -Infinity);
  }
  return { signature, surface, at, locate, clipMatch, clipSource, clipSurface, clipEdge, sampleTimes, full };
})();
