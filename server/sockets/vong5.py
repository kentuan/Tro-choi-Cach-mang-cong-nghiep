"""Socket vòng 5 (nhanh tay & cược điểm): đồng bộ trạng thái, chọn cược, bấm chuông, gửi đáp án.

Logic trò chơi nằm ở server/games/vong5.py.
"""
from flask_socketio import join_room

from ..config import V5_BETS
from ..extensions import socketio
from ..games import vong5 as game
from ..state import game_state, teams


def _playing(group):
    return game_state["status"] == "playing" and game_state["round"] == 5 and group in teams


@socketio.on("v5_sync")
def handle_v5_sync(data):
    """Đội vừa vào vòng 5 (hoặc vừa nối lại mạng) xin trạng thái hiện tại; đồng thời vào phòng riêng của nhóm
    để nhận kết quả riêng (v5_result)."""
    data = data if isinstance(data, dict) else {}
    group = data.get("group", "")
    if not _playing(group):
        return None
    join_room("grp:" + group)
    return game.snapshot(group)


@socketio.on("v5_bet")
def handle_v5_bet(data):
    """Chọn mức cược cho câu hiện tại (chỉ nhận trong pha cược)."""
    data = data if isinstance(data, dict) else {}
    group, bet = data.get("group", ""), data.get("bet")
    if not _playing(group) or not isinstance(bet, int) or isinstance(bet, bool) or bet not in V5_BETS:
        return {"ok": False}
    return game.place_bet(group, bet)


@socketio.on("v5_buzz")
def handle_v5_buzz(data):
    """Bấm chuông: đội đến trước được giữ chuông và nhận các lựa chọn."""
    data = data if isinstance(data, dict) else {}
    group = data.get("group", "")
    if not _playing(group):
        return {"ok": False}
    return game.buzz(group)


@socketio.on("v5_answer")
def handle_v5_answer(data):
    """Đội đang giữ chuông gửi đáp án (chỉ số trong danh sách lựa chọn đã nhận)."""
    data = data if isinstance(data, dict) else {}
    group, choice = data.get("group", ""), data.get("choice")
    if not _playing(group) or not isinstance(choice, int) or isinstance(choice, bool):
        return {"ok": False}
    return game.submit_answer(group, choice)
