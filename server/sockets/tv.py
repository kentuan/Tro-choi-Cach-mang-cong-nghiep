"""Socket cho màn hình TV: TV vào phòng nhận hình, BTC chọn nội dung chiếu và cho phép hiện điểm."""
from flask import request
from flask_socketio import emit, join_room

from ..config import ROUND_TIME
from ..extensions import socketio
from ..state import btc_sids, game_state, teams, tv_control, tv_revealed
from ..tv_screen import broadcast_tv, tv_payload


@socketio.on("tv_get_state")
def handle_tv_get_state():
    join_room("tv")
    emit("tv_update", tv_payload())


@socketio.on("btc_tv_change")
def handle_btc_tv_change(data):
    if request.sid not in btc_sids:
        return {"ok": False}
    data = data if isinstance(data, dict) else {}
    view, raw_round = data.get("view"), data.get("round", 1)
    if view not in {"welcome", "rules", "guide", "time", "scores"}:
        emit("error_message", {"message": "Màn hình TV không hợp lệ!"})
        return {"ok": False}
    if raw_round == "total" and view == "scores":
        vong = "total"
    else:
        try:
            vong = int(raw_round)
        except (TypeError, ValueError):
            emit("error_message", {"message": "Vòng không hợp lệ!"})
            return {"ok": False}
        if vong not in ROUND_TIME:
            emit("error_message", {"message": "Vòng không hợp lệ!"})
            return {"ok": False}
    tv_control.update(view=view, round=vong)
    broadcast_tv()
    return {"ok": True}


@socketio.on("btc_tv_reveal")
def handle_btc_tv_reveal(data):
    """BTC cho phép (hoặc thu lại) việc hiện điểm trên TV.
    data = {"round": 1..6 | "total", "groups": ["Nhóm 1", ...] | "all", "show": True/False}
    Hiện tất cả = groups "all"; hiện từng đội = danh sách đội. Ẩn thì ngược lại."""
    if request.sid not in btc_sids:
        return {"ok": False}
    data = data if isinstance(data, dict) else {}
    show = data.get("show") is not False
    raw_round, raw_groups = data.get("round"), data.get("groups", "all")

    if raw_round == "total":
        key = "total"
    elif isinstance(raw_round, int) and not isinstance(raw_round, bool) and raw_round in ROUND_TIME:
        key = raw_round
    else:
        emit("error_message", {"message": "Vòng không hợp lệ!"})
        return {"ok": False}

    if raw_groups == "all":
        groups = set(teams.keys())
    elif isinstance(raw_groups, list) and all(isinstance(g, str) for g in raw_groups):
        groups = {g for g in raw_groups if g in teams}
    else:
        emit("error_message", {"message": "Danh sách đội không hợp lệ!"})
        return {"ok": False}

    if show:
        # Chỉ được hiện khi điểm đã chốt: vòng đã kết thúc (tổng điểm: sau vòng 6)
        if key == "total":
            ready = game_state["status"] == "waiting" and game_state["round"] >= 6
        else:
            ready = 1 <= key <= game_state["round"] and not (game_state["status"] != "waiting" and key == game_state["round"])
        if not ready:
            emit("error_message", {"message": "Chỉ hiện điểm trên TV khi vòng đã kết thúc!"})
            return {"ok": False}
        tv_revealed.setdefault(key, set()).update(groups)
    else:
        current = tv_revealed.get(key, set())
        current.difference_update(groups)
        if not current:
            tv_revealed.pop(key, None)

    broadcast_tv()
    return {"ok": True}
