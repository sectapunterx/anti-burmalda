"use strict";
const $ = (id) => document.getElementById(id);
const labels = {
  name: "Название",
  domain: "Домен",
  logo: "Логотип",
  animation: "Анимация",
  clip: "Видеовставка",
};
let state = BurmaldaRegistry.defaults(),
  revision = 0;
async function command(message) {
  const r = await chrome.runtime.sendMessage(message);
  if (!r?.value) throw Error(r?.error || "Не удалось сохранить изменение.");
}
function status(id, msg, error = false) {
  $(id).textContent = msg;
  $(id).classList.toggle("error", error);
}
function renderList() {
  const query = $("search").value.trim().toLocaleLowerCase("ru"),
    list = $("entries");
  list.replaceChildren();
  for (const e of [...state.entries].reverse()) {
    if (
      !(e.value + " " + labels[e.kind]).toLocaleLowerCase("ru").includes(query)
    )
      continue;
    const li = document.createElement("li"),
      name = document.createElement("span"),
      kind = document.createElement("small");
    name.textContent = e.value;
    kind.textContent = e.anchor ? "Баннер с промокодом" : e.region ? (e.kind === "animation" ? "Анимация" : "Область") + " · " + new URL(e.region.page).hostname : labels[e.kind];
    name.append(kind);
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Удалить правило «" + e.value + "»");
    remove.onclick = async () => {
      remove.disabled = true;
      try {
        await command({ action: "remove", id: e.id });
        status("status", "Правило удалено.");
      } catch (err) {
        remove.disabled = false;
        status("status", err.message, true);
      }
    };
    li.append(name, remove);
    list.append(li);
  }
  $("total").textContent = state.entries.length;
  $("empty").hidden = !!list.children.length;
}
function draw(next) {
  state = next;
  if($("replacementText") && document.activeElement!==$("replacementText"))
    $("replacementText").value=state.replacementText || "анти-бурмалда";
  if ($("logoThreshold")) {
    $("logoThreshold").value=state.logoThreshold??86;
    $("logo-percent").textContent=$("logoThreshold").value+"%";
  }
  $("power-label").textContent = state.enabled
    ? "Защита включена"
    : "Защита выключена";
  for (const key of ["enabled", "branded", "strictVideo", "ocr", "youtubeVoice"])
    if ($(key)) $(key).checked = key==="youtubeVoice" ? state[key]!==false : state[key];
  if ($("entries")) renderList();
  if ($("summary"))
    $("summary").textContent = "Правил в реестре · " + state.entries.length;
}
for (const key of ["enabled", "branded", "strictVideo", "ocr", "youtubeVoice"])
  if ($(key))
    $(key).onchange = async () => {
      const input = $(key);
      input.disabled = true;
      try {
        await command({ action: "setting", key, value: input.checked });
        status("status", "");
      } catch (err) {
        draw(state);
        status("status", err.message, true);
      } finally {
        input.disabled = false;
      }
    };
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && c.registry) {
    revision++;
    draw(c.registry.newValue || BurmaldaRegistry.defaults());
  }
});
const loading = revision;
chrome.storage.local.get("registry").then((r) => {
  if (loading === revision) draw(r.registry || BurmaldaRegistry.defaults());
});
if ($("open")) $("open").onclick = () => chrome.runtime.openOptionsPage();
if($("replacementText")) {
  const input=$("replacementText");
  input.onkeydown=e=>{if(e.key==="Enter")input.blur();};
  input.onchange=async()=>{
    const value=input.value.trim() || "анти-бурмалда";
    try {await command({action:"setting",key:"replacementText",value});input.value=value;}
    catch(err){input.value=state.replacementText || "анти-бурмалда";status("status",err.message,true);}
  };
}
if ($("logoThreshold")) {
  const slider=$("logoThreshold");
  slider.oninput=()=>$("logo-percent").textContent=slider.value+"%";
  slider.onchange=async()=>{
    try {await command({action:"setting",key:"logoThreshold",value:Number(slider.value)});}
    catch(err){draw(state);status("status",err.message,true);}
  };
}
if ($("edit-page")) $("edit-page").onclick = async () => {
  try {
    await command({action:"editor-open"});
    window.close();
  } catch (err) { status("status", err.message, true); }
};

function formatForm() {
  const k = $("kind").value,
    visual = k === "logo" || k === "clip";
  $("value-label").textContent = visual
    ? "Название образца"
    : k === "domain"
      ? "Домен"
      : "Название или фраза";
  $("value").placeholder = {
    name: "Как написано в рекламе",
    domain: "example.org",
    logo: "Например, логотип на стриме",
    clip: "Например, рекламная заставка",
  }[k];
  $("upload").hidden = !visual;
  $("file").required = visual;
  $("file").value = "";
  $("file").accept =
    k === "clip" ? "video/*" : "image/png,image/jpeg,image/webp,image/avif";
  $("rule-help").textContent = {
    name: "Ищем целые слова в тексте, ссылках, подписях и доступных субтитрах. Регистр букв не важен.",
    domain:
      "Блокирует загрузку ресурсов с домена и его поддоменов, скрывает ссылки на них.",
    logo: "Загрузите чёткий образец и обрежьте лишние поля. Ищем тот же рисунок на баннерах и в кадрах видео.",
    clip: "Загрузите рекламную вставку длительностью от одной секунды. Расширение сравнит образцы кадров в других роликах и трансляциях.",
  }[k];
  status("form-status", "");
}
function onMedia(v, event, action) {
  return new Promise((resolve, reject) => {
    const done = () => {
        clean();
        resolve();
      },
      fail = () => {
        clean();
        reject(
          Error("Браузер не смог прочитать видео. Проверьте формат файла."),
        );
      };
    const clean = () => {
      clearTimeout(timer);
      v.removeEventListener(event, done);
      v.removeEventListener("error", fail);
    };
    const timer = setTimeout(fail, 10000);
    v.addEventListener(event, done);
    v.addEventListener("error", fail);
    try {
      action();
    } catch {
      fail();
    }
  });
}
async function clipEntry(file) {
  const v = document.createElement("video"),
    url = URL.createObjectURL(file);
  v.muted = true;
  v.preload = "auto";
  try {
    await onMedia(v, "loadeddata", () => {
      v.src = url;
    });
    const duration = v.duration;
    if (!Number.isFinite(duration) || duration < 1)
      throw Error("Нужен видеофайл с известной длительностью от одной секунды.");
    const frames = [];
    for (const time of BurmaldaVision.sampleTimes(duration)) {
      await onMedia(v, "seeked", () => {
        v.currentTime = time;
      });
      try {
        frames.push({
          time,
          sample: BurmaldaVision.signature(
            BurmaldaVision.surface(v, v.videoWidth, v.videoHeight),
          ),
        });
      } catch {
        /* A black transition frame does not identify this ad. */
      }
    }
    if (frames.length < 2)
      throw Error("В видео слишком мало кадров с различимым рисунком.");
    return { duration, frames };
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}
if ($("add")) {
  $("kind").onchange = formatForm;
  $("search").oninput = renderList;
  formatForm();
  $("add").onsubmit = async (event) => {
    event.preventDefault();
    $("save").disabled = true;
    try {
      const kind = $("kind").value,
        entry = { kind, value: $("value").value },
        file = $("file").files[0];
      if (kind === "logo" || kind === "clip") {
        if (!file || file.size > 128 * 1024 * 1024)
          throw Error("Выберите файл до 128 МБ.");
        status("form-status", "Читаю образец…");
        if (kind === "clip") Object.assign(entry, await clipEntry(file));
        else {
          let bitmap;
          try {
            bitmap = await createImageBitmap(file);
          } catch {
            throw Error("Не удалось прочитать изображение.");
          }
          try {
            const frame=BurmaldaVision.surface(bitmap, bitmap.width, bitmap.height);
            entry.template=BurmaldaLogos.template(frame);
            if(!BurmaldaLogos.prepare(entry.template)) {
              entry.sample=BurmaldaVision.signature(frame);
              delete entry.template;
            }
          } finally {
            bitmap.close();
          }
        }
      }
      await command({ action: "add", entry });
      $("value").value = "";
      $("file").value = "";
      status("form-status", "Правило добавлено.");
      $("value").focus();
    } catch (err) {
      status("form-status", err.message, true);
    } finally {
      $("save").disabled = false;
    }
  };
}
