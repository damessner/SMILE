#!/usr/bin/env python3
"""
generate_export_reports.py — Generates print-ready HTML (1 page per class) and Markdown summaries.

Usage:
    python3 scripts/generate_export_reports.py --html /path/to/report.html --md /path/to/report.md
"""
import os
import sys
import argparse
import datetime
import html
import psycopg2
from collections import defaultdict

def get_db_uri():
    db_uri = os.environ.get("DATABASE_URL")
    if db_uri and db_uri.strip():
        return db_uri.strip()

    if os.path.exists("/opt/smile/.env"):
        with open("/opt/smile/.env", "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("DATABASE_URL="):
                    val = line.strip().split("=", 1)[1].strip('"').strip("'")
                    if val:
                        return val

    for env_path in ["/etc/smile/backup.env", "scripts/backup.env"]:
        if os.path.exists(env_path):
            vals = {}
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split("=", 1)
                    if len(parts) == 2:
                        vals[parts[0].strip()] = parts[1].strip('"').strip("'")
            if "DB_NAME" in vals:
                user = vals.get('DB_USER', 'smile_backup')
                pwd = vals.get('DB_PASSWORD', os.environ.get('PGPASSWORD', ''))
                auth = f"{user}:{pwd}" if pwd else user
                host = vals.get('DB_HOST', '127.0.0.1')
                port = vals.get('DB_PORT', '5432')
                return f"postgresql://{auth}@{host}:{port}/{vals['DB_NAME']}"

    sys.stderr.write("ERROR: No database connection configured (DATABASE_URL or backup.env missing).\n")
    sys.exit(1)

# Invariant: Canonical rating tokens from rubric configuration
POSITIVE_RATINGS = frozenset({'crown', 'smile', '++', '+'})

def is_positive_rating(r):
    return str(r).strip() in POSITIVE_RATINGS

def escape_md(val):
    if not val:
        return "–"
    clean = str(val).replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    clean = clean.replace("|", r"\|").strip()
    return clean if clean else "–"

def fetch_school_data(conn):
    cur = conn.cursor()

    # 1. Rubric criteria count (Invariant 5: 18-item rubric boundary)
    rubric_total = 18
    try:
        cur.execute("""
            SELECT COUNT(*)
            FROM rubric_criteria rc
            JOIN assessment_rubrics ar ON ar.id = rc.rubric_id
            WHERE ar.is_active = TRUE;
        """)
        row = cur.fetchone()
        if row and row[0] > 0:
            rubric_total = row[0]
    except Exception:
        conn.rollback()
        cur = conn.cursor()
        rubric_total = 18

    # 2. Classes
    cur.execute("""
        SELECT id, name, grade, COALESCE(head_teacher_1, ''), COALESCE(head_teacher_2, '')
        FROM school_classes
        ORDER BY name ASC;
    """)
    classes = cur.fetchall()

    # 3. Pupils with cards and timeouts
    cur.execute("""
        SELECT p.id, p.class_id, p.full_name,
               COALESCE((SELECT fr.rank FROM final_ranks fr WHERE fr.pupil_id = p.id ORDER BY fr.confirmed_at DESC NULLS LAST LIMIT 1), NULL) as confirmed_rank,
               COUNT(DISTINCT CASE WHEN bc.card_type = 'green' AND bc.revoked_at IS NULL THEN bc.id END) as green_cnt,
               COUNT(DISTINCT CASE WHEN bc.card_type = 'yellow' AND bc.revoked_at IS NULL THEN bc.id END) as yellow_cnt,
               COUNT(DISTINCT CASE WHEN bc.card_type = 'red' AND bc.revoked_at IS NULL THEN bc.id END) as red_cnt,
               COUNT(DISTINCT ti.id) as timeout_cnt
        FROM pupils p
        LEFT JOIN behavior_cards bc ON bc.pupil_id = p.id
        LEFT JOIN timeout_incidents ti ON ti.pupil_id = p.id
        WHERE p.is_archived = FALSE
        GROUP BY p.id, p.class_id, p.full_name
        ORDER BY p.full_name ASC;
    """)
    pupils = cur.fetchall()

    # 4. Evaluations and items
    cur.execute("""
        SELECT e.pupil_id, UPPER(TRIM(e.subject_code)), e.proposed_status, COALESCE(e.comment, ''),
               ei.item_key, ei.rating
        FROM evaluations e
        LEFT JOIN evaluation_items ei ON ei.evaluation_id = e.id
        ORDER BY e.pupil_id, e.subject_code;
    """)
    eval_rows = cur.fetchall()

    pupil_evals = defaultdict(lambda: defaultdict(lambda: {"proposed": None, "comment": "", "pos": 0, "rated": 0}))
    for pid, sub, prop, comment, item_key, rating in eval_rows:
        entry = pupil_evals[pid][sub]
        if prop:
            entry["proposed"] = prop
        if comment:
            entry["comment"] = comment
        if rating:
            entry["rated"] += 1
            if is_positive_rating(rating):
                entry["pos"] += 1

    cur.close()
    return classes, pupils, pupil_evals, rubric_total

def generate_markdown(classes, pupils, pupil_evals, rubric_total, timestamp_str):
    lines = []
    lines.append(f"# SMILE Konferenz-Gesamtübersicht")
    lines.append(f"**Mittelschule Telfs Weissenbach** · Stand: {timestamp_str}\n")

    pupils_by_class = defaultdict(list)
    for p in pupils:
        pupils_by_class[p[1]].append(p)

    for c in classes:
        cid, cname, cgrade, ht1, ht2 = c
        cpupils = pupils_by_class.get(cid, [])
        kv_str = ", ".join(filter(bool, [ht1, ht2])) or "k.A."

        lines.append(f"## Klasse {cname} (Klassenvorstand: {kv_str})")
        lines.append(f"Anzahl Schüler/innen: {len(cpupils)}\n")
        lines.append("| Nr. | Name | Status / Rang | Fächer (Punkte / 18) | Verhalten (🟢/🟡/🔴) | Anmerkung |")
        lines.append("|---|---|---|---|---|---|")

        for idx, p in enumerate(cpupils, 1):
            pid, _, pname, confirmed_rank, green, yellow, red, timeouts = p
            pevals = pupil_evals.get(pid, {})

            # Rank display
            if confirmed_rank:
                rank_str = f"**{confirmed_rank}** (bestätigt)"
            else:
                props = [v["proposed"] for v in pevals.values() if v.get("proposed")]
                if props:
                    rank_str = f"{', '.join(set(props))} (Vorschlag)"
                else:
                    rank_str = "offen"

            sub_strs = []
            comments = []
            for sub, ev in sorted(pevals.items()):
                if ev["rated"] > 0:
                    sub_strs.append(f"{sub}: {ev['pos']}/{rubric_total}")
                if ev["comment"]:
                    comments.append(f"{sub}: {ev['comment']}")

            sub_display = ", ".join(sub_strs) if sub_strs else "–"
            cards_display = f"🟢{green} 🟡{yellow} 🔴{red}" + (f" ⏱️{timeouts}" if timeouts > 0 else "")
            comment_display = "; ".join(comments) if comments else "–"

            lines.append(
                f"| {idx} | {escape_md(pname)} | {escape_md(rank_str)} | "
                f"{escape_md(sub_display)} | {escape_md(cards_display)} | {escape_md(comment_display)} |"
            )

        lines.append("\n---\n")

    return "\n".join(lines)

def generate_html(classes, pupils, pupil_evals, rubric_total, timestamp_str):
    pupils_by_class = defaultdict(list)
    for p in pupils:
        pupils_by_class[p[1]].append(p)

    html_parts = []
    html_parts.append(f"""<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>SMILE Konferenz-Druckbericht — {timestamp_str}</title>
  <style>
    @page {{
      size: A4 portrait;
      margin: 12mm 10mm 12mm 10mm;
    }}
    * {{
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 8.5pt;
      line-height: 1.25;
      color: #0f172a;
      margin: 0;
      padding: 0;
      background: #fff;
    }}
    .sheet {{
      page-break-after: always;
      break-after: page;
      width: 100%;
      height: 100%;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
    }}
    .sheet:last-child {{
      page-break-after: auto;
      break-after: auto;
    }}
    @media screen {{
      body {{
        background: #f1f5f9;
        padding: 20px;
      }}
      .sheet {{
        background: #fff;
        max-width: 210mm;
        min-height: 297mm;
        margin: 0 auto 30px auto;
        padding: 15mm;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        border-radius: 4px;
      }}
      .screen-bar {{
        max-width: 210mm;
        margin: 0 auto 20px auto;
        background: #0f172a;
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }}
      .print-btn {{
        background: #059669;
        color: white;
        border: none;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: bold;
        border-radius: 6px;
        cursor: pointer;
      }}
    }}
    .header {{
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }}
    .header h1 {{
      font-size: 15pt;
      margin: 0 0 2px 0;
      font-weight: 800;
      letter-spacing: -0.5px;
    }}
    .header .subtitle {{
      font-size: 8.5pt;
      color: #475569;
    }}
    .header .meta {{
      text-align: right;
      font-size: 8pt;
      color: #334155;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }}
    th, td {{
      border: 1px solid #cbd5e1;
      padding: 4px 6px;
      vertical-align: middle;
      font-size: 8pt;
    }}
    th {{
      background-color: #f1f5f9;
      font-weight: bold;
      color: #1e293b;
      text-align: left;
    }}
    tr:nth-child(even) td {{
      background-color: #f8fafc;
    }}
    .col-idx {{ width: 22px; text-align: center; color: #64748b; font-size: 7.5pt; }}
    .col-name {{ width: 140px; font-weight: bold; font-size: 8.5pt; }}
    .col-status {{ width: 85px; text-align: center; }}
    .col-subs {{ width: 130px; font-size: 7.5pt; }}
    .col-cards {{ width: 95px; text-align: center; font-size: 7.5pt; white-space: nowrap; }}
    .col-notes {{ font-size: 7.5pt; color: #334155; }}
    .badge {{
      display: inline-block;
      padding: 1.5px 6px;
      border-radius: 3px;
      font-weight: bold;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }}
    .badge-meister {{ background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }}
    .badge-geselle {{ background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }}
    .badge-lehrling {{ background: #ffe4e6; color: #be123c; border: 1px solid #fecdd3; }}
    .badge-offen {{ background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }}
    .footer {{
      margin-top: auto;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      display: flex;
      justify-content: space-between;
      font-size: 7pt;
      color: #64748b;
    }}
    .legend {{
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 7pt;
      color: #475569;
    }}
    .legend span {{ display: inline-flex; align-items: center; gap: 4px; }}
  </style>
</head>
<body>
  <div class="screen-bar">
    <div>
      <strong style="font-size: 14px;">SMILE — Konferenzdruck aller Klassen</strong>
      <div style="font-size: 11px; color: #94a3b8;">Format: 1 Seite pro Klasse (DIN A4 Portrait) · Stand: {timestamp_str}</div>
    </div>
    <button class="print-btn" onclick="window.print()">🖨️ Jetzt drucken / Als PDF speichern</button>
  </div>
""")

    for c in classes:
        cid, cname, cgrade, ht1, ht2 = c
        cpupils = pupils_by_class.get(cid, [])
        kv_str = ", ".join(filter(bool, [ht1, ht2])) or "k.A."

        # Count summary
        m_cnt = sum(1 for p in cpupils if p[3] == 'Meister')
        g_cnt = sum(1 for p in cpupils if p[3] == 'Geselle')
        l_cnt = sum(1 for p in cpupils if p[3] == 'Lehrling')
        o_cnt = len(cpupils) - (m_cnt + g_cnt + l_cnt)

        html_parts.append(f"""
  <div class="sheet">
    <div class="header">
      <div>
        <h1>Klasse {html.escape(cname)}</h1>
        <div class="subtitle">Mittelschule Telfs Weissenbach · SMILE Konferenz-Gesamtübersicht</div>
      </div>
      <div class="meta">
        <div><strong>Klassenvorstand:</strong> {html.escape(kv_str)}</div>
        <div><strong>Stand:</strong> {timestamp_str} · {len(cpupils)} Schüler/innen</div>
      </div>
    </div>

    <div class="legend">
      <span><strong>Übersicht:</strong> {len(cpupils)} Schüler/innen</span>
      <span>👑 {m_cnt} Meister</span>
      <span>🔵 {g_cnt} Geselle</span>
      <span>🔴 {l_cnt} Lehrling</span>
      <span>⚪ {o_cnt} Offen</span>
      <span style="margin-left:auto;">Punkte: Positiv / {rubric_total} Kriterien</span>
    </div>

    <table>
      <thead>
        <tr>
          <th class="col-idx">#</th>
          <th class="col-name">Schüler/in</th>
          <th class="col-status">Status / Rang</th>
          <th class="col-subs">Fächer & Punkte</th>
          <th class="col-cards">Verhalten</th>
          <th class="col-notes">Anmerkung / Begründung</th>
        </tr>
      </thead>
      <tbody>
""")

        for idx, p in enumerate(cpupils, 1):
            pid, _, pname, confirmed_rank, green, yellow, red, timeouts = p
            pevals = pupil_evals.get(pid, {})

            # Rank Badge
            if confirmed_rank == 'Meister':
                badge_html = '<span class="badge badge-meister">👑 Meister</span>'
            elif confirmed_rank == 'Geselle':
                badge_html = '<span class="badge badge-geselle">🔵 Geselle</span>'
            elif confirmed_rank == 'Lehrling':
                badge_html = '<span class="badge badge-lehrling">🔴 Lehrling</span>'
            else:
                props = [v["proposed"] for v in pevals.values() if v.get("proposed")]
                prop_str = f"({', '.join(set(props))})" if props else "offen"
                badge_html = f'<span class="badge badge-offen">{html.escape(prop_str)}</span>'

            # Subjects
            sub_spans = []
            comments = []
            for sub, ev in sorted(pevals.items()):
                if ev["rated"] > 0:
                    sub_spans.append(f"<strong>{html.escape(sub)}:</strong> {ev['pos']}/{rubric_total}")
                if ev["comment"]:
                    comments.append(f"<em>{html.escape(sub)}:</em> {html.escape(ev['comment'])}")

            subs_html = "<br>".join(sub_spans) if sub_spans else '<span style="color:#94a3b8;">keine</span>'
            comments_html = "<br>".join(comments) if comments else '<span style="color:#94a3b8;">–</span>'

            # Cards
            cards_list = []
            if green > 0:
                cards_list.append(f'<span style="color:#16a34a; font-weight:bold;">🟢 {green}</span>')
            if yellow > 0:
                cards_list.append(f'<span style="color:#ca8a04; font-weight:bold;">🟡 {yellow}</span>')
            if red > 0:
                cards_list.append(f'<span style="color:#dc2626; font-weight:bold;">🔴 {red}</span>')
            if timeouts > 0:
                cards_list.append(f'<span style="color:#9333ea; font-weight:bold;">⏱️ {timeouts}</span>')
            cards_html = " ".join(cards_list) if cards_list else '<span style="color:#94a3b8;">–</span>'

            html_parts.append(f"""
        <tr>
          <td class="col-idx">{idx}</td>
          <td class="col-name">{html.escape(pname)}</td>
          <td class="col-status">{badge_html}</td>
          <td class="col-subs">{subs_html}</td>
          <td class="col-cards">{cards_html}</td>
          <td class="col-notes">{comments_html}</td>
        </tr>""")

        html_parts.append(f"""
      </tbody>
    </table>

    <div class="footer">
      <div>SMILE Konferenzprotokoll · MS Telfs Weissenbach</div>
      <div>Klasse {html.escape(cname)} · 1 Seite pro Klasse für Konferenzunterlagen</div>
    </div>
  </div>
""")

    html_parts.append("""
</body>
</html>
""")
    return "".join(html_parts)

def main():
    parser = argparse.ArgumentParser(description="Generate conference export reports (HTML & Markdown).")
    parser.add_argument("--html", help="Output path for HTML report")
    parser.add_argument("--md", help="Output path for Markdown summary")
    args = parser.parse_args()

    if not args.html and not args.md:
        parser.print_help()
        sys.exit(1)

    db_uri = get_db_uri()
    try:
        conn = psycopg2.connect(db_uri)
        conn.set_client_encoding('UTF8')
    except Exception as e:
        sys.stderr.write(f"Database connection failed: {e}\n")
        sys.exit(1)

    classes, pupils, pupil_evals, rubric_total = fetch_school_data(conn)
    conn.close()

    now_str = datetime.datetime.now().strftime("%d.%m.%Y, %H:%M Uhr")

    if args.md:
        md_content = generate_markdown(classes, pupils, pupil_evals, rubric_total, now_str)
        os.makedirs(os.path.dirname(os.path.abspath(args.md)), exist_ok=True)
        with open(args.md, "w", encoding="utf-8") as f:
            f.write(md_content)
        print(f"Markdown report generated: {args.md}")

    if args.html:
        html_content = generate_html(classes, pupils, pupil_evals, rubric_total, now_str)
        os.makedirs(os.path.dirname(os.path.abspath(args.html)), exist_ok=True)
        with open(args.html, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"HTML report generated: {args.html}")

if __name__ == "__main__":
    main()
