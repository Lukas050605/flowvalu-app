/* CAR CARE VALU — Valu Run */
(function () {
  var W = 900, H = 300, G = 246;
  var cv = document.getElementById("ccv-canvas"), ctx = cv.getContext("2d"), dpr = 1;
  var el = {
    km: document.getElementById("ccv-km"), ort: document.getElementById("ccv-ort"),
    best: document.getElementById("ccv-best"), spd: document.getElementById("ccv-spd"),
    combo: document.getElementById("ccv-combo"), rab: document.getElementById("ccv-rab"),
    rab2: document.getElementById("ccv-rab2"), sub: document.getElementById("ccv-sub"),
    stamp: document.getElementById("ccv-stamp"), next: document.getElementById("ccv-next"),
    save: document.getElementById("ccv-save"), push: document.getElementById("ccv-push"),
    title: document.getElementById("ccv-title"), hint: document.getElementById("ccv-hint"),
    overlay: document.getElementById("ccv-overlay"), result: document.getElementById("ccv-result"),
    actions: document.getElementById("ccv-actions"), kept: document.getElementById("ccv-kept"),
    note: document.getElementById("ccv-note"), revive: document.getElementById("ccv-revive"),
    keep: document.getElementById("ccv-keep"), reset: document.getElementById("ccv-reset"),
    stage: document.getElementById("ccv-stage")
  };

  var ORTE = [
    [0,"Limeshain"],[8,"Altenstadt"],[13,"Büdingen"],[18,"Nidderau"],[22,"Langenselbold"],
    [24,"Friedberg"],[26,"Gelnhausen"],[28,"Hanau"],[30,"Bad Nauheim"],[32,"Maintal"],
    [38,"Offenbach"],[42,"Frankfurt"],[46,"Gießen"],[52,"Aschaffenburg"],[62,"Darmstadt"],
    [70,"Wiesbaden"],[78,"Fulda"],[110,"Würzburg"]
  ];

  var phase = "ready", best = 0, revives = 0, van, obs, items, parts, pops, clouds, dashes;
  var dist, bonus, spd, nextGap, nextItem, combo, shake, lastOrt, bestFlag, jumpBuf;

  try { best = Number(localStorage.getItem("ccv_valurun_best") || 0) || 0; } catch (e) {}

  var lost = false, FREI_REVIVES = 2;
  function de(n, d) { return n.toFixed(d).replace(".", ","); }
  function rabatt(km) { return lost ? 0 : Math.min(8, Math.round((km / 30) * 10) / 10); }
  function kmNow() { return Math.max(0, (dist + bonus) / 100); }

  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.aspectRatio = W + " / " + H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function reset() {
    van = { x: 110, y: G, vy: 0, w: 64, h: 44, onGround: true, wob: 0 };
    obs = []; items = []; parts = []; pops = [];
    clouds = [{x:300,y:60,s:1},{x:620,y:96,s:.7},{x:840,y:48,s:1.2}];
    dashes = []; for (var i = 0; i < 14; i++) dashes.push({ x: i * 80 });
    dist = 0; bonus = 0; spd = 6.4; nextGap = 240; nextItem = 420;
    combo = 0; shake = 0; lastOrt = 0; bestFlag = false; jumpBuf = 0; revives = 0; lost = false;
    phase = "ready"; sync();
  }

  function press() {
    if (phase === "ready") { phase = "run"; sync(); return; }
    if (phase === "over") return;
    if (phase === "kept") { reset(); phase = "run"; sync(); return; }
    if (van.onGround) { van.vy = -12.6; van.onGround = false; jumpBuf = 0; }
    else jumpBuf = 10;
  }

  function pop(t, c) { pops.push({ t: t, c: c, life: 60, y: 0 }); }
  function burst(x, y, c, n) {
    for (var i = 0; i < n; i++) parts.push({
      x: x, y: y, vx: (Math.random() - .5) * 4.4, vy: -Math.random() * 3.6 - .6,
      life: 22 + Math.random() * 14, c: c
    });
  }

  function spawnObs() {
    var pool = dist > 2200 ? ["kegel","kanister","doppel","doppel","dreier","gegen","gegen"]
      : dist > 900 ? ["eimer","kegel","kanister","doppel","doppel","gegen"]
      : dist > 350 ? ["eimer","kegel","kanister","doppel"]
      : ["eimer","kegel","kanister"];
    var k = pool[Math.floor(Math.random() * pool.length)];
    var w = 26, h = 34;
    if (k === "kegel") { w = 28; h = 32; }
    if (k === "kanister") { w = 30; h = 40; }
    if (k === "doppel") { w = 58; h = 34; }
    if (k === "dreier") { w = 88; h = 34; }
    if (k === "gegen") { w = 62; h = 40; }
    obs.push({ x: W + 40, w: w, h: h, k: k, passed: false });
  }

  function gameOver() {
    shake = 12; burst(van.x + van.w / 2, van.y - 20, "#7d5d24", 24);
    var sc = Math.floor(dist + bonus);
    if (sc > best) { best = sc; try { localStorage.setItem("ccv_valurun_best", String(best)); } catch (e) {} }
    phase = "over"; sync();
  }

  function revive() {
    revives += 1;
    if (revives > FREI_REVIVES) lost = true;
    obs = obs.filter(function (o) { return o.x > W * .75; });
    items = []; nextGap = Math.max(320, spd * 50); nextItem = 380; combo = 0;
    van.y = G; van.vy = 0; van.onGround = true;
    pop("WEITER SO", "#7d5d24"); phase = "run"; sync();
  }

  function keep() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, "0"); };
    el.stamp.textContent = z(d.getDate()) + "." + z(d.getMonth() + 1) + "." + d.getFullYear() +
      " · " + z(d.getHours()) + ":" + z(d.getMinutes()) + " Uhr";
    phase = "kept"; sync();
  }

  function step(f) {
    var running = phase === "run", drift = running ? spd * f : 1.6 * f;
    clouds.forEach(function (c) {
      c.x -= drift * .18 * c.s;
      if (c.x < -70) { c.x = W + 60; c.y = 34 + Math.random() * 90; c.s = .6 + Math.random() * .7; }
    });
    dashes.forEach(function (d) { d.x -= drift; if (d.x < -60) d.x += 1120; });
    if (!running) { van.wob += f * .18; return; }

    van.wob += f * .4; van.vy += .72 * f; van.y += van.vy * f;
    if (van.y >= G) {
      van.y = G; van.vy = 0; van.onGround = true;
      if (jumpBuf > 0) { jumpBuf = 0; van.vy = -12.6; van.onGround = false; }
    }
    if (jumpBuf > 0) jumpBuf -= f;

    dist += spd * f * .42;
    spd = Math.min(24, 6.6 + Math.floor(dist / 320) * .78);
    if (shake > 0) shake -= f * .9;

    for (var i = parts.length - 1; i >= 0; i--) {
      var pt = parts[i];
      pt.x += pt.vx * f - spd * f * .35; pt.y += pt.vy * f; pt.vy += .22 * f; pt.life -= f;
      if (pt.life <= 0) parts.splice(i, 1);
    }
    for (var j = pops.length - 1; j >= 0; j--) {
      pops[j].life -= f; pops[j].y += f * .5;
      if (pops[j].life <= 0) pops.splice(j, 1);
    }

    var km = kmNow();
    for (var o2 = lastOrt + 1; o2 < ORTE.length; o2++) {
      if (km >= ORTE[o2][0]) {
        lastOrt = o2; pop(ORTE[o2][1].toUpperCase() + " ERREICHT", "#7d5d24");
        burst(van.x + 40, G - 40, "#cdb48a", 14);
      } else break;
    }
    if (!bestFlag && best > 0 && dist + bonus > best) {
      bestFlag = true; pop("REKORD GEBROCHEN", "#1b1712");
      burst(van.x + 40, G - 50, "#7d5d24", 22); shake = 6;
    }

    nextGap -= spd * f;
    if (nextGap <= 0) {
      spawnObs();
      var tight = Math.max(31, 44 - dist / 420);
      var vary = Math.max(4, 22 - dist / 320);
      nextGap = Math.max(210, spd * tight) + Math.random() * spd * vary;
      if (obs.length && obs[obs.length - 1].k === "gegen") nextGap *= 1.5;
    }
    nextItem -= spd * f;
    if (nextItem <= 0) {
      items.push({ x: W + 60, y: Math.random() < .55 ? G - 92 : G - 44, t: 0 });
      nextItem = 340 + Math.random() * 420;
    }

    var cx = van.x + van.w / 2, cy = van.y - van.h / 2;
    for (var k2 = items.length - 1; k2 >= 0; k2--) {
      var it = items[k2];
      it.x -= spd * f; it.t += f * .14;
      if (it.x < -30) { items.splice(k2, 1); continue; }
      var dx = it.x - cx, dy = it.y - cy;
      if (dx * dx + dy * dy < 1369) {
        items.splice(k2, 1); combo += 1;
        var gain = 25 * Math.min(5, 1 + Math.floor(combo / 4));
        bonus += gain; burst(it.x, it.y, "#cdb48a", 16);
        pop("+" + de(gain / 100, 1) + " km", "#7d5d24"); shake = 4;
      }
    }

    var vl = van.x + 8, vr = van.x + van.w - 6, vt = van.y - van.h + 6, vb = van.y - 2;
    for (var m = obs.length - 1; m >= 0; m--) {
      var ob = obs[m];
      ob.x -= spd * f * (ob.k === "gegen" ? 1.75 : 1);
      if (ob.x + ob.w < -20) { obs.splice(m, 1); continue; }
      var ol = ob.x + 3, or_ = ob.x + ob.w - 3, ot = G - ob.h + 3;
      if (vr > ol && vl < or_ && vb > ot && vt < G) { gameOver(); return; }
      if (!ob.passed && or_ < vl) {
        ob.passed = true; combo += 1;
        if (vb - ot < 16) {
          bonus += 20; pop("KNAPP! +0,2 km", "#b4732a");
          burst(ob.x + ob.w / 2, G - ob.h, "#b4732a", 10);
        }
      }
    }
    sync();
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f6f2ea"; ctx.fillRect(0, 0, W, H);
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

    ctx.fillStyle = "#e5dccb";
    clouds.forEach(function (c) {
      rr(c.x, c.y, 54 * c.s, 13 * c.s, 7 * c.s); ctx.fill();
      rr(c.x + 14 * c.s, c.y - 9 * c.s, 30 * c.s, 13 * c.s, 7 * c.s); ctx.fill();
    });

    ctx.strokeStyle = "rgba(27,23,18,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, G + 2); ctx.lineTo(W, G + 2); ctx.stroke();
    ctx.fillStyle = "rgba(27,23,18,0.22)";
    dashes.forEach(function (d) { ctx.fillRect(d.x, G + 12, 34, 3); });

    items.forEach(function (it) {
      var fl = Math.sin(it.t) * 3;
      ctx.fillStyle = "#cdb48a"; rr(it.x - 7, it.y - 12 + fl, 14, 22, 4); ctx.fill();
      ctx.fillStyle = "#7d5d24"; ctx.fillRect(it.x - 3, it.y - 17 + fl, 6, 6);
      ctx.strokeStyle = "rgba(125,93,36,0.32)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(it.x, it.y + fl, 17, 0, 6.2832); ctx.stroke();
    });

    obs.forEach(function (o) {
      if (o.k === "eimer" || o.k === "doppel" || o.k === "dreier") {
        ctx.fillStyle = "#7d5d24";
        var n = o.k === "dreier" ? 3 : o.k === "doppel" ? 2 : 1;
        for (var i = 0; i < n; i++) {
          var bx = o.x + i * 31, bw = o.k === "eimer" ? o.w : 26;
          ctx.beginPath();
          ctx.moveTo(bx + 3, G - o.h); ctx.lineTo(bx + bw - 3, G - o.h);
          ctx.lineTo(bx + bw - 7, G); ctx.lineTo(bx + 7, G);
          ctx.closePath(); ctx.fill();
        }
      } else if (o.k === "gegen") {
        var gy = G - o.h;
        ctx.fillStyle = "#3a3227";
        rr(o.x, gy, o.w, o.h - 8, 6); ctx.fill();
        ctx.fillStyle = "#8d826d";
        rr(o.x + 8, gy + 5, 20, 11, 3); ctx.fill();
        ctx.fillStyle = "#e8d9a8";
        rr(o.x - 3, gy + o.h - 20, 7, 7, 2); ctx.fill();
        ctx.fillStyle = "#1b1712";
        ctx.beginPath(); ctx.arc(o.x + 14, G - 4, 6, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(o.x + o.w - 14, G - 4, 6, 0, 6.2832); ctx.fill();
      } else if (o.k === "kegel") {
        ctx.fillStyle = "#b4732a";
        ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, G - o.h);
        ctx.lineTo(o.x + o.w, G); ctx.lineTo(o.x, G); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#f6f2ea"; ctx.fillRect(o.x + 5, G - o.h * .55, o.w - 10, 5);
      } else {
        ctx.fillStyle = "#5f5648"; rr(o.x, G - o.h, o.w, o.h, 5); ctx.fill();
        ctx.fillStyle = "#cdb48a"; ctx.fillRect(o.x + 6, G - o.h + 7, o.w - 12, 7);
      }
    });

    var x = van.x, y = van.y, w = van.w, h = van.h;
    var bob = van.onGround ? Math.sin(van.wob) * .9 : 0;
    ctx.fillStyle = "rgba(27,23,18,0.14)";
    ctx.beginPath(); ctx.ellipse(x + w / 2, G + 8, w * .42, 5, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#1b1712"; rr(x, y - h + bob, w, h - 8, 7); ctx.fill();
    ctx.fillStyle = "#cdb48a"; rr(x + 34, y - h + 7 + bob, 26, 14, 4); ctx.fill();
    ctx.fillStyle = "#f6f2ea"; ctx.font = "700 8px monospace";
    ctx.fillText("VALU", x + 7, y - h + 19 + bob);
    ctx.fillStyle = "#453e30"; rr(x + 6, y - 20 + bob, 52, 7, 3); ctx.fill();

    var spin = phase === "run" ? dist * .6 : van.wob;
    [x + 16, x + w - 16].forEach(function (wx) {
      ctx.fillStyle = "#1b1712"; ctx.beginPath(); ctx.arc(wx, y - 3, 8, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#cdb48a"; ctx.beginPath(); ctx.arc(wx, y - 3, 3.4, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = "rgba(246,242,234,0.7)"; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(spin) * 3, y - 3 + Math.sin(spin) * 3);
      ctx.lineTo(wx + Math.cos(spin) * 8, y - 3 + Math.sin(spin) * 8);
      ctx.stroke();
    });

    parts.forEach(function (pt) {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / 22));
      ctx.fillStyle = pt.c; ctx.fillRect(pt.x, pt.y, 3.4, 3.4); ctx.globalAlpha = 1;
    });

    if (combo >= 4) {
      ctx.fillStyle = "rgba(125,93,36,0.92)"; ctx.font = "700 20px Archivo,Arial,sans-serif";
      ctx.fillText("×" + Math.min(5, 1 + Math.floor(combo / 4)), W - 74, 40);
      ctx.fillStyle = "rgba(88,80,63,0.75)"; ctx.font = "500 10px monospace";
      ctx.fillText("SERIE " + combo, W - 82, 56);
    }

    ctx.textAlign = "center";
    pops.forEach(function (po, i) {
      ctx.globalAlpha = Math.max(0, Math.min(1, po.life / 40));
      ctx.fillStyle = po.c; ctx.font = "700 17px Archivo,Arial,sans-serif";
      ctx.fillText(po.t, W / 2, 74 - po.y + i * 24);
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = "left";
  }

  function sync() {
    var km = kmNow(), r = rabatt(km), ort = ORTE[0], nx = null;
    for (var i = 0; i < ORTE.length; i++) {
      if (km >= ORTE[i][0]) ort = ORTE[i]; else { nx = ORTE[i]; break; }
    }
    el.km.textContent = de(km, 1) + " km";
    el.ort.textContent = ort[1];
    el.best.textContent = de(best / 100, 1) + " km";
    el.spd.textContent = de(spd / 6.4, 1) + "×";
    el.combo.textContent = combo >= 4 ? "×" + Math.min(5, 1 + Math.floor(combo / 4)) : "×1";
    el.rab.textContent = de(r, 1) + " %";
    var stufe = r >= 8 ? "MAXIMUM 8 %" : "NOCH " + de(Math.max(0.1, Math.min(8, Math.floor(r) + 1) * 30 - km), 1) + " KM BIS " + Math.min(8, Math.floor(r) + 1) + " %";
    el.next.textContent = "NÄCHSTER ORT: " + (nx ? nx[1] + " in " + de(Math.ceil((nx[0] - km) * 10) / 10, 1) + " km" : "Endstation erreicht") + " · " + stufe;

    el.overlay.classList.toggle("ccv-off", phase === "run");
    var done = phase === "over" || phase === "kept";
    el.result.hidden = !done;
    el.actions.hidden = phase !== "over";
    el.keep.textContent = lost ? "Neue Tour" : "Rabatt sichern";
    el.note.hidden = phase !== "over";
    el.kept.hidden = phase !== "kept";
    var frei = FREI_REVIVES - revives;
    el.revive.hidden = !(phase === "over" && !lost);
    el.revive.textContent = frei > 0 ? "Weiterfahren · " + frei + "× frei" : "Weiterfahren · Rabatt verfällt";
    el.note.textContent = frei > 0
      ? "Weiterfahren ist noch " + frei + "× frei. Danach verfällt dein Rabatt."
      : "Achtung: Beim nächsten Weiterfahren verfällt dein Rabatt komplett.";

    if (phase === "ready") {
      el.title.textContent = "Bereit für die Tour?";
      el.hint.textContent = "Leertaste oder Tippen startet den Transporter.";
    } else if (phase === "over") {
      el.title.textContent = lost ? "Rabatt verfallen" : "Ausgerollt";
      el.hint.textContent = lost
        ? "Du bist zu oft weitergefahren — der Rabatt ist weg. Neue Tour starten?"
        : "Rabatt sichern — oder weiterfahren, zweimal ist das kostenlos.";
    } else if (phase === "kept") {
      el.title.textContent = "Rabatt gesichert";
      el.hint.textContent = "Leertaste oder Tippen für eine neue Tour.";
    }
    if (done) {
      el.rab2.textContent = de(r, 1) + " %";
      el.sub.textContent = de(km, 1) + " km gefahren · bis " + ort[1];
      if (el.save) {
        el.save.textContent = r > 0
          ? "Das sind " + de(59 * r / 100, 2) + " € auf BASIS oder " + de(69 * r / 100, 2) + " € auf PREMIUM."
          : "";
      }
      if (el.push) {
        if (lost) el.push.textContent = "Rabatt verfallen — neue Tour starten.";
        else if (r >= 8) el.push.textContent = "Maximum erreicht: 8 % Rabatt.";
        else {
          var next = Math.min(8, Math.floor(r) + 1);
          el.push.textContent = "Nur noch " + de(Math.max(0.1, next * 30 - km), 1) + " km bis " + next + " % — das schaffst du.";
        }
        el.push.hidden = phase !== "over";
      }
    }
  }

  el.stage.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button, a")) return;
    e.preventDefault(); press();
  });
  el.keep.addEventListener("click", function (e) { e.stopPropagation(); if (lost) { reset(); phase = "run"; sync(); } else keep(); });
  el.revive.addEventListener("click", function (e) { e.stopPropagation(); revive(); });
  el.reset.addEventListener("click", function (e) { e.stopPropagation(); reset(); });

  var spiel = document.getElementById("ccv-game");
  var voll = document.getElementById("ccv-full");
  function vollAn(v) {
    spiel.classList.toggle("voll", v);
    voll.textContent = v ? "Schließen" : "Vollbild";
    document.body.style.overflow = v ? "hidden" : "";
    if (v && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("landscape").catch(function () {});
    } else if (!v && screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) {}
    }
    setTimeout(fit, 60);
    setTimeout(fit, 400);
  }
  if (voll) {
    voll.addEventListener("click", function (e) {
      e.stopPropagation();
      var an = !spiel.classList.contains("voll");
      if (an && spiel.requestFullscreen) spiel.requestFullscreen().catch(function () {});
      else if (!an && document.fullscreenElement) document.exitFullscreen().catch(function () {});
      vollAn(an);
    });
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && spiel.classList.contains("voll")) vollAn(false);
    });
  }
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && spiel.classList.contains("voll")) vollAn(false);
  });
  window.addEventListener("orientationchange", function () { setTimeout(fit, 250); });
  window.addEventListener("keydown", function (e) {
    if (e.code !== "Space" && e.code !== "ArrowUp") return;
    var vis = document.getElementById("ccv-game");
    if (!vis || !vis.offsetParent) return;
    e.preventDefault(); press();
  }, { passive: false });
  window.addEventListener("resize", fit);

  fit(); reset();
  var last = performance.now();
  (function loop(t) {
    var dt = Math.min(48, t - last); last = t;
    step(dt / 16.666); draw();
    requestAnimationFrame(loop);
  })(last);
})();
