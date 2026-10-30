"""Socket cho đội chơi ở sảnh chờ: lấy trạng thái, chọn nhóm, đặt tên đội, ngắt kết nối."""
from flask import request
from flask_socketio import emit

from ..broadcast import broadcast_state, state_payload
from ..config import ALLOWED_GROUPS
from ..extensions import socketio
from ..state import btc_sids, game_locked, game_state, teams


@socketio.on("get_state")
def handle_get_state():
    """Gửi trạng thái hiện tại cho client vừa kết nối."""
    emit("state_update", state_payload())


@socketio.on("select_group")
def handle_select_group(data):
    """Đội chơi chọn nhóm (Nhóm 1/2/4/5)."""
    group = data.get("group")

    if game_locked():
        emit("error_message", {"message": "Trò chơi đã bắt đầu, không thể tham gia nữa!"})
        return

    if group not in ALLOWED_GROUPS:
        emit("error_message", {"message": "Nhóm không hợp lệ!"})
        return

    if any(t["sid"] == request.sid for t in teams.values()):
        emit("error_message", {"message": "Bạn đã chọn một nhóm rồi!"})
        return

    if group in teams:
        emit("error_message", {"message": f"{group} đã có đội khác chọn rồi!"})
        return

    teams[group] = {
        "team_name": group,  # Mặc định tên đội = tên nhóm
        "sid": request.sid,
        "confirmed": False,
    }

    emit("group_selected", {"group": group, "default_name": group})
    broadcast_state()


@socketio.on("set_team_name")
def handle_set_team_name(data):
    """Đội chơi đặt tên đội và bấm Xác nhận."""
    group = data.get("group")
    team_name = (data.get("team_name") or "").strip()[:30]

    if group not in teams:
        emit("error_message", {"message": "Nhóm chưa được chọn!"})
        return

    if teams[group]["sid"] != request.sid:
        emit("error_message", {"message": "Bạn không có quyền đổi tên nhóm này!"})
        return

    if teams[group]["confirmed"]:
        emit("error_message", {"message": "Tên đội đã được xác nhận rồi!"})
        return

    teams[group]["team_name"] = team_name or group
    teams[group]["confirmed"] = True

    emit("name_confirmed", {
        "group": group,
        "team_name": teams[group]["team_name"],
        "game_status": game_state["status"],
    })
    broadcast_state()


@socketio.on("disconnect")
def handle_disconnect():
    """Khi client ngắt kết nối, giải phóng nhóm (chỉ trước khi game bắt đầu).

    Từ lúc vòng 1 bắt đầu (kể cả giữa các vòng), mất mạng thoáng qua
    không được làm mất đội.
    """
    sid = request.sid
    btc_sids.discard(sid)
    if game_locked():
        return

    for group in list(teams.keys()):
        if teams[group]["sid"] == sid:
            del teams[group]
            broadcast_state()
            break
