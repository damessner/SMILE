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
    if not password:
        raise ValueError("PROXMOX_PASSWORD environment variable must be set")
    ssh = create_ssh_client()
    ssh.connect(host, username=user, password=password, timeout=10)
    
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
        context = browser.new_context(viewport={'width': 1300, 'height': 850})
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
        
        # 1. Full interface overview
        page.screenshot(path=os.path.join(img_dir, '1_overview.png'))
        print("Captured 1_overview.png")
        
        # 2. Klassen Navigation (Clipped)
        page.screenshot(
            path=os.path.join(img_dir, '2_klassen_nav.png'),
            clip={'x': 10, 'y': 90, 'width': 1280, 'height': 75}
        )
        print("Captured 2_klassen_nav.png")
        
        # 3. Schülerliste (Clipped left column)
        page.screenshot(
            path=os.path.join(img_dir, '3_schuelerliste.png'),
            clip={'x': 25, 'y': 195, 'width': 350, 'height': 600}
        )
        print("Captured 3_schuelerliste.png")
        
        # 4. Quick Rating Box (Clipped main center card)
        page.screenshot(
            path=os.path.join(img_dir, '4_quick_rating.png'),
            clip={'x': 390, 'y': 200, 'width': 880, 'height': 250}
        )
        print("Captured 4_quick_rating.png")
        
        # 5. Open Beobachtungsbogen accordion and capture criteria
        chevron = page.locator('button:has-text("Beobachtungsbogen")').first
        if chevron.is_visible():
            chevron.click()
            page.wait_for_timeout(1000)
        page.screenshot(
            path=os.path.join(img_dir, '5_kriterien_raster.png'),
            clip={'x': 390, 'y': 440, 'width': 880, 'height': 380}
        )
        print("Captured 5_kriterien_raster.png")
        
        # 6. Switch to class 2B (which has multiple subjects: D, BFUR, BFUD, BUB)
        btn_2b = page.locator('button:has-text("2B")').first
        if btn_2b.is_visible():
            btn_2b.click()
            page.wait_for_timeout(2000)
            page.screenshot(
                path=os.path.join(img_dir, '6_multi_subject_2b.png'),
                clip={'x': 10, 'y': 90, 'width': 1280, 'height': 220}
            )
            print("Captured 6_multi_subject_2b.png")

        browser.close()

if __name__ == '__main__':
    capture_screenshots()
