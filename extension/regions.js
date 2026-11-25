"use strict";

// A visual sample travels between sites. A pinned region belongs to the
// selected player or page element and survives changes to its pixels.
const BurmaldaRegions = (() => {
  function pageKey() {
    const url = new URL(location.href);
    if (/^(?:www\.|m\.)?twitch\.tv$/.test(url.hostname))
      return url.origin + url.pathname.toLowerCase().replace(/\/$/, "");
    if (
      /^(?:www\.|m\.)?youtube\.com$/.test(url.hostname) &&
      url.pathname === "/watch"
    )
      return url.origin + "/watch?v=" + url.searchParams.get("v");
    return url.href;
  }

  function selectorFor(el, root) {
    if (el.localName === "video") {
      for (const player of [
        "[data-a-target='video-player']",
        "[data-test-selector='video-player__video-container']",
        ".html5-video-player",
        ".video-js",
      ]) {
        const selector = player + " video";
        if (
          el.matches(selector) &&
          root.querySelectorAll(selector).length === 1
        )
          return selector;
      }
    }
    const suffix = [];
    for (let node = el; node; node = node.parentElement) {
      const tag = CSS.escape(node.localName);
      const choices = [];
      for (const key of [
        "data-a-target",
        "data-testid",
        "data-test-selector",
      ]) {
        const value = node.getAttribute(key);
        if (value)
          choices.push(tag + "[" + key + "=" + CSS.escape(value) + "]");
      }
      if (node === el && node.matches("video,canvas,iframe")) choices.push(tag);
      if (node.id) choices.push("#" + CSS.escape(node.id));
      for (const choice of choices) {
        if (root.querySelectorAll(choice).length === 1)
          return [choice, ...suffix].join(" > ");
      }
      const siblings = Array.from(node.parentNode?.children || []).filter(
        (s) => s.localName === node.localName,
      );
      suffix.unshift(
        siblings.length > 1
          ? tag + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")"
          : tag,
      );
    }
    return suffix.join(" > ");
  }

  function targetAt(items, rect) {
    function contains(el) {
      const b = el.getBoundingClientRect();
      return (
        rect.x >= b.left - 2 &&
        rect.y >= b.top - 2 &&
        rect.x + rect.w <= b.right + 2 &&
        rect.y + rect.h <= b.bottom + 2
      );
    }
    const eligible = items.filter(
      (el) => !el.matches("html,body,[data-ab-editor]") && contains(el),
    );
    const media = "video,img,canvas,iframe,svg";
    const isArtwork = (el) => {
      if (el.matches(media)) return true;
      const css = getComputedStyle(el);
      if (css.backgroundImage.includes("url(")) return true;
      const bounds = el.getBoundingClientRect();
      return (
        bounds.width * bounds.height <= 4 * rect.w * rect.h &&
        (css.backgroundImage !== "none" ||
          css.backgroundColor !== "rgba(0, 0, 0, 0)" ||
          el.textContent.trim().length > 0)
      );
    };
    for (const el of eligible) {
      if (isArtwork(el)) return el;
      // A player control layer can intercept the pointer over the actual video.
      if (el.id || el.hasAttribute("role") || el.matches("div,section,main")) {
        const player = [...el.querySelectorAll(media)].find((child) =>
          contains(child),
        );
        if (
          player &&
          !eligible.some((other) => other !== player && isArtwork(other))
        )
          return player;
      }
    }
    return eligible[0];
  }

  function mediaRect(el) {
    const rect = el.getBoundingClientRect();
    const w = el.videoWidth || el.naturalWidth,
      h = el.videoHeight || el.naturalHeight;
    const css = getComputedStyle(el);
    if (
      !w ||
      !h ||
      css.objectPosition !== "50% 50%" ||
      css.objectFit === "fill"
    )
      return rect;
    let scale =
      css.objectFit === "cover"
        ? Math.max(rect.width / w, rect.height / h)
        : Math.min(rect.width / w, rect.height / h);
    if (css.objectFit === "none") scale = 1;
    if (css.objectFit === "scale-down") scale = Math.min(scale, 1);
    const width = w * scale,
      height = h * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }
  function capture(el, rect) {
    if (!el) return null;
    const path = [];
    for (let node = el; node; node = node.getRootNode().host)
      path.unshift(selectorFor(node, node.getRootNode()));
    let b = mediaRect(el);
    const within =
      rect.x >= b.left - 0.1 &&
      rect.y >= b.top - 0.1 &&
      rect.x + rect.w <= b.left + b.width + 0.1 &&
      rect.y + rect.h <= b.top + b.height + 0.1;
    const intrinsic = within && !!(el.videoWidth || el.naturalWidth);
    if (!intrinsic) b = el.getBoundingClientRect();
    const unit = (n) => Math.max(0, Math.min(1, n));
    const x = unit((rect.x - b.left) / b.width),
      y = unit((rect.y - b.top) / b.height);
    const w = unit((rect.x + rect.w - b.left) / b.width) - x,
      h = unit((rect.y + rect.h - b.top) / b.height) - y;
    if (!(w > 0 && h > 0)) return null;
    const region = {
      page: pageKey(),
      path,
      tag: el.localName,
      intrinsic,
      x,
      y,
      w,
      h,
    };
    // A recycled thumbnail may now show a different image.
    const src = el.localName === "img" && (el.currentSrc || el.src);
    if (src && /^https?:/.test(src) && src.length <= 2048) region.src = src;
    return region;
  }
  function resolve(rule) {
    let root = document,
      el;
    for (const selector of rule.path) {
      const nodes = root?.querySelectorAll(selector);
      el = nodes?.length === 1 ? nodes[0] : null;
      root = el?.shadowRoot;
    }
    if (rule.src && (el?.currentSrc || el?.src) !== rule.src) {
      el = [...document.images].find(
        (img) => (img.currentSrc || img.src) === rule.src,
      );
    }
    return el?.localName === rule.tag ? el : null;
  }
  function box(el, rule) {
    if (!rule.intrinsic) return { x: rule.x, y: rule.y, w: rule.w, h: rule.h };
    const b = el.getBoundingClientRect(),
      r = mediaRect(el);
    if (!b.width || !b.height) return null;
    const x = Math.max(0, (r.left - b.left + rule.x * r.width) / b.width);
    const y = Math.max(0, (r.top - b.top + rule.y * r.height) / b.height);
    const right = Math.min(
      1,
      (r.left - b.left + (rule.x + rule.w) * r.width) / b.width,
    );
    const bottom = Math.min(
      1,
      (r.top - b.top + (rule.y + rule.h) * r.height) / b.height,
    );
    return right > x && bottom > y
      ? { x, y, w: right - x, h: bottom - y }
      : null;
  }
  return { pageKey, targetAt, capture, resolve, box };
})();
