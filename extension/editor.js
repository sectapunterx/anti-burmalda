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
      .primary{background:#92ecc0;color:#112a1b;font-weight:650}
      .preview{display:block;max-width:100%;max-height:78px;margin:6px 0 9px}
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
        <label class="replace" hidden><input type="checkbox"><span></span></label>
        <div class="status" role="status" aria-live="polite"></div>
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
      drag,
      choosing,
      disposed = false,
      step = 0,
      pending = false;
    const titles = {
      name: "Название",
      logo: "Баннер",
      reference: "Логотип",
      animation: "Анимация",
      clip: "Фрагмент",
      domain: "Домен",
    };
    const tips = {
      name: "Слово или фраза для поиска на сайтах и в субтитрах.",
      logo: "Обведите знак на вебке или всю область анимации. После сохранения маска будет постоянно закрывать это место на этой странице.",
      reference:
        "Обведите только знак. Расширение будет искать похожий рисунок в разных местах и масштабах. Порог совпадения задаётся в настройках.",
      animation:
        "Обведите один движущийся баннер со всеми его положениями. Запись остановится, когда движение повторится. Отдельную GIF-картинку можно выбрать щелчком.",
      clip: "Отметьте начало и конец во время просмотра. Такие же вставки будут пропускаться в других роликах.",
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
        (["logo", "reference", "clip", "animation"].includes(mode) && !draft);
      pick.disabled = pending;
    }
    function releaseRecording() {
      if (!recording) return;
      clearInterval(recording.timer);
      recording.events.abort();
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
      if (["logo", "reference", "clip", "animation"].includes(kind))
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
        mode === "reference" ? null : BurmaldaRegions.capture(media, rect);
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
    function begin(video) {
      if (!video || video.readyState < 2 || !video.videoWidth) {
        note.textContent = "Сначала запустите видео.";
        return;
      }
      const rec = {
        video,
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
        if (
          !video.isConnected ||
          rec.src !== video.currentSrc ||
          rec.stream !== video.srcObject ||
          video.seeking
        ) {
          abort("Видео сменилось или было перемотано. Отметьте начало заново.");
          return;
        }
        const time = video.currentTime - rec.start;
        if (time >= 60) {
          finish();
          return;
        }
        if (time < 0) {
          abort("Отметьте начало заново.");
          return;
        }
        note.textContent =
          "Запись " +
          clock(time) +
          " / 1:00 · начало " +
          clock(rec.start) +
          (video.paused ? " · пауза" : "");
        if (time - (rec.frames.at(-1)?.time ?? -1) < rec.interval) return;
        try {
          const frame = BurmaldaVision.surface(
            video,
            video.videoWidth,
            video.videoHeight,
          );
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
            rec.frames = rec.frames.filter((_, i) => i % 2 === 0);
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
        () => abort("После перемотки отметьте начало заново."),
        { signal: rec.events.signal },
      );
      video.addEventListener("ended", finish, { signal: rec.events.signal });
      sample();
    }
    function finish() {
      const rec = recording;
      if (!rec) return;
      const duration = Math.min(60, rec.video.currentTime - rec.start),
        frames = rec.frames.filter((f) => f.time < duration);
      if (duration < 1 && !rec.video.ended) {
        note.textContent = "Для образца нужна хотя бы секунда воспроизведения.";
        return;
      }
      releaseRecording();
      pick.textContent = "Записать заново";
      if (duration >= 1 && frames.length >= 2) {
        draft = { duration, frames };
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
        if (kind === "animation" || kind === "reference") startPicking(kind);
      };
      get(".tabs").append(b);
    }
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
        !["logo", "reference", "animation"].includes(choosing)
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
        await request("editor-save", {
          entry: {
            kind: fixed || mode === "reference" ? "logo" : mode,
            value: input.value.trim(),
            ...data,
            ...(animation &&
              previousRule &&
              get(".replace input").checked && { replace: previousRule.id }),
          },
        });
        if (disposed || version !== step) return;
        setMode(mode);
        input.value = "";
        note.textContent = animation
          ? "Анимация сохранена. Маска появится при распознавании."
          : pinned
            ? "Область закреплена. Маска действует, пока правило включено."
            : "Правило сохранено в реестре.";
        if (["logo", "reference", "clip", "animation"].includes(mode))
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
