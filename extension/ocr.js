"use strict";
// One local recognition job at a time across all tabs. The service worker
// releases the model with its normal idle lifecycle.
let ocrEngine,
  ocrBusy = false;
async function loadOCR() {
  const module = await TesseractCore({
    locateFile: (name) => chrome.runtime.getURL("ocr/" + name),
    TesseractProgress() {},
  });
  for (const lang of ["eng", "rus"]) {
    const file = lang + ".traineddata";
    const result = await fetch(chrome.runtime.getURL("ocr/" + file));
    if (!result.ok) throw Error("Не удалось открыть модель распознавания.");
    module.FS.writeFile("/" + file, new Uint8Array(await result.arrayBuffer()));
  }
  const api = new module.TessBaseAPI();
  if (api.Init(null, "eng+rus", 1, null) !== 0)
    throw Error("Ошибка запуска распознавания.");
  api.SetVariable("tessedit_pageseg_mode", "11");
  return { module, api };
}

function textRegion(tsv, width, height, matcher) {
  const lines = new Map();
  for (const row of tsv.split("\n")) {
    const [
      level,
      page,
      block,
      paragraph,
      line,
      ,
      x,
      y,
      w,
      h,
      confidence,
      word,
    ] = row.split("\t");
    if (level !== "5" || +confidence < 30 || !word?.trim()) continue;
    const key = [page, block, paragraph, line].join("/");
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ word: word.trim(), x: +x, y: +y, w: +w, h: +h });
  }
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (const words of lines.values()) {
    let text = "";
    for (const word of words) {
      if (text) text += " ";
      word.start = text.length;
      text += word.word;
      word.end = text.length;
    }
    for (const match of matcher.matches(text))
      for (const word of words) {
        if (
          word.end <= match.index ||
          word.start >= match.index + match[0].length
        )
          continue;
        left = Math.min(left, word.x);
        top = Math.min(top, word.y);
        right = Math.max(right, word.x + word.w);
        bottom = Math.max(bottom, word.y + word.h);
      }
  }
  return right > left
    ? {
        x: left / width,
        y: top / height,
        w: (right - left) / width,
        h: (bottom - top) / height,
      }
    : null;
}

async function recognize(m) {
  if (ocrBusy) return { retry: true };
  ocrBusy = true;
  try {
    const prefs = await read();
    if (!prefs.enabled || !prefs.ocr) return { box: null };
    let blob;
    if (m.url) blob = await fetchImage(m.url);
    else {
      if (
        typeof m.frame !== "string" ||
        m.frame.length > 2500000 ||
        !m.frame.startsWith("data:image/jpeg;base64,")
      )
        throw Error("Недоступный кадр.");
      blob = await (await fetch(m.frame)).blob();
    }
    const bitmap = await createImageBitmap(blob);
    let encoded, width, height;
    try {
      const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
      width = Math.max(1, Math.round(bitmap.width * scale));
      height = Math.max(1, Math.round(bitmap.height * scale));
      const surface = new OffscreenCanvas(width, height),
        ctx = surface.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      encoded = await surface.convertToBlob({ type: "image/png" });
    } finally {
      bitmap.close();
    }
    ocrEngine ??= loadOCR().catch((e) => {
      ocrEngine = null;
      throw e;
    });
    const { module, api } = await ocrEngine;
    module.FS.writeFile("/input", new Uint8Array(await encoded.arrayBuffer()));
    try {
      if (api.SetImageFile(1, 0) !== 0)
        throw Error("Не удалось прочитать кадр.");
      api.SetSourceResolution(150);
      api.Recognize(null);
      return {
        box: textRegion(
          api.GetTSVText(),
          width,
          height,
          BurmaldaRegistry.matcher(prefs.entries),
        ),
      };
    } finally {
      api.Clear();
      module.FS.unlink("/input");
    }
  } finally {
    ocrBusy = false;
  }
}
