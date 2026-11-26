"use strict";

globalThis.BurmaldaRegistry = (() => {
  const initialNames = [
    "1xBet",
    "1хбет",
    "Fonbet",
    "Фонбет",
    "BetBoom",
    "Бетбум",
    "Winline",
    "Винлайн",
    "Bet365",
    "Лига Ставок",
    "казино",
    "casino",
    "букмекер",
    "букмекеры",
    "букмекера",
    "букмекеров",
    "букмекером",
    "онлайн-казино",
    "казино онлайн",
    "рулетка на деньги",
    "рулетка скинов",
    "ставки на спорт",
    "букмекерская контора",
    "online casino",
    "skin gambling",
    "skin roulette",
  ];
  const initialDomains = [
    "1xbet.com",
    "fon.bet",
    "betboom.ru",
    "winline.ru",
    "bet365.com",
  ];
  // The original installation assigned these IDs by position. Keep its list
  // intact so upgrading a profile never recreates a deleted 0.1.0 rule.
  const legacyEntries = [
    ...initialNames.map((value) => ({ kind: "name", value })),
    ...initialDomains.map((value) => ({ kind: "domain", value })),
  ].map((entry, i) => ({ ...entry, id: "builtin-" + i }));
  const keyOf = ({ kind, value }) => kind + ":" + value.toLowerCase();
  const legacyKeys = new Set(legacyEntries.map(keyOf));
  const additions = [];
  for (const { names, domains, contextual = [] } of BurmaldaCatalog) {
    for (const [kind, values] of [["name", names], ["domain", domains]]) {
      for (const value of values) {
        const key = keyOf({ kind, value });
        if (legacyKeys.has(key)) continue;
        const entry = { id: "catalog:" + key, kind, value };
        if (contextual.includes(value)) entry.contextual = true;
        additions.push(entry);
      }
    }
  }
  function upgrade(stored) {
    if (stored.catalogVersion >= 6) return stored;
    const existing = new Set(stored.entries.map(keyOf));
    const version=stored.catalogVersion || 1;
    const incoming=BurmaldaLogoCatalog.filter(e=>(e.since || (e.anchor ? 4 : 3))>version);
    if(version<2) incoming.unshift(...additions);
    const yellow=BurmaldaLogoCatalog.find(e=>e.id==="catalog:logo:bb-yellow-promo");
    const entries=stored.entries.map(e=>version<5 && e.id===yellow.id ? {...e,panelPhases:yellow.panelPhases} : e);
    return {
      ...stored,
      catalogVersion: 6,
      entries: [...entries, ...incoming.filter(e => !existing.has(keyOf(e))).map(e => ({ ...e }))],
    };
  }
  const defaults = () => upgrade({
    enabled: true,
    branded: true,
    strictVideo: false,
    ocr: true,
    youtubeVoice: true,
    entries: legacyEntries.map(e => ({ ...e })),
  });

  function domain(value) {
    const clean = value.trim().toLowerCase().replace(/\.$/, "");
    if (!clean || /[\s/?#@:\\*]/u.test(clean))
      throw Error("Введите домен без пути, например example.org.");
    let host;
    try {
      host = new URL("https://" + clean).hostname;
    } catch {
      throw Error("Некорректный домен.");
    }
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]+$/i.test(
        host,
      )
    ) {
      throw Error("Нужен полный домен с зоной.");
    }
    return host;
  }

  function matcher(entries) {
    const contextual = new Set(entries.filter(e => e.kind === "name" && e.contextual).map(e => e.value.toLowerCase()));
    const adContext = /скин|депозит|промокод|рулетк|букмекер|спонсор|партн[её]р|реклам|бонус|кейсы|кейсов|\b(?:skins?|cs2|csgo|sponsor|promo|bonus|roulette|casino|betting)\b/iu;
    const names = entries
      .filter((e) => e.kind === "name")
      .map((e) => e.value)
      .sort((a, b) => b.length - a.length);
    const escape = (s) => s.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
    const alternatives = names.map((s) =>
      s
        .trim()
        .split(/[\s_\u2010-\u2014-]+/u)
        .map(escape)
        .join("[\\s_\\u2010-\\u2014-]+"),
    );
    const regex = alternatives.length
      ? new RegExp(
          "(?<![\\p{L}\\p{N}])(?:" +
            alternatives.join("|") +
            ")(?![\\p{L}\\p{N}])",
          "giu",
        )
      : null;
    const domains = new Set(
      entries.filter((e) => e.kind === "domain").map((e) => e.value),
    );
    function address(raw, base) {
      if (!raw) return false;
      try {
        const url = new URL(raw, base);
        if (!["https:", "http:"].includes(url.protocol)) return false;
        let host = url.hostname.replace(/\.$/, "");
        while (host.includes(".")) {
          if (domains.has(host)) return true;
          host = host.slice(host.indexOf(".") + 1);
        }
        return (
          matches(
            decodeURIComponent(url.hostname + url.pathname).replace(
              /[_-]/g,
              " ",
            ),
          ).length > 0
        );
      } catch {
        return false;
      }
    }
    function matches(value) {
      if (!regex || !value) return [];
      return [...value.matchAll(regex)].filter(hit => {
        if (!contextual.has(hit[0].toLowerCase())) return true;
        // A standalone brand label or a mention next to promotional terms.
        if (value.trim() === hit[0]) return true;
        return adContext.test(value.slice(Math.max(0, hit.index - 64), hit.index + hit[0].length + 64));
      });
    }
    return { matches, address };
  }

  function networkRules(state) {
    const domains = state.entries
      .filter((e) => e.kind === "domain")
      .map((e) => e.value);
    return state.enabled && domains.length
      ? [
          {
            id: 1,
            priority: 1,
            action: { type: "block" },
            condition: {
              requestDomains: domains,
              excludedResourceTypes: ["main_frame"],
            },
          },
        ]
      : [];
  }
  return { defaults, upgrade, domain, matcher, networkRules };
})();
