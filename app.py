import os
import uuid
import time
import json
import base64
import PyPDF2
from functools import wraps

from flask import (
    Flask, render_template, request, jsonify, redirect, url_for, session
)
from werkzeug.security import generate_password_hash, check_password_hash
from groq import Groq

# FIREBASE IMPORTOK
import firebase_admin
from firebase_admin import credentials, db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "alapertelmezett_titkos_kulcs")

# FIREBASE INICIALIZÁLÁS
firebase_key_json = os.environ.get("FIREBASE_KEY_JSON")
if firebase_key_json:
    key_dict = json.loads(firebase_key_json)
    cred = credentials.Certificate(key_dict)
else:
    # Lokális teszteléshez (ha van json fájlod)
    cred = credentials.Certificate("orionai-2e08e-firebase-adminsdk-fbsvc-cdf47df7d3.json")

firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://orionai-2e08e-default-rtdb.europe-west1.firebasedatabase.app'
})

# GROQ KLIENS
client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

MAINTENANCE_MODE = False
BROADCAST_MESSAGE = {"id": "", "text": ""}

# MODELL VÁLASZTÓ MAPPING
MODEL_MAPPING = {
    "fast": "llama-3.1-8b-instant",
    "smart": "llama-3.1-70b-versatile",
    "creative": "mixtral-8x7b-32768",
    "code": "gemma2-9b-it"
}

# -------------------------
# ADMIN LÉTREHOZÁSA
# -------------------------
def create_default_admin():
    admin_ref = db.reference('users/admin')
    if not admin_ref.get():
        admin_ref.set({
            'id': str(uuid.uuid4()),
            'username': 'admin',
            'password': generate_password_hash("orionadmin2026", method="pbkdf2:sha256")
        })

with app.app_context():
    create_default_admin()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

# -------------------------
# LOGIN / REGISTER / LOGOUT
# -------------------------
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        username = request.form.get("username")
        password = request.form.get("password")
        user_data = db.reference(f'users/{username}').get()
        if user_data and check_password_hash(user_data['password'], password):
            session["user_id"] = user_data['id']
            session["username"] = user_data['username']
            session.pop("guest_id", None)
            return redirect(url_for("index"))
        error = "Hibás felhasználónév vagy jelszó!"
    return render_template("login.html", error=error)

@app.route('/register', methods=['GET','POST'])
def register():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        user_ref = db.reference(f'users/{username}')
        if user_ref.get():
            error = "Ez a felhasználónév már foglalt!"
        else:
            user_ref.set({
                'id': str(uuid.uuid4()),
                'username': username,
                'password': generate_password_hash(password, method="pbkdf2:sha256")
            })
            return redirect(url_for("login"))
    return render_template("register.html", error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for("login"))

# -------------------------
# FŐOLDAL
# -------------------------
@app.route("/")
def index():
    if "user_id" not in session:
        if "guest_id" not in session:
            session["guest_id"] = "guest_" + str(uuid.uuid4())
        username = "Vendég"
    else:
        username = session["username"]

    if MAINTENANCE_MODE and username != "admin":
        return render_template("maintenance.html")
    return render_template("index.html", username=username)

# -------------------------
# CHAT LISTA
# -------------------------
@app.route("/api/chats", methods=["GET","POST"])
def api_chats():
    current_user = session.get("user_id") or session.get("guest_id")
    if not current_user:
        session["guest_id"] = "guest_" + str(uuid.uuid4())
        current_user = session["guest_id"]

    chats_ref = db.reference(f'user_chats/{current_user}')

    if request.method == "POST":
        chat_id = str(uuid.uuid4())
        chats_ref.child(chat_id).set({
            "title": "Új beszélgetés",
            "timestamp": int(time.time()),
            "pinned": False
        })
        return jsonify({"id": chat_id, "title": "Új beszélgetés", "pinned": False})

    chats_data = chats_ref.get() or {}
    chats_list = [{"id": cid, "title": data["title"], "pinned": data.get("pinned", False)} for cid, data in chats_data.items()]
    chats_list.sort(key=lambda x: (not x["pinned"], -chats_data[x["id"]].get("timestamp", 0)))
    
    return jsonify(chats_list)

@app.route("/api/chats/<c_id>", methods=["DELETE", "PUT"])
def manage_chat(c_id):
    current_user = session.get("user_id") or session.get("guest_id")
    chat_ref = db.reference(f'user_chats/{current_user}/{c_id}')
    
    if request.method == "DELETE":
        chat_ref.delete()
        db.reference(f'messages/{c_id}').delete()
        return jsonify({"success": True})
        
    if request.method == "PUT":
        data = request.json
        if "title" in data:
            chat_ref.update({"title": data["title"]})
        if "pinned" in data:
            chat_ref.update({"pinned": data["pinned"]})
        return jsonify({"success": True})

# -------------------------
# ÜZENETEK LEKÉRÉSE ÉS SZERKESZTÉSE
# -------------------------
@app.route("/api/chats/<c_id>/messages", methods=["GET", "PUT"])
def manage_msgs(c_id):
    msgs_ref = db.reference(f'messages/{c_id}')
    
    if request.method == "GET":
        msgs_data = msgs_ref.order_by_child('timestamp').get()
        if not msgs_data:
            return jsonify([])
        messages = [{"id": msg_id, "role": msg["role"], "content": msg["content"]} for msg_id, msg in msgs_data.items()]
        return jsonify(messages)
        
    if request.method == "PUT":
        data = request.json
        if data.get("msg_id"):
            msgs_ref.child(data["msg_id"]).update({"content": data["content"], "timestamp": int(time.time())})
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "Hiányzó adat"})

# -------------------------
# FÁJLFELTÖLTÉS VÉGPONT
# -------------------------
@app.route("/api/upload", methods=["POST"])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "Nincs fájl kiválasztva"})
    
    file = request.files['file']
    filename = file.filename.lower()
    
    try:
        # Képek feldolgozása (Base64)
        if filename.endswith(('.png', '.jpg', '.jpeg', '.webp')):
            image_data = file.read()
            base64_img = base64.b64encode(image_data).decode('utf-8')
            mime_type = "image/jpeg"
            if filename.endswith('.png'): mime_type = "image/png"
            elif filename.endswith('.webp'): mime_type = "image/webp"
            
            return jsonify({
                "success": True, 
                "type": "image", 
                "content": f"data:{mime_type};base64,{base64_img}", 
                "filename": file.filename
            })
        
        # PDF feldolgozása (PyPDF2)
        elif filename.endswith('.pdf'):
            reader = PyPDF2.PdfReader(file)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            return jsonify({"success": True, "type": "text", "content": text, "filename": file.filename})
        
        # Egyéb fájlok (kód, txt, csv, stb.) sima szövegként
        else:
            text = file.read().decode('utf-8')
            return jsonify({"success": True, "type": "text", "content": text, "filename": file.filename})
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

# -------------------------
# AI ÜZENET KÜLDÉS
# -------------------------
@app.route("/api/chats/<c_id>/message", methods=["POST"])
def send_msg(c_id):
    data = request.json
    raw_user_message = data.get("message", "")
    requested_model = data.get("model", "smart")
    attached_file = data.get("file")
    
    # 1. Vendég limit ellenőrzés
    if "user_id" not in session:
        guest_id = session.get("guest_id")
        now = int(time.time())
        limit_time = now - (3 * 3600)
        
        usage_ref = db.reference(f'guest_usage/{guest_id}')
        usages = usage_ref.get() or {}
        
        valid_count = 0
        for u_id, timestamp in list(usages.items()):
            if timestamp < limit_time:
                usage_ref.child(u_id).delete()
            else:
                valid_count += 1

        if valid_count >= 15:
            return jsonify({
                "reply": "⚠️ Elérted a vendég limitet (15 üzenet / 3 óra)! Regisztrálj a korlátlan használathoz.",
                "title_updated": False,
                "new_title": ""
            })

        usage_ref.push(now)
        model_name = "llama-3.1-8b-instant"
    else:
        model_name = MODEL_MAPPING.get(requested_model, "llama-3.1-70b-versatile")

    # 2. Fájlok és szövegek összefűzése
    msg_content_for_api = raw_user_message
    db_saved_message = raw_user_message
    
    if attached_file:
        if attached_file["type"] == "text":
            msg_content_for_api = f"[Csatolt fájl ({attached_file['filename']}) tartalma:]\n{attached_file['content']}\n\n[Felhasználó üzenete:]\n{raw_user_message}"
            db_saved_message = f"[Fájl csatolva: {attached_file['filename']}]\n{raw_user_message}"
        
        elif attached_file["type"] == "image":
            # Képnél KÖTELEZŐ a vision modell használata a Groq-nál
            model_name = "llama-3.2-11b-vision-preview" 
            msg_content_for_api = [
                {"type": "text", "text": raw_user_message if raw_user_message.strip() else "Mi van a képen?"},
                {"type": "image_url", "image_url": {"url": attached_file['content']}}
            ]
            db_saved_message = f"[Kép csatolva: {attached_file['filename']}]\n{raw_user_message}"

    # 3. Adatbázis mentés
    messages_ref = db.reference(f'messages/{c_id}')
    messages_ref.push({
        "role": "user",
        "content": db_saved_message,
        "timestamp": int(time.time())
    })

    current_user = session.get("user_id") or session.get("guest_id")
    msg_count = len(messages_ref.get() or {})
    title_updated = False
    new_title = ""

    # Cím generálás
    if msg_count == 1:
        try:
            title_resp = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": f"Foglald össze a témát maximum 3-4 szóban. Csak a témát írd le: {raw_user_message}"}]
            )
            new_title = title_resp.choices[0].message.content.replace('"', '').strip()
        except Exception:
            new_title = raw_user_message[:25] + "..." if len(raw_user_message) > 25 else raw_user_message
            
        db.reference(f'user_chats/{current_user}/{c_id}').update({"title": new_title})
        title_updated = True

    # 4. API hívás
    history_data = messages_ref.order_by_child('timestamp').get() or {}
    
    api_messages = [{
        "role": "system",
        "content": "You are Orion AI, a professional assistant.\nCRITICAL RULE: YOU MUST REPLY IN THE EXACT SAME LANGUAGE AS THE USER'S PROMPT. Ha a felhasználó magyarul ír, magyarul válaszolj.\nPut generated code in markdown blocks.\nFor images, return ![Image](https://image.pollinations.ai/prompt/{english_description}?width=1024&height=1024&model=flux&nologo=true)."
    }]

    for msg_id, msg in history_data.items():
        if msg["content"] != db_saved_message:
            api_messages.append({"role": msg["role"], "content": msg["content"]})
            
    api_messages.append({"role": "user", "content": msg_content_for_api})

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=api_messages
        )
        reply = response.choices[0].message.content
    except Exception as e:
        print("GROQ ERROR:", e)
        reply = "Hiba történt az AI válasz generálása közben. (Valószínűleg hálózati probléma, vagy nem támogatott fájltípus)."

    messages_ref.push({
        "role": "assistant",
        "content": reply,
        "timestamp": int(time.time())
    })

    return jsonify({
        "reply": reply,
        "title_updated": title_updated,
        "new_title": new_title
    })

# -------------------------
# ADMIN PANEL ÉS FUNKCIÓK
# -------------------------
@app.route('/admin')
@login_required
def admin_panel():
    if session.get("username") != "admin":
        return redirect(url_for("index"))

    users_data = db.reference('users').get() or {}
    user_chats_data = db.reference('user_chats').get() or {}
    messages_data = db.reference('messages').get() or {}

    total_users = len(users_data)
    total_chats = sum(len(chats) for chats in user_chats_data.values())
    total_msgs = sum(len(msgs) for msgs in messages_data.values())

    user_stats = []
    for uname, udata in users_data.items():
        uid = udata.get('id')
        chat_count = len(user_chats_data.get(uid, {}))
        user_stats.append({
            "username": uname,
            "chats": chat_count
        })

    return render_template(
        "admin.html",
        users=user_stats,
        total_users=total_users,
        total_chats=total_chats,
        total_msgs=total_msgs,
        username=session.get("username"),
        maintenance=MAINTENANCE_MODE
    )

@app.route('/api/broadcast')
def get_broadcast():
    return jsonify(BROADCAST_MESSAGE)

@app.route("/admin/toggle_maintenance", methods=["POST"])
@login_required
def toggle_maintenance():
    global MAINTENANCE_MODE
    if session.get("username") == "admin":
        MAINTENANCE_MODE = not MAINTENANCE_MODE
    return redirect(url_for("admin_panel"))

@app.route("/admin/broadcast", methods=["POST"])
@login_required
def send_broadcast():
    global BROADCAST_MESSAGE
    if session.get("username") == "admin":
        msg_text = request.form.get("broadcast_msg")
        if msg_text:
            BROADCAST_MESSAGE = {
                "id": str(uuid.uuid4()),
                "text": msg_text
            }
    return redirect(url_for("admin_panel"))

@app.route("/admin/change_password/<username>", methods=["POST"])
@login_required
def change_password(username):
    if session.get("username") != "admin":
        return redirect(url_for("index"))

    new_password = request.form.get("new_password")
    if not new_password:
        return redirect(url_for("admin_panel"))

    user_ref = db.reference(f'users/{username}')
    if user_ref.get():
        user_ref.update({
            'password': generate_password_hash(new_password, method="pbkdf2:sha256")
        })

    return redirect(url_for("admin_panel"))

@app.route("/admin/delete/<username>", methods=["POST"])
@login_required
def delete_user(username):
    if session.get("username") != "admin" or username == "admin":
        return redirect(url_for("admin_panel"))

    user_ref = db.reference(f'users/{username}')
    user_data = user_ref.get()

    if user_data:
        uid = user_data.get('id')
        
        # Töröljük a felhasználó chatjeit és üzeneteit
        chats = db.reference(f'user_chats/{uid}').get() or {}
        for c_id in chats.keys():
            db.reference(f'messages/{c_id}').delete()
            
        db.reference(f'user_chats/{uid}').delete()
        user_ref.delete()

    return redirect(url_for("admin_panel"))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)