"""Socket vòng 6 (poker kiến thức): đồng bộ trạng thái và nhận thao tác của đội.

Logic trò chơi nằm ở server/games/vong6.py.
"""
from flask_socketio import join_room

from ..extensions import socketio
from ..games import vong6 as game
from ..state import game_state, teams


def _playing(group):
    return game_state["status"] == "playing" and game_state["round"] == 6 and group in teams


@socketio.on("v6_sync")
def handle_v6_sync(data):
    group = (data or {}).get("group")
    if not _playing(group):
        return None
    join_room("grp:" + group)
    return game.snapshot(group)


@socketio.on("v6_action")
def handle_v6_action(data):
    data = data or {}
    group, action = data.get("group"), data.get("action")
    if not _playing(group):
        return {"ok": False}
    if not game.apply_action(group, action, data):
        return {"ok": False}
    game.broadcast()
    return {"ok": True}
