"""Máy chủ trò chơi Cách mạng công nghiệp.

Cấu trúc:
  config.py        cấu hình .env, hằng số thời gian/điểm
  extensions.py    app Flask, database, Socket.IO
  models.py        bảng Score
  state.py         trạng thái trong RAM
  data.py          đọc file JSON đề
  ranking.py       bảng điểm, xếp hạng, ghép cặp vòng 6
  scoring.py       ghi điểm vào database
  tv_content.py    chữ luật chơi/hướng dẫn trên TV
  tv_screen.py     dữ liệu và phát màn hình TV
  broadcast.py     phát trạng thái cho đội chơi/BTC
  lifecycle.py     kết thúc vòng
  runner.py        chạy nền một vòng (đếm ngược → chơi → kết thúc)
  excel_export.py  dựng file Excel kết quả
  routes/          route HTTP (trang, API, xuất Excel)
  sockets/         socket event (sảnh, BTC, TV, vòng 1–4, vòng 5, vòng 6)
  games/           logic server của vòng 5 và vòng 6
"""
from .extensions import app, db, socketio

# Import để đăng ký route và socket handler
from . import routes, sockets  # noqa: E402,F401

__all__ = ["app", "db", "socketio"]
