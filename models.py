from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class User(db.Model):
    id = db.Column(db.String(100), primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)


class Chat(db.Model):
    id = db.Column(db.String(100), primary_key=True)
    user_id = db.Column(db.String(100), nullable=False)
    title = db.Column(db.String(200), default="Új beszélgetés")


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)


class GuestUsage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    guest_id = db.Column(db.String(100))
    timestamp = db.Column(db.Integer)