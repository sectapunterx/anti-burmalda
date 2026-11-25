"use strict";

globalThis.BurmaldaSpeech = (() => {
  const supported = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(
    location.hostname,
  );
  function intervals(json, matcher) {
    const result = [];
    for (const event of json.events || []) {
      if (
        !Array.isArray(event.segs) ||
        !Number.isFinite(event.tStartMs) ||
        !(event.dDurationMs > 0)
      )
        continue;
      const start = event.tStartMs / 1000,
        end = (event.tStartMs + event.dDurationMs) / 1000;
      let text = "";
      const pieces = event.segs.map((seg) => {
        const first = text.length;
        text += seg.utf8 || "";
        return { first, last: text.length, offset: seg.tOffsetMs };
      });
      const hits = matcher.matches(text);
      for (const m of hits) {
        const first = pieces.findIndex((p) => p.last > m.index),
          last = pieces.findIndex((p) => p.last >= m.index + m[0].length);
        if (first < 0 || last < first) continue;
        // An event duration describes the displayed caption. Only adjacent word
        // offsets can bound the sound without swallowing the rest of the line.
        const offset = pieces[first].offset ?? (first === 0 ? 0 : undefined);
        const nextOffset = pieces[last + 1]?.offset;
        const outside = text.slice(pieces[first].first, m.index) +
          text.slice(m.index + m[0].length, pieces[last].last);
        const tokenCount = m[0].trim().split(/\s+/u).length;
        const wordTimed = Number.isFinite(offset) && offset >= 0 &&
          Number.isFinite(nextOffset) && nextOffset > offset && nextOffset <= event.dDurationMs &&
          nextOffset - offset <= Math.min(3000, 1500 * tokenCount) &&
          !/[\p{L}\p{M}\p{N}]/u.test(outside);
        result.push({
          start: wordTimed ? start + offset / 1000 : start,
          end: wordTimed ? start + nextOffset / 1000 : end,
          wordTimed,
        });
      }
    }
    return result.sort((a, b) => a.start - b.start);
  }
  function transcriptEvents(json, duration) {
    const rows = [], syncEnds = new Map();
    for (const change of json.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
      const sections = change.payload?.timedMarkersListSyncEntity?.timedListData?.sections || [];
      for (const section of sections) for (const marker of section.timedSyncDataList || []) {
        if (Number(marker.endTimeMs) > Number(marker.videoTimeMs))
          syncEnds.set(Number(marker.videoTimeMs), Number(marker.endTimeMs));
      }
    }
    function visit(obj) {
      if (!obj || typeof obj !== "object") return;
      const item = obj.macroMarkersPanelItemViewModel;
      if (item) {
        const parts = item.item?.timelineItemViewModel?.contentItems || [];
        const text = parts.map(p => p.transcriptSegmentViewModel?.simpleText).filter(Boolean).join(" ");
        const start = item.onTap?.innertubeCommand?.watchEndpoint?.startTimeSeconds * 1000;
        if (text.trim() && Number.isFinite(start)) rows.push({ start, end: syncEnds.get(start), text });
        return;
      }
      const segment = obj.transcriptSegmentRenderer;
      if (segment) {
        const text = segment.snippet?.simpleText || segment.snippet?.runs?.map(r => r.text).join("");
        if (text?.trim() && segment.startMs != null)
          rows.push({ start: Number(segment.startMs), end: Number(segment.endMs), text });
        return;
      }
      Object.values(obj).forEach(visit);
    }
    visit(json.content || json.actions);
    rows.sort((a, b) => a.start - b.start);
    return rows.flatMap(({ start, end, text }, i) => {
      if (!Number.isFinite(start) || start < 0) return [];
      const next = rows[i + 1]?.start;
      // YouTube's panel seek targets are rounded to seconds. Keep adjacent lines distinct.
      const stop = Math.min(end > start ? end : next ?? start + 6000,
        next ?? Infinity, Number.isFinite(duration) && duration > 0 ? duration * 1000 : Infinity);
      return stop > start ? [{ tStartMs: start, dDurationMs: stop - start, segs: [{ utf8: text }] }] : [];
    });
  }
  function currentInterval(list, time, lead = 0) {
    let low = 0,
      high = list.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (list[mid].start <= time + lead) low = mid + 1;
      else high = mid;
    }
    const item = list[low - 1];
    return item && time < item.end ? item : null;
  }
  function attach(video, matcher, mute, audible, blocked) {
    const shell = video.closest(".html5-video-player") || video.parentElement;
    if (!shell) return null;
    const owner = new AbortController(),
      audio = new Audio(chrome.runtime.getURL("audio/burmalda.wav"));
    audio.preload = "auto";
    let trackLoaded = false,
      transcriptLoaded = false,
      wordIntervals = [],
      videoId = "",
      nextFetch = 0,
      fetcher,
      activeWord = null,
      wordEndTimer;
    let ownedButton,
      attemptedCC = false,
      fetching = false;
    const triedURLs = new Set();
    let lastTranscriptRequest, retryTranscriptAt = 0;
    function restoreCC() {
      shell.removeAttribute("data-ab-auto-cc");
      const button = ownedButton;
      ownedButton = null;
      if (button?.isConnected && button.getAttribute("aria-pressed") === "true")
        button.click();
    }
    function startPlayerCaptions() {
      const button = shell.querySelector(".ytp-subtitles-button");
      if (
        attemptedCC ||
        !button ||
        button.disabled ||
        button.getAttribute("aria-disabled") === "true" ||
        button.getAttribute("aria-pressed") !== "false" ||
        !button.getClientRects().length
      )
        return;
      attemptedCC = true;
      ownedButton = button;
      shell.setAttribute("data-ab-auto-cc", "");
      button.click();
    }
    shell.addEventListener(
      "click",
      (e) => {
        if (!e.isTrusted || !e.target.closest?.(".ytp-subtitles-button"))
          return;
        attemptedCC = true;
        if (ownedButton) {
          // First user click shows captions the extension had loaded invisibly.
          if (ownedButton.getAttribute("aria-pressed") === "true") {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          ownedButton = null;
          shell.removeAttribute("data-ab-auto-cc");
        }
      },
      { capture: true, signal: owner.signal },
    );
    function id() {
      const url = new URL(location.href);
      return (
        url.searchParams.get("v") ||
        /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] ||
        ""
      );
    }
    function stopWord() {
      if (!activeWord) return;
      activeWord = null;
      clearTimeout(wordEndTimer);
      audio.pause();
      mute(false);
    }
    function playWord(word) {
      if (word === activeWord) return;
      stopWord();
      if (!word || !audible() || !video.volume) return;
      activeWord = word;
      mute(true);
      audio.currentTime = 0;
      audio.volume = video.volume;
      const secondsLeft = (word.end - video.currentTime) / video.playbackRate;
      const rate = Number.isFinite(audio.duration) ? audio.duration / secondsLeft : 1;
      audio.playbackRate = Math.min(4, Math.max(video.playbackRate, rate));
      audio.play().catch(() => {
        if (activeWord === word) mute(false);
      });
      wordEndTimer = setTimeout(update, Math.max(1, secondsLeft * 1000));
    }
    async function load(key, signal) {
      nextFetch = performance.now() + 15000;
      const query = document.createElement("i");
      query.hidden = true;
      query.dataset.abTrackQuery = "";
      shell.append(query);
      query.dispatchEvent(new Event("ab-query-captions", { bubbles: true }));
      query.remove();
      const request = new AbortController();
      const abort = () => request.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 8000);
      try {
        await Promise.all([loadTranscript(key, query, request.signal), loadTrack(key, query, request.signal)]);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
      if (!signal.aborted && !transcriptLoaded && !trackLoaded) {
        startPlayerCaptions();
        if (!attemptedCC || ownedButton) nextFetch = performance.now() + 2500;
      }
    }
    async function loadTranscript(key, query, signal) {
      if (transcriptLoaded || query.dataset.video !== key || !query.dataset.transcript) return;
      try {
        const raw = query.dataset.transcript;
        if (raw === lastTranscriptRequest && performance.now() < retryTranscriptAt) return;
        lastTranscriptRequest = raw;
        retryTranscriptAt = performance.now() + 60000;
        const body = JSON.parse(raw);
        const path = body.panelId === "PAmodern_transcript_view" ? "get_panel" : "get_transcript";
        // The panel can select an empty manual track based on the interface locale.
        // Request its default English UI variant only if the first panel has no text.
        // This changes the panel request, not the site's locale or the video's language.
        const client = body.context.client;
        for (const hl of new Set([client.hl || "en", "en"])) {
          const response = await fetch("/youtubei/v1/" + path + "?prettyPrint=false", {
            method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, context: { ...body.context, client: { ...client, hl } } }), signal,
          });
          if (!response.ok) return;
          const events = transcriptEvents(await response.json(), video.duration);
          if (signal.aborted || id() !== key) return;
          if (!events.length) continue;
          transcriptLoaded = true;
          restoreCC();
          return;
        }
      } catch { /* The panel may be unavailable for this video. */ }
    }
    async function loadTrack(key, query, signal) {
      if (trackLoaded) return;
      const sources = [];
      for (const entry of performance.getEntriesByType("resource").reverse()) {
        if (entry.name.includes("/api/timedtext?")) sources.push(entry.name);
        if (sources.length >= 8) break;
      }
      if (query.dataset.video === key && query.dataset.track)
        sources.push(query.dataset.track);
      for (const raw of new Set(sources)) {
        let u;
        try {
          u = new URL(raw, location.href);
        } catch {
          continue;
        }
        if (
          u.protocol !== "https:" ||
          !/^(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)$/.test(
            u.hostname,
          ) ||
          u.pathname !== "/api/timedtext" ||
          u.searchParams.get("v") !== key
        )
          continue;
        if (u.searchParams.get("fmt") !== "json3")
          u.searchParams.set("fmt", "json3");
        if (triedURLs.has(u.href)) continue;
        triedURLs.add(u.href);
        try {
          const response = await fetch(u, {
            credentials: "same-origin",
            signal,
          });
          if (!response.ok) continue;
          const json = await response.json();
          if (signal.aborted || id() !== key)
            return;
          if (Array.isArray(json.events) && json.events.some(event =>
            event.dDurationMs > 0 && event.segs?.some(seg => seg.utf8?.trim()))) {
            trackLoaded = true;
            wordIntervals = u.searchParams.has("tlang") ? [] : intervals(json, matcher).filter(hit => hit.wordTimed);
            restoreCC();
            return;
          }
        } catch {
          if (signal.aborted || id() !== key) return;
        }
      }
    }
    function update() {
      const key = id();
      if (key !== videoId) {
        stopWord();
        restoreCC();
        fetcher?.abort();
        fetcher = new AbortController();
        videoId = key;
        trackLoaded = false;
        transcriptLoaded = false;
        wordIntervals = [];
        fetching = false;
        nextFetch = 0;
        attemptedCC = false;
        triedURLs.clear();
        lastTranscriptRequest = undefined;
      }
      if (key && !fetching && (!trackLoaded || !transcriptLoaded) && performance.now() >= nextFetch) {
        fetching = true;
        const signal = fetcher.signal;
        load(key, signal)
          .catch(() => {})
          .finally(() => {
            if (!signal.aborted) fetching = false;
          });
      }
      if (
        !video.isConnected ||
        video.paused ||
        video.ended ||
        video.seeking ||
        blocked() ||
        shell.classList.contains("ad-showing")
      ) {
        stopWord();
        return;
      }
      playWord(currentInterval(wordIntervals, video.currentTime));
    }
    for (const ev of [
      "pause",
      "playing",
      "timeupdate",
      "seeking",
      "ended",
      "seeked",
    ])
      video.addEventListener(ev, update, { signal: owner.signal });
    const timer = setInterval(update, 65);
    update();
    return {
      dispose() {
        owner.abort();
        fetcher?.abort();
        clearInterval(timer);
        stopWord();
        restoreCC();
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      },
    };
  }
  return { supported, attach, intervals, currentInterval };
})();
