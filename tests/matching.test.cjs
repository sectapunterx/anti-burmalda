"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../extension/catalog.js");
require("../extension/logo-catalog.js");
require("../extension/logomatch.js");
require("../extension/registry.js");
require("../extension/vision.js");
require("../extension/animation.js");
const registry = BurmaldaRegistry, vision = BurmaldaVision;

test("YouTube audio needs offsets enclosing only the matched words", () => {
  const source = require("node:fs").readFileSync(require.resolve("../extension/youtube.js"), "utf8");
  const context = { location: { hostname: "www.youtube.com" } };
  require("node:vm").runInNewContext(source, context);
  const matcher = registry.matcher([{ kind: "name", value: "Winline" }]);
  function hit(segs) {
    return context.BurmaldaSpeech.intervals({ events: [{ tStartMs: 1000, dDurationMs: 5000, segs }] }, matcher)[0];
  }
  const word = hit([{ utf8: "Матч " }, { utf8: "Winline", tOffsetMs: 300 }, { utf8: " начался", tOffsetMs: 800 }]);
  assert.equal(word.wordTimed, true);
  assert.deepEqual([word.start, word.end], [1.3, 1.8]);
  for (const segs of [
    [{ utf8: "Матч Winline начался" }],
    [{ utf8: "Матч Winline" }, { utf8: " начался", tOffsetMs: 800 }],
    [{ utf8: "Матч " }, { utf8: "Winline", tOffsetMs: 300 }],
    [{ utf8: "Winline" }, { utf8: " в эфире" }, { utf8: " сейчас", tOffsetMs: 800 }],
    [{ utf8: "Winline" }, { utf8: " начался", tOffsetMs: 4000 }],
  ]) assert.equal(hit(segs).wordTimed, false);
});

test("portable logo matching at multiple sizes uses the threshold and rejects a plain red sign", () => {
  const logos=BurmaldaLogos, model=BurmaldaLogoCatalog.find(e=>e.id==="catalog:logo:fon").template;
  const colors=Buffer.from(model.grid,"base64"), t=logos.prepare(model);
  const width=230,height=140,data=new Uint8ClampedArray(width*height*4);
  function paint(x,y,w,h,lettering) {
    for(let row=0;row<h;row++)for(let col=0;col<w;col++){
      const i=4*(12*Math.floor(12*row/h)+Math.floor(12*col/w));
      const pixel=lettering ? [colors[i]*.86,colors[i+1]*.86+5,colors[i+2]*.86+8,255] : [184,37,36,255];
      data.set(pixel,4*((y+row)*width+x+col));
    }
  }
  paint(12,18,62,46,true);paint(164,91,28,21,true);paint(108,31,60,45,false);
  const levels=logos.pyramid({data,width,height}),hits=logos.locate(levels,t,86);
  for(const [x,y] of [[42,41],[178,102]])
    assert(hits.some(b=>Math.abs((b.x+b.w/2)*width-x)<4 && Math.abs((b.y+b.h/2)*height-y)<4));
  assert.equal(hits.length,2);
  const strict=logos.locate(levels,t,97);
  assert(strict.every(b=>b.score>=97));
  assert(hits.every(b=>b.score>=86));
  const v2={catalogVersion:2,entries:[],logoThreshold:91};
  const next=registry.upgrade(v2);
  assert.deepEqual(next.entries.map(e=>e.id),BurmaldaLogoCatalog.map(e=>e.id));
  assert.equal(next.logoThreshold,91);
  const removed={...next,entries:[]};
  assert.equal(registry.upgrade(removed).entries.length,0);
});

test("animation detection requires repeated motion and ignores changing footage behind the banner", () => {
  const motion=BurmaldaAnimation;
  let seed=23;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
  function make(i,phase) {
    const rgb=Uint8Array.from({length:16*12*3},random);
    for(let c=14;c<70;c++)
      rgb.set([(phase*65+c)%256,(c*6)%200,(phase*92)%255],c*3);
    return {time:i*.25,rgb};
  }
  const still=Array.from({length:28},(_,i)=>make(i,0));
  assert.equal(motion.detect(still),null);
  const noise=Array.from({length:28},(_,i)=>({time:i*.25,rgb:Uint8Array.from({length:576},random)}));
  noise[19].rgb=noise[2].rgb;
  assert.equal(motion.detect(noise),null);
  const frames=Array.from({length:24},(_,i)=>make(i,Math.floor((i%12)/3)));
  const cycle=motion.detect(frames);
  assert(motion.valid(cycle));assert.equal(cycle.duration,3);
  const compiled=motion.compile(cycle), track={};
  for(let i=0;i<12;i++) motion.match(make(i,Math.floor(i/3)).rgb,compiled,track,i*.25);
  assert(track.active);
  assert.equal(motion.match(new Uint8Array(576),compiled,track,9),false);
});

test("whole words, Cyrillic, punctuation and exact domain boundaries", () => {
  const matcher = registry.matcher([
    {kind:"name",value:"Моя ставка"}, {kind:"name",value:"A+B"},
    {kind:"domain",value:"example.test"}
  ]);
  assert.equal(matcher.matches("Вчера: МОЯ\u00a0СТАВКА.")[0][0],"МОЯ\u00a0СТАВКА");
  assert.equal(matcher.matches("моя ставками").length,0);
  assert.equal(matcher.matches("промоя ставка").length,0);
  assert.equal(matcher.matches("A+B").length,1);
  assert.equal(matcher.matches("AAB").length,0);
  assert(matcher.address("https://cdn.example.test/a"));
  assert(!matcher.address("https://example.test.invalid/a"));
  assert(!matcher.address("https://notexample.test/a"));
  assert.equal(registry.domain("Пример.рф"),"xn--e1afmkfd.xn--p1ai");
  assert.throws(()=>registry.domain("example.test/path"));
});

test("starter catalog protects requested brands and leaves unrelated software, sport and shopping alone", () => {
  const state = registry.defaults();
  const match = registry.matcher(state.entries);
  for (const label of ["1WIN", "1вин", "Upgrader", "Скины на Апгрейдер", "MUSOR_DROP", "мусордроп", "Winline", "Винлайн", "Bet-Boom", "Бетбум"]) {
    assert(match.matches(label).length > 0, label);
  }
  for (const text of ["firmware upgrader for Linux", "апгрейдер прошивки", "ФК Зенит", "заключить пари", "at stake", "пакет для мусора", "twinlines"]) {
    assert.equal(match.matches(text).length, 0, text);
  }
  const [rule] = registry.networkRules(state);
  for (const host of ["1win.com", "upgrader.pro", "musor.win", "winline.ru", "betboom.ru", "casino.fanatics.com"]) {
    assert(rule.condition.requestDomains.includes(host), host);
    assert(match.address("https://cdn." + host + "/image"));
  }
  for (const host of ["fanatics.com", "github.com", "steamcommunity.com", "t.me"]) {
    assert(!match.address("https://" + host + "/news"));
    assert(!rule.condition.requestDomains.includes(host));
  }
  assert.equal(new Set(state.entries.map(e => e.id)).size, state.entries.length);
  assert.equal(new Set(state.entries.map(e => e.kind + ":" + e.value.toLowerCase())).size, state.entries.length);
  for (const { domains } of BurmaldaCatalog) for (const host of domains) assert.equal(registry.domain(host), host);
});

test("an existing profile gets new rules once, preserving edits and deletions", () => {
  const legacy = registry.defaults().entries.filter(e => e.id.startsWith("builtin-") && !["Winline", "winline.ru"].includes(e.value));
  const personal = [
    { id: "mine", kind: "name", value: "MUSOR DROP" },
    { id: "my-logo", kind: "logo", value: "My logo", sample: { points: [[0,0,0,0,0]] } },
  ];
  const stored = { enabled: false, ocr: false, branded: false, strictVideo: true, entries: [...legacy, ...personal] };
  const next = registry.upgrade(stored);
  assert.equal(next.enabled, false);
  assert.equal(next.strictVideo, true);
  assert.equal(next.ocr, false);
  assert.equal(next.branded, false);
  assert.deepEqual(next.entries.slice(0, stored.entries.length), stored.entries);
  assert.equal(next.entries.filter(e => e.value.toLowerCase() === "musor drop").length, 1);
  assert(!next.entries.some(e => ["Winline","winline.ru"].includes(e.value)));
  assert(next.entries.some(e => e.value === "1win"));
  next.entries = next.entries.filter(e => e.value !== "1win");
  assert.equal(registry.upgrade(next), next);
  assert(!next.entries.some(e => e.value === "1win"));
});

function frame(inverted=false) {
  const data=new Uint8ClampedArray(8*8*4);
  for(let y=0;y<8;y++) for(let x=0;x<8;x++) {
    const v=(x<4)!==inverted ? 255:0;
    data.set([v,255-v,v,255],(y*8+x)*4);
  }
  return {width:8,height:8,data};
}
test("a transparent single-colour silhouette cannot match a flat field",()=>{
  const reference=frame();
  for(let i=0;i<64;i++) if(i%8>=4) reference.data[i*4+3]=0;
  const sample=vision.signature(reference);
  assert(vision.locate(frame(),sample));
  const solid=frame();for(let i=0;i<64;i++) solid.data.set([255,0,255,255],4*i);
  assert.equal(vision.locate(solid,sample),null);
});
test("ordered samples cover intervening frames only for the reference duration",()=>{
  const first=frame(), second=frame(true), neutral=frame();
  neutral.data.fill(150);
  const rule={duration:4,frames:[{time:.1,sample:vision.signature(first)},{time:1.6,sample:vision.signature(second)}]};
  for (const start of [8,120]) {
    const track={};
    assert(!vision.clipMatch(neutral,rule,start-1,track));
    assert(vision.clipMatch(first,rule,start+.1,track));
    assert(vision.clipMatch(second,rule,start+1.6,track));
    assert(vision.clipMatch(neutral,rule,start+2.5,track));
    assert(!vision.clipMatch(neutral,rule,start+4.1,track));
  }
  const reversed={};
  vision.clipMatch(second,rule,2,reversed);
  vision.clipMatch(first,rule,3,reversed);
  assert(!vision.clipMatch(neutral,rule,3.5,reversed));
});

