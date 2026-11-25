"use strict";
const assert = require("node:assert/strict");

// The editor has a closed shadow root so a site's scripts cannot read input
// or its cropped preview. Inspect as DevTools does, then use real pointer input.
async function editorControls(page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  function find(n) {
    if (n.attributes?.includes("data-ab-editor")) return n;
    for (const child of n.children || []) {
      const found = find(child);
      if (found) return found;
    }
  }
  const host = find(root);
  assert(
    host?.shadowRoots?.length,
    "editor should open in the active document",
  );
  const { object } = await cdp.send("DOM.resolveNode", {
    nodeId: host.shadowRoots[0].nodeId,
  });
  async function inspect(selector) {
    const r = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration:
        "function(s){const e=this.querySelector(s),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,text:e.textContent,value:e.value,disabled:e.disabled}}",
      arguments: [{ value: selector }],
    });
    return r.result.value;
  }
  return {
    inspect,
    async click(s) {
      const r = await inspect(s);
      await page.mouse.click(r.x, r.y);
    },
    async fill(s, value) {
      await this.click(s);
      await page.keyboard.press("Control+a");
      await page.keyboard.insertText(value);
    },
    detach: () => cdp.detach(),
  };
}
async function checkEditor(page, ui) {
  await page.bringToFront();
  await page.evaluate(async () => {
    document.querySelector("#fixture").replaceChildren();
    const name = document.querySelector("#text");
    name.textContent = "New fixture brand";
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 136;
    canvas.id = "editor-art";
    const g = canvas.getContext("2d");
    let scene = 0;
    const draw = () => {
      g.fillStyle = scene === 0 ? "#9f3319" : "#184f74";
      g.fillRect(0, 0, 240, 136);
      g.fillStyle = scene === 0 ? "#ffdb2a" : "#34f692";
      g.fillRect(scene === 0 ? 10 : 100, 14, 99, 98);
    };
    draw();
    const v = document.createElement("video");
    v.id = "editor-video";
    v.srcObject = canvas.captureStream(12);
    document.querySelector("#fixture").append(canvas, v);
    const timer = setInterval(draw, 80);
    window.secondScene = () => {
      scene = 1;
    };
    window.stopScenes = () => {
      clearInterval(timer);
      v.srcObject.getTracks().forEach((t) => t.stop());
    };
    await v.play();
    const r = new Range();
    r.selectNodeContents(name);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const opened = await ui.evaluate(() =>
    chrome.runtime.sendMessage({ action: "editor-open" }),
  );
  assert(opened.value, opened.error);
  const controls = await editorControls(page);
  const saved = (name) =>
    ui
      .getByRole("button", { name: "Удалить правило «" + name + "»" })
      .waitFor();
  try {
    assert.equal((await controls.inspect("input")).value, "New fixture brand");
    await controls.click(".primary");
    await saved("New fixture brand");
    await controls.click('[data-kind="domain"]');
    await controls.fill("input", "test-ads.example");
    await controls.click(".primary");
    await saved("test-ads.example");
    await controls.click('[data-kind="logo"]');
    await controls.fill("input", "On-page region");
    await controls.click(".pick");
    const r = await page.locator("#editor-art").boundingBox();
    await page.mouse.move(r.x + 4, r.y + 3);
    await page.mouse.down();
    await page.mouse.move(r.x + 175, r.y + 120, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert(
      !(await controls.inspect(".primary")).disabled,
      (await controls.inspect(".status")).text,
    );
    await controls.click(".primary");
    await saved("On-page region");
    await controls.click('[data-kind="reference"]');
    await page.mouse.move(r.x + 4, r.y + 3);
    await page.mouse.down();
    await page.mouse.move(r.x + 175, r.y + 120, { steps: 5 });
    await page.mouse.up();
    for (
      let i = 0;
      i < 50 && (await controls.inspect(".primary")).disabled;
      i++
    )
      await page.waitForTimeout(50);
    assert(
      !(await controls.inspect(".primary")).disabled,
      (await controls.inspect(".status")).text,
    );
    await controls.fill("input", "Portable logo");
    await controls.click(".primary");
    await saved("Portable logo");
    assert(
      await ui.evaluate(async () => {
        const rule = (
          await chrome.storage.local.get("registry")
        ).registry.entries.find((e) => e.value === "Portable logo");
        return rule.kind === "logo" && !!rule.template && !rule.region;
      }),
    );
    await controls.click('[data-kind="clip"]');
    await controls.fill("input", "Marked across videos");
    await controls.click(".pick");
    await page.waitForTimeout(1450);
    await page.evaluate(() => window.secondScene());
    await page.waitForTimeout(1250);
    await controls.click(".pick");
    assert(
      !(await controls.inspect(".primary")).disabled,
      (await controls.inspect(".status")).text,
    );
    await controls.click(".primary");
    await saved("Marked across videos");
    await controls.click(".close");
    await page.waitForFunction(
      () => !document.querySelector("[data-ab-editor]"),
    );
    await page.evaluate(async () => {
      window.stopScenes();
      const v = document.createElement("video");
      v.id = "another-video";
      v.addEventListener("seeking", () => {
        window.jumpedTo = v.currentTime;
      });
      document.querySelector("#fixture").replaceChildren(v);
      v.src = "/movie.webm";
      await v.play();
    });
    await page.waitForFunction(
      () => window.jumpedTo > 2.15,
      {},
      { timeout: 5500 },
    );
    console.log(
      "PASS in-tab selection, banner crop, domain, clip marks and automatic seek on a different video",
    );
  } finally {
    await controls.detach();
  }
  for (const value of [
    "New fixture brand",
    "test-ads.example",
    "On-page region",
    "Portable logo",
    "Marked across videos",
  ])
    await ui
      .getByRole("button", { name: "Удалить правило «" + value + "»" })
      .click();
}

async function checkYoutube(ctx, movie) {
  const page = await ctx.newPage(),
    cdp = await ctx.newCDPSession(page),
    mediaEvents = [];
  await cdp.send("Media.enable");
  cdp.on("Media.playerEventsAdded", (e) => mediaEvents.push(e));
  const timed = {
    events: [
      {
        tStartMs: 100,
        dDurationMs: 2600,
        segs: [
          { utf8: "Сегодня ", tOffsetMs: 0 },
          { utf8: "Winline", tOffsetMs: 900 },
          { utf8: " в эфире", tOffsetMs: 1650 },
        ],
      },
    ],
  };
  let fetched = false;
  const panelLocales = [];
  await page.route("https://www.youtube.com/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/movie.webm")
      return route.fulfill({ contentType: "video/webm", body: movie });
    if (u.pathname === "/api/timedtext") {
      fetched = true;
      return route.fulfill({ json: timed });
    }
    if (u.pathname === "/youtubei/v1/get_panel") {
      const body = route.request().postDataJSON();
      assert.equal(body.panelId, "PAmodern_transcript_view");
      assert.equal(body.params, "transcript-fixture");
      panelLocales.push(body.context.client.hl);
      const item = (sec, simpleText) => ({ macroMarkersPanelItemViewModel: {
        onTap: { innertubeCommand: { watchEndpoint: { startTimeSeconds: sec } } },
        item: { timelineItemViewModel: { contentItems: [{ transcriptSegmentViewModel: { simpleText } }] } },
      } });
      const items = body.context.client.hl === "ru" ? [item(0, " ")] : [
        item(0, "Матч начался"), item(1, "С нами Winline"), item(2, "До встречи"),
      ];
      return route.fulfill({ json: { content: { items } } });
    }
    if (u.pathname !== "/watch") return route.abort();
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body:
        '<div class="html5-video-player" style="position:relative"><video src="/movie.webm"></video></div>' +
        '<script>document.querySelector("div").getPlayerResponse=()=>({videoDetails:{videoId:"fixture12345"},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{kind:"asr",languageCode:"ru",baseUrl:"https://www.youtube.com/api/timedtext?v=fixture12345"}]}}})</script>',
    });
  });
  try {
    await page.goto("https://www.youtube.com/watch?v=fixture12345");
    await page.bringToFront();
    await page.locator("video").evaluate((v) => v.play());
    await page.waitForFunction(
      () =>
        document.querySelector("video").muted &&
        !document.querySelector("[data-ab-spoken], [data-ab-speaking]"),
    );
    assert(fetched);
    const at = await page
      .locator("video")
      .evaluate((v) => [v.currentTime, v.style.filter]);
    assert(at[0] > 0.7 && at[0] < 1.8);
    assert.equal(at[1], "");
    await page.waitForFunction(
      () =>
        document.querySelector("video").currentTime > 1.78 &&
        !document.querySelector("video").muted,
    );
    await page.waitForTimeout(500);
    const wav = mediaEvents.find((e) =>
      e.events.some((ev) => ev.value.includes("burmalda.wav")),
    );
    assert(wav, "packaged voice should load in Chrome's media pipeline");
    const voicePlays = () => mediaEvents.filter(e => e.playerId === wav.playerId)
      .flatMap(e => e.events).filter(ev => JSON.parse(ev.value).event === "kPlay").length;
    const precisePlays = voicePlays();
    assert(precisePlays > 0, "the timed word should play the replacement");
    await page.evaluate(async () => {
      const v = document.querySelector("video");
      v.pause();
      history.replaceState({}, "", "/watch?v=untimed1234");
      const track = v.addTextTrack("subtitles", "Русский", "ru");
      track.mode = "hidden";
      track.addCue(new VTTCue(0.45, 1.65, "Матч Winline начался"));
      v.currentTime = 0.15;
      await v.play();
    });
    await page.waitForFunction(
      () =>
        !document.querySelector("video").muted &&
        document.querySelector("video").textTracks[0].activeCues?.length > 0 &&
        !document.querySelector("[data-ab-spoken]"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("video").currentTime > 1.7 &&
        !document.querySelector("video").muted,
    );
    await page.evaluate(async () => {
      const video = document.querySelector("video"),
        player = video.parentElement;
      video.pause();
      for (const track of video.textTracks)
        for (const cue of [...track.cues]) track.removeCue(cue);
      history.replaceState({}, "", "/watch?v=domcaption1");
      const button = document.createElement("button");
      button.className = "ytp-subtitles-button";
      button.setAttribute("aria-pressed", "false");
      button.textContent = "CC";
      player.append(button);
      button.onclick = () => {
        const on = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(on));
        if (on) {
          const captions = document.createElement("div");
          captions.className = "ytp-caption-window-container";
          const line = document.createElement("span");
          line.className = "ytp-caption-segment";
          line.textContent = "Снова Winline";
          captions.append(line);
          player.append(captions);
        }
      };
      video.currentTime = 0.1;
      await video.play();
    });
    await page.waitForFunction(
      () =>
        document.querySelector("[data-ab-auto-cc]") &&
        !document.querySelector("video").muted &&
        !document.querySelector("[data-ab-spoken]") &&
        getComputedStyle(document.querySelector(".ytp-caption-window-container")).opacity === "0",
    );
    await page.locator(".ytp-subtitles-button").click();
    assert.equal(await page.locator(".ytp-caption-window-container").evaluate(el => getComputedStyle(el).opacity), "1");
    assert.equal(await page.locator(".ytp-caption-segment").textContent(), "Снова Winline");
    await page.locator(".ytp-subtitles-button").click();
    await page
      .locator(".ytp-caption-segment")
      .evaluate((el) => (el.textContent = "Спасибо"));
    await page.waitForFunction(() => !document.querySelector("video").muted);
    await page.evaluate(async () => {
      const video = document.querySelector("video"), player = video.parentElement;
      video.pause();
      history.replaceState({}, "", "/watch?v=panel_only1");
      // The watch page can have a transcript before it mounts its description button.
      const watch = document.createElement("ytd-watch-flexy");
      watch.data = {
        currentVideoEndpoint: { watchEndpoint: { videoId: "panel_only1" } },
        engagementPanels: [{ videoDescriptionTranscriptSectionRenderer: { primaryButton: {
          buttonRenderer: { command: { commandExecutorCommand: { commands: [{
            updateEngagementPanelContentCommand: { contentSourcePanelIdentifier: { tag: "PAmodern_transcript_view" },
              globalConfiguration: { params: "transcript-fixture" } },
          }] } } },
        } } }],
      };
      document.body.append(watch);
      window.ytcfg = { get: () => ({ client: { clientName: "WEB", clientVersion: "fixture", hl: "ru" } }) };
      player.getPlayerResponse = () => ({ videoDetails: { videoId: "panel_only1" } });
      const row = document.createElement("transcript-segment-view-model");
      row.innerHTML = '<span role="text">С нами Winline</span>';
      watch.append(row);
      video.currentTime = 0.2;
      await video.play();
    });
    await page.waitForFunction(() => !document.querySelector("video").muted &&
      !document.querySelector("[data-ab-spoken]") && document.querySelector("video").currentTime >= 1 &&
      document.querySelector("transcript-segment-view-model").textContent === "С нами бурмалда");
    assert.deepEqual(panelLocales, ["ru", "en"]);
    assert.equal(await page.locator(".ytp-subtitles-button").getAttribute("aria-pressed"), "false");
    await page.waitForFunction(() => document.querySelector("video").currentTime > 2 &&
      !document.querySelector("video").muted);
    assert.equal(voicePlays(), precisePlays, "line-only transcripts and captions must preserve the original audio");
    await page.evaluate(async () => {
      const video = document.querySelector("video"), player = video.parentElement;
      video.pause();
      history.replaceState({}, "", "/watch?v=panel_words");
      document.querySelector("ytd-watch-flexy").data.currentVideoEndpoint.watchEndpoint.videoId = "panel_words";
      player.getPlayerResponse = () => ({ videoDetails: { videoId: "panel_words" },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
          languageCode: "ru", baseUrl: "/api/timedtext?v=panel_words",
        }] } } });
      video.currentTime = 0.2;
      await video.play();
    });
    await page.waitForFunction(() => document.querySelector("video").muted &&
      !document.querySelector("[data-ab-spoken], [data-ab-speaking]"));
    // The panel assigns the whole second 1..2, but the word ends at 1.75.
    await page.waitForFunction(() => {
      const video = document.querySelector("video");
      return video.currentTime > 1.76 && video.currentTime < 1.99 && !video.muted;
    });
    console.log(
      "PASS YouTube without extension subtitles, native CC control, transcript redaction, timed word audio and restoration",
    );
  } finally {
    await cdp.detach();
    await page.close();
  }
}
async function checkPinnedRegions(page, ui, cssPixel) {
  const uri = "https://www.twitch.tv/fixture_channel";
  const branded = await ui.locator("#branded").isChecked();
  // The following probes check the exact black rectangle, including pixels
  // now occupied by the lettering when the wordmark is turned on.
  if (branded) await ui.locator("#branded").uncheck();
  // Two alternating frames, red and green, with a 200 ms delay.
  const gif = Buffer.from(
    "47494638396101000100800000ec33182ad48621ff0b4e45545343415045322e300301000000" +
      "21f90400140000002c0000000001000100000202440100" +
      "21f90400140000002c00000000010001000002024c01003b",
    "hex",
  );
  await page.route(uri + "/slot.gif", (route) =>
    route.fulfill({ contentType: "image/gif", body: gif }),
  );
  await page.route(uri, (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<div data-a-target="video-player" style="position:relative;width:320px;height:180px"><video style="width:100%;height:100%;object-fit:contain"></video><div style="position:absolute;inset:0"></div></div>' +
        '<img id="slot" width="80" height="50" src="/fixture_channel/slot.gif">' +
        '<script>const c=document.createElement("canvas");c.width=320;c.height=180;const g=c.getContext("2d");function frame(){g.fillStyle="teal";g.fillRect(0,0,320,180);g.fillStyle=performance.now()%400<200?"orange":"purple";g.fillRect(24,50,62,28)}frame();setInterval(frame,65);const v=document.querySelector("video");v.srcObject=c.captureStream(15);v.play()</script>',
    }),
  );
  try {
    await page.goto(uri);
    await page.bringToFront();
    await page.waitForFunction(
      () => document.querySelector("video").readyState >= 2,
    );
    const opened = await ui.evaluate(() =>
      chrome.runtime.sendMessage({ action: "editor-open" }),
    );
    assert(opened.value, opened.error);
    const controls = await editorControls(page);
    try {
      await controls.click('[data-kind="logo"]');
      async function mark(name, target, left, top, right, bottom) {
        await controls.fill("input", name);
        await controls.click(".pick");
        const b = await page.locator(target).boundingBox();
        await page.mouse.move(b.x + left, b.y + top);
        await page.mouse.down();
        await page.mouse.move(b.x + right, b.y + bottom, { steps: 5 });
        await page.mouse.up();
        for (
          let i = 0;
          i < 50 && (await controls.inspect(".primary")).disabled;
          i++
        )
          await page.waitForTimeout(50);
        await controls.click(".primary");
        await page.waitForFunction(
          (sel) => document.querySelector(sel).style.filter.includes("url("),
          target,
        );
      }
      await mark("Webcam sign", "video", 24, 50, 86, 78);
      await mark("GIF slot", "#slot", 0.5, 0.5, 79.5, 49.5);
      await controls.click(".close");
    } finally {
      await controls.detach();
    }
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(await cssPixel("video", 29, 55), [0, 0, 0]);
      assert.deepEqual(await cssPixel("#slot", 7, 7), [0, 0, 0]);
      await page.waitForTimeout(125);
    }
    await page.reload();
    await page.waitForFunction(
      () =>
        document.querySelector("video").readyState >= 2 &&
        document.querySelector("#slot").style.filter,
    );
    assert.deepEqual(await cssPixel("video", 29, 55), [0, 0, 0]);
    assert.notDeepEqual(await cssPixel("video", 150, 105), [0, 0, 0]);
    await page
      .locator("video")
      .evaluate((v) => (v.parentElement.style.height = "300px"));
    await page.waitForTimeout(550);
    assert.deepEqual(await cssPixel("video", 29, 115), [0, 0, 0]);
    assert.notDeepEqual(await cssPixel("video", 150, 165), [0, 0, 0]);
    assert.equal(await page.locator("video").evaluate((v) => v.muted), false);
    await page.evaluate(() => history.pushState({}, "", "/anotherchannel"));
    await page.waitForFunction(
      () =>
        !document.querySelector("video").style.filter &&
        !document.querySelector("#slot").style.filter,
    );
    await page.evaluate(() => history.back());
    await page.waitForFunction(
      () =>
        document.querySelector("video").style.filter &&
        document.querySelector("#slot").style.filter,
    );
    for (const name of ["Webcam sign", "GIF slot"])
      await ui
        .getByRole("button", { name: "Удалить правило «" + name + "»" })
        .click();
    await page.waitForFunction(
      () =>
        !document.querySelector("video").style.filter &&
        !document.querySelector("#slot").style.filter,
    );
    console.log(
      "PASS persistent in-player and GIF region masks, immediate pixels, animation, reload, letterboxing, channel navigation and deletion",
    );
    // Reuse this player for a conditional animation over game footage. The
    // mask must go away when the artwork is removed and return on recurrence.
    await page.locator("video").evaluate(async (v) => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 180;
      const g = c.getContext("2d");
      window.showAnimation = true;
      function draw() {
        g.fillStyle = "#176151";
        g.fillRect(0, 0, 320, 180);
        if (!window.showAnimation) return;
        g.fillStyle = ["#ed481c", "#4337d9", "#ecce23", "#854cef"][
          Math.floor(performance.now() / 480) % 4
        ];
        g.fillRect(24, 50, 62, 28);
      }
      draw();
      setInterval(draw, 65);
      v.srcObject = c.captureStream(15);
      v.parentElement.style.height = "180px";
      await v.play();
    });
    await page.bringToFront();
    await ui.evaluate(() =>
      chrome.runtime.sendMessage({ action: "editor-open" }),
    );
    const animated = await editorControls(page);
    try {
      await animated.click('[data-kind="animation"]');
      const b = await page.locator("video").boundingBox();
      await page.mouse.move(b.x + 24, b.y + 50);
      await page.mouse.down();
      await page.mouse.move(b.x + 86, b.y + 78, { steps: 5 });
      await page.mouse.up();
      for (
        let i = 0;
        i < 65 && (await animated.inspect(".primary")).disabled;
        i++
      )
        await page.waitForTimeout(180);
      assert.match((await animated.inspect(".status")).text, /подтверждён/);
      await animated.fill("input", "Cycle over gameplay");
      await animated.click(".primary");
      await page.waitForFunction(
        () => document.querySelector("video").style.filter,
      );
      assert.deepEqual(await cssPixel("video", 29, 55), [0, 0, 0]);
      await page.evaluate(() => {
        window.showAnimation = false;
      });
      await page.waitForFunction(
        () => !document.querySelector("video").style.filter,
      );
      assert.notDeepEqual(await cssPixel("video", 29, 55), [0, 0, 0]);
      await page.evaluate(() => {
        window.showAnimation = true;
      });
      await page.waitForFunction(
        () => document.querySelector("video").style.filter,
      );
      await animated.click('[data-kind="animation"]');
      await page.locator("#slot").click({ force: true });
      await animated.fill("input", "Animated image resource");
      await animated.click(".primary");
      await page.waitForFunction(
        () => document.querySelector("#slot").style.filter,
      );
      await page.locator("#slot").evaluate((img) => img.removeAttribute("src"));
      await page.waitForFunction(
        () => !document.querySelector("#slot").style.filter,
      );
      await animated.click(".close");
    } finally {
      await animated.detach();
    }
    for (const name of ["Cycle over gameplay", "Animated image resource"])
      await ui
        .getByRole("button", { name: "Удалить правило «" + name + "»" })
        .click();
    console.log(
      "PASS animation cycle authoring, mask release, reappearance and animated image resource",
    );
  } finally {
    await page.unroute(uri);
    await page.unroute(uri + "/slot.gif");
    if (branded) await ui.locator("#branded").check();
  }
}
module.exports = { checkEditor, checkYoutube, checkPinnedRegions };
