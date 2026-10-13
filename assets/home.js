/* WorkMate homepage interactions. Analytics via window.wm (wm.js). */
(function () {
  "use strict";
  var track = function (n, p) { if (window.wm) window.wm.track(n, p); };

  var TEAMS = [
    { k: "exec", n: "CEO", c: "exec", on: "white", eyebrow: "For leadership", h: "The board deck that builds itself.",
      p: "A live scorecard built from real work, not stitched-together summaries.",
      pts: ["Revenue, cash, pipeline and delivery on one screen", "Risks and exceptions flagged before Monday", "An AI weekly brief with sources"],
      kpi: [["Q4 revenue", "$2.4M", 1], ["Pipeline", "$6.1M"]],
      lines: [["Northwind renewal", "Won · $48,000", "ok"], ["Design launch kit", "At risk · 2d late", "warn"]] },
    { k: "sales", n: "Sales", c: "sales", eyebrow: "For sales teams", h: "Sell with the full picture.",
      p: "See where the customer came from and what happens after they sign, before you promise anything.",
      pts: ["Pipeline with deal health", "Quotes with discount approval & e-signature", "Forecasts you can defend"],
      kpi: [["Deal value", "$48,000", 1], ["Health", "92%"]],
      lines: [["Source", "Q3 webinar campaign"], ["Open invoices", "2 overdue · $6,200", "warn"]] },
    { k: "marketing", n: "Marketing", c: "marketing", eyebrow: "For marketing teams", h: "Prove what marketing earns.",
      p: "Attribution from first touch to paid invoice, not just form fills.",
      pts: ["Campaigns with budgets and approvals", "Journeys, segments and scoring", "Attribution tied to real revenue"],
      kpi: [["Attributed revenue", "$48,000", 1], ["Campaign ROI", "4.1×"]],
      lines: [["First touch", "Q3 webinar"], ["Launch assets", "Ready to publish", "ok"]] },
    { k: "finance", n: "Finance", c: "finance", eyebrow: "For finance teams", h: "Finance that doesn't chase other teams.",
      p: "Invoices arrive pre-drafted from won deals. Approvals come with context. Every change is audited.",
      pts: ["Invoices, payments and reconciliation", "Budgets and threshold approvals", "Sync with your accounting system"],
      kpi: [["Invoice INV-2041", "$48,000", 1], ["Status", "Draft"]],
      lines: [["Terms", "Net 30 · from signed quote"], ["Overdue on account", "$6,200", "warn"]] },
    { k: "design", n: "Design", c: "design", on: "white", eyebrow: "For creative teams", h: "Get creative work out of chat.",
      p: "Structured intake, SLAs, versions and proofing, linked to the campaign or deal that asked for it.",
      pts: ["Request intake with priority rules", "Workload and capacity at a glance", "Versioned proofing and approvals"],
      kpi: [["Launch kit", "v3", 1], ["Due", "24 Oct"]],
      lines: [["Requested by", "Sales · Northwind renewal"], ["Review round", "Approved by marketing", "ok"]] },
    { k: "people", n: "People", c: "people", eyebrow: "For HR teams", h: "HR with walls where they matter.",
      p: "Hiring to exit, connected to the work. Salary, health and case data stay private.",
      pts: ["Recruiting, onboarding and offboarding", "Leave that updates project capacity", "Self-service My HR for everyone"],
      kpi: [["Account team", "6 people", 1], ["Capacity", "84%"]],
      lines: [["Lead designer", "On leave 21–25 Oct"], ["Reason", "Visible to HR only", "ok"]] },
    { k: "service", n: "Service", c: "service", eyebrow: "For support teams", h: "Every ticket knows the customer.",
      p: "Agents see the deal, contract and invoice history, so customers never repeat themselves.",
      pts: ["Tickets, routing and SLAs", "Knowledge base and customer health", "Client portal for quotes, invoices and requests"],
      kpi: [["Open tickets", "1", 1], ["CSAT", "4.8"]],
      lines: [["Onboarding ticket", "P2 · within SLA", "ok"], ["Plan", "Enterprise renewal"]] }
  ];
  var MODULES = [
    { k: "sales", n: "Sales", on: "ink", p: "Sell with the full picture.", chips: ["Pipeline", "Quotes", "Forecast", "Sequences"] },
    { k: "marketing", n: "Marketing", on: "ink", p: "Prove what marketing earns.", chips: ["Campaigns", "Journeys", "Attribution"] },
    { k: "finance", n: "Finance", on: "ink", p: "Stop chasing other teams.", chips: ["Invoices", "Payments", "Budgets"] },
    { k: "design", n: "Design", on: "white", p: "Creative work, out of chat.", chips: ["Intake", "SLAs", "Proofing"] },
    { k: "people", n: "People", on: "ink", p: "HR with walls where they matter.", chips: ["Hiring", "Leave", "My HR"] },
    { k: "exec", n: "Executive", on: "white", p: "The board deck that builds itself.", chips: ["Scorecard", "Goals", "Risks"] },
    { k: "service", n: "Service & Ops", on: "ink", p: "Every ticket knows the customer.", chips: ["Tickets", "Inventory", "Portals"] }
  ];
  var cssv = function (k, s) { return "var(--wm-" + k + (s ? "-" + s : "") + ")"; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ── experiment exposure (variant actually rendered) ── */
  var exps = (document.documentElement.getAttribute("data-experiments") || "").split(",");
  exps.forEach(function (pair) {
    var kv = pair.split(":");
    if (kv[0] === "hero_h1" && kv[1]) track("experiment_exposure", { experiment_id: "hero_h1", variant: kv[1] });
  });

  /* ── header ── */
  var header = document.getElementById("header");
  var onScroll = function () { header.classList.toggle("scrolled", window.scrollY > 8); };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  var menuBtn = document.getElementById("menu-btn"), mnav = document.getElementById("mobile-nav");
  function setMenu(open) {
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.querySelector(".sr-only").textContent = open ? "Close menu" : "Open menu";
    mnav.classList.toggle("open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }
  menuBtn.addEventListener("click", function () { setMenu(menuBtn.getAttribute("aria-expanded") !== "true"); });
  mnav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && mnav.classList.contains("open")) { setMenu(false); menuBtn.focus(); } });

  /* ── role switcher (ARIA tabs) ── */
  var tabs = document.getElementById("role-tabs"), panel = document.getElementById("role-panel");
  tabs.innerHTML = TEAMS.map(function (t, i) {
    return '<button class="role-tab" role="tab" type="button" id="tab-' + t.k + '" aria-controls="role-panel" aria-selected="' + (i === 0) +
      '" tabindex="' + (i === 0 ? 0 : -1) + '" style="--c:' + cssv(t.c) + ";--t:" + cssv(t.c, "tint") + ";--d:" + cssv(t.c, "deep") +
      '"><span class="sq"></span>' + esc(t.n) + "</button>";
  }).join("");
  function show(i, fromUser) {
    var t = TEAMS[i];
    Array.prototype.forEach.call(tabs.children, function (b, j) { b.setAttribute("aria-selected", String(j === i)); b.tabIndex = j === i ? 0 : -1; });
    panel.setAttribute("aria-labelledby", "tab-" + t.k);
    panel.style.setProperty("--t", cssv(t.c, "tint")); panel.style.setProperty("--d", cssv(t.c, "deep")); panel.style.setProperty("--c", cssv(t.c));
    panel.innerHTML =
      '<div><span class="eyebrow">' + esc(t.eyebrow) + "</span><h3>" + esc(t.h) + "</h3><p>" + esc(t.p) + "</p><ul>" +
      t.pts.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
      '</ul><a class="link" href="/product/' + (t.k === "exec" ? "executive" : t.k) + '">Explore ' + esc(t.n === "CEO" ? "Executive" : t.n) + " →</a></div>" +
      '<div class="mini-ui" aria-hidden="true"><div class="hd"><span class="av">NX</span><div><b>Northwind Labs</b><span>Same record · ' + esc(t.n) + " view</span></div></div>" +
      '<div class="kpi">' + t.kpi.map(function (k) { return '<div class="' + (k[2] ? "hi" : "") + '"><small>' + esc(k[0]) + "</small><strong>" + esc(k[1]) + "</strong></div>"; }).join("") + "</div>" +
      t.lines.map(function (l) { return '<div class="ln ' + (l[2] || "") + '"><span>' + esc(l[0]) + "</span><b>" + esc(l[1]) + "</b></div>"; }).join("") + "</div>";
    if (fromUser) track("role_tab_select", { role: t.k });
  }
  tabs.addEventListener("click", function (e) {
    var b = e.target.closest(".role-tab"); if (!b) return;
    show(Array.prototype.indexOf.call(tabs.children, b), true);
  });
  tabs.addEventListener("keydown", function (e) {
    var cur = Array.prototype.findIndex.call(tabs.children, function (t) { return t.getAttribute("aria-selected") === "true"; });
    var n = null, L = TEAMS.length;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (cur + 1) % L;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (cur - 1 + L) % L;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = L - 1;
    if (n !== null) { e.preventDefault(); show(n, true); tabs.children[n].focus(); }
  });
  show(0, false);

  /* ── module grid ── */
  document.getElementById("modules").innerHTML = MODULES.map(function (m) {
    return '<a class="mod ' + (m.on === "white" ? "dark" : "") + '" href="/product/' + (m.k === "exec" ? "executive" : m.k) +
      '" data-track="module_card_click" data-track-module="' + m.k + '" style="--c:' + cssv(m.k) + ";--on:" + (m.on === "white" ? "#fff" : "var(--wm-ink)") +
      '"><span class="ic" aria-hidden="true"><svg><use href="#i-' + m.k + '"/></svg></span><h3>' + esc(m.n) + "</h3><p>" + esc(m.p) +
      '</p><span class="chips">' + m.chips.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</span></a>";
  }).join("") +
    '<a class="mod found" href="/product" data-track="module_card_click" data-track-module="foundation"><span class="ic" aria-hidden="true"><svg><use href="#i-plus"/></svg></span><h3>Foundation</h3><p>Automations, approvals and reports across every team.</p><span class="chips"><span>Automations</span><span>Approvals</span><span>Reports</span></span></a>';

  /* ── pricing toggle ── */
  var toggle = document.querySelector(".toggle");
  toggle.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-billing]"); if (!b) return;
    var billing = b.getAttribute("data-billing");
    toggle.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    document.querySelectorAll("[data-price-annual]").forEach(function (el) { el.textContent = "$" + el.getAttribute("data-price-" + billing); });
    track("pricing_toggle", { billing: billing, currency: "USD" });
  });

  /* ── scroll reveal ── */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el, i) { el.style.transitionDelay = (i % 4) * 60 + "ms"; io.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add("in"); });

  /* ── consent ── */
  var banner = document.getElementById("consent");
  function openConsent() { banner.hidden = false; }
  if (window.wm && window.wm.consentState() === "unset") openConsent();
  document.getElementById("consent-yes").addEventListener("click", function () { window.wm && window.wm.consent(true); banner.hidden = true; });
  document.getElementById("consent-no").addEventListener("click", function () { window.wm && window.wm.consent(false); banner.hidden = true; });
  document.getElementById("cookie-settings").addEventListener("click", function (e) { e.preventDefault(); openConsent(); document.getElementById("consent-yes").focus(); });

  /* ── demo form ── */
  var form = document.getElementById("demo-form"), msg = document.getElementById("form-msg"), submit = document.getElementById("d-submit");
  var started = false, completed = {};
  var FIELD_ERR = {
    name: function (v) { return v.trim().length < 2 ? "Please tell us your name." : ""; },
    email: function (v) { return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(v.trim()) ? "" : "That doesn't look like an email address."; },
    company: function (v) { return v.trim() ? "" : "Which company are you with?"; },
    company_size: function (v) { return v ? "" : "Pick your company size."; }
  };
  function setErr(name, text) {
    var wrap = form.querySelector('[data-field="' + name + '"]'); if (!wrap) return;
    wrap.classList.toggle("invalid", !!text);
    var e = wrap.querySelector(".err"); if (e) e.textContent = text || "";
    var input = wrap.querySelector("input,select"); if (input) input.setAttribute("aria-invalid", text ? "true" : "false");
  }
  form.addEventListener("focusin", function () {
    if (!started) { started = true; track("demo_form_start", { form_id: "demo" }); }
  });
  form.addEventListener("focusout", function (e) {
    var el = e.target, name = el.name;
    if (!FIELD_ERR[name]) return;
    var err = FIELD_ERR[name](el.value);       // validates locally; the value itself is never tracked
    if (el.value) setErr(name, err);
    if (err && el.value) track("demo_form_error", { form_id: "demo", field_name: name, error_code: "invalid" });
    else if (!err && !completed[name]) { completed[name] = 1; track("demo_form_field_complete", { form_id: "demo", field_name: name }); }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.textContent = ""; msg.className = "form-msg";
    var data = new FormData(form), errs = {}, first = null;
    Object.keys(FIELD_ERR).forEach(function (k) { var x = FIELD_ERR[k](data.get(k) || ""); if (x) errs[k] = x; });
    if (!form.consent_terms.checked) errs.consent_terms = "Please agree so we can contact you about your demo.";
    ["name", "email", "company", "company_size", "consent_terms"].forEach(function (k) { setErr(k, errs[k]); if (errs[k] && !first) first = k; });
    if (first) {
      Object.keys(errs).forEach(function (k) { track("demo_form_error", { form_id: "demo", field_name: k, error_code: "required" }); });
      var f = form.querySelector('[data-field="' + first + '"] input, [data-field="' + first + '"] select'); if (f) f.focus();
      return;
    }
    var sid = null; try { sid = JSON.parse(sessionStorage.getItem("wm_sid") || "null"); } catch (x) {}
    var aid = (document.cookie.match(/(?:^|; )wm_aid=([^;]*)/) || [])[1] || null;
    var utm = {}; new URLSearchParams(location.search).forEach(function (v, k) { if (k.indexOf("utm_") === 0) utm[k.slice(4)] = v; });
    var payload = {
      name: data.get("name"), email: data.get("email"), company: data.get("company"), company_size: data.get("company_size"),
      role: data.get("role"), message: data.get("message"), website: data.get("website"),
      consent_terms: form.consent_terms.checked, consent_marketing: form.consent_marketing.checked,
      anonymous_id: aid ? decodeURIComponent(aid) : null, session_id: sid && sid.id, utm: utm,
      experiments: exps.filter(Boolean).map(function (p) { var kv = p.split(":"); return { id: kv[0], variant: kv[1] }; })
    };
    submit.setAttribute("aria-busy", "true"); submit.disabled = true;
    if (window.wm) window.wm.flush();
    fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.body.ok) {
          document.getElementById("demo-box").innerHTML =
            '<div class="success" tabindex="-1" id="ok"><div class="tick" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 32 32"><path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="#14161F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
            "<h3>You're booked in. Nearly.</h3><p>Check your inbox: we've sent a link to pick a time that suits you. Talk soon!</p></div>";
          document.getElementById("ok").focus();
          return;
        }
        var errs = res.body.errors || {};
        Object.keys(errs).forEach(function (k) { if (k !== "_form") setErr(k, errs[k]); });
        msg.textContent = errs._form || "Please check the highlighted fields.";
        msg.className = "form-msg bad";
      })
      .catch(function () { msg.textContent = "We couldn't reach our server. Please try again."; msg.className = "form-msg bad"; })
      .finally(function () { submit.removeAttribute("aria-busy"); submit.disabled = false; });
  });
})();
