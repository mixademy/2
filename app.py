import os
import uuid
import time
import json
from functools import wraps

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    redirect,
    url_for,
    session
)

from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)

from groq import Groq

# FIREBASE IMPORTOK
import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "alapertelmezett_titkos_kulcs")

# FIREBASE INICIALIZÁLÁS KÖRNYEZETI VÁLTOZÓBÓL
firebase_key_json = os.environ.get("FIREBASE_KEY_JSON")
if firebase_key_json:
    key_dict = json.loads(firebase_key_json)
    cred = credentials.Certificate(key_dict)
else:
    # Lokális teszteléshez megmarad a fájl, ha van
    cred = credentials.Certificate("orionai-2e08e-firebase-adminsdk-fbsvc-cdf47df7d3.json")

firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://orionai-2e08e-default-rtdb.europe-west1.firebasedatabase.app'
})

# GROQ KLIENS (Helyesen a változó nevét kérjük el)
client = Groq(
    api_key=os.environ.get("GROQ_API_KEY")
)

MAINTENANCE_MODE = False
BROADCAST_MESSAGE = {
    "id": "",
    "text": ""
}

# -------------------------
# ADMIN LÉTREHOZÁSA (FIREBASE)
# -------------------------
def create_default_admin():
    admin_ref = db.reference('users/admin')
    admin_data = admin_ref.get()
    
    if not admin_data:
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
# LOGIN / REGISTER
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
        exists = user_ref.get()

        if exists:
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
            "timestamp": int(time.time())
        })
        return jsonify({"id": chat_id, "title": "Új beszélgetés"})

    chats_data = chats_ref.get() or {}
    chats_list = [{"id": cid, "title": data["title"]} for cid, data in chats_data.items()]
    
    return jsonify(chats_list)

# -------------------------
# CHAT TÖRLÉS
# -------------------------
@app.route("/api/chats/<c_id>", methods=["DELETE"])
def delete_chat(c_id):
    current_user = session.get("user_id") or session.get("guest_id")
    
    db.reference(f'user_chats/{current_user}/{c_id}').delete()
    db.reference(f'messages/{c_id}').delete()

    return jsonify({"success": True})

# -------------------------
# ÜZENETEK LEKÉRÉSE
# -------------------------
@app.route("/api/chats/<c_id>/messages", methods=["GET"])
def get_msgs(c_id):
    msgs_data = db.reference(f'messages/{c_id}').order_by_child('timestamp').get()
    
    if not msgs_data:
        return jsonify([])
        
    messages = [
        {"role": msg["role"], "content": msg["content"]} 
        for msg_id, msg in msgs_data.items()
    ]
    return jsonify(messages)

# -------------------------
# AI ÜZENET KÜLDÉS
# -------------------------
@app.route("/api/chats/<c_id>/message", methods=["POST"])
def send_msg(c_id):
    data = request.json
    user_message = data["message"]

    if "user_id" in session:
        model_name = "openai/gpt-oss-120b"
    else:
        model_name = "openai/gpt-oss-20b"
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
                "reply": "⚠️ Elérted a vendég limitet! Regisztrálj a korlátlan használathoz.",
                "title_updated": False,
                "new_title": ""
            })

        usage_ref.push(now)

    messages_ref = db.reference(f'messages/{c_id}')
    messages_ref.push({
        "role": "user",
        "content": user_message,
        "timestamp": int(time.time())
    })

    current_user = session.get("user_id") or session.get("guest_id")
    msg_count = len(messages_ref.get() or {})
    
    title_updated = False
    new_title = ""

    if msg_count == 1:
        new_title = user_message[:25] + "..." if len(user_message) > 25 else user_message
        db.reference(f'user_chats/{current_user}/{c_id}').update({"title": new_title})
        title_updated = True

    history_data = messages_ref.order_by_child('timestamp').get() or {}
    
api_messages = [{
        "role": "system",
        "content": """
You are Orion AI, a highly intelligent and professional assistant.
CRITICAL RULE: YOU MUST REPLY IN THE EXACT SAME LANGUAGE AS THE USER'S PROMPT.
If the user writes in English, you MUST reply in English. Ha a felhasználó magyarul ír, válaszolj magyarul.
Használj tökéletes, nyelvtanilag helyes magyar ragozást és mondatszerkezeteket. Kerüld az anglicizmusokat és a tükörfordításokat!

KÓDOLÁS ÉS PROGRAMOZÁS / CODING:
Amikor kódot, szkriptet, vagy HTML/CSS/JS fájlt generálsz, azt KIVÉTEL NÉLKÜL egy megfelelő Markdown kódblokkba kell tenned, jelezve a nyelvet is. Például:
```python
print("Hello World")
```
Ha a kódhoz magyarázatot fűzöl, a szöveg maradjon a kódblokkon kívül.

KÉPGENERÁLÁS / IMAGE GENERATION:
Ha a felhasználó képet kér, kötelezően egy Markdown képlinket kell visszadnod a következő formátumban:
![Kép](https://image.pollinations.ai/prompt/{angol_nyelvu_reszletes_leiras}?width=1024&height=1024&model=flux&nologo=true)

SZABÁLYOK A KÉPGENERÁLÁSHOZ:
1. Az {angol_nyelvu_reszletes_leiras} helyére a felhasználó kérésének PROFI, RÉSZLETES, ANGOL nyelvű fordítását és kibővítését kell beírnod. A szavakat %20-szal válaszd el (pl. cyberpunk%20city,%20neon%20lights).
2. Használj professzionális kulcsszavakat a leírásban (pl. "photorealistic, 8k resolution, cinematic lighting, highly detailed").
3. Soha ne adj meg más linket, csak a megadott URL-t a "model=flux" és "nologo=true" paraméterekkel. A kép mellé írj egy rövid, kedves mondatot.
"""
    }]