#!/usr/bin/env python3
"""
export-live-excel.py — Generates a live formatted Excel workbook of SMILE database.
"""
import os
import sys
import psycopg2
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

DB_URI = os.environ.get("DATABASE_URL")
if not DB_URI and os.path.exists("/opt/smile/.env"):
    with open("/opt/smile/.env", "r") as f:
        for line in f:
            if line.strip().startswith("DATABASE_URL="):
                DB_URI = line.strip().split("=", 1)[1].strip('"').strip("'")
                break

if not DB_URI:
    DB_URI = "postgresql://smile_user:8JG1V6S28pQl6NZYqLjuHQ1d7hIeWY5h@127.0.0.1:5432/smile_db"

OUTPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "/var/backups/smile/SMILE_Aktuelle_Gesamtuebersicht.xlsx"


conn = psycopg2.connect(DB_URI)
conn.set_client_encoding('UTF8')
cur = conn.cursor()


wb = Workbook()

# Define header style
header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
sub_header_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")
sub_header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")

thin_border = Border(
    left=Side(style='thin', color='CBD5E1'),
    right=Side(style='thin', color='CBD5E1'),
    top=Side(style='thin', color='CBD5E1'),
    bottom=Side(style='thin', color='CBD5E1')
)

# -------------------------------------------------------------
# Sheet 1: Schüler & Ränge
# -------------------------------------------------------------
ws1 = wb.active
ws1.title = "Schüler & Verhaltensstatus"
ws1.views.sheetView[0].showGridLines = True

headers1 = [
    "ID", "Schüler/in", "Klasse", "Aktueller Rang", 
    "Grün (Lob)", "Gelb (Verwarnung)", "Rot (Verstoß)", "Time-Outs", 
    "Verhaltensnote (SchUG)"
]
ws1.append(headers1)

cur.execute("""
    SELECT p.id, p.full_name, sc.name as class_name,
           COALESCE(
               (SELECT fr.rank FROM final_ranks fr WHERE fr.pupil_id = p.id ORDER BY fr.confirmed_at DESC NULLS LAST LIMIT 1),
               'Geselle'
           ) as current_rank,
           COUNT(DISTINCT CASE WHEN bc.card_type = 'green' AND bc.revoked_at IS NULL THEN bc.id END) as green_cnt,
           COUNT(DISTINCT CASE WHEN bc.card_type = 'yellow' AND bc.revoked_at IS NULL THEN bc.id END) as yellow_cnt,
           COUNT(DISTINCT CASE WHEN bc.card_type = 'red' AND bc.revoked_at IS NULL THEN bc.id END) as red_cnt,
           COUNT(DISTINCT ti.id) as timeout_cnt
      FROM pupils p
      JOIN school_classes sc ON sc.id = p.class_id
      LEFT JOIN behavior_cards bc ON bc.pupil_id = p.id
      LEFT JOIN timeout_incidents ti ON ti.pupil_id = p.id
     WHERE p.is_archived = FALSE
     GROUP BY p.id, p.full_name, sc.name
     ORDER BY sc.name ASC, p.full_name ASC;
""")
rows1 = cur.fetchall()

for r in rows1:
    pid, name, cname, rank, green, yellow, red, timeouts = r
    # Compute Austrian conduct grade
    if timeouts >= 1 or red >= 1 or yellow >= 4:
        grade = "Wenig zufriedenstellend"
    elif yellow >= 2:
        grade = "Zufriedenstellend"
    elif green >= 2 and yellow == 0 and red == 0 and timeouts == 0:
        grade = "Sehr gut"
    else:
        grade = "Gut"

    ws1.append([pid, name, cname, rank, green, yellow, red, timeouts, grade])

# -------------------------------------------------------------
# Sheet 2: Dokumentierte Maßnahmen
# -------------------------------------------------------------
ws2 = wb.create_sheet(title="Maßnahmen & Interventionen")
ws2.views.sheetView[0].showGridLines = True

headers2 = ["Datum", "Schüler/in", "Klasse", "Stufe", "Maßnahme", "Status", "Lehrkraft", "Notizen"]
ws2.append(headers2)

cur.execute("""
    SELECT pba.action_date, p.full_name, sc.name, pba.stage_level, pba.stage_title,
           pba.status, COALESCE(t.short_name, 'SL'), pba.notes
      FROM pupil_behavior_actions pba
      JOIN pupils p ON p.id = pba.pupil_id
      JOIN school_classes sc ON sc.id = p.class_id
      LEFT JOIN teachers t ON t.id = pba.teacher_id
     ORDER BY pba.action_date DESC;
""")
for r in cur.fetchall():
    adate, pname, cname, slevel, stitle, status, tshort, notes = r
    date_str = adate.strftime("%d.%m.%Y %H:%M") if adate else ""
    level_str = f"+{slevel}" if slevel > 0 else str(slevel)
    ws2.append([date_str, pname, cname, level_str, stitle, status, tshort, notes or ""])

# -------------------------------------------------------------
# Sheet 3: Karten- & Time-Out Historie
# -------------------------------------------------------------
ws3 = wb.create_sheet(title="Karten & Time-Outs")
ws3.views.sheetView[0].showGridLines = True

headers3 = ["Zeitpunkt", "Typ", "Schüler/in", "Klasse", "Lehrkraft", "Begründung / Auftrag", "Status"]
ws3.append(headers3)

cur.execute("""
    SELECT bc.created_at, 
           CASE WHEN bc.card_type = 'green' THEN 'Grüne Karte'
                WHEN bc.card_type = 'yellow' THEN 'Gelbe Karte'
                ELSE 'Rote Karte' END,
           p.full_name, sc.name, COALESCE(t.short_name, 'SL'),
           bc.note,
           CASE WHEN bc.revoked_at IS NOT NULL THEN 'Zurückgezogen' ELSE 'Aktiv' END
      FROM behavior_cards bc
      JOIN pupils p ON p.id = bc.pupil_id
      JOIN school_classes sc ON sc.id = bc.class_id
      LEFT JOIN teachers t ON t.id = bc.teacher_id
     ORDER BY bc.created_at DESC;
""")
for r in cur.fetchall():
    dt, ctype, pname, cname, tshort, note, status = r
    ws3.append([dt.strftime("%d.%m.%Y %H:%M"), ctype, pname, cname, tshort, note or "", status])

cur.execute("""
    SELECT ti.sent_at, 'Time-Out (LW)', p.full_name, sc.name,
           COALESCE(t.short_name, 'SL'), ti.task_assignment,
           CASE WHEN ti.status = 'resolved' THEN 'Erledigt' ELSE 'Aktiv' END
      FROM timeout_incidents ti
      JOIN pupils p ON p.id = ti.pupil_id
      JOIN school_classes sc ON sc.id = ti.class_id
      LEFT JOIN teachers t ON t.id = ti.sent_by_teacher_id
     ORDER BY ti.sent_at DESC;
""")
for r in cur.fetchall():
    dt, ctype, pname, cname, tshort, note, status = r
    ws3.append([dt.strftime("%d.%m.%Y %H:%M"), ctype, pname, cname, tshort, note or "", status])

# Format all sheets (Header styles, column auto-widths, borders)
for ws in [ws1, ws2, ws3]:
    for col_idx, col in enumerate(ws.iter_cols(min_row=1, max_row=ws.max_row), start=1):
        max_len = 0
        for cell in col:
            cell.border = thin_border
            if cell.row == 1:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                max_len = max(max_len, len(str(cell.value or '')))
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

wb.save(OUTPUT_FILE)
print(f"Successfully generated Excel overview: {OUTPUT_FILE}")
conn.close()
