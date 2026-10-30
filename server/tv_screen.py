"""Màn hình TV: dựng dữ liệu hiển thị (tv_update / tv_control) và phát cho phòng "tv" và "btc"."""
import time

from .config import ROUND_TIME
from .extensions import socketio
from .ranking import final_board, scoreboard
from .state import game_state, tv_control, tv_revealed, v6
from .tv_content import TV_CONTENT


def tv_payload():
    view, vong = tv_control["view"], tv_control["round"]
    if view in TV_CONTENT:
        title, body = TV_CONTENT[view].get(vong, ("", ""))
    elif view == "time":
        title, body = f"Thời gian · Vòng {vong}", ""
    elif view == "scores":
        title, body = ("Tổng điểm", "") if vong == "total" else (f"Điểm · Vòng {vong}", "")
    else:
        title, body = "Trò chơi Cách mạng Công nghiệp", "Chào mừng các đội chơi!"

    active = game_state["status"] == "playing" and game_state["round"] == vong
    countdown = game_state["status"] == "countdown" and game_state["round"] == vong
    if active:
        seconds = max(0, game_state["round_deadline"] - time.monotonic())
    elif countdown:
        seconds = max(0, game_state["countdown_deadline"] - time.monotonic())
    elif game_state["status"] == "waiting" and game_state["round"] == vong and game_state["round"] > 0:
        seconds = 0
    else:
        seconds = ROUND_TIME.get(vong, 0)
    scoreboard_rows, hidden_count = [], 0
    if view == "scores":
        full = final_board() if vong == "total" else scoreboard(vong) if isinstance(vong, int) else []
        shown = tv_revealed.get(vong, set())
        # Chỉ gồm các đội BTC đã cho hiện; thứ hạng tính trong số đội này
        scoreboard_rows = [r for r in full if r["group"] in shown]
        hidden_count = len(full) - len(scoreboard_rows)
    payload = {
        "view": view, "round": vong, "title": title, "body": body,
        "game_status": game_state["status"], "active_round": game_state["round"],
        "active": active, "countdown": countdown, "seconds": seconds,
        "scoreboard": scoreboard_rows,
        "hidden_count": hidden_count,
        "final_revealed": bool(v6.get("final_revealed")),
    }
    return payload


def tv_control_payload():
    return {
        "view": tv_control["view"], "round": tv_control["round"],
        # {"1": ["Nhóm 1", ...], "total": [...]}: đội nào đang được hiện điểm trên TV
        "revealed": {str(k): sorted(v) for k, v in tv_revealed.items()},
    }


def broadcast_tv():
    socketio.emit("tv_update", tv_payload(), to="tv")
    socketio.emit("tv_control", tv_control_payload(), to="btc")
