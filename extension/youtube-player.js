"use strict";
// Pass only the current video's public text sources and client locale across worlds.
function transcriptRequest(watch, videoId) {
  const data = watch?.data;
  if (!videoId || data?.currentVideoEndpoint?.watchEndpoint?.videoId !== videoId) return;
  const panelId = "PAmodern_transcript_view";
  // YouTube can defer mounting the description until the viewer expands it.
  function findSection(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.videoDescriptionTranscriptSectionRenderer) return obj.videoDescriptionTranscriptSectionRenderer;
    for (const child of Object.values(obj)) {
      const found = findSection(child);
      if (found) return found;
    }
  }
  const section = watch.querySelector("ytd-video-description-transcript-section-renderer")?.data ||
    findSection(data.engagementPanels) || findSection(data.contents?.twoColumnWatchNextResults?.results);
  const commands = section?.primaryButton?.buttonRenderer?.command?.commandExecutorCommand?.commands || [];
  const panel = commands.map(c => c.updateEngagementPanelContentCommand)
    .find(c => c?.contentSourcePanelIdentifier?.tag === panelId);
  const panels = data.engagementPanels || [];
  const legacy = panels.map(p => p.engagementPanelSectionListRenderer)
    .find(p => p?.targetId === "engagement-panel-searchable-transcript");
  const params = panel?.globalConfiguration?.params ||
    legacy?.onShowCommands?.find(c => c.getTranscriptEndpoint)?.getTranscriptEndpoint?.params;
  const config = window.ytcfg?.get?.("INNERTUBE_CONTEXT")?.client;
  if (!params || !config?.clientVersion) return;
  const { clientName, clientVersion, hl, gl } = config;
  return { panelId: panel?.globalConfiguration?.params ? panelId : undefined, params,
    context: { client: { clientName, clientVersion, hl, gl } } };
}
document.addEventListener("ab-query-captions", (event) => {
  const node = event.target;
  if (
    !(node instanceof HTMLElement) ||
    !node.hasAttribute("data-ab-track-query")
  )
    return;
  try {
    const player = node.closest(".html5-video-player");
    const response = player?.getPlayerResponse?.();
    const key = response?.videoDetails?.videoId || player?.getVideoData?.()?.video_id;
    if (!key) return;
    node.dataset.video = key;
    const watch = player.closest("ytd-watch-flexy") || document.querySelector("ytd-watch-flexy:not([hidden])");
    const request = transcriptRequest(watch, key);
    if (request) node.dataset.transcript = JSON.stringify(request);
    const tracks =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return;
    const active = player.getOption?.("captions", "track")?.languageCode;
    const track =
      tracks.find((t) => t.languageCode === active) ||
      tracks.find((t) => t.kind === "asr") ||
      tracks.find((t) => t.languageCode === document.documentElement.lang) ||
      tracks[0];
    if (track?.baseUrl && response.videoDetails?.videoId) {
      node.dataset.video = response.videoDetails.videoId;
      node.dataset.track = track.baseUrl;
    }
  } catch {
    /* Embedded players can expose only rendered captions. */
  }
});
