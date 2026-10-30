"""Socket cộng điểm cho vòng 1–4 (các vòng client tự chạy, server chỉ chấm và ghi điểm).

Điểm luôn do server quyết định; mỗi mục (câu / cặp / vị trí / thẻ) chỉ được tính một lần cho mỗi đội.
"""
from ..broadcast import emit_btc_scores
from ..config import POINTS_PER_CORRECT, POINTS_PER_PAIR, POINTS_PER_SLOT, POINTS_V4_RIGHT, POINTS_V4_WRONG
from ..data import load_json, skip_item_count
from ..extensions import socketio
from ..scoring import add_round_score
from ..state import awarded_items, game_state, skipped_items, teams, v4_results


# ── Vòng 1: mỗi câu đúng ────────────────────────────────────────────
@socketio.on("vong1_correct")
def handle_vong1_correct(data):
    """Đội chơi trả lời đúng 1 câu trong vòng 1 → cộng điểm. Mỗi câu chỉ tính một lần cho mỗi đội.
    Client gửi {group, idx}: idx là số thứ tự gốc của câu trong vong_1.json."""
    data = data if isinstance(data, dict) else {}
    group, idx = data.get("group", ""), data.get("idx")

    # Chỉ nhận điểm khi vòng 1 đang diễn ra; điểm do server quyết định
    if game_state["status"] != "playing" or game_state["round"] != 1:
        return
    if group not in teams:
        return
    if not isinstance(idx, int) or isinstance(idx, bool):
        return
    try:
        size = skip_item_count(1)
    except (OSError, ValueError):
        return
    key = (1, group, idx, 0)
    if not (0 <= idx < size) or key in awarded_items or (1, group, idx) in skipped_items:
        return
    awarded_items.add(key)

    add_round_score(1, group, POINTS_PER_CORRECT)

    # Điểm trực tiếp chỉ BTC thấy; đội chơi chỉ thấy sau khi BTC công bố
    emit_btc_scores()


# ── Vòng 2 và 3: cộng điểm theo cặp / vị trí ────────────────────────
def _award_items(vong, filename, items_key, points, data):
    """Đội chơi vừa xếp đúng một hoặc nhiều mục (cặp ở vòng 2, vị trí ở vòng 3) → cộng điểm.
    Client gửi {group, board, pairs: [chỉ số...]}; mỗi mục chỉ tính một lần, điểm do server quyết định."""
    data = data or {}
    group = data.get("group", "")
    board = data.get("board")
    items = data.get("pairs")

    if game_state["status"] != "playing" or game_state["round"] != vong:
        return
    if group not in teams:
        return
    if not isinstance(board, int) or isinstance(board, bool) or not isinstance(items, list):
        return

    try:
        boards = load_json(filename)
    except (OSError, ValueError):
        return
    if not (0 <= board < len(boards)):
        return

    size = len(boards[board].get(items_key, []))
    new_items = {
        p for p in items
        if isinstance(p, int) and not isinstance(p, bool)
        and 0 <= p < size and (vong, group, board, p) not in awarded_items
    }
    if not new_items:
        return
    awarded_items.update((vong, group, board, p) for p in new_items)

    add_round_score(vong, group, len(new_items) * points)

    emit_btc_scores()


@socketio.on("vong2_correct")
def handle_vong2_correct(data):
    _award_items(2, "vong_2.json", "cap", POINTS_PER_PAIR, data)


@socketio.on("vong3_correct")
def handle_vong3_correct(data):
    _award_items(3, "vong_3.json", "su_kien", POINTS_PER_SLOT, data)


# ── Vòng 4: phân loại thẻ (đúng +, sai −) ───────────────────────────
@socketio.on("vong4_answer")
def handle_vong4_answer(data):
    """Đội chơi trả lời một thẻ ở vòng 4. Server tự chấm theo đáp án trong vong_4.json
    và chỉ tính lần trả lời đầu tiên của mỗi thẻ: đúng cộng điểm, sai trừ điểm (tổng điểm vòng có thể âm)."""
    data = data or {}
    group = data.get("group", "")
    card = data.get("card")
    chosen = data.get("bin")

    if game_state["status"] != "playing" or game_state["round"] != 4:
        return
    if group not in teams:
        return
    if any(not isinstance(v, int) or isinstance(v, bool) for v in (card, chosen)):
        return
    if (group, card) in v4_results or (4, group, card) in skipped_items:
        return

    try:
        file = load_json("vong_4.json")
        cards, n_bins = file["the"], len(file["ten_lop"])
    except (OSError, ValueError, KeyError):
        return
    if not (0 <= card < len(cards) and 0 <= chosen < n_bins):
        return

    right = cards[card]["lop"] == chosen
    v4_results[(group, card)] = right
    delta = POINTS_V4_RIGHT if right else -POINTS_V4_WRONG

    # Cộng/trừ thẳng vào điểm hiện tại, kể cả khi đang âm (ví dụ -20 + 10 = -10)
    total = add_round_score(4, group, delta)

    emit_btc_scores()
    return {"diem": total}  # ack cho client: tổng điểm vòng 4 sau khi tính
