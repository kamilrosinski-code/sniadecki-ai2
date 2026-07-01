(function () {
  'use strict';

  // Nav scroll
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Mobile menu
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobile-menu');
  const spans = burger.querySelectorAll('span');
  let open = false;

  burger.addEventListener('click', () => {
    open = !open;
    menu.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    spans[0].style.transform = open ? 'translateY(6px) rotate(45deg)' : '';
    spans[1].style.opacity = open ? '0' : '';
    spans[2].style.transform = open ? 'translateY(-6px) rotate(-45deg)' : '';
  });

  document.querySelectorAll('.mm-link').forEach(l =>
    l.addEventListener('click', () => {
      open = false;
      menu.classList.remove('open');
      document.body.style.overflow = '';
      spans[0].style.transform = spans[1].style.opacity = spans[2].style.transform = '';
    })
  );

  // Scroll reveal
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.scard, .fcard, .eco-node, .rm-step, .pillar, .intro-photo-frame, .aerial-frame, .eco-photo, .dataroom-strip').forEach(el => {
    el.classList.add('reveal');
    obs.observe(el);
  });

  // Smooth anchors
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const t = document.querySelector(a.getAttribute('href'));
      if (t) { e.preventDefault(); window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); }
    });
  });

  // Form
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const btn = form.querySelector('.btn-submit');
      const name = form.querySelector('#name').value.trim();
      const email = form.querySelector('#email').value.trim();
      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMsg(form, 'Proszę uzupełnić imię i poprawny adres e-mail.', 'error'); return;
      }
      btn.textContent = 'Wysyłanie…'; btn.disabled = true;
      setTimeout(() => {
        showMsg(form, 'Dziękujemy! Odezwiemy się w ciągu jednego dnia roboczego.', 'success');
        form.reset(); btn.textContent = 'Wyślij wiadomość'; btn.disabled = false;
      }, 1200);
    });
  }

  function showMsg(form, text, type) {
    const old = form.querySelector('.form-message');
    if (old) old.remove();
    const m = document.createElement('p');
    m.className = 'form-message';
    m.textContent = text;
    m.style.cssText = `font-size:.82rem;padding:.75rem 1rem;border-radius:3px;border:1px solid ${type==='success'?'rgba(201,169,110,.35)':'rgba(220,80,80,.35)'};color:${type==='success'?'#c9a96e':'#e07070'};background:${type==='success'?'rgba(201,169,110,.08)':'rgba(220,80,80,.08)'}`;
    form.appendChild(m);
    setTimeout(() => m.remove(), 5000);
  }
})();
