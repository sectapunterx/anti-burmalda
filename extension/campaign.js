"use strict";

// Sparse colour samples from opaque parts of the supplied artwork and two observed
// animation phases. Coordinates are fractions of the ad, independent of the player.
const winlinePatterns = [
  { name: "nextgen", aspect: 2.389, probes: [
    [0.134,0.417,116,38,199], [0.878,0.375,30,28,33], [0.163,0.736,135,37,190], [0.081,0.722,107,38,179],
    [0.192,0.278,119,38,201], [0.843,0.236,31,28,33], [0.901,0.569,26,29,35], [0.227,0.458,249,151,49],
    [0.233,0.681,210,53,61], [0.407,0.625,255,153,41], [0.709,0.458,157,55,43], [0.744,0.778,116,35,42],
    [0.262,0.097,248,162,49], [0.855,0.097,230,157,46], [0.116,0.097,235,159,48], [0.355,0.278,190,90,205],
    [0.5,0.847,124,36,173], [0.791,0.667,102,28,32], [0.448,0.222,162,99,157]
  ] },
  { name: "winline", aspect: 2.37, probes: [
    [0.147,0.63,104,36,173], [0.881,0.261,42,28,46], [0.165,0.717,110,36,177], [0.119,0.413,91,33,145],
    [0.229,0.239,88,33,138], [0.872,0.609,42,29,52], [0.78,0.174,50,32,54], [0.606,0.783,116,35,199],
    [0.514,0.804,122,38,211], [0.239,0.109,217,157,98], [0.853,0.109,217,165,101], [0.239,0.848,126,38,151],
    [0.734,0.478,240,117,20], [0.651,0.413,99,82,66], [0.33,0.413,131,118,110], [0.523,0.696,143,36,132],
    [0.45,0.065,106,37,95], [0.78,0.696,91,27,91]
  ] },
  { name: "banner", aspect: 1.535, probes: [
    [0.487,0.684,145,64,148], [0.252,0.213,168,97,85], [0.193,0.452,244,182,145], [0.248,0.303,205,131,112],
    [0.29,0.116,199,88,53], [0.315,0.581,108,16,0], [0.218,0.555,203,122,95], [0.424,0.51,145,73,103],
    [0.454,0.6,140,20,246], [0.378,0.71,108,47,7], [0.189,0.858,115,22,232], [0.571,0.445,126,32,227],
    [0.63,0.471,155,75,154], [0.706,0.368,242,201,254], [0.752,0.116,109,62,54], [0.916,0.084,247,74,7],
    [0.538,0.742,79,43,70], [0.294,0.368,54,0,0], [0.45,0.381,138,31,3], [0.639,0.568,255,243,255]
  ] },
  { name: "promo", aspect: 1.64, probes: [
    [0.486,0.809,182,89,253], [0.774,0.393,140,83,71], [0.664,0.584,168,105,67], [0.753,0.169,86,22,10],
    [0.877,0.506,98,32,19], [0.603,0.64,249,160,207], [0.411,0.843,191,83,247], [0.26,0.258,246,254,245],
    [0.116,0.517,247,252,248], [0.26,0.562,253,254,246], [0.493,0.584,218,209,228], [0.664,0.764,143,21,0],
    [0.719,0.438,215,137,127], [0.849,0.697,123,40,24], [0.363,0.876,120,42,192], [0.568,0.73,163,61,246],
    [0.788,0.618,187,114,95]
  ] },
  { name: "panel", aspect: 0.561, probes: [
    [0.037,0.563,169,87,72], [0.819,0.244,255,72,0], [0.797,0.072,255,255,255], [0.019,0.611,191,124,106],
    [0.838,0.477,255,72,0], [0.666,0.488,22,22,22], [0.828,0.435,255,72,0], [0.812,0.582,22,22,22],
    [0.2,0.433,139,48,49], [0.269,0.342,115,28,18], [0.203,0.74,65,36,36], [0.188,0.847,255,106,42],
    [0.8,0.898,255,72,1], [0.656,0.777,255,255,255], [0.619,0.633,22,22,22], [0.278,0.502,52,7,9],
    [0.091,0.277,132,17,232], [0.291,0.209,255,255,255], [0.931,0.935,39,26,49], [0.903,0.988,22,22,22]
  ] },
];

globalThis.BurmaldaCampaign = (() => {
  // The lettering changes between frames. The slanted orange rim, violet
  // left edge and dark right edge stay in place throughout the animation.
  const badgeOutline = { aspect: 2.45, probes: [
    [.12,.48,108,37,175], [.90,.42,33,29,35], [.14,.72,112,38,181],
    [.16,.24,104,37,173], [.23,.24,110,38,177], [.09,.60,102,38,169],
    [.86,.24,35,30,42], [.88,.67,34,29,38], [.85,.78,43,30,48],
    [.65,.22,75,31,97], [.49,.84,132,37,164],
    [.14,.09,218,153,93], [.24,.09,218,153,93], [.34,.09,218,153,93],
    [.83,.09,218,153,93], [.90,.09,218,153,93],
    [.11,.91,202,140,107], [.24,.91,202,140,107],
  ] };
  const panelImage = /^\/panel-\d+-image-175a8062-ae65-4216-90e5-b7536719528a$/;

  function knownAddress(raw, base) {
    if (!raw) return false;
    try {
      const u = new URL(raw, base);
      return (u.origin === "https://panels.twitch.tv" && panelImage.test(u.pathname)) ||
        (u.hostname === "10k.win" && /^\/b\/[a-z\d_-]+\/?$/i.test(u.pathname));
    } catch { return false; }
  }

  function distance(data, offset, probe) {
    return Math.abs(data[offset] - probe[2]) + Math.abs(data[offset + 1] - probe[3]) +
      Math.abs(data[offset + 2] - probe[4]);
  }

  function locate(frame, pattern) {
    const { data, width, height } = frame;
    const probes = pattern.probes;
    const first = probes[0];
    const candidates = [];
    let hasSecondColor = false;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const offset = (y * width + x) * 4;
        if (!hasSecondColor && distance(data, offset, probes[1]) < 100) hasSecondColor = true;
        if (data[offset + 3] >= 190 && distance(data, offset, first) < 70)
          candidates.push(offset);
      }
    }
    if (!candidates.length || !hasSecondColor) return null;
    let best = null;
    let bestError = 49 * probes.length;
    const maxWidth = Math.min(width, height * pattern.aspect);
    for (let size = maxWidth; size >= 30; size /= 1.065) {
      const w = Math.round(size), h = Math.min(height, Math.round(size / pattern.aspect));
      const originX = Math.round(first[0] * (w - 1)), originY = Math.round(first[1] * (h - 1));
      const offsets = probes.map(([x,y]) =>
        4 * (Math.round(y * (h - 1)) * width + Math.round(x * (w - 1))));
      for (const pivot of candidates) {
        const pixel = pivot / 4;
        const left = pixel % width - originX, top = Math.floor(pixel / width) - originY;
        if (left < 0 || top < 0 || left + w > width || top + h > height) continue;
        const base = pivot - offsets[0];
        if (distance(data, base + offsets[1], probes[1]) > 100 ||
            distance(data, base + offsets[2], probes[2]) > 110) continue;
        let error = 0;
        for (let i = 0; i < probes.length && error < bestError; i++) {
          error += Math.min(170, distance(data, base + offsets[i], probes[i]));
        }
        if (error < bestError) {
          bestError = error;
          best = { x:left/width, y:top/height, w:w/width, h:h/height };
        }
      }
    }
    return best;
  }

  // During the transition the character and lettering change, while the
  // purple ribbon remains below the badge. Require evidence in that region.
  function companion(frame, badge) {
    const x = Math.max(0, badge.x - .45 * badge.w), y = badge.y + 1.12 * badge.h;
    const w = Math.min(1-x, 1.50*badge.w), h = Math.min(1-y, 2.5*badge.h);
    if (h < badge.h || w <= 0) return null;
    let purple = 0, white = 0, warm = 0, samples = 0;
    for (let iy = Math.ceil(y*frame.height); iy < (y+h)*frame.height; iy += 2) {
      for (let ix = Math.ceil(x*frame.width); ix < (x+w)*frame.width; ix += 2) {
        const i = (iy*frame.width+ix)*4;
        const r=frame.data[i], g=frame.data[i+1], b=frame.data[i+2];
        if (b>130 && b-g>75 && r-g>35 && b-r>35) purple++;
        if (Math.min(r,g,b)>198) white++;
        if (r>120 && r-g>55 && r-b>65) warm++;
        samples++;
      }
    }
    return purple > samples*.027 && white > samples*.022 && warm > samples*.035 ? {x,y,w,h} : null;
  }

  function detect(frame) {
    const [nextgen, wordmark, description, promo, poster] = winlinePatterns;
    const badge = locate(frame, badgeOutline) || locate(frame, nextgen) || locate(frame, wordmark);
    const banner = (badge && companion(frame,badge)) ||
      locate(frame, description) || locate(frame, promo);
    const panel = locate(frame, poster);
    return [badge, banner, panel].filter(Boolean);
  }
  return { knownAddress, detect };
})();
