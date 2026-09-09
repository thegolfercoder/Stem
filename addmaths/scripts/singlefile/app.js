/**
 * The single-file runtime.
 *
 * Every static page of the site is pre-rendered HTML, gzipped into one blob and
 * decompressed here on load. Navigation is a hash router over that blob, so the
 * whole site works from a file:// URL with no server and no network.
 *
 * The three interactive pages — practice, the exam simulator and the tools —
 * are rebuilt here in plain DOM against the real question engine, which is
 * bundled alongside. They are not screenshots of the React pages; they run the
 * same generators and the same marking.
 */
(function () {
  "use strict";

  var PAGES = null;
  var SEARCH = null;
  var K = window.katex;
  var E = window.AddMaths;

  /* ------------------------------------------------------------ utilities */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /** Renders text with inline $…$ maths, matching the build-time renderer. */
  function tex(text) {
    var out = "";
    var parts = String(text).split("$");
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        out += esc(parts[i]).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      } else {
        try {
          out += K.renderToString(parts[i], { throwOnError: false, strict: false });
        } catch (e) {
          out += esc(parts[i]);
        }
      }
    }
    return out;
  }
  function texBlock(t) {
    try {
      return K.renderToString(t, { displayMode: true, throwOnError: false, strict: false });
    } catch (e) {
      return esc(t);
    }
  }

  function decompress(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  /* -------------------------------------------------------------- storage */

  var KEY = "addmaths-progress-v1";
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { attempts: [], exams: [], retry: [], completed: [] };
    } catch (e) {
      return { attempts: [], exams: [], retry: [], completed: [] };
    }
  }
  function saveProgress(p) {
    try {
      p.attempts = p.attempts.slice(-2000);
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch (e) {
      /* storage disabled: the session still works, it just is not remembered */
    }
  }
  function recordAttempt(a) {
    var p = loadProgress();
    p.attempts.push(a);
    var retry = p.retry.filter(function (id) {
      return id !== a.qid;
    });
    if (!a.correct) retry.push(a.qid);
    p.retry = retry.slice(-200);
    saveProgress(p);
  }

  /* --------------------------------------------------------------- router */

  /**
   * Routes look like "#/topics/functions/" and may carry an in-page fragment
   * after a second hash, as the search index links do: "#/topics/x/#formulas".
   */
  function parseHash() {
    var raw = location.hash.replace(/^#/, "") || "/";
    var at = raw.indexOf("#");
    var route = at === -1 ? raw : raw.slice(0, at);
    var fragment = at === -1 ? "" : raw.slice(at + 1);
    if (!route.startsWith("/")) route = "/" + route;
    if (!route.endsWith("/")) route += "/";
    return { route: route, fragment: fragment };
  }
  function currentRoute() {
    return parseHash().route;
  }

  var INTERACTIVE = {
    "/practice/": renderPractice,
    "/exam/": renderExam,
    "/tools/": renderTools,
    "/planner/": renderPlanner,
    "/progress/": renderProgress,
  };

  function navigate() {
    var parsed = parseHash();
    var route = parsed.route;
    var main = $("#main");
    var page = PAGES[route];
    if (!page) {
      main.innerHTML =
        '<div style="padding:5rem 0;text-align:center"><h1 style="font-size:1.8rem;font-weight:700">Page not found</h1>' +
        '<p class="muted" style="margin-top:.75rem">No such page in this file. <a class="link" href="#/">Go home</a>.</p></div>';
      return;
    }
    document.title = page.t || "Add Maths 0606";
    main.innerHTML = page.h;
    var build = INTERACTIVE[route];
    if (build) build(main);
    markActiveNav(route);
    main.focus({ preventScroll: true });
    if (parsed.fragment) {
      var target = document.getElementById(parsed.fragment);
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }

  function markActiveNav(route) {
    var links = document.querySelectorAll("header nav a");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      var target = href.replace(/^#/, "");
      if (target === route) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }

  /** Rewrites the export's absolute links into hash routes. */
  function rewriteLinks(root) {
    var as = root.querySelectorAll('a[href^="/"]');
    for (var i = 0; i < as.length; i++) {
      var href = as[i].getAttribute("href");
      if (/\.(json|xml|txt|svg|png|ico)$/.test(href)) continue;
      as[i].setAttribute("href", "#" + href);
    }
  }

  /* ---------------------------------------------------------------- theme */

  function initTheme() {
    var btns = document.querySelectorAll("header button");
    for (var i = 0; i < btns.length; i++) {
      var label = btns[i].textContent || "";
      if (/Switch to/.test(label)) {
        btns[i].addEventListener("click", function () {
          var dark = !document.documentElement.classList.contains("dark");
          document.documentElement.classList.toggle("dark", dark);
          try {
            localStorage.setItem("addmaths-theme", dark ? "dark" : "light");
          } catch (e) {}
        });
      }
    }
  }

  /* ----------------------------------------------------------- menu, search */

  /**
   * The export's header carries the menu button but not the panel — React only
   * renders that while it is open — so build it here from the nav list.
   */
  function initMenu() {
    var btn = document.querySelector('header button[aria-controls="site-menu"]');
    var header = document.querySelector("header");
    if (!btn || !header) return;

    var menu = el("div");
    menu.id = "site-menu";
    menu.hidden = true;
    menu.style.cssText = "border-top:1px solid var(--border);background:var(--bg)";
    menu.innerHTML =
      "<nav aria-label='All pages' style='margin:0 auto;display:grid;gap:.25rem;max-width:72rem;padding:1rem;grid-template-columns:1fr'>" +
      (window.__NAV__ || []).map(function (item) {
        return "<a href='#" + esc(item.href) + "' style='display:block;border-radius:.5rem;padding:.625rem .75rem;text-decoration:none'>" +
          "<span style='display:block;font-size:.875rem;font-weight:500'>" + esc(item.label) + "</span>" +
          "<span class='muted' style='display:block;font-size:.75rem'>" + esc(item.description) + "</span></a>";
      }).join("") + "</nav>";
    header.appendChild(menu);

    var mq = window.matchMedia("(min-width: 640px)");
    function layout() {
      var nav = menu.querySelector("nav");
      nav.style.gridTemplateColumns = window.innerWidth >= 1024 ? "repeat(3,1fr)" : mq.matches ? "repeat(2,1fr)" : "1fr";
    }
    layout();
    window.addEventListener("resize", layout);

    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function () {
      var open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }

  function searchDocs(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var scored = [];
    for (var i = 0; i < SEARCH.length; i++) {
      var d = SEARCH[i];
      var title = d.title.toLowerCase();
      var body = d.text.toLowerCase();
      var score = 0;
      var ok = true;
      for (var j = 0; j < terms.length; j++) {
        var t = terms[j];
        var inTitle = title.indexOf(t);
        var inBody = body.indexOf(t);
        if (inTitle === -1 && inBody === -1) {
          ok = false;
          break;
        }
        if (inTitle !== -1) score += inTitle === 0 ? 14 : 9;
        if (inBody !== -1) score += 3;
      }
      if (ok) {
        if (d.kind === "Topic") score += 4;
        scored.push({ d: d, s: score });
      }
    }
    scored.sort(function (a, b) {
      return b.s - a.s;
    });
    return scored.slice(0, 30).map(function (x) {
      return x.d;
    });
  }

  function openSearch() {
    if ($("#search-overlay")) return;
    var overlay = el("div", "");
    overlay.id = "search-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:50;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,.45);padding:1rem;padding-top:8vh;backdrop-filter:blur(4px)";
    overlay.innerHTML =
      '<div class="card" role="dialog" aria-modal="true" aria-label="Search" style="display:flex;flex-direction:column;max-height:75vh;width:100%;max-width:42rem;overflow:hidden">' +
      '<div style="display:flex;align-items:center;gap:.75rem;padding:0 1rem;border-bottom:1px solid var(--border)">' +
      '<input id="search-input" placeholder="Search topics, formulas, examples, terms…" aria-label="Search query" autocomplete="off" style="width:100%;background:transparent;padding:1rem 0;font-size:.98rem;outline:none;border:0;color:var(--text)">' +
      '<button type="button" id="search-close" class="muted" style="border:1px solid var(--border);border-radius:.375rem;padding:.25rem .5rem;font-size:11px">Esc</button>' +
      "</div><ul id='search-results' role='listbox' style='overflow-y:auto;padding:.5rem'></ul></div>";
    document.body.appendChild(overlay);
    var input = $("#search-input");
    var results = $("#search-results");
    var active = 0;
    var hits = [];

    function draw() {
      results.innerHTML = "";
      if (!input.value.trim()) {
        results.innerHTML =
          "<li class='muted' style='padding:1rem;font-size:.875rem'>Type to search every topic, formula, worked example, exam question and glossary entry.</li>";
        return;
      }
      if (!hits.length) {
        results.innerHTML = "<li class='muted' style='padding:1rem;font-size:.875rem'>No matches.</li>";
        return;
      }
      hits.forEach(function (h, i) {
        var li = el("li");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        li.innerHTML =
          '<a href="#' + esc(h.href) + '" style="display:block;border-radius:.5rem;padding:.625rem .75rem;' +
          (i === active ? "background:var(--accent-soft)" : "") + '">' +
          '<div style="display:flex;justify-content:space-between;gap:.75rem"><span style="font-size:.875rem;font-weight:500">' +
          esc(h.title) + '</span><span class="muted" style="font-size:11px;text-transform:uppercase">' + esc(h.kind) +
          "</span></div>" +
          '<p class="muted" style="margin-top:.125rem;font-size:.75rem;line-height:1.5">' + esc(h.text.slice(0, 160)) + "</p></a>";
        li.querySelector("a").addEventListener("click", close);
        results.appendChild(li);
      });
    }
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(active + 1, hits.length - 1);
        draw();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(active - 1, 0);
        draw();
      } else if (e.key === "Enter" && hits[active]) {
        e.preventDefault();
        location.hash = hits[active].href;
        close();
      }
    }
    input.addEventListener("input", function () {
      hits = searchDocs(input.value);
      active = 0;
      draw();
    });
    $("#search-close").addEventListener("click", close);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    input.focus();
    draw();
  }

  function initSearch() {
    var btns = document.querySelectorAll("header button");
    for (var i = 0; i < btns.length; i++) {
      if (/Search/.test(btns[i].textContent || "")) btns[i].addEventListener("click", openSearch);
    }
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        openSearch();
      }
    });
  }

  /**
   * The interactive pages ship a server-rendered React shell that cannot work
   * without its bundle — dead inputs and buttons. Keep the page heading, drop
   * everything after it, and let this file render the working version.
   */
  function resetInteractive(main) {
    var kept = main.querySelector("header");
    var child = main.firstElementChild;
    while (child) {
      var next = child.nextElementSibling;
      if (child !== kept) child.remove();
      child = next;
    }
  }

  /* ------------------------------------------------------------- practice */

  var DIFFS = ["easy", "medium", "hard", "olympiad"];
  var DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard", olympiad: "Olympiad" };

  function chip(label, active) {
    var b = el("button", "sf-chip" + (active ? " sf-chip-on" : ""), label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(!!active));
    return b;
  }

  function questionCard(q, index, total, onAnswered) {
    var topic = E.topics.filter(function (t) {
      return t.slug === q.topic;
    })[0];
    var card = el("article", "card");
    card.style.overflow = "hidden";
    card.innerHTML =
      '<header style="display:flex;flex-wrap:wrap;align-items:center;gap:.625rem;border-bottom:1px solid var(--border);background:var(--bg-soft);padding:.75rem 1.25rem">' +
      '<span style="font-size:.875rem;font-weight:600">Q' + (index + 1) +
      (total ? ' <span class="muted" style="font-weight:400">of ' + total + "</span>" : "") + "</span>" +
      '<span class="sf-badge sf-' + q.difficulty + '">' + DIFF_LABEL[q.difficulty] + "</span>" +
      (topic ? '<span class="sf-chip-static">' + esc(topic.short) + "</span>" : "") +
      '<span class="sf-chip-static">' + q.marks + " marks</span>" +
      '<span class="sf-chip-static">Paper ' + q.paper + "</span></header>" +
      '<div style="padding:1.25rem">' +
      '<div class="sf-prompt">' + q.prompt.split("\n").map(function (l) {
        return l.trim() ? "<p>" + tex(l) + "</p>" : '<div style="height:.5rem"></div>';
      }).join("") + "</div>" +
      '<form style="margin-top:1.25rem"><label style="display:block;margin-bottom:.375rem;font-size:.875rem;font-weight:500">' +
      (q.answer.kind === "mcq" ? "Your choice" : "Your answer") + "</label>" +
      '<div style="display:flex;flex-wrap:wrap;gap:.5rem">' +
      '<input class="sf-input" autocomplete="off" placeholder="' +
      (q.answer.kind === "mcq" ? "Type the option number" : "e.g. 3/4, -2.5, sqrt5, pi/6") + '">' +
      '<button type="submit" class="sf-btn">Check</button></div>' +
      '<p class="muted" style="margin-top:.375rem;font-size:.75rem">' +
      esc(q.hint || "Fractions, surds, powers and pi are all accepted.") + "</p></form>" +
      '<div class="sf-feedback" aria-live="polite"></div><div class="sf-solution"></div></div>';

    var form = card.querySelector("form");
    var input = card.querySelector("input");
    var feedback = card.querySelector(".sf-feedback");
    var solution = card.querySelector(".sf-solution");
    var started = Date.now();
    var done = false;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (done || !input.value.trim()) return;
      done = true;
      var correct = E.checkAnswer(q.answer, input.value);
      input.disabled = true;
      form.querySelector("button").remove();
      feedback.innerHTML =
        '<div class="sf-result ' + (correct ? "sf-right" : "sf-wrong") + '">' +
        "<p style='font-weight:600;font-size:.875rem'>" + (correct ? "✓ Correct" : "✗ Not quite") + "</p>" +
        "<p style='margin-top:.25rem;font-size:.875rem'>The answer is " + tex(q.answer.display) +
        (correct ? "" : ' <span class="muted">— you gave ' + esc(input.value) + ".</span>") + "</p></div>";
      renderSolution(!correct);
      if (onAnswered) onAnswered(correct, Date.now() - started);
      recordAttempt({
        qid: q.id, topic: q.topic, generator: q.generator, difficulty: q.difficulty,
        correct: correct, ms: Date.now() - started, at: Date.now(), marks: q.marks,
      });
    });

    function renderSolution(open) {
      solution.innerHTML =
        '<button type="button" class="sf-link" style="margin-top:1rem">' +
        (open ? "Hide the worked solution" : "Show the worked solution") + "</button>" +
        (open ? '<div class="sf-steps">' + steps(q.solution) + "</div>" : "");
      solution.querySelector("button").addEventListener("click", function () {
        renderSolution(!open);
      });
    }
    return card;
  }

  function steps(list) {
    return (
      "<ol style='display:flex;flex-direction:column;gap:.875rem'>" +
      list.map(function (s) {
        return (
          "<li style='display:flex;gap:.875rem'>" +
          "<span class='sf-step-n' aria-hidden='true'></span>" +
          "<div style='min-width:0;flex:1'><p style='line-height:1.7'>" + tex(s.t) + "</p>" +
          (s.m ? "<div style='margin-top:.25rem;overflow-x:auto'>" + texBlock(s.m) + "</div>" : "") +
          "</div></li>"
        );
      }).join("") +
      "</ol>"
    );
  }

  function renderPractice(main) {
    resetInteractive(main);
    var host = el("div");
    main.appendChild(host);
    var selected = [];
    var levels = [];
    var count = 10;

    var topicsWithGens = E.topics.filter(function (t) {
      return E.generators.some(function (g) {
        return g.topic === t.slug;
      });
    });

    function draw() {
      host.innerHTML = "";
      var panel = el("section", "card");
      panel.style.cssText = "padding:1.5rem;margin-top:2.25rem";
      panel.appendChild(el("h2", "", "Build your set")).style.cssText = "font-size:1.125rem;font-weight:700";

      panel.appendChild(fieldset("Topics", [chipRow(
        [{ label: "All topics", on: selected.length === 0, click: function () { selected = []; draw(); } }].concat(
          topicsWithGens.map(function (t) {
            return {
              label: t.short,
              on: selected.indexOf(t.slug) >= 0,
              click: function () {
                var i = selected.indexOf(t.slug);
                if (i >= 0) selected.splice(i, 1);
                else selected.push(t.slug);
                draw();
              },
            };
          })
        )
      )]));

      panel.appendChild(fieldset("Difficulty", [chipRow(
        [{ label: "Any", on: levels.length === 0, click: function () { levels = []; draw(); } }].concat(
          DIFFS.map(function (d) {
            return {
              label: DIFF_LABEL[d],
              on: levels.indexOf(d) >= 0,
              click: function () {
                var i = levels.indexOf(d);
                if (i >= 0) levels.splice(i, 1);
                else levels.push(d);
                draw();
              },
            };
          })
        )
      )]));

      panel.appendChild(fieldset("Number of questions", [chipRow(
        [5, 10, 15, 20].map(function (n) {
          return { label: String(n), on: count === n, click: function () { count = n; draw(); } };
        })
      )]));

      var pool = E.generatorsFor({ topics: selected, difficulties: levels });
      var actions = el("div");
      actions.style.cssText = "margin-top:1.5rem;display:flex;flex-wrap:wrap;gap:.75rem;align-items:center";
      var start = el("button", "sf-btn sf-btn-lg", "Start practising");
      start.type = "button";
      start.disabled = pool.length === 0;
      start.addEventListener("click", function () {
        run(E.buildSet({ topics: selected, difficulties: levels, count: count, seed: Math.floor(Math.random() * 1e9) }));
      });
      actions.appendChild(start);

      var retryIds = loadProgress().retry;
      if (retryIds.length) {
        var retry = el("button", "sf-btn-outline", "Retry " + Math.min(retryIds.length, 20) + " you got wrong");
        retry.type = "button";
        retry.addEventListener("click", function () {
          var qs = retryIds.slice(-20).reverse().map(E.questionFromId).filter(Boolean);
          run(qs);
        });
        actions.appendChild(retry);
      }
      var note = el("p", "muted", pool.length ? pool.length + " templates match." : "No templates match — widen the difficulty.");
      note.style.fontSize = ".875rem";
      actions.appendChild(note);
      panel.appendChild(actions);
      host.appendChild(panel);
    }

    function fieldset(legend, children) {
      var fs = el("fieldset");
      fs.style.marginTop = "1.25rem";
      var lg = el("legend", "", legend);
      lg.style.cssText = "margin-bottom:.625rem;font-size:.875rem;font-weight:500";
      fs.appendChild(lg);
      children.forEach(function (c) {
        fs.appendChild(c);
      });
      return fs;
    }
    function chipRow(items) {
      var row = el("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:.5rem";
      items.forEach(function (it) {
        var b = chip(it.label, it.on);
        b.addEventListener("click", it.click);
        row.appendChild(b);
      });
      return row;
    }

    function run(questions) {
      host.innerHTML = "";
      if (!questions.length) {
        draw();
        return;
      }
      var answered = 0;
      var score = 0;
      var bar = el("div", "card");
      bar.style.cssText = "position:sticky;top:4rem;z-index:20;margin:2.25rem 0 1.25rem;padding:.75rem 1rem;display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap;align-items:center";
      var status = el("span", "", "0 of " + questions.length + " answered");
      status.style.cssText = "font-size:.875rem;font-weight:600";
      var tally = el("span", "", "0/0");
      tally.style.cssText = "font-size:.875rem;font-weight:600;font-variant-numeric:tabular-nums";
      bar.appendChild(status);
      bar.appendChild(tally);
      host.appendChild(bar);

      var list = el("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:1.25rem";
      host.appendChild(list);

      questions.forEach(function (q, i) {
        list.appendChild(
          questionCard(q, i, questions.length, function (correct) {
            answered++;
            if (correct) score++;
            status.textContent = answered + " of " + questions.length + " answered";
            tally.textContent = score + "/" + answered;
            if (answered === questions.length) {
              var done = el("div", "card");
              done.style.cssText = "margin-top:1.75rem;padding:1.5rem;text-align:center";
              done.innerHTML =
                "<p style='font-size:.875rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)'>Set complete</p>" +
                "<p style='margin-top:.5rem;font-size:1.875rem;font-weight:700'>" + score + " / " + questions.length + "</p>" +
                "<p class='muted' style='margin-top:.375rem;font-size:.875rem'>" +
                Math.round((score / questions.length) * 100) + "% correct.</p>";
              var again = el("button", "sf-btn", "Another set");
              again.type = "button";
              again.style.marginTop = "1.25rem";
              again.addEventListener("click", draw);
              done.appendChild(again);
              host.appendChild(done);
            }
          })
        );
      });
      window.scrollTo(0, 0);
    }

    draw();
  }

  /* ------------------------------------------------------------ exam mode */

  var PAPERS = [
    { label: "Quick test", paper: 2, questions: 8, minutes: 20 },
    { label: "Half paper", paper: 1, questions: 12, minutes: 45 },
    { label: "Full Paper 1 (no calculator)", paper: 1, questions: 20, minutes: 120 },
    { label: "Full Paper 2 (calculator)", paper: 2, questions: 20, minutes: 120 },
  ];

  function renderExam(main) {
    resetInteractive(main);
    var host = el("div");
    host.style.marginTop = "2.25rem";
    main.appendChild(host);
    setup();

    function setup() {
      host.innerHTML = "<div class='sf-grid2'></div>";
      var grid = host.firstChild;
      PAPERS.forEach(function (p) {
        var b = el("button", "card sf-paper");
        b.type = "button";
        b.innerHTML =
          "<h2 style='font-weight:600'>" + esc(p.label) + "</h2>" +
          "<p class='muted' style='margin-top:.375rem;font-size:.875rem'>" + p.questions + " questions · " +
          p.minutes + " minutes · Paper " + p.paper + "</p>";
        b.addEventListener("click", function () {
          begin(p);
        });
        grid.appendChild(b);
      });
    }

    function begin(paper) {
      var questions = E.buildSet({ paper: paper.paper, count: paper.questions, seed: Math.floor(Math.random() * 1e9) });
      var answers = {};
      var spent = {};
      var current = 0;
      var remaining = paper.minutes * 60;
      var enteredAt = Date.now();
      var timer = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
          clearInterval(timer);
          finish();
        } else drawClock();
      }, 1000);

      function drawClock() {
        var c = $("#sf-clock", host);
        if (!c) return;
        c.textContent = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");
        c.style.color = remaining < 300 ? "var(--hard)" : "";
      }
      function recordTime() {
        var id = questions[current].id;
        spent[id] = (spent[id] || 0) + (Date.now() - enteredAt);
        enteredAt = Date.now();
      }
      function go(i) {
        recordTime();
        current = i;
        drawSitting();
      }

      function drawSitting() {
        var q = questions[current];
        host.innerHTML =
          "<div class='card' style='position:sticky;top:4rem;z-index:20;margin-bottom:1.25rem;padding:.75rem 1rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.75rem;align-items:center'>" +
          "<span id='sf-clock' role='timer' style='font-family:ui-monospace,monospace;font-size:1.125rem;font-weight:700'></span>" +
          "<span><span class='muted' style='font-size:.875rem;margin-right:.75rem'>" +
          Object.keys(answers).filter(function (k) { return answers[k].trim(); }).length + "/" + questions.length +
          " answered</span><button type='button' class='sf-btn' id='sf-submit'>Submit paper</button></span></div>" +
          "<nav aria-label='Question navigation' id='sf-nav' style='display:flex;flex-wrap:wrap;gap:.375rem;margin-bottom:1.25rem'></nav>" +
          "<article class='card' style='overflow:hidden'>" +
          "<header style='display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;border-bottom:1px solid var(--border);background:var(--bg-soft);padding:.75rem 1.25rem'>" +
          "<span style='font-size:.875rem;font-weight:600'>Question " + (current + 1) + "</span>" +
          "<span class='sf-badge sf-" + q.difficulty + "'>" + DIFF_LABEL[q.difficulty] + "</span>" +
          "<span class='sf-chip-static'>" + q.marks + " marks</span></header>" +
          "<div style='padding:1.25rem'><div class='sf-prompt'>" +
          q.prompt.split("\n").map(function (l) { return l.trim() ? "<p>" + tex(l) + "</p>" : ""; }).join("") +
          "</div><label for='sf-ans' style='display:block;margin:1.25rem 0 .375rem;font-size:.875rem;font-weight:500'>Your answer</label>" +
          "<input id='sf-ans' class='sf-input' style='width:100%' autocomplete='off'>" +
          "<p class='muted' style='margin-top:.375rem;font-size:.75rem'>" + esc(q.hint || "Fractions, surds and powers are accepted.") + "</p></div></article>" +
          "<div style='display:flex;justify-content:space-between;gap:.75rem;margin-top:1.25rem'>" +
          "<button type='button' class='sf-btn-outline' id='sf-prev'" + (current === 0 ? " disabled" : "") + ">← Previous</button>" +
          "<button type='button' class='sf-btn-outline' id='sf-next'" + (current === questions.length - 1 ? " disabled" : "") + ">Next →</button></div>";

        var nav = $("#sf-nav", host);
        questions.forEach(function (item, i) {
          var b = el("button", "sf-navbtn" + (i === current ? " sf-navbtn-on" : (answers[item.id] || "").trim() ? " sf-navbtn-done" : ""), String(i + 1));
          b.type = "button";
          b.setAttribute("aria-label", "Question " + (i + 1));
          b.addEventListener("click", function () { go(i); });
          nav.appendChild(b);
        });
        var ans = $("#sf-ans", host);
        ans.value = answers[q.id] || "";
        ans.addEventListener("input", function () { answers[q.id] = ans.value; });
        $("#sf-prev", host).addEventListener("click", function () { if (current > 0) go(current - 1); });
        $("#sf-next", host).addEventListener("click", function () { if (current < questions.length - 1) go(current + 1); });
        $("#sf-submit", host).addEventListener("click", finish);
        drawClock();
      }

      function finish() {
        clearInterval(timer);
        recordTime();
        var score = 0, total = 0, perTopic = {};
        questions.forEach(function (q) {
          var given = answers[q.id] || "";
          var ok = given.trim() !== "" && E.checkAnswer(q.answer, given);
          total += q.marks;
          if (ok) score += q.marks;
          var b = perTopic[q.topic] || { score: 0, total: 0 };
          b.total += q.marks;
          if (ok) b.score += q.marks;
          perTopic[q.topic] = b;
          recordAttempt({ qid: q.id, topic: q.topic, generator: q.generator, difficulty: q.difficulty,
            correct: ok, ms: spent[q.id] || 0, at: Date.now(), marks: q.marks });
        });
        var pct = total ? Math.round((score / total) * 100) : 0;

        host.innerHTML =
          "<section class='card' style='padding:1.5rem;text-align:center'>" +
          "<p style='font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)'>" +
          esc(paper.label) + " · complete</p>" +
          "<p style='margin-top:.5rem;font-size:2.25rem;font-weight:700'>" + score +
          "<span class='muted' style='font-size:1.5rem'> / " + total + "</span></p>" +
          "<p class='muted' style='margin-top:.375rem'>" + pct + "%</p></section>" +
          "<section style='margin-top:1.75rem'><h2 style='font-size:1.125rem;font-weight:700'>Performance by topic</h2><ul id='sf-topics' style='margin-top:1rem;display:flex;flex-direction:column;gap:.625rem'></ul></section>" +
          "<section style='margin-top:2rem'><h2 style='font-size:1.125rem;font-weight:700'>Every question, with solutions</h2><div id='sf-review' style='margin-top:1rem;display:flex;flex-direction:column;gap:1rem'></div></section>";

        var ul = $("#sf-topics", host);
        Object.keys(perTopic).sort(function (a, b) {
          return perTopic[a].score / perTopic[a].total - perTopic[b].score / perTopic[b].total;
        }).forEach(function (slug) {
          var v = perTopic[slug];
          var p = Math.round((v.score / v.total) * 100);
          var meta = E.topics.filter(function (t) { return t.slug === slug; })[0];
          var li = el("li");
          li.style.cssText = "display:flex;align-items:center;gap:1rem";
          li.innerHTML =
            "<a href='#/topics/" + slug + "/' style='width:10rem;flex-shrink:0;font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" +
            esc(meta ? meta.short : slug) + "</a>" +
            "<div style='height:.5rem;flex:1;border-radius:999px;background:var(--bg-soft);overflow:hidden'>" +
            "<div style='height:100%;border-radius:999px;width:" + p + "%;background:" +
            (p >= 70 ? "var(--easy)" : p >= 40 ? "var(--medium)" : "var(--hard)") + "'></div></div>" +
            "<span style='width:5rem;text-align:right;font-size:.875rem;font-variant-numeric:tabular-nums'>" +
            v.score + "/" + v.total + "</span>";
          ul.appendChild(li);
        });

        var review = $("#sf-review", host);
        questions.forEach(function (q, i) {
          var given = answers[q.id] || "";
          var ok = given.trim() !== "" && E.checkAnswer(q.answer, given);
          var d = el("details", "card");
          d.style.overflow = "hidden";
          if (!ok) d.open = true;
          d.innerHTML =
            "<summary style='display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;padding:1rem;cursor:pointer;list-style:none'>" +
            "<span style='font-size:.875rem;font-weight:600;color:" + (ok ? "var(--easy)" : "var(--hard)") + "'>" +
            (ok ? "✓" : "✗") + " Q" + (i + 1) + "</span><span style='font-size:.875rem'>" + esc(q.title) + "</span>" +
            "<span class='sf-chip-static'>" + q.marks + " marks</span>" +
            "<span class='muted' style='margin-left:auto;font-size:.75rem'>" + Math.round((spent[q.id] || 0) / 1000) + " s</span></summary>" +
            "<div style='border-top:1px solid var(--border);padding:1.25rem'>" +
            "<div class='sf-prompt' style='border-radius:.75rem;background:var(--bg-soft);padding:1rem;font-size:.875rem'>" +
            q.prompt.split("\n").map(function (l) { return l.trim() ? "<p>" + tex(l) + "</p>" : ""; }).join("") + "</div>" +
            "<p style='margin-top:.75rem;font-size:.875rem'><span class='muted'>Your answer: </span>" +
            (given.trim() ? esc(given) : "<em class='muted'>left blank</em>") +
            " <span class='muted'>· Correct: </span>" + tex(q.answer.display) + "</p>" +
            "<div class='sf-steps'>" + steps(q.solution) + "</div></div>";
          review.appendChild(d);
        });

        var again = el("button", "sf-btn", "Sit another paper");
        again.type = "button";
        again.style.marginTop = "2rem";
        again.addEventListener("click", setup);
        host.appendChild(again);
        window.scrollTo(0, 0);
      }

      drawSitting();
    }
  }

  /* ---------------------------------------------------------------- tools */

  function renderTools(main) {
    resetInteractive(main);
    var host = el("div");
    host.style.marginTop = "2.25rem";
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.gap = "1.5rem";
    main.appendChild(host);
    host.appendChild(grapher());
    var row = el("div", "sf-grid2");
    row.appendChild(quadratic());
    row.appendChild(radians());
    host.appendChild(row);
  }

  /** A tiny evaluator for the grapher: no eval, no dependency. */
  function compile(src) {
    var tokens = [];
    var s = src.toLowerCase();
    var i = 0;
    var names = ["cosec", "sqrt", "sin", "cos", "tan", "sec", "cot", "log", "abs", "exp", "ln", "pi", "x", "e"];
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if ("+-*/^()".indexOf(c) >= 0) { tokens.push(c); i++; continue; }
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        tokens.push(s.slice(i, j));
        i = j;
        continue;
      }
      if (/[a-z]/.test(c)) {
        var k = i;
        while (k < s.length && /[a-z]/.test(s[k])) k++;
        var word = s.slice(i, k);
        while (word.length) {
          var match = null;
          for (var n = 0; n < names.length; n++) if (word.indexOf(names[n]) === 0) { match = names[n]; break; }
          if (!match) return null;
          tokens.push(match);
          word = word.slice(match.length);
        }
        i = k;
        continue;
      }
      return null;
    }
    var pos = 0;
    var FUNCS = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: function (v) { return Math.log(v) / Math.LN10; },
      sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
      sec: function (v) { return 1 / Math.cos(v); },
      cosec: function (v) { return 1 / Math.sin(v); },
      cot: function (v) { return 1 / Math.tan(v); },
    };
    function peek() { return tokens[pos]; }
    function eat(t) { if (tokens[pos] === t) { pos++; return true; } return false; }
    function expr() {
      var l = term();
      if (!l) return null;
      for (;;) {
        if (eat("+")) { var r = term(); if (!r) return null; l = (function (a, b) { return function (x) { return a(x) + b(x); }; })(l, r); }
        else if (eat("-")) { var r2 = term(); if (!r2) return null; l = (function (a, b) { return function (x) { return a(x) - b(x); }; })(l, r2); }
        else return l;
      }
    }
    function implicit(t) {
      return t !== undefined && (t === "(" || t === "x" || t === "pi" || t === "e" || /^[0-9]/.test(t) || FUNCS[t]);
    }
    function term() {
      var l = unary();
      if (!l) return null;
      for (;;) {
        if (eat("*")) { var r = unary(); if (!r) return null; l = (function (a, b) { return function (x) { return a(x) * b(x); }; })(l, r); }
        else if (eat("/")) { var r2 = unary(); if (!r2) return null; l = (function (a, b) { return function (x) { return a(x) / b(x); }; })(l, r2); }
        else if (implicit(peek())) { var r3 = unary(); if (!r3) return null; l = (function (a, b) { return function (x) { return a(x) * b(x); }; })(l, r3); }
        else return l;
      }
    }
    function unary() {
      if (eat("-")) { var v = unary(); return v ? function (x) { return -v(x); } : null; }
      return power();
    }
    function power() {
      var base = atom();
      if (!base) return null;
      if (eat("^")) {
        var ex = unary();
        if (!ex) return null;
        return function (x) { return Math.pow(base(x), ex(x)); };
      }
      return base;
    }
    function atom() {
      var t = peek();
      if (t === undefined) return null;
      if (t === "(") { pos++; var v = expr(); if (!v || !eat(")")) return null; return v; }
      if (/^[0-9]/.test(t)) { pos++; var num = Number(t); return function () { return num; }; }
      if (t === "x") { pos++; return function (x) { return x; }; }
      if (t === "pi") { pos++; return function () { return Math.PI; }; }
      if (t === "e") { pos++; return function () { return Math.E; }; }
      if (FUNCS[t]) { pos++; var f = FUNCS[t]; var arg = atom(); if (!arg) return null; return function (x) { return f(arg(x)); }; }
      return null;
    }
    var fn = expr();
    return fn && pos === tokens.length ? fn : null;
  }

  function grapher() {
    var sec = el("section", "card");
    sec.style.padding = "1.5rem";
    sec.innerHTML =
      "<h2 style='font-size:1.125rem;font-weight:700'>Graph plotter</h2>" +
      "<p class='muted' style='margin-top:.25rem;font-size:.875rem'>Type functions of x the way you write them: <code>x^2 - 3x</code>, <code>sin 2x</code>, <code>e^x</code>, <code>1/(x-2)</code>.</p>" +
      "<div class='sf-grid3' style='margin-top:1rem'>" +
      [0, 1, 2].map(function (i) {
        return "<div><label for='sf-fn" + i + "' style='display:block;margin-bottom:.25rem;font-size:.75rem;font-weight:500'>Function " + (i + 1) + "</label>" +
          "<input id='sf-fn" + i + "' class='sf-input' style='width:100%;font-family:ui-monospace,monospace'></div>";
      }).join("") + "</div>" +
      "<div style='margin-top:1rem;border:1px solid var(--border);border-radius:.75rem;overflow:hidden'><svg id='sf-plot' viewBox='0 0 720 420' style='display:block;width:100%;height:auto' role='img' aria-label='Plot of the entered functions'></svg></div>";
    var COLORS = ["#2549d8", "#c23b3b", "#10896b"];
    var inputs = [0, 1, 2].map(function (i) { return $("#sf-fn" + i, sec); });
    inputs[0].value = "x^2 - 3x + 1";
    inputs[1].value = "2x - 3";
    var svg = $("#sf-plot", sec);
    var range = { x0: -6, x1: 6, y0: -8, y1: 8 };

    function redraw() {
      var W = 720, H = 420, pad = { l: 42, r: 16, t: 16, b: 32 };
      var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      function sx(x) { return pad.l + ((x - range.x0) / (range.x1 - range.x0)) * iw; }
      function sy(y) { return pad.t + ih - ((y - range.y0) / (range.y1 - range.y0)) * ih; }
      var parts = [];
      function grid(a, b, horizontal) {
        var span = b - a, raw = span / 10, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var n = raw / mag, step = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag, out = [];
        for (var t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
        return out;
      }
      grid(range.x0, range.x1).forEach(function (t) {
        parts.push("<line x1='" + sx(t) + "' y1='" + pad.t + "' x2='" + sx(t) + "' y2='" + (pad.t + ih) + "' stroke='var(--border)'/>");
      });
      grid(range.y0, range.y1).forEach(function (t) {
        parts.push("<line x1='" + pad.l + "' y1='" + sy(t) + "' x2='" + (pad.l + iw) + "' y2='" + sy(t) + "' stroke='var(--border)'/>");
        parts.push("<text x='" + (sx(0) - 6) + "' y='" + (sy(t) + 3.5) + "' text-anchor='end' font-size='10' fill='var(--text-muted)'>" + t + "</text>");
      });
      grid(range.x0, range.x1).forEach(function (t) {
        parts.push("<text x='" + sx(t) + "' y='" + (sy(0) + 13) + "' text-anchor='middle' font-size='10' fill='var(--text-muted)'>" + t + "</text>");
      });
      parts.push("<line x1='" + pad.l + "' y1='" + sy(0) + "' x2='" + (pad.l + iw) + "' y2='" + sy(0) + "' stroke='var(--text-muted)' stroke-width='1.4'/>");
      parts.push("<line x1='" + sx(0) + "' y1='" + pad.t + "' x2='" + sx(0) + "' y2='" + (pad.t + ih) + "' stroke='var(--text-muted)' stroke-width='1.4'/>");

      inputs.forEach(function (inp, idx) {
        if (!inp.value.trim()) return;
        var f = compile(inp.value);
        inp.style.borderColor = f ? "" : "var(--hard)";
        if (!f) return;
        var d = "", prev = null, span = range.y1 - range.y0;
        for (var i = 0; i <= 900; i++) {
          var x = range.x0 + ((range.x1 - range.x0) * i) / 900;
          var y;
          try { y = f(x); } catch (e) { y = NaN; }
          var bad = !isFinite(y) || y < range.y0 - span || y > range.y1 + span;
          var jump = prev !== null && Math.abs(y - prev) > span * 0.6;
          if (bad || jump) { prev = bad ? null : y; if (bad) { d += " "; continue; } d += " "; }
          d += (d.trim().slice(-1) === "" || !d.trim() ? "M" : "L") + sx(x).toFixed(1) + " " + sy(y).toFixed(1) + " ";
          prev = y;
        }
        d.split(/\s{2,}/).forEach(function (seg) {
          if (seg.trim().length > 10) {
            parts.push("<path d='" + seg.trim().replace(/^L/, "M") + "' fill='none' stroke='" + COLORS[idx] + "' stroke-width='2.2' stroke-linecap='round'/>");
          }
        });
      });
      svg.innerHTML = parts.join("");
    }
    inputs.forEach(function (i) { i.addEventListener("input", redraw); });
    redraw();
    return sec;
  }

  function quadratic() {
    var sec = el("section", "card");
    sec.style.padding = "1.25rem";
    sec.innerHTML =
      "<h2 style='font-size:1.125rem;font-weight:700'>Quadratic and discriminant</h2>" +
      "<div class='sf-grid3' style='margin-top:1rem'>" +
      ["a", "b", "c"].map(function (n) {
        return "<div><label for='sf-q" + n + "' style='display:block;margin-bottom:.25rem;font-size:.75rem;font-weight:500'>" + n +
          "</label><input id='sf-q" + n + "' class='sf-input' style='width:100%'></div>";
      }).join("") + "</div><div id='sf-qout' style='margin-top:1rem;font-size:.875rem;display:flex;flex-direction:column;gap:.5rem'></div>";
    var fields = ["a", "b", "c"].map(function (n) { return $("#sf-q" + n, sec); });
    fields[0].value = "1"; fields[1].value = "-5"; fields[2].value = "6";
    var out = $("#sf-qout", sec);
    function update() {
      var a = Number(fields[0].value), b = Number(fields[1].value), c = Number(fields[2].value);
      if (!isFinite(a) || !isFinite(b) || !isFinite(c) || a === 0) {
        out.innerHTML = "<p class='muted'>Enter three numbers, with a ≠ 0.</p>";
        return;
      }
      var disc = b * b - 4 * a * c;
      var html = "<p>Discriminant " + tex("$b^2-4ac = " + round(disc) + "$") + "</p>";
      html += "<p class='muted'>" + (disc > 0 ? "Two distinct real roots." : disc === 0 ? "One repeated root — the axis is a tangent." : "No real roots.") + "</p>";
      if (disc >= 0) {
        html += "<p>Roots: " + tex("$x = " + round((-b + Math.sqrt(disc)) / (2 * a)) + "$");
        if (disc > 0) html += " and " + tex("$x = " + round((-b - Math.sqrt(disc)) / (2 * a)) + "$");
        html += "</p>";
      }
      var h = -b / (2 * a), k = c - (b * b) / (4 * a);
      html += "<p>Completed square: " + tex("$" + (a === 1 ? "" : round(a)) + "\\left(x " + (h <= 0 ? "+ " + round(-h) : "- " + round(h)) + "\\right)^2 " + (k >= 0 ? "+ " + round(k) : "- " + round(-k)) + "$") + "</p>";
      html += "<p class='muted'>Vertex " + tex("$(" + round(h) + ",\\ " + round(k) + ")$") + ", a " + (a > 0 ? "minimum" : "maximum") + ".</p>";
      out.innerHTML = html;
    }
    fields.forEach(function (f) { f.addEventListener("input", update); });
    update();
    return sec;
  }

  function radians() {
    var sec = el("section", "card");
    sec.style.padding = "1.25rem";
    sec.innerHTML =
      "<h2 style='font-size:1.125rem;font-weight:700'>Degrees, radians, arcs and sectors</h2>" +
      "<div style='margin-top:1rem'><label for='sf-deg' style='display:block;margin-bottom:.25rem;font-size:.75rem;font-weight:500'>Angle in degrees</label>" +
      "<input id='sf-deg' class='sf-input' style='width:100%'></div>" +
      "<div id='sf-degout' style='margin-top:1rem;font-size:.875rem;display:flex;flex-direction:column;gap:.5rem'></div>";
    var input = $("#sf-deg", sec);
    input.value = "60";
    var out = $("#sf-degout", sec);
    function update() {
      var d = Number(input.value);
      if (!isFinite(d)) { out.innerHTML = "<p class='muted'>Enter a number.</p>"; return; }
      var rad = (d * Math.PI) / 180;
      out.innerHTML =
        "<p>" + tex("$" + d + "^\\circ = " + rad.toFixed(5) + "$") + " radians</p>" +
        "<p class='muted'>Arc " + tex("$s = " + rad.toFixed(4) + "r$") + ", sector area " + tex("$A = " + (rad / 2).toFixed(4) + "r^2$") + "</p>" +
        "<p class='muted'>Segment " + tex("$= " + ((rad - Math.sin(rad)) / 2).toFixed(4) + "r^2$") + "</p>";
    }
    input.addEventListener("input", update);
    update();
    return sec;
  }

  function round(v) {
    if (!isFinite(v)) return "\\text{undefined}";
    var r = Math.round(v * 1e6) / 1e6;
    return Number.isInteger(r) ? String(r) : String(Number(r.toPrecision(6)));
  }


  /* -------------------------------------------------------------- planner */

  function renderPlanner(main) {
    resetInteractive(main);
    var host = el("div");
    host.style.marginTop = "2.25rem";
    main.appendChild(host);

    var store = loadProgress();
    var examDate = store.examDate || "";
    var hours = 4;

    function draw() {
      host.innerHTML =
        "<section class='card' style='padding:1.5rem'>" +
        "<h2 style='font-size:1.125rem;font-weight:700'>Your details</h2>" +
        "<div class='sf-grid2' style='margin-top:1rem'>" +
        "<div><label for='sf-date' style='display:block;margin-bottom:.375rem;font-size:.875rem;font-weight:500'>Exam date</label>" +
        "<input id='sf-date' type='date' class='sf-input' style='width:100%;font-family:inherit' value='" + esc(examDate) + "'></div>" +
        "<div><label for='sf-hours' style='display:block;margin-bottom:.375rem;font-size:.875rem;font-weight:500'>Hours per week: <span id='sf-hval'>" +
        hours + "</span></label><input id='sf-hours' type='range' min='1' max='20' value='" + hours + "' style='width:100%;accent-color:var(--accent)'></div>" +
        "</div></section><div id='sf-plan'></div>";

      $("#sf-date", host).addEventListener("change", function (e) {
        examDate = e.target.value;
        var p = loadProgress();
        p.examDate = examDate || undefined;
        saveProgress(p);
        plan();
      });
      $("#sf-hours", host).addEventListener("input", function (e) {
        hours = Number(e.target.value);
        $("#sf-hval", host).textContent = hours;
        plan();
      });
      plan();
    }

    function plan() {
      var out = $("#sf-plan", host);
      if (!examDate) {
        out.innerHTML = "<p class='muted' style='margin-top:1.5rem'>Enter your exam date above to build a schedule.</p>";
        return;
      }
      var exam = new Date(examDate + "T00:00:00");
      var now = new Date();
      now.setHours(0, 0, 0, 0);
      var days = Math.ceil((exam - now) / 86400000);
      if (days <= 0) {
        out.innerHTML = "<p class='muted' style='margin-top:1.5rem'>That date has passed. Good luck — or pick a future one.</p>";
        return;
      }
      var weeks = Math.max(1, Math.ceil(days / 7));
      var contentWeeks = Math.max(1, Math.floor(weeks * 0.85));
      var totalMinutes = E.topics.reduce(function (n, t) { return n + t.minutes * 3; }, 0);
      var budget = Math.max(hours * 60, totalMinutes / contentWeeks);
      var done = loadProgress().completed || [];

      var rows = [], bucket = [], used = 0, week = 1;
      E.topics.forEach(function (t) {
        var cost = t.minutes * 3;
        if (used + cost > budget && bucket.length && week < contentWeeks) {
          rows.push({ week: week, topics: bucket, minutes: used });
          week++; bucket = []; used = 0;
        }
        bucket.push(t);
        used += cost;
      });
      if (bucket.length) rows.push({ week: week, topics: bucket, minutes: used });

      out.innerHTML =
        "<section style='margin-top:2rem'><div style='display:flex;flex-wrap:wrap;gap:.75rem;align-items:baseline;margin-bottom:1.25rem'>" +
        "<h2 style='font-size:1.25rem;font-weight:700'>Your " + weeks + "-week plan</h2>" +
        "<p class='muted' style='font-size:.875rem'>" + days + " days left · about " + Math.round(totalMinutes / 60) +
        " hours of work · content finishes in week " + contentWeeks + "</p></div><ol id='sf-weeks' style='display:flex;flex-direction:column;gap:.75rem'></ol></section>";

      var ol = $("#sf-weeks", host);
      rows.forEach(function (row) {
        var li = el("li", "card");
        li.style.padding = "1rem";
        li.innerHTML =
          "<div style='display:flex;flex-wrap:wrap;gap:.75rem;align-items:center'>" +
          "<span style='display:flex;height:1.75rem;width:1.75rem;align-items:center;justify-content:center;border-radius:.5rem;background:var(--accent-soft);color:var(--accent);font-size:.75rem;font-weight:700'>" +
          row.week + "</span><span style='font-size:.875rem;font-weight:600'>Week " + row.week + "</span>" +
          "<span class='muted' style='font-size:.75rem'>≈ " + Math.round(row.minutes / 60) + " hours</span></div>" +
          "<div style='margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.5rem'>" +
          row.topics.map(function (t) {
            var isDone = done.indexOf(t.slug) >= 0;
            return "<a href='#/topics/" + t.slug + "/' class='sf-chip' style='text-decoration:none;display:inline-block" +
              (isDone ? ";border-color:color-mix(in oklab,var(--easy) 45%,transparent);background:color-mix(in oklab,var(--easy) 10%,transparent);color:var(--easy);text-decoration:line-through" : "") +
              "'>" + esc(t.short) + "</a>";
          }).join("") + "</div>";
        ol.appendChild(li);
      });

      if (weeks > contentWeeks) {
        var li = el("li", "card");
        li.style.cssText = "padding:1rem;border-style:dashed";
        li.innerHTML =
          "<p style='font-size:.875rem;font-weight:600'>Weeks " + (contentWeeks + 1) + "–" + weeks + ": papers only</p>" +
          "<p class='muted' style='margin-top:.375rem;font-size:.875rem;line-height:1.6'>No new content. Sit a timed paper, mark it, then spend the next session only on what you got wrong. Repeat.</p>" +
          "<a href='#/exam/' class='sf-btn' style='display:inline-block;margin-top:.75rem;text-decoration:none'>Sit a timed paper</a>";
        ol.appendChild(li);
      }
    }

    draw();
  }

  /* ------------------------------------------------------------- progress */

  function renderProgress(main) {
    resetInteractive(main);
    var host = el("div");
    host.style.marginTop = "2.25rem";
    main.appendChild(host);
    var store = loadProgress();
    var attempts = store.attempts || [];

    if (!attempts.length) {
      host.innerHTML =
        "<div style='padding:3rem 0;text-align:center'><p style='font-size:1.125rem;font-weight:500'>Nothing recorded yet.</p>" +
        "<p class='muted' style='margin:.5rem auto 0;max-width:28rem;line-height:1.6'>Answer some practice questions or sit a timed paper, and this page fills with your accuracy by topic, your weak areas, and a queue of everything you got wrong.</p>" +
        "<div style='margin-top:1.5rem;display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap'>" +
        "<a href='#/practice/' class='sf-btn' style='text-decoration:none'>Start practising</a>" +
        "<a href='#/exam/' class='sf-btn-outline' style='text-decoration:none;display:inline-block'>Sit a paper</a></div></div>";
      return;
    }

    var correct = attempts.filter(function (a) { return a.correct; }).length;
    var accuracy = Math.round((correct / attempts.length) * 100);
    var avg = Math.round(attempts.reduce(function (n, a) { return n + a.ms; }, 0) / attempts.length / 1000);

    var byTopic = {};
    attempts.forEach(function (a) {
      var t = byTopic[a.topic] || { n: 0, c: 0, ms: 0 };
      t.n++; if (a.correct) t.c++; t.ms += a.ms;
      byTopic[a.topic] = t;
    });
    var stats = Object.keys(byTopic).map(function (slug) {
      var v = byTopic[slug];
      return { slug: slug, n: v.n, c: v.c, acc: v.c / v.n, secs: v.ms / v.n / 1000 };
    }).sort(function (a, b) { return a.acc - b.acc; });

    var byDiff = { easy: { n: 0, c: 0 }, medium: { n: 0, c: 0 }, hard: { n: 0, c: 0 }, olympiad: { n: 0, c: 0 } };
    attempts.forEach(function (a) { byDiff[a.difficulty].n++; if (a.correct) byDiff[a.difficulty].c++; });

    function name(slug) {
      var t = E.topics.filter(function (x) { return x.slug === slug; })[0];
      return t ? t.short : slug;
    }

    host.innerHTML =
      "<dl style='display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem'>" +
      [["Questions answered", attempts.length], ["Overall accuracy", accuracy + "%"],
       ["Exams sat", (store.exams || []).length], ["Average time", avg + "s"]].map(function (s) {
        return "<div class='card' style='padding:1.25rem 1rem;text-align:center'>" +
          "<dd style='font-size:1.5rem;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums'>" + s[1] + "</dd>" +
          "<dt class='muted' style='margin-top:.25rem;font-size:.75rem'>" + s[0] + "</dt></div>";
      }).join("") + "</dl>" +
      "<section style='margin-top:2rem'><h2 style='font-size:1.125rem;font-weight:700'>By difficulty</h2>" +
      "<div class='sf-grid2' style='margin-top:1rem'>" +
      DIFFS.map(function (d) {
        var v = byDiff[d];
        return "<div class='card' style='padding:1rem'><p style='font-size:.875rem;font-weight:500'>" + DIFF_LABEL[d] + "</p>" +
          "<p style='margin-top:.25rem;font-size:1.25rem;font-weight:700'>" + (v.n ? Math.round((v.c / v.n) * 100) + "%" : "—") + "</p>" +
          "<p class='muted' style='font-size:.75rem'>" + v.n + " answered</p></div>";
      }).join("") + "</div></section>" +
      "<section style='margin-top:2rem'><h2 style='font-size:1.125rem;font-weight:700'>By topic</h2>" +
      "<p class='muted' style='margin-top:.25rem;font-size:.875rem'>Weakest first.</p><ul id='sf-bytopic' style='margin-top:1rem;display:flex;flex-direction:column;gap:.625rem'></ul></section>" +
      "<section style='margin-top:2rem'><h2 style='font-size:1.125rem;font-weight:700'>What to do next</h2><div id='sf-next'></div></section>" +
      "<section style='margin-top:2.5rem;border-top:1px solid var(--border);padding-top:1.5rem'>" +
      "<h2 style='font-size:.875rem;font-weight:600'>Your data</h2>" +
      "<p class='muted' style='margin-top:.375rem;font-size:.875rem;line-height:1.6'>Stored in this browser only, never uploaded.</p>" +
      "<button type='button' id='sf-clear' class='sf-btn-outline' style='margin-top:.75rem;color:var(--hard);border-color:color-mix(in oklab,var(--hard) 50%,transparent)'>Delete everything</button></section>";

    var ul = $("#sf-bytopic", host);
    stats.forEach(function (s) {
      var pct = Math.round(s.acc * 100);
      var li = el("li");
      li.style.cssText = "display:flex;align-items:center;gap:.75rem";
      li.innerHTML =
        "<a href='#/topics/" + s.slug + "/' style='width:9rem;flex-shrink:0;font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(name(s.slug)) + "</a>" +
        "<div style='height:.5rem;flex:1;border-radius:999px;background:var(--bg-soft);overflow:hidden'><div style='height:100%;border-radius:999px;width:" +
        pct + "%;background:" + (pct >= 70 ? "var(--easy)" : pct >= 40 ? "var(--medium)" : "var(--hard)") + "'></div></div>" +
        "<span style='width:6rem;text-align:right;font-size:.875rem;font-variant-numeric:tabular-nums'>" + s.c + "/" + s.n + " · " + pct + "%</span>";
      ul.appendChild(li);
    });

    var weak = stats.filter(function (s) { return s.n >= 3 && s.acc < 0.7; });
    var next = $("#sf-next", host);
    if (!weak.length) {
      next.innerHTML = "<p class='muted' style='margin-top:.5rem;line-height:1.6'>Nothing is below 70% with enough attempts to be sure. Try a mixed timed paper, or take on the hard and olympiad questions in topics you have only met at the easy level.</p>";
    } else {
      next.innerHTML = "<ol style='margin-top:1rem;display:flex;flex-direction:column;gap:.75rem'>" +
        weak.slice(0, 5).map(function (s, i) {
          return "<li class='card' style='display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;padding:1rem'>" +
            "<span style='display:flex;height:1.75rem;width:1.75rem;align-items:center;justify-content:center;border-radius:.5rem;background:color-mix(in oklab,var(--hard) 15%,transparent);color:var(--hard);font-size:.75rem;font-weight:700'>" + (i + 1) + "</span>" +
            "<div style='min-width:0;flex:1'><p style='font-weight:500'>" + esc(name(s.slug)) + "</p>" +
            "<p class='muted' style='font-size:.875rem'>" + Math.round(s.acc * 100) + "% over " + s.n + " questions, averaging " + Math.round(s.secs) + "s each.</p></div>" +
            "<a href='#/topics/" + s.slug + "/' class='sf-chip' style='text-decoration:none'>Re-read</a>" +
            "<a href='#/practice/' class='sf-btn' style='text-decoration:none'>Drill it</a></li>";
        }).join("") + "</ol>";
    }

    $("#sf-clear", host).addEventListener("click", function () {
      if (window.confirm("Delete all your progress? This cannot be undone.")) {
        try { localStorage.removeItem(KEY); } catch (e) {}
        renderProgress(main);
      }
    });
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    Promise.all([decompress(window.__PAGES__), decompress(window.__SEARCH__)]).then(function (res) {
      PAGES = JSON.parse(res[0]);
      SEARCH = JSON.parse(res[1]);
      delete window.__PAGES__;
      delete window.__SEARCH__;

      // The header and footer come from the export; rewire their links.
      rewriteLinks(document.body);
      var observer = new MutationObserver(function () {
        rewriteLinks($("#main"));
      });
      observer.observe($("#main"), { childList: true, subtree: true });

      initTheme();
      initMenu();
      initSearch();
      window.addEventListener("hashchange", navigate);
      navigate();
      var loading = $("#sf-loading");
      if (loading) loading.remove();
    }).catch(function (err) {
      $("#main").innerHTML =
        "<div style='padding:4rem 1rem;text-align:center'><h1 style='font-size:1.5rem;font-weight:700'>Could not load</h1>" +
        "<p class='muted' style='margin-top:.75rem'>This file needs a browser with DecompressionStream — Chrome 80+, Firefox 113+ or Safari 16.4+.</p>" +
        "<p class='muted' style='margin-top:.5rem;font-size:.8rem'>" + esc(err.message) + "</p></div>";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
