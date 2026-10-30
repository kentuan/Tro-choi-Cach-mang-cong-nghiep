"""Vòng đời một vòng chơi: kết thúc vòng."""
from .broadcast import broadcast_state, emit_btc_scores
from .extensions import socketio
from .state import game_state


def end_round():
    """Kết thúc vòng hiện tại. Gọi trong app context."""
    if game_state["status"] != "playing":
        return
    game_state["status"] = "waiting"
    game_state["round_deadline"] = 0.0
    game_state["run_id"] += 1  # huỷ bộ đếm giờ đang chờ
    socketio.emit("round_ended", {"round": game_state["round"]})
    broadcast_state()
    emit_btc_scores()
