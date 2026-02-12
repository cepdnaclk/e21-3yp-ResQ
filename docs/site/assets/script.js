/* ================================================================
   ResQ Project Website - JavaScript
   Interactivity for Navigation, Filtering, and UI Enhancements
   ================================================================ */

// ================================================================
//   THEME MANAGEMENT WITH LOGO SWAPPING
// ================================================================

function applyTheme(theme) {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", theme === "dark");

    // Swap logo image based on theme
    const logo = document.querySelector("[data-logo]");
    if (logo) {
        logo.src = theme === "dark" ? logo.dataset.logoDark : logo.dataset.logoLight;
    }

    localStorage.setItem("resq-theme", theme);
}

const revealSelectors = [
    '.hero',
    '.page-header',
    'section',
    '.highlight-card',
    '.arch-card',
    '.demo-card',
    '.proposal-card',
    '.scope-card',
    '.user-card',
    '.outcome-item',
    '.status-item',
    '.blog-post',
    '.overview-block',
    '.stack-card',
    '.metric-card',
    '.security-spec',
    '.requirements-box',
    '.step',
    '.workflow-box',
    '.troubleshoot-item',
    '.safety-privacy',
    '.spec-table',
    '.footer'
];

const staggerContainers = [
    '.highlights-grid',
    '.architecture-details',
    '.demo-grid',
    '.proposal-grid',
    '.scope-grid',
    '.users-grid',
    '.outcomes-list',
    '.status-timeline',
    '.blog-posts',
    '.spec-overview',
    '.stack-grid',
    '.metrics-grid',
    '.setup-steps',
    '.troubleshoot-section'
];

function markRevealTargets() {
    revealSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            if (!el.hasAttribute('data-reveal')) {
                el.setAttribute('data-reveal', '');
            }
        });
    });
}

function applyStagger() {
    staggerContainers.forEach(selector => {
        document.querySelectorAll(selector).forEach(container => {
            container.setAttribute('data-stagger', '');
            const children = Array.from(container.children).filter(child => child.matches('[data-reveal], .reveal'));
            children.forEach((child, index) => {
                const delay = Math.min(index * 70, 500);
                child.style.transitionDelay = `${delay}ms`;
            });
        });
    });
}

function initRevealObserver() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const revealables = document.querySelectorAll('[data-reveal], .reveal');

    if (prefersReducedMotion.matches) {
        revealables.forEach(el => {
            el.classList.add('is-visible');
            el.style.transition = 'none';
            el.style.filter = 'none';
            el.style.transform = 'none';
        });
        return;
    }

    const isInViewport = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight * 0.9 && rect.bottom > 0;
    };

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                obs.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.12,
        rootMargin: '0px 0px -10% 0px'
    });

    revealables.forEach(el => {
        if (isInViewport(el)) {
            el.classList.add('is-visible');
        } else {
            observer.observe(el);
        }
    });
}

function wrapResQText() {
    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.includes('ResQ')) return NodeFilter.FILTER_REJECT;
            const parent = node.parentNode;
            if (!parent || skipTags.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
        nodes.push(current);
    }

    nodes.forEach(node => {
        const frag = document.createDocumentFragment();
        node.nodeValue.split(/(ResQ)/).forEach(part => {
            if (!part) return;
            if (part === 'ResQ') {
                const span = document.createElement('span');
                span.className = 'resq-word';
                span.textContent = part;
                frag.appendChild(span);
            } else {
                frag.appendChild(document.createTextNode(part));
            }
        });
        node.parentNode.replaceChild(frag, node);
    });
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', function() {
    const root = document.documentElement;
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const themeToggle = document.querySelector('.theme-toggle');
    
    const savedTheme = localStorage.getItem("resq-theme");
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

    applyTheme(initialTheme);
    wrapResQText();
    
    // Mobile Menu Toggle
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            navMenu.classList.toggle('active');
        });

        // Close menu when a link is clicked
        const navLinks = navMenu.querySelectorAll('a');
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                navMenu.classList.remove('active');
            });
        });
    }
    
    // Theme Toggle with Label Update
    if (themeToggle) {
        const updateLabel = () => {
            const isDark = root.classList.contains("theme-dark");
            themeToggle.textContent = isDark ? 'Light Mode' : 'Dark Mode';
            themeToggle.setAttribute('aria-pressed', String(isDark));
        };
        
        updateLabel();
        
        themeToggle.addEventListener('click', function() {
            const isDark = root.classList.contains("theme-dark");
            applyTheme(isDark ? 'light' : 'dark');
            updateLabel();
        });
    }

    // Blog post filtering
    const filterButtons = document.querySelectorAll('.filter-btn');
    const blogPosts = document.querySelectorAll('.blog-post');

    if (filterButtons.length > 0) {
        filterButtons.forEach(button => {
            button.addEventListener('click', function() {
                const filterValue = this.getAttribute('data-filter');

                // Update active button
                filterButtons.forEach(btn => btn.classList.remove('active'));
                this.classList.add('active');

                // Filter posts
                blogPosts.forEach(post => {
                    if (filterValue === 'all') {
                        post.classList.remove('hidden');
                    } else {
                        const postCategory = post.getAttribute('data-category');
                        if (postCategory === filterValue) {
                            post.classList.remove('hidden');
                        } else {
                            post.classList.add('hidden');
                        }
                    }
                });
            });
        });
    }

    // Smooth scroll handler
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href !== '#' && document.querySelector(href)) {
                e.preventDefault();
                document.querySelector(href).scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // Add scroll-to-top functionality
    const scrollToTopLink = document.querySelector('.scroll-to-top');
    if (scrollToTopLink) {
        window.addEventListener('scroll', function() {
            if (window.scrollY > 300) {
                scrollToTopLink.style.opacity = '1';
                scrollToTopLink.style.pointerEvents = 'auto';
            } else {
                scrollToTopLink.style.opacity = '0';
                scrollToTopLink.style.pointerEvents = 'none';
            }
        });

        scrollToTopLink.addEventListener('click', function(e) {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });

        // Initial state
        scrollToTopLink.style.opacity = '0';
        scrollToTopLink.style.pointerEvents = 'none';
        scrollToTopLink.style.transition = 'opacity 0.3s ease';
    }

    // Reveal animations
    markRevealTargets();
    applyStagger();
    initRevealObserver();
});

// Keyboard navigation support
document.addEventListener('keydown', function(e) {
    // ESC key to close menu
    if (e.key === 'Escape') {
        const navMenu = document.querySelector('.nav-menu');
        if (navMenu) {
            navMenu.classList.remove('active');
        }
    }
});
