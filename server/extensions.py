"""Khởi tạo các đối tượng dùng chung: Flask app, database và Socket.IO."""
from flask import Flask
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy

from . import config

# root_path / instance_path trỏ về thư mục gốc dự án (không phải thư mục server/)
# để Flask vẫn tìm thấy templates/, static/ và instance/app.db như trước.
app = Flask(
    __name__,
    root_path=str(config.BASE_DIR),
    instance_path=str(config.BASE_DIR / "instance"),
)
app.config["SECRET_KEY"] = config.SECRET_KEY
app.config["SQLALCHEMY_DATABASE_URI"] = config.DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")
