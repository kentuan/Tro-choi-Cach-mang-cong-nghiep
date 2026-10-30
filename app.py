"""Điểm khởi chạy: python app.py

Toàn bộ logic nằm trong package server/ (xem server/__init__.py để biết file nào làm việc gì).
"""
from server import app, db, socketio
from server.config import PORT
from server.models import Score

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        # Mỗi lần khởi động server là một ván mới: xoá toàn bộ điểm cũ trong database
        Score.query.delete()
        db.session.commit()

    socketio.run(
        app,
        host="0.0.0.0",
        port=PORT,
        debug=True,
    )
