(function () {
  'use strict';

  // Posrednik do ULDK + transakcji (Apps Script). Puste = tryb demo (mapy dzialaja, dane opisowe nie).
  const ULDK_PROXY = 'https://script.google.com/macros/s/AKfycbz4Cok9IP53kTrHtjKiLEfbQd9fnZyqUmxWTbKwWqtMQYOtfwgpkmXdT29CMjNEInbagg/exec';

  // Zapis zgloszen z raportu do Google Sheets (ten sam co formularz na stronie glownej).
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyIs7bFdclWzmjsHUbQOEfkKrA83huHCfzr3JUKXMOGyVBmDEhD9Gg0DKYB8oWNUyzM/exec';

  // ⬇️ Statystyki gmin z pliku CSV na Google Drive (opublikowany jako CSV).
  //    Puste = sekcja statystyk gminy ukryta. Patrz INSTRUKCJA-STATYSTYKI.txt
  const STATS_CSV_URL = 'WKLEJ_TUTAJ_LINK_CSV_STATYSTYKI';

  const $ = function (id) { return document.getElementById(id); };
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
    const mbZazn = margines(bbox, 0.25), sZazn = mbZazn.join(','), zazn = wymiary(mbZazn);
    kolejka.push(function () {
      setMapa('map-zaznaczenie', ortoBase(sZazn, zazn));
      rysujObrys('map-zaznaczenie', wkt, mbZazn);
    });

    // MAPA 1: Ortofotomapa + ZLOTY OBRYS dzialki — szerszy widok (okolica)
    const mbOkolica = margines(bbox, 2.0);   // wiecej otoczenia niz mapa MPZP
    const sOkolica = mbOkolica.join(',');
    const ortoOkolica = wymiary(mbOkolica);
    kolejka.push(function () {
      setMapa('map-orto', ortoBase(sOkolica, ortoOkolica));
      rysujObrys('map-orto', wkt, mbOkolica);
    });

    // MAPA 2: MPZP — poprawne warstwy tresci planu (raster + wektor + granice).
    // Warstwy MPZP renderuja sie tylko przy duzym przyblizeniu (skala < 1:10000),
    // dlatego uzywamy ciasnego widoku dzialki (margines 0.3), nie szerokiego.
    const mbMpzp = margines(bbox, 0.3), sMpzp = mbMpzp.join(','), mpzpWH = wymiary(mbMpzp);
    const mpzpUrl = 'https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaMiejscowychPlanowZagospodarowaniaPrzestrzennego?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=raster,wektor-str,wektor-pow,wektor-lin,wektor-pkt,wektor-lzb,granice&STYLES=,,,,,,&WIDTH=' + mpzpWH.W + '&HEIGHT=' + mpzpWH.H + '&BBOX=' + sMpzp;
    kolejka.push(function () {
      setMapaOverlay('map-mpzp', ortoBase(sMpzp, mpzpWH), mpzpUrl);
      rysujObrys('map-mpzp', wkt, mbMpzp);
      pobierzLegendeMPZP(bbox, mpzpWH);
    });

    // MAPA 3: Ceny (RCN)
    const cenyUrl = 'https://mapy.geoportal.gov.pl/wss/service/rcn?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=dzialki,dzialki_zabudowane,budynki,lokale&STYLES=&WIDTH=' + ortoC.W + '&HEIGHT=' + ortoC.H + '&BBOX=' + sCeny;
    kolejka.push(function () { setMapaOverlay('map-ceny', ortoBase(sCeny, ortoC), cenyUrl); });

    // MAPA 6: Uzbrojenie terenu (KIUT — woda, kanalizacja, prad, gaz, cieplo, telekom)
    const uzbrojenieUrl = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=przewod_wodociagowy,przewod_kanalizacyjny,przewod_elektroenergetyczny,przewod_gazowy,przewod_cieplowniczy,przewod_telekomunikacyjny&STYLES=,,,,,&WIDTH=' + ortoC.W + '&HEIGHT=' + ortoC.H + '&BBOX=' + sCeny;
    kolejka.push(function () { setMapaOverlay('map-energia', ortoBase(sCeny, ortoC), uzbrojenieUrl); rysujObrys('map-energia', wkt, mbCeny); });

    // MAPA 7: Ochrona przyrody (GDOS)
    const przyrodaUrl = 'https://sdi.gdos.gov.pl/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=ObszaryNatura2000,ParkiNarodowe,Rezerwaty,ParkiKrajobrazowe,ObszaryChronionegoKrajobrazu&STYLES=&WIDTH=' + ortoC.W + '&HEIGHT=' + ortoC.H + '&BBOX=' + sCeny;
    kolejka.push(function () { setMapaOverlay('map-przyroda', ortoBase(sCeny, ortoC), przyrodaUrl); });

    // MAPA 8: Zabytki (NID)
    const zabytkiUrl = 'https://mapy.zabytek.gov.pl/nid/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&LAYERS=zabytki_nieruchome&STYLES=&WIDTH=' + orto.W + '&HEIGHT=' + orto.H + '&BBOX=' + s;
    kolejka.push(function () { setMapaOverlay('map-zabytki', ortoBase(s, orto), zabytkiUrl); });

    // Uruchom kolejke: co 350 ms nastepna mapa — Geoportal nie jest zasypywany naraz
    kolejka.forEach(function (fn, i) { setTimeout(fn, i * 350); });
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

    // Warstwa na wierzchu; jesli nie zaladuje sie — sprobuj raz jeszcze, potem chowamy tylko warstwe
    img.style.mixBlendMode = 'normal';
    let proba = 0;
    img.onerror = function () {
      if (proba < 1) { proba++; const self = this; setTimeout(function () { self.src = warstwaUrl + '&_r=' + Date.now(); }, 1500); }
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

  // Pobiera legende MPZP (symbol strefy + link do uchwaly) przez GetFeatureInfo.
  // Dziala dla gmin z planami wektorowymi; dla rastrowych zwykle brak atrybutow.
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
          if (dane.link) h += '<a class="legenda-link" href="' + dane.link + '" target="_blank" rel="noopener">Otwórz treść uchwały (dziennik urzędowy) →</a>';
          h += '</div>';
          box.innerHTML = h;
          box.style.display = 'block';
        } else {
          // Brak atrybutow — plan rastrowy lub gmina bez danych wektorowych
          box.innerHTML = '<div class="legenda-note">Dla tej działki plan jest dostępny jako rysunek (raster) lub gmina nie udostępnia danych opisowych w usłudze krajowej. Symbol strefy i treść uchwały odczytamy w raporcie pełnym — bezpośrednio z planu gminy.</div>';
          box.style.display = 'block';
        }
      })
      .catch(function () { /* zostaje ukryte */ });
  }

  function parsujLegendeMPZP(html) {
    const wynik = { symbol: '', uchwala: '', data: '', link: '' };
    if (!html) return wynik;
    const plain = html.replace(/<[^>]+>/g, ' \n ').replace(/&nbsp;/g, ' ');

    // Link do uchwaly (dziennik urzedowy / BIP / PDF)
    const linkM = html.match(/https?:\/\/[^\s"'<>]+(?:\.pdf|dziennik|edzienniki|bip|monitorpolski)[^\s"'<>]*/i)
      || html.match(/href=["'](https?:\/\/[^"']+)["']/i);
    if (linkM) wynik.link = (linkM[1] || linkM[0]);

    // Symbol strefy (np. MN, MN2, U, RM, ZL) — szukamy krotkich oznaczen
    const symM = plain.match(/\b([A-Z]{1,3}\d{0,2}(?:\.\d+)?)\b(?=[\s\n]*[-–:]?\s*(?:tereny|zabudow|przeznacz))/i)
      || plain.match(/(?:symbol|oznaczenie|przeznaczenie)[\s:\n]+([A-Z]{1,3}\d{0,2})/i);
    if (symM) wynik.symbol = symM[1];

    // Numer uchwaly
    const uchM = plain.match(/uchwa[łl][ay][\s\S]{0,60}?(nr[\s\S]{0,40}?\d+[\/.]?\d*[\/.]?\d*)/i)
      || plain.match(/(nr\s+[IVXLCDM]+\/\d+\/\d+)/i);
    if (uchM) wynik.uchwala = uchM[1].replace(/\s+/g, ' ').trim().slice(0, 60);

    // Data
    const dataM = plain.match(/\d{4}-\d{2}-\d{2}/) || plain.match(/\d{1,2}\s+\w+\s+\d{4}/);
    if (dataM) wynik.data = dataM[0];

    return wynik;
  }

  // Rysuje ZLOTY OBRYS dzialki (z geometrii WKT) nalozony na mape.
  // Zamienia wspolrzedne geograficzne na pozycje w obrazie wg bbox mapy.
  function rysujObrys(idMapy, wkt, bboxMapy) {
    const img = $(idMapy);
    if (!img || !wkt) return;
    const box = img.parentElement;
    if (!box) return;

    // Wyciagnij wszystkie pierscienie (POLYGON lub MULTIPOLYGON)
    const pierscienie = wkt.match(/\(([^()]+)\)/g);
    if (!pierscienie || !pierscienie.length) return;

    const minLon = bboxMapy[0], minLat = bboxMapy[1], maxLon = bboxMapy[2], maxLat = bboxMapy[3];
    const szerLon = maxLon - minLon, szerLat = maxLat - minLat;
    if (szerLon <= 0 || szerLat <= 0) return;

    // Zbuduj SVG (viewBox 0..100 w obu osiach = procenty)
    let paths = '';
    pierscienie.forEach(function (p) {
      const wsp = p.replace(/[()]/g, '').trim().split(',');
      let d = '';
      wsp.forEach(function (para, i) {
        const xy = para.trim().split(/\s+/).map(Number);
        if (xy.length < 2 || isNaN(xy[0]) || isNaN(xy[1])) return;
        // WKT z ULDK: "lon lat" (X Y)
        const lon = xy[0], lat = xy[1];
        const x = ((lon - minLon) / szerLon) * 100;
        const y = ((maxLat - lat) / szerLat) * 100;   // Y odwrocone (gora = maxLat)
        d += (i === 0 ? 'M' : 'L') + x.toFixed(3) + ',' + y.toFixed(3) + ' ';
      });
      if (d) paths += '<path d="' + d + 'Z" fill="rgba(201,169,110,0.18)" stroke="#c9a961" stroke-width="0.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>';
    });
    if (!paths) return;

    // Usun poprzedni obrys jesli byl
    const stary = box.querySelector('.obrys-svg');
    if (stary) stary.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'obrys-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    svg.innerHTML = paths;
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
  function coords(lat, lon) { return dms(lat,'NS') + ' · ' + dms(lon,'EW'); }
  function dms(v, ax) {
    const dir = v>=0?ax[0]:ax[1]; v=Math.abs(v);
    const d=Math.floor(v), m=Math.floor((v-d)*60), s=Math.round(((v-d)*60-m)*60);
    return d+'°'+String(m).padStart(2,'0')+"'"+String(s).padStart(2,'0')+'"'+dir;
  }
})();
