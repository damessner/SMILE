"""Erzeugt docs/SMILE_Erklaerung_Bewertung.html — den interaktiven Bewertungs-Leitfaden
mit eingebetteten Screenshots (Base64).

Die Screenshots liegen in docs/screenshots/ und sind absichtlich gitignored (sie zeigen
echte Schülerdaten); die erzeugte HTML-Datei ebenso. Das Skript läuft daher nur in einem
lokalen Checkout, in dem die Screenshots vorhanden sind. Das versionierte, verteilbare
Ergebnis ist das PDF docs/SMILE_Bewertungs_Guide.pdf.

Aufruf (aus dem Repo-Wurzelverzeichnis): python scripts/generate_html_guide.py
"""
import os
import base64

def get_b64(path):
    full_path = os.path.abspath(path)
    if not os.path.exists(full_path):
        print(f"Warning: File not found: {full_path}")
        return ""
    with open(full_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
        ext = os.path.splitext(path)[1].lower().replace(".", "")
        mime = "image/png" if ext == "png" else "image/jpeg"
        return f"data:{mime};base64,{encoded}"

def build_guide():
    img_overview = get_b64('docs/screenshots/1_overview.png')
    img_nav = get_b64('docs/screenshots/2_klassen_nav.png')
    img_schueler = get_b64('docs/screenshots/3_schuelerliste.png')
    img_quick = get_b64('docs/screenshots/4_quick_rating.png')
    img_raster = get_b64('docs/screenshots/5_kriterien_raster.png')
    img_multi = get_b64('docs/screenshots/6_multi_subject_2b.png')

    html = """<!DOCTYPE html>
<html lang="de" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMILE Bewertungs-Leitfaden – MS Weissenbach</title>
  <style>
    :root {
      --primary: #0284c7;
      --primary-dark: #0369a1;
      --slate-50: #f8fafc;
      --slate-100: #f1f5f9;
      --slate-200: #e2e8f0;
      --slate-300: #cbd5e1;
      --slate-400: #94a3b8;
      --slate-600: #475569;
      --slate-700: #334155;
      --slate-800: #1e293b;
      --slate-900: #0f172a;
      --lehrling-bg: #ffe4e6;
      --lehrling-text: #be123c;
      --lehrling-border: #fecdd3;
      --geselle-bg: #e0f2fe;
      --geselle-text: #0369a1;
      --geselle-border: #bae6fd;
      --meister-bg: #fef3c7;
      --meister-text: #b45309;
      --meister-border: #fde68a;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--slate-800);
      background-color: #f8fafc;
      line-height: 1.6;
    }

    /* Layout */
    .app-container {
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 290px;
      background: var(--slate-900);
      color: #f8fafc;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      padding: 24px 16px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--slate-800);
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--slate-800);
    }

    .sidebar-logo {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #38bdf8, #0284c7);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 900;
      color: white;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
    }

    .sidebar-title {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: -0.3px;
      color: white;
    }

    .sidebar-subtitle {
      font-size: 11px;
      color: var(--slate-400);
    }

    .nav-group-title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--slate-400);
      margin: 16px 8px 6px 8px;
    }

    .nav-links {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      color: var(--slate-300);
      text-decoration: none;
      font-size: 13.5px;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .nav-link:hover {
      background: var(--slate-800);
      color: white;
      transform: translateX(3px);
    }

    .nav-link.active {
      background: rgba(2, 132, 199, 0.2);
      color: #38bdf8;
      font-weight: 600;
      border-left: 3px solid #38bdf8;
    }

    .sidebar-footer {
      margin-top: auto;
      padding-top: 16px;
      border-top: 1px solid var(--slate-800);
      font-size: 11px;
      color: var(--slate-400);
    }

    /* Main Content Area */
    .main-content {
      flex: 1;
      max-width: 1140px;
      padding: 40px 48px;
      overflow-x: hidden;
    }

    /* Hero Banner */
    .hero {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: white;
      padding: 36px 40px;
      border-radius: 20px;
      margin-bottom: 36px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.15);
      position: relative;
      overflow: hidden;
    }

    .hero::after {
      content: "";
      position: absolute;
      top: -50px;
      right: -50px;
      width: 250px;
      height: 250px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%);
      border-radius: 50%;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .hero-title {
      font-size: 30px;
      font-weight: 900;
      letter-spacing: -0.5px;
      margin-bottom: 10px;
      line-height: 1.25;
    }

    .hero-desc {
      font-size: 15px;
      color: var(--slate-300);
      max-width: 780px;
      line-height: 1.6;
    }

    /* Content Sections */
    section {
      background: white;
      border: 1px solid var(--slate-200);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 32px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--slate-100);
    }

    .section-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }

    .icon-blue { background: #e0f2fe; color: #0284c7; }
    .icon-amber { background: #fef3c7; color: #d97706; }
    .icon-emerald { background: #dcfce7; color: #16a34a; }
    .icon-purple { background: #f3e8ff; color: #9333ea; }
    .icon-rose { background: #ffe4e6; color: #e11d48; }

    .section-title {
      font-size: 22px;
      font-weight: 800;
      color: var(--slate-900);
      letter-spacing: -0.3px;
    }

    .section-subtitle {
      font-size: 13px;
      color: var(--slate-600);
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .badge-lehrling { background: var(--lehrling-bg); color: var(--lehrling-text); border: 1px solid var(--lehrling-border); }
    .badge-geselle { background: var(--geselle-bg); color: var(--geselle-text); border: 1px solid var(--geselle-border); }
    .badge-meister { background: var(--meister-bg); color: var(--meister-text); border: 1px solid var(--meister-border); }

    /* Cards & Grids */
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin: 20px 0;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin: 20px 0;
    }

    .card {
      background: var(--slate-50);
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      padding: 20px;
      position: relative;
    }

    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--slate-900);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-body {
      font-size: 13.5px;
      color: var(--slate-600);
      line-height: 1.5;
    }

    /* Callout Boxes */
    .callout {
      border-left: 4px solid;
      border-radius: 8px;
      padding: 14px 18px;
      margin: 18px 0;
      font-size: 13.5px;
    }

    .callout-info {
      background: #f0f9ff;
      border-color: #0284c7;
      color: #0369a1;
    }

    .callout-warning {
      background: #fffbeb;
      border-color: #f59e0b;
      color: #92400e;
    }

    .callout-danger {
      background: #fff1f2;
      border-color: #f43f5e;
      color: #9f1239;
    }

    .callout-success {
      background: #f0fdf4;
      border-color: #22c55e;
      color: #15803d;
    }

    /* Image Display Cards */
    .screenshot-card {
      background: #ffffff;
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      padding: 16px;
      margin: 20px 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
    }

    .screenshot-img {
      width: 100%;
      border-radius: 8px;
      border: 1px solid var(--slate-200);
      display: block;
      transition: transform 0.2s ease;
      cursor: zoom-in;
    }

    .screenshot-caption {
      margin-top: 10px;
      font-size: 12.5px;
      color: var(--slate-600);
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
    }

    /* Interactive Mock UI Navigation */
    .mock-browser {
      background: var(--slate-900);
      border-radius: 14px;
      border: 1px solid var(--slate-700);
      overflow: hidden;
      margin: 24px 0;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.3);
    }

    .mock-browser-topbar {
      background: #090e17;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--slate-800);
    }

    .mock-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .dot-red { background: #ef4444; }
    .dot-yellow { background: #eab308; }
    .dot-green { background: #22c55e; }

    .mock-address {
      margin-left: 12px;
      background: var(--slate-800);
      color: var(--slate-400);
      padding: 3px 12px;
      border-radius: 6px;
      font-size: 11px;
      font-family: monospace;
      flex: 1;
      max-width: 320px;
    }

    .mock-interface {
      padding: 16px;
      background: #0f172a;
      color: white;
    }

    /* Mock Header Bars */
    .mock-class-bar {
      display: flex;
      gap: 8px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--slate-800);
      overflow-x: auto;
    }

    .mock-class-btn {
      background: var(--slate-800);
      color: var(--slate-300);
      border: 1px solid var(--slate-700);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .mock-class-btn.active {
      background: #0284c7;
      color: white;
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
    }

    .mock-class-btn:hover:not(.active) {
      background: var(--slate-700);
      color: white;
    }

    /* Mock Subject Switcher */
    .mock-subject-bar {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      align-items: center;
    }

    .mock-subject-label {
      font-size: 11.5px;
      color: var(--slate-400);
      font-weight: 600;
      text-transform: uppercase;
    }

    .mock-sub-pill {
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .mock-sub-pill.active {
      background: #1e293b;
      color: #38bdf8;
      border-color: #0284c7;
    }
    .mock-sub-pill:not(.active) {
      background: rgba(30, 41, 59, 0.5);
      color: var(--slate-400);
    }

    /* Mock Pupil & Rating Action */
    .mock-workspace {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 16px;
      margin-top: 16px;
    }

    .mock-pupil-list {
      background: var(--slate-800);
      border-radius: 10px;
      border: 1px solid var(--slate-700);
      padding: 10px;
    }

    .mock-pupil-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
      background: var(--slate-900);
      padding: 3px;
      border-radius: 6px;
    }

    .mock-pupil-tab {
      flex: 1;
      text-align: center;
      padding: 4px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
      color: var(--slate-400);
    }

    .mock-pupil-tab.active {
      background: var(--slate-800);
      color: white;
    }

    .mock-pupil-item {
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      transition: all 0.15s;
    }

    .mock-pupil-item.active {
      background: #0284c7;
      color: white;
    }
    .mock-pupil-item:not(.active) {
      background: rgba(15, 23, 42, 0.4);
      color: var(--slate-300);
    }

    /* Mock Detail Stage */
    .mock-detail-stage {
      background: var(--slate-800);
      border-radius: 10px;
      border: 1px solid var(--slate-700);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .mock-stage-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--slate-700);
      padding-bottom: 12px;
    }

    .mock-pupil-name {
      font-size: 16px;
      font-weight: 800;
      color: white;
    }

    .mock-btn-group {
      display: flex;
      gap: 8px;
    }

    .mock-action-btn {
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: transform 0.1s, opacity 0.15s;
    }

    .mock-action-btn:active {
      transform: scale(0.96);
    }

    .btn-lehrling { background: #ffe4e6; color: #be123c; }
    .btn-geselle { background: #e0f2fe; color: #0369a1; }
    .btn-meister { background: #fef3c7; color: #b45309; }
    .btn-submit { background: #16a34a; color: white; }
    .btn-reopen { background: #334155; color: #e2e8f0; border: 1px solid #475569; }
    .btn-reset { background: #334155; color: #f59e0b; border: 1px solid #475569; }

    /* Explanatory dynamic panel */
    .mock-explainer {
      margin-top: 14px;
      background: #1e293b;
      border-left: 4px solid #38bdf8;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 12.5px;
      color: #e2e8f0;
      line-height: 1.5;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13.5px;
      margin: 16px 0;
    }

    th, td {
      padding: 10px 14px;
      border: 1px solid var(--slate-200);
      text-align: left;
    }

    th {
      background: var(--slate-100);
      font-weight: 700;
      color: var(--slate-900);
    }

    tr:nth-child(even) {
      background: var(--slate-50);
    }

    /* Interactive Simulator */
    .sim-box {
      background: var(--slate-50);
      border: 2px solid var(--slate-200);
      border-radius: 14px;
      padding: 24px;
      margin: 20px 0;
    }

    .sim-slider-wrap {
      margin: 20px 0;
    }

    .sim-slider {
      width: 100%;
      height: 8px;
      border-radius: 4px;
      outline: none;
      -webkit-appearance: none;
      background: var(--slate-300);
    }

    .sim-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #0284c7;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      border: 2px solid white;
    }

    .sim-meter-bar {
      height: 14px;
      background: var(--slate-200);
      border-radius: 7px;
      overflow: hidden;
      margin: 12px 0 6px 0;
      display: flex;
    }

    .sim-meter-fill {
      height: 100%;
      transition: width 0.25s ease, background-color 0.25s ease;
    }

    .sim-result-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: white;
      border: 1px solid var(--slate-200);
      border-radius: 10px;
      padding: 16px 20px;
      margin-top: 16px;
    }

    /* Conference Live Calculator */
    .conf-table {
      font-size: 13px;
    }
    .conf-table select {
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--slate-300);
      background: white;
      font-weight: 600;
    }

    /* Print styles */
    @media print {
      .sidebar { display: none; }
      .main-content { padding: 0; max-width: 100%; }
      section { break-inside: avoid; border: 1px solid #ccc; }
      .mock-browser { break-inside: avoid; }
    }

    @media (max-width: 900px) {
      .app-container { flex-direction: column; }
      .sidebar { width: 100%; height: auto; position: relative; }
      .main-content { padding: 20px; }
      .grid-3, .grid-2 { grid-template-columns: 1fr; }
      .mock-workspace { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<div class="app-container">

  <!-- ==================== SIDEBAR ==================== -->
  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="sidebar-logo">S</div>
      <div>
        <div class="sidebar-title">SMILE Leitfaden</div>
        <div class="sidebar-subtitle">MS Weissenbach · Modul Bewertung</div>
      </div>
    </div>

    <div class="nav-group-title">Themen-Navigation</div>
    <ul class="nav-links">
      <li><a href="#uebersicht" class="nav-link active">🎯 Die 3 Stufen</a></li>
      <li><a href="#interaktiv" class="nav-link">🚀 Interaktive Navigation</a></li>
      <li><a href="#abgeben" class="nav-link">✍️ 1. Bewertung abgeben</a></li>
      <li><a href="#zuruecksetzen" class="nav-link">🔄 2. Zurücksetzen & Korrektur</a></li>
      <li><a href="#berechnung-kriterien" class="nav-link">📊 3. Rang aus 18 Kriterien</a></li>
      <li><a href="#berechnung-konferenz" class="nav-link">⚖️ 4. Konferenz-Berechnung</a></li>
      <li><a href="#simulator" class="nav-link">🧮 5. Live Konferenz-Rechner</a></li>
      <li><a href="#faq" class="nav-link">💡 Häufige Fragen & FAQ</a></li>
    </ul>

    <div class="sidebar-footer">
      <div><strong>SMILE Begleitsystem</strong></div>
      <div>Version 2026/27 · Schulbetrieb</div>
    </div>
  </aside>

  <!-- ==================== MAIN CONTENT ==================== -->
  <main class="main-content">

    <!-- Hero Header -->
    <div class="hero">
      <div class="hero-badge">📖 Interaktives Benutzerhandbuch</div>
      <h1 class="hero-title">Bewertungen, Rücknahme &amp; Rang-Berechnung</h1>
      <p class="hero-desc">
        Alles, was Sie als Lehrkraft an der Mittelschule Weissenbach über die Schülerbewertung in SMILE wissen müssen:
        Wie Sie schnell und rechtssicher bewerten, Fehler korrigieren und wie das System aus Ihren Stimmen den exakten Konferenz-Vorschlag berechnet.
      </p>
    </div>

    <!-- 1. ÜBERSICHT & DIE 3 RÄNGE -->
    <section id="uebersicht">
      <div class="section-header">
        <div class="section-icon icon-blue">🎯</div>
        <div>
          <h2 class="section-title">Die 3 Entwicklungsstufen im SMILE-System</h2>
          <div class="section-subtitle">Pädagogische Einordnung im Schulalltag</div>
        </div>
      </div>

      <p>
        In SMILE beurteilen wir nicht einfach mit Noten von 1 bis 5, sondern begleiten Schüler*innen über drei klare, transparente Kompetenz- und Entwicklungsstufen:
      </p>

      <div class="grid-3">
        <!-- Lehrling -->
        <div class="card" style="border-top: 4px solid #f43f5e;">
          <div class="card-title">
            <span>🔴 Lehrling</span>
            <span class="badge badge-lehrling">Stufe 1</span>
          </div>
          <div class="card-body">
            <strong>Starke Unterstützung nötig:</strong><br>
            Der Schüler benötigt engmaschige Begleitung, strukturierte Hilfestellungen und klare Leitplanken. Arbeitsorganisation oder Verlässlichkeit sind noch entwicklungsbedürftig.
          </div>
        </div>

        <!-- Geselle -->
        <div class="card" style="border-top: 4px solid #0284c7;">
          <div class="card-title">
            <span>🔵 Geselle</span>
            <span class="badge badge-geselle">Regelstandard</span>
          </div>
          <div class="card-body">
            <strong>Solide &amp; eigenständig:</strong><br>
            Der schulische Standard. Die Schülerin erfüllt fachliche und soziale Erwartungen verlässlich, arbeitet selbstständig mit und hält Vereinbarungen pflichtbewusst ein.
          </div>
        </div>

        <!-- Meister -->
        <div class="card" style="border-top: 4px solid #f59e0b;">
          <div class="card-title">
            <span>🟡 Meister</span>
            <span class="badge badge-meister">Spitzenleistung</span>
          </div>
          <div class="card-body">
            <strong>Herausragend &amp; Vorbild:</strong><br>
            Zeigt außergewöhnliche Eigeninitiative, hohe Eigenverantwortung, soziale Reife und Vorbildwirkung für Mitschüler*innen im Unterricht und Schulalltag.
          </div>
        </div>
      </div>

      <div class="callout callout-info">
        💡 <strong>Wichtig für die Praxis:</strong> Der Status <em>Geselle</em> ist der gesunde Regelstandard. Ein Schüler muss nicht zwingend Meister sein – Geselle bedeutet bereits volle Zielerreichung im Schulalltag!
      </div>
    </section>

    <!-- 2. INTERAKTIVE NAVIGATION (MOCKUP) -->
    <section id="interaktiv">
      <div class="section-header">
        <div class="section-icon icon-purple">🚀</div>
        <div>
          <h2 class="section-title">Interaktive Beispiel-Navigation</h2>
          <div class="section-subtitle">Klicken Sie auf die Schaltflächen, um ihre genaue Funktion kennenzulernen</div>
        </div>
      </div>

      <p>
        Hier sehen Sie eine interaktive Simulation der echten SMILE-Benutzeroberfläche. Probieren Sie die Bedienelemente direkt aus:
      </p>

      <!-- Mock Browser Window -->
      <div class="mock-browser">
        <div class="mock-browser-topbar">
          <div class="mock-dot dot-red"></div>
          <div class="mock-dot dot-yellow"></div>
          <div class="mock-dot dot-green"></div>
          <div class="mock-address">smile.ms-weissenbach.ac.at / bewertung</div>
        </div>

        <div class="mock-interface">
          <!-- 1. Klassen-Leiste -->
          <div class="mock-class-bar">
            <button class="mock-class-btn" onclick="demoClick('class', '1A', event)">1A (6h)</button>
            <button class="mock-class-btn active" onclick="demoClick('class', '2B', event)">2B (D + FU · 5h)</button>
            <button class="mock-class-btn" onclick="demoClick('class', '3H', event)">3H (4h)</button>
            <button class="mock-class-btn" onclick="demoClick('class', '4A', event)">4A (3h)</button>
          </div>

          <!-- 2. Fach-Leiste -->
          <div class="mock-subject-bar">
            <span class="mock-subject-label">Fachauswahl:</span>
            <button id="demo-sub-all" class="mock-sub-pill active" onclick="demoClick('subject', 'ALL', event)">🌟 Gesamt (D + FU)</button>
            <button id="demo-sub-d" class="mock-sub-pill" onclick="demoClick('subject', 'D', event)">Deutsch (4h)</button>
            <button id="demo-sub-fu" class="mock-sub-pill" onclick="demoClick('subject', 'FU', event)">Förderunterricht (1h)</button>
          </div>

          <!-- 3. Arbeitsbereich (Liste + Schüler) -->
          <div class="mock-workspace">
            <!-- Linke Spalte: Schülerliste -->
            <div class="mock-pupil-list">
              <div class="mock-pupil-tabs">
                <button id="tab-offen" class="mock-pupil-tab active" onclick="demoClick('tab', 'offen', event)">📁 Offen (14)</button>
                <button id="tab-bewertet" class="mock-pupil-tab" onclick="demoClick('tab', 'bewertet', event)">📁 Bewertet (6)</button>
              </div>
              <div id="pupil-item-1" class="mock-pupil-item active" onclick="demoClick('pupil', 'Anna', event)">
                <span>Anna Muster</span>
                <span class="badge badge-geselle" style="font-size:9px;">Vorschlag</span>
              </div>
              <div id="pupil-item-2" class="mock-pupil-item" onclick="demoClick('pupil', 'David', event)">
                <span>David Gruber</span>
                <span style="font-size:10px; color:#94a3b8;">Offen</span>
              </div>
              <div id="pupil-item-3" class="mock-pupil-item" onclick="demoClick('pupil', 'Elena', event)">
                <span>Elena Huber</span>
                <span style="font-size:10px; color:#94a3b8;">Offen</span>
              </div>
            </div>

            <!-- Rechte Spalte: Bewertungsmaske -->
            <div class="mock-detail-stage">
              <div class="mock-stage-header">
                <div>
                  <div class="mock-pupil-name" id="demo-pupil-header">Anna Muster (2B)</div>
                  <div style="font-size:11.5px; color:#94a3b8;">Modus: <span id="demo-mode-header">Gesamtbewertung (D + FU)</span></div>
                </div>

                <div class="mock-btn-group">
                  <button class="mock-action-btn btn-reset" onclick="demoClick('action', 'reset', event)">
                    🔄 Reset (Leeren)
                  </button>
                  <button id="demo-reopen-btn" class="mock-action-btn btn-reopen" style="display:none;" onclick="demoClick('action', 'reopen', event)">
                    ↩ Einreichung zurücknehmen
                  </button>
                  <button id="demo-submit-btn" class="mock-action-btn btn-submit" onclick="demoClick('action', 'submit', event)">
                    ✓ Ranking einreichen
                  </button>
                </div>
              </div>

              <!-- Schnellbewertung Buttons -->
              <div>
                <div style="font-size:11.5px; color:#94a3b8; margin-bottom:6px; font-weight:700;">SCHNELLBEWERTUNG (1-KLICK):</div>
                <div class="mock-btn-group">
                  <button class="mock-action-btn btn-lehrling" onclick="demoClick('rate', 'Lehrling', event)">🔴 Lehrling</button>
                  <button class="mock-action-btn btn-geselle" onclick="demoClick('rate', 'Geselle', event)">🔵 Geselle</button>
                  <button class="mock-action-btn btn-meister" onclick="demoClick('rate', 'Meister', event)">🟡 Meister</button>
                </div>
              </div>

              <!-- Raster toggle button -->
              <div>
                <button class="mock-action-btn" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; width:100%; justify-content:center;" onclick="demoClick('action', 'raster', event)">
                  📋 Beobachtungsbogen (18 Kriterien) · Auf Klick öffnen ▾
                </button>
              </div>

              <!-- Dynamische Erklärung -->
              <div class="mock-explainer" id="demo-explainer">
                👆 <strong>Tippen Sie oben auf ein beliebiges Element</strong>, um zu sehen, was es bewirkt und wie es im System gespeichert wird!
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 3. BEWERTUNG ABGEBEN -->
    <section id="abgeben">
      <div class="section-header">
        <div class="section-icon icon-emerald">✍️</div>
        <div>
          <h2 class="section-title">1. Wie gibt man eine Bewertung ab?</h2>
          <div class="section-subtitle">Zwei flexible Wege: Schnellbewertung oder detaillierter Beobachtungsbogen</div>
        </div>
      </div>

      <p>
        In SMILE wählen Sie oben die Klasse aus und sehen sofort die Schülerliste. Es gibt zwei Wege zur Bewertung:
      </p>

      <!-- Schritt 1 & 2 -->
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Weg A: Schnellbewertung (1-Klick)</div>
          <div class="card-body">
            <strong>Für 90% der Schüler*innen:</strong>
            <p style="margin-top:6px;">
              Klicken Sie einfach auf den gewünschten Button: <strong>Lehrling</strong>, <strong>Geselle</strong> oder <strong>Meister</strong>.
            </p>
            <ul style="margin-left: 18px; margin-top: 6px; font-size: 13px;">
              <li>Das System setzt im Hintergrund automatisch die passende Anzahl an Merkmalen.</li>
              <li><strong>Auto-Save ist immer aktiv:</strong> Ihre Eingabe ist im selben Sekundenbruchteil in der Datenbank gespeichert.</li>
              <li>Optional: Im Notizfeld eine kurze Begründung für die Notenkonferenz eintragen.</li>
            </ul>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Weg B: Beobachtungsbogen (18 Kriterien)</div>
          <div class="card-body">
            <strong>Für differenzierte Einschätzungen:</strong>
            <p style="margin-top:6px;">
              Klick auf <em>„Beobachtungsbogen (18 Kriterien)“</em> öffnet das vollständige Raster.
            </p>
            <ul style="margin-left: 18px; margin-top: 6px; font-size: 13px;">
              <li>6 Kompetenzbereiche mit je 3 Merkmalen (insgesamt 18 Kriterien).</li>
              <li>4 Stufen: 👑 Krone (`++`), 😊 Smiley (`+`), 😐 Neutral (`-`), 😢 Traurig (`--`).</li>
              <li><strong>ALLE-Buttons:</strong> Ermöglichen das zeilenweise Ausfüllen mit einem einzigen Klick.</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Screenshot Schnellbewertung -->
      <div class="screenshot-card">
        <img src="[[IMG_QUICK]]" class="screenshot-img" alt="Schnellbewertung 1-Klick" onclick="openLightbox(this)">
        <div class="screenshot-caption">
          📸 <em>Screenshot aus der Praxis: 1-Klick-Schnellbewertung mit Notizfeld für die Notenkonferenz</em>
        </div>
      </div>

      <!-- Screenshot Beobachtungsbogen Raster -->
      <div class="screenshot-card">
        <img src="[[IMG_RASTER]]" class="screenshot-img" alt="Beobachtungsbogen Raster 18 Kriterien" onclick="openLightbox(this)">
        <div class="screenshot-caption">
          📸 <em>Screenshot: Detaillierter Beobachtungsbogen mit 18 Merkmalen und den Schnell-Buttons</em>
        </div>
      </div>

      <!-- Multi-Fach Erklärung -->
      <h3 style="font-size: 17px; font-weight: 800; margin: 24px 0 10px 0; color: var(--slate-900);">
        🌟 Besonderheit: Wenn Sie mehrere Fächer in einer Klasse unterrichten
      </h3>
      <p>
        Unterrichten Sie z. B. in der 2B sowohl Deutsch als auch Förderunterricht, bietet SMILE eine intelligente Fachauswahl:
      </p>

      <div class="screenshot-card">
        <img src="[[IMG_MULTI]]" class="screenshot-img" alt="Multi-Fach Auswahl Gesamt vs Einzelfach" onclick="openLightbox(this)">
        <div class="screenshot-caption">
          📸 <em>Screenshot: Auswahl zwischen „Gesamt (alle Fächer)“ und individuellen Einzelfächern (z. B. D oder BUB)</em>
        </div>
      </div>

      <div class="grid-2">
        <div class="card" style="border-left: 3px solid #f59e0b;">
          <strong style="color: #b45309;">🌟 Modus „Gesamt (alle Fächer)“:</strong>
          <div style="font-size: 13px; color: var(--slate-600); margin-top: 4px;">
            Standardmäßig aktiv. 1 Klick auf z. B. <em>Geselle</em> bewertet <strong>alle Ihre Fächer gleichzeitig</strong>. Das spart bis zu 70% Zeit bei einheitlichen Leistungen über alle Unterrichtsstunden hinweg.
          </div>
        </div>
        <div class="card" style="border-left: 3px solid #0284c7;">
          <strong style="color: #0369a1;">🎯 Klick auf ein Einzelfach (z. B. D oder FU):</strong>
          <div style="font-size: 13px; color: var(--slate-600); margin-top: 4px;">
            Möchten Sie differenzieren (z. B. in Deutsch <em>Meister</em>, im Förderkurs aber <em>Geselle</em>)? Klicken Sie einfach das Fach an und passen Sie es individuell an.
          </div>
        </div>
      </div>

      <!-- Schritt: Ranking einreichen -->
      <div class="callout callout-success" style="margin-top: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong style="font-size: 15px;">✓ Schritt zum Abschluss: „Ranking einreichen“</strong>
            <p style="margin-top: 4px; font-size: 13.5px;">
              Klicken Sie oben rechts auf den grünen Button <strong>✓ Ranking einreichen</strong>.<br>
              Der Schüler wandert vom Ordner <em>„Offen“</em> in den Ordner <em>„Bewertet“</em>. <strong>Erst ab diesem Moment zählt Ihre Stimme offiziell in der Notenkonferenz!</strong>
            </p>
          </div>
          <span style="background: #16a34a; color: white; padding: 6px 14px; border-radius: 8px; font-weight: 800; font-size: 13px;">
            ✓ Einreichen
          </span>
        </div>
      </div>
    </section>

    <!-- 4. BEWERTUNG ZURÜCKSETZEN -->
    <section id="zuruecksetzen">
      <div class="section-header">
        <div class="section-icon icon-rose">🔄</div>
        <div>
          <h2 class="section-title">2. Wie setzt man eine Bewertung zurück?</h2>
          <div class="section-subtitle">Korrekturen vornehmen: Einreichung wieder öffnen oder Kriterien leeren</div>
        </div>
      </div>

      <p>
        Haben Sie sich verklickt oder möchten eine Bewertung nachträglich anpassen? SMILE unterscheidet zwei Fälle:
      </p>

      <div class="grid-2">
        <!-- Fall 1: Einreichung zurücknehmen -->
        <div class="card" style="border-top: 4px solid #0284c7;">
          <div class="card-title">
            <span>Fall A: Einreichung zurücknehmen</span>
            <span class="badge" style="background:#e0f2fe; color:#0369a1;">Status-Reset</span>
          </div>
          <div class="card-body">
            <strong>Sie haben bereits auf „Ranking einreichen“ geklickt, wollen aber weiter bearbeiten:</strong>
            <ol style="margin-left: 18px; margin-top: 8px; font-size: 13px; line-height: 1.6;">
              <li>Wählen Sie den Schüler im Ordner <strong>„Bewertet“</strong> aus.</li>
              <li>Klicken Sie oben auf den Button <strong>↩ Einreichung zurücknehmen</strong> (neben dem grünen Häkchen).</li>
              <li>Der Schüler wechselt sofort zurück in den Ordner <strong>„Offen“</strong>.</li>
              <li>Alle Bewertungen bleiben erhalten, können aber nun wieder frei verändert und neu eingereicht werden.</li>
            </ol>
            <div style="font-size: 12px; color: #64748b; margin-top: 8px;">
              ⚠️ <em>Hinweis: Funktioniert so lange, bis die Konferenzleitung die Notenkonferenz offiziell sperrt.</em>
            </div>
          </div>
        </div>

        <!-- Fall 2: Kriterien leeren -->
        <div class="card" style="border-top: 4px solid #f59e0b;">
          <div class="card-title">
            <span>Fall B: Merkmale im Raster leeren</span>
            <span class="badge" style="background:#fef3c7; color:#b45309;">Inhalt-Reset</span>
          </div>
          <div class="card-body">
            <strong>Sie möchten den Beobachtungsbogen von Grund auf neu ausfüllen:</strong>
            <ul style="margin-left: 18px; margin-top: 8px; font-size: 13px; line-height: 1.6;">
              <li>Klicken Sie auf den Button <strong>🔄 Reset</strong> (Drehpfeil-Symbol) direkt über dem Raster.</li>
              <li>Ein Bestätigungsfenster fragt nach: <em>„Alle 18 Bewertungen leeren?“</em></li>
              <li>Nach Bestätigung werden alle Kriterien auf leer zurückgesetzt.</li>
              <li><strong>Einzelnes Merkmal abwählen:</strong> Klicken Sie einfach auf das kleine graue <strong>„×“</strong> ganz rechts in der Kriterienzeile.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- 5. RANG-BERECHNUNG AUS 18 KRITERIEN -->
    <section id="berechnung-kriterien">
      <div class="section-header">
        <div class="section-icon icon-amber">📊</div>
        <div>
          <h2 class="section-title">3. Wie berechnet sich der Rang aus den 18 Kriterien?</h2>
          <div class="section-subtitle">Mathematische Schwellenwerte für das Fach der Lehrkraft</div>
        </div>
      </div>

      <p>
        Wenn Sie den detaillierten Beobachtungsbogen ausfüllen, berechnet SMILE in Echtzeit Ihren Fach-Rangvorschlag nach folgenden offiziellen Schwellenwerten:
      </p>

      <table>
        <thead>
          <tr>
            <th>Rangvorschlag</th>
            <th>Bedingung (Positive Merkmale)</th>
            <th>Zählweise</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="badge badge-meister">🟡 Meister</span></td>
            <td><strong>14 bis 18 positive Kriterien</strong></td>
            <td>👑 Krone (`++`) und 😊 Smiley (`+`) zählen als positiv</td>
          </tr>
          <tr>
            <td><span class="badge badge-geselle">🔵 Geselle</span></td>
            <td><strong>8 bis 13 positive Kriterien</strong></td>
            <td>👑 Krone (`++`) und 😊 Smiley (`+`) zählen als positiv</td>
          </tr>
          <tr>
            <td><span class="badge badge-lehrling">🔴 Lehrling</span></td>
            <td><strong>0 bis 7 positive Kriterien</strong></td>
            <td>Neutral (`-`) und Traurig (`--`) zählen nicht positiv</td>
          </tr>
        </tbody>
      </table>

      <!-- Interaktiver Kriterien-Slider -->
      <div class="sim-box">
        <div style="font-weight: 800; font-size: 15px; color: var(--slate-900);">
          🎛️ Live-Simulator: Kriterien-Schwellenwerte ausprobieren
        </div>
        <p style="font-size: 13px; color: var(--slate-600); margin-top: 2px;">
          Verschieben Sie den Regler, um zu sehen, wie viele positive Merkmale zu welchem Rang führen:
        </p>

        <div class="sim-slider-wrap">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 6px;">
            <span>Anzahl positiver Kriterien: <strong id="sim-pos-count" style="color:#0284c7; font-size: 16px;">10</strong> / 18</span>
            <span id="sim-pos-percent" style="color:var(--slate-400);">56%</span>
          </div>
          <input type="range" min="0" max="18" value="10" class="sim-slider" id="posSlider" oninput="updateRubricSim(this.value)">
          <div class="sim-meter-bar">
            <div id="sim-meter-fill" class="sim-meter-fill" style="width: 55.5%; background-color: #0284c7;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8;">
            <span>0 (Lehrling)</span>
            <span>8 (Geselle-Schwelle)</span>
            <span>14 (Meister-Schwelle)</span>
            <span>18 (Max)</span>
          </div>
        </div>

        <div class="sim-result-card">
          <div>
            <div style="font-size: 11.5px; color: var(--slate-400); text-transform: uppercase; font-weight: 700;">Errechneter Rang für Ihr Fach:</div>
            <div id="sim-rank-label" style="font-size: 20px; font-weight: 900; color: #0284c7; margin-top: 2px;">
              🔵 Geselle
            </div>
          </div>
          <div id="sim-rank-badge">
            <span class="badge badge-geselle" style="font-size: 12px; padding: 6px 14px;">Erfüllt Regelstandard</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 6. KONFERENZ BERECHNUNG & STUNDENGEWICHTUNG -->
    <section id="berechnung-konferenz">
      <div class="section-header">
        <div class="section-icon icon-blue">⚖️</div>
        <div>
          <h2 class="section-title">4. Wie wird der Konferenz-Vorschlag berechnet?</h2>
          <div class="section-subtitle">Stundengewichtung nach WebUntis, Team-Teaching &amp; Rote Karten</div>
        </div>
      </div>

      <p>
        In der Notenkonferenz stimmen nicht Personen mit „1 Stimme pro Kopf“ ab. Das SMILE-System verwendet einen <strong>vollständig transparenten Stundengewichtungs-Algorithmus</strong>:
      </p>

      <div class="grid-3" style="text-align: center;">
        <div class="card">
          <div style="font-size: 22px; font-weight: 900; color: #d97706;">4h / Woche</div>
          <div style="font-size: 12px; color: var(--slate-600);">z. B. Deutsch / Mathematik</div>
          <div style="font-weight: 800; font-size: 13px; color: var(--slate-900); margin-top: 4px;">Gewicht: 4</div>
        </div>
        <div class="card">
          <div style="font-size: 22px; font-weight: 900; color: #0284c7;">2h / Woche</div>
          <div style="font-size: 12px; color: var(--slate-600);">z. B. Biologie / Geschichte</div>
          <div style="font-weight: 800; font-size: 13px; color: var(--slate-900); margin-top: 4px;">Gewicht: 2</div>
        </div>
        <div class="card">
          <div style="font-size: 22px; font-weight: 900; color: #16a34a;">1h / Woche</div>
          <div style="font-size: 12px; color: var(--slate-600);">z. B. Förderunterricht</div>
          <div style="font-weight: 800; font-size: 13px; color: var(--slate-900); margin-top: 4px;">Gewicht: 1</div>
        </div>
      </div>

      <!-- Team Teaching Regel -->
      <h3 style="font-size: 16px; font-weight: 800; margin: 20px 0 8px 0; color: var(--slate-900);">
        👥 Die institutionelle Team-Teaching-Regel (D, E, M)
      </h3>
      <p style="font-size: 13.5px;">
        In den Hauptfächern unterrichten zwei Kolleg*innen im Team. SMILE garantiert, dass das Hauptfach immer sein volles institutionelles Gewicht in der Konferenz behält:
      </p>

      <table>
        <thead>
          <tr>
            <th>Fall</th>
            <th>Lehrkraft 1 (z. B. 4h)</th>
            <th>Lehrkraft 2 (z. B. 3h)</th>
            <th>Gesamtgewicht für das Hauptfach</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Beide geben ab</strong></td>
            <td>4 Stunden</td>
            <td>3 Stunden</td>
            <td><strong>7 Stunden</strong> fließen in die Abstimmung ein</td>
          </tr>
          <tr>
            <td><strong>Nur 1 Lehrkraft gibt ab</strong> (z.B. Kollege krank)</td>
            <td>Stunden werden <strong>verdoppelt: 8h</strong></td>
            <td>— (nicht abgegeben)</td>
            <td><strong>8 Stunden</strong> (Fach verliert kein Stimmgewicht!)</td>
          </tr>
        </tbody>
      </table>

      <!-- Rote Karte Abzug -->
      <div class="callout callout-danger" style="margin-top: 20px;">
        <strong style="font-size: 14.5px;">🚨 Automatische Rote-Karten-Abwertung (Disziplinarmalus)</strong>
        <p style="margin-top: 4px; font-size: 13px;">
          Liegt für eine Schülerin/einen Schüler eine aktive <strong>Rote Verhaltenskarte</strong> vor, wird der berechnete Konferenz-Rang <strong>automatisch um 1 Stufe abgewertet</strong> (z. B. von <em>Meister</em> auf <em>Geselle</em>, oder von <em>Geselle</em> auf <em>Lehrling</em>).
          Im Konferenzprotokoll wird dies transparent als <code>(Rangabzug Karte)</code> deklariert.
        </p>
      </div>
    </section>

    <!-- 7. INTERAKTIVER LIVE-SIMULATOR FÜR DIE KONFERENZ -->
    <section id="simulator">
      <div class="section-header">
        <div class="section-icon icon-emerald">🧮</div>
        <div>
          <h2 class="section-title">5. Live Konferenz-Rechner</h2>
          <div class="section-subtitle">Verändern Sie Stimmen und Stunden, um das Endergebnis live zu berechnen</div>
        </div>
      </div>

      <p>
        Probieren Sie verschiedene Noten-Kombinationen aus und sehen Sie sofort, welcher Rang-Vorschlag für die Notenkonferenz entsteht:
      </p>

      <div class="sim-box" style="background: white;">
        <table class="conf-table">
          <thead>
            <tr>
              <th>Fach</th>
              <th>Wochenstunden</th>
              <th>Votum der Lehrkraft</th>
              <th>Effektives Gewicht</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Deutsch (Team 1)</strong></td>
              <td>4h</td>
              <td>
                <select id="vote-d1" onchange="recalcConference()">
                  <option value="Meister" selected>🟡 Meister</option>
                  <option value="Geselle">🔵 Geselle</option>
                  <option value="Lehrling">🔴 Lehrling</option>
                </select>
              </td>
              <td id="weight-d1">4h</td>
            </tr>
            <tr>
              <td><strong>Deutsch (Team 2)</strong></td>
              <td>3h</td>
              <td>
                <select id="vote-d2" onchange="recalcConference()">
                  <option value="Meister">🟡 Meister</option>
                  <option value="Geselle" selected>🔵 Geselle</option>
                  <option value="Lehrling">🔴 Lehrling</option>
                </select>
              </td>
              <td id="weight-d2">3h</td>
            </tr>
            <tr>
              <td><strong>Mathematik (nur 1 Abgabe)</strong></td>
              <td>4h <span style="font-size:10px; color:#d97706; font-weight:700;">(x2 Solo)</span></td>
              <td>
                <select id="vote-m" onchange="recalcConference()">
                  <option value="Meister">🟡 Meister</option>
                  <option value="Geselle" selected>🔵 Geselle</option>
                  <option value="Lehrling">🔴 Lehrling</option>
                </select>
              </td>
              <td id="weight-m">8h</td>
            </tr>
            <tr>
              <td><strong>Biologie</strong></td>
              <td>2h</td>
              <td>
                <select id="vote-bio" onchange="recalcConference()">
                  <option value="Meister" selected>🟡 Meister</option>
                  <option value="Geselle">🔵 Geselle</option>
                  <option value="Lehrling">🔴 Lehrling</option>
                </select>
              </td>
              <td id="weight-bio">2h</td>
            </tr>
            <tr>
              <td><strong>Geschichte</strong></td>
              <td>2h</td>
              <td>
                <select id="vote-gs" onchange="recalcConference()">
                  <option value="Meister">🟡 Meister</option>
                  <option value="Geselle">🔵 Geselle</option>
                  <option value="Lehrling" selected>🔴 Lehrling</option>
                </select>
              </td>
              <td id="weight-gs">2h</td>
            </tr>
          </tbody>
        </table>

        <!-- Checkbox Rote Karte -->
        <div style="margin: 16px 0; display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="conf-red-card" style="width:18px; height:18px; cursor:pointer;" onchange="recalcConference()">
          <label for="conf-red-card" style="font-weight:700; font-size:13.5px; color:#9f1239; cursor:pointer;">
            🚨 Aktive Rote Verhaltenskarte vorhanden (-1 Rang Abzug)
          </label>
        </div>

        <!-- Auswertung Card -->
        <div style="background: var(--slate-900); color: white; border-radius: 12px; padding: 20px; margin-top: 16px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; font-weight: 700;">
            Akkumulierte Stundentöpfe (Gesamt: <span id="conf-total-hours">19</span> Stunden):
          </div>

          <div style="display: flex; gap: 20px; margin: 12px 0; font-size: 14px; font-weight: 700;">
            <div style="color: #fde68a;">Meister: <span id="conf-h-meister">6</span>h (<span id="conf-p-meister">32%</span>)</div>
            <div style="color: #bae6fd;">Geselle: <span id="conf-h-geselle">11</span>h (<span id="conf-p-geselle">58%</span>)</div>
            <div style="color: #fecdd3;">Lehrling: <span id="conf-h-lehrling">2</span>h (<span id="conf-p-lehrling">10%</span>)</div>
          </div>

          <div style="border-top: 1px solid #334155; padding-top: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 12px; color: #94a3b8;">System-Rangvorschlag für die Konferenz:</div>
              <div id="conf-final-rank" style="font-size: 22px; font-weight: 900; color: #38bdf8; margin-top: 2px;">
                GESELLE (58% Mehrheit)
              </div>
            </div>
            <div id="conf-card-badge" style="display:none; background:#e11d48; color:white; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:800;">
              -1 RANG DURCH ROTE KARTE
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 8. FAQ -->
    <section id="faq">
      <div class="section-header">
        <div class="section-icon icon-purple">💡</div>
        <div>
          <h2 class="section-title">Häufig gestellte Fragen (FAQ)</h2>
          <div class="section-subtitle">Wissenswertes für den Konferenz- und Bewertungsablauf</div>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:14px;">
        <div class="card">
          <strong style="color:var(--slate-900);">Was passiert, wenn ich vor der Konferenz vergesse, auf „Ranking einreichen“ zu klicken?</strong>
          <div style="font-size:13px; color:var(--slate-600); margin-top:4px;">
            Ihre Bewertungen sind zwar dank Auto-Save in Ihrem Entwurf gespeichert, fließen jedoch <strong>noch nicht</strong> in die Konferenz-Akkumulation ein! Erst der Klick auf <em>„✓ Ranking einreichen“</em> aktiviert Ihre Stimme für die Notenkonferenz.
          </div>
        </div>

        <div class="card">
          <strong style="color:var(--slate-900);">Kann die Notenkonferenz den Stunden-Vorschlag überstimmen?</strong>
          <div style="font-size:13px; color:var(--slate-600); margin-top:4px;">
            <strong>Ja.</strong> Der Stunden-Vorschlag ist eine fundierte, datenbasierte Entscheidungshilfe. Die Schulleitung und Klassenführung kann bei triftigen pädagogischen Gründen einen abweichenden Beschluss fassen und die Begründung im Konferenzprotokoll hinterlegen.
          </div>
        </div>

        <div class="card">
          <strong style="color:var(--slate-900);">Was geschieht bei einem exakten Gleichstand der Stunden (z. B. 8h Meister vs. 8h Geselle)?</strong>
          <div style="font-size:13px; color:var(--slate-600); margin-top:4px;">
            Das System meldet transparent <code>Keine Mehrheit</code>. Es wird kein willkürlicher Vorschlag gewürfelt – die Konferenz entscheidet die Einstufung in der Sitzung gemeinsam.
          </div>
        </div>
      </div>
    </section>

  </main>
</div>

<!-- ==================== JAVASCRIPT ==================== -->
<script>
  // Dynamic Demo Interactions
  function demoClick(type, val, ev) {
    const explainer = document.getElementById('demo-explainer');
    const headerTitle = document.getElementById('demo-pupil-header');
    const headerMode = document.getElementById('demo-mode-header');
    const reopenBtn = document.getElementById('demo-reopen-btn');
    const submitBtn = document.getElementById('demo-submit-btn');

    if (type === 'class') {
      document.querySelectorAll('.mock-class-btn').forEach(b => b.classList.remove('active'));
      if (ev && ev.target) ev.target.classList.add('active');
      explainer.innerHTML = `📍 <strong>Klasse ${val} ausgewählt:</strong> SMILE lädt sofort die Schülerliste und Ihre Fächer für diese Klasse. Ihre Auswahl wird im Profil automatisch gemerkt.`;
    } 
    else if (type === 'subject') {
      document.querySelectorAll('.mock-sub-pill').forEach(b => b.classList.remove('active'));
      if (ev && ev.target) ev.target.classList.add('active');
      if (val === 'ALL') {
        headerMode.innerText = 'Gesamtbewertung (D + FU)';
        explainer.innerHTML = `🌟 <strong>Modus Gesamt (alle Fächer):</strong> Jeder Klick auf Lehrling/Geselle/Meister bewertet <strong>Deutsch und Förderunterricht gleichzeitig</strong>! Perfekt für einheitliche Leistungen.`;
      } else if (val === 'D') {
        headerMode.innerText = 'Einzelfach Deutsch (4h)';
        explainer.innerHTML = `🎯 <strong>Einzelfach Deutsch aktiv:</strong> Bewertungen betreffen jetzt nur das Fach Deutsch (Gewicht 4h). Förderunterricht bleibt unberührt.`;
      } else {
        headerMode.innerText = 'Einzelfach Förderunterricht (1h)';
        explainer.innerHTML = `🎯 <strong>Einzelfach Förderunterricht aktiv:</strong> Bewertungen betreffen nur den Förderunterricht (Gewicht 1h).`;
      }
    }
    else if (type === 'tab') {
      document.querySelectorAll('.mock-pupil-tab').forEach(b => b.classList.remove('active'));
      if (ev && ev.target) ev.target.classList.add('active');
      if (val === 'bewertet') {
        reopenBtn.style.display = 'inline-flex';
        submitBtn.style.opacity = '0.5';
        explainer.innerHTML = `📁 <strong>Ordner „Bewertet“:</strong> Hier liegen alle Schüler*innen, deren Ranking Sie bereits eingereicht haben. Mit dem Button <em>„↩ Einreichung zurücknehmen“</em> können Sie sie jederzeit wieder zur Bearbeitung öffnen!`;
      } else {
        reopenBtn.style.display = 'none';
        submitBtn.style.opacity = '1';
        explainer.innerHTML = `📁 <strong>Ordner „Offen“:</strong> Diese Schüler*innen müssen noch bewertet und mit <em>„✓ Ranking einreichen“</em> abgeschlossen werden.`;
      }
    }
    else if (type === 'pupil') {
      document.querySelectorAll('.mock-pupil-item').forEach(b => b.classList.remove('active'));
      if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
      headerTitle.innerText = `${val} Muster (2B)`;
      explainer.innerHTML = `👤 <strong>Schüler ${val} ausgewählt:</strong> Die Bewertungsmaske rechts schaltet sofort um. Alle Kriterien und der aktuelle Rang werden in Echtzeit geladen.`;
    }
    else if (type === 'rate') {
      explainer.innerHTML = `⚡ <strong>Schnellbewertung: ${val} angeklickt!</strong><br>Das System hat den Status <em>${val}</em> gesetzt und passend viele Kriterien im Beobachtungsbogen ausgefüllt. <strong>Auto-Save:</strong> Sofort im Server gespeichert!`;
    }
    else if (type === 'action') {
      if (val === 'submit') {
        explainer.innerHTML = `✅ <strong>Ranking eingereicht!</strong> Der Schüler wechselt in den Ordner <em>„Bewertet“</em>. Ihre Stimme ist nun offiziell registriert und zählt im Konferenztopf!`;
      } else if (val === 'reopen') {
        explainer.innerHTML = `↩ <strong>Einreichung zurückgenommen!</strong> Der Schüler wechselt zurück nach <em>„Offen“</em>. Sie können die Bewertung nun wieder verändern oder ergänzen.`;
      } else if (val === 'reset') {
        explainer.innerHTML = `🔄 <strong>Reset angeklickt:</strong> Öffnet den Sicherheitsdialog <em>„Alle 18 Bewertungen leeren?“</em>. Nach Bestätigung werden alle Merkmale auf neutral/leer zurückgesetzt.`;
      } else if (val === 'raster') {
        explainer.innerHTML = `📋 <strong>Beobachtungsbogen geöffnet:</strong> Jetzt sehen Sie alle 18 Kriterien mit den Stufen 👑 Krone, 😊 Smiley, 😐 Neutral und 😢 Traurig zur Feinjustierung!`;
      }
    }
  }

  // Live Rubric Simulator
  function updateRubricSim(val) {
    const pos = parseInt(val, 10);
    document.getElementById('sim-pos-count').innerText = pos;
    const pct = Math.round((pos / 18) * 100);
    document.getElementById('sim-pos-percent').innerText = pct + '%';
    
    const fill = document.getElementById('sim-meter-fill');
    fill.style.width = pct + '%';

    const label = document.getElementById('sim-rank-label');
    const badgeWrap = document.getElementById('sim-rank-badge');

    if (pos >= 14) {
      fill.style.backgroundColor = '#f59e0b';
      label.innerText = '🟡 Meister';
      label.style.color = '#b45309';
      badgeWrap.innerHTML = '<span class="badge badge-meister" style="font-size:12px; padding:6px 14px;">Spitzenleistung (14 - 18)</span>';
    } else if (pos >= 8) {
      fill.style.backgroundColor = '#0284c7';
      label.innerText = '🔵 Geselle';
      label.style.color = '#0284c7';
      badgeWrap.innerHTML = '<span class="badge badge-geselle" style="font-size:12px; padding:6px 14px;">Regelstandard (8 - 13)</span>';
    } else {
      fill.style.backgroundColor = '#f43f5e';
      label.innerText = '🔴 Lehrling';
      label.style.color = '#be123c';
      badgeWrap.innerHTML = '<span class="badge badge-lehrling" style="font-size:12px; padding:6px 14px;">Unterstützung nötig (0 - 7)</span>';
    }
  }

  // Live Conference Calculator
  function recalcConference() {
    const vD1 = document.getElementById('vote-d1').value;
    const vD2 = document.getElementById('vote-d2').value;
    const vM = document.getElementById('vote-m').value;
    const vBio = document.getElementById('vote-bio').value;
    const vGs = document.getElementById('vote-gs').value;
    const hasRedCard = document.getElementById('conf-red-card').checked;

    let hLehrling = 0;
    let hGeselle = 0;
    let hMeister = 0;

    function addVote(rank, hours) {
      if (rank === 'Meister') hMeister += hours;
      else if (rank === 'Geselle') hGeselle += hours;
      else if (rank === 'Lehrling') hLehrling += hours;
    }

    addVote(vD1, 4);
    addVote(vD2, 3);
    addVote(vM, 8); // solo double
    addVote(vBio, 2);
    addVote(vGs, 2);

    const total = hMeister + hGeselle + hLehrling;
    document.getElementById('conf-total-hours').innerText = total;

    document.getElementById('conf-h-meister').innerText = hMeister;
    document.getElementById('conf-h-geselle').innerText = hGeselle;
    document.getElementById('conf-h-lehrling').innerText = hLehrling;

    document.getElementById('conf-p-meister').innerText = Math.round((hMeister / total) * 100) + '%';
    document.getElementById('conf-p-geselle').innerText = Math.round((hGeselle / total) * 100) + '%';
    document.getElementById('conf-p-lehrling').innerText = Math.round((hLehrling / total) * 100) + '%';

    let winner = null;
    let winnerPct = 0;
    if (hMeister > hGeselle && hMeister > hLehrling) {
      winner = 'Meister';
      winnerPct = Math.round((hMeister / total) * 100);
    } else if (hGeselle > hMeister && hGeselle > hLehrling) {
      winner = 'Geselle';
      winnerPct = Math.round((hGeselle / total) * 100);
    } else if (hLehrling > hMeister && hLehrling > hGeselle) {
      winner = 'Lehrling';
      winnerPct = Math.round((hLehrling / total) * 100);
    }

    const finalRankEl = document.getElementById('conf-final-rank');
    const badgeCard = document.getElementById('conf-card-badge');

    if (!winner) {
      finalRankEl.innerText = 'KEINE MEHRHEIT (Gleichstand)';
      finalRankEl.style.color = '#cbd5e1';
      badgeCard.style.display = 'none';
      return;
    }

    let finalRank = winner;
    if (hasRedCard) {
      badgeCard.style.display = 'inline-block';
      if (winner === 'Meister') finalRank = 'Geselle';
      else if (winner === 'Geselle') finalRank = 'Lehrling';
      else if (winner === 'Lehrling') finalRank = 'Lehrling';
      finalRankEl.innerText = finalRank.toUpperCase() + ' (' + winnerPct + '% Mehrheit - nach Abzug)';
    } else {
      badgeCard.style.display = 'none';
      finalRankEl.innerText = finalRank.toUpperCase() + ' (' + winnerPct + '% Mehrheit)';
    }

    if (finalRank === 'Meister') finalRankEl.style.color = '#fde68a';
    else if (finalRank === 'Geselle') finalRankEl.style.color = '#38bdf8';
    else finalRankEl.style.color = '#fecdd3';
  }

  function openLightbox(img) {
    window.open(img.src, '_blank');
  }

  // Active navigation highlight on scroll
  window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');
    let current = '';

    sections.forEach(section => {
      const sectionTop = section.offsetTop - 100;
      if (pageYOffset >= sectionTop) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === '#' + current) {
        link.classList.add('active');
      }
    });
  });
</script>

</body>
</html>
"""

    # Inject images safely
    html = html.replace('[[IMG_OVERVIEW]]', img_overview)
    html = html.replace('[[IMG_NAV]]', img_nav)
    html = html.replace('[[IMG_SCHUELER]]', img_schueler)
    html = html.replace('[[IMG_QUICK]]', img_quick)
    html = html.replace('[[IMG_RASTER]]', img_raster)
    html = html.replace('[[IMG_MULTI]]', img_multi)

    out_file = os.path.abspath('docs/SMILE_Erklaerung_Bewertung.html')
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write(html)
    print("Successfully built guide at:", out_file)
    print("File size:", len(html), "bytes")

if __name__ == '__main__':
    build_guide()
