"""Dựng và phát trạng thái chung cho đội chơi (state_update), BTC (btc_scores) và TV."""
from .extensions import socketio
from .ranking import final_board, scoreboard, v6_pairings
from .state import finished_groups, game_state, next_round, revealed_rounds, teams, tv_control, v6
from .tv_screen import broadcast_tv


def state_payload():
    return {
        "teams": {g: t["team_name"] for g, t in teams.items()},
        "taken_groups": list(teams.keys()),
        "confirmed": {g: t["confirmed"] for g, t in teams.items()},
        "game_status": game_state["status"],
        "round": game_state["round"],
        "next_round": next_round(),
        "finished": sorted(finished_groups),
        # Chỉ gửi điểm của những vòng BTC đã công bố
        "revealed": {str(v): scoreboard(v) for v in sorted(revealed_rounds)},
        "final_revealed": bool(v6.get("final_revealed")),
        "final_scores": final_board() if v6.get("final_revealed") else [],
    }


def broadcast_state():
    """Phát trạng thái cho tất cả client (đội chơi + BTC) và cập nhật màn TV."""
    socketio.emit("state_update", state_payload())
    broadcast_tv()


def btc_scores_payload():
    return {
        "rounds": [
            {"vong": v, "revealed": v in revealed_rounds, "scores": scoreboard(v)}
            for v in range(1, game_state["round"] + 1)
        ],
        "final_revealed": bool(v6.get("final_revealed")),
        "final": final_board() if v6.get("final_revealed") else [],
        # BTC luôn thấy tổng điểm trực tiếp (để chọn đội hiện trên TV), kể cả khi chưa công bố cho đội chơi
        "live_final": final_board() if game_state["round"] >= 6 else [],
        "v6_pairings": v6_pairings() if game_state["round"] >= 5 else [],
    }


def emit_btc_scores():
    """Điểm trực tiếp chỉ gửi cho BTC (phòng 'btc'), đội chơi không nhận được."""
    socketio.emit("btc_scores", btc_scores_payload(), to="btc")
    if tv_control["view"] == "scores":
        broadcast_tv()
