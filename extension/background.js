"use strict";
importScripts(
  "catalog.js",
  "logo-catalog.js",
  "logomatch.js",
  "registry.js",
  "vision.js",
  "animation.js",
  "ocr/tesseract-core-lstm.js",
  "ocr.js",
);

const registry = BurmaldaRegistry;
let pending = Promise.resolve();
function serial(work) {
  const result = pending.then(work);
  pending = result.catch((e) => console.error("Анти-бурмалда", e.message));
  return result;
}
async function read() {
  const { registry: stored } = await chrome.storage.local.get("registry");
  return stored ? registry.upgrade(stored) : registry.defaults();
}
async function applyNetwork(state) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: registry.networkRules(state),
  });
}
async function init() {
  const state = await read();
  await applyNetwork(state);
  await chrome.storage.local.set({ registry: state });
}
chrome.runtime.onInstalled.addListener(() => serial(init));
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: "edit-here", title: "Анти-бурмалда · Добавить правило здесь",
    contexts: ["all"], documentUrlPatterns: ["http://*/*", "https://*/*"]
  }));
});
chrome.runtime.onStartup.addListener(() => serial(init));

function validateSample(sample) {
  if (
    !(sample?.aspect > 0.02 && sample.aspect < 50) ||
    !Array.isArray(sample.points) ||
    sample.points.length < 8 ||
    sample.points.length > 64 ||
    sample.points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 5 ||
        p.some(
          (v, i) => !Number.isInteger(v) || v < 0 || v > (i < 2 ? 7 : 255),
        ),
    )
  ) {
    throw Error("Повреждённый визуальный образец.");
  }
}
function add(state, input) {
  const { kind } = input;
  const previous = kind === "animation" && input.replace && state.entries.find(e=>
    e.id===input.replace && e.kind==="logo" && BurmaldaAnimation.sameSlot(e.region,input.region));
  const customCount = state.entries.filter(e => !e.id.startsWith("catalog:") && !e.id.startsWith("builtin-")).length;
  if (customCount >= 500 && !previous) throw Error("Достигнут предел в 500 пользовательских правил.");
  let value = String(input.value ?? "").trim();
  if (!value || value.length > 100)
    throw Error("Введите название длиной до 100 символов.");
  if (kind === "domain") value = registry.domain(value);
  if (kind === "name" && !/[\p{L}\p{N}]/u.test(value))
    throw Error("Добавьте букву или цифру.");
  if (
    state.entries.some(
      (e) => e.kind === kind && e.value.toLowerCase() === value.toLowerCase(),
    )
  )
    throw Error("Такое правило уже есть.");
  const entry = { id: crypto.randomUUID(), kind, value };
  if (kind === "logo" || kind === "animation") {
    if (input.region) {
      const {page,path,tag,intrinsic,x,y,w,h,src} = input.region;
      if (typeof page !== "string" || page.length > 8192 || !Array.isArray(path) ||
          !URL.canParse(page) ||
          !path.length || path.length > 32 || !path.every(s => typeof s === "string" && s.length && s.length <= 4096) ||
          typeof tag !== "string" || !/^[a-z][a-z0-9-]*$/.test(tag) ||
          ![x,y,w,h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
          x+w > 1.00001 || y+h > 1.00001 || (src !== undefined && (typeof src !== "string" || src.length > 2048)))
        throw Error("Не удалось сохранить положение области. Выделите её заново.");
      entry.region = {page,path,tag,intrinsic:intrinsic === true,x,y,w,h,...(src && {src})};
    }
    if (kind === "animation") {
      if (!entry.region || !(input.asset && entry.region.tag === "img" && entry.region.src || BurmaldaAnimation.valid(input.cycle)))
        throw Error("Не удалось прочитать образец анимации.");
      if (input.asset && entry.region.src && entry.region.tag === "img") entry.asset = true;
      else entry.cycle = input.cycle;
    } else if (input.sample || !entry.region && !input.template) {
      validateSample(input.sample);
      entry.sample = input.sample;
    }
    if (kind==="logo" && input.template) {
      if (!BurmaldaLogos.valid(input.template)) throw Error("Повреждённый образец логотипа.");
      entry.template=input.template;
      if (input.anchor !== undefined) {
        if (!BurmaldaLogos.validAnchor(input.anchor) || !BurmaldaLogos.prepare(input.template))
          throw Error("Выделите постоянную часть внутри баннера.");
        const {x,y,w,h} = input.anchor;
        entry.anchor = {x,y,w,h};
      }
    }
  } else if (kind === "clip") {
    if (
      !Number.isFinite(input.duration) || input.duration < 1 ||
      !Array.isArray(input.frames) ||
      input.frames.length < 2 ||
      input.frames.length > 32
    )
      throw Error("Неверный формат видеообразца.");
    let prev = -1;
    for (const frame of input.frames) {
      validateSample(frame.sample);
      if (
        !Number.isFinite(frame.time) ||
        frame.time < 0 ||
        frame.time <= prev ||
        frame.time >= input.duration
      )
        throw Error("Неверное время кадра.");
      prev = frame.time;
    }
    entry.duration = input.duration;
    entry.frames = input.frames;
    if (input.origin) {
      const { source, start } = input.origin;
      if (typeof source !== "string" || !source.length || source.length > 8192 ||
          !Number.isFinite(start) || start < 0) throw Error("Неверная отметка начала фрагмента.");
      entry.origin = { source, start };
    }
    if (input.crop !== undefined) {
      const { x, y, w, h } = input.crop || {};
      if (![x,y,w,h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
          x+w > 1.00001 || y+h > 1.00001)
        throw Error("Некорректная область видеофрагмента.");
      entry.crop = { x, y, w, h };
    }
    if (input.clipAction !== undefined) {
      if (!["mask", "skip"].includes(input.clipAction)) throw Error("Неизвестное действие фрагмента.");
      entry.clipAction = input.clipAction;
    }
  } else if (kind !== "name" && kind !== "domain")
    throw Error("Неизвестный тип правила.");
  if (previous) state.entries.splice(state.entries.indexOf(previous),1,{...entry,id:previous.id});
  else state.entries.push(entry);
  return previous?.id || entry.id;
}
async function edit(message) {
  const old = await read(),
    state = structuredClone(old);
  let savedId;
  if (message.action === "add") savedId = add(state, message.entry);
  else if (message.action === "remove")
    state.entries = state.entries.filter((e) => e.id !== message.id);
  else if (message.action==="setting" && message.key==="logoThreshold" && Number.isInteger(message.value) &&
    message.value>=78 && message.value<=97) state.logoThreshold=message.value;
  else if (message.action==="setting" && message.key==="replacementText" && typeof message.value==="string" && message.value.length<=48)
    state.replacementText=message.value.trim() || "анти-бурмалда";
  else if (
    message.action === "setting" &&
    ["enabled", "branded", "strictVideo", "ocr", "youtubeVoice"].includes(message.key) &&
    typeof message.value === "boolean"
  )
    state[message.key] = message.value;
  else throw Error("Неизвестная команда.");
  await applyNetwork(state);
  try {
    const update = {registry: state};
    if (message.action === "remove" && old.entries.some(e => e.id === message.id && e.kind === "clip")) {
      const {clipRanges = []} = await chrome.storage.local.get("clipRanges");
      update.clipRanges = clipRanges.filter(r => r.id !== message.id);
    }
    await chrome.storage.local.set(update);
  } catch (e) {
    await applyNetwork(old);
    throw e;
  }
  return message.returnId ? savedId : true;
}

// Cross-origin <img> often displays normally but taints a page canvas. Decode
// only public image resources, without cookies, and return a small pixel grid.
async function fetchImage(raw) {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Недоступный адрес.");
  const response = await fetch(url.href, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(5000),
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("image/")
  )
    throw Error("Недоступное изображение.");
  const reader = response.body.getReader(),
    parts = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 8 * 1024 * 1024) {
      await reader.cancel();
      throw Error("Слишком большой файл.");
    }
    parts.push(part.value);
  }
  return new Blob(parts, { type: response.headers.get("content-type") });
}
async function readImage(raw, edge) {
  const bitmap = await createImageBitmap(await fetchImage(raw));
  try {
    const frame = BurmaldaVision.surface(bitmap, bitmap.width, bitmap.height, edge === 576 ? 576 : 224);
    const data = new Uint8Array(frame.data.buffer);
    let binary = "";
    for (let i = 0; i < data.length; i += 4096)
      binary += String.fromCharCode(...data.subarray(i, i + 4096));
    return { width: frame.width, height: frame.height, data: btoa(binary) };
  } finally {
    bitmap.close();
  }
}

// A toolbar, keyboard or context-menu invocation grants this document a local
// editing session. A page navigation cannot reuse the token in the new document.
const editorKey = id => "editor-" + id;
async function openEditor(tab, frameId = 0, details = {}) {
  if (!tab?.id) throw Error("Сначала откройте сайт.");
  const token = crypto.randomUUID(), key = editorKey(tab.id);
  const previous = (await chrome.storage.session.get(key))[key];
  if (previous && previous.frameId!==frameId) {
    await chrome.tabs.sendMessage(tab.id,{action:"editor-close"},{frameId:previous.frameId}).catch(()=>{});
  }
  await chrome.storage.session.set({[key]: {token, frameId}});
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, {action:"editor-show", token, details}, {frameId});
    if (!reply?.opened) throw Error();
    return true;
  } catch {
    if ((await chrome.storage.session.get(key))[key]?.token===token) await chrome.storage.session.remove(key);
    throw Error("Обновите вкладку сайта после установки. На служебной странице редактор недоступен.");
  }
}
async function openCurrentEditor() {
  const [tab] = await chrome.tabs.query({active:true, lastFocusedWindow:true});
  return openEditor(tab);
}
chrome.contextMenus.onClicked.addListener((info,tab) => {
  if (info.menuItemId === "edit-here") openEditor(tab,info.frameId ?? 0,{
    fromContext:true, selection:info.selectionText, link:info.linkUrl, media:info.mediaType
  }).catch(console.warn);
});
chrome.commands.onCommand.addListener((command,tab) => {
  if (command === "open-editor") openEditor(tab).catch(console.warn);
});
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove(editorKey(id)));

async function selectedPixels(sender, rect) {
  if (sender.frameId !== 0) throw Error("Для снимка области откройте редактор через значок расширения в основной вкладке.");
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) throw Error("Выделите область снова.");
  const [x,y,w,h] = rect;
  if (x<0 || y<0 || w<=0 || h<=0 || x+w>1.00001 || y+h>1.00001) throw Error("Область выходит за границы вкладки.");
  const sameTab = async () => {
    const [active] = await chrome.tabs.query({active:true, windowId:sender.tab.windowId});
    if (active?.id !== sender.tab.id || active.url !== sender.tab.url) throw Error("Вкладка сменилась. Выделите область снова.");
  };
  await sameTab();
  const png = await chrome.tabs.captureVisibleTab(sender.tab.windowId,{format:"png"});
  await sameTab();
  const bitmap = await createImageBitmap(await (await fetch(png)).blob());
  try {
    const width = w*bitmap.width, height = h*bitmap.height;
    const scale = Math.min(1,224/Math.max(width,height));
    const canvas = new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
    canvas.getContext("2d").drawImage(bitmap,x*bitmap.width,y*bitmap.height,width,height,0,0,canvas.width,canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type:"image/png"})).arrayBuffer());
    let binary="";
    for (let i=0;i<bytes.length;i+=4096) binary+=String.fromCharCode(...bytes.subarray(i,i+4096));
    return "data:image/png;base64,"+btoa(binary);
  } finally { bitmap.close(); }
}
async function author(m,sender) {
  const key = editorKey(sender.tab.id);
  const session = (await chrome.storage.session.get(key))[key];
  if (!session || m.token !== session.token || sender.frameId !== session.frameId)
    throw Error("Откройте редактор заново через значок расширения.");
  if (m.action === "editor-pixels") return selectedPixels(sender,m.rect);
  return serial(()=>edit({action:"add",entry:m.entry,returnId:true}));
}
async function rememberSkip({source, id, start, end}) {
  if (typeof source !== "string" || !source || source.length > 8192 ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
    throw Error("Некорректные границы пропуска.");
  const state = await read();
  const active = new Set(state.entries.filter(e => e.kind === "clip" && e.clipAction !== "mask").map(e => e.id));
  if (!active.has(id)) return;
  const {clipRanges = []} = await chrome.storage.local.get("clipRanges");
  const rows = clipRanges.filter(r => active.has(r.id));
  if (rows.some(r => r.id === id && r.source === source && Math.abs(r.start-start) < 1)) return;
  rows.push({source, id, start, end});
  await chrome.storage.local.set({clipRanges: rows.slice(-256)});
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  let job;
  if (m?.action === "image" && sender.tab && typeof m.url === "string")
    job = readImage(m.url, m.edge);
  else if (m?.action === "ocr" && sender.tab) job = recognize(m);
  else if (sender.tab && m?.action === "remember-skip") job=serial(() => rememberSkip(m));
  else if (sender.tab && ["editor-pixels","editor-save"].includes(m?.action)) job=author(m,sender);
  else if (
    sender.url?.startsWith(chrome.runtime.getURL("")) &&
    !sender.tab?.url?.startsWith("http")
  )
    job = m.action === "editor-open" ? openCurrentEditor() : serial(() => edit(m));
  else return false;
  job.then(
    (value) => reply({ value }),
    (e) => reply({ error: e.message }),
  );
  return true;
});
