"""Socket cho BTC: vào phòng BTC, bắt đầu vòng, công bố điểm, reset trò chơi."""
import time

from flask import request
from flask_socketio import emit, join_room

from ..broadcast import broadcast_state, btc_scores_payload, emit_btc_scores, state_payload
from ..config import COUNTDOWN_TIME, DEBUG, ROUND_TIME
from ..extensions import db, socketio
from ..models import Score
from ..ranking import final_board
from ..runner import run_round
from ..state import (
    btc_sids,
    game_state,
    next_round,
    pending_groups,
    reset_game_state,
    reset_round_progress,
    revealed_rounds,
    teams,
    tv_revealed,
    v6,
)
from ..tv_screen import tv_control_payload


@socketio.on("btc_get_state")
def handle_btc_get_state():
    """BTC lấy trạng thái hiện tại và vào phòng 'btc' để nhận điểm trực tiếp."""
    join_room("btc")
    btc_sids.add(request.sid)
    emit("state_update", state_payload())
    emit("btc_scores", btc_scores_payload())
    emit("tv_control", tv_control_payload())


@socketio.on("btc_start_game")
def handle_btc_start_game(data=None):
    """BTC bấm bắt đầu vòng tiếp theo (chỉ khi mọi đội đã xác nhận tên).
    Khi DEBUG=True, BTC có thể gửi kèm {"vong": n} để bắt đầu một vòng bất kỳ (test nhanh)."""
    if game_state["status"] != "waiting":
        emit("error_message", {"message": "Một vòng đang diễn ra rồi!"})
        return

    if not teams:
        emit("error_message", {"message": "Chưa có đội nào tham gia!"})
        return

    pending = pending_groups()
    if pending:
        emit("error_message", {
            "message": "Còn đội chưa xác nhận tên: " + ", ".join(pending),
        })
        return

    requested = data.get("vong") if isinstance(data, dict) else None
    if requested is not None:
        # Chọn vòng tuỳ ý chỉ dành cho chế độ DEBUG; server tự kiểm tra, không tin client
        if not DEBUG:
            emit("error_message", {"message": "Chỉ được chọn vòng tuỳ ý khi DEBUG=True!"})
            return
        if not isinstance(requested, int) or isinstance(requested, bool) or requested not in ROUND_TIME:
            emit("error_message", {"message": "Vòng không hợp lệ!"})
            return
        vong = requested
    else:
        vong = next_round()
        if vong is None:
            emit("error_message", {"message": "Không còn vòng nào để bắt đầu!"})
            return

    game_state["run_id"] += 1
    run_id = game_state["run_id"]
    game_state["status"] = "countdown"
    game_state["round"] = vong
    game_state["countdown_deadline"] = time.monotonic() + COUNTDOWN_TIME
    reset_round_progress()

    # Bắt đầu vòng này từ đầu: xoá điểm của vòng này và các vòng sau
    # (chỉ có dữ liệu cũ khi chọn lại vòng ở chế độ DEBUG, nên vòng chạy bình thường không bị ảnh hưởng)
    Score.query.filter(Score.vong >= vong).delete()
    db.session.commit()
    revealed_rounds.difference_update([v for v in revealed_rounds if v >= vong])
    for k in [k for k in tv_revealed if k == "total" or k >= vong]:
        del tv_revealed[k]

    socketio.emit("game_countdown", {
        "round": vong,
        "seconds": COUNTDOWN_TIME,
        "teams": {g: teams[g]["team_name"] for g in teams},
    })
    broadcast_state()
    emit_btc_scores()

    # Server giữ đồng hồ: hết đếm ngược mới phát "game_started" cho mọi đội cùng lúc
    socketio.start_background_task(run_round, run_id, vong)


@socketio.on("btc_reveal_scores")
def handle_btc_reveal_scores(data):
    """BTC công bố điểm của MỘT vòng cho các đội (mỗi vòng phải mở riêng)."""
    vong = (data or {}).get("vong")

    if game_state["status"] != "waiting":
        emit("error_message", {"message": "Chỉ công bố điểm khi vòng đã kết thúc!"})
        return

    if not isinstance(vong, int) or not (1 <= vong <= game_state["round"]):
        emit("error_message", {"message": "Vòng không hợp lệ!"})
        return

    revealed_rounds.add(vong)
    broadcast_state()
    emit_btc_scores()


@socketio.on("btc_reveal_final")
def handle_btc_reveal_final():
    if game_state["status"] != "waiting" or game_state["round"] < 6:
        emit("error_message", {"message": "Chỉ công bố tổng kết sau khi vòng 6 kết thúc!"})
        return
    v6["final_revealed"] = True
    broadcast_state()
    emit_btc_scores()
    socketio.emit("final_revealed", {"scores": final_board()})


@socketio.on("btc_reset_game")
def handle_btc_reset_game():
    """BTC reset trò chơi: xoá đội, trạng thái vòng và toàn bộ điểm."""
    reset_game_state()

    Score.query.delete()
    db.session.commit()

    socketio.emit("game_reset", {"message": "Trò chơi đã được reset!"})
    broadcast_state()
    emit_btc_scores()
