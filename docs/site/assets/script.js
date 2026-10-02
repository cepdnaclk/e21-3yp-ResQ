(() => {
  "use strict";

  const body = document.body;
  const page = body.dataset.page || "home";
  const siteRoot = body.dataset.siteRoot || "./";
  const assetRoot = body.dataset.assetRoot || `${siteRoot}assets/`;
  const homeRoot = body.dataset.homeRoot || (page === "home" ? "#top" : "../../");

  const paths = {
    home: homeRoot,
    about: `${siteRoot}about/`, system: `${siteRoot}system/`,
    development: `${siteRoot}development/`, blog: `${siteRoot}blog/`,
    how: `${siteRoot}how-to-use/`, team: `${siteRoot}team/`
  };
  const navItems = [
    ["home", "Home", paths.home], ["about", "About", paths.about], ["system", "System", paths.system],
    ["development", "Development", paths.development], ["blog", "Blog", paths.blog],
    ["how-to-use", "How to Use", paths.how], ["team", "Team", paths.team]
  ];

  const icon = (name) => ({
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 15.4A8.5 8.5 0 0 1 8.6 3.4 8.5 8.5 0 1 0 20.6 15.4Z"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.3 4 5 5 0 0 0 19.1.5S18 0 15 2a13.4 13.4 0 0 0-7 0C5 .1 3.9.5 3.9.5A5 5 0 0 0 3.7 4a5.4 5.4 0 0 0-1.5 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4M8 19c-3 .9-3-1.5-4-2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  }[name] || "");

  const header = document.querySelector("[data-site-header]");
  if (header) header.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to content</a>
    <div class="site-header__inner shell">
      <a class="brand" href="${paths.home}" aria-label="ResQ home">
        <img src="${assetRoot}img/logo/resq-logo-256.png" alt="" width="42" height="42">
        <span><strong class="resq-brand">ResQ</strong><small>Smart CPR Training</small></span>
      </a>
      <nav class="primary-nav" id="primary-navigation" aria-label="Primary navigation">
        ${navItems.map(([id, label, href]) => `<a href="${href}"${page === id ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
      <div class="header-actions">
        <button class="icon-button theme-toggle" type="button" aria-label="Switch color theme" title="Switch color theme">${icon("moon")}</button>
        <a class="button button--compact button--outline github-link" href="https://github.com/cepdnaclk/e21-3yp-ResQ" target="_blank" rel="noopener noreferrer">${icon("github")}<span>GitHub</span></a>
        <button class="icon-button menu-toggle" type="button" aria-controls="primary-navigation" aria-expanded="false" aria-label="Open navigation">${icon("menu")}</button>
      </div>
    </div>`;

  const footer = document.querySelector("[data-site-footer]");
  if (footer) footer.innerHTML = `
    <div class="shell footer-grid">
      <div class="footer-brand">
        <a class="brand brand--footer" href="${paths.home}">
          <img src="${assetRoot}img/logo/resq-logo-dark-256.png" alt="" width="48" height="48">
          <span><strong class="resq-brand">ResQ</strong><small>Smart CPR Training &amp; Assessment</small></span>
        </a>
        <p>An offline-first engineering platform for objective, manikin-based CPR education.</p>
        <span class="footer-institution">Department of Computer Engineering · University of Peradeniya</span>
      </div>
      <div><h2>Explore</h2><a href="${paths.about}">About the project</a><a href="${paths.system}">System architecture</a><a href="${paths.development}">Development status</a><a href="${paths.how}">How to use</a></div>
      <div><h2>Project</h2><a href="${paths.blog}#milestones">Presentations in the blog</a><a href="${paths.team}">Team &amp; mentors</a><a href="https://github.com/cepdnaclk/e21-3yp-ResQ/releases" target="_blank">Releases</a><a href="https://www.thecn.com/SG1732/section/showcase/69767bb907147407de0d080e" target="_blank">CN showcase</a></div>
      <div class="footer-cta"><h2>Project presentation</h2><p>See the complete ResQ story—from first prototype to integrated LocalHub.</p><a class="button button--light button--compact" href="https://canva.link/b83ww3cxndx37ii" target="_blank">Open presentation ${icon("arrow")}</a></div>
    </div>
    <div class="shell footer-bottom"><span>© 2026 ResQ Project Team</span><span>Training and education only · Not a medical device</span></div>`;

  function applyBrandTypeface() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.includes("ResQ")) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("code, pre, script, style, .resq-brand")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      node.nodeValue.split(/(ResQ)/g).filter(Boolean).forEach((part) => {
        if (part === "ResQ") {
          const span = document.createElement("span");
          span.className = "resq-brand";
          span.textContent = part;
          fragment.append(span);
        } else {
          fragment.append(document.createTextNode(part));
        }
      });
      node.replaceWith(fragment);
    });
  }
  applyBrandTypeface();

  const root = document.documentElement;
  const themeToggle = document.querySelector(".theme-toggle");
  const savedTheme = localStorage.getItem("resq-theme");
  const preferredTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  function applyTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (themeToggle) {
      themeToggle.innerHTML = icon(theme === "dark" ? "sun" : "moon");
      themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    }
  }
  applyTheme(savedTheme || preferredTheme);
  themeToggle?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("resq-theme", next); applyTheme(next);
  });

  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".primary-nav");
  function closeMenu() {
    nav?.classList.remove("is-open"); menuToggle?.setAttribute("aria-expanded", "false");
    if (menuToggle) menuToggle.innerHTML = icon("menu");
  }
  menuToggle?.addEventListener("click", () => {
    const open = nav?.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(Boolean(open)));
    menuToggle.innerHTML = icon(open ? "close" : "menu");
  });
  nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

  const blogGrid = document.querySelector("[data-blog-grid]");
  const blogCards = [...(blogGrid?.querySelectorAll("[data-category]") || [])];
  const blogSearch = document.querySelector("[data-blog-search]");
  const blogResults = document.querySelector("[data-blog-results]");
  const blogEmpty = document.querySelector("[data-blog-empty]");
  let activeBlogFilter = "all";
  let activeBlogSearch = "";

  function updateBlogCards() {
    let visibleCount = 0;
    blogCards.forEach((card) => {
      const categories = card.dataset.category.toLowerCase().split(/\s+/);
      const searchableText = `${card.dataset.title || ""} ${card.textContent}`.toLowerCase();
      const categoryMatches = activeBlogFilter === "all" || categories.includes(activeBlogFilter);
      const searchMatches = !activeBlogSearch || searchableText.includes(activeBlogSearch);
      card.hidden = !(categoryMatches && searchMatches);
      if (!card.hidden) visibleCount += 1;
    });
    if (blogResults) blogResults.textContent = `${visibleCount} ${visibleCount === 1 ? "story" : "stories"}`;
    if (blogEmpty) blogEmpty.hidden = visibleCount !== 0;
  }

  function applyFilter(filter) {
    activeBlogFilter = filter;
    document.querySelectorAll("[data-filter]").forEach((item) => {
      const active = item.dataset.filter === filter;
      item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active));
    });
    updateBlogCards();
  }
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    applyFilter(button.dataset.filter);
  }));
  blogSearch?.addEventListener("input", () => {
    activeBlogSearch = blogSearch.value.trim().toLowerCase();
    updateBlogCards();
  });
  const hashFilter = location.hash.slice(1);
  if (hashFilter && document.querySelector(`[data-filter="${CSS.escape(hashFilter)}"]`)) applyFilter(hashFilter);
  else updateBlogCards();

  document.querySelectorAll("[data-accordion-button]").forEach((button) => button.addEventListener("click", () => {
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded)); if (panel) panel.hidden = expanded;
  }));

  const revealTargets = document.querySelectorAll("[data-reveal]");
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    revealTargets.forEach((item) => item.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries, instance) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); instance.unobserve(entry.target); }
    }), { rootMargin: "0px 0px -8%", threshold: 0.08 });
    revealTargets.forEach((item) => observer.observe(item));
  }

  document.querySelectorAll('a[target="_blank"]').forEach((link) => {
    const rel = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
    rel.add("noopener"); rel.add("noreferrer"); link.setAttribute("rel", [...rel].join(" "));
  });
})();
