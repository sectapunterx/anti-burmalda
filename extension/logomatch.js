"use strict";

globalThis.BurmaldaLogos = (() => {
  const side = 12;
  function template(image) {
    const { width, height, data } = image;
    let bytes = "";
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        let r = 0,
          g = 0,
          b = 0,
          alpha = 0,
          count = 0;
        const left = Math.floor((x * width) / side),
          top = Math.floor((y * height) / side);
        const right = Math.max(left + 1, Math.floor(((x + 1) * width) / side)),
          bottom = Math.max(top + 1, Math.floor(((y + 1) * height) / side));
        for (let sy = top; sy < bottom; sy++)
          for (let sx = left; sx < right; sx++) {
            const i = (sy * width + sx) * 4,
              a = data[i + 3];
            alpha += a;
            r += a * data[i];
            g += a * data[i + 1];
            b += a * data[i + 2];
            count++;
          }
        bytes += String.fromCharCode(
          Math.round(r / (alpha || 1)),
          Math.round(g / (alpha || 1)),
          Math.round(b / (alpha || 1)),
          Math.round(alpha / count),
        );
      }
    return { aspect: width / height, grid: btoa(bytes) };
  }
  function valid(t) {
    return (
      t &&
      Number.isFinite(t.aspect) &&
      t.aspect > 0.02 &&
      t.aspect < 50 &&
      typeof t.grid === "string" &&
      t.grid.length === (side * side * 4 * 4) / 3 &&
      /^[A-Za-z0-9+/]+$/.test(t.grid)
    );
  }
  function prepare(t) {
    if (!valid(t)) return null;
    const bytes = Uint8Array.from(atob(t.grid), (c) => c.charCodeAt(0));
    const points = [];
    let r = 0,
      g = 0,
      b = 0,
      sq = 0;
    for (let j = 0; j < side * side; j++) {
      const i = j * 4;
      if (bytes[i + 3] < 180) continue;
      const p = {
        x: ((j % side) + 0.5) / side,
        y: (Math.floor(j / side) + 0.5) / side,
        r: bytes[i],
        g: bytes[i + 1],
        b: bytes[i + 2],
      };
      points.push(p);
      r += p.r;
      g += p.g;
      b += p.b;
      sq += p.r * p.r + p.g * p.g + p.b * p.b;
    }
    const n = points.length,
      variance = sq - (r * r + g * g + b * b) / n;
    // Transparent, single-colour silhouettes use the existing outline matcher.
    if (n < 9 || variance < 420 * n) return null;
    const dist = (a, b) =>
      (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
    const mean = { r: r / n, g: g / n, b: b / n },
      selected = [];
    for (let k = 0; k < 6; k++) {
      let best = -1,
        probe;
      for (const p of points) {
        const saturation = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
        const d = selected.length
          ? Math.min(
              ...selected.map(
                (q) =>
                  dist(p, q) + 1400 * ((p.x - q.x) ** 2 + (p.y - q.y) ** 2),
              ),
            )
          : saturation * saturation * 5 + dist(p, mean);
        if (d > best) {
          best = d;
          probe = p;
        }
      }
      selected.push(probe);
    }
    return { aspect: t.aspect, points, selected, r, g, b, variance };
  }
  function pyramid(frame) {
    const levels = [frame];
    while (
      Math.min(frame.width, frame.height) >= 20 &&
      Math.max(frame.width, frame.height) >= 28
    ) {
      const width = Math.floor(frame.width / 2),
        height = Math.floor(frame.height / 2),
        data = new Uint8ClampedArray(width * height * 4);
      const src = frame.data,
        stride = frame.width * 4;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const j = (y * width + x) * 4,
            i = (2 * y * frame.width + 2 * x) * 4;
          for (let c = 0; c < 4; c++)
            data[j + c] =
              (src[i + c] +
                src[i + 4 + c] +
                src[i + stride + c] +
                src[i + stride + 4 + c]) *
              0.25;
        }
      frame = { width, height, data };
      levels.push(frame);
    }
    return levels;
  }
  function overlap(a, b) {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
  }
  function scoreAt(data, base, offsets, t) {
    let r = 0,
      g = 0,
      b = 0,
      sq = 0,
      cross = 0,
      error = 0;
    for (let k = 0; k < t.points.length; k++) {
      const i = base + offsets[k],
        p = t.points[k],
        R = data[i],
        G = data[i + 1],
        B = data[i + 2];
      r += R;
      g += G;
      b += B;
      sq += R * R + G * G + B * B;
      cross += R * p.r + G * p.g + B * p.b;
      error += Math.abs(R - p.r) + Math.abs(G - p.g) + Math.abs(B - p.b);
    }
    const n = t.points.length,
      variance = sq - (r * r + g * g + b * b) / n;
    if (variance < t.variance * 0.12) return 0;
    const corr =
      (cross - (r * t.r + g * t.g + b * t.b) / n) /
      Math.sqrt(variance * t.variance);
    return (
      100 * (0.74 * Math.min(1, corr) + 0.26 * (1 - error / (n * 3 * 255)))
    );
  }
  function locate(levels, t, threshold) {
    if (t.panelPhases) return colourPanels(levels[0],t.panelPhases,threshold,t.panelColour);
    // A layout rule also verifies the surrounding panel in displayBox.
    if (t.layouts?.length) threshold-=6;
    const found = [];
    function keep(box) {
      const same = found.findIndex((b) => overlap(b, box) > 0.52);
      if (same >= 0) {
        const old = found[same];
        if (
          box.score > old.score + 0.25 ||
          (Math.abs(box.score - old.score) <= 0.25 &&
            box.w * box.h > old.w * old.h)
        )
          found[same] = box;
      } else if (found.length < 16) found.push(box);
      else {
        let weakest = 0;
        for (let i = 1; i < found.length; i++)
          if (found[i].score < found[weakest].score) weakest = i;
        if (box.score > found[weakest].score) found[weakest] = box;
      }
    }
    for (const frame of levels) {
      const { width: W, height: H, data } = frame;
      const min = Math.max(12, Math.ceil(6 * t.aspect)),
        max = Math.min(W, H * t.aspect, min * 2.08);
      function scan(w, h) {
        const offset = (p) =>
          4 *
          (Math.min(w - 1, Math.floor(p.x * w)) +
            W * Math.min(h - 1, Math.floor(p.y * h)));
        const anchors = t.selected.map((p) => ({ ...p, offset: offset(p) })),
          offsets = t.points.map(offset);
        const pivot = anchors[0],
          first = pivot.offset;
        const colors = [pivot.r, pivot.g, pivot.b],
          bright = colors.indexOf(Math.max(...colors)),
          dark = colors.indexOf(Math.min(...colors));
        const chroma = (colors[bright] - colors[dark]) * 0.48;
        const dx = Math.max(1, Math.floor(w / 16)),
          dy = Math.max(1, Math.floor(h / 16));
        for (let y = 0; y <= H - h; y += dy)
          for (let x = 0; x <= W - w; x += dx) {
            const base = (y * W + x) * 4;
            const i = base + first;
            if (
              data[i + bright] - data[i + dark] < chroma ||
              Math.abs(data[i] - pivot.r) +
                Math.abs(data[i + 1] - pivot.g) +
                Math.abs(data[i + 2] - pivot.b) >
                147
            )
              continue;
            let passed = 0;
            for (let k = 1; k < anchors.length; k++) {
              const a = anchors[k];
              const i = base + a.offset;
              if (
                Math.abs(data[i] - a.r) +
                  Math.abs(data[i + 1] - a.g) +
                  Math.abs(data[i + 2] - a.b) <
                145
              )
                passed++;
              else if (k === 1) break;
            }
            if (passed < 4) continue;
            const score = scoreAt(data, base, offsets, t);
            if (score >= threshold - 16)
              keep({ x: x / W, y: y / H, w: w / W, h: h / H, score });
          }
      }
      for (let w = min; w <= max; w = Math.max(w + 1, Math.round(w * 1.12)))
        scan(w, Math.min(H, Math.max(1, Math.round(w / t.aspect))));
      if (Math.abs(Math.log(W / H / t.aspect)) < 0.13) scan(W, H);
    }
    for (const box of found) refine(levels[0], t, box);
    return found.filter((box) => box.score >= threshold);
  }
  function refine(frame, t, box) {
    const W = frame.width,
      H = frame.height;
    const cx = (box.x + box.w / 2) * W,
      cy = (box.y + box.h / 2) * H,
      span = box.w * W;
    for (const scale of [1, 1.04, 0.96, 1.08, 0.92]) {
      const w = Math.round(span * scale),
        h = Math.max(1, Math.round(w / t.aspect));
      const offsets = t.points.map(
        (p) => 4 * (Math.floor(p.y * h) * W + Math.floor(p.x * w)),
      );
      for (const dy of [0, -0.022, 0.022, -0.045, 0.045])
        for (const dx of [0, -0.022, 0.022, -0.045, 0.045]) {
          const x = Math.round(cx - w / 2 + dx * w),
            y = Math.round(cy - h / 2 + dy * h);
          if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
          const score = scoreAt(frame.data, 4 * (y * W + x), offsets, t);
          if (score > box.score)
            Object.assign(box, {
              x: x / W,
              y: y / H,
              w: w / W,
              h: h / H,
              score,
            });
        }
    }
    return box;
  }
  function validAnchor(a) {
    return a && [a.x,a.y,a.w,a.h].every(Number.isFinite) && a.x>=0 && a.y>=0 &&
      a.w>=.05 && a.h>=.05 && a.x+a.w<=1.00001 && a.y+a.h<=1.00001;
  }
  function samplePanel(frame,left,top,width,height,cells) {
    for(let y=0;y<side;y++) for(let x=0;x<side;x++) {
      let r=0,g=0,b=0;
      for(let j=0;j<3;j++) for(let k=0;k<3;k++) {
        const px=Math.max(0,Math.min(frame.width-1,Math.floor(left+(x+(k+.5)/3)*width/side)));
        const py=Math.max(0,Math.min(frame.height-1,Math.floor(top+(y+(j+.5)/3)*height/side)));
        const i=4*(py*frame.width+px);
        r+=frame.data[i];g+=frame.data[i+1];b+=frame.data[i+2];
      }
      const i=(y*side+x)*4;
      cells[i]=r/9;cells[i+1]=g/9;cells[i+2]=b/9;
    }
  }
  // Recheck the artwork where it was seen if gameplay colours have joined
  // its outline. Holding a location still requires the interior to match.
  function confirmPanel(frame,phases,probe,threshold) {
    const x=probe.x*frame.width,y=probe.y*frame.height,w=probe.w*frame.width,h=probe.h*frame.height;
    const candidates=phases.filter(t=>Math.abs(Math.log(w/h/t.aspect))<=.30);
    const cells=new Uint8ClampedArray(side*side*4);
    for(const dy of [0,-1,1]) {
      samplePanel(frame,x,y+dy,w,h,cells);
      if(candidates.some(t=>scoreAt(cells,0,t.offsets,t)>=threshold)) return true;
    }
    return false;
  }
  // The pink card has a straight upper edge even when nearby particles of the
  // same colours merge with it. Use the edge only to propose a texture check.
  function pinkCards(frame,rows,W,H,step,phases,threshold,found) {
    const cells=new Uint8ClampedArray(side*side*4);
    for(let y=0;y<H;y++) for(let x=0;x<W;) {
      if(!rows[y*W+x]) {x++;continue;}
      const start=x;
      while(x<W && rows[y*W+x]) x++;
      const run=x-start;
      if(run<12) continue;
      const mid=start+(run>>1);
      if(y && rows[(y-1)*W+start] && rows[(y-1)*W+mid] && rows[(y-1)*W+x-1]) continue;
      const left=start*step,width=run*step;
      const candidate={x:left/frame.width,y:y*step/frame.height,w:width/frame.width,h:width/2.8/frame.height};
      if(found.some(b=>overlap(b,candidate)>.7)) continue;
      for(const phase of phases) {
        const height=width/phase.aspect;
        let matched=false;
        for(const dy of [0,-step]) {
          const top=y*step+dy;
          if(top<0 || top+height>frame.height) continue;
          samplePanel(frame,left,top,width,height,cells);
          const score=scoreAt(cells,0,phase.offsets,phase);
          if(score<threshold) continue;
          const probe={...candidate,y:top/frame.height,h:height/frame.height};
          found.push({...probe,probe,score});
          matched=true;
          break;
        }
        if(matched) break;
      }
    }
  }
  // Colour proposes rectangles; the artwork inside must match a registered phase.
  function colourPanels(frame, phases, threshold, colour) {
    const step=2, W=Math.ceil(frame.width/step), H=Math.ceil(frame.height/step);
    const mask=new Uint8Array(W*H), queue=new Int32Array(W*H);
    const pinkGold=colour==="pink-gold";
    const rows=pinkGold ? new Uint8Array(W*H) : null;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
      const i=4*step*(y*frame.width+x), d=frame.data;
      const r=d[i],g=d[i+1],b=d[i+2];
      const pink=pinkGold && r>134 && b>88 && r-g>19 && b-g>5 && Math.abs(r-b)<110;
      if(pink) rows[y*W+x]=1;
      const matches=pinkGold ? (r>155 && g>130 && g-b>54 && r-b>65) || pink :
        colour === "red" ? d[i]>130 && d[i]>1.5*d[i+1] && d[i]>1.3*d[i+2] && d[i+1]<150 :
        d[i]>177 && d[i+1]>168 && Math.abs(d[i]-d[i+1])<65 && d[i+1]-d[i+2]>73;
      if(matches)
        mask[y*W+x]=1;
    }
    const found=[];
    for(let seed=0;seed<mask.length;seed++) {
      if(!mask[seed]) continue;
      let head=0, tail=1, left=W, right=0, top=H, bottom=0;
      queue[0]=seed;mask[seed]=0;
      function visit(i) { if(mask[i]) {mask[i]=0;queue[tail++]=i;} }
      while(head<tail) {
        const i=queue[head++], x=i%W, y=Math.floor(i/W);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        if(x) visit(i-1);
        if(x+1<W) visit(i+1);
        if(y) visit(i-W);
        if(y+1<H) visit(i+W);
        if(pinkGold) {
          if(x>1) visit(i-2);
          if(x+2<W) visit(i+2);
          if(y>1) visit(i-2*W);
          if(y+2<H) visit(i+2*W);
        }
      }
      const w=Math.min(frame.width-left*step,(right-left+1)*step);
      const h=Math.min(frame.height-top*step,(bottom-top+1)*step);
      if(w<12 || h<8 || tail*step*step<w*h*(pinkGold ? .19 : .24)) continue;
      const compatible=phases.filter(t=>Math.abs(Math.log(w/h/t.aspect))<=.30);
      if(!compatible.length) continue;
      const cells=new Uint8ClampedArray(side*side*4);
      let best=null,score=-Infinity;
      function compare(dx,dy,height) {
        samplePanel(frame,left*step+dx,top*step+dy+(h-height)/2,w,height,cells);
        for(const t of compatible) {
          const value=scoreAt(cells,0,t.offsets,t);
          if(value>score) {score=value;best=t;}
        }
      }
      compare(0,0,h);
      for(const dx of [0,-1,1]) {
        if(score>=threshold || (pinkGold && score<threshold-10)) break;
        for(const dy of [0,-1,1]) compare(dx,dy,pinkGold ? h : w/compatible[0].aspect);
      }
      if(score>=threshold) {
        // Both shapes share a centre. Keep the full slot even on the square BB card.
        const compact=colour === "yellow" && best.aspect<1.4;
        const width=compact ? w*2.94 : w;
        const height=compact ? h*.86 : h;
        const x=Math.max(0,(left*step+(w-width)/2)/frame.width);
        const y=Math.max(0,(top*step+(h-height)/2)/frame.height);
        const box={x,y,w:Math.min(1,(left*step+(w+width)/2)/frame.width)-x,
          h:Math.min(1,(top*step+(h+height)/2)/frame.height)-y};
        const hit={...bannerBox(box,best.anchor),score};
        if(pinkGold) hit.probe={x:left*step/frame.width,y:top*step/frame.height,w:w/frame.width,h:h/frame.height};
        found.push(hit);
      }
    }
    if(rows) pinkCards(frame,rows,W,H,step,phases.filter(t=>t.pinkTop),threshold,found);
    return found;
  }
  function prepareRule(rule) {
    const pattern=prepare(rule.template);
    if(pattern && Array.isArray(rule.layouts)) {
      pattern.layouts=rule.layouts.filter(l=>validAnchor(l.anchor))
        .map(l=>({anchor:l.anchor,template:prepare(l.template)})).filter(l=>l.template);
    }
    if(pattern && rule.panelPhases) {
      pattern.panelColour=rule.panelColour || "yellow";
      pattern.panelPhases=[rule.template,...rule.panelPhases].map(phase=>{
        const t=prepare(phase);
        if(t) t.pinkTop=phase.pinkTop===true;
        if(t && validAnchor(phase.anchor)) t.anchor=phase.anchor;
        return t;
      }).filter(Boolean);
      for(const t of pattern.panelPhases) t.offsets=t.points.map(p=>4*(Math.floor(p.y*side)*side+Math.floor(p.x*side)));
    }
    return pattern;
  }
  function panelStillVisible(frame,box) {
    // Only called at a previously identified slot. Both the wide wordmark
    // and its compact phase have contrasting yellow and black in the centre.
    let yellow=0, dark=0, edges=0;
    for(let row=0;row<8;row++) {
      let previous=0;
      for(let col=0;col<16;col++) {
        const x=Math.min(frame.width-1,Math.floor((box.x+box.w*(.37+(col+.5)*.26/16))*frame.width));
        const y=Math.min(frame.height-1,Math.floor((box.y+box.h*(.18+(row+.5)*.64/8))*frame.height));
        const i=4*(y*frame.width+x),d=frame.data;
        const bright=d[i]>155 && d[i+1]>145 && Math.abs(d[i]-d[i+1])<70 && d[i+1]-d[i+2]>60;
        const black=Math.max(d[i],d[i+1],d[i+2])<105;
        yellow+=bright;dark+=black;
        const value=bright ? 1 : black ? -1 : 0;
        if(value*previous===-1) edges++;
        previous=value;
      }
    }
    return yellow>=20 && dark>=12 && yellow+dark>=79 && edges>=7;
  }
  function bannerBox(hit, anchor) {
    if (!anchor) return hit;
    const width = hit.w/anchor.w, height = hit.h/anchor.h;
    const left = hit.x-anchor.x*width, top = hit.y-anchor.y*height;
    const x = Math.max(0,left), y = Math.max(0,top);
    return {x,y,w:Math.min(1,left+width)-x,h:Math.min(1,top+height)-y};
  }
  // This slate moves the BB emblem from the left to the centre. Score the
  // surrounding wordmark and frame before extending the mask in either direction.
  function displayBox(frame, hit, rule, threshold) {
    if(!rule.pattern.layouts?.length) {
      const {x,y,w,h}=bannerBox(hit,rule.anchor);
      return {x,y,w,h};
    }
    let best=null;
    for(const layout of rule.pattern.layouts) {
      const box=refine(frame,layout.template,{...bannerBox(hit,layout.anchor),score:0});
      const required=hit.score>=threshold ? threshold-8 : threshold;
      if(hit.score>=threshold-6 && box.score>=required && (!best || box.score>best.score)) best=box;
    }
    return best;
  }
  // After identification, follow the coloured artwork through text changes.
  // Only saturated cells vote; dark footage and grey interface panels cannot prolong a match.
  function colours(frame, box) {
    const samples=[];
    for (let y=0; y<6; y++) for (let x=0; x<12; x++) {
      const ix=Math.min(frame.width-1, Math.floor((box.x+(x+.5)/12*box.w)*frame.width));
      const iy=Math.min(frame.height-1, Math.floor((box.y+(y+.5)/6*box.h)*frame.height));
      const i=4*(iy*frame.width+ix), [r,g,b]=frame.data.subarray(i,i+3);
      samples.push(Math.max(r,g,b)-Math.min(r,g,b)>65 ? [r,g,b] : null);
    }
    return samples;
  }
  function sameColours(a,b) {
    let same=0, count=0;
    for(let i=0;i<a.length;i++) {
      if(!a[i]) continue;
      count++;
      if(b[i] && a[i].reduce((d,v,c)=>d+Math.abs(v-b[i][c]),0)<115) same++;
    }
    return same>=18 && same>=count*.60;
  }
  return { template, valid, prepare, prepareRule, pyramid, locate, refine, overlap, validAnchor, bannerBox, displayBox, colours, sameColours, panelStillVisible, confirmPanel };
})();
