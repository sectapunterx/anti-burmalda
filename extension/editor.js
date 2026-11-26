"use strict";

(() => {
  let closeEditor, contextTarget;
  document.addEventListener(
    "contextmenu",
    (e) => {
      contextTarget = e.composedPath()[0];
    },
    true,
  );
  const clock = (t) => {
    const s = Math.floor(t);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  function editor(token, details) {
    closeEditor?.();
    const selection = (
      details.selection ||
      getSelection()?.toString() ||
      ""
    ).trim();
    const host = document.createElement("div");
    host.setAttribute("data-ab-editor", "");
    host.setAttribute("popover", "manual");
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;background:transparent!important;border:0!important;margin:0!important;padding:0!important;pointer-events:none!important;z-index:2147483647!important";
    const root = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host::backdrop{background:none;pointer-events:none}
      *{box-sizing:border-box}
      [hidden]{display:none!important}
       .panel,.tip{font:14px/1.45 "Segoe UI",Arial,sans-serif;color:#eaf3ee;background:#14281f;border:1px solid #547562;border-radius:14px;box-shadow:0 10px 34px #0005}
      .panel{pointer-events:auto;position:absolute;right:14px;bottom:14px;width:min(354px,calc(100% - 28px));max-height:calc(100% - 28px);overflow:auto;padding:16px}
      .head,.tabs,.actions{display:flex;align-items:center;gap:6px}
      .head{justify-content:space-between;font-size:17px;font-weight:650}
      .tabs{margin:12px 0;flex-wrap:wrap}
      .tabs button{padding:5px 8px;font-size:13px}
      .tabs [aria-pressed=true]{background:#a9f7cf;color:#10291b;border-color:transparent}
      button,input{font:inherit}
      button{background:#203b2e;color:inherit;border:1px solid #52705f;border-radius:7px;padding:7px 10px;cursor:pointer}
      button:disabled{opacity:.5;cursor:default}
      button:focus-visible,input:focus-visible{outline:2px solid #9bf7bf;outline-offset:2px}
      input{width:100%;padding:8px 10px;border:1px solid #688673;border-radius:6px;color:#14261c;background:#fff;margin:4px 0 9px}
      .hint,.status{font-size:13px;margin:6px 0 10px;color:#d0dfd5}
      .status:empty{display:none}
      .replace input{width:auto;margin:0 6px 0 0}
      .actions{justify-content:space-between;margin-top:8px}
      .clip-options{display:grid;gap:8px;margin:8px 0}
      .clip-options select{font:inherit;border-radius:5px}
      .primary{background:#92ecc0;color:#112a1b;font-weight:650}
      .preview{display:block;max-width:100%;max-height:78px;margin:6px 0 9px}
      .anchor{display:block;max-width:100%;max-height:180px;width:auto;height:auto;cursor:crosshair;touch-action:none}
      .layer{position:absolute;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none}
      .outline{position:absolute;border:2px solid #9affc8;box-shadow:0 0 0 1px #123c29;pointer-events:none}
      .tip{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:8px 12px;text-align:center;pointer-events:none}
    `);
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `
      <section class="panel" role="dialog" aria-label="Добавить правило">
        <div class="head">Добавить правило <button class="close" aria-label="Закрыть">×</button></div>
        <div class="tabs" aria-label="Тип правила"></div>
        <div class="hint"></div>
        <label><span class="label"></span><input maxlength="100" autocomplete="off"></label>
        <img class="preview" alt="Выбранный образец" hidden>
        <canvas class="anchor" aria-label="Выделите постоянный рисунок на снимке баннера" hidden></canvas>
        <label class="replace" hidden><input type="checkbox"><span></span></label>
        <div class="status" role="status" aria-live="polite"></div>
        <div class="clip-options" hidden>
          <button class="clip-area">Выбрать область</button>
          <label>При совпадении <select class="clip-action">
            <option value="skip">Пропустить, если можно</option>
            <option value="mask">Закрыть без перемотки</option>
          </select></label>
          <div class="seek-controls" hidden aria-label="Перемотка">
            <button data-seconds="-10">−10 с</button>
            <button data-seconds="10">+10 с</button>
            <button data-seconds="60">+1 мин</button>
          </div>
        </div>
        <div class="actions"><button class="pick"></button><button class="primary">Сохранить</button></div>
      </section>
      <div class="layer" hidden><div class="outline" hidden></div></div>
      <div class="tip" hidden></div>
    `;
    const get = (s) => root.querySelector(s);
    const panel = get(".panel"),
      input = get("input"),
      note = get(".status"),
      pick = get(".pick"),
      save = get(".primary");
    const layer = get(".layer"),
      outline = get(".outline"),
      tip = get(".tip"),
      preview = get(".preview");
    const target = details.fromContext ? contextTarget : null;
    const previousFocus = document.activeElement,
      events = new AbortController();
    let mode,
      draft,
      animationJob,
      previousRule,
      recording,
      bannerImage, anchorDrag,
      clipMark,
      drag,
      choosing,
      disposed = false,
      step = 0,
      pending = false;
    const titles = {
      name: "Название",
      logo: "Баннер",
      reference: "Логотип",
      family: "Баннер с промокодом",
      animation: "Анимация",
      clip: "Фрагмент",
      domain: "Домен",
    };
    const tips = {
      name: "Слово или фраза для поиска на сайтах и в субтитрах.",
      logo: "Обведите знак на вебке или всю область анимации. После сохранения маска будет постоянно закрывать это место на этой странице.",
      reference:
        "Обведите только знак. Расширение будет искать похожий рисунок в разных местах и масштабах. Порог совпадения задаётся в настройках.",
      family: "Обведите весь баннер. Затем на снимке выделите постоянный рисунок или эмблему без промокода.",
      animation:
        "Обведите один движущийся баннер со всеми его положениями. Запись остановится, когда движение повторится. Отдельную GIF-картинку можно выбрать щелчком.",
      clip: "Обведите вставку или нажмите «Начало фрагмента» для всего кадра. Перемотайте к концу на шкале плеера или кнопками и нажмите «Конец фрагмента».",
      domain: "Укажите домен рекламодателя. Можно выбрать ссылку на странице.",
    };
    async function request(action, extra) {
      const r = await chrome.runtime.sendMessage({ action, token, ...extra });
      if (!r || r.error)
        throw Error(r?.error || "Расширение недоступно. Обновите вкладку.");
      return r.value;
    }
    function refresh() {
      save.disabled =
        pending ||
        !input.value.trim() ||
        (["logo", "reference", "family", "clip", "animation"].includes(mode) && !draft);
      pick.disabled = pending;
      get(".clip-area").disabled = pending || !!recording;
    }
    function releaseRecording() {
      if (!recording) return;
      clearInterval(recording.timer);
      recording.events.abort();
      const {video, restore} = recording;
      if (restore && sameRecording(recording)) {
        video.currentTime = restore.time;
        if (restore.playing) video.play().catch(() => {});
      }
      get(".seek-controls").hidden = true;
      BurmaldaRecording.delete(recording.video);
      recording = null;
    }
    function stopPicking() {
      choosing = null;
      drag = null;
      outline.hidden = layer.hidden = tip.hidden = true;
      panel.hidden = false;
    }
    function close() {
      if (disposed) return;
      disposed = true;
      step++;
      releaseRecording();
      stopAnimation();
      events.abort();
      host.remove();
      if (previousFocus?.isConnected)
        previousFocus.focus?.({ preventScroll: true });
      if (closeEditor === close) closeEditor = null;
    }
    closeEditor = close;
    function setMode(kind) {
      step++;
      pending = false;
      releaseRecording();
      stopAnimation();
      get(".replace").hidden = true;
      previousRule = null;
      stopPicking();
      draft = null;
      mode = kind;
      bannerImage = anchorDrag = null;
      get(".anchor").hidden = true;
      clipMark = null;
      get(".clip-options").hidden = kind !== "clip";
      get(".clip-action").value = "skip";
      save.textContent = "Сохранить";
      note.textContent = "";
      preview.hidden = true;
      preview.removeAttribute("src");
      for (const b of get(".tabs").children)
        b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
      get(".hint").textContent = tips[kind];
      get(".label").textContent =
        kind === "domain"
          ? "Домен рекламодателя"
          : kind === "name"
            ? "Название или фраза"
            : "Название образца";
      input.value = kind === "name" ? selection.slice(0, 100) : "";
      if (kind === "domain" && details.link) {
        try {
          input.value = new URL(details.link).hostname;
        } catch {}
      }
      if (["logo", "reference", "family", "clip", "animation"].includes(kind))
        input.value =
          titles[kind] +
          " · " +
          location.hostname +
          " · " +
          new Date().toLocaleTimeString("ru-RU");
      pick.textContent = {
        name: "Выделить текст",
        logo: "Выбрать область",
        reference: "Выбрать логотип",
        family: "Выбрать баннер",
        animation: "Выбрать анимацию",
        clip: "Начало фрагмента",
        domain: "Выбрать ссылку",
      }[kind];
      refresh();
    }
    function startPicking(kind) {
      choosing = kind;
      panel.hidden = true;
      layer.hidden = tip.hidden = false;
      tip.textContent = {
        logo: "Обведите баннер или нажмите на картинку · Esc для отмены",
        reference:
          "Обведите логотип как можно ближе к его краям · Esc для отмены",
        animation:
          "Обведите один баннер с небольшим запасом или нажмите на отдельную GIF · Esc для отмены",
        domain: "Нажмите на ссылку рекламодателя · Esc для отмены",
        clip: "Нажмите на нужный плеер · Esc для отмены",
        clipArea: "Обведите вставку внутри видео. Запись начнётся, когда вы отпустите мышь · Esc для отмены",
        family: "Обведите баннер целиком, включая промокод · Esc для отмены",
      }[kind];
    }
    // Picking in the frame where the editor was invoked also works in embedded players.
    function elementsAt(x, y) {
      host.style.setProperty("visibility", "hidden", "important");
      try {
        return document.elementsFromPoint(x, y);
      } finally {
        host.style.removeProperty("visibility");
      }
    }
    function mediaIn(elements, tag) {
      return (
        elements.find((e) => e.matches(tag)) ||
        elements
          .flatMap((e) =>
            e.shadowRoot ? [...e.shadowRoot.querySelectorAll(tag)] : [],
          )
          .find((e) => e.getClientRects().length)
      );
    }
    function readableCrop(media, rect) {
      if (!media) return null;
      const box = media.getBoundingClientRect(),
        css = getComputedStyle(media);
      const w = media.videoWidth || media.naturalWidth || media.width,
        h = media.videoHeight || media.naturalHeight || media.height;
      if (
        !w ||
        !h ||
        css.objectPosition !== "50% 50%" ||
        css.transform !== "none"
      )
        return null;
      let dw = box.width,
        dh = box.height;
      if (css.objectFit !== "fill") {
        let scale =
          css.objectFit === "cover"
            ? Math.max(dw / w, dh / h)
            : Math.min(dw / w, dh / h);
        if (css.objectFit === "none") scale = 1;
        if (css.objectFit === "scale-down") scale = Math.min(1, scale);
        dw = w * scale;
        dh = h * scale;
      }
      const sx = ((rect.x - box.left - (box.width - dw) / 2) * w) / dw,
        sy = ((rect.y - box.top - (box.height - dh) / 2) * h) / dh;
      const sw = (rect.w * w) / dw,
        sh = (rect.h * h) / dh;
      if (sx < -0.5 || sy < -0.5 || sx + sw > w + 0.5 || sy + sh > h + 0.5)
        return null;
      const c = document.createElement("canvas"),
        scale = Math.min(1, 224 / Math.max(sw, sh));
      c.width = Math.max(1, Math.round(sw * scale));
      c.height = Math.max(1, Math.round(sh * scale));
      c.getContext("2d").drawImage(
        media,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        c.width,
        c.height,
      );
      return c.toDataURL("image/png");
    }
    async function capture(rect, media) {
      const version = ++step;
      const region =
        mode === "reference" || mode === "family" ? null : BurmaldaRegions.capture(media, rect);
      draft = null;
      pending = true;
      refresh();
      layer.hidden = tip.hidden = true;
      try {
        let data;
        try {
          if (media?.matches("video,img,canvas"))
            data = readableCrop(media, rect);
        } catch {}
        if (!data) {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          if (disposed || version !== step) return;
          data = await request("editor-pixels", {
            rect: [
              rect.x / innerWidth,
              rect.y / innerHeight,
              rect.w / innerWidth,
              rect.h / innerHeight,
            ],
          });
        }
        const img = new Image();
        img.src = data;
        await img.decode();
        if (disposed || version !== step) return;
        if (mode === "family") {
          bannerImage = img;
          const canvas = get(".anchor");
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.style.width = Math.min(320, 180*img.width/img.height) + "px";
          canvas.getContext("2d").drawImage(img,0,0);
          canvas.hidden = false;
          pick.textContent = "Выбрать заново";
          note.textContent = "Теперь обведите на снимке постоянный рисунок. Остальная часть баннера может меняться.";
          return;
        }
        const frame = BurmaldaVision.surface(img, img.width, img.height);
        const template = mode === "reference" && BurmaldaLogos.template(frame);
        draft =
          template && BurmaldaLogos.prepare(template)
            ? { template }
            : {
                ...(region && { region }),
                sample: BurmaldaVision.signature(frame),
              };
        preview.src = data;
        preview.hidden = false;
        pick.textContent = "Выбрать заново";
        note.textContent = region
          ? "Маска закрепится в выделенной области. Образец также будет искаться в других местах."
          : "Сохранится образец для поиска по изображению.";
      } catch (err) {
        if (version === step) {
          if (region) {
            draft = { region };
            preview.hidden = true;
            pick.textContent = "Выбрать заново";
            note.textContent =
              "Область готова к закреплению. Для поиска в других местах не удалось получить различимый кадр.";
          } else note.textContent = err.message;
        }
      } finally {
        if (version === step) {
          pending = false;
          stopPicking();
          refresh();
        }
      }
    }
    const anchorCanvas = get(".anchor");
    function anchorPoint(e) {
      const r = anchorCanvas.getBoundingClientRect();
      const unit = n => Math.max(0, Math.min(1, n));
      return [unit((e.clientX-r.left)/r.width), unit((e.clientY-r.top)/r.height)];
    }
    anchorCanvas.onpointerdown = e => {
      if (e.button !== 0 || !bannerImage || anchorDrag) return;
      anchorDrag = { point:anchorPoint(e), id:e.pointerId };
      anchorCanvas.setPointerCapture(e.pointerId);
      draft = null;
      refresh();
    };
    function selectAnchor(e) {
      if (!anchorDrag || e.pointerId !== anchorDrag.id) return;
      const [ax,ay] = anchorDrag.point, [bx,by] = anchorPoint(e);
      const W = anchorCanvas.width, H = anchorCanvas.height;
      const x = Math.floor(Math.min(ax,bx)*W), y = Math.floor(Math.min(ay,by)*H);
      const w = Math.ceil(Math.max(ax,bx)*W)-x, h = Math.ceil(Math.max(ay,by)*H)-y;
      const ctx = anchorCanvas.getContext("2d");
      ctx.drawImage(bannerImage,0,0);
      if (e.type === "pointerup") {
        anchorDrag = null;
        if (w >= 6 && h >= 6) {
          const anchor = {x:x/W,y:y/H,w:w/W,h:h/H};
          const template = BurmaldaLogos.template(ctx.getImageData(x,y,w,h));
          if (BurmaldaLogos.validAnchor(anchor) && BurmaldaLogos.prepare(template)) draft = {template, anchor};
        }
        note.textContent = draft ? "Образец готов. При совпадении маска закроет весь баннер."
          : "Выберите более крупный участок с различимым рисунком.";
        refresh();
      }
      ctx.strokeStyle = "#41f59e";
      ctx.lineWidth = 2;
      ctx.strokeRect(x,y,w,h);
    }
    anchorCanvas.onpointermove = anchorCanvas.onpointerup = selectAnchor;
    anchorCanvas.onpointercancel = () => { anchorDrag=null; };
    function stopAnimation() {
      if (!animationJob) return;
      clearInterval(animationJob.timer);
      animationJob.events.abort();
      BurmaldaRecording.delete(animationJob.media);
      animationJob = null;
    }
    function finishAnimation(cycle, reason) {
      if (!animationJob) return;
      const { region } = animationJob;
      stopAnimation();
      draft = cycle ? { region, cycle } : { region, fixed: true };
      note.textContent = cycle
        ? "Повтор подтверждён · " +
          cycle.duration.toFixed(1) +
          " с. Можно сохранить."
        : reason +
          " Можно выделить баннер заново или закрыть это место постоянно.";
      save.textContent = cycle ? "Сохранить" : "Закрепить постоянно";
      get(".replace").hidden = !cycle || !previousRule;
      pick.textContent = "Выбрать заново";
      refresh();
    }
    function startAnimation(rect, media) {
      stopPicking();
      stopAnimation();
      const version = ++step;
      draft = null;
      previousRule = null;
      get(".replace").hidden = true;
      save.textContent = "Сохранить";
      preview.hidden = true;
      const region = BurmaldaRegions.capture(media, rect);
      refresh();
      if (!region) {
        note.textContent =
          "Не удалось привязать область к элементу. Выделите баннер ещё раз.";
        return;
      }
      chrome.storage.local
        .get("registry")
        .then(({ registry }) => {
          if (disposed || version !== step) return;
          previousRule = registry?.entries.find(
            (e) =>
              e.kind === "logo" && BurmaldaAnimation.sameSlot(e.region, region),
          );
          if (previousRule) {
            get(".replace span").textContent =
              "Заменить постоянную маску «" + previousRule.value + "»";
            get(".replace input").checked = true;
            get(".replace").hidden = !!draft?.fixed;
          }
        })
        .catch(() => {});
      if (media.localName === "img" && region.src) {
        draft = { asset: true, region };
        note.textContent =
          "Картинка выбрана. Маска будет закрывать выделение во всех кадрах этой GIF.";
        pick.textContent = "Выбрать заново";
        refresh();
        return;
      }
      const job = { media, region, events: new AbortController(), rows: [] };
      animationJob = job;
      const video = media.localName === "video";
      if (!((video && region.intrinsic) || media.localName === "canvas")) {
        finishAnimation(null, "Кадры этой области недоступны.");
        return;
      }
      const source = media.currentSrc,
        stream = media.srcObject,
        ctx = BurmaldaAnimation.canvas();
      const started = performance.now();
      let lastTime = -Infinity;
      BurmaldaRecording.add(media);
      pick.textContent = "Остановить запись";
      function sample() {
        if (
          !media.isConnected ||
          document.hidden ||
          source !== media.currentSrc ||
          stream !== media.srcObject
        ) {
          finishAnimation(null, "Вкладка или источник видео изменились.");
          return;
        }
        const seconds = (performance.now() - started) / 1000;
        if (seconds >= 65 || job.rows.length >= 260) {
          finishAnimation(null, "За время записи повтор не подтвердился.");
          return;
        }
        const time = video ? media.currentTime : seconds;
        note.textContent =
          "Ищу повтор движения · " + Math.floor(seconds) + " с";
        if (video && (media.paused || media.readyState < 2)) {
          note.textContent = "Запустите видео, чтобы продолжить запись.";
          return;
        }
        if (time === lastTime) return;
        lastTime = time;
        try {
          const rgb = BurmaldaAnimation.read(ctx, media, region);
          if (!rgb) return;
          job.rows.push({ time, rgb });
          if (job.rows.length % 6 === 1) {
            const b = BurmaldaRegions.box(media, region),
              r = media.getBoundingClientRect();
            if (b) {
              const image = readableCrop(media, {
                x: r.left + b.x * r.width,
                y: r.top + b.y * r.height,
                w: b.w * r.width,
                h: b.h * r.height,
              });
              if (image) {
                preview.src = image;
                preview.hidden = false;
              }
            }
          }
          if (job.rows.length >= 8 && job.rows.length % 4 === 0) {
            const cycle = BurmaldaAnimation.detect(job.rows);
            if (BurmaldaAnimation.valid(cycle)) finishAnimation(cycle);
          }
        } catch {
          finishAnimation(null, "Браузер не дал прочитать кадры области.");
        }
      }
      media.addEventListener(
        "seeking",
        () => finishAnimation(null, "Видео перемотано."),
        { signal: job.events.signal },
      );
      job.timer = setInterval(sample, 245);
      sample();
    }
    function begin(video, crop) {
      if (!video || video.readyState < 2 || !video.videoWidth) {
        note.textContent = "Сначала запустите видео.";
        return;
      }
      const rec = {
        video,
        crop,
        source: BurmaldaVision.clipSource(video),
        start: video.currentTime,
        src: video.currentSrc,
        stream: video.srcObject,
        frames: [],
        interval: 0.45,
        events: new AbortController(),
      };
      draft = null;
      recording = rec;
      BurmaldaRecording.add(video);
      preview.hidden = true;
      function abort(msg) {
        releaseRecording();
        draft = null;
        pick.textContent = "Начало фрагмента";
        note.textContent = msg;
        refresh();
      }
      function sample() {
        if (!sameRecording(rec)) {
          abort("Видео сменилось. Отметьте начало заново.");
          return;
        }
        get(".seek-controls").hidden = !video.seekable.length;
        if (video.seeking || video.readyState < 2) return;
        const time = video.currentTime - rec.start;
        if (time < 0) {
          note.textContent = "Начало отмечено в " + clock(rec.start) + ". Выберите конец позже этой отметки.";
          return;
        }
        note.textContent =
          "Запись " +
          clock(time) +
          " · начало " +
          clock(rec.start) +
          (video.paused ? " · пауза" : "");
        if (time - (rec.frames.at(-1)?.time ?? -1) < rec.interval) return;
        try {
          const frame = BurmaldaVision.clipSurface(video, crop);
          const signature = BurmaldaVision.signature(frame);
          if (!rec.frames.length) {
            const c = document.createElement("canvas");
            c.width = frame.width;
            c.height = frame.height;
            c.getContext("2d").putImageData(frame, 0, 0);
            preview.src = c.toDataURL();
            preview.hidden = false;
          }
          if (rec.frames.length >= 32) {
            rec.frames = rec.frames.filter((_, i) => i < 6 || i % 2 === 0);
            rec.interval *= 2;
          }
          rec.frames.push({ time, sample: signature });
        } catch (err) {
          if (err.name === "SecurityError")
            abort(
              "Плеер запрещает чтение кадров. Записать образец из этого видео не удалось.",
            );
        }
      }
      pick.textContent = "Конец фрагмента";
      refresh();
      rec.timer = setInterval(sample, 150);
      video.addEventListener(
        "seeking",
        () => { rec.scrubbed = true; },
        { signal: rec.events.signal },
      );
      video.addEventListener("ended", finish, { signal: rec.events.signal });
      sample();
    }
    function sameRecording(rec) {
      return rec.video.isConnected && rec.src === rec.video.currentSrc &&
        rec.stream === rec.video.srcObject &&
        (!rec.source || BurmaldaVision.clipSource(rec.video) === rec.source);
    }
    get(".seek-controls").onclick = event => {
      const button = event.target.closest("[data-seconds]");
      if (!recording || pending || !button) return;
      const {video, start} = recording;
      const ranges = video.seekable;
      for (let i = 0; i < ranges.length; i++) {
        if (video.currentTime < ranges.start(i) || video.currentTime > ranges.end(i)) continue;
        video.currentTime = Math.min(ranges.end(i), Math.max(ranges.start(i), start,
          video.currentTime + Number(button.dataset.seconds)));
        break;
      }
    };
    function seekFrame(video, time, signal) {
      return new Promise((resolve, reject) => {
        const listeners = new AbortController();
        const done = ok => {
          clearTimeout(timer);
          listeners.abort();
          signal.removeEventListener("abort", cancel);
          if (ok) resolve();
          else reject(Error("Плеер не дал прочитать кадры после перемотки."));
        };
        const cancel = () => done(false);
        const timer = setTimeout(cancel, 5000);
        signal.addEventListener("abort", cancel, {once:true});
        video.addEventListener("seeked", () => done(Math.abs(video.currentTime - time) < .3),
          {once:true, signal:listeners.signal});
        video.addEventListener("error", cancel, {once:true, signal:listeners.signal});
        try { video.currentTime = time; } catch { cancel(); }
      });
    }
    async function finish() {
      const rec = recording;
      if (!rec || pending) return;
      const video = rec.video;
      if (!sameRecording(rec)) {
        releaseRecording();
        setMode("clip");
        note.textContent = "Видео сменилось. Отметьте начало заново.";
        return;
      }
      const end = video.currentTime, duration = end - rec.start;
      let frames = rec.frames.filter(f => f.time < duration);
      if (duration < 1 && !rec.video.ended) {
        note.textContent = "Выберите конец хотя бы на секунду позже начала.";
        return;
      }
      if (duration >= 1 && (rec.scrubbed || video.seeking) && video.seekable.length) {
        pending = true;
        refresh();
        clearInterval(rec.timer);
        rec.restore = { time: end, playing: !video.paused };
        video.pause();
        get(".seek-controls").hidden = true;
        const samples = [];
        try {
          const times = BurmaldaVision.sampleTimes(duration, 12);
          for (const [index, time] of times.entries()) {
            if (!sameRecording(rec)) throw Error("Видео сменилось.");
            note.textContent = "Считываю кадры · " + (index + 1) + " из " + times.length;
            await seekFrame(video, rec.start + time, rec.events.signal);
            if (!sameRecording(rec)) throw Error("Видео сменилось.");
            const frame = BurmaldaVision.clipSurface(video, rec.crop);
            try { samples.push({time, sample: BurmaldaVision.signature(frame)}); }
            catch { /* Uniform frames are not useful for recognition. */ }
          }
          if (samples.length >= 2) frames = samples;
        } catch (err) {
          if (recording !== rec) return;
          if (!sameRecording(rec) || frames.length < 2) {
            releaseRecording();
            setMode("clip");
            note.textContent = err.message;
            return;
          }
        }
        pending = false;
      }
      releaseRecording();
      pick.textContent = "Записать заново";
      if (duration >= 1 && frames.length >= 2) {
        clipMark = {video, src:rec.src, stream:rec.stream, start:rec.start, end, source:rec.source};
        draft = { duration, frames, ...(rec.crop && { crop: rec.crop }) };
        if (rec.source && BurmaldaVision.clipSource(rec.video) === rec.source)
          draft.origin = { source: rec.source, start: rec.start };
        note.textContent =
          "Границы " +
          clock(rec.start) +
          " — " +
          clock(rec.start + duration) +
          " · " +
          duration.toFixed(1) +
          " с";
      } else
        note.textContent =
          "Слишком мало различимых кадров. Выберите другой фрагмент.";
      refresh();
    }
    for (const [kind, title] of Object.entries(titles)) {
      const b = document.createElement("button");
      b.textContent = title;
      b.dataset.kind = kind;
      b.onclick = () => {
        setMode(kind);
        if (["animation", "reference", "family"].includes(kind)) startPicking(kind);
      };
      get(".tabs").append(b);
    }
    get(".clip-area").onclick = () => startPicking("clipArea");
    pick.onclick = () => {
      if (animationJob) {
        finishAnimation(null, "Запись остановлена.");
        return;
      }
      if (mode === "name") {
        choosing = "name";
        panel.hidden = true;
        tip.hidden = false;
        tip.textContent = "Выделите название на странице · Esc для отмены";
        return;
      }
      if (mode !== "clip") {
        startPicking(mode);
        return;
      }
      if (recording) {
        finish();
        return;
      }
      const players = [...document.querySelectorAll("video")].filter((v) => {
        const r = v.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < innerHeight &&
          r.left < innerWidth
        );
      });
      if (target?.localName === "video" && target.isConnected) begin(target);
      else if (players.length === 1) begin(players[0]);
      else if (players.length) startPicking("clip");
      else
        note.textContent =
          "Запустите видео. Для встроенного плеера откройте редактор правым кликом внутри него.";
    };
    layer.onpointerdown = (e) => {
      if (e.button !== 0 || drag) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      layer.setPointerCapture(e.pointerId);
    };
    function rectTo(x, y) {
      x = Math.max(0, Math.min(innerWidth, x));
      y = Math.max(0, Math.min(innerHeight, y));
      return {
        x: Math.min(x, drag.x),
        y: Math.min(y, drag.y),
        w: Math.abs(x - drag.x),
        h: Math.abs(y - drag.y),
      };
    }
    layer.onpointermove = (e) => {
      if (
        !drag ||
        drag.id !== e.pointerId ||
        !["logo", "reference", "family", "animation", "clipArea"].includes(choosing)
      )
        return;
      const r = rectTo(e.clientX, e.clientY);
      outline.hidden = false;
      Object.assign(outline.style, {
        left: r.x + "px",
        top: r.y + "px",
        width: r.w + "px",
        height: r.h + "px",
      });
    };
    layer.onpointercancel = stopPicking;
    layer.onpointerup = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      let r = rectTo(e.clientX, e.clientY);
      drag = null;
      const items = elementsAt(r.x + r.w / 2, r.y + r.h / 2),
        kind = choosing;
      if (kind === "domain") {
        stopPicking();
        const link = items.map((el) => el.closest("a[href]")).find(Boolean);
        if (link && /^https?:$/.test(link.protocol)) {
          input.value = link.hostname;
          note.textContent = "Проверьте домен перед сохранением.";
        } else
          note.textContent =
            "У элемента нет веб-ссылки. Можно ввести домен вручную.";
        refresh();
        return;
      }
      if (kind === "clip") {
        stopPicking();
        begin(mediaIn(items, "video"));
        return;
      }
      if (kind === "clipArea") {
        stopPicking();
        const video = mediaIn(items, "video");
        const region = video && BurmaldaRegions.capture(video, r);
        if (r.w < 8 || r.h < 6 || !region?.intrinsic) {
          note.textContent = "Обведите вставку внутри изображения видео, без полей плеера.";
          return;
        }
        const { x, y, w, h } = region;
        begin(video, { x, y, w, h });
        return;
      }
      const media = BurmaldaRegions.targetAt(items, r);
      if (r.w < 5 && r.h < 5) {
        const el = media || items[0];
        if (!el || el.matches("video,html,body,iframe")) {
          stopPicking();
          note.textContent = "Обведите сам баннер внутри страницы или плеера.";
          return;
        }
        const b = el.getBoundingClientRect(),
          x = Math.max(0, b.left),
          y = Math.max(0, b.top);
        r = {
          x,
          y,
          w: Math.min(innerWidth, b.right) - x,
          h: Math.min(innerHeight, b.bottom) - y,
        };
      }
      if (r.w < 8 || r.h < 6) {
        stopPicking();
        note.textContent = "Выделите область покрупнее.";
        return;
      }
      outline.hidden = true;
      if (kind === "animation") startAnimation(r, media);
      else capture(r, media);
    };
    input.oninput = refresh;
    document.addEventListener(
      "pointerup",
      () => {
        if (choosing !== "name") return;
        setTimeout(() => {
          if (disposed || choosing !== "name") return;
          const text = getSelection()?.toString().trim();
          if (!text) return;
          input.value = text.slice(0, 100);
          stopPicking();
          refresh();
          input.focus({ preventScroll: true });
        }, 0);
      },
      { capture: true, signal: events.signal },
    );
    save.onclick = async () => {
      if (save.disabled) return;
      const version = step;
      pending = true;
      refresh();
      try {
        const pinned = !!draft?.region,
          animation = mode === "animation" && !draft.fixed;
        const { fixed, ...data } = draft || {};
        const mark = mode === "clip" && get(".clip-action").value === "skip" && clipMark;
        const savedId = await request("editor-save", {
          entry: {
            kind: fixed || mode === "reference" || mode === "family" ? "logo" : mode,
            value: input.value.trim(),
            ...data,
            ...(mode === "clip" && { clipAction: get(".clip-action").value }),
            ...(animation &&
              previousRule &&
              get(".replace input").checked && { replace: previousRule.id }),
          },
        });
        if (mark && !mark.source && mark.video.currentSrc === mark.src && mark.video.srcObject === mark.stream) {
          BurmaldaTimeline.local(mark.video, null).push({id:savedId, start:mark.start, end:mark.end});
        }
        if (disposed || version !== step) return;
        setMode(mode);
        input.value = "";
        note.textContent = animation
          ? "Анимация сохранена. Маска появится при распознавании."
          : pinned
            ? "Область закреплена. Маска действует, пока правило включено."
            : "Правило сохранено в реестре.";
        if (["logo", "reference", "family", "clip", "animation"].includes(mode))
          input.value =
            titles[mode] +
            " · " +
            location.hostname +
            " · " +
            new Date().toLocaleTimeString("ru-RU");
        refresh();
      } catch (err) {
        if (version === step) note.textContent = err.message;
      } finally {
        if (version === step) {
          pending = false;
          refresh();
        }
      }
    };
    get(".close").onclick = close;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save.click();
      }
    };
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (choosing) {
            step++;
            pending = false;
            stopPicking();
            refresh();
          } else close();
        } else if (e.composedPath().includes(host)) e.stopPropagation();
      },
      { capture: false, signal: events.signal },
    );
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") e.stopPropagation();
    });
    window.addEventListener("pagehide", close, {
      once: true,
      signal: events.signal,
    });
    (document.fullscreenElement || document.documentElement).append(host);
    host.showPopover();
    host.addEventListener(
      "beforetoggle",
      (e) => {
        if (e.newState === "closed") close();
      },
      { signal: events.signal },
    );
    setMode(
      selection
        ? "name"
        : details.media === "video"
          ? "clip"
          : details.media === "image"
            ? "logo"
            : details.link
              ? "domain"
              : "name",
    );
    input.focus({ preventScroll: true });
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m?.action === "editor-close" && sender.id === chrome.runtime.id) {
      closeEditor?.();
      reply({ closed: true });
      return;
    }
    if (m?.action !== "editor-show" || sender.id !== chrome.runtime.id) return;
    editor(m.token, m.details || {});
    reply({ opened: true });
  });
})();
