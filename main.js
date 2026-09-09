(function () {
  'use strict';

  // ⬇️ Link do Apps Script zapisujący zgłoszenia do Google Sheets (patrz INSTRUKCJA-FORMULARZ.txt)
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  /* ---------- NAV ---------- */
  const nav = document.getElementById('nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
  }

  /* ---------- MOBILE MENU ---------- */
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobile-menu');
  if (burger && menu) {
    const spans = burger.querySelectorAll('span');
    let open = false;
    const setMenu = (state) => {
      open = state;
      menu.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
      spans[0].style.transform = open ? 'translateY(6px) rotate(45deg)' : '';
      spans[1].style.opacity   = open ? '0' : '';
      spans[2].style.transform = open ? 'translateY(-6px) rotate(-45deg)' : '';
    };
    burger.addEventListener('click', () => setMenu(!open));
    document.querySelectorAll('.mm-link').forEach(l =>
      l.addEventListener('click', () => setMenu(false))
    );
  }

  /* ---------- SCROLL REVEAL ---------- */
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.card, .fmt, .eco-node, .rm, .pillar, .photo-frame, .dataroom')
    .forEach(el => { el.classList.add('reveal'); obs.observe(el); });

  /* ---------- SMOOTH ANCHORS ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (href === '#') return;
      const t = document.querySelector(href);
      if (t) {
        e.preventDefault();
        window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
      }
    });
  });

  /* ---------- WYSZUKIWARKA: 3 KROKI + GOOGLE MAPS ---------- */
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step3 = document.getElementById('step-3');
  const btnNext = document.getElementById('btn-next');
  const btnBack = document.getElementById('btn-back');
  const btnSubmit = document.getElementById('btn-submit');
  const mapLabel = document.getElementById('map-label');
  const mapFrame = document.getElementById('map-frame');
  const mapStatic = document.getElementById('map-static');

  /* ---------- ZAKŁADKI: dwie ścieżki ---------- */
  const tabId = document.getElementById('tab-id');
  const tabNumer = document.getElementById('tab-numer');
  const pathId = document.getElementById('path-id');
  const pathNumer = document.getElementById('path-numer');

  if (tabId && tabNumer) {
    tabId.addEventListener('click', function () {
      tabId.classList.add('active');
      tabNumer.classList.remove('active');
      pathId.classList.remove('hidden');
      pathNumer.classList.add('hidden');
    });
    tabNumer.addEventListener('click', function () {
      tabNumer.classList.add('active');
      tabId.classList.remove('active');
      pathNumer.classList.remove('hidden');
      pathId.classList.add('hidden');
    });
  }

  /* ---------- ŚCIEŻKA A: identyfikator → raport od razu ---------- */
  const btnRaport = document.getElementById('btn-raport');
  const inputId = document.getElementById('s-identyfikator');
  if (btnRaport && inputId) {
    const idzDoRaportu = function () {
      const id = inputId.value.trim();
      if (!id) { flashRow(inputId); return; }

      const emailEl = document.getElementById('s-id-email');
      const telEl = document.getElementById('s-id-tel');
      const email = emailEl ? emailEl.value.trim() : '';
      const tel = telEl ? telEl.value.trim() : '';

      // E-mail wymagany
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { flashRow(emailEl); return; }

      // Zapis do Google Sheets (w tle)
      if (FORM_ENDPOINT && FORM_ENDPOINT !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT') {
        const dane = new FormData();
        dane.append('miejscowosc', '(raport z identyfikatora)');
        dane.append('dzialka', id);
        dane.append('email', email);
        dane.append('telefon', tel);
        dane.append('data', new Date().toLocaleString('pl-PL'));
        fetch(FORM_ENDPOINT, { method: 'POST', body: dane }).catch(function () {});
      }

      // Przekieruj do raportu — flaga ok=1 mówi, że dane już zebrano
      window.location.href = 'raport.html?id=' + encodeURIComponent(id) + '&ok=1';
    };
    btnRaport.addEventListener('click', idzDoRaportu);
    inputId.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { const em = document.getElementById('s-id-email'); if (em) em.focus(); }
    });
    const emailInp = document.getElementById('s-id-email');
    if (emailInp) emailInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') idzDoRaportu(); });
  }

  function flashRow(el) {
    if (!el) return;
    const row = el.closest('.search-row');
    if (row) { row.style.borderColor = '#c9a96e'; setTimeout(function(){ row.style.borderColor=''; }, 1600); }
    el.focus();
  }

  // Zmienna przechowująca instancję mapy Leaflet i aktualne współrzędne środka
  let leafletMap = null;
  let aktualneWspolrzedne = { lat: null, lng: null };

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const miasto = document.getElementById('s-miasto').value.trim();
      const dzialka = document.getElementById('s-dzialka').value.trim();

      if (!miasto) { flash(document.getElementById('s-miasto')); return; }
      if (!dzialka) { flash(document.getElementById('s-dzialka')); return; }

      step1.classList.add('hidden');
      step2.classList.remove('hidden');

      // Inicjalizuj mapę Leaflet (raz) i wyśrodkuj na miejscowości
      setTimeout(function () { inicjalizujMape(miasto); }, 150);
    });
  }

  function inicjalizujMape(miasto) {
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl) return;

    // Bezpiecznik: jeśli Leaflet się nie załadował (blokada CDN), pokaż komunikat
    if (typeof L === 'undefined') {
      mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:2rem;text-align:center;color:var(--m);font-size:.85rem;">Mapa chwilowo niedostępna. Możesz kontynuować — podaj e-mail, a my zlokalizujemy działkę po numerze i miejscowości.</div>';
      const pin = document.getElementById('map-arrow');
      if (pin) pin.style.display = 'none';
      const hint = document.getElementById('map-coords-hint');
      if (hint) hint.textContent = '';
      return;
    }

    if (!leafletMap) {
      // Domyślnie środek Polski; zaraz przesuniemy na miejscowość
      leafletMap = L.map('leaflet-map', {
        center: [52.11, 19.42],
        zoom: 6,
        zoomControl: true,
        attributionControl: true
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(leafletMap);

      // Zapisuj współrzędne środka przy każdym przesunięciu mapy
      const aktualizujWsp = function () {
        const c = leafletMap.getCenter();
        aktualneWspolrzedne = { lat: c.lat, lng: c.lng };
        const hint = document.getElementById('map-coords-hint');
        if (hint) {
          hint.textContent = 'Pinezka wskazuje: ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) +
            ' — przesuń mapę, aby dostosować.';
        }
      };
      leafletMap.on('move', aktualizujWsp);
      leafletMap.on('moveend', aktualizujWsp);
      aktualizujWsp();
    } else {
      leafletMap.invalidateSize();
    }

    // Geokoduj miejscowość przez Nominatim (OpenStreetMap) — darmowe, bez klucza
    const q = encodeURIComponent(miasto + ', Polska');
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q, {
      headers: { 'Accept-Language': 'pl' }
    })
      .then(function (r) { return r.json(); })
      .then(function (wyniki) {
        if (wyniki && wyniki.length) {
          const lat = parseFloat(wyniki[0].lat), lng = parseFloat(wyniki[0].lon);
          leafletMap.setView([lat, lng], 15);
        }
      })
      .catch(function () { /* zostaje domyślny widok */ })
      .finally(function () { leafletMap.invalidateSize(); });
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      step2.classList.add('hidden');
      step1.classList.remove('hidden');
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      const email = document.getElementById('s-email').value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        flash(document.getElementById('s-email'));
        return;
      }

      const miasto = document.getElementById('s-miasto').value.trim();
      const dzialka = document.getElementById('s-dzialka').value.trim();
      const telefon = document.getElementById('s-telefon') ? document.getElementById('s-telefon').value.trim() : '';

      // Odczytaj współrzędne środka mapy (pod pinezką)
      let wsp = '';
      if (leafletMap) {
        const c = leafletMap.getCenter();
        wsp = c.lat.toFixed(6) + ', ' + c.lng.toFixed(6);
      } else if (aktualneWspolrzedne.lat) {
        wsp = aktualneWspolrzedne.lat.toFixed(6) + ', ' + aktualneWspolrzedne.lng.toFixed(6);
      }

      // Pokaż potwierdzenie od razu
      step2.classList.add('hidden');
      step3.classList.remove('hidden');

      // Zapisz dane do arkusza Google (w tle) — z współrzędnymi
      if (FORM_ENDPOINT && FORM_ENDPOINT !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT') {
        const dane = new FormData();
        dane.append('miejscowosc', miasto);
        dane.append('dzialka', dzialka);
        dane.append('email', email);
        dane.append('telefon', telefon);
        dane.append('wspolrzedne', wsp);
        dane.append('mapa_link', wsp ? 'https://www.google.com/maps?q=' + encodeURIComponent(wsp) : '');
        dane.append('data', new Date().toLocaleString('pl-PL'));

        fetch(FORM_ENDPOINT, { method: 'POST', body: dane })
          .catch(function (e) { console.warn('Zapis do arkusza nieudany:', e); });
      }
    });
  }

  function flash(el) {
    if (!el) return;
    const row = el.closest('.search-row');
    if (row) {
      row.style.borderColor = '#c9a96e';
      setTimeout(() => { row.style.borderColor = ''; }, 1600);
    }
    el.focus();
  }

  /* ---------- FORMULARZ KONTAKTOWY ---------- */
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const name = document.getElementById('c-name').value.trim();
      const email = document.getElementById('c-email').value.trim();

      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMsg(form, 'Proszę uzupełnić imię i poprawny adres e-mail.', 'error');
        return;
      }

      btn.textContent = 'Wysyłanie…';
      btn.disabled = true;

      setTimeout(() => {
        showMsg(form, 'Dziękujemy! Odezwiemy się w ciągu jednego dnia roboczego.', 'success');
        form.reset();
        btn.textContent = 'Wyślij wiadomość';
        btn.disabled = false;
      }, 1100);
    });
  }

  function showMsg(form, text, type) {
    const old = form.querySelector('.form-message');
    if (old) old.remove();
    const m = document.createElement('p');
    m.className = 'form-message';
    m.textContent = text;
    const ok = type === 'success';
    m.style.cssText = 'font-size:.82rem;padding:.75rem 1rem;border-radius:3px;border:1px solid ' +
      (ok ? 'rgba(201,169,110,.35)' : 'rgba(220,80,80,.35)') + ';color:' +
      (ok ? '#c9a96e' : '#e07070') + ';background:' +
      (ok ? 'rgba(201,169,110,.08)' : 'rgba(220,80,80,.08)');
    form.appendChild(m);
    setTimeout(() => m.remove(), 6000);
  }
})();

/* ===========================================================
   CMS: TREŚCI Z GOOGLE SHEETS
   -----------------------------------------------------------
   Strona pobiera opublikowany arkusz (CSV) i podstawia teksty
   do elementów oznaczonych atrybutem data-cms.
   Instrukcja publikacji arkusza — w pliku INSTRUKCJA.txt
   =========================================================== */
(function () {
  'use strict';

  // ⬇️ TU WKLEJ LINK CSV z Google Sheets (Plik → Udostępnij → Opublikuj w internecie → CSV)
  const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbR8JiZTcGO4fTshrnGgqZhSr3BYEi8hCEcb2EKr2CfcsO6xlwaEkTbH1F9xt015D-jf_0iPnMfTvM/pubhtml';

  // Jeśli link nie został jeszcze ustawiony — nie rób nic (strona pokaże domyślne teksty z HTML)
  if (!SHEET_CSV_URL || SHEET_CSV_URL === 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbR8JiZTcGO4fTshrnGgqZhSr3BYEi8hCEcb2EKr2CfcsO6xlwaEkTbH1F9xt015D-jf_0iPnMfTvM/pubhtml') return;

  fetch(SHEET_CSV_URL)
    .then(function (r) { return r.text(); })
    .then(function (csv) {
      const data = parseCSV(csv);
      // data to tablica wierszy; oczekujemy kolumn: klucz, tresc
      const map = {};
      data.forEach(function (row) {
        if (row.length >= 2 && row[0]) {
          map[row[0].trim()] = row[1];
        }
      });
      // Podstaw treści
      document.querySelectorAll('[data-cms]').forEach(function (el) {
        const key = el.getAttribute('data-cms');
        if (map[key] !== undefined && map[key] !== '') {
          // Pozwól na <br> i <em> w treści z arkusza
          el.innerHTML = map[key];
        }
      });
    })
    .catch(function (e) {
      console.warn('CMS: nie udało się pobrać arkusza —', e);
      // Strona pokaże domyślne teksty z HTML
    });

  // Prosty parser CSV (obsługuje cudzysłowy i przecinki w treści)
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* ignoruj */ }
        else { field += c; }
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
})();
