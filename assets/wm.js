/* wm.js — WorkMate first-party analytics tracker v0.1
 * Spec: website-analytics-design.md
 * - Sends only to same-origin /e (no third parties)
 * - Cookieless until analytics consent; then anonymous_id cookie (13 months)
 * - Never reads form field values
 * - Batches events, flushes via sendBeacon on page hide
 */
(function () {
  "use strict";
  var ENDPOINT = "/e";
  var CONSENT_KEY = "wm_consent";          // "granted" | "denied"
  var AID_COOKIE = "wm_aid";
  var SESSION_KEY = "wm_sid";
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var queue = [];
  var flushTimer = null;

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, value, days) {
    var exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + exp + "; path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  }

  /* ── consent ─────────────────────────────────── */
  function privacySignal() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  }
  function consentState() {
    if (privacySignal()) return "gpc";
    var v = null;
    try { v = localStorage.getItem(CONSENT_KEY); } catch (e) {}
    return v === "granted" || v === "denied" ? v : "unset";
  }
  function hasConsent() { return consentState() === "granted"; }

  /* ── identity ────────────────────────────────── */
  // Consented: persistent random id. Not consented: null; the server derives a
  // daily-rotating cookieless hash and never stores the IP.
  function anonymousId() {
    if (!hasConsent()) return null;
    var id = readCookie(AID_COOKIE);
    if (!id) { id = uuid(); writeCookie(AID_COOKIE, id, 395); }
    return id;
  }
  function sessionId() {
    var now = Date.now(), s = null;
    try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    var utm = utmParams();
    var newCampaign = utm.campaign && s && s.campaign !== utm.campaign;
    if (!s || now - s.last > SESSION_IDLE_MS || newCampaign) {
      s = { id: uuid(), last: now, campaign: utm.campaign || (s && s.campaign) || null };
    }
    s.last = now;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
    return s.id;
  }

  /* ── context ─────────────────────────────────── */
  function utmParams() {
    var p = new URLSearchParams(location.search), o = {};
    ["source", "medium", "campaign", "term", "content"].forEach(function (k) {
      var v = p.get("utm_" + k);
      if (v) o[k] = v.slice(0, 100);
    });
    return o;
  }
  function referrerHost() {
    try {
      if (!document.referrer) return null;
      var h = new URL(document.referrer).hostname;
      return h === location.hostname ? null : h;
    } catch (e) { return null; }
  }
  function experiments() {
    var raw = document.documentElement.getAttribute("data-experiments");
    if (!raw) return [];
    return raw.split(",").filter(Boolean).map(function (pair) {
      var kv = pair.split(":"); return { id: kv[0], variant: kv[1] };
    });
  }

  /* ── send ────────────────────────────────────── */
  function track(name, props) {
    queue.push({
      event_id: uuid(),
      event_name: name,
      ts: new Date().toISOString(),
      anonymous_id: anonymousId(),
      session_id: sessionId(),
      page_path: location.pathname,
      page_title: document.title.slice(0, 120),
      referrer_host: referrerHost(),
      utm: utmParams(),
      viewport_w: window.innerWidth,
      locale: navigator.language,
      consent_state: consentState(),
      experiments: experiments(),
      props: props || {}
    });
    if (queue.length >= 10) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 2000);
  }
  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!queue.length) return;
    var body = JSON.stringify({ events: queue.splice(0, queue.length) });
    var sent = false;
    if (navigator.sendBeacon) {
      try { sent = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" })); } catch (e) {}
    }
    if (!sent) {
      fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" }, credentials: "same-origin" }).catch(function () {});
    }
  }

  /* ── automatic events ────────────────────────── */
  var pageStart = performance.now(), maxScroll = 0, scrollMarks = { 25: 0, 50: 0, 75: 0, 100: 0 };
  function onScroll() {
    var h = document.documentElement;
    var pct = Math.min(100, Math.round(((h.scrollTop + innerHeight) / h.scrollHeight) * 100));
    if (pct > maxScroll) maxScroll = pct;
    [25, 50, 75, 100].forEach(function (m) {
      if (pct >= m && !scrollMarks[m]) { scrollMarks[m] = 1; track("scroll_depth", { pct: m }); }
    });
  }
  function watchSections() {
    if (!("IntersectionObserver" in window)) return;
    var seen = {}, timers = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.getAttribute("data-section");
        if (seen[id]) return;
        if (en.isIntersecting) {
          timers[id] = setTimeout(function () { seen[id] = 1; track("section_view", { section_id: id }); io.unobserve(en.target); }, 1000);
        } else clearTimeout(timers[id]);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll("[data-section]").forEach(function (el) { io.observe(el); });
  }
  function watchClicks() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-track]");
      if (el) {
        var props = {};
        Array.prototype.forEach.call(el.attributes, function (a) {
          if (a.name.indexOf("data-track-") === 0) props[a.name.slice(11).replace(/-/g, "_")] = a.value.slice(0, 80);
        });
        track(el.getAttribute("data-track"), props);
      }
      var a = e.target.closest("a[href^='http']");
      if (a && a.hostname !== location.hostname) track("outbound_click", { href_host: a.hostname });
    }, { capture: true });
  }
  function webVitals() {
    if (!("PerformanceObserver" in window)) return;
    try {
      new PerformanceObserver(function (l) {
        var last = l.getEntries().pop();
        if (last) vitals.lcp = Math.round(last.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(function (l) {
        l.getEntries().forEach(function (en) { if (!en.hadRecentInput) vitals.cls += en.value; });
      }).observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
  }
  var vitals = { lcp: null, cls: 0 }, left = false;
  // Fires once per page view: first of tab-hidden or pagehide.
  function leave() {
    if (left) return;
    left = true;
    track("page_leave", { time_on_page_ms: Math.round(performance.now() - pageStart), max_scroll_pct: maxScroll });
    if (vitals.lcp !== null) track("web_vitals", { metric: "LCP", value: vitals.lcp });
    track("web_vitals", { metric: "CLS", value: Math.round(vitals.cls * 1000) / 1000 });
    flush();
  }

  /* ── public API ──────────────────────────────── */
  window.wm = {
    track: track,
    flush: flush,
    consent: function (granted) {
      try { localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied"); } catch (e) {}
      if (!granted) writeCookie(AID_COOKIE, "", -1);
      track("consent_update", { state: granted ? "granted" : "denied" });
    },
    consentState: consentState
  };

  track("page_view", { load_ms: Math.round(performance.now()) });
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") leave(); });
  addEventListener("pagehide", leave);
  watchSections(); watchClicks(); webVitals();
})();
