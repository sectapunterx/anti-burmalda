"use strict";

const BurmaldaRecording = new WeakSet();
(() => {
  const reg = BurmaldaRegistry,
    vision = BurmaldaVision;
  const ns = "http://www.w3.org/2000/svg";
  const ignored =
    "script,style,noscript,template,textarea,input,select,[contenteditable]:not([contenteditable=false]),[data-ab-filter-root],[data-ab-editor],[data-ab-timeline]";
  const mediaSelector =
    "img,video,iframe,a,[aria-label],[title],[style*='url(' i],[role=img]";
  const backgroundSelector =
    "div[class],aside[class],figure[class],ins[class],a[class],span[class],section[class],button[class],[role=img]";
  const cues =
    ".ytp-caption-segment, [data-a-target='player-captions-container'], .vjs-text-track-display, .jw-text-track-display";
  let state,
    matcher,
    scanWinline = false,
    logos = [],
    templates = [],
    fastPanels = [],
    regionRules = [],
    animations = [],
    clips = [],
    rememberedSkips = [],
    generation = 0;
  let roots = new Set(),
    sweep = [],
    queued = new Set(),
    flushTimer,
    mediaTimer,
    cleaning = false;
  const marked = new Map(),
    texts = new Map(),
    attributes = new Map(),
    plainAdLinks = new WeakSet(),
    videos = new Map(),
    pictures = new Map(),
    visible = new Set();
  const highlight = new Highlight();
  let automaticBoxes = new WeakMap();
  const pinned = new Map();
  const planes = new Map();
  const uid = "ab-" + crypto.getRandomValues(new Uint32Array(2)).join("-");
  let count = 0;
  const changeObserver = new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.target.closest?.("[data-ab-timeline]")) continue;
      if (
        c.target.parentElement?.closest("[data-ab-filter-root]") ||
        c.target.closest?.("[data-ab-filter-root]")
      )
        continue;
      if (c.type === "attributes") {
        // Ignore our own filter writes while observing page-authored background changes.
        if (
          c.attributeName === "style" &&
          c.oldValue?.replace(/filter:[^;]+;?/gi, "").trim() ===
            c.target.style.cssText.replace(/filter:[^;]+;?/gi, "").trim()
        )
          continue;
        enqueue(c.target);
        if (c.target.matches("video") && c.attributeName === "src")
          resetVideo(c.target);
      } else if (c.type === "characterData") {
        enqueue(c.target);
        enqueueLink(c.target.parentElement);
      } else {
        enqueueLink(c.target);
        for (const node of c.addedNodes) enqueue(node);
        if (c.removedNodes.length) cleaning = true;
      }
    }
    schedule();
  });
  const viewport = new IntersectionObserver((events) => {
    for (const e of events) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }
  });
  function enqueueLink(el) {
    const a = el?.closest?.("a");
    if (a) inspectElement(a);
  }
  function enqueue(node) {
    if (node.nodeType === 1 || node.nodeType === 3 || node.nodeType === 11)
      queued.add(node);
  }
  function schedule() {
    if (!flushTimer) flushTimer = setTimeout(flush, 20);
  }
  function watch(root) {
    if (roots.has(root)) return;
    roots.add(root);
    changeObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "src",
        "srcset",
        "href",
        "alt",
        "aria-label",
        "title",
        "style",
        "poster",
        "class",
        "contenteditable",
      ],
    });
    if (root.host) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        "::highlight(anti-burmalda-mentions){background-color:#baf3d0;color:#123b27;text-shadow:none;text-decoration:underline}",
      );
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      rootSheets.set(root, sheet);
      enqueue(root);
    }
  }

  function svg(tag, attrs = {}) {
    const el = document.createElementNS(ns, tag);
    for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
    return el;
  }
  function plane(root) {
    if (planes.has(root)) return planes.get(root);
    const el = svg("svg", {
      width: 0,
      height: 0,
      "aria-hidden": "true",
      "data-ab-filter-root": "",
    });
    el.style.cssText =
      "position:absolute!important;width:0!important;height:0!important;pointer-events:none!important";
    (root.host ? root : document.documentElement).append(el);
    planes.set(root, el);
    return el;
  }
  function mask(el, box) {
    const automatic = Array.isArray(box) ? box : box ? [box] : [];
    if (automatic.length) automaticBoxes.set(el, automatic);
    else automaticBoxes.delete(el);
    renderMask(el);
  }
  function renderMask(el) {
    const boxes = [...(automaticBoxes.get(el) || [])];
    if (el.isConnected && !BurmaldaRecording.has(el) && !boxes.includes(vision.full)) {
      for (const region of pinned.get(el) || []) {
        const b = BurmaldaRegions.box(el, region);
        if (b) boxes.push(b);
      }
    }
    if (!boxes.length) {
      removeMask(el);
      return;
    }
    const key = boxes.map(b => [b.x,b.y,b.w,b.h].join("/")).join(";") + state.branded +
      (state.branded ? el.clientWidth+"/"+el.clientHeight : "") + location.href.split("#")[0];
    let m = marked.get(el);
    if (m?.key === key && el.style.filter === m.ours && m.filter.isConnected)
      return;
    if (m) removeMask(el);
    const id = uid + "-" + ++count;
    const f = svg("filter", {
      id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      filterUnits: "objectBoundingBox",
      primitiveUnits: "objectBoundingBox",
      colorInterpolationFilters: "sRGB",
    });
    const merge = svg("feMerge");
    const badges = [];
    merge.append(svg("feMergeNode", { in: "SourceGraphic" }));
    for (const [index, box] of boxes.entries()) {
      // Extend each region slightly to cover anti-aliased boundaries.
      const x = Math.max(0, box.x - 0.008),
        y = Math.max(0, box.y - 0.012);
      const width = Math.min(1 - x, box.w + 0.016),
        height = Math.min(1 - y, box.h + 0.024);
      f.append(
        svg("feFlood", {
          x,
          y,
          width,
          height,
          "flood-color": "black",
          result: "cover" + index,
        }),
      );
      merge.append(svg("feMergeNode", { in: "cover" + index }));
      if (state.branded) {
        const boxWidth=width*(el.clientWidth||1),boxHeight=height*(el.clientHeight||1);
        const wide=boxWidth/boxHeight>=2.7;
        const assetWidth = wide ? 248 : 128, assetHeight = wide ? 62 : 100;
        const scale = Math.min(1, boxWidth * .92 / assetWidth, boxHeight * .92 / assetHeight);
        const badgeWidth = width * assetWidth * scale / boxWidth;
        const badgeHeight = height * assetHeight * scale / boxHeight;
        const badge = { x: x + (width-badgeWidth)/2, y: y + (height-badgeHeight)/2,
          width: badgeWidth, height: badgeHeight };
        badges.push(badge);
        f.append(
          svg("feImage", {
            href: chrome.runtime.getURL(wide ? "icons/wordmark.svg" : "icons/wordmark-compact.svg"),
            ...badge,
            preserveAspectRatio: "xMidYMid meet",
            result: "badge" + index,
          }),
        );
        merge.append(svg("feMergeNode", { in: "badge" + index }));
      }
    }
    f.append(merge);
    plane(el.getRootNode()).append(f);
    m = {
      key,
      filter: f,
      badges,
      original: el.style.getPropertyValue("filter"),
      priority: el.style.getPropertyPriority("filter"),
    };
    // Resolve against the document, including on pages with a foreign <base>.
    el.style.setProperty(
      "filter",
      'url("' +
        location.href.split("#")[0].replace(/["\\]/g, "\\$&") +
        "#" +
        id +
        '")',
      "important",
    );
    m.ours = el.style.filter;
    marked.set(el, m);
  }
  function removeMask(el) {
    const m = marked.get(el);
    if (!m) return;
    if (el.style.filter === m.ours) {
      if (m.original) el.style.setProperty("filter", m.original, m.priority);
      else el.style.removeProperty("filter");
    }
    m.filter.remove();
    marked.delete(el);
  }
  function refreshPins() {
    if (!regionRules.length && !animations.length && !pinned.size) return;
    const previous = new Set(pinned.keys());
    pinned.clear();
    const page = BurmaldaRegions.pageKey();
    function include(el, region) {
      if (!el) return;
      if (!pinned.has(el)) pinned.set(el, []);
      pinned.get(el).push(region);
      previous.add(el);
    }
    for (const region of regionRules) {
      if (region.page === page) include(BurmaldaRegions.resolve(region), region);
    }
    for (const rule of animations) {
      const region = rule.region;
      if (rule.asset) {
        for (const [img,info] of pictures)
          if (img.localName === "img" && info.src === region.src) include(img,region);
        continue;
      }
      const candidates = region.intrinsic && region.tag === "video"
        ? [...videos.keys()].filter(el => visible.has(el))
        : region.page === page ? [BurmaldaRegions.resolve(region)] : [];
      for (const el of candidates) {
        if (el && animationVisible(el,rule)) include(el,region);
      }
    }
    for (const el of previous) renderMask(el);
  }
  let animationContext;
  function animationVisible(el,rule) {
    const video = el.localName === "video";
    if (video && (el.readyState < 2 || el.seeking)) {rule.tracks.delete(el);return false;}
    if (BurmaldaRecording.has(el)) return false;
    const time = video ? el.currentTime : performance.now()/1000;
    let track = rule.tracks.get(el);
    if (!track || track.source !== el.currentSrc || track.stream !== el.srcObject ||
        time < track.last || time-track.last>3) {
      track = {source:el.currentSrc,stream:el.srcObject};
      rule.tracks.set(el,track);
    }
    if (track.unreadable || time === track.last) return !!track.active;
    track.last=time;
    try {
      animationContext ??= BurmaldaAnimation.canvas();
      const rgb=BurmaldaAnimation.read(animationContext,el,rule.region);
      return rgb && BurmaldaAnimation.match(rgb,rule.cycle,track,time);
    } catch(e) {
      // A tainted canvas cannot be reused for the next player.
      animationContext=null;track.active=false;track.unreadable=e.name==="SecurityError";return false;
    }
  }
  function substitute(source, label = state.replacementText || "анти-бурмалда") {
    const hits=matcher.matches(source);
    if(!hits.length)return null;
    const spans=[];
    let rendered="",pos=0;
    for(const hit of hits) {
      const start=source[hit.index-1]==="!" ? hit.index-1 : hit.index;
      rendered+=source.slice(pos,start);
      spans.push([rendered.length,rendered.length+label.length]);
      rendered+=label;pos=hit.index+hit[0].length;
    }
    return {source,rendered:rendered+source.slice(pos),spans};
  }
  function restoreText(node,record) {
    for(const range of record.ranges)highlight.delete(range);
    if(node.data===record.rendered && node.data!==record.source)node.data=record.source;
    texts.delete(node);
  }
  function textNode(node) {
    const old=texts.get(node),el=node.parentElement;
    if(!el || !node.isConnected || el.closest(ignored+",head") ||
       (BurmaldaSpeech.supported && state.youtubeVoice!==false && el.closest(cues))) {
      if(old)restoreText(node,old);
      return;
    }
    if(old && node.data===old.rendered)return;
    let source=node.data;
    if(old) {
      if(source.startsWith(old.rendered))source=old.source+source.slice(old.rendered.length);
      restoreText(node,old);
    }
    const transcript = BurmaldaSpeech.supported && state.youtubeVoice!==false &&
      el.closest("transcript-segment-view-model [role=text], ytd-transcript-segment-renderer .segment-text");
    const record=substitute(source, transcript ? "бурмалда" : undefined);
    if(!record)return;
    // Keep the site's text node and its event handlers intact across updates.
    if(node.data!==record.rendered)node.data=record.rendered;
    record.ranges=record.spans.map(([s,e])=>{
      const r=new Range();r.setStart(node,s);r.setEnd(node,e);highlight.add(r);return r;
    });
    texts.set(node,record);
  }
  function sourceText(el) {
    const value=el.textContent;
    if(!value.includes(state.replacementText || "анти-бурмалда") && !value.includes("бурмалда"))return value.slice(0,4096);
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    let text="",node;
    while(text.length<4096 && (node=walker.nextNode())) {
      const old=texts.get(node);
      text+=old && old.rendered===node.data ? old.source : node.data;
    }
    return text.slice(0,4096);
  }
  function sourceAttribute(el,key) {
    const value=el.getAttribute(key),old=attributes.get(el)?.get(key);
    return old && value===old.rendered ? old.source : value;
  }
  function updateAttributes(el) {
    let table=attributes.get(el);
    for(const key of ["title","aria-label","alt"]) {
      const value=el.getAttribute(key);
      if(table?.get(key)?.rendered===value)continue;
      const record=value && substitute(value);
      if(record) {
        if(!table){table=new Map();attributes.set(el,table);}
        table.set(key,record);
        if(value!==record.rendered)el.setAttribute(key,record.rendered);
      } else table?.delete(key);
    }
    if(table && !table.size)attributes.delete(el);
  }
  function restoreAttributes(el,table) {
    for(const [key,old] of table)
      if(el.getAttribute(key)===old.rendered)el.setAttribute(key,old.source);
    attributes.delete(el);
  }
  function channelOf(el) {
    const a = el.closest("a[href]");
    if (!a || !a.href) return null;
    try {
      const u = new URL(a.href, document.baseURI);
      if (!/^(?:www\.|m\.)?twitch\.tv$/i.test(u.hostname)) return null;
      return /^\/([a-z\d_]+)(?:\/(?:about|schedule|videos|clips))?\/?$/i.exec(u.pathname)?.[1] || null;
    } catch { return null; }
  }
  function adMention(value) {
    return matcher.matches(value).some(hit => value[hit.index-1] !== "!");
  }
  function adAddress(value) {
    return matcher.address(value, document.baseURI) ||
      (scanWinline && BurmaldaCampaign.knownAddress(value, document.baseURI));
  }
  function labelled(el) {
    if (["src","poster"].some(a => adAddress(el.getAttribute(a))) || adAddress(el.currentSrc)) return true;
    return (
      ["alt", "aria-label", "title"].some(
        (a) => adMention(sourceAttribute(el,a)),
      ) ||
      adAddress(el.getAttribute("href")) ||
      (el.localName === "a" && adMention(sourceText(el)))
    );
  }
  function backgroundUrl(el) {
    const bg =
      el.style?.backgroundImage ||
      (el.matches(backgroundSelector)
        ? getComputedStyle(el).backgroundImage
        : "");
    return /^url\(["']?(.*?)["']?\)$/i.exec(bg)?.[1] || "";
  }
  function track(el, table) {
    if (!table.has(el)) {
      table.set(el, {});
      viewport.observe(el);
    }
    return table.get(el);
  }
  function previewMedia(el) {
    return !!channelOf(el) || !!el.closest("ytd-thumbnail,yt-thumbnail-view-model,[data-a-target='preview-card-image-link']") ||
      (el.localName === "img" && /^https:\/\/(?:[^/]+\.)?(?:ttvnw\.net\/previews-ttv\/live_user-|ytimg\.com\/vi(?:_webp)?\/)/i.test(el.currentSrc || el.src));
  }
  function inspectElement(el) {
    if (!el.style || el.closest(ignored)) return;
    if(attributes.has(el) || el.hasAttribute("title") || el.hasAttribute("aria-label") || el.hasAttribute("alt"))updateAttributes(el);
    if (el.shadowRoot) watch(el.shadowRoot);
    if (
      !el.matches(mediaSelector) &&
      !el.matches(backgroundSelector) &&
      !marked.has(el) &&
      !pictures.has(el)
    )
      return;
    // Metadata on large layout containers can describe a whole site. Limit
    // those signals to media, links and small explicitly labelled widgets.
    const tag = el.localName;
    const bg = backgroundUrl(el);
    const relevant =
      el.matches("a,img,video,iframe,[role=img]") ||
      !!bg ||
      (el.childElementCount < 3 &&
        !el.matches("html,body,main,article,section"));
    const preview = relevant && previewMedia(el);
    let label = relevant && !preview && (labelled(el) || adAddress(bg));
    plainAdLinks.delete(el);
    if(label && !bg && !el.matches("img,video,iframe,[role=img]") &&
       !el.querySelector("img,video,svg,canvas,iframe") && matcher.matches(sourceText(el)).length) {
      if(el.localName==="a" && adAddress(el.href))plainAdLinks.add(el);
      label=false;
    }
    if (label && !el.matches("img,video,iframe") && [...el.querySelectorAll("img,video")].some(previewMedia)) label = false;
    if (tag === "video") {
      const info = track(el, videos);
      info.label = label;
      if (!info.speech && BurmaldaSpeech.supported && state.youtubeVoice!==false) {
        info.speech=BurmaldaSpeech.attach(el,matcher,
          on=>{info.voiceMute=on;applyMute(el,info);},
          ()=>!el.muted || !!info.mutedByUs,
          ()=>info.label || info.maskMute || BurmaldaRecording.has(el));
      }
      if (label) videoMask(el, info, vision.full, true);
      return;
    }
    if (tag === "img" || bg || pictures.has(el)) {
      const info = track(el, pictures),
        src = tag === "img" ? el.currentSrc || el.src : bg;
      if (info.src !== src) {
        info.src = src;
        info.done = false;
        info.visual = false;
        info.templateBoxes = [];
        info.templateCursor = 0;
        info.logoCursor = 0;
        info.pendingFrame = null;
        info.ocrBox = null;
        info.ocrDone = false;
        info.artwork = null;
      }
      info.label = label;
      info.preview = preview;
      paintPicture(el, info);
    } else mask(el, label ? vision.full : null);
  }
  function inspect(node) {
    if (node.nodeType === 3) textNode(node);
    else if (node.nodeType === 1) inspectElement(node);
  }
  function clean() {
    for (const [el] of marked) if (!el.isConnected) mask(el, null);
    for (const [node] of texts) if (!node.isConnected) textNode(node);
    for (const [el,table] of attributes) if (!el.isConnected) restoreAttributes(el,table);
    for (const table of [videos, pictures])
      for (const [el, info] of table)
        if (!el.isConnected) {
          if (table === videos) { info.timeline?.remove(); info.speech?.dispose(); restoreMute(el, info); }
          viewport.unobserve(el);
          visible.delete(el);
          table.delete(el);
        }
    for (const [root, p] of planes)
      if (root.host && !root.host.isConnected) {
        p.remove();
        planes.delete(root);
      }
    for (const root of roots)
      if (root.host && !root.host.isConnected) roots.delete(root);
  }
  function flush() {
    flushTimer = null;
    if (!state?.enabled) return;
    if (cleaning) {
      clean();
      cleaning = false;
    }
    const until = performance.now() + 9;
    while (performance.now() < until && (sweep.length || queued.size)) {
      if (!sweep.length) {
        const root = queued.values().next().value;
        queued.delete(root);
        if (!root.isConnected || root.parentElement?.closest(ignored)) continue;
        inspect(root);
        if (root.nodeType !== 3)
          sweep.push(
            document.createTreeWalker(
              root,
              NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
              {
                acceptNode: (n) =>
                  n.nodeType === 1 && n.matches(ignored)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
              },
            ),
          );
      }
      const walker = sweep[0];
      if (walker) {
        const next = walker.nextNode();
        if (next) {
          queued.delete(next);
          inspect(next);
        } else sweep.shift();
      }
    }
    if (sweep.length || queued.size) schedule();
  }

  function restoreMute(v, info) {
    if (info.mutedByUs) {
      v.muted = false;
      info.mutedByUs = false;
    }
  }
  function videoMask(v, info, box, mute) {
    mask(v, box);
    info.maskMute=mute;
    applyMute(v,info);
  }
  function applyMute(v,info) {
    const mute=info.maskMute || info.voiceMute;
    if (mute && !v.muted) {
      v.muted = true;
      info.mutedByUs = true;
    }
    if (!mute) restoreMute(v, info);
  }
  function resetVideo(v) {
    for (const rule of animations) rule.tracks?.delete(v);
    const info = videos.get(v);
    if (info) {
      info.tracks = new Map();
      info.last = undefined;
      info.templateTime=undefined;
      info.templateCursor=0;
      info.templateBoxes=[];
      info.unreadable = false;
      info.hit = null;
      info.clipBoxes = [];
      info.logoCursor = 0;
      info.moreLogos = false;
      info.ocrBox = null;
      info.ocrTime = undefined;
      info.artwork = null;
      info.artworkTime = undefined;
      info.recentArtwork = [];
      info.epoch = (info.epoch || 0) + 1;
    }
  }
  function captions(v) {
    for (const t of v.textTracks)
      if (t.activeCues) {
        for (const c of t.activeCues)
          if (matcher.matches(c.text).length) return true;
      }
    const shell =
      v.closest(
        ".html5-video-player,.video-js,.jwplayer,[data-a-target='video-player']",
      ) || v.parentElement;
    return (
      shell &&
      [...shell.querySelectorAll(cues)].some(
        (c) =>
          c.getClientRects().length && matcher.matches(sourceText(c)).length,
      )
    );
  }
  function mappedBox(v, b, fallback = vision.full) {
    if (b === vision.full) return b;
    const w = v.clientWidth,
      h = v.clientHeight,
      vw = v.videoWidth || v.naturalWidth,
      vh = v.videoHeight || v.naturalHeight;
    const css = getComputedStyle(v);
    if (!w || !h || !vw || !vh)
      return fallback;
    if (css.objectFit === "fill") return b;
    const position=/^(-?[\d.]+)%\s+(-?[\d.]+)%$/.exec(css.objectPosition);
    if (!position) return fallback;
    let scale =
      css.objectFit === "cover"
        ? Math.max(w / vw, h / vh)
        : Math.min(w / vw, h / vh);
    if (css.objectFit === "none") scale = 1;
    if (css.objectFit === "scale-down") scale = Math.min(1, scale);
    const rw = (vw * scale) / w,
      rh = (vh * scale) / h;
    return {
      x: (1 - rw) * Number(position[1])/100 + b.x * rw,
      y: (1 - rh) * Number(position[2])/100 + b.y * rh,
      w: b.w * rw,
      h: b.h * rh,
    };
  }
  // Bound work per tick even when the registry contains hundreds of samples.
  // A successful sample stays first in line on the next video frame.
  function findLogo(frame, info, el) {
    const deadline = performance.now() + 12;
    for (let i = info.logoCursor || 0; i < logos.length; i++) {
      if (logos[i].region && pinned.get(el)?.includes(logos[i].region)) continue;
      const box = vision.locate(frame, logos[i].sample, state.logoThreshold??86);
      if (box) {
        info.logoCursor = i;
        info.moreLogos = false;
        return box;
      }
      if (performance.now() >= deadline && i + 1 < logos.length) {
        info.logoCursor = i + 1;
        info.moreLogos = true;
        return null;
      }
    }
    info.logoCursor = 0;
    info.moreLogos = false;
    return null;
  }
  function scanTemplates(video,info,time) {
    const frame=vision.surface(video,video.videoWidth,video.videoHeight,768);
    const threshold=state.logoThreshold??86;
    // Confirm previously seen signs cheaply while rotating the full-screen
    // search through every registered template, including on paused players.
    const remaining=[];
    for(const old of info.templateBoxes || []) {
      const current=old.rule.pattern.panelPhases ? null : BurmaldaLogos.refine(frame,old.rule.pattern,{...old,score:0});
      const cutoff=Math.max(threshold,old.rule.minScore);
      const display=current && (current.score>=cutoff || old.rule.pattern.layouts?.length) &&
        BurmaldaLogos.displayBox(frame,current,old.rule,cutoff);
      if(display) remaining.push({...current,display,seen:time,supported:time});
      else if(old.probe && BurmaldaLogos.confirmPanel(frame,old.rule.pattern.panelPhases,old.probe,cutoff))
        remaining.push({...old,supported:time});
      else if(old.rule.pattern.panelColour==="yellow" && time>=old.seen && time-old.seen<28 &&
          BurmaldaLogos.panelStillVisible(frame,old)) remaining.push({...old,supported:time});
      else if(time>=old.seen && time-old.seen<18 && old.palette &&
          BurmaldaLogos.sameColours(old.palette,BurmaldaLogos.colours(frame,BurmaldaLogos.bannerBox(old,old.rule.anchor))))
        remaining.push({...old,supported:time});
      else if(!old.rule.rotating && time>=old.seen && time-(old.supported ?? old.seen)<(old.rule.pattern.panelPhases ? 2.8 : 1.4))
        remaining.push(old);
    }
    let pyramid;
    function scan(candidate) {
      const levels=candidate.pattern.panelPhases ? [frame] : (pyramid ??= BurmaldaLogos.pyramid(frame));
      const cutoff=Math.max(threshold,candidate.minScore);
      for(const hit of BurmaldaLogos.locate(levels,candidate.pattern,cutoff)) {
        const display=BurmaldaLogos.displayBox(frame,hit,candidate,cutoff);
        if(!display) continue;
        const known=remaining.findIndex(b=>b.rule===candidate && BurmaldaLogos.overlap(b,hit)>.52);
        const item={...hit,display,rule:candidate,seen:time};
        if(candidate.anchor && !candidate.rotating) item.palette=BurmaldaLogos.colours(frame,BurmaldaLogos.bannerBox(hit,candidate.anchor));
        if(known<0) remaining.push(item);
        else remaining[known]=item;
      }
    }
    for(const panel of fastPanels) scan(panel);
    const deadline=performance.now()+20;
    let checked=0, index=info.templateCursor || 0;
    do {
      const candidate=templates[index];
      if(!candidate.pattern.panelPhases) scan(candidate);
      index=(index+1)%templates.length;
      checked++;
    } while(checked<Math.min(3,templates.length) && performance.now()<deadline);
    info.templateBoxes=remaining;
    info.templateCursor=index;
    info.pausedScans=(info.templateTime===time ? info.pausedScans : 0)+checked;
    info.templateTime=time;
  }
  function checkVideo(v, info) {
    if (info.src !== v.currentSrc || info.stream !== v.srcObject) {
      resetVideo(v);
      info.src = v.currentSrc;
      info.stream = v.srcObject;
    }
    const recording = clips.length ? vision.clipSource(v) : null;
    let ranges = [];
    if (clips.length) {
      const timeline = info.timeline ??= new BurmaldaTimeline(v);
      if (!timeline.matches(recording)) timeline.reset(recording);
      ranges = clips.filter(r => r.clipAction !== "mask" && r.origin && r.origin.source === recording)
        .map(r => ({id:r.id, start:r.origin.start, end:r.origin.start+r.duration}));
      if (recording) ranges.push(...rememberedSkips.filter(r => r.source === recording && skipIds.has(r.id)));
      ranges.push(...timeline.found.filter(local => skipIds.has(local.id) && !ranges.some(r => r.id === local.id && Math.abs(r.start-local.start)<1)));
      timeline.draw(ranges);
    }
    if (BurmaldaRecording.has(v)) { videoMask(v, info, null, false); return; }
    for (const range of ranges) {
      if (v.currentTime >= range.start && v.currentTime < range.end && skipConfirmedClip(v, range.end)) return;
    }
    const cover = info.label || (!BurmaldaSpeech.supported && captions(v));
    if ((cover && !clips.length) || (state.strictVideo && v.mediaKeys)) {
      videoMask(v, info, vision.full, true);
      return;
    }
    if (v.readyState < 2) {
      videoMask(v, info, cover ? vision.full : null, !!cover);
      return;
    }
    if (v.seeking) {
      resetVideo(v);
      videoMask(v, info, cover ? vision.full : null, !!cover);
      return;
    }
    const now = v.currentTime;
    if (scanWinline && !info.unreadable &&
        (info.artworkTime === undefined || now < info.artworkTime || now-info.artworkTime >= .7)) {
      try {
        const detected = BurmaldaCampaign.detect(vision.surface(v, v.videoWidth, v.videoHeight, 576));
        // Keep a briefly invisible animated overlay covered between phases.
        // Expire each position independently if it vanishes from the scene.
        const recent = (info.recentArtwork || []).filter(({box,time}) =>
          now >= time && now-time < 4 && !detected.some(b =>
            Math.abs(b.x+b.w/2-box.x-box.w/2) < Math.min(b.w,box.w)*.5 &&
            Math.abs(b.y+b.h/2-box.y-box.h/2) < Math.min(b.h,box.h)*.5));
        info.recentArtwork = [...recent, ...detected.map(box => ({box,time:now}))];
        info.artwork = info.recentArtwork.map(item => item.box);
        info.artworkTime = now;
      } catch (e) {
        if (e.name === "SecurityError") info.unreadable = true;
      }
    }
    if (
      (logos.length || clips.length || state.strictVideo) &&
      !info.unreadable &&
      (now !== info.last || info.moreLogos)
    ) {
      if (
        now < info.last ||
        now - info.last > 2.5 * Math.max(1, v.playbackRate)
      )
        resetVideo(v);
      let frame, clipFrame;
      try {
        frame = vision.surface(v, v.videoWidth, v.videoHeight);
        if (clips.some(rule => rule.crop))
          clipFrame = vision.surface(v, v.videoWidth, v.videoHeight, vision.clipEdge);
      } catch (e) {
        if (e.name === "SecurityError") info.unreadable = true;
      }
      if (frame) {
        info.hit = null;
        info.clipBoxes = [];
        info.tracks ??= new Map();
        for (const rule of clips) {
          if (!info.tracks.has(rule.id)) info.tracks.set(rule.id, {});
          const source = rule.crop ? clipFrame : frame;
          const track = info.tracks.get(rule.id);
          const markedEnd = rule.origin && rule.origin.source === recording &&
            now >= rule.origin.start && now < rule.origin.start + rule.duration
            ? rule.origin.start + rule.duration : null;
          if (markedEnd !== null || (source && vision.clipMatch(source, rule, now, track))) {
            if (rule.clipAction !== "mask" && markedEnd === null && track.until > now &&
                (Number.isFinite(v.duration) || v.seekable.length)) {
              const start = Math.max(0, track.until - rule.duration);
              if (!ranges.some(r => r.id === rule.id && Math.abs(r.start - start) < 1)) {
                const range = {id:rule.id, start, end:track.until};
                info.timeline.found.push(range);
                if (info.timeline.found.length > 256) info.timeline.found.shift();
                ranges.push(range);
                info.timeline.draw(ranges);
                if (recording) chrome.runtime.sendMessage({action:"remember-skip", source:recording, ...range}).catch(() => {});
              }
            }
            if (rule.clipAction !== "mask" && skipConfirmedClip(v, markedEnd ?? track.until)) break;
            info.clipBoxes.push(rule.crop || vision.full);
          }
        }
        info.hit = findLogo(frame, info, v);
        info.last = now;
      }
    }
    if(templates.length && !info.unreadable && (now!==info.templateTime || info.pausedScans<templates.length)) {
      try{scanTemplates(v,info,now);}
      catch(e){if(e.name==="SecurityError")info.unreadable=true;}
    }
    const full = cover || info.hit === vision.full || info.clipBoxes?.includes(vision.full) || (info.unreadable && state.strictVideo);
    const badges = (info.templateBoxes || []).map(hit => hit.display);
    const regions = [...(info.clipBoxes || []), info.hit, info.ocrBox, ...(info.artwork || []), ...badges].filter(Boolean);
    videoMask(v, info, full ? vision.full : regions.map(b => mappedBox(v, b, null)).filter(Boolean), full);
  }
  function skipConfirmedClip(video, until) {
    if (!Number.isFinite(until) || video.paused || video.seeking) return false;
    const end=Number.isFinite(video.duration) ? Math.min(until,video.duration) : until;
    if (end<=video.currentTime+.18) return false;
    for (let i=0;i<video.seekable.length;i++) {
      if (video.seekable.start(i)>video.currentTime || end>video.seekable.end(i)+.03) continue;
      try { video.currentTime=Math.min(end,video.seekable.end(i)); return true; }
      catch { return false; }
    }
    return false;
  }
  function paintPicture(el, info) {
    const regions = [info.visual, info.ocrBox, ...(info.artwork || []), ...(info.templateBoxes || [])].filter(Boolean);
    if (info.label || (regions.length && !info.preview)) mask(el, vision.full);
    else mask(el, regions.map(b => mappedBox(el, b, null)).filter(b => b && b.w*b.h < .95));
  }
  async function remoteFrame(src, edge) {
    const r = await chrome.runtime.sendMessage({ action: "image", url: src, edge });
    if (!r?.value) return null;
    const { width, height, data } = r.value;
    return {
      width,
      height,
      data: Uint8Array.from(atob(data), (s) => s.charCodeAt(0)),
    };
  }
  async function checkPicture(el, info) {
    if ((!logos.length && !templates.length && !scanWinline) || info.label || info.done || info.busy || !info.src)
      return;
    const gen = generation,
      src = info.src;
    info.busy = true;
    try {
      let frame = info.pendingFrame;
      const edge = templates.length ? 576 : logos.length ? 224 : 576;
      if (!frame && el.localName === "img") {
        if (!el.complete || !el.naturalWidth) return;
        try {
          frame = vision.surface(el, el.naturalWidth, el.naturalHeight, edge);
        } catch {}
      }
      if (!frame && /^https?:/i.test(new URL(src, document.baseURI).href))
        frame = await remoteFrame(new URL(src, document.baseURI).href, edge);
      if (gen !== generation || src !== info.src || !el.isConnected) return;
      if(!info.visual) info.visual = frame && findLogo(frame, info, el);
      if(frame && info.templateCursor<templates.length) {
        const rule=templates[info.templateCursor++];
        const cutoff=Math.max(state.logoThreshold??86,rule.minScore);
        const hits=BurmaldaLogos.locate(BurmaldaLogos.pyramid(frame),rule.pattern,cutoff);
        info.templateBoxes.push(...hits.map(hit=>BurmaldaLogos.displayBox(frame,hit,rule,cutoff)).filter(Boolean));
      }
      if (frame && scanWinline && !info.artwork) info.artwork = BurmaldaCampaign.detect(frame);
      info.done = !frame || (!info.moreLogos && info.templateCursor>=templates.length);
      info.pendingFrame = info.done ? null : frame;
      paintPicture(el, info);
    } catch {
      info.done = true;
    } finally {
      info.busy = false;
    }
  }
  let ocrPending = false,
    ocrTurn = 0;
  function nextOCR() {
    if (!state.ocr || ocrPending) return;
    const targets = [...visible];
    for (let i = 0; i < targets.length; i++) {
      const index = (ocrTurn + i) % targets.length,
        el = targets[index];
      const video = el.localName === "video",
        info = (video ? videos : pictures).get(el);
      if (
        !info ||
        info.label ||
        info.visual ||
        info.ocrDone ||
        info.unreadable ||
        info.hit === vision.full || info.clipBoxes?.includes(vision.full)
      )
        continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 72 || rect.height < 22) continue;
      if (
        video &&
        (el.readyState < 2 ||
          el.seeking ||
          info.ocrTime === el.currentTime ||
          performance.now() < (info.ocrAfter || 0))
      )
        continue;
      if (el.localName === "img" && (!el.complete || !el.naturalWidth))
        continue;
      if (!video && !info.src) continue;
      ocrTurn = index + 1;
      runOCR(el, info, video);
      break;
    }
  }
  async function runOCR(el, info, video) {
    ocrPending = true;
    const gen = generation,
      src = info.src,
      epoch = info.epoch,
      time = el.currentTime;
    try {
      const request = { action: "ocr" };
      if (video || el.localName === "img") {
        const w = video ? el.videoWidth : el.naturalWidth,
          h = video ? el.videoHeight : el.naturalHeight;
        const scale = Math.min(1, 960 / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        try {
          request.frame = canvas.toDataURL("image/jpeg", 0.86);
        } catch (e) {
          if (video && e.name === "SecurityError") {
            info.unreadable = true;
            return;
          }
        }
      }
      if (!request.frame) {
        const url = new URL(src, document.baseURI);
        if (!["http:", "https:"].includes(url.protocol)) {
          info.ocrDone = true;
          return;
        }
        request.url = url.href;
      }
      const reply = await chrome.runtime.sendMessage(request);
      if (
        gen !== generation ||
        info.src !== src ||
        epoch !== info.epoch ||
        !el.isConnected ||
        reply.value?.retry
      )
        return;
      info.ocrBox = reply.value?.box || null;
      if (video) {
        info.ocrAfter = performance.now() + 2400;
        info.ocrTime = time;
        checkVideo(el, info);
      } else {
        info.ocrDone = true;
        paintPicture(el, info);
      }
    } catch {
      if (video) info.ocrAfter = performance.now() + 5000;
      else info.ocrDone = true;
    } finally {
      ocrPending = false;
    }
  }
  let mediaTurn = 0;
  function tick() {
    if (!state?.enabled) return;
    refreshPins();
    if (document.hidden) {
      for (const [v, info] of videos) if (info.mutedByUs) checkVideo(v, info);
      return;
    }
    let started = 0;
    for (const el of visible) {
      const info = pictures.get(el);
      if (
        info &&
        started < 2 &&
        info.src &&
        (el.localName !== "img" || (el.complete && el.naturalWidth)) &&
        !info.done &&
        !info.busy &&
        !info.label &&
        (logos.length || templates.length || (scanWinline && el.clientWidth >= 60 && el.clientHeight >= 22))
      ) {
        checkPicture(el, info);
        started++;
      }
    }
    const active = [...videos].filter(
      ([v, info]) => visible.has(v) || info.mutedByUs || document.pictureInPictureElement === v,
    );
    // Rotate so many simultaneous players cannot starve the last one.
    for (let i = 0; i < Math.min(3, active.length); i++)
      checkVideo(...active[(mediaTurn + i) % active.length]);
    mediaTurn += Math.min(3, active.length);
    nextOCR();
  }
  document.addEventListener(
    "load",
    (e) => {
      if (state?.enabled && e.target.localName === "img")
        inspectElement(e.target);
    },
    true,
  );
  // A late stylesheet can introduce background banners after the initial scan.
  document.addEventListener(
    "load",
    (e) => {
      if (state?.enabled && e.target.matches?.('link[rel~="stylesheet"]')) {
        enqueue(document.documentElement);
        schedule();
      }
    },
    true,
  );
  document.addEventListener(
    "seeking",
    (e) => {
      if (e.target.localName === "video") resetVideo(e.target);
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (state?.branded && e.isTrusted && e.detail > 0 && marked.size &&
          !e.composedPath().some(el => el.hasAttribute?.("data-ab-editor"))) {
        const target = e.composedPath()[0];
        // Player controls often sit in a transparent layer above the filtered video.
        const root = target.getRootNode();
        const stack = root.elementsFromPoint?.(e.clientX, e.clientY) || [];
        for (const el of stack) {
          const mark = marked.get(el);
          if (!mark?.badges.length) continue;
          if (!e.composedPath().includes(el)) {
            const player = el.localName === "video" && (el.closest(
              "[data-a-target='video-player'],.html5-video-player,.video-js,.jwplayer") || el.parentElement);
            if (!player || !player.contains(target) || target.closest("a,button,input,[role=button]")) continue;
          }
          const bounds = el.getBoundingClientRect();
          const x = (e.clientX - bounds.left) / bounds.width;
          const y = (e.clientY - bounds.top) / bounds.height;
          if (mark.badges.some(b => x >= b.x && x <= b.x+b.width && y >= b.y && y <= b.y+b.height)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.open("https://github.com/sectapunterx/anti-burmalda", "_blank", "noopener,noreferrer");
            return;
          }
        }
      }
      const a = e.composedPath().find((n) => n?.localName === "a");
      if (a && state?.enabled && (marked.has(a) || plainAdLinks.has(a))) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  function configure(next) {
    generation++;
    clearTimeout(flushTimer);
    flushTimer = null;
    clearInterval(mediaTimer);
    changeObserver.disconnect();
    viewport.disconnect();
    visible.clear();
    queued.clear();
    sweep = [];
    pinned.clear();
    automaticBoxes = new WeakMap();
    for (const [el] of marked) mask(el, null);
    for (const [v, info] of videos) { info.timeline?.remove(); info.speech?.dispose(); restoreMute(v, info); }
    for (const p of planes.values()) p.remove();
    for (const root of roots)
      if (root.host && rootSheets.has(root)) {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
          (sheet) => sheet !== rootSheets.get(root),
        );
      }
    planes.clear();
    roots.clear();
    videos.clear();
    pictures.clear();
    for(const [node,record] of texts)restoreText(node,record);
    for(const [el,table] of attributes)restoreAttributes(el,table);
    highlight.clear();
    state = next;
    if (!next.enabled) {
      CSS.highlights.delete("anti-burmalda-mentions");
      return;
    }
    matcher = reg.matcher(next.entries);
    scanWinline = matcher.matches("Winline").length > 0 || matcher.matches("Винлайн").length > 0;
    const visualRules = next.entries.filter(e => e.kind === "logo");
    logos = visualRules.filter(e => e.sample);
    const portable=visualRules.filter(e=>e.template);
    templates=[...portable.filter(e=>!e.id.startsWith("catalog:")).reverse(),...portable.filter(e=>e.id.startsWith("catalog:"))]
      .map(e=>({id:e.id,pattern:BurmaldaLogos.prepareRule(e),anchor:e.anchor,rotating:e.rotating,minScore:e.minScore || 0})).filter(e=>e.pattern);
    fastPanels=templates.filter(e=>e.pattern.panelPhases);
    regionRules = visualRules.filter(e => e.region).map(e => e.region);
    animations = next.entries.filter(e=>e.kind==="animation").map(e=>e.asset ? e :
      {...e,cycle:BurmaldaAnimation.compile(e.cycle),tracks:new WeakMap()});
    if (scanWinline && /^(?:www\.|m\.)?twitch\.tv$/.test(location.hostname)) {
      for (const preset of BurmaldaTwitchCycles)
        animations.push({...preset,cycle:BurmaldaAnimation.compile(preset.cycle),tracks:new WeakMap()});
    }
    refreshPins();
    clips = next.entries.filter((e) => e.kind === "clip");
    skipIds = new Set(clips.filter(r => r.clipAction !== "mask").map(r => r.id));
    CSS.highlights.set("anti-burmalda-mentions", highlight);
    watch(document);
    enqueue(document.documentElement || document);
    schedule();
    mediaTimer = setInterval(tick, 450);
  }
  const rootSheets = new WeakMap();
  let skipIds = new Set();
  function repositionTimelines() {
    for (const info of videos.values()) info.timeline?.position();
  }
  window.addEventListener("scroll", repositionTimelines, {capture:true, passive:true});
  window.addEventListener("resize", repositionTimelines);
  document.addEventListener("fullscreenchange", repositionTimelines);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.clipRanges) rememberedSkips = changes.clipRanges.newValue || [];
    if (area === "local" && changes.registry)
      configure(changes.registry.newValue || reg.defaults());
  });
  const initialGeneration = generation;
  chrome.storage.local.get(["registry","clipRanges"]).then((r) => {
    rememberedSkips = r.clipRanges || [];
    if (generation === initialGeneration)
      configure(r.registry || reg.defaults());
  });
})();
