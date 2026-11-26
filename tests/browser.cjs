"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const {checkEditor,checkLongClip,checkPromoBanner,checkYoutube,checkPinnedRegions} = require("./authoring.cjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const extension = path.resolve(__dirname, "../extension");

async function main() {
  let movie = Buffer.alloc(0);
  const longMovie = require("node:fs").readFileSync(path.join(__dirname,"fixtures/seekable-102s.webm"));
  let artwork;
  const server = http.createServer((req, res) => {
    if (req.url === "/art.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(artwork);
    }
    if (req.url === "/movie.webm" || req.url === "/long.webm") {
      const file = req.url === "/long.webm" ? longMovie : movie;
      const range = /bytes=(\d+)-/.exec(req.headers.range || "");
      const start = range ? Number(range[1]) : 0;
      res.writeHead(range ? 206 : 200, {
        "Content-Type": "video/webm",
        "Accept-Ranges": "bytes",
        ...(range
          ? {
              "Content-Range":
                "bytes " +
                start +
                "-" +
                (file.length - 1) +
                "/" +
                file.length,
            }
          : {}),
        "Content-Length": file.length - start,
      });
      return res.end(file.subarray(start));
    }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(
      '<body style="background:white"><p id="text">Новости спорта</p><a href="https://promo.fon.bet/sports" style="display:inline-block;background:red;width:160px;height:50px">Предложение</a><div id="fixture"></div></body>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const mediaServer = http.createServer(server.listeners("request")[0]);
  await new Promise((resolve) => mediaServer.listen(0, "127.0.0.1", resolve));
  const mediaRoot = "http://127.0.0.1:" + mediaServer.address().port;
  const root = "http://127.0.0.1:" + server.address().port;
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext("", {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--enable-unsafe-extension-debugging",
        "--autoplay-policy=no-user-gesture-required",
        "--load-extension=" + extension,
      ],
    });
    const page = await ctx.newPage(),
      cdp = await ctx.browser().newBrowserCDPSession();
    let worker =
      ctx.serviceWorkers()[0] ||
      (await ctx
        .waitForEvent("serviceworker", { timeout: 1800 })
        .catch(() => null));
    if (!worker) {
      try {
        await cdp.send("Extensions.loadUnpacked", { path: extension });
      } catch (e) {
        console.log("Checking command-line extension load:", e.message);
      }
      worker =
        ctx.serviceWorkers()[0] ||
        (await ctx.waitForEvent("serviceworker", { timeout: 10000 }));
    }
    const base = new URL(worker.url()).origin.replace(
      "null",
      "chrome-extension://" + new URL(worker.url()).host,
    );
    const ui = await ctx.newPage();
    ui.setDefaultTimeout(8000);
    page.setDefaultTimeout(10000);
    const errors = [];
    ctx.on("weberror", (e) => errors.push(e.error().message));
    await ui.goto(base + "/options.html");
    const slider=ui.locator("#logoThreshold");
    await slider.focus();await slider.press("End");
    await ui.waitForFunction(()=>document.querySelector("#logo-percent").textContent==="97%");
    for(let i=0;i<40 && await ui.evaluate(async()=>(await chrome.storage.local.get("registry")).registry.logoThreshold!==97);i++)
      await ui.waitForTimeout(50);
    await ui.reload();
    await ui.waitForFunction(()=>document.querySelector("#logoThreshold").value==="97");
    await slider.evaluate(el=>{el.value="86";el.dispatchEvent(new Event("change"));});
    const addName = async (str) => {
      await ui.locator("#kind").selectOption("name");
      await ui.locator("#value").fill(str);
      await ui.locator("#save").click();
      await ui
        .getByRole("button", { name: "Удалить правило «" + str + "»" })
        .waitFor();
    };
    await page.goto(root);
    await page.bringToFront();
    await page.waitForFunction(() =>
      document.querySelector("a").style.filter.includes("url("),
    );
    const cssPixel = async (el, x = 3, y = 3) => {
      const png = await page.locator(el).screenshot();
      return page.evaluate(
        async ({ data, x, y }) => {
          const img = await createImageBitmap(
            await (await fetch("data:image/png;base64," + data)).blob(),
          );
          const c = new OffscreenCanvas(img.width, img.height),
            g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          // These checks distinguish masked black from the fixture's bright artwork.
          // Brave can perturb a canvas readback by one RGB level.
          return [...g.getImageData(x, y, 1, 1).data].slice(0, 3)
            .map(channel => channel <= 1 ? 0 : channel);
        },
        { data: png.toString("base64"), x, y },
      );
    };
    assert.deepEqual(await cssPixel("a"), [0, 0, 0]);
    assert(await page.locator("feImage").first().evaluate(e=>e.getAttribute("href").includes("/wordmark")));
    const repoUrl = "https://github.com/sectapunterx/anti-burmalda";
    await ctx.route(repoUrl, route => route.fulfill({contentType: "text/plain", body: "Repository"}));
    const [repo] = await Promise.all([
      ctx.waitForEvent("page", {timeout: 5000}),
      page.locator("a").first().click(),
    ]);
    await repo.waitForURL(repoUrl);
    await repo.close();
    await page.bringToFront();
    const dnr = await ui.evaluate(() =>
      chrome.declarativeNetRequest.getDynamicRules(),
    );
    assert(dnr[0].condition.requestDomains.includes("fon.bet"));
    for (const host of ["1win.com", "upgrader.pro", "musor.win", "winline.ru", "betboom.ru"]) {
      assert(dnr[0].condition.requestDomains.includes(host), host);
    }
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.id = "catalog-ad";
      link.textContent = "Кейсы на Мусор Дроп";
      link.href = "/offer";
      document.body.append(link);
    });
    await page.waitForFunction(() => document.querySelector("#catalog-ad").textContent==="Кейсы на анти-бурмалда");
    // Use the reserved .test TLD so a failure cannot contact a real advertiser.
    await ui.locator("#kind").selectOption("domain");
    await ui.locator("#value").fill("ads.invalid.test");
    await ui.locator("#save").click();
    await ui
      .getByRole("button", { name: "Удалить правило «ads.invalid.test»" })
      .waitFor();
    const blocked = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url().includes("promo.ads.invalid.test"),
    });
    await page.evaluate(() => {
      const i = new Image();
      i.src = "http://promo.ads.invalid.test/banner.png";
    });
    assert.match((await blocked).failure().errorText, /BLOCKED_BY_CLIENT/);
    await addName("Marker Qube");
    await page.evaluate(() => {
      const text = document.querySelector("#text");
      text.textContent = "Матч Marker Qube сегодня";
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 110;
      const g = canvas.getContext("2d");
      g.fillStyle = "white";
      g.fillRect(0, 0, 480, 110);
      g.fillStyle = "black";
      g.font = "bold 52px Arial";
      g.fillText("Marker Qube", 18, 75);
      const img = new Image();
      img.id = "ocr";
      img.src = canvas.toDataURL();
      document.querySelector("#fixture").append(img);
    });
    await page.bringToFront();
    await page.waitForFunction(
      () => document.querySelector("#ocr").style.filter.includes("url("),
      {},
      { timeout: 25000 },
    );
    assert.deepEqual(await cssPixel("#ocr"), [0, 0, 0]);
    assert.equal(await page.locator("#text").textContent(),"Матч анти-бурмалда сегодня");
    await ui.locator("#replacementText").fill("Скрытая реклама");
    await ui.locator("#replacementText").press("Enter");
    await page.waitForFunction(()=>document.querySelector("#text").textContent==="Матч Скрытая реклама сегодня");
    await ui.locator("#enabled").uncheck();
    await page.waitForFunction(()=>document.querySelector("#text").textContent==="Матч Marker Qube сегодня");
    await ui.locator("#enabled").check();
    await page.waitForFunction(()=>document.querySelector("#text").textContent==="Матч Скрытая реклама сегодня");
    await ui.locator("#replacementText").fill("");await ui.locator("#replacementText").press("Enter");
    await page.waitForFunction(()=>document.querySelector("#text").textContent==="Матч анти-бурмалда сегодня");
    console.log(
      "PASS registry UI, network rules, rendered mask and offline OCR",
    );
    await ui.locator("#ocr").uncheck();
    await checkStreamAds(page, cssPixel);
    await ui.locator("#kind").selectOption("logo");
    await ui.locator("#value").fill("Тестовый знак");
    const logo = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 32;
      const g = c.getContext("2d");
      g.fillStyle = "navy";
      g.fillRect(0, 0, 64, 32);
      g.fillStyle = "yellow";
      g.fillRect(0, 0, 32, 16);
      g.fillStyle = "coral";
      g.fillRect(32, 16, 32, 16);
      return c.toDataURL().split(",")[1];
    });
    await ui
      .locator("#file")
      .setInputFiles({
        name: "sample.png",
        mimeType: "image/png",
        buffer: Buffer.from(logo, "base64"),
      });
    await ui.locator("#save").click();
    await ui
      .getByRole("button", { name: "Удалить правило «Тестовый знак»" })
      .waitFor();
    await page.bringToFront();
    await page.evaluate(async (logo) => {
      const img = new Image();
      img.src = "data:image/png;base64," + logo;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 144;
      const g = c.getContext("2d");
      const draw = () => {
        g.fillStyle = "teal";
        g.fillRect(0, 0, 256, 144);
        g.drawImage(img, 176, 96, 64, 32);
      };
      draw();
      const v = document.createElement("video");
      v.id = "stream";
      v.srcObject = c.captureStream(10);
      v.playsInline = true;
      document.querySelector("#fixture").append(v);
      window.redraw = setInterval(draw, 80);
      await v.play();
    }, logo);
    await page.waitForFunction(() =>
      document.querySelector("#stream").style.filter.includes("url("),
    );
    assert.equal(await page.locator("#stream").evaluate((v) => v.muted), false);
    assert.notDeepEqual(await cssPixel("#stream"), [0, 0, 0]);
    assert.deepEqual(await cssPixel("#stream", 180, 101), [0, 0, 0]);
    console.log(
      "PASS uploaded logo in the corner of a live MediaStream, surrounding video and audio retained",
    );
    const encoded = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 136;
      const g = c.getContext("2d"),
        stream = c.captureStream(12);
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8",
      });
      const parts = [];
      recorder.ondataavailable = (e) => parts.push(e.data);
      const stop = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      const start = performance.now();
      while (performance.now() - start < 3200) {
        const first = performance.now() - start < 1500;
        g.fillStyle = first ? "#9f3319" : "#184f74";
        g.fillRect(0, 0, 240, 136);
        g.fillStyle = first ? "#ffdb2a" : "#34f692";
        g.fillRect(first ? 10 : 100, 14, 99, 98);
        await new Promise((r) => setTimeout(r, 70));
      }
      recorder.stop();
      await stop;
      stream.getTracks().forEach((t) => t.stop());
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.readAsDataURL(new Blob(parts));
      });
    });
    movie = Buffer.from(encoded, "base64");
    // MediaRecorder's streaming WebM has no Duration element. Fill the
    // proper finite duration for the file-import test using the browser muxer fixture below.
    movie = withDuration(movie, 3200);
    await checkEditor(page, ui);
    await checkLongClip(page, ui);
    await checkPromoBanner(page, ui);
    await checkCompactCycle(page,root);
    await checkSponsorRotation(page,root);
    await checkPrizeAndGameplay(page);
    await ui.locator("#kind").selectOption("clip");
    await ui.locator("#value").fill("Long upload");
    await ui.locator("#file").setInputFiles({name:"long.webm",mimeType:"video/webm",buffer:longMovie});
    await ui.locator("#save").click();
    await ui.getByRole("button",{name:"Удалить правило «Long upload»"}).click();
    await checkYoutube(ctx, movie);
    await ui.locator("#kind").selectOption("clip");
    await ui.locator("#value").fill("Вставка");
    await ui
      .locator("#file")
      .setInputFiles({
        name: "ad.webm",
        mimeType: "video/webm",
        buffer: movie,
      });
    await ui.locator("#save").click();
    await ui
      .getByRole("button", { name: "Удалить правило «Вставка»" })
      .waitFor();
    await page.goto(root);
    await page.evaluate(() => {
      document.querySelector("#fixture").replaceChildren();
      const v = document.createElement("video");
      v.id = "repeat";
      v.loop = true;
      v.src = "/movie.webm";
      document.querySelector("#fixture").append(v);
      v.play();
    });
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector("#repeat").muted);
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 136;
      const g = c.getContext("2d");
      const v = document.createElement("video");
      v.id = "program";
      v.srcObject = c.captureStream(12);
      document.querySelector("#fixture").replaceChildren(v);
      window.scene = "program";
      window.drawProgram = setInterval(() => {
        const first = window.scene === "one",
          ad = first || window.scene === "two";
        g.fillStyle = ad ? (first ? "#9f3319" : "#184f74") : "#ccc";
        g.fillRect(0, 0, 240, 136);
        if (ad) {
          g.fillStyle = first ? "#ffdb2a" : "#34f692";
          g.fillRect(first ? 10 : 100, 14, 99, 98);
        }
      }, 75);
      await v.play();
    });
    assert.equal(
      await page.locator("#program").evaluate((v) => v.muted),
      false,
    );
    await page.evaluate(() => {
      window.scene = "one";
    });
    await page.waitForFunction(() => document.querySelector("#program").muted);
    await page.evaluate(() => {
      window.scene = "two";
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.scene = "program";
    });
    await page.waitForFunction(
      () =>
        !document.querySelector("#program").muted &&
        !document.querySelector("#program").style.filter,
    );
    await page.evaluate(() => {
      window.scene = "one";
    });
    await page.waitForFunction(() => document.querySelector("#program").muted);
    await ui.locator("#enabled").uncheck();
    await page.waitForFunction(
      () =>
        !document.querySelector("#program").muted &&
        !document.querySelector("#program").style.filter &&
        !document.querySelector("a").style.filter,
    );
    assert.equal(
      (await ui.evaluate(() => chrome.declarativeNetRequest.getDynamicRules()))
        .length,
      0,
    );
    await ui.reload();
    assert.equal(await ui.locator("#enabled").isChecked(), false);
    await ui.getByRole("button", { name: "Удалить правило «Вставка»" }).click();
    await ui
      .getByRole("button", { name: "Удалить правило «Вставка»" })
      .waitFor({ state: "detached" });
    await ui.locator("#enabled").check();
    await ui.locator("#strictVideo").check();
    artwork = Buffer.from(logo, "base64");
    await page.evaluate(async (mediaRoot) => {
      clearInterval(window.drawProgram);
      const v = document.createElement("video");
      v.id = "restricted"; v.loop = true; v.src = mediaRoot + "/movie.webm";
      const img = new Image();
      img.id = "external"; img.src = mediaRoot + "/art.png";
      document.querySelector("#fixture").replaceChildren(v, img);
      await v.play();
    }, mediaRoot);
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector("#restricted").muted && document.querySelector("#external").style.filter);
    await ui.locator("#strictVideo").uncheck();
    await page.waitForFunction(() => !document.querySelector("#restricted").muted && !document.querySelector("#restricted").style.filter);
    console.log("PASS public cross-origin image matching and strict mode on an unreadable video");
    await checkPinnedRegions(page, ui, cssPixel);
    assert.deepEqual(errors, []);
    const popup = await ctx.newPage();
    await popup.goto(base + "/popup.html");
    assert.equal(await popup.locator("#enabled").isChecked(), true);
    await popup.locator("#open").click();
    console.log(
      "PASS imported video reference, matching in a separate video, mute restoration, persisted toggle and delete",
    );
  } finally {
    try {
      await ctx?.close();
    } finally {
      server.close();
      mediaServer.close();
    }
  }
}

async function checkStreamAds(page, cssPixel) {
  const readFixture = name => require("node:fs").readFileSync(
    path.join(__dirname, "fixtures", name + ".webp"), "base64");
  await page.bringToFront();
  await page.evaluate(async ({overlays, panel}) => {
    const box = document.createElement("section");
    box.id = "stream-ad-check";
    box.innerHTML = '<a id="ordinary" href="https://www.twitch.tv/fixture_channel" aria-label="Fixture channel streaming Матч !WINLINE"><img id="thumb" alt="Матч !WINLINE"><span id="stream-title">Матч !WINLINE</span></a> <a id="sponsor" href="https://www.twitch.tv/betboom_fixture">Канал</a> <a id="campaign-link" href="https://10k.win/b/fixture_channel">Баннер</a><br>';
    document.body.prepend(box);
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 90; thumbnail.height = 45;
    const g = thumbnail.getContext("2d");
    g.fillStyle = "teal"; g.fillRect(0,0,90,45);
    box.querySelector("#thumb").src = thumbnail.toDataURL();
    const poster = new Image(95,165);
    poster.id = "copied-poster"; poster.alt = "Panel Content";
    poster.src = "data:image/webp;base64," + panel;
    box.append(poster);
    const image = new Image();
    image.src = "data:image/webp;base64," + overlays; await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext("2d");
    const video = document.createElement("video");
    video.id = "in-game"; video.width = 640; video.height = 360;
    box.append(video);
    const stream = canvas.captureStream(10);
    video.srcObject = stream;
    let show = true;
    const draw = () => {
      ctx.fillStyle = "#247352"; ctx.fillRect(0,0,960,540);
      if (show) ctx.drawImage(image, 720,70,225,246);
    };
    draw();
    const timer = setInterval(draw, 90);
    window.hideArtwork = () => { show = false; };
    window.stopArtwork = () => {
      clearInterval(timer); stream.getTracks().forEach(t => t.stop()); box.remove();
    };
    await video.play();
  }, {overlays:readFixture("winline-overlays"), panel:readFixture("winline-panel")});
  await page.waitForFunction(() => {
    const video = document.querySelector("#in-game");
    const id = video.style.filter.match(/#([^"]+)/)?.[1];
    return document.getElementById(id)?.querySelectorAll("feFlood").length >= 2 &&
      document.querySelector("#copied-poster").style.filter &&
      document.querySelector("#campaign-link").style.filter;
  });
  assert.deepEqual(await page.locator("#ordinary, #thumb").evaluateAll(items=>items.map(i=>i.style.filter)), ["",""]);
  assert.equal(await page.locator("#sponsor").evaluate(a=>a.style.filter),"");
  assert.equal(await page.locator("#in-game").evaluate(v=>v.muted),false);
  assert.deepEqual(await cssPixel("#in-game", 550, 89), [0,0,0]);
  assert.deepEqual(await cssPixel("#in-game", 537, 157), [0,0,0]);
  assert.notDeepEqual(await cssPixel("#in-game", 200, 160), [0,0,0]);
  assert.deepEqual(await cssPixel("#copied-poster"), [0,0,0]);
  assert.equal(await page.locator("#stream-title").textContent(),"Матч анти-бурмалда");
  assert.equal(await page.locator("#ordinary").getAttribute("aria-label"),"Fixture channel streaming Матч анти-бурмалда");
  await page.evaluate(()=>window.hideArtwork());
  await page.waitForFunction(()=>!document.querySelector("#in-game").style.filter);
  await page.evaluate(()=>window.stopArtwork());
  console.log("PASS neutral and branded channel cards, command-only text redaction, panel and two separate in-stream masks");
}

async function checkCompactCycle(page,root) {
  await page.goto(root+"/compact-phase");
  await page.bringToFront();
  const sheet=require("node:fs").readFileSync(path.join(__dirname,"fixtures/bb-promo-cycle.webp"));
  await page.evaluate(async data=>{
    const img=new Image();
    img.src="data:image/webp;base64,"+data;
    await img.decode();
    const canvas=document.createElement("canvas");
    canvas.width=960;canvas.height=540;
    const ctx=canvas.getContext("2d");
    const video=document.createElement("video");
    document.querySelector("#fixture").replaceChildren(video);
    video.width=640;
    const draw=()=>{
      ctx.fillStyle="#283b42";ctx.fillRect(0,0,960,540);
      if(window.phase>=0)ctx.drawImage(img,145*window.phase,0,145,70,66,200,145,70);
    };
    window.phase=3; // square emblem, before any wide phase has been shown
    draw();setInterval(draw,70);
    video.srcObject=canvas.captureStream(15);
    await video.play();
    window.covered=()=>{
      const id=video.style.filter.match(/#([^"]+)/)?.[1];
      return !video.muted && [...(document.getElementById(id)?.querySelectorAll("feFlood")||[])].some(node=>{
        const [x,y,w,h]=["x","y","width","height"].map(k=>+node.getAttribute(k));
        return x*960<=85 && (x+w)*960>=184 && y*540<=222 && (y+h)*540>=246 && w<.22;
      });
    };
  },sheet.toString("base64"));
  await page.waitForFunction(()=>window.covered(),null,{timeout:8000});
  const uncovered=await page.evaluate(async()=>{
    const missed=[];
    for(let stage=0;stage<12;stage++){
      window.phase=stage;
      for(let i=0;i<6;i++){
        await new Promise(r=>setTimeout(r,110));
        if(!window.covered()) missed.push(stage);
      }
    }
    window.phase=-1;
    return missed;
  });
  assert.deepEqual(uncovered,[]);
  await page.waitForFunction(()=>!document.querySelector("video").style.filter,null,{timeout:6500});
  console.log("PASS compact BB emblem cold start, full-width mask throughout 12 recorded phases and release after exit");
}
async function checkSponsorRotation(page,root) {
  await page.goto(root+"/sponsor-rotation");
  const strip=require("node:fs").readFileSync(path.join(__dirname,"fixtures/rotating-sponsors.webp"));
  await page.evaluate(async data=>{
    const img=new Image();
    img.src="data:image/webp;base64,"+data;
    await img.decode();
    const canvas=document.createElement("canvas");
    canvas.width=960;canvas.height=540;
    const ctx=canvas.getContext("2d");
    const video=document.createElement("video");
    document.querySelector("#fixture").replaceChildren(video);
    video.width=640;
    window.sponsor=0;
    const draw=()=>{
      ctx.fillStyle="#3c4449";ctx.fillRect(0,0,960,540);
      ctx.drawImage(img,186*window.sponsor,0,186,48,120,180,140,36);
    };
    draw();setInterval(draw,70);
    video.srcObject=canvas.captureStream(15);
    await video.play();
    window.sponsorMasked=()=>{
      const id=video.style.filter.match(/#([^"]+)/)?.[1];
      return [...(document.getElementById(id)?.querySelectorAll("feFlood")||[])].some(node=>{
        const [x,y,w,h]=["x","y","width","height"].map(k=>+node.getAttribute(k));
        return x*960<=145 && (x+w)*960>=215 && y*540<=192 && (y+h)*540>=205;
      });
    };
  },strip.toString("base64"));
  await page.waitForFunction(()=>window.sponsorMasked(),null,{timeout:16000});
  await page.evaluate(()=>{window.sponsor=1;});
  await page.waitForFunction(()=>!document.querySelector("video").style.filter,null,{timeout:2500});
  assert.equal(await page.evaluate(async()=>{
    for(let i=0;i<36;i++) {
      await new Promise(resolve=>setTimeout(resolve,150));
      if(document.querySelector("video").style.filter) return false;
    }
    return true;
  }),true,"GGsel must remain visible through further template scans");
  await page.evaluate(()=>{window.sponsor=2;});
  await page.waitForFunction(()=>window.sponsorMasked(),null,{timeout:16000});
  console.log("PASS rotating slate hides BetBoom, releases GGsel in the same slot and reacquires BB");
}
async function checkPrizeAndGameplay(page) {
  const url="https://www.twitch.tv/test_prize_overlay";
  await page.route(url,r=>r.fulfill({contentType:"text/html",body:"<video width=768></video>"}));
  await page.goto(url);
  const art=require("node:fs").readFileSync(path.join(__dirname,"fixtures/prize-and-gameplay.webp"));
  await page.evaluate(async encoded=>{
    const img=new Image();
    img.src="data:image/webp;base64,"+encoded;
    await img.decode();
    const canvas=document.createElement("canvas");
    canvas.width=768;canvas.height=432;
    const ctx=canvas.getContext("2d"),v=document.querySelector("video");
    ctx.imageSmoothingEnabled=false;
    window.card=0;
    function draw() {
      ctx.fillStyle="#27333e";ctx.fillRect(0,0,768,432);
      const sample=Math.floor(performance.now()/510)%4;
      ctx.drawImage(img,sample*128,60,16,12,665,120,102,65);
      if(window.card>=0)ctx.drawImage(img,window.card*128,0,128,60,40,20,128,60);
    }
    draw();setInterval(draw,65);
    v.srcObject=canvas.captureStream(15);await v.play();
    window.hasMaskAt=(x,y)=>{
      const id=v.style.filter.match(/#([^"]+)/)?.[1];
      return [...(document.getElementById(id)?.querySelectorAll("feFlood")||[])].some(n=>{
        const [l,t,w,h]=["x","y","width","height"].map(k=>+n.getAttribute(k));
        return l<=x/768 && l+w>=x/768 && t<=y/432 && t+h>=y/432;
      });
    };
  },art.toString("base64"));
  for(const card of [0,1,2,3]) {
    await page.evaluate(k=>{window.card=k;},card);
    await page.waitForFunction(()=>window.hasMaskAt(106,50),null,{timeout:4500});
    await page.waitForTimeout(950);
    assert.deepEqual(await page.evaluate(()=>[window.hasMaskAt(106,50),window.hasMaskAt(716,152)]),[true,false]);
  }
  await page.evaluate(()=>{window.card=-1;});
  await page.waitForFunction(()=>!document.querySelector("video").style.filter,null,{timeout:5000});
  await page.unroute(url);
  console.log("PASS prize cards covered outside their recorded slot, dark gameplay clear, mask released");
}
function withDuration(bytes, ms) {
  const id = Buffer.from([0x15, 0x49, 0xa9, 0x66]),
    start = bytes.indexOf(id) + id.length;
  assert(start >= id.length, "Expected WebM SegmentInfo");
  let marker = 128,
    length = 1;
  while (!(bytes[start] & marker) && length < 8) {
    marker >>= 1;
    length++;
  }
  let size = bytes[start] & (marker - 1);
  for (let i = 1; i < length; i++) size = size * 256 + bytes[start + i];
  assert(size > 0 && size < 65536, "Unexpected WebM SegmentInfo size " + size);
  const end = start + length + size;
  const duration = Buffer.alloc(11);
  duration.set([0x44, 0x89, 0x88]);
  duration.writeDoubleBE(ms, 3);
  const header = Buffer.alloc(length);
  let total = size + duration.length;
  for (let i = length - 1; i >= 0; i--) {
    header[i] = total % 256;
    total = Math.floor(total / 256);
  }
  header[0] |= marker;
  return Buffer.concat([
    bytes.subarray(0, start),
    header,
    bytes.subarray(start + length, end),
    duration,
    bytes.subarray(end),
  ]);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
