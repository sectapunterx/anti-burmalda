"use strict";

globalThis.BurmaldaLogos = (() => {
  const side = 12;
  function template(image) {
    const { width, height, data } = image;
    let bytes = "";
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        let r = 0,
          g = 0,
          b = 0,
          alpha = 0,
          count = 0;
        const left = Math.floor((x * width) / side),
          top = Math.floor((y * height) / side);
        const right = Math.max(left + 1, Math.floor(((x + 1) * width) / side)),
          bottom = Math.max(top + 1, Math.floor(((y + 1) * height) / side));
        for (let sy = top; sy < bottom; sy++)
          for (let sx = left; sx < right; sx++) {
            const i = (sy * width + sx) * 4,
              a = data[i + 3];
            alpha += a;
            r += a * data[i];
            g += a * data[i + 1];
            b += a * data[i + 2];
            count++;
          }
        bytes += String.fromCharCode(
          Math.round(r / (alpha || 1)),
          Math.round(g / (alpha || 1)),
          Math.round(b / (alpha || 1)),
          Math.round(alpha / count),
        );
      }
    return { aspect: width / height, grid: btoa(bytes) };
  }
  function valid(t) {
    return (
      t &&
      Number.isFinite(t.aspect) &&
      t.aspect > 0.02 &&
      t.aspect < 50 &&
      typeof t.grid === "string" &&
      t.grid.length === (side * side * 4 * 4) / 3 &&
      /^[A-Za-z0-9+/]+$/.test(t.grid)
    );
  }
  function prepare(t) {
    if (!valid(t)) return null;
    const bytes = Uint8Array.from(atob(t.grid), (c) => c.charCodeAt(0));
    const points = [];
    let r = 0,
      g = 0,
      b = 0,
      sq = 0;
    for (let j = 0; j < side * side; j++) {
      const i = j * 4;
      if (bytes[i + 3] < 180) continue;
      const p = {
        x: ((j % side) + 0.5) / side,
        y: (Math.floor(j / side) + 0.5) / side,
        r: bytes[i],
        g: bytes[i + 1],
        b: bytes[i + 2],
      };
      points.push(p);
      r += p.r;
      g += p.g;
      b += p.b;
      sq += p.r * p.r + p.g * p.g + p.b * p.b;
    }
    const n = points.length,
      variance = sq - (r * r + g * g + b * b) / n;
    // Transparent, single-colour silhouettes use the existing outline matcher.
    if (n < 9 || variance < 420 * n) return null;
    const dist = (a, b) =>
      (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
    const mean = { r: r / n, g: g / n, b: b / n },
      selected = [];
    for (let k = 0; k < 6; k++) {
      let best = -1,
        probe;
      for (const p of points) {
        const saturation = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
        const d = selected.length
          ? Math.min(
              ...selected.map(
                (q) =>
                  dist(p, q) + 1400 * ((p.x - q.x) ** 2 + (p.y - q.y) ** 2),
              ),
            )
          : saturation * saturation * 5 + dist(p, mean);
        if (d > best) {
          best = d;
          probe = p;
        }
      }
      selected.push(probe);
    }
    return { aspect: t.aspect, points, selected, r, g, b, variance };
  }
  function pyramid(frame) {
    const levels = [frame];
    while (
      Math.min(frame.width, frame.height) >= 20 &&
      Math.max(frame.width, frame.height) >= 28
    ) {
      const width = Math.floor(frame.width / 2),
        height = Math.floor(frame.height / 2),
        data = new Uint8ClampedArray(width * height * 4);
      const src = frame.data,
        stride = frame.width * 4;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const j = (y * width + x) * 4,
            i = (2 * y * frame.width + 2 * x) * 4;
          for (let c = 0; c < 4; c++)
            data[j + c] =
              (src[i + c] +
                src[i + 4 + c] +
                src[i + stride + c] +
                src[i + stride + 4 + c]) *
              0.25;
        }
      frame = { width, height, data };
      levels.push(frame);
    }
    return levels;
  }
  function overlap(a, b) {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
  }
  function scoreAt(data, base, offsets, t) {
    let r = 0,
      g = 0,
      b = 0,
      sq = 0,
      cross = 0,
      error = 0;
    for (let k = 0; k < t.points.length; k++) {
      const i = base + offsets[k],
        p = t.points[k],
        R = data[i],
        G = data[i + 1],
        B = data[i + 2];
      r += R;
      g += G;
      b += B;
      sq += R * R + G * G + B * B;
      cross += R * p.r + G * p.g + B * p.b;
      error += Math.abs(R - p.r) + Math.abs(G - p.g) + Math.abs(B - p.b);
    }
    const n = t.points.length,
      variance = sq - (r * r + g * g + b * b) / n;
    if (variance < t.variance * 0.12) return 0;
    const corr =
      (cross - (r * t.r + g * t.g + b * t.b) / n) /
      Math.sqrt(variance * t.variance);
    return (
      100 * (0.74 * Math.min(1, corr) + 0.26 * (1 - error / (n * 3 * 255)))
    );
  }
  function locate(levels, t, threshold) {
    const found = [];
    function keep(box) {
      const same = found.findIndex((b) => overlap(b, box) > 0.52);
      if (same >= 0) {
        const old = found[same];
        if (
          box.score > old.score + 0.25 ||
          (Math.abs(box.score - old.score) <= 0.25 &&
            box.w * box.h > old.w * old.h)
        )
          found[same] = box;
      } else if (found.length < 16) found.push(box);
      else {
        let weakest = 0;
        for (let i = 1; i < found.length; i++)
          if (found[i].score < found[weakest].score) weakest = i;
        if (box.score > found[weakest].score) found[weakest] = box;
      }
    }
    for (const frame of levels) {
      const { width: W, height: H, data } = frame;
      const min = Math.max(12, Math.ceil(6 * t.aspect)),
        max = Math.min(W, H * t.aspect, min * 2.08);
      function scan(w, h) {
        const offset = (p) =>
          4 *
          (Math.min(w - 1, Math.floor(p.x * w)) +
            W * Math.min(h - 1, Math.floor(p.y * h)));
        const anchors = t.selected.map((p) => ({ ...p, offset: offset(p) })),
          offsets = t.points.map(offset);
        const pivot = anchors[0],
          first = pivot.offset;
        const colors = [pivot.r, pivot.g, pivot.b],
          bright = colors.indexOf(Math.max(...colors)),
          dark = colors.indexOf(Math.min(...colors));
        const chroma = (colors[bright] - colors[dark]) * 0.48;
        const dx = Math.max(1, Math.floor(w / 16)),
          dy = Math.max(1, Math.floor(h / 16));
        for (let y = 0; y <= H - h; y += dy)
          for (let x = 0; x <= W - w; x += dx) {
            const base = (y * W + x) * 4;
            const i = base + first;
            if (
              data[i + bright] - data[i + dark] < chroma ||
              Math.abs(data[i] - pivot.r) +
                Math.abs(data[i + 1] - pivot.g) +
                Math.abs(data[i + 2] - pivot.b) >
                147
            )
              continue;
            let passed = 0;
            for (let k = 1; k < anchors.length; k++) {
              const a = anchors[k];
              const i = base + a.offset;
              if (
                Math.abs(data[i] - a.r) +
                  Math.abs(data[i + 1] - a.g) +
                  Math.abs(data[i + 2] - a.b) <
                145
              )
                passed++;
              else if (k === 1) break;
            }
            if (passed < 4) continue;
            const score = scoreAt(data, base, offsets, t);
            if (score >= threshold - 16)
              keep({ x: x / W, y: y / H, w: w / W, h: h / H, score });
          }
      }
      for (let w = min; w <= max; w = Math.max(w + 1, Math.round(w * 1.12)))
        scan(w, Math.min(H, Math.max(1, Math.round(w / t.aspect))));
      if (Math.abs(Math.log(W / H / t.aspect)) < 0.13) scan(W, H);
    }
    for (const box of found) refine(levels[0], t, box);
    return found.filter((box) => box.score >= threshold);
  }
  function refine(frame, t, box) {
    const W = frame.width,
      H = frame.height;
    const cx = (box.x + box.w / 2) * W,
      cy = (box.y + box.h / 2) * H,
      span = box.w * W;
    for (const scale of [1, 1.04, 0.96, 1.08, 0.92]) {
      const w = Math.round(span * scale),
        h = Math.max(1, Math.round(w / t.aspect));
      const offsets = t.points.map(
        (p) => 4 * (Math.floor(p.y * h) * W + Math.floor(p.x * w)),
      );
      for (const dy of [0, -0.022, 0.022, -0.045, 0.045])
        for (const dx of [0, -0.022, 0.022, -0.045, 0.045]) {
          const x = Math.round(cx - w / 2 + dx * w),
            y = Math.round(cy - h / 2 + dy * h);
          if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
          const score = scoreAt(frame.data, 4 * (y * W + x), offsets, t);
          if (score > box.score)
            Object.assign(box, {
              x: x / W,
              y: y / H,
              w: w / W,
              h: h / H,
              score,
            });
        }
    }
    return box;
  }
  return { template, valid, prepare, pyramid, locate, refine, overlap };
})();
