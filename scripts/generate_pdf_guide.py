import os
import sys
import base64
from playwright.sync_api import sync_playwright

def get_b64_img(rel_path):
    full_path = os.path.abspath(rel_path)
    if not os.path.exists(full_path):
        return ""
    with open(full_path, "rb") as f:
        return f"data:image/png;base64,{base64.b64encode(f.read()).decode('ascii')}"

def generate_pdf():
    img_overview = get_b64_img('docs/screenshots/1_bewertung_overview.png')
    img_nav = get_b64_img('docs/screenshots/2_klassen_nav.png')
    img_schueler = get_b64_img('docs/screenshots/3_schuelerliste.png')
    img_quick = get_b64_img('docs/screenshots/4_quick_rating.png')
    img_raster = get_b64_img('docs/screenshots/5_kriterien_raster.png')
    img_multi = get_b64_img('docs/screenshots/6_multi_subject_2b.png')

    html_content = f"""<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>SMILE Bewertungs-Guide – MS Weissenbach</title>
  <style>
    @page {{
      size: A4 portrait;
      margin: 12mm 14mm 12mm 14mm;
    }}
    * {{
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 9.5pt;
      line-height: 1.45;
    }}
    .page {{
      page-break-after: always;
      height: 273mm;
      max-height: 273mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }}
    .page:last-child {{
      page-break-after: auto;
    }}
    
    /* Header & Footer */
    .header {{
      border-bottom: 2px solid #0f172a;
      padding-bottom: 6px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }}
    .header-title {{
      font-size: 15pt;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin: 0;
    }}
    .header-sub {{
      font-size: 8.5pt;
      color: #64748b;
      margin-top: 2px;
    }}
    .header-badge {{
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: bold;
      font-size: 8.5pt;
      color: #334155;
    }}
    .footer {{
      border-top: 1px solid #cbd5e1;
      padding-top: 4px;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #94a3b8;
    }}

    /* Typography & Containers */
    h2 {{
      font-size: 11pt;
      font-weight: 800;
      color: #0f172a;
      margin: 10px 0 4px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }}
    p {{
      margin: 0 0 6px 0;
    }}
    .lead {{
      font-size: 9pt;
      color: #475569;
    }}
    .card {{
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }}
    .card-highlight {{
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }}
    .badge {{
      display: inline-block;
      padding: 1.5px 6px;
      border-radius: 4px;
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }}
    .badge-lehrling {{ background: #ffe4e6; color: #be123c; border: 1px solid #fecdd3; }}
    .badge-geselle {{ background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }}
    .badge-meister {{ background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }}
    
    .screenshot {{
      width: 100%;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      margin: 4px 0 6px 0;
      display: block;
    }}
    
    .grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }}
    .grid-3 {{
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
    }}
    
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      margin-top: 4px;
      margin-bottom: 6px;
    }}
    th, td {{
      padding: 4px 6px;
      border: 1px solid #cbd5e1;
      text-align: left;
    }}
    th {{
      background: #f1f5f9;
      font-weight: 700;
      color: #1e293b;
    }}
    
    .step-num {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      background: #f59e0b;
      color: #0f172a;
      border-radius: 50%;
      font-size: 8pt;
      font-weight: 900;
      margin-right: 4px;
    }}
  </style>
</head>
<body>

  <!-- ==================== SEITE 1 ==================== -->
  <div class="page">
    <div>
      <div class="header">
        <div>
          <h1 class="header-title">SMILE Bewertungs-Leitfaden</h1>
          <div class="header-sub">MS Weissenbach · Schuljahr 2026/27 · Schnellanleitung für Lehrkräfte</div>
        </div>
        <div class="header-badge">Fokus: Modul Bewertung</div>
      </div>

      <!-- Intro: Die 3 Stufen -->
      <div class="card" style="margin-bottom: 10px;">
        <div style="font-weight: 800; font-size: 9pt; margin-bottom: 4px; color: #0f172a;">
          🎯 Die 3 Entwicklungsstufen im SMILE-Begleitsystem
        </div>
        <div class="grid-3">
          <div style="background: white; border: 1px solid #fecdd3; padding: 6px; border-radius: 6px;">
            <span class="badge badge-lehrling">🔴 Lehrling</span>
            <div style="font-size: 7.5pt; color: #475569; margin-top: 3px;">
              <strong>Starke Unterstützung nötig</strong> · Benötigt klare Leitplanken, strukturierte Hilfestellung und enge Begleitung.
            </div>
          </div>
          <div style="background: white; border: 1px solid #bae6fd; padding: 6px; border-radius: 6px;">
            <span class="badge badge-geselle">🔵 Geselle</span>
            <div style="font-size: 7.5pt; color: #475569; margin-top: 3px;">
              <strong>Regelstandard</strong> · Erfüllt schulische und soziale Erwartungen selbstständig, verlässlich und pflichtbewusst.
            </div>
          </div>
          <div style="background: white; border: 1px solid #fde68a; padding: 6px; border-radius: 6px;">
            <span class="badge badge-meister">🟡 Meister</span>
            <div style="font-size: 7.5pt; color: #475569; margin-top: 3px;">
              <strong>Spitzenleistung</strong> · Zeigt herausragende Eigeninitiative, Vorbildwirkung, soziale Reife und hohe Autonomie.
            </div>
          </div>
        </div>
      </div>

      <!-- Schritt 1: Navigation -->
      <h2><span class="step-num">1</span> Klasse &amp; Fach in der oberen Leiste wählen</h2>
      <p class="lead">
        Direkt unter dem Hauptmenü sehen Sie alle Klassen, in denen Sie unterrichten, samt Ihren Fächern gruppiert:
      </p>
      <img src="{img_nav}" class="screenshot" alt="Klassen Navigation" />
      <div style="font-size: 8pt; color: #475569; margin-bottom: 10px;">
        👉 <strong>1 Klick auf den Klassennamen</strong> (z. B. <code>3H</code> oder <code>2B</code>) wechselt sofort die Klasse. SMILE merkt sich die Auswahl automatisch.
      </div>

      <!-- Schritt 2: Schülerliste & Quick Rating -->
      <div class="grid-2">
        <div>
          <h2><span class="step-num">2</span> Schülerliste &amp; Filter</h2>
          <p class="lead">Links finden Sie die Klassenliste mit Status-Indikator:</p>
          <ul style="margin: 0; padding-left: 14px; font-size: 8pt; color: #334155; line-height: 1.4;">
            <li><strong>📁 Offen:</strong> Schüler*innen, die noch eingereicht werden müssen.</li>
            <li><strong>📁 Bewertet:</strong> Bereits fertig eingereichte Schüler*innen.</li>
            <li>Klick auf den Schülernamen öffnet die Bearbeitungsmaske.</li>
          </ul>
        </div>
        <div>
          <h2><span class="step-num">3</span> Schnellbewertung (1-Klick)</h2>
          <p class="lead">Für 90% der Schüler*innen genügt 1 Klick:</p>
          <div style="font-size: 8pt; color: #334155; line-height: 1.4;">
            Wählen Sie einfach direkt den passenden Status:
            <div style="margin-top: 4px;">
              <span class="badge badge-lehrling" style="margin-right: 2px;">🔴 Lehrling</span>
              <span class="badge badge-geselle" style="margin-right: 2px;">🔵 Geselle</span>
              <span class="badge badge-meister">🟡 Meister</span>
            </div>
            <strong>Auto-Save ist immer aktiv</strong> – Ihre Eingabe ist sofort im Server gespeichert!
          </div>
        </div>
      </div>

      <div style="margin-top: 6px;">
        <img src="{img_quick}" class="screenshot" alt="Schnellbewertung 1-Klick" />
      </div>

      <div class="card-highlight" style="margin-top: 6px;">
        <strong style="color: #92400e; font-size: 8pt;">💬 Optionale Notiz für die Konferenz:</strong>
        <span style="font-size: 7.8pt; color: #78350f;">
          Im Textfeld unter der Schnellbewertung können Sie eine kurze Begründung hinterlegen (z. B. <em>„Sehr fleißig, hilft Mitschülern“</em>). Diese erscheint im Konferenzprotokoll.
        </span>
      </div>

    </div>

    <div class="footer">
      <span>MS Weissenbach · SMILE Benutzerhandbuch</span>
      <span>Seite 1 von 3</span>
    </div>
  </div>


  <!-- ==================== SEITE 2 ==================== -->
  <div class="page">
    <div>
      <div class="header">
        <div>
          <h1 class="header-title">SMILE Bewertungs-Leitfaden</h1>
          <div class="header-sub">Feinjustierung über Beobachtungsbogen &amp; Gesamtbewertung</div>
        </div>
        <div class="header-badge">Schritte 4 – 6</div>
      </div>

      <!-- Schritt 4: Beobachtungsbogen -->
      <h2><span class="step-num">4</span> Beobachtungsbogen (18 Kriterien &amp; Merkmale)</h2>
      <p class="lead">
        Möchten Sie eine detaillierte Einschätzung vornehmen, klicken Sie auf <strong>„Beobachtungsbogen (18 Kriterien) · Auf Klick öffnen“</strong>:
      </p>
      <img src="{img_raster}" class="screenshot" alt="Beobachtungsbogen Kriterienraster" />
      
      <div class="grid-2" style="margin-top: 6px; font-size: 8pt;">
        <div class="card">
          <strong style="color: #0f172a;">Die 6 Kompetenzbereiche (je 3 Kriterien):</strong>
          <ol style="margin: 3px 0 0 0; padding-left: 14px; color: #475569; font-size: 7.8pt; line-height: 1.35;">
            <li>Arbeitsorganisation (Auftrag, Selbstständigkeit)</li>
            <li>Fragen &amp; Problemlösen (Verständnis, Hilfestellung)</li>
            <li>Sozialkompetenz (Teamfähigkeit, Respekt)</li>
            <li>Kommunikation &amp; Konfliktkultur (Umgangston)</li>
            <li>Regeln &amp; Werte (Verlässlichkeit, Pünktlichkeit)</li>
            <li>Einsatzfreude &amp; Ausdauer (Durchhaltevermögen)</li>
          </ol>
        </div>
        <div class="card">
          <strong style="color: #0f172a;">Die 4 Bewertungsstufen &amp; Merkmale:</strong>
          <div style="margin-top: 4px; font-size: 7.8pt; line-height: 1.4; color: #334155;">
            <div>👑 <strong>Krone / ++ :</strong> Vorbildlich &amp; herausragend (zählt positiv)</div>
            <div>😊 <strong>Smiley / + :</strong> Zuverlässig erreicht (zählt positiv)</div>
            <div>😐 <strong>Neutral / - :</strong> Teilweise / schwankend</div>
            <div>😢 <strong>Traurig / -- :</strong> Erheblicher Entwicklungsbedarf</div>
            <div style="margin-top: 3px; color: #0369a1; font-weight: 600;">
              ⚡ <strong>Tipp:</strong> Mit den <code>ALLE</code>-Buttons können Sie ganze Zeilen auf einmal bewerten!
            </div>
          </div>
        </div>
      </div>

      <!-- Schritt 5: Gesamtbewertung -->
      <h2><span class="step-num">5</span> Gesamtbewertung vs. Einzelfach-Anpassung</h2>
      <p class="lead">
        Wenn Sie in einer Klasse <strong>mehrere Fächer</strong> unterrichten (z. B. Deutsch + Förderunterricht + Biologie), bietet SMILE die smarte Fachauswahl:
      </p>
      <img src="{img_multi}" class="screenshot" alt="Fachauswahl Gesamt vs Einzelfach" />

      <div class="grid-2" style="font-size: 8pt; margin-top: 4px;">
        <div class="card" style="border-left: 3px solid #f59e0b;">
          <strong style="color: #b45309;">🌟 Gesamt (alle Fächer):</strong>
          <div style="font-size: 7.8pt; color: #475569; margin-top: 2px;">
            Standardmäßig aktiv. 1 Klick auf z. B. <em>Geselle</em> bewertet <strong>alle Ihre Fächer gleichzeitig</strong>. Perfekt für einheitliche Leistungen über alle Stunden.
          </div>
        </div>
        <div class="card" style="border-left: 3px solid #3b82f6;">
          <strong style="color: #1d4ed8;">🎯 Klick auf ein Einzelfach (z. B. D oder BUB):</strong>
          <div style="font-size: 7.8pt; color: #475569; margin-top: 2px;">
            Möchten Sie differenzieren (z. B. Schüler glänzt in Deutsch als <em>Meister</em>, ist in Biologie aber <em>Lehrling</em>)? Klicken Sie einfach das Einzelfach an und passen Sie die Stufe an!
          </div>
        </div>
      </div>

      <!-- Schritt 6: Einreichen -->
      <div class="card" style="background: #f0fdf4; border: 1px solid #bbf7d0; margin-top: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="color: #15803d; font-size: 8.5pt;">Schritt 6: Ranking einreichen &amp; Abschließen</strong>
            <div style="font-size: 7.8pt; color: #166534; margin-top: 1px;">
              Klicken Sie oben rechts auf den grünen Button <strong>✓ Ranking einreichen</strong>. Der Schüler wandert in den Ordner <em>Bewertet</em> und Ihre Stimme zählt offiziell in der Notenkonferenz!
            </div>
          </div>
          <span style="background: #16a34a; color: white; padding: 4px 10px; border-radius: 6px; font-weight: 800; font-size: 8pt; white-space: nowrap;">
            ✓ Einreichen
          </span>
        </div>
      </div>

    </div>

    <div class="footer">
      <span>MS Weissenbach · SMILE Benutzerhandbuch</span>
      <span>Seite 2 von 3</span>
    </div>
  </div>


  <!-- ==================== SEITE 3 ==================== -->
  <div class="page">
    <div>
      <div class="header">
        <div>
          <h1 class="header-title">SMILE Bewertungs-Leitfaden</h1>
          <div class="header-sub">Wie zählt meine Stimme? · Stundengewichtung &amp; Notenkonferenz</div>
        </div>
        <div class="header-badge">Konferenz-Algorithmus</div>
      </div>

      <!-- Grundprinzip -->
      <h2>⚖️ Das Grundprinzip: Stimmengewichtung nach Wochenstunden</h2>
      <p class="lead">
        In SMILE zählt nicht jede Stimme stur als „1 Stimme“. Stattdessen wird jede Bewertung mit den <strong>tatsächlichen Unterrichtsstunden pro Woche</strong> laut offiziellem Stundenplan (WebUntis) gewichtet:
      </p>

      <div class="card">
        <div class="grid-3" style="text-align: center; font-size: 8pt;">
          <div>
            <div style="font-weight: 800; font-size: 11pt; color: #0f172a;">4h / Woche</div>
            <div style="color: #64748b; font-size: 7.5pt;">z. B. Deutsch / Mathe</div>
            <div style="font-weight: 700; color: #d97706; margin-top: 2px;">Gewicht: 4</div>
          </div>
          <div>
            <div style="font-weight: 800; font-size: 11pt; color: #0f172a;">2h / Woche</div>
            <div style="color: #64748b; font-size: 7.5pt;">z. B. Biologie / Geschichte</div>
            <div style="font-weight: 700; color: #2563eb; margin-top: 2px;">Gewicht: 2</div>
          </div>
          <div>
            <div style="font-weight: 800; font-size: 11pt; color: #0f172a;">1h / Woche</div>
            <div style="color: #64748b; font-size: 7.5pt;">z. B. Förderunterricht</div>
            <div style="font-weight: 700; color: #059669; margin-top: 2px;">Gewicht: 1</div>
          </div>
        </div>
      </div>

      <!-- Team Teaching Regel -->
      <h2>👥 Die Team-Teaching-Regel (Deutsch, Englisch, Mathematik)</h2>
      <p class="lead">
        In den Hauptfächern unterrichten zwei Lehrkräfte gemeinsam im Team. SMILE garantiert, dass Hauptfächer ihr volles institutionelles Gewicht (zusammen 8 Stunden) behalten:
      </p>
      
      <table>
        <thead>
          <tr>
            <th>Konstellation</th>
            <th>Lehrkraft 1 (z. B. 4h)</th>
            <th>Lehrkraft 2 (z. B. 3h)</th>
            <th>Gesamtgewicht Hauptfach</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Beide Lehrkräfte geben ab</strong></td>
            <td>Bringt eigene 4h ein (Gewicht 4)</td>
            <td>Bringt eigene 3h ein (Gewicht 3)</td>
            <td><strong>7 Stunden</strong> fließen in die Abstimmung</td>
          </tr>
          <tr>
            <td><strong>Nur 1 Lehrkraft gibt ab</strong> (z.B. Kollege krank)</td>
            <td>Stunden werden <strong>verdoppelt: 8h</strong></td>
            <td>—</td>
            <td><strong>8 Stunden</strong> (Fach verliert kein Stimmgewicht!)</td>
          </tr>
        </tbody>
      </table>

      <!-- Rechenbeispiel -->
      <h2>📊 Konkretes Berechnungsbeispiel in der Konferenz</h2>
      <p class="lead">
        So entsteht der Stunden-Vorschlag (*suggestedRankByHours*) für eine Schülerin:
      </p>

      <table>
        <thead>
          <tr>
            <th>Fach &amp; Lehrkraft</th>
            <th>Vorschlag</th>
            <th>Stunden</th>
            <th>Gewicht</th>
            <th>Effekt auf die Konferenz-Töpfe</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Deutsch (Lehrkraft A)</td>
            <td><span class="badge badge-meister">Meister</span></td>
            <td>4h</td>
            <td>4h</td>
            <td>+4h zu Meister</td>
          </tr>
          <tr>
            <td>Deutsch (Lehrkraft B)</td>
            <td><span class="badge badge-geselle">Geselle</span></td>
            <td>3h</td>
            <td>3h</td>
            <td>+3h zu Geselle</td>
          </tr>
          <tr>
            <td>Mathematik (nur 1 Abgabe)</td>
            <td><span class="badge badge-geselle">Geselle</span></td>
            <td>4h</td>
            <td>8h (x2)</td>
            <td>+8h zu Geselle</td>
          </tr>
          <tr>
            <td>Biologie</td>
            <td><span class="badge badge-meister">Meister</span></td>
            <td>2h</td>
            <td>2h</td>
            <td>+2h zu Meister</td>
          </tr>
          <tr>
            <td>Geschichte</td>
            <td><span class="badge badge-lehrling">Lehrling</span></td>
            <td>2h</td>
            <td>2h</td>
            <td>+2h zu Lehrling</td>
          </tr>
          <tr style="background: #f8fafc; font-weight: bold;">
            <td colspan="4">Ergebnis der Stunden-Akkumulation (Gesamt: 19h):</td>
            <td>
              Meister: <strong>6h</strong> (32%) · Geselle: <strong>11h</strong> (58%) · Lehrling: <strong>2h</strong> (10%)<br>
              ➔ System-Vorschlag: <span class="badge badge-geselle">GESELLE (58% Mehrheit)</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div style="font-size: 7.8pt; color: #475569; margin: 4px 0 8px 0; background: #f8fafc; padding: 4px 8px; border-radius: 6px; border-left: 3px solid #0284c7;">
        💡 <strong>Mehrere Fächer derselben Lehrkraft:</strong> Wenn Sie einen Schüler in Fach A (z. B. Deutsch 4h) als <em>Meister</em> und in Fach B (z. B. Biologie 2h) als <em>Lehrling</em> einstufen, fließen genau 4h zu Meister und 2h zu Lehrling in den Konferenztopf ein – jedes Fach zählt mit seinen eigenen Stunden!
      </div>

      <!-- Rote Karte & Beschluss -->
      <div class="grid-2" style="margin-top: 6px; font-size: 8pt;">
        <div class="card-highlight" style="border-color: #fca5a5; background: #fff1f2;">
          <strong style="color: #9f1239;">🚨 Rote Verhaltenskarte (Rangabzug):</strong>
          <div style="font-size: 7.8pt; color: #881337; margin-top: 2px;">
            Liegt eine aktive Rote Karte vor, wird der Rang <strong>automatisch um 1 Stufe abgewertet</strong> (z. B. Meister ➔ Geselle). Im Protokoll wird dies als <code>(Rangabzug Karte)</code> deklariert.
          </div>
        </div>
        <div class="card" style="border-color: #cbd5e1;">
          <strong style="color: #0f172a;">🏛️ Konferenzbeschluss (Schulleitung / KV):</strong>
          <div style="font-size: 7.8pt; color: #475569; margin-top: 2px;">
            Der Stunden-Vorschlag ist eine fundierte Entscheidungshilfe. In der Notenkonferenz bestätigt die Konferenzleitung den Beschluss mit 1 Klick oder begründet allfällige Ausnahmen.
          </div>
        </div>
      </div>

    </div>

    <div class="footer">
      <span>MS Weissenbach · SMILE Benutzerhandbuch</span>
      <span>Seite 3 von 3</span>
    </div>
  </div>

</body>
</html>
"""

    out_html_path = os.path.abspath('docs/SMILE_Bewertungs_Guide.html')
    out_pdf_path = os.path.abspath('docs/SMILE_Bewertungs_Guide.pdf')
    
    with open(out_html_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print("HTML created at:", out_html_path)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page()
        page.goto(f'file:///{out_html_path.replace(os.sep, "/")}', wait_until='networkidle')
        page.pdf(
            path=out_pdf_path,
            format='A4',
            print_background=True,
            margin={'top': '10mm', 'bottom': '10mm', 'left': '12mm', 'right': '12mm'}
        )
        print("PDF generated successfully at:", out_pdf_path)
        browser.close()

if __name__ == '__main__':
    generate_pdf()
