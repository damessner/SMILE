import os
import sys
import base64
import json
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from ssh_utils import create_ssh_client

def get_real_token(username='ofj'):
    host = os.environ.get('PROXMOX_HOST', '172.16.1.54')
    user = os.environ.get('PROXMOX_USER', 'root')
    password = os.environ.get('PROXMOX_PASSWORD')
    ssh = create_ssh_client()
    key_file = os.path.expanduser('~/.ssh/id_ed25519')
    if password:
        ssh.connect(host, username=user, password=password, timeout=10)
    elif os.path.exists(key_file):
        ssh.connect(host, username=user, key_filename=key_file, timeout=10)
    else:
        raise ValueError("PROXMOX_PASSWORD or SSH key ~/.ssh/id_ed25519 must be present")
    
    script = f"""set -e
export DATABASE_URL=$(grep -E "^DATABASE_URL=" /opt/smile/.env | cut -d= -f2- | tr -d '"' | tr -d '\\r')
export JWT_SECRET=$(grep -E "^JWT_SECRET=" /opt/smile/.env | cut -d= -f2- | tr -d '"' | tr -d '\\r')

python3 -c "
import psycopg2, os, json, hmac, hashlib, base64

def b64url(b):
    return base64.urlsafe_b64encode(b).decode('utf-8').rstrip('=')

conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute('SELECT id, username, role, teacher_id, session_version FROM users WHERE username = %s', ('{username}',))
row = cur.fetchone()
if not row:
    print('NO_USER')
    exit(1)
uid, uname, role, tid, sversion = row
cur.execute('UPDATE users SET must_change_password = false WHERE id = %s', (uid,))
conn.commit()

header = b64url(json.dumps({{'alg': 'HS256', 'typ': 'JWT'}}).encode('utf-8'))
payload = b64url(json.dumps({{
    'id': str(uid),
    'username': uname,
    'role': role,
    'teacherId': tid,
    'sessionVersion': sversion,
    'mustChangePassword': False
}}).encode('utf-8'))

sig = b64url(hmac.new(os.environ['JWT_SECRET'].encode('utf-8'), f'{{header}}.{{payload}}'.encode('utf-8'), hashlib.sha256).digest())
print(f'{{header}}.{{payload}}.{{sig}}')
"
"""
    b64 = base64.b64encode(script.encode('utf-8')).decode('ascii')
    cmd = f'pct exec 115 -- bash -c "echo {b64} | base64 -d | bash"'
    stdin, stdout, stderr = ssh.exec_command(cmd)
    token = stdout.read().decode('utf-8').strip()
    ssh.close()
    return token

def capture_screenshots():
    token = get_real_token('ofj')
    img_dir = os.path.abspath('docs/screenshots')
    os.makedirs(img_dir, exist_ok=True)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1480, 'height': 920})
        context.add_cookies([{
            'name': 'smile_session',
            'value': token,
            'domain': '172.16.1.11',
            'path': '/',
            'httpOnly': True,
            'sameSite': 'Strict'
        }])
        page = context.new_page()
        page.add_init_script("""
            localStorage.setItem('smile_tour_seen_ofj', 'true');
            localStorage.setItem('smile-theme', 'dark');
        """)
        
        page.goto('http://172.16.1.11:3000', wait_until='networkidle')
        page.wait_for_timeout(2000)
        
        # 1. Full interface overview (Full page, uncropped with generous margins)
        page.screenshot(path=os.path.join(img_dir, '1_overview.png'))
        page.screenshot(path=os.path.join(img_dir, '1_bewertung_overview.png'))
        print("Captured 1_overview.png & 1_bewertung_overview.png")
        
        # 2. Klassen Navigation (With generous context: Top header + Class Bar + Top of pupil view)
        page.screenshot(
            path=os.path.join(img_dir, '2_klassen_nav.png'),
            clip={'x': 0, 'y': 0, 'width': 1480, 'height': 320}
        )
        page.screenshot(
            path=os.path.join(img_dir, '2_klassen_navigation.png'),
            clip={'x': 0, 'y': 0, 'width': 1480, 'height': 320}
        )
        print("Captured 2_klassen_nav.png & 2_klassen_navigation.png")
        
        # 3. Schülerliste (Left column in full height with class navigation and right column context)
        page.screenshot(
            path=os.path.join(img_dir, '3_schuelerliste.png'),
            clip={'x': 0, 'y': 60, 'width': 780, 'height': 820}
        )
        print("Captured 3_schuelerliste.png")
        
        # 4. Quick Rating & Pupil Header (Entire right observation panel in context)
        page.screenshot(
            path=os.path.join(img_dir, '4_quick_rating.png'),
            clip={'x': 340, 'y': 70, 'width': 1130, 'height': 560}
        )
        page.screenshot(
            path=os.path.join(img_dir, '3_quick_rating.png'),
            clip={'x': 340, 'y': 70, 'width': 1130, 'height': 560}
        )
        print("Captured 4_quick_rating.png")
        
        # 5. Open Beobachtungsbogen accordion and capture criteria with full breathing room
        chevron = page.locator('button:has-text("Beobachtungsbogen")').first
        if chevron.is_visible():
            chevron.click()
            page.wait_for_timeout(1000)
        
        # Full page with open accordion
        page.screenshot(path=os.path.join(img_dir, '4_beobachtungsbogen_open.png'))
        print("Captured 4_beobachtungsbogen_open.png")
        
        # Detailed raster with header and ample space around
        page.screenshot(
            path=os.path.join(img_dir, '5_kriterien_raster.png'),
            clip={'x': 340, 'y': 150, 'width': 1130, 'height': 750}
        )
        print("Captured 5_kriterien_raster.png")
        
        # 6. Switch to class 2B (which has multiple subjects: D, BFUR, BFUD, BUB)
        btn_2b = page.locator('button:has-text("2B")').first
        if btn_2b.is_visible():
            btn_2b.click()
            page.wait_for_timeout(2000)
            page.screenshot(
                path=os.path.join(img_dir, '6_multi_subject_2b.png'),
                clip={'x': 0, 'y': 0, 'width': 1480, 'height': 520}
            )
            print("Captured 6_multi_subject_2b.png")

        browser.close()

if __name__ == '__main__':
    capture_screenshots()
