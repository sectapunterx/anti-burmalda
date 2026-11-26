"use strict";

// Native video controls live in a closed shadow tree. For those players a
// separate strip follows the video; custom seek bars can be measured directly.
const BurmaldaTimeline = (() => {
  const players = ".html5-video-player,[data-a-target='video-player'],.video-js,.jwplayer,.plyr";
  const bars = ".ytp-progress-bar,[data-a-target='player-seekbar'],[data-test-selector='seekbar-interaction-area'],.vjs-progress-holder,.jw-slider-time,.plyr__progress input[type=range]";
  const sessions = new WeakMap();
  function windowFor(video) {
    if (Number.isFinite(video.duration) && video.duration > 0) return [0, video.duration];
    const ranges = video.seekable;
    return ranges.length ? [ranges.start(0), ranges.end(ranges.length - 1)] : null;
  }
  class Timeline {
    static local(video, source) {
      const key = source || location.href;
      let session = sessions.get(video);
      if (!session || session.src !== video.currentSrc || session.stream !== video.srcObject || session.key !== key) {
        session = {src:video.currentSrc, stream:video.srcObject, key, ranges:[]};
        sessions.set(video, session);
      }
      return session.ranges;
    }
    constructor(video) {
      this.video = video;
      this.found = [];
    }
    matches(source) {
      return this.found === Timeline.local(this.video, source);
    }
    reset(source) {
      this.remove();
      this.found = Timeline.local(this.video, source);
    }
    remove() {
      this.strip?.remove();
      this.strip = null;
      this.key = "";
    }
    draw(intervals) {
      const window = windowFor(this.video);
      if (!window || !intervals.length) { this.remove(); return; }
      const [start, end] = window;
      const spans = intervals.filter(r => r.end > start && r.start < end);
      if (!spans.length || end <= start) { this.remove(); return; }
      if (!this.strip) {
        this.strip = document.createElement("div");
        this.strip.setAttribute("data-ab-timeline", "");
        this.strip.setAttribute("role", "img");
        this.strip.style.cssText = "all:initial!important;position:fixed!important;pointer-events:none!important;z-index:2147483644!important;height:4px!important;overflow:hidden!important";
      }
      const key = [start,end,...spans.flatMap(r => [r.start,r.end])].join("/");
      if (this.key !== key) {
        this.key = key;
        this.strip.setAttribute("aria-label", "Анти-бурмалда · участков для пропуска: " + spans.length);
        this.strip.replaceChildren(...spans.map(range => {
          const mark = document.createElement("i");
          const left = Math.max(start, range.start), right = Math.min(end, range.end);
          mark.style.cssText = "position:absolute!important;top:0!important;height:100%!important;min-width:2px!important;background:#41f59e!important";
          mark.style.left = (left-start)/(end-start)*100 + "%";
          mark.style.width = (right-left)/(end-start)*100 + "%";
          return mark;
        }));
      }
      this.position();
    }
    position() {
      if (!this.strip) return;
      const video = this.video;
      const fullscreen = document.fullscreenElement;
      const player = video.closest(players);
      const track = player?.querySelector(bars);
      const bar = track?.getBoundingClientRect();
      const native = !bar?.width;
      const rect = native ? video.getBoundingClientRect() : bar;
      const hidden = !video.isConnected || !rect.width || rect.bottom <= 0 || rect.top >= innerHeight ||
        (fullscreen && !fullscreen.contains(video));
      if (hidden) { this.strip.remove(); return; }
      const insideTrack = !native && !track.matches("input,video,progress") && getComputedStyle(track).position !== "static";
      const parent = insideTrack ? track : fullscreen || document.documentElement;
      if (this.strip.parentNode !== parent) parent.append(this.strip);
      const top = native ? rect.bottom - (video.controls ? 44 : 6) : rect.top + rect.height/2 - 2;
      const css = this.strip.style;
      css.setProperty("position", insideTrack ? "absolute" : "fixed", "important");
      css.setProperty("left", insideTrack ? "0" : rect.left + "px", "important");
      css.setProperty("top", insideTrack ? "calc(50% - 2px)" : top + "px", "important");
      css.setProperty("width", insideTrack ? "100%" : rect.width + "px", "important");
      css.setProperty("background", native ? "rgba(0,0,0,.35)" : "transparent", "important");
    }
  }
  return Timeline;
})();
