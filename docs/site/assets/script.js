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
});

// Utility function to add animation to elements on scroll
function observeElements() {
    const options = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, options);

    // Observe all cards
    document.querySelectorAll('.highlight-card, .proposal-card, .user-card, .blog-post, .metric-card').forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(10px)';
        element.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(element);
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeElements);
} else {
    observeElements();
}

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
