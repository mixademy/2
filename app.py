import os
import uuid
import time

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

from models import (
    db,
    User,
    Chat,
    Message,
    GuestUsage
)


app = Flask(__name__)


app.secret_key = os.environ.get(
    "SECRET_KEY"
)


app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL"
)

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False


db.init_app(app)


with app.app_context():
    db.create_all()



client = Groq(
    api_key=os.environ.get(
        "GROQ_API_KEY"
    )
)



MAINTENANCE_MODE = False

BROADCAST_MESSAGE = {
    "id": "",
    "text": ""
}



def create_default_admin():

    admin = User.query.filter_by(
        username="admin"
    ).first()


    if not admin:

        user = User(
            id=str(uuid.uuid4()),
            username="admin",
            password=generate_password_hash(
                "orionadmin2026",
                method="pbkdf2:sha256"
            )
        )

        db.session.add(user)
        db.session.commit()



with app.app_context():
    create_default_admin()



def login_required(f):

    @wraps(f)
    def decorated(*args, **kwargs):

        if "user_id" not in session:
            return redirect(
                url_for("login")
            )

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


        user = User.query.filter_by(
            username=username
        ).first()


        if user and check_password_hash(
            user.password,
            password
        ):

            session["user_id"] = user.id
            session["username"] = user.username

            session.pop(
                "guest_id",
                None
            )

            return redirect(
                url_for("index")
            )


        error = "Hibás felhasználónév vagy jelszó!"


    return render_template(
        "login.html",
        error=error
    )



@app.route('/register', methods=['GET','POST'])
def register():

    error = None


    if request.method == "POST":

        username = request.form.get("username")
        password = request.form.get("password")


        exists = User.query.filter_by(
            username=username
        ).first()


        if exists:

            error = "Ez a felhasználónév már foglalt!"

        else:

            user = User(
                id=str(uuid.uuid4()),
                username=username,
                password=generate_password_hash(
                    password,
                    method="pbkdf2:sha256"
                )
            )


            db.session.add(user)
            db.session.commit()


            return redirect(
                url_for("login")
            )


    return render_template(
        "register.html",
        error=error
    )



@app.route('/logout')
def logout():

    session.clear()

    return redirect(
        url_for("login")
    )



# -------------------------
# FŐOLDAL
# -------------------------

@app.route("/")
def index():


    if "user_id" not in session:


        if "guest_id" not in session:

            session["guest_id"] = (
                "guest_" +
                str(uuid.uuid4())
            )


        username = "Vendég"


    else:

        username = session["username"]



    if MAINTENANCE_MODE and username != "admin":

        return render_template(
            "maintenance.html"
        )



    return render_template(
        "index.html",
        username=username
    )



# -------------------------
# CHAT LISTA
# -------------------------

@app.route(
    "/api/chats",
    methods=["GET","POST"]
)
def api_chats():


    current_user = (
        session.get("user_id")
        or
        session.get("guest_id")
    )


    if not current_user:

        session["guest_id"] = (
            "guest_" +
            str(uuid.uuid4())
        )

        current_user = session["guest_id"]



    # ÚJ CHAT

    if request.method == "POST":


        chat_id = str(uuid.uuid4())


        chat = Chat(
            id=chat_id,
            user_id=current_user,
            title="Új beszélgetés"
        )


        db.session.add(chat)
        db.session.commit()


        return jsonify({

            "id":chat_id,

            "title":"Új beszélgetés"

        })



    chats = Chat.query.filter_by(
        user_id=current_user
    ).all()



    return jsonify([

        {
            "id":c.id,
            "title":c.title
        }

        for c in chats

    ])
# -------------------------
# CHAT TÖRLÉS
# -------------------------

@app.route(
    "/api/chats/<c_id>",
    methods=["DELETE"]
)
def delete_chat(c_id):

    current_user = (
        session.get("user_id")
        or
        session.get("guest_id")
    )


    chat = Chat.query.filter_by(
        id=c_id,
        user_id=current_user
    ).first()


    if chat:

        Message.query.filter_by(
            chat_id=c_id
        ).delete()


        db.session.delete(chat)

        db.session.commit()


    return jsonify({
        "success": True
    })



# -------------------------
# ÜZENETEK LEKÉRÉSE
# -------------------------

@app.route(
    "/api/chats/<c_id>/messages",
    methods=["GET"]
)
def get_msgs(c_id):


    messages = Message.query.filter_by(
        chat_id=c_id
    ).order_by(
        Message.id.asc()
    ).all()



    return jsonify([

        {
            "role":m.role,
            "content":m.content
        }

        for m in messages

    ])




# -------------------------
# AI ÜZENET KÜLDÉS
# -------------------------

@app.route(
    "/api/chats/<c_id>/message",
    methods=["POST"]
)
def send_msg(c_id):


    data = request.json

    user_message = data["message"]



    # MODELL VÁLASZTÁS

    if "user_id" in session:

        model_name = (
            "llama-3.3-70b-versatile"
        )


    else:

        model_name = (
            "llama-3.1-8b-instant"
        )



        guest_id = session.get(
            "guest_id"
        )


        now = int(time.time())

        limit_time = now - (
            3 * 3600
        )


        # régi limitek törlése

        GuestUsage.query.filter(
            GuestUsage.timestamp < limit_time
        ).delete()



        count = GuestUsage.query.filter(
            GuestUsage.guest_id == guest_id,
            GuestUsage.timestamp > limit_time
        ).count()



        if count >= 15:

            db.session.commit()

            return jsonify({

                "reply":
                "⚠️ Elérted a vendég limitet! Regisztrálj a korlátlan használathoz.",

                "title_updated":False,

                "new_title":""

            })



        usage = GuestUsage(

            guest_id=guest_id,

            timestamp=now

        )


        db.session.add(
            usage
        )



    # FELHASZNÁLÓI ÜZENET MENTÉSE


    message = Message(

        chat_id=c_id,

        role="user",

        content=user_message

    )


    db.session.add(
        message
    )



    # CÍM FRISSÍTÉS


    msg_count = Message.query.filter_by(
        chat_id=c_id
    ).count()



    title_updated = False
    new_title = ""



    if msg_count == 1:


        new_title = (

            user_message[:25]

            +

            "..."

            if len(user_message) > 25

            else user_message

        )


        chat = Chat.query.filter_by(
            id=c_id
        ).first()


        if chat:

            chat.title = new_title


        title_updated = True



    db.session.commit()




    # CHAT ELŐZMÉNY BETÖLTÉS


    history = Message.query.filter_by(
        chat_id=c_id
    ).order_by(
        Message.id.asc()
    ).all()



    api_messages = [

        {

        "role":"system",

        "content":

        """
You are Orion AI, a highly intelligent assistant.

Always reply in the same language as the user.

If the user writes Hungarian, answer Hungarian.

Be precise and professional.

Avoid unnecessary greetings.

"""

        }

    ]



    for msg in history:

        api_messages.append({

            "role":msg.role,

            "content":msg.content

        })




    # GROQ HÍVÁS


    try:


        response = client.chat.completions.create(

            model=model_name,

            messages=api_messages

        )


        reply = (
            response
            .choices[0]
            .message
            .content
        )



    except Exception as e:


        print(
            "GROQ ERROR:",
            e
        )


        reply = (
            "Hiba történt az AI válasz generálása közben."
        )



    # AI VÁLASZ MENTÉSE


    ai_message = Message(

        chat_id=c_id,

        role="assistant",

        content=reply

    )


    db.session.add(
        ai_message
    )


    db.session.commit()



    return jsonify({

        "reply":reply,

        "title_updated":title_updated,

        "new_title":new_title

    })