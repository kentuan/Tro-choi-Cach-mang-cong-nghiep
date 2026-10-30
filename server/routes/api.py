"""API JSON cho client: dữ liệu đề vòng 1–4 và bảng điểm."""
from flask import jsonify

from ..config import (
    POINTS_PER_CORRECT,
    POINTS_PER_PAIR,
    POINTS_PER_SLOT,
    POINTS_V4_RIGHT,
    POINTS_V4_WRONG,
    SKIP_PENALTIES,
    VONG1_TIME,
    VONG2_TIME,
    VONG3_TIME,
    VONG4_TIME,
)
from ..data import load_json
from ..extensions import app
from ..models import Score


@app.route("/api/vong1/data")
def vong1_data():
    """Trả về toàn bộ bộ câu hỏi vòng 1 (file JSON thô)."""
    return jsonify({
        "questions": load_json("vong_1.json"),
        "time": VONG1_TIME,
        "points_per_correct": POINTS_PER_CORRECT,
        "skip_penalty": SKIP_PENALTIES[1],
    })


@app.route("/api/vong2/data")
def vong2_data():
    """Trả về các câu ghép đôi của vòng 2 (file JSON thô), thời gian và điểm mỗi cặp."""
    return jsonify({
        "boards": load_json("vong_2.json"),
        "time": VONG2_TIME,
        "points_per_pair": POINTS_PER_PAIR,
        "skip_penalty": SKIP_PENALTIES[2],
    })


@app.route("/api/vong3/data")
def vong3_data():
    """Trả về các câu xếp dòng thời gian của vòng 3 (file JSON thô), thời gian và điểm mỗi vị trí."""
    return jsonify({
        "boards": load_json("vong_3.json"),
        "time": VONG3_TIME,
        "points_per_slot": POINTS_PER_SLOT,
        "skip_penalty": SKIP_PENALTIES[3],
    })


@app.route("/api/vong4/data")
def vong4_data():
    """Trả về các thẻ phân loại của vòng 4 (file JSON thô), thời gian, điểm cộng và điểm trừ."""
    data = load_json("vong_4.json")
    data.update({
        "time": VONG4_TIME,
        "points_right": POINTS_V4_RIGHT,
        "points_wrong": POINTS_V4_WRONG,
        "skip_penalty": SKIP_PENALTIES[4],
    })
    return jsonify(data)


@app.route("/api/scores")
def get_scores():
    scores = Score.query.order_by(Score.diem.desc()).all()
    return jsonify([s.to_dict() for s in scores])
