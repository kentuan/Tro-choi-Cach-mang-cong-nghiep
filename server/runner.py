"""Chạy nền một vòng chơi: đếm ngược → bắt đầu vòng → tự kết thúc khi hết giờ."""
import time

from .broadcast import broadcast_state
from .config import COUNTDOWN_TIME, ROUND_GRACE, ROUND_TIME
from .extensions import app, socketio
from .games.vong5 import run_quiz
from .games.vong6 import run_v6
from .lifecycle import end_round
from .state import game_state


def run_round(run_id, vong):
    socketio.sleep(COUNTDOWN_TIME)
    if game_state["run_id"] != run_id:  # đã bị reset trong lúc đếm ngược
        return

    with app.app_context():
        game_state["status"] = "playing"
        game_state["countdown_deadline"] = 0.0
        game_state["round_deadline"] = time.monotonic() + ROUND_TIME[vong]
        socketio.emit("game_started", {"round": vong, "time": ROUND_TIME[vong]})
        broadcast_state()

    if vong == 5:
        # Vòng 5: server chạy từng câu; ROUND_TIME[5] chỉ là giới hạn an toàn cho cả vòng
        run_quiz(run_id, time.monotonic() + ROUND_TIME[vong])
    elif vong == 6:
        with app.app_context():
            run_v6(run_id, time.monotonic() + ROUND_TIME[vong])
    else:
        socketio.sleep(ROUND_TIME[vong] + ROUND_GRACE)
    if game_state["run_id"] != run_id:  # vòng đã kết thúc sớm hoặc bị reset
        return

    with app.app_context():
        end_round()
