"""Đọc dữ liệu đề (các file JSON trong static/games)."""
import json
import os

from .extensions import app


def load_json(name):
    """Đọc file dữ liệu trong static/games (đọc lại mỗi lần để sửa đề không cần khởi động lại)."""
    with open(os.path.join(app.static_folder, "games", name), "r", encoding="utf-8") as f:
        return json.load(f)


def skip_item_count(vong):
    """Số mục hợp lệ của vòng (câu ở vòng 1, câu lớn ở vòng 2–3, thẻ ở vòng 4) để kiểm tra chỉ số client gửi."""
    if vong == 4:
        return len(load_json("vong_4.json")["the"])
    return len(load_json(f"vong_{vong}.json"))
