import os
import sqlite3
import uuid
import json
import time
from functools import wraps
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash
from groq import Groq

app = Flask(__name__)
app.secret_key = '916b11deedefa90794d7c76364ee1b8f82b88d9762b4dc42b9dbdb385ab4fa7b'

# Groq kliens inicializálása
client = Groq(api_key="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")
DATABASE = 'chats.db'
USERS_FILE = 'users.json'

# Globális változók a rendszerfunkciókhoz
MAINTENANCE_MODE = False
BROADCAST_MESSAGE = {"id": "", "text": ""}

def load_users():
    if not os.path.exists(USERS_FILE): return {}
    try:
        with open(USERS_FILE, 'r') as f: return json.load(f)
    except: return {}

def save_users(users):
    with open(USERS_FILE, 'w') as f: json.dump(users, f)

def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, user_id TEXT, title TEXT)')
    c.execute('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT, role TEXT, content TEXT)')
    # ÚJ TÁBLA: A vendégek üzenetküldési időpontjainak követésére
    c.execute('CREATE TABLE IF NOT EXISTS guest_usage (guest_id TEXT, timestamp INTEGER)')
    conn.commit(); conn.close()

init_db()

def create_default_admin():
    users = load_users()
    if 'admin' not in users:
        users['admin'] = {
            'id': str(uuid.uuid4()),
            'password': generate_password_hash('orionadmin2026', method='pbkdf2:sha256')
        }
        save_users(users)

create_default_admin()

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session: return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Hitelesítés ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        u, p = request.form.get('username'), request.form.get('password')
        users = load_users()
        if u in users and check_password_hash(users[u]['password'], p):
            session['user_id'] = users[u]['id']; session['username'] = u
            # Ha bejelentkezik, töröljük az esetleges vendég azonosítót
            session.pop('guest_id', None)
            return redirect(url_for('index'))
        error = "Hibás felhasználónév vagy jelszó!"
    return render_template('login.html', error=error)

@app.route('/register', methods=['GET', 'POST'])
def register():
    error = None
    if request.method == 'POST':
        u, p = request.form.get('username'), request.form.get('password')
        users = load_users()
        if u not in users:
            users[u] = {'id': str(uuid.uuid4()), 'password': generate_password_hash(p, method='pbkdf2:sha256')}
            save_users(users)
            return redirect(url_for('login'))
        error = "Ez a felhasználónév már foglalt!"
    return render_template('register.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# --- Főoldal (Átalakítva opcionális bejelentkezésre) ---
@app.route('/')
def index():
    if 'user_id' not in session:
        # Ha nem tag, kiosztunk egy állandó Vendég ID-t a munkamenetére
        if 'guest_id' not in session:
            session['guest_id'] = 'guest_' + str(uuid.uuid4())
        username = 'Vendég'
    else:
        username = session['username']
        
    if MAINTENANCE_MODE and username != 'admin':
        return render_template('maintenance.html')
    return render_template('index.html', username=username)

# --- Chat API (Vendégeknek is elérhetővé téve) ---
@app.route('/api/chats', methods=['GET', 'POST'])
def api_chats():
    # Meghatározzuk az aktuális azonosítót (Regisztrált ID vagy Vendég ID)
    curr_user_id = session.get('user_id') or session.get('guest_id')
    if not curr_user_id:
        if 'guest_id' not in session: session['guest_id'] = 'guest_' + str(uuid.uuid4())
        curr_user_id = session['guest_id']

    conn = sqlite3.connect(DATABASE); conn.row_factory = sqlite3.Row
    if request.method == 'POST':
        c_id = str(uuid.uuid4())
        conn.execute('INSERT INTO chats VALUES (?, ?, ?)', (c_id, curr_user_id, 'Új beszélgetés'))
        conn.commit(); conn.close()
        return jsonify({'id': c_id, 'title': 'Új beszélgetés'})
        
    chats = conn.execute('SELECT * FROM chats WHERE user_id = ? ORDER BY rowid DESC', (curr_user_id,)).fetchall()
    conn.close()
    return jsonify([dict(c) for c in chats])

@app.route('/api/chats/<c_id>', methods=['DELETE'])
def delete_chat(c_id):
    curr_user_id = session.get('user_id') or session.get('guest_id')
    conn = sqlite3.connect(DATABASE)
    conn.execute('DELETE FROM chats WHERE id = ? AND user_id = ?', (c_id, curr_user_id))
    conn.execute('DELETE FROM messages WHERE chat_id = ?', (c_id,))
    conn.commit(); conn.close()
    return jsonify({'success': True})

@app.route('/api/chats/<c_id>/messages', methods=['GET'])
def get_msgs(c_id):
    conn = sqlite3.connect(DATABASE); conn.row_factory = sqlite3.Row
    msgs = conn.execute('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', (c_id,)).fetchall()
    conn.close()
    return jsonify([dict(m) for m in msgs])

@app.route('/api/chats/<c_id>/message', methods=['POST'])
def send_msg(c_id):
    msg = request.json['message']
    conn = sqlite3.connect(DATABASE)
    
    # --- VENDÉG KORLÁTOZÁS ÉS MODELL VÁLASZTÁS LOGIKA ---
    if 'user_id' in session:
        # Bejelentkezett tag: Erős modell, nincs limit
        model_name = "llama-3.3-70b-versatile"
    else:
        # Vendég felhasználó: Gyengébb modell + 15 üzenet / 3 óra limit
        model_name = "llama-3.1-8b-instant"
        guest_id = session.get('guest_id')
        
        now = int(time.time())
        three_hours_ago = now - (3 * 3600)
        
        # Adatbázis tisztítás (opcionális, hogy ne hizzon feleslegesen a DB a régi adatokkal)
        conn.execute('DELETE FROM guest_usage WHERE timestamp < ?', (three_hours_ago,))
        
        # Megszámoljuk az elmúlt 3 órában küldött üzeneteket
        guest_count = conn.execute('SELECT COUNT(*) FROM guest_usage WHERE guest_id = ? AND timestamp > ?', (guest_id, three_hours_ago)).fetchone()[0]
        
        if guest_count >= 15:
            conn.close()
            return jsonify({
                'reply': "⚠️ **Elérted a regisztráció nélküli korlátot!**\n\nVendégként maximum 15 üzenetet küldhetsz 3 óránként. Kérjük, [regisztrálj egy ingyenes fiókot](/register) vagy [jelentkezz be](/login) a korlátlan használathoz és a lényegesen okosabb, precízebb magyar modell eléréséhez!",
                'title_updated': False,
                'new_title': ''
            })
            
        # Ha van még kerete, naplózzuk a mostani küldést
        conn.execute('INSERT INTO guest_usage (guest_id, timestamp) VALUES (?, ?)', (guest_id, now))
        conn.commit()

    # Üzenet mentése a chat történetbe
    conn.execute('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', (c_id, 'user', msg))
    
    count = conn.execute('SELECT COUNT(*) FROM messages WHERE chat_id = ?', (c_id,)).fetchone()[0]
    title_upd, new_title = False, ""
    if count == 1:
        new_title = msg[:25] + "..." if len(msg) > 25 else msg
        conn.execute('UPDATE chats SET title = ? WHERE id = ?', (new_title, c_id))
        title_upd = True

    conn.row_factory = sqlite3.Row
    history = conn.execute('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', (c_id,)).fetchall()
    
    api_messages = [{
        "role": "system", 
        "content": (
            "You are Orion AI, a highly intelligent and professional assistant. "
            "CRITICAL RULE: YOU MUST REPLY IN THE EXACT SAME LANGUAGE AS THE USER'S PROMPT. "
            "If the user writes in English, you MUST reply in English. Ha a felhasználó magyarul ír, válaszolj magyarul. "
            "Használj tökéletes, nyelvtanilag helyes magyar ragozást és mondatszerkezeteket. Kerüld az anglicizmusokat és a tükörfordításokat! "
            "Kerüld a felesleges ismétlődő üdvözléseket és a mesterségesen jópofizó stílust. Légy lényegretörő és precíz. "
            "KÉPGENERÁLÁS / IMAGE GENERATION: Ha a felhasználó képet kér / If the user asks for an image, "
            "generate the best English prompt and reply EXACTLY in this format (PARENTHESES ARE MANDATORY): "
            "![description](https://image.pollinations.ai/prompt/english%20prompt%20here?width=800&height=800&nologo=true) "
            "Do not use URL encoding in the prompt link. A kép mellé az adott nyelven írj egy rövid mondatot."
        )
    }]
    
    for row in history:
        api_messages.append({"role": row['role'], "content": row['content']})
    
    try:
        res = client.chat.completions.create(
            model=model_name, # Itt dől el dinamikusan, hogy a 8B vagy a 70B fut le!
            messages=api_messages
        )
        reply = res.choices[0].message.content
    except Exception as e:
        print(f"--- API HIBA ---: {e}")
        reply = f"Hiba a Groq API-val: {str(e)}"

    conn.execute('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', (c_id, 'assistant', reply))
    conn.commit(); conn.close()
    
    return jsonify({'reply': reply, 'title_updated': title_upd, 'new_title': new_title})

# --- USER BROADCAST API ---
@app.route('/api/broadcast', methods=['GET'])
def get_broadcast():
    return jsonify(BROADCAST_MESSAGE)

# --- ADMIN PANEL MŰVELETEK ---
@app.route('/admin')
@login_required
def admin_panel():
    if session.get('username') != 'admin':
        return redirect(url_for('index'))
    
    users = load_users()
    conn = sqlite3.connect(DATABASE)
    
    total_chats = conn.execute('SELECT COUNT(*) FROM chats').fetchone()[0]
    total_msgs = conn.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
    
    user_stats = []
    for uname, udata in users.items():
        uid = udata['id']
        u_chats = conn.execute('SELECT COUNT(*) FROM chats WHERE user_id = ?', (uid,)).fetchone()[0]
        user_stats.append({'username': uname, 'chats': u_chats})
        
    conn.close()
    
    return render_template('admin.html', 
                           users=user_stats, 
                           total_users=len(users), 
                           total_chats=total_chats, 
                           total_msgs=total_msgs,
                           username=session['username'],
                           maintenance=MAINTENANCE_MODE)

@app.route('/admin/toggle_maintenance', methods=['POST'])
@login_required
def toggle_maintenance():
    global MAINTENANCE_MODE
    if session.get('username') == 'admin':
        MAINTENANCE_MODE = not MAINTENANCE_MODE
    return redirect(url_for('admin_panel'))

@app.route('/admin/broadcast', methods=['POST'])
@login_required
def send_broadcast():
    global BROADCAST_MESSAGE
    if session.get('username') == 'admin':
        msg_text = request.form.get('broadcast_msg')
        if msg_text:
            BROADCAST_MESSAGE = {"id": str(uuid.uuid4()), "text": msg_text}
    return redirect(url_for('admin_panel'))

@app.route('/admin/change_password/<username>', methods=['POST'])
@login_required
def change_password(username):
    if session.get('username') != 'admin':
        return redirect(url_for('index'))
        
    new_password = request.form.get('new_password')
    if not new_password:
        return redirect(url_for('admin_panel'))
        
    users = load_users()
    if username in users:
        users[username]['password'] = generate_password_hash(new_password, method='pbkdf2:sha256')
        save_users(users)
        
    return redirect(url_for('admin_panel'))

@app.route('/admin/delete/<username>', methods=['POST'])
@login_required
def delete_user(username):
    if session.get('username') != 'admin' or username == 'admin':
        return redirect(url_for('admin_panel'))
    
    users = load_users()
    if username in users:
        u_id = users[username]['id']
        del users[username]
        save_users(users)
        
        conn = sqlite3.connect(DATABASE)
        chats = conn.execute('SELECT id FROM chats WHERE user_id = ?', (u_id,)).fetchall()
        for chat in chats:
            conn.execute('DELETE FROM messages WHERE chat_id = ?', (chat[0],))
        conn.execute('DELETE FROM chats WHERE user_id = ?', (u_id,))
        conn.commit()
        conn.close()
        
    return redirect(url_for('admin_panel'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)