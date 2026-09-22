(function () {
  'use strict';

  // Posrednik do ULDK + transakcji (Apps Script). Puste = tryb demo (mapy dzialaja, dane opisowe nie).
  const ULDK_PROXY = 'https://script.google.com/macros/s/AKfycbzMevjlU6LD5YKp37spIFdNf8lEfkUWL03PuK8N2Ey8HqBBjBiPgvJASVGQP1yLp_Tf/exec';

  // Zapis zgloszen z raportu do Google Sheets (ten sam co formularz na stronie glownej).
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  // ⬇️ Statystyki gmin z pliku CSV na Google Drive (opublikowany jako CSV).
  //    Puste = sekcja statystyk gminy ukryta. Patrz INSTRUKCJA-STATYSTYKI.txt
  const STATS_CSV_URL = 'WKLEJ_TUTAJ_LINK_CSV_STATYSTYKI';

  // ⬇️ WLASNA BAZA CEN transakcyjnych (RCN z geoforum, przetworzona do CSV) na Google Drive.
  //    Puste = uzywana jest tylko warstwa WMS cen z Geoportalu. Patrz INSTRUKCJA-CENY-BAZA.txt
  const CENY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQEZXE_tccUW0_ktbxwJW6C2RL1TLSAssbYaWSbNlWX2YTLeMzIIGVCMAD5pA9JwCKdmb-iZvN6A43X/pub?gid=0&single=true&output=csv';

  // ⬇️ BACKEND SQL (opcjonalny). Jesli ustawiony, raport pyta backend zamiast CSV —
  //    szybciej i skalowalnie. Jesli pusty albo backend nie odpowie, uzywa CSV jako zapasu.
  //    Przyklad: 'https://twoj-serwer-lh.pl/ceny'  albo  'http://localhost:5000/ceny' (test)
  const BACKEND_CENY_URL = 'WKLEJ_TUTAJ_LINK_BACKENDU';

  const $ = function (id) { return document.getElementById(id); };

  // ===== POCZEKALNIA (ekran ladowania) =====
  let poczekalniaTimer = null;
  function pokazPoczekalnie() {
    const ov = $('loading-overlay');
    if (!ov) return;
    ov.classList.add('show');

    const kroki = [
      'Pobieramy dane dzialki z rejestru GUGiK...',
      'Wczytujemy ortofotomape i granice ewidencyjne...',
      'Nakladamy plan zagospodarowania (MPZP)...',
      'Sprawdzamy ceny transakcyjne w okolicy...',
      'Analizujemy uzbrojenie terenu i sieci...',
      'Sprawdzamy formy ochrony przyrody i zabytki...',
      'Skladamy raport w calosc...'
    ];
    let i = 0;
    const krokEl = $('loading-krok');
    const barEl = $('loading-bar-fill');
    const N = kroki.length;
    if (krokEl) krokEl.textContent = kroki[0];
    if (barEl) barEl.style.width = Math.round(100 / N) + '%';

    poczekalniaTimer = setInterval(function () {
      i++;
      if (i < N) {
        if (krokEl) krokEl.textContent = kroki[i];
        if (barEl) barEl.style.width = Math.round(((i + 1) / N) * 100) + '%';
      }
    }, 6000);

    // Domknij po max 60s (gdyby cos zawieszlo, raport i tak sie pokaze)
    setTimeout(ukryjPoczekalnie, 60000);
  }
  function ukryjPoczekalnie() {
    const ov = $('loading-overlay');
    const barEl = $('loading-bar-fill');
    if (barEl) barEl.style.width = '100%';
    if (poczekalniaTimer) { clearInterval(poczekalniaTimer); poczekalniaTimer = null; }
    if (ov) { setTimeout(function () { ov.classList.remove('show'); }, 400); }
  }
  const start = $('start'), report = $('report');
  const input = $('id-input');
  const btnGen = $('btn-generuj'), btnNowa = $('btn-nowa'), btnPdf = $('btn-pdf');

  document.querySelectorAll('.chip').forEach(function (c) {
    c.addEventListener('click', function () { input.value = c.getAttribute('data-id'); input.focus(); });
  });
  $('btn-pokazmape').addEventListener('click', function () {
    const m = $('pickmap');
    m.classList.toggle('show');
    if (m.classList.contains('show') && !m.dataset.loaded) {
      m.innerHTML = '<iframe src="https://mapy.geoportal.gov.pl/imap/Imgp_2.html?locale=pl&gpmap=gp0" title="Geoportal"></iframe>';
      m.dataset.loaded = '1';
    }
  });

  btnGen.addEventListener('click', function () { generuj(false); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { const em = $('r-email'); if (em) em.focus(); } });
  const emailField = $('r-email');
  if (emailField) emailField.addEventListener('keydown', function (e) { if (e.key === 'Enter') generuj(false); });
  btnNowa.addEventListener('click', function () {
    report.classList.remove('show'); start.style.display = 'flex';
    btnNowa.style.display = 'none'; btnPdf.style.display = 'none';
    input.value = ''; input.focus();
    window.scrollTo(0, 0);
  });
  btnPdf.addEventListener('click', function () { window.print(); });

  // Wejscie z URL:
  //  ?id=...&ok=1  → dane zebrano na stronie glownej, generuj od razu
  //  ?id=...       → wypelnij ID, ale wymagaj e-maila (klient wszedl bezposrednio)
  (function () {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const ok = params.get('ok');
    if (id) {
      input.value = id;
      if (ok === '1') {
        // Dane juz zebrane i zapisane na stronie glownej — pomijamy walidacje e-maila
        generuj(true);
      } else {
        const emailEl = $('r-email');
        if (emailEl) emailEl.focus();
      }
    }
  })();

  function generuj(pomijEmail) {
    const id = input.value.trim();
    if (!id) { input.style.borderColor = '#b08d3e'; input.focus(); return; }

    const emailEl = $('r-email');
    const telEl = $('r-tel');
    const email = emailEl ? emailEl.value.trim() : '';
    const tel = telEl ? telEl.value.trim() : '';

    // Walidacja e-maila (chyba ze dane juz zebrano na stronie glownej — pomijEmail=true)
    if (!pomijEmail && emailEl) {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailEl.style.borderColor = '#b08d3e';
        emailEl.focus();
        return;
      }
      emailEl.style.borderColor = '';
    }

    // Zapis do Google Sheets — tylko gdy dane wpisano tutaj (nie gdy juz zapisano na stronie glownej)
    if (!pomijEmail && FORM_ENDPOINT && FORM_ENDPOINT !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT' && email) {
      const dane = new FormData();
      dane.append('miejscowosc', '(raport z identyfikatora)');
      dane.append('dzialka', id);
      dane.append('email', email);
      dane.append('telefon', tel);
      dane.append('data', new Date().toLocaleString('pl-PL'));
      fetch(FORM_ENDPOINT, { method: 'POST', body: dane }).catch(function () {});
    }

    start.style.display = 'none';
    report.classList.add('show');
    btnNowa.style.display = 'inline-flex';
    btnPdf.style.display = 'inline-flex';
    window.scrollTo(0, 0);

    // Pokaz poczekalnie na czas ladowania warstw
    pokazPoczekalnie();

    const dzis = new Date().toLocaleDateString('pl-PL');
    $('rep-date').textContent = dzis;
    $('rep-date2').textContent = dzis;
    $('rep-id').textContent = id;
    $('p-id').textContent = id;

    if (ULDK_PROXY && ULDK_PROXY !== 'WKLEJ_TUTAJ_LINK_APPS_SCRIPT_ULDK') {
      pobierzDane(id);
    } else {
      trybDemo(id);
    }
  }

  function pobierzDane(id) {
    $('rep-notice').innerHTML = 'Pobieranie danych z rejestru GUGiK...';
    fetch(ULDK_PROXY + '?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error || !data.geom_wkt) throw new Error(data.error || 'brak danych');
        renderuj(id, data);
      })
      .catch(function (e) {
        console.warn('ULDK:', e);
        $('rep-notice').innerHTML = '<strong>Nie udalo sie pobrac danych</strong> dla tego identyfikatora. Sprawdz format (TERYT_ARKUSZ.OBREB.NUMER) lub wskaz dzialke na mapie.';
        trybDemo(id, true);
      });
  }

  function renderuj(id, data) {
    const woj = data.voivodeship || '—', powiat = data.county || '—';
    const gmina = data.commune || '—', obreb = data.region || '—';
    const nr = data.parcel || id.split('.').pop();
    const area = data.powierzchnia ? Math.round(data.powierzchnia).toLocaleString('pl-PL') + ' m2' : '—';
    const ha = data.powierzchnia ? (data.powierzchnia / 10000).toFixed(2) + ' ha' : '';

    $('rep-title').textContent = 'Dzialka nr ' + nr;
    $('rep-sub').textContent = (ha ? ha + ' · ' : '') + 'gm. ' + gmina + ', ' + powiat + ', woj. ' + woj;
    $('rep-area').textContent = area;
    $('rep-loc').textContent = woj;
    $('p-obreb').textContent = obreb; $('p-area').textContent = area;
    $('p-gmina').textContent = gmina; $('p-powiat').textContent = powiat; $('p-woj').textContent = woj;

    const bbox = bboxZWKT(data.geom_wkt);
    if (bbox) {
      const c = srodek(bbox);
      $('rep-coords').textContent = coords(c.lat, c.lon);
      rysujMapy(bbox, data.geom_wkt);
      // Zapamietaj parametry do przeliczania wyceny po zmianie typu
      window._wycenaParam = { lat: c.lat, lon: c.lon, powierzchnia: data.powierzchnia };
      // Ustaw przelacznik typu wg wykrycia z ULDK (zabudowa: zabudowana/niezabudowana/nieznana)
      ustawTypPorownania(data.zabudowa);
      // Ceny z WLASNEJ bazy — rodzaj wg wykrytego/wybranego typu
      const rodzajStart = (data.zabudowa === 'zabudowana') ? 'zabudowana' : 'niezabudowana';
      pobierzCenyZBazy(c.lat, c.lon, data.powierzchnia, rodzajStart);
    }
    $('rep-notice').innerHTML = '<strong>Dane rzeczywiste</strong> z rejestru GUGiK (ULDK) dla ' + id + '.';

    // Streszczenie na gorze — parametry
    if ($('pods-pow')) $('pods-pow').textContent = area;
    if ($('pods-lok')) $('pods-lok').textContent = 'gm. ' + gmina + ', ' + woj;

    // Statystyki gminy z Google Drive (jesli podlaczone)
    pobierzStatystykiGminy(gmina, powiat, woj);

    // Transakcje z pobliza (jesli posrednik zwrocil)
    if (data.transakcje && data.transakcje.length) {
      rysujTransakcje(data.transakcje);
      // Policz orientacyjna wartosc: mediana ceny/m2 x powierzchnia
      wyliczCene(data.transakcje, data.powierzchnia);
    }
  }

  // Ustawia przelacznik typu porownania (niezabudowana/zabudowana) nad wycena.
  // domyslny = wykryty z ULDK; klient moze zmienic, wtedy wycena sie przelicza.
  function ustawTypPorownania(zabudowa) {
    const box = document.getElementById('typ-porownania');
    if (!box) return;
    const domyslny = (zabudowa === 'zabudowana') ? 'zabudowana' : 'niezabudowana';
    const wykryto = (zabudowa === 'zabudowana' || zabudowa === 'niezabudowana');

    box.innerHTML =
      '<span class="typ-label">Porownuj z dzialkami:</span>' +
      '<button class="typ-btn' + (domyslny === 'niezabudowana' ? ' typ-aktywny' : '') + '" data-typ="niezabudowana">niezabudowanymi</button>' +
      '<button class="typ-btn' + (domyslny === 'zabudowana' ? ' typ-aktywny' : '') + '" data-typ="zabudowana">zabudowanymi</button>' +
      (wykryto ? '<span class="typ-hint">wykryto: ' + zabudowa + '</span>' : '<span class="typ-hint">wybierz typ dzialki</span>');
    box.style.display = 'flex';

    box.querySelectorAll('.typ-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        box.querySelectorAll('.typ-btn').forEach(function (b) { b.classList.remove('typ-aktywny'); });
        btn.classList.add('typ-aktywny');
        const nowyTyp = btn.getAttribute('data-typ');
        // Przelicz wycene dla nowego typu
        const p = window._wycenaParam;
        if (p) pobierzCenyZBazy(p.lat, p.lon, p.powierzchnia, nowyTyp);
      });
    });
  }

  // Pobiera WLASNA baze cen (CSV z Google Drive), filtruje po odleglosci od dzialki,
  // liczy mediane i wypelnia liste transakcji + wartosc orientacyjna.
  function pobierzCenyZBazy(lat, lon, powierzchnia, rodzaj) {
    rodzaj = rodzaj || 'niezabudowana';
    // NAJPIERW sprobuj backend SQL (jesli ustawiony) — szybszy i skalowalny.
    if (BACKEND_CENY_URL && BACKEND_CENY_URL !== 'WKLEJ_TUTAJ_LINK_BACKENDU') {
      const url = BACKEND_CENY_URL + '?lon=' + lon + '&lat=' + lat + '&promien=1500&rodzaj=' + rodzaj;
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('backend nie odpowiada');
          return r.json();
        })
        .then(function (dane) {
          if (!dane || !dane.transakcje) throw new Error('brak danych z backendu');
          // Przelicz format backendu na to, czego oczekuje reszta raportu
          const bliskie = dane.transakcje.map(function (t) {
            return {
              dist: t.odleglosc_m || 0,
              cena: t.cena || 0,
              cenaM2: t.cena_m2 || 0,
              pow: t.powierzchnia_m2 || 0,
              data: t.data || '',
              rodzaj: t.rodzaj || '',
              mpzp: t.mpzp || '',
              id: t.id_dzialki || '',
              lon: parseFloat(t.lon) || 0,
              lat: parseFloat(t.lat) || 0
            };
          });
          if (!bliskie.length) return;
          // Mediana prosto z backendu (juz policzona po stronie serwera)
          if (dane.mediana_cena_m2 && powierzchnia && $('pods-cena')) {
            const wartosc = Math.round(dane.mediana_cena_m2 * powierzchnia);
            $('pods-cena').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
            if ($('pods-cena-sub')) {
              $('pods-cena-sub').textContent = 'mediana ' + Math.round(dane.mediana_cena_m2).toLocaleString('pl-PL') +
                ' zl/m2 z ' + dane.liczba_transakcji + ' transakcji w promieniu 1,5 km';
            }
          }
          rysujTransakcjeZBazy(bliskie.slice(0, 20));
        })
        .catch(function () {
          // Backend nie zadzialal — sprobuj CSV jako zapas
          pobierzCenyZCSV(lat, lon, powierzchnia);
        });
      return;
    }
    // Brak backendu — od razu CSV
    pobierzCenyZCSV(lat, lon, powierzchnia);
  }

  // Zapasowe zrodlo cen: plik CSV z Google Drive (dziala gdy nie ma backendu)
  function pobierzCenyZCSV(lat, lon, powierzchnia) {
    if (!CENY_CSV_URL || CENY_CSV_URL === 'WKLEJ_TUTAJ_LINK_CSV_CENY') return;

    fetch(CENY_CSV_URL)
      .then(function (r) { return r.text(); })
      .then(function (csv) {
        const wiersze = parseCSVprosty(csv);
        if (wiersze.length < 2) return;
        const nag = wiersze[0].map(function (h) { return h.trim().toLowerCase(); });
        const iLon = nag.indexOf('lon'), iLat = nag.indexOf('lat');
        const iCena = nag.indexOf('cena'), iM2 = nag.indexOf('cena_m2');
        const iPow = nag.indexOf('powierzchnia_m2'), iData = nag.indexOf('data');
        const iRodzaj = nag.indexOf('rodzaj'), iMpzp = nag.indexOf('przeznaczenie_mpzp');
        const iId = nag.indexOf('id_dzialki');
        if (iLon < 0 || iLat < 0) return;

        // Policz odleglosc kazdej transakcji od dzialki (przyblizenie plaskie, PL)
        const cosLat = Math.cos(lat * Math.PI / 180);
        const bliskie = [];
        for (let i = 1; i < wiersze.length; i++) {
          const w = wiersze[i];
          const tlon = parseFloat(w[iLon]), tlat = parseFloat(w[iLat]);
          if (isNaN(tlon) || isNaN(tlat)) continue;
          const dx = (tlon - lon) * 111320 * cosLat;
          const dy = (tlat - lat) * 111320;
          const dist = Math.sqrt(dx * dx + dy * dy);  // metry
          if (dist <= 1500) {  // promien 1.5 km
            const cM2 = iM2 >= 0 ? (parseFloat(w[iM2]) || 0) : 0;
            // Filtr zdroworozsadkowy: odrzuc ceny/m2 poza realnym zakresem
            // (bledne dane: udzialy, ulamki powierzchni daja absurdalne stawki)
            const cM2ok = (cM2 >= 50 && cM2 <= 50000) ? cM2 : 0;
            bliskie.push({
              dist: dist,
              cena: parseFloat(w[iCena]) || 0,
              cenaM2: cM2ok,
              pow: iPow >= 0 ? (parseFloat(w[iPow]) || 0) : 0,
              data: iData >= 0 ? w[iData] : '',
              rodzaj: iRodzaj >= 0 ? w[iRodzaj] : '',
              mpzp: iMpzp >= 0 ? w[iMpzp] : '',
              id: iId >= 0 ? w[iId] : ''
            });
          }
        }
        if (!bliskie.length) return;

        // Sortuj po odleglosci
        bliskie.sort(function (a, b) { return a.dist - b.dist; });

        // Mediana ceny/m2 (tylko z cena_m2 > 0)
        const stawki = bliskie.filter(function (t) { return t.cenaM2 > 0; }).map(function (t) { return t.cenaM2; });
        if (stawki.length) {
          stawki.sort(function (a, b) { return a - b; });
          const mediana = stawki[Math.floor(stawki.length / 2)];
          // Wartosc orientacyjna w streszczeniu
          if (powierzchnia && $('pods-cena')) {
            const wartosc = Math.round(mediana * powierzchnia);
            $('pods-cena').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
            if ($('pods-cena-sub')) {
              $('pods-cena-sub').textContent = 'mediana ' + Math.round(mediana).toLocaleString('pl-PL') +
                ' zl/m2 z ' + stawki.length + ' transakcji w promieniu 1,5 km';
            }
          }
        }

        // Wypelnij liste transakcji (do 20 najblizszych)
        rysujTransakcjeZBazy(bliskie.slice(0, 20));
      })
      .catch(function (e) { console.warn('Baza cen:', e); });
  }

  function rysujTransakcjeZBazy(txs) {
    const table = $('tx-table');
    if (!table) return;
    const empty = $('tx-empty');
    if (empty) empty.remove();
    // Usun ewentualne poprzednie wiersze (poza naglowkiem)
    table.querySelectorAll('.tx-row:not(.tx-head)').forEach(function (el) { el.remove(); });

    txs.forEach(function (t) {
      const row = document.createElement('div');
      row.className = 'tx-row';
      const odl = t.dist < 1000 ? Math.round(t.dist) + ' m' : (t.dist / 1000).toFixed(1) + ' km';
      const opis = (t.rodzaj || 'transakcja') + (t.mpzp ? ' · ' + t.mpzp : '') + ' · ' + odl;
      row.innerHTML =
        '<div class="tx-addr">' + opis + '<small>' + (t.id || '') + '</small></div>' +
        '<div class="tx-price">' + (t.cena ? Math.round(t.cena).toLocaleString('pl-PL') + ' zl' : '—') + '</div>' +
        '<div class="tx-perm2">' + (t.cenaM2 ? Math.round(t.cenaM2).toLocaleString('pl-PL') + ' zl/m2' : '—') + '</div>' +
        '<div class="tx-date">' + (t.data || '—') + '</div>';
      table.appendChild(row);
    });

    // Nanies transakcje jako punkty na mape cen
    naniesTransakcjeNaMape(txs);
  }

  // Rysuje punkty transakcji na mapie cen — kolor wg ceny za m2 (tanie -> drogie)
  function naniesTransakcjeNaMape(txs) {
    const img = document.getElementById('map-ceny');
    const bbox = window._cenyBbox, wh = window._cenyWH;
    if (!img || !bbox || !wh) return;
    const box = img.parentElement;
    if (!box) return;

    const minLon = bbox[0], minLat = bbox[1], maxLon = bbox[2], maxLat = bbox[3];
    const szerLon = maxLon - minLon, szerLat = maxLat - minLat;
    if (szerLon <= 0 || szerLat <= 0) return;

    const ceny = txs.filter(function (t) { return t.cenaM2 > 0; }).map(function (t) { return t.cenaM2; }).sort(function (a, b) { return a - b; });
    if (!ceny.length) return;
    const cMin = ceny[Math.floor(ceny.length * 0.1)];
    const cMax = ceny[Math.floor(ceny.length * 0.9)] || ceny[ceny.length - 1];

    const kolor = function (c) {
      let t = (c - cMin) / (cMax - cMin || 1);
      t = Math.max(0, Math.min(1, t));
      const r = t < 0.5 ? Math.round(80 + t * 2 * 175) : 255;
      const g = t < 0.5 ? 200 : Math.round(200 - (t - 0.5) * 2 * 160);
      return 'rgb(' + r + ',' + g + ',60)';
    };

    let punkty = '';
    txs.forEach(function (t) {
      if (!t.lon || !t.lat || !t.cenaM2) return;
      const x = ((t.lon - minLon) / szerLon) * wh.W;
      const y = ((maxLat - t.lat) / szerLat) * wh.H;
      if (x < 0 || x > wh.W || y < 0 || y > wh.H) return;
      punkty += '<circle cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) + '" r="7" fill="' + kolor(t.cenaM2) + '" stroke="#0b0c0a" stroke-width="1.5" opacity="0.9"/>';
    });
    if (!punkty) return;

    const stary = box.querySelector('.ceny-punkty');
    if (stary) stary.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ceny-punkty');
    svg.setAttribute('viewBox', '0 0 ' + wh.W + ' ' + wh.H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';
    svg.innerHTML = punkty;
    box.appendChild(svg);
  }

  // Wylicza orientacyjna wartosc dzialki z mediany cen/m2 transakcji
  function wyliczCene(txs, powierzchnia) {
    if (!powierzchnia) return;
    const stawki = [];
    txs.forEach(function (t) {
      if (t.cenaM2) {
        const v = parseFloat(String(t.cenaM2).replace(/[^\d.]/g, ''));
        if (v > 0 && v < 100000) stawki.push(v);
      } else if (t.cena && t._pow) {
        const v = t.cena / t._pow;
        if (v > 0) stawki.push(v);
      }
    });
    if (!stawki.length) return;
    stawki.sort(function (a, b) { return a - b; });
    const mediana = stawki[Math.floor(stawki.length / 2)];
    const wartosc = Math.round(mediana * powierzchnia);
    if ($('pods-cena')) {
      $('pods-cena').textContent = wartosc.toLocaleString('pl-PL') + ' zl';
    }
    if ($('pods-cena-sub')) {
      $('pods-cena-sub').textContent = 'mediana ' + Math.round(mediana).toLocaleString('pl-PL') + ' zl/m2 z ' + statTxt(stawki.length) + ' w okolicy';
    }
  }
  function statTxt(n) { return n + ' transakcji'; }

  // Pobiera statystyki gminy z pliku CSV na Google Drive (opcjonalne)
  function pobierzStatystykiGminy(gmina, powiat, woj) {
    if (!STATS_CSV_URL || STATS_CSV_URL === 'WKLEJ_TUTAJ_LINK_CSV_STATYSTYKI') return;
    const box = $('stat-gmina-body');
    if (!box) return;

    fetch(STATS_CSV_URL)
      .then(function (r) { return r.text(); })
      .then(function (csv) {
        const wiersze = parseCSVprosty(csv);
        // Szukaj wiersza gdzie kolumna gmina pasuje
        const naglowek = wiersze[0].map(function (h) { return h.trim().toLowerCase(); });
        const iGmina = naglowek.indexOf('gmina');
        if (iGmina < 0) return;
        const gLow = gmina.toLowerCase().trim();
        let trafienie = null;
        for (let i = 1; i < wiersze.length; i++) {
          if ((wiersze[i][iGmina] || '').toLowerCase().trim() === gLow) { trafienie = wiersze[i]; break; }
        }
        if (!trafienie) {
          box.innerHTML = '<div class="stat-empty">Brak danych dla gminy ' + gmina + ' w bazie statystyk. Uzupelnij plik na Google Drive, aby ta sekcja sie wypelnila.</div>';
          $('sec-statystyki').style.display = 'block';
          return;
        }
        // Zbuduj tabelke z wszystkich kolumn (poza gmina)
        let h = '<div class="stat-grid">';
        naglowek.forEach(function (kol, i) {
          if (i === iGmina || !trafienie[i]) return;
          h += '<div class="stat-item"><div class="stat-k">' + wiersze[0][i] + '</div><div class="stat-v">' + trafienie[i] + '</div></div>';
        });
        h += '</div>';
        box.innerHTML = h;
        $('sec-statystyki').style.display = 'block';
      })
      .catch(function () { /* zostaje ukryte */ });
  }

  function parseCSVprosty(text) {
    return text.split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) {
      // Prosty split po przecinku lub sredniku
      const sep = l.indexOf(';') > -1 && l.indexOf(';') < l.indexOf(',') ? ';' : ',';
      return l.split(sep);
    });
  }

  function trybDemo(id, cichy) {
    if (!cichy) $('rep-notice').innerHTML = '<strong>Tryb demonstracyjny.</strong> Posrednik do GUGiK nie jest podlaczony (patrz INSTRUKCJA-RAPORT.txt). Mapy ponizej sa rzeczywiste; dane opisowe pobiora sie po podlaczeniu.';
    const nr = id.split('.').pop();
    $('rep-title').textContent = 'Dzialka nr ' + nr;
    $('rep-sub').textContent = 'Identyfikator: ' + id;
    $('rep-area').textContent = 'po podlaczeniu';
    $('rep-coords').textContent = 'po podlaczeniu';
    $('rep-loc').textContent = '—';
    ['p-obreb','p-area','p-gmina','p-powiat','p-woj'].forEach(function (x) { $(x).textContent = 'po podlaczeniu'; });
    rysujMapy([16.5298, 52.2221, 16.5330, 52.2235]);
  }

  function rysujMapy(bbox, wkt) {
    // Dopasuj proporcje obrazu do proporcji BBOX (inaczej mapa jest rozciagnieta/rozmazana).
    // W EPSG:4326 1 stopien dlugosci jest krotszy niz szerokosci — korygujemy cos(lat).
    const mb = margines(bbox, 0.5);
    const s = mb.join(',');
    const mbCeny = marginesCeny(bbox);          // obszar ~1 km dla cen
    const sCeny = mbCeny.join(',');

    const orto = wymiary(mb);                    // {W,H} dopasowane do proporcji dzialki
    const ortoC = wymiary(mbCeny);               // {W,H} dla obszaru cen

    // Bazowa ortofotomapa
    const ortoBase = function (bb, wh) {
      return 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg&TRANSPARENT=false&LAYERS=Raster&STYLES=&WIDTH=' + wh.W + '&HEIGHT=' + wh.H + '&BBOX=' + bb;
    };

    // Kolejka map — ladowane z opoznieniem, zeby nie uderzac w Geoportal 8 zapytaniami naraz.
    const kolejka = [];

    // MAPA 0: Zaznaczenie dzialki — ciasny widok z ZLOTYM OBRYSEM dzialki (z geometrii ULDK)
    const mbZazn = margines(bbox, 0.6), sZazn = mbZazn.join(','), zazn = wymiary(mbZazn);
    kolejka.push(function () {
      setMapa('map-zaznaczenie', ortoBase(sZazn, zazn));
      rysujObrys('map-zaznaczenie', wkt, mbZazn, zazn, true);
    });

    // MAPA 1: Ortofotomapa + ZLOTY OBRYS dzialki — szerszy widok (okolica)
    const mbOkolica = margines(bbox, 2.0);   // wiecej otoczenia niz mapa MPZP
    const sOkolica = mbOkolica.join(',');
    const ortoOkolica = wymiary(mbOkolica);
    kolejka.push(function () {
      setMapa('map-orto', ortoBase(sOkolica, ortoOkolica));
      rysujObrys('map-orto', wkt, mbOkolica, ortoOkolica);
    });

    // MAPA: PLAN OGOLNY GMINY (POG). Nazwy warstw w camelCase (wg GetCapabilities),
    // usluga natywnie w EPSG:2180 (jak KIUT) — konwertujemy bbox.
    const mbPog = margines(bbox, 0.3), pogWH = wymiary(mbPog);
    const pp1 = wgs84Do2180(mbPog[0], mbPog[1]);
    const pp2 = wgs84Do2180(mbPog[2], mbPog[3]);
    const pogBbox2180 = Math.min(pp1.x, pp2.x) + ',' + Math.min(pp1.y, pp2.y) + ',' +
                        Math.max(pp1.x, pp2.x) + ',' + Math.max(pp1.y, pp2.y);
    const pogUchwUrl = 'https://mapy.geoportal.gov.pl/wss/ext/PlanyOgolneGmin?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=true&LAYERS=strefaPlanistyczna,obszarUzupelnieniaZabudowy,obszarZabSrodmiejskiej,aktPlanowaniaprzestrzennego&STYLES=,,,&WIDTH=' + pogWH.W + '&HEIGHT=' + pogWH.H + '&BBOX=' + pogBbox2180;
    kolejka.push(function () {
      setMapaOverlay('map-pog', ortoBase(mbPog.join(','), pogWH), pogUchwUrl);
      rysujObrys('map-pog', wkt, mbPog, pogWH);
      pobierzLegendePOG(bbox, pogWH);
    });

    // MAPA 2: MPZP — poprawne warstwy tresci planu (raster + wektor + granice).
    // Warstwy MPZP renderuja sie tylko przy duzym przyblizeniu (skala < 1:10000),
    // dlatego uzywamy ciasnego widoku dzialki (margines 0.3), nie szerokiego.
    const mbMpzp = margines(bbox, 0.3), sMpzp = mbMpzp.join(','), mpzpWH = wymiary(mbMpzp);
    const mpzpUrl = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=raster,wektor-str,wektor-pow,wektor-lin,wektor-pkt,wektor-lzb,granice&STYLES=,,,,,,&WIDTH=' + mpzpWH.W + '&HEIGHT=' + mpzpWH.H + '&BBOX=' + sMpzp;
    kolejka.push(function () {
      setMapaOverlay('map-mpzp', ortoBase(sMpzp, mpzpWH), mpzpUrl);
      rysujObrys('map-mpzp', wkt, mbMpzp, mpzpWH);
      pobierzLegendeMPZP(bbox, mpzpWH);
    });

    // MAPA 3: Ceny (RCN) + punkty Waszych transakcji z bazy
    window._cenyBbox = mbCeny;        // bbox mapy cen (do naniesienia punktow)
    window._cenyWH = ortoC;           // wymiary mapy cen
    const cenyUrl = 'https://mapy.geoportal.gov.pl/wss/service/rcn?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=dzialki,dzialki_zabudowane,budynki,lokale&STYLES=&WIDTH=' + ortoC.W + '&HEIGHT=' + ortoC.H + '&BBOX=' + sCeny;
    kolejka.push(function () { setMapaOverlay('map-ceny', ortoBase(sCeny, ortoC), cenyUrl); });

    // MAPA 6: Uzbrojenie terenu (KIUT — poprawne nazwy warstw wg specyfikacji GUGiK).
    // Sieci widoczne w skali ~1:5000-1:10000, wiec uzywamy sredniego widoku (nie 1 km).
    // KIUT (uzbrojenie) wymaga ukladu EPSG:2180 (metry PUWG 1992), nie 4326 (stopnie) —
    // sprawdzone: w 4326 zwraca pusty obraz, w 2180 pokazuje sieci. Konwertujemy bbox.
    const mbUzbr = margines(bbox, 0.2), uzbrWH = wymiary(mbUzbr);
    // Przelicz naroza bbox z lon/lat na EPSG:2180
    const p1 = wgs84Do2180(mbUzbr[0], mbUzbr[1]);   // lewy-dolny
    const p2 = wgs84Do2180(mbUzbr[2], mbUzbr[3]);   // prawy-gorny
    // BBOX w 2180: minX,minY,maxX,maxY (X=easting, Y=northing)
    const bbox2180 = Math.min(p1.x, p2.x) + ',' + Math.min(p1.y, p2.y) + ',' +
                     Math.max(p1.x, p2.x) + ',' + Math.max(p1.y, p2.y);
    const uzbrojenieUrl = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:2180&FORMAT=image/png&TRANSPARENT=true&LAYERS=przewod_wodociagowy,przewod_kanalizacyjny,przewod_gazowy,przewod_elektroenergetyczny,przewod_cieplowniczy,przewod_telekomunikacyjny&STYLES=,,,,,&WIDTH=' + uzbrWH.W + '&HEIGHT=' + uzbrWH.H + '&BBOX=' + bbox2180;
    kolejka.push(function () { setMapaOverlay('map-energia', ortoBase(mbUzbr.join(','), uzbrWH), uzbrojenieUrl); rysujObrys('map-energia', wkt, mbUzbr, uzbrWH); });

    // (Formy ochrony przyrody, zabytki i tereny zalewowe przeniesione do raportu platnego —
    //  dzialaly niepewnie na roznych serwerach i spowalnialy darmowy raport.)

    // ZDJECIA HISTORYCZNE — porownanie ortofotomap z roznych lat (osobna sekcja, poza kolejka WMS)
    rysujZdjeciaHistoryczne(bbox);

    // Uruchom kolejke: co 350 ms nastepna mapa — Geoportal nie jest zasypywany naraz
    kolejka.forEach(function (fn, i) { setTimeout(fn, i * 350); });

    // Ukryj poczekalnie gdy kluczowe mapy (zaznaczenie + ortofoto) sie zaladuja.
    let zaladowane = 0;
    const kluczowe = ['map-zaznaczenie', 'map-orto'];
    let ukryto = false;
    const sprawdzGotowosc = function () {
      zaladowane++;
      if (zaladowane >= kluczowe.length && !ukryto) {
        ukryto = true;
        setTimeout(ukryjPoczekalnie, 1500);
      }
    };
    kluczowe.forEach(function (id) {
      const el = $(id);
      if (el) {
        el.addEventListener('load', sprawdzGotowosc, { once: true });
        el.addEventListener('error', sprawdzGotowosc, { once: true });
      }
    });
    // Bezpiecznik: gdyby kluczowe mapy nie odpowiedzialy, i tak pokaz raport po 20s
    setTimeout(function () { if (!ukryto) { ukryto = true; ukryjPoczekalnie(); } }, 20000);
  }

  // Rysuje siatke zdjec lotniczych z roznych lat (archiwum ortofoto GUGiK).
  // Uzywa uslugi StandardResolutionTime (obsluguje parametr TIME), nie zwyklej ORTO.
  function rysujZdjeciaHistoryczne(bbox) {
    const kontener = document.getElementById('zdjecia-historyczne');
    if (!kontener) return;
    const mb = margines(bbox, 0.4);
    const wh = wymiary(mb);
    const s = mb.join(',');

    // Roczniki do sprawdzenia. Dostepnosc rozni sie per teren — zdjecia bez danych
    // pokaza komunikat. Format TIME: pelna data ISO (rok-01-01/rok-12-31).
    const lata = ['2010', '2015', '2019', '2023'];
    let html = '';
    lata.forEach(function (rok) {
      // StandardResolutionTime — usluga archiwalna z obsluga czasu.
      // TIME jako zakres calego roku: RRRR-01-01/RRRR-12-31
      const url = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolutionTime'
        + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/jpeg'
        + '&LAYERS=Raster&STYLES='
        + '&TIME=' + rok + '-01-01/' + rok + '-12-31'
        + '&WIDTH=' + wh.W + '&HEIGHT=' + wh.H + '&BBOX=' + s;
      html += '<div class="zdj-item">' +
        '<div class="zdj-rok">' + rok + '</div>' +
        '<div class="zdj-mapbox"><img data-rok="' + rok + '" src="' + url + '" alt="Ortofotomapa ' + rok + '" ' +
        'onload="this.dataset.ok=1" ' +
        'onerror="var p=this.parentElement; if(!this.dataset.r){this.dataset.r=1; var self=this; setTimeout(function(){self.src=self.src+\'&_r=\'+Date.now();},1500);} else {p.innerHTML=\'<div class=zdj-brak>Brak zdjecia z \' + ' + rok + ' + \' dla tego terenu</div>\';}" /></div>' +
        '</div>';
    });
    kontener.innerHTML = html;
    const sekcja = document.getElementById('sec-zdjecia');
    if (sekcja) sekcja.style.display = 'block';
  }

  // Oblicz wymiary obrazu (W x H) dopasowane do proporcji BBOX w danej szerokosci.
  // Utrzymuje ~1200px po dluzszym boku dla ostrosci.
  function wymiary(bb) {
    const lonSpan = (bb[2] - bb[0]);
    const latSpan = (bb[3] - bb[1]);
    const latSrodek = (bb[1] + bb[3]) / 2;
    const cos = Math.cos(latSrodek * Math.PI / 180);
    // Rzeczywista szerokosc w metrach proporcjonalna do lonSpan*cos, wysokosc do latSpan
    const wReal = lonSpan * cos;
    const hReal = latSpan;
    const MAX = 1200;
    let W, H;
    if (wReal >= hReal) { W = MAX; H = Math.round(MAX * hReal / wReal); }
    else { H = MAX; W = Math.round(MAX * wReal / hReal); }
    // Zabezpieczenie przed skrajnościami
    W = Math.max(400, Math.min(1600, W));
    H = Math.max(400, Math.min(1600, H));
    return { W: W, H: H };
  }

  // Obszar ~1 km wokol dzialki dla mapy cen
  function marginesCeny(bbox) {
    const cLon = (bbox[0] + bbox[2]) / 2, cLat = (bbox[1] + bbox[3]) / 2;
    const dLat = 1.0 / 111.0;                  // ~1 km pion
    const dLon = 1.0 / (111.0 * 0.62);         // ~1 km poziom (PL)
    return [cLon - dLon, cLat - dLat, cLon + dLon, cLat + dLat];
  }

  // Pojedyncza mapa (jeden obraz)
  function setMapa(id, url) {
    const img = $(id);
    if (!img) return;
    let proba = 0;
    img.onerror = function () {
      // Sprobuj ponownie raz po 1.5s (Geoportal czesto odpowiada za drugim razem)
      if (proba < 1) { proba++; const self = this; setTimeout(function () { self.src = url + '&_r=' + Date.now(); }, 1500); }
      else { this.style.opacity = '0.15'; this.alt = 'Podklad chwilowo niedostepny'; }
    };
    img.onload = function () { this.style.opacity = '1'; };
    img.src = url;
  }

  // Mapa z warstwa nalozona: ortofoto (tlo) + warstwa przezroczysta na wierzchu
  function setMapaOverlay(id, bazaUrl, warstwaUrl) {
    const img = $(id);
    if (!img) return;
    const box = img.parentElement;
    if (!box) { setMapa(id, warstwaUrl); return; }

    // Ustaw ortofoto jako tlo od razu — jesli sie nie zaladuje, zostaje ciemne tlo boxa
    // (nie kasujemy mapy komunikatem, bo to psulo cala sekcje przy chwilowym timeoutcie)
    box.style.backgroundImage = 'url("' + bazaUrl + '")';
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';

    // Warstwa na wierzchu; sprobuj do 2 razy (zewnetrzne serwery GDOS/NID/ISOK bywaja wolne)
    img.style.mixBlendMode = 'normal';
    let proba = 0;
    img.onerror = function () {
      if (proba < 2) { proba++; const self = this; setTimeout(function () { self.src = warstwaUrl + '&_r=' + Date.now(); }, 2000); }
      else { this.style.display = 'none'; }
    };
    img.onload = function () { this.style.display = 'block'; };
    img.src = warstwaUrl;
  }

  function rysujTransakcje(txs) {
    const table = $('tx-table');
    const empty = $('tx-empty');
    if (empty) empty.remove();
    txs.slice(0, 20).forEach(function (t) {
      const row = document.createElement('div');
      row.className = 'tx-row';
      row.innerHTML =
        '<div class="tx-addr">' + (t.adres || '—') + '<small>' + (t.id || '') + '</small></div>' +
        '<div class="tx-price">' + (t.cena ? Number(t.cena).toLocaleString('pl-PL') + ' zl' : '—') + '</div>' +
        '<div class="tx-perm2">' + (t.cenaM2 || '—') + '</div>' +
        '<div class="tx-date">' + (t.data || '—') + '</div>';
      table.appendChild(row);
    });
  }

  // Slownik stref planistycznych POG (kod -> pelna nazwa)
  var STREFY_POG = {
    'SW': 'wielofunkcyjna z zabudowa mieszkaniowa wielorodzinna',
    'SJ': 'wielofunkcyjna z zabudowa mieszkaniowa jednorodzinna',
    'SZ': 'wielofunkcyjna z zabudowa zagrodowa',
    'SU': 'uslugowa',
    'SP': 'produkcyjna',
    'SR': 'gospodarki rolnej',
    'SI': 'infrastrukturalna',
    'SN': 'zieleni i rekreacji',
    'SC': 'cmentarzy',
    'SG': 'gornictwa',
    'SO': 'otwarta',
    'SK': 'komunikacyjna',
    'SH': 'handlu wielkopowierzchniowego'
  };

  // Pobiera strefe POG (kod strefy + status) przez GetFeatureInfo.
  function pobierzLegendePOG(bbox, wh) {
    const box = document.getElementById('pog-legenda');
    if (!box) return;
    const mb = margines(bbox, 0.3);
    const url = 'https://mapy.geoportal.gov.pl/wss/ext/PlanyOgolneGmin'
      + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo'
      + '&SRS=EPSG:4326&BBOX=' + mb.join(',')
      + '&WIDTH=' + wh.W + '&HEIGHT=' + wh.H
      + '&LAYERS=strefaPlanistyczna&QUERY_LAYERS=strefaPlanistyczna'
      + '&INFO_FORMAT=text/html&FEATURE_COUNT=5'
      + '&X=' + Math.round(wh.W / 2) + '&Y=' + Math.round(wh.H / 2);

    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        const plain = html.replace(/<[^>]+>/g, ' \n ').replace(/&nbsp;/g, ' ');
        // Szukaj kodu strefy (S + litera, np. SJ, SW, SU)
        const symM = plain.match(/\b(S[A-Z])\b/);
        const kod = symM ? symM[1] : '';
        if (kod && STREFY_POG[kod]) {
          box.innerHTML =
            '<div class="legenda-title">Strefa planistyczna (POG)</div>' +
            '<div class="legenda-body">' +
            '<div class="legenda-row"><span>Kod strefy</span><strong>' + kod + '</strong></div>' +
            '<div class="legenda-row"><span>Przeznaczenie</span><strong>strefa ' + STREFY_POG[kod] + '</strong></div>' +
            '</div>';
          box.style.display = 'block';
        }
        // brak strefy — sekcja legendy zostaje ukryta (mapa i tak pokazuje zasieg)
      })
      .catch(function () { /* ukryte */ });
  }

  // Pobiera legende MPZP (symbol strefy + link do uchwaly) przez GetFeatureInfo.
  function pobierzLegendeMPZP(bbox, wh) {
    const box = document.getElementById('mpzp-legenda');
    if (!box) return;

    const mb = margines(bbox, 0.5);
    const url = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego'
      + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo'
      + '&SRS=EPSG:4326&BBOX=' + mb.join(',')
      + '&WIDTH=' + wh.W + '&HEIGHT=' + wh.H
      + '&LAYERS=plany,granice&QUERY_LAYERS=plany,granice'
      + '&INFO_FORMAT=text/html&FEATURE_COUNT=5'
      + '&X=' + Math.round(wh.W / 2) + '&Y=' + Math.round(wh.H / 2);

    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        const dane = parsujLegendeMPZP(html);
        if (dane.symbol || dane.uchwala || dane.link) {
          let h = '<div class="legenda-title">Zapisy planu dla działki</div><div class="legenda-body">';
          if (dane.symbol) h += '<div class="legenda-row"><span>Symbol / przeznaczenie</span><strong>' + dane.symbol + '</strong></div>';
          if (dane.uchwala) h += '<div class="legenda-row"><span>Uchwała</span><strong>' + dane.uchwala + '</strong></div>';
          if (dane.data) h += '<div class="legenda-row"><span>Data uchwalenia</span><strong>' + dane.data + '</strong></div>';
          if (dane.link) {
            h += '<a class="legenda-link" href="' + dane.link + '" target="_blank" rel="noopener">Otwórz treść uchwały (dziennik urzędowy) →</a>';
          } else {
            // Plan wektorowy, ale bez linku do uchwaly — daj link do portalu KIMPZP
            h += '<a class="legenda-link" href="https://krajowa.geoportal.gov.pl" target="_blank" rel="noopener">Znajdź treść uchwały w KIMPZP →</a>';
          }
          h += '</div>';
          box.innerHTML = h;
          box.style.display = 'block';
        } else {
          // Brak atrybutow — plan rastrowy lub gmina bez danych wektorowych.
          // Dajemy uczciwe wyjasnienie + konkretne linki gdzie szukac uchwaly.
          box.innerHTML =
            '<div class="legenda-note">' +
            '<strong>Plan dostępny jako rysunek (raster)</strong> — dla tej gminy usługa krajowa nie udostępnia numeru uchwały ani linku w formie danych. To normalne: pełne dane opisowe ma ok. 180 z 970 gmin (reszta to zeskanowane rysunki planów).' +
            '<div class="legenda-linki">Gdzie znaleźć treść uchwały dla tej działki:' +
            '<a href="https://krajowa.geoportal.gov.pl" target="_blank" rel="noopener">KIMPZP (portal krajowy) →</a>' +
            '<a href="https://www.e-mapa.net" target="_blank" rel="noopener">e-mapa.net (wykaz planów gminy) →</a>' +
            '</div>' +
            'W raporcie pełnym odczytujemy symbol strefy i treść uchwały bezpośrednio z planu gminy.' +
            '</div>';
          box.style.display = 'block';
        }
      })
      .catch(function () { /* zostaje ukryte */ });
  }

  function parsujLegendeMPZP(html) {
    const wynik = { symbol: '', uchwala: '', data: '', link: '' };
    if (!html) return wynik;
    const plain = html.replace(/<[^>]+>/g, ' \n ').replace(/&nbsp;/g, ' ');

    // LINK do uchwaly — szukamy w kolejnosci pewnosci:
    // 1) link w atrybutach wskazujacy dziennik urzedowy / edziennik / PDF planu
    let linkM = html.match(/(https?:\/\/[^\s"'<>]*(?:edziennik|dziennik|dzienniki|monitorpolski)[^\s"'<>]*)/i);
    // 2) dowolny link do PDF (czesto to skan uchwaly)
    if (!linkM) linkM = html.match(/(https?:\/\/[^\s"'<>]+\.pdf)/i);
    // 3) href z pola "uchwala"/"akt"/"plan"
    if (!linkM) {
      const m = plain.match(/(?:uchwa[łl]|akt|plan)[\s\S]{0,80}?(https?:\/\/[^\s"'<>]+)/i);
      if (m) linkM = [m[1], m[1]];
    }
    if (linkM) wynik.link = (linkM[1] || linkM[0]);

    // SYMBOL strefy (MN, MN2, 5MN.3, U, RM, ZL, MN/U...) — wg konwencji MPZP
    const symM = plain.match(/\b(\d{0,2}[A-Z]{1,3}\d{0,2}(?:[\.\/][A-Z0-9]{1,4})?)\b(?=[\s\n]*[-–:]?\s*(?:tereny|zabudow|przeznacz|funkcj))/i)
      || plain.match(/(?:symbol|oznaczenie|przeznaczenie|funkcja)[\s:\n]+(\d{0,2}[A-Z]{1,3}\d{0,2}(?:[\.\/][A-Z0-9]{1,4})?)/i);
    if (symM) wynik.symbol = symM[1];

    // NUMER UCHWALY — rzymskie/arabskie, np. "nr XLII/348/2018" albo "nr 348/2018"
    const uchM = plain.match(/(?:uchwa[łl][aey])[\s\S]{0,40}?(nr\.?\s*[IVXLCDM]+\/\d+\/\d{2,4})/i)
      || plain.match(/(nr\.?\s*[IVXLCDM]+\/\d+\/\d{2,4})/i)
      || plain.match(/(?:uchwa[łl][aey])[\s\S]{0,40}?(nr\.?\s*\d+\/\d{2,4})/i);
    if (uchM) wynik.uchwala = uchM[1].replace(/\s+/g, ' ').trim();

    // DATA uchwalenia
    const dataM = plain.match(/\d{4}-\d{2}-\d{2}/) || plain.match(/\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia)\s+\d{4}/i);
    if (dataM) wynik.data = dataM[0];

    return wynik;
  }

  // Rysuje ZLOTY OBRYS dzialki (z geometrii WKT) nalozony na mape.
  // KLUCZOWE: obraz WMS ma proporcje wg wymiary() (dopasowane do metrow, z korekta cos),
  // a nie proporcje bbox w stopniach. SVG musi miec te same proporcje co obraz
  // i byc przyciety tak samo (object-fit:cover -> preserveAspectRatio slice).
  // Etykieta wymiaru — zlote tlo, wieksza i wyrazniejsza (bo tylko dwie na mape)
  function etykietaWymiar(mx, my, tekst) {
    const szer = tekst.length * 13 + 24;
    return '<g>' +
      '<rect x="' + (mx - szer / 2).toFixed(1) + '" y="' + (my - 17).toFixed(1) + '" width="' + szer + '" height="30" rx="6" fill="rgba(176,141,62,0.95)" stroke="#0b0c0a" stroke-width="1"/>' +
      '<text x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '" font-family="monospace" font-size="21" font-weight="600" fill="#14181a" text-anchor="middle">' + tekst + '</text>' +
      '</g>';
  }

  // Rysuje LINIE WYMIAROWA (styl geodezyjny, jak OnGeo): linia od (x1,y1) do
  // (x2,y2) z kreseczkami prostopadlymi na koncach i liczba na srodku.
  function liniaWymiarowa(x1, y1, x2, y2, tekst) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;   // prostopadly jednostkowy
    const k = 7;                            // dlugosc kreseczki koncowej

    const kres1 = 'M' + (x1 + nx * k).toFixed(1) + ',' + (y1 + ny * k).toFixed(1) +
                  ' L' + (x1 - nx * k).toFixed(1) + ',' + (y1 - ny * k).toFixed(1);
    const kres2 = 'M' + (x2 + nx * k).toFixed(1) + ',' + (y2 + ny * k).toFixed(1) +
                  ' L' + (x2 - nx * k).toFixed(1) + ',' + (y2 - ny * k).toFixed(1);

    const sx = (x1 + x2) / 2, sy = (y1 + y2) / 2;
    const szer = tekst.length * 11 + 16;

    return '<g>' +
      '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#c9a961" stroke-width="2"/>' +
      '<path d="' + kres1 + '" stroke="#c9a961" stroke-width="2"/>' +
      '<path d="' + kres2 + '" stroke="#c9a961" stroke-width="2"/>' +
      '<rect x="' + (sx - szer / 2).toFixed(1) + '" y="' + (sy - 13).toFixed(1) + '" width="' + szer + '" height="24" rx="4" fill="rgba(11,12,10,0.9)" stroke="#c9a961" stroke-width="1"/>' +
      '<text x="' + sx.toFixed(1) + '" y="' + (sy + 4).toFixed(1) + '" font-family="monospace" font-size="17" font-weight="600" fill="#dfc090" text-anchor="middle">' + tekst + '</text>' +
      '</g>';
  }

  // Oblicz obwod dzialki w metrach
  function obliczObwod(punkty, mLon, mLat) {
    let obw = 0;
    for (let i = 0; i < punkty.length - 1; i++) {
      const dLon = (punkty[i + 1].lon - punkty[i].lon) * mLon;
      const dLat = (punkty[i + 1].lat - punkty[i].lat) * mLat;
      obw += Math.hypot(dLon, dLat);
    }
    return Math.round(obw);
  }

  // Wypelnij sekcje wymiarow pod mapa zaznaczenia
  function wypelnijWymiaryPodMapa(w) {
    const box = document.getElementById('wymiary-dane');
    if (!box) return;
    box.innerHTML =
      '<div class="wym-item"><span class="wym-label">Dlugosc (gabaryt)</span><span class="wym-val">' + w.dlugosc + ' m</span></div>' +
      '<div class="wym-item"><span class="wym-label">Szerokosc (gabaryt)</span><span class="wym-val">' + w.szerokosc + ' m</span></div>' +
      '<div class="wym-item"><span class="wym-label">Obwod dzialki</span><span class="wym-val">' + w.obwod + ' m</span></div>' +
      '<div class="wym-item"><span class="wym-label">Liczba bokow</span><span class="wym-val">' + w.boki + '</span></div>';
    const sekcja = document.getElementById('sec-wymiary');
    if (sekcja) sekcja.style.display = 'block';
  }

  function rysujObrys(idMapy, wkt, bboxMapy, wh, pokazWymiary) {
    const img = $(idMapy);
    if (!img || !wkt) return;
    const box = img.parentElement;
    if (!box) return;

    const pierscienie = wkt.match(/\(([^()]+)\)/g);
    if (!pierscienie || !pierscienie.length) return;

    const minLon = bboxMapy[0], minLat = bboxMapy[1], maxLon = bboxMapy[2], maxLat = bboxMapy[3];
    const szerLon = maxLon - minLon, szerLat = maxLat - minLat;
    if (szerLon <= 0 || szerLat <= 0) return;

    const W = (wh && wh.W) ? wh.W : 1000;
    const H = (wh && wh.H) ? wh.H : 1000;

    // Wspolczynnik metrow na stopien dla szerokosci Polski
    const latSrodek = (minLat + maxLat) / 2;
    const M_NA_STOPIEN_LAT = 111132;                          // metry na 1 stopien szerokosci
    const M_NA_STOPIEN_LON = 111320 * Math.cos(latSrodek * Math.PI / 180); // dlugosci (krotsze)

    let paths = '';
    let etykiety = '';

    pierscienie.forEach(function (p) {
      const wsp = p.replace(/[()]/g, '').trim().split(',');
      // Zbierz punkty jako {lon,lat,x,y}
      const punkty = [];
      wsp.forEach(function (para) {
        const xy = para.trim().split(/\s+/).map(Number);
        if (xy.length < 2 || isNaN(xy[0]) || isNaN(xy[1])) return;
        const lon = xy[0], lat = xy[1];
        punkty.push({
          lon: lon, lat: lat,
          x: ((lon - minLon) / szerLon) * W,
          y: ((maxLat - lat) / szerLat) * H
        });
      });
      if (punkty.length < 2) return;

      // Sciezka obrysu
      let d = '';
      punkty.forEach(function (pt, i) { d += (i === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ' '; });
      paths += '<path d="' + d + 'Z" fill="rgba(201,169,110,0.18)" stroke="#c9a961" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';

      // WYMIARY jako LINIE WYMIAROWE na krawedziach prostokata otaczajacego dzialke.
      // Prostokat zorientowany wzdluz najdluzszego boku — linie zawsze rownolegle do dzialki.
      if (pokazWymiary && punkty.length >= 3) {
        const lonSr = (minLon + maxLon) / 2, latSr = (minLat + maxLat) / 2;
        const mp = punkty.map(function (pt) {
          return {
            mx: (pt.lon - lonSr) * M_NA_STOPIEN_LON,
            my: (pt.lat - latSr) * M_NA_STOPIEN_LAT,
            x: pt.x, y: pt.y
          };
        });

        // Najdluzszy BOK wyznacza orientacje prostokata
        let maxBok = 0, bi = 0;
        for (let i = 0; i < mp.length - 1; i++) {
          const d = Math.hypot(mp[i + 1].mx - mp[i].mx, mp[i + 1].my - mp[i].my);
          if (d > maxBok) { maxBok = d; bi = i; }
        }
        const a = mp[bi], b = mp[bi + 1];

        // Osie: u = wzdluz najdluzszego boku, p = prostopadle (w metrach)
        const dirLen = Math.hypot(b.mx - a.mx, b.my - a.my) || 1;
        const uMx = (b.mx - a.mx) / dirLen, uMy = (b.my - a.my) / dirLen;
        const pMx = -uMy, pMy = uMx;

        // Skala metry->piksele i te same osie w PIKSELACH
        const pxLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const pxPerM = pxLen / dirLen;
        const uX = (b.x - a.x) / pxLen, uY = (b.y - a.y) / pxLen;   // wzdluz (piksele)
        const pX = -uY, pY = uX;                                    // prostopadle (piksele)

        // Rzutuj wszystkie wierzcholki na osie — granice prostokata otaczajacego
        let minU = 1e9, maxU = -1e9, minP = 1e9, maxP = -1e9;
        mp.forEach(function (m) {
          const u = m.mx * uMx + m.my * uMy;
          const pr = m.mx * pMx + m.my * pMy;
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (pr < minP) minP = pr; if (pr > maxP) maxP = pr;
        });
        const dlugosc = maxU - minU;
        const szerokosc = maxP - minP;

        window._wymiaryDzialki = {
          dlugosc: Math.round(dlugosc),
          szerokosc: Math.round(szerokosc),
          obwod: obliczObwod(punkty, M_NA_STOPIEN_LON, M_NA_STOPIEN_LAT),
          boki: punkty.length - 1
        };

        // KOTWICA: wybierz wierzcholek dzialki o znanej pozycji (metry U,P i piksele x,y).
        // Wzgledem niego liczymy naroza prostokata — bez bledu srodka.
        const kotwica = mp[0];
        const kU = kotwica.mx * uMx + kotwica.my * uMy;   // wsp. kotwicy wzdluz osi (metry)
        const kP = kotwica.mx * pMx + kotwica.my * pMy;   // wsp. kotwicy w poprzek (metry)
        const kx = kotwica.x, ky = kotwica.y;             // pozycja kotwicy w pikselach

        // Funkcja: punkt (u,p w metrach) -> piksele, licząc od kotwicy
        const naPiksele = function (uM, pM) {
          const du = (uM - kU) * pxPerM, dp = (pM - kP) * pxPerM;
          return { x: kx + uX * du + pX * dp, y: ky + uY * du + pY * dp };
        };

        // Odsun linie na zewnatrz prostokata, ALE jesli wypadlyby poza kadr mapy,
        // odsun je do wewnatrz — zeby zawsze byly widoczne (wazne przy duzych dzialkach).
        const odsun = 20;
        const W = (wh && wh.W) ? wh.W : 1000;
        const H = (wh && wh.H) ? wh.H : 1000;
        const wKadrze = function (p) { return p.x >= 8 && p.x <= W - 8 && p.y >= 8 && p.y <= H - 8; };

        // LINIA DLUGOSCI wzdluz krawedzi (strona minP). Sprobuj na zewnatrz (-pX),
        // jesli poza kadrem — do wewnatrz (+pX).
        let dA = naPiksele(minU, minP), dB = naPiksele(maxU, minP);
        let dOff = -odsun;
        let d1 = { x: dA.x + pX * dOff, y: dA.y + pY * dOff };
        let d2 = { x: dB.x + pX * dOff, y: dB.y + pY * dOff };
        if (!wKadrze(d1) || !wKadrze(d2)) {
          dOff = odsun;  // do wewnatrz
          d1 = { x: dA.x + pX * dOff, y: dA.y + pY * dOff };
          d2 = { x: dB.x + pX * dOff, y: dB.y + pY * dOff };
        }
        etykiety += liniaWymiarowa(d1.x, d1.y, d2.x, d2.y, Math.round(dlugosc) + ' m');

        // LINIA SZEROKOSCI wzdluz krawedzi (strona minU). Sprobuj na zewnatrz (-uX),
        // jesli poza kadrem — do wewnatrz (+uX).
        let sA = naPiksele(minU, minP), sB = naPiksele(minU, maxP);
        let sOff = -odsun;
        let s1 = { x: sA.x + uX * sOff, y: sA.y + uY * sOff };
        let s2 = { x: sB.x + uX * sOff, y: sB.y + uY * sOff };
        if (!wKadrze(s1) || !wKadrze(s2)) {
          sOff = odsun;  // do wewnatrz
          s1 = { x: sA.x + uX * sOff, y: sA.y + uY * sOff };
          s2 = { x: sB.x + uX * sOff, y: sB.y + uY * sOff };
        }
        etykiety += liniaWymiarowa(s1.x, s1.y, s2.x, s2.y, Math.round(szerokosc) + ' m');
      }
    });
    if (!paths) return;

    // Po narysowaniu — wypelnij wymiary pod mapa (jesli sekcja istnieje)
    if (pokazWymiary && window._wymiaryDzialki) {
      wypelnijWymiaryPodMapa(window._wymiaryDzialki);
    }

    const stary = box.querySelector('.obrys-svg');
    if (stary) stary.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'obrys-svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    svg.innerHTML = paths + etykiety;
    box.appendChild(svg);
  }

  // Narzedzia geometryczne
  function bboxZWKT(wkt) {
    const n = (wkt.match(/-?\d+\.\d+/g) || []).map(Number);
    if (n.length < 4) return null;
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (let i = 0; i < n.length - 1; i += 2) {
      if (n[i] < a) a = n[i]; if (n[i] > c) c = n[i];
      if (n[i+1] < b) b = n[i+1]; if (n[i+1] > d) d = n[i+1];
    }
    return [a, b, c, d];
  }
  function margines(b, f) {
    const dx = (b[2]-b[0])*f, dy = (b[3]-b[1])*f, m = Math.max(dx, dy, 0.0008);
    return [b[0]-m, b[1]-m, b[2]+m, b[3]+m];
  }
  function srodek(b) { return { lon:(b[0]+b[2])/2, lat:(b[1]+b[3])/2 }; }

  // Konwersja WGS84 (lon,lat w stopniach) -> EPSG:2180 (PUWG 1992, metry).
  // Odwzorowanie poprzeczne Merkatora (Gauss-Kruger), poludnik srodkowy 19°E.
  // Potrzebne dla warstwy KIUT (uzbrojenie), ktora nie obsluguje 4326.
  function wgs84Do2180(lon, lat) {
    const a = 6378137.0, f = 1 / 298.257223563;   // elipsoida GRS80/WGS84
    const e2 = f * (2 - f);
    const k0 = 0.9993, lon0 = 19 * Math.PI / 180;
    const x0 = 500000, y0 = -5300000;             // przesuniecia dla PL-1992
    const rad = Math.PI / 180;
    const phi = lat * rad, lam = lon * rad;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    const t = Math.tan(phi), t2 = t * t;
    const ep2 = e2 / (1 - e2);
    const eta2 = ep2 * Math.cos(phi) * Math.cos(phi);
    const dl = lam - lon0;
    // Dlugosc luku poludnika
    const e4 = e2 * e2, e6 = e4 * e2;
    const A0 = 1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256;
    const A2 = (3 / 8) * (e2 + e4 / 4 + 15 * e6 / 128);
    const A4 = (15 / 256) * (e4 + 3 * e6 / 4);
    const A6 = 35 * e6 / 3072;
    const M = a * (A0 * phi - A2 * Math.sin(2 * phi) + A4 * Math.sin(4 * phi) - A6 * Math.sin(6 * phi));
    const c = Math.cos(phi);
    const x = M + N * t * (dl * dl / 2 * c * c
      + dl * dl * dl * dl / 24 * c * c * c * c * (5 - t2 + 9 * eta2 + 4 * eta2 * eta2)
      + dl * dl * dl * dl * dl * dl / 720 * c * c * c * c * c * c * (61 - 58 * t2 + t2 * t2));
    const y = N * (dl * c
      + dl * dl * dl / 6 * c * c * c * (1 - t2 + eta2)
      + dl * dl * dl * dl * dl / 120 * c * c * c * c * c * (5 - 18 * t2 + t2 * t2 + 14 * eta2 - 58 * t2 * eta2));
    // W PUWG 1992: X = northing (na polnoc), Y = easting (na wschod)
    const northing = k0 * x + y0;
    const easting = k0 * y + x0;
    return { x: easting, y: northing };
  }

  function coords(lat, lon) { return dms(lat,'NS') + ' · ' + dms(lon,'EW'); }
  function dms(v, ax) {
    const dir = v>=0?ax[0]:ax[1]; v=Math.abs(v);
    const d=Math.floor(v), m=Math.floor((v-d)*60), s=Math.round(((v-d)*60-m)*60);
    return d+'°'+String(m).padStart(2,'0')+"'"+String(s).padStart(2,'0')+'"'+dir;
  }
})();
