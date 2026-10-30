"""Socket dùng chung cho các vòng 1–4: đội báo đã chơi xong vòng, và bấm Bỏ qua (bị trừ điểm)."""
from ..broadcast import broadcast_state, emit_btc_scores
from ..config import ROUND_TIME, SKIP_PENALTIES
from ..data import skip_item_count
from ..extensions import socketio
from ..lifecycle import end_round
from ..scoring import add_round_score, round_stats
from ..state import awarded_items, finished_groups, game_state, skipped_items, teams, v4_results


@socketio.on("round_finished")
def handle_round_finished(data):
    """Đội chơi báo đã chơi xong vòng (hết giờ hoặc trả lời hết câu)."""
    data = data or {}
    group = data.get("group")

    if game_state["status"] != "playing" or group not in teams:
        return
    if group in finished_groups:  # mỗi đội chỉ báo một lần
        return

    finished_groups.add(group)

    # Số liệu gửi riêng cho BTC (nhật ký). Số đúng/sai tính từ dữ liệu trên server cho đáng tin.
    def _int(key, lo, hi):
        try:
            return max(lo, min(hi, int(data.get(key, 0))))
        except (TypeError, ValueError):
            return lo

    correct, wrong = round_stats(game_state["round"], group)
    socketio.emit("btc_round_finish", {
        "round": game_state["round"],
        "group": group,
        "team_name": teams[group]["team_name"],
        "reason": "complete" if data.get("reason") == "complete" else "timeout",
        "correct": correct,
        "wrong": wrong,
        "skipped": _int("skipped", 0, 1000),
        "total": _int("total", 0, 1000),
        "time_left": _int("time_left", 0, ROUND_TIME.get(game_state["round"], 0)),
    }, to="btc")

    if finished_groups.issuperset(teams):
        end_round()  # cả bốn đội đã xong → kết thúc sớm, BTC có thể mở điểm
    else:
        broadcast_state()


@socketio.on("skip_item")
def handle_skip_item(data):
    """Đội bấm Bỏ qua ở vòng 1–4 → trừ SKIP_PENALTIES[vòng] điểm (chỉnh trong .env), có thể làm điểm âm.
    Mỗi mục chỉ trừ một lần. item = số thứ tự gốc trong file dữ liệu: vòng 1 = câu, vòng 2–3 = câu lớn
    (một lần bấm Bỏ qua ở một bảng), vòng 4 = thẻ. Câu/thẻ đã trả lời đúng rồi thì không tính bỏ qua."""
    data = data if isinstance(data, dict) else {}
    group, vong, item = data.get("group", ""), data.get("vong"), data.get("item")

    def is_int(v):
        return isinstance(v, int) and not isinstance(v, bool)

    if not is_int(vong) or vong not in SKIP_PENALTIES or not is_int(item):
        return {"ok": False}
    penalty = SKIP_PENALTIES[vong]
    if penalty <= 0 or game_state["status"] != "playing" or game_state["round"] != vong or group not in teams:
        return {"ok": False}
    try:
        size = skip_item_count(vong)
    except (OSError, ValueError, KeyError):
        return {"ok": False}
    key = (vong, group, item)
    if not (0 <= item < size) or key in skipped_items:
        return {"ok": False}
    if (vong == 1 and (1, group, item, 0) in awarded_items) or (vong == 4 and (group, item) in v4_results):
        return {"ok": False}
    skipped_items.add(key)

    total = add_round_score(vong, group, -penalty)
    emit_btc_scores()
    return {"ok": True, "diem": total}
