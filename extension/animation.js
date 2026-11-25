"use strict";

// Compare small crops from two passes through the animation. Cells showing
// moving gameplay are discarded unless their changes repeat in phase.
globalThis.BurmaldaAnimation = (() => {
  const width = 16,
    height = 12,
    cells = width * height;
  const canvas = () =>
    new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });

  function read(ctx, el, box) {
    const w = el.videoWidth || el.width,
      h = el.videoHeight || el.height;
    if (!w || !h) return null;
    ctx.drawImage(
      el,
      box.x * w,
      box.y * h,
      box.w * w,
      box.h * h,
      0,
      0,
      width,
      height,
    );
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(cells * 3);
    for (let i = 0; i < cells; i++)
      rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    return rgb;
  }
  function distance(a, b, i) {
    return (
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2])
    );
  }
  function detect(rows) {
    const end = rows.length;
    // Test the shortest credible period first. Two passes must contain the
    // same changes in several positions in the selected rectangle.
    for (let lag = 4; lag <= Math.floor(end / 2); lag++) {
      const start = end - 2 * lag,
        probes = Math.min(12, lag);
      const moving = [],
        reliability = [];
      let strength = 0;
      for (let cell = 0; cell < cells; cell++) {
        const i = cell * 3;
        let aligned = 0,
          changes = 0,
          repeatedChanges = 0,
          error = 0;
        for (let j = 0; j < probes; j++) {
          const k = Math.floor((j * lag) / probes);
          const a = rows[start + k].rgb,
            b = rows[start + lag + k].rgb;
          const other = rows[start + ((k + Math.ceil(lag * 0.43)) % lag)].rgb;
          const err = distance(a, b, i);
          if (err < 76) aligned++;
          error += Math.min(200, err);
          if (distance(a, other, i) > 115) {
            changes++;
            if (err < 69 && distance(b, other, i) > 94) repeatedChanges++;
          }
        }
        if (
          aligned >= probes * 0.72 &&
          changes >= Math.max(2, probes * 0.24) &&
          repeatedChanges >= changes * 0.69
        ) {
          moving.push(cell);
          strength += repeatedChanges / probes;
        }
        if (aligned >= probes * 0.8 && error / probes < 55)
          reliability.push(cell);
      }
      if (moving.length < Math.ceil(cells * 0.095) || strength < cells * 0.052)
        continue;
      const chosen = [...moving];
      // Include the repeatable parts of the artwork for identification when
      // the logo holds still. Limit their weight relative to moving cells.
      for (const cell of reliability) {
        if (chosen.length >= moving.length * 1.6) break;
        if (!chosen.includes(cell)) chosen.push(cell);
      }
      const count = Math.min(24, lag);
      const frames = Array.from({ length: count }, (_, j) => {
        const rgb = rows[start + lag + Math.floor((j * lag) / count)].rgb;
        let raw = "";
        for (const cell of chosen)
          raw += String.fromCharCode(...rgb.subarray(cell * 3, cell * 3 + 3));
        return btoa(raw);
      });
      return {
        duration: rows[start + lag].time - rows[start].time,
        cells: chosen,
        frames,
      };
    }
    return null;
  }
  function compile(cycle) {
    const frames = cycle.frames.map((s) =>
      Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
    );
    const textured = frames.map((frame) => {
      const colors = new Set();
      for (let i = 0; i < frame.length; i += 3)
        colors.add(
          (frame[i] >> 5) * 64 + (frame[i + 1] >> 5) * 8 + (frame[i + 2] >> 5),
        );
      return colors.size >= 7;
    });
    return { ...cycle, frames, textured };
  }
  function match(rgb, cycle, state, now) {
    let best = -1,
      bestError = Infinity;
    for (const [phase, frame] of cycle.frames.entries()) {
      let error = 0,
        close = 0;
      for (const [j, cell] of cycle.cells.entries()) {
        const i = cell * 3,
          k = j * 3;
        const d =
          Math.abs(rgb[i] - frame[k]) +
          Math.abs(rgb[i + 1] - frame[k + 1]) +
          Math.abs(rgb[i + 2] - frame[k + 2]);
        error += Math.min(d, 200);
        if (d < 94) close++;
      }
      if (
        close >= cycle.cells.length * 0.65 &&
        error / cycle.cells.length < 77 &&
        error < bestError
      ) {
        best = phase;
        bestError = error;
      }
    }
    const hold = Math.min(4.5, Math.max(1.3, cycle.duration * 0.36));
    if (now < state.time || now - state.time > hold) state.active = false;
    if (best >= 0) {
      if (cycle.textured[best] && bestError / cycle.cells.length < 39)
        state.active = true;
      if (
        state.phase !== undefined &&
        state.phase !== best &&
        now >= state.time &&
        now - state.time <= hold
      )
        state.active = true;
      state.phase = best;
      state.time = now;
    }
    return !!state.active;
  }
  function valid(c) {
    return (
      c &&
      Number.isFinite(c.duration) &&
      c.duration >= 0.5 &&
      c.duration <= 45 &&
      Array.isArray(c.cells) &&
      c.cells.length >= 12 &&
      c.cells.length <= cells &&
      new Set(c.cells).size === c.cells.length &&
      c.cells.every((n) => Number.isInteger(n) && n >= 0 && n < cells) &&
      Array.isArray(c.frames) &&
      c.frames.length >= 4 &&
      c.frames.length <= 24 &&
      c.frames.every(
        (s) =>
          typeof s === "string" &&
          s.length === c.cells.length * 4 &&
          /^[A-Za-z0-9+/]+$/.test(s),
      )
    );
  }
  function sameSlot(a, b) {
    if (
      !a ||
      !b ||
      a.page !== b.page ||
      a.tag !== b.tag ||
      a.intrinsic !== b.intrinsic ||
      JSON.stringify(a.path) !== JSON.stringify(b.path) ||
      a.src !== b.src
    )
      return false;
    const intersection =
      Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return intersection / (a.w * a.h + b.w * b.h - intersection) > 0.62;
  }
  return { canvas, read, detect, compile, match, valid, sameSlot };
})();
