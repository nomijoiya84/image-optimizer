/**
 * Trust Elements - Animated counters and scroll animations
 */

(function () {
    'use strict';

    // Animated Counter
    function animateCounter(element, target, suffix = '') {
        const duration = 2000;
        const start = 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (ease-out cubic)
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(start + (target - start) * easeProgress);

            element.textContent = current.toLocaleString() + suffix;

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }

    // Initialize counters when they come into view
    function initCounters() {
        const counters = document.querySelectorAll('.stat-counter .count');

        if (counters.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !entry.target.dataset.animated) {
                    entry.target.dataset.animated = 'true';

                    const text = entry.target.textContent.trim();
                    const match = text.match(/^([\d,]+)(.*)$/);

                    if (match) {
                        const number = parseInt(match[1].replace(/,/g, ''), 10);
                        const suffix = match[2] || '';
                        animateCounter(entry.target, number, suffix);
                    }
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(counter => observer.observe(counter));
    }

    // Scroll-triggered fade-in animations
    function initScrollAnimations() {
        const elements = document.querySelectorAll('.fade-in-up');

        if (elements.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        elements.forEach(el => observer.observe(el));
    }

    // Smooth scroll for demo CTA
    function initSmoothScroll() {
        const demoCta = document.querySelector('.demo-cta');

        if (demoCta) {
            demoCta.addEventListener('click', (e) => {
                e.preventDefault();
                const uploadArea = document.getElementById('uploadArea');
                if (uploadArea) {
                    uploadArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Add a brief highlight effect
                    uploadArea.classList.add('dragover');
                    setTimeout(() => uploadArea.classList.remove('dragover'), 1500);
                }
            });
        }
    }

    // Initialize everything when DOM is ready
    function init() {
        initCounters();
        initScrollAnimations();
        initSmoothScroll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
