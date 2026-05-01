/**
 * main.js — Portfolio interactions
 *
 * - Custom cursor (dot + ring with crosshair)
 * - Parallax on desk-object photos
 * - Nav auto-hide on scroll
 * - Scroll-triggered fade-in (IntersectionObserver)
 */

(function () {
  'use strict';

  /* ──────────────────────────────
     Custom Cursor
     ────────────────────────────── */

  const dot  = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  let mx = 0, my = 0;   // mouse position
  let rx = 0, ry = 0;   // ring position (lerped)

  document.addEventListener('mousemove', (e) => {
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';
  });

  function animateRing() {
    rx += (mx - rx) * 0.15;
    ry += (my - ry) * 0.15;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  // Enlarge cursor on interactive elements
  const interactiveEls = document.querySelectorAll(
    'a, .index-card, .skill-pill, .desk-object'
  );

  interactiveEls.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      ring.style.width  = '48px';
      ring.style.height = '48px';
    });
    el.addEventListener('mouseleave', () => {
      ring.style.width  = '32px';
      ring.style.height = '32px';
    });
  });


  /* ──────────────────────────────
     Parallax on desk-object photos
     ────────────────────────────── */

  const deskObjects = document.querySelectorAll('.desk-object');
  let ticking = false;

  function updateParallax() {
    const scrollY = window.scrollY;

    deskObjects.forEach((obj, i) => {
      const speed  = 0.03 + (i % 3) * 0.015;
      const offset = (scrollY - obj.offsetTop) * speed;
      const rot    = obj.style.getPropertyValue('--rot') || '0deg';
      obj.style.transform = `rotate(${rot}) translateY(${offset}px)`;
    });

    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateParallax);
      ticking = true;
    }
  });


  /* ──────────────────────────────
     Nav hide / show on scroll
     ────────────────────────────── */

  const nav = document.querySelector('nav');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const current = window.scrollY;

    if (current > lastScroll && current > 80) {
      nav.classList.add('hidden');
    } else {
      nav.classList.remove('hidden');
    }

    lastScroll = current;
  });


  /* ──────────────────────────────
     Scroll-triggered fade-in
     ────────────────────────────── */

  const fadeEls = document.querySelectorAll(
    '.index-card, .timeline-item, .skill-pill, .section-header'
  );

  fadeEls.forEach((el) => {
    el.style.opacity    = '0';
    el.style.transform  = (el.style.transform || '') + ' translateY(20px)';
    el.style.transition = (el.style.transition || '') +
                          ', opacity 0.6s ease, transform 0.6s ease';
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const el  = entry.target;
        el.style.opacity = '1';

        // Restore the element's natural transform
        if (el.classList.contains('skill-pill')) {
          const rot = el.style.getPropertyValue('--rot') || '0deg';
          el.style.transform = `rotate(${rot})`;

        } else if (el.classList.contains('index-card')) {
          const idx = Array.from(el.parentElement.children).indexOf(el);
          el.style.transform = idx % 2 === 0
            ? 'rotate(-1.2deg)'
            : 'rotate(0.8deg)';

        } else {
          el.style.transform = 'translateY(0)';
        }

        observer.unobserve(el);
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );

  fadeEls.forEach((el) => observer.observe(el));


  /* ──────────────────────────────
     Stagger skill-pill entrance
     ────────────────────────────── */

  document.querySelectorAll('.skill-pill').forEach((pill, i) => {
    pill.style.transitionDelay = (i * 0.04) + 's';
  });

})();
