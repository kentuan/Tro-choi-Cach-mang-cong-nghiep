"""Vòng 5 – Nhanh tay & cược điểm: server điều khiển từng câu (cược → bấm chuông → trả lời → hiện đáp án).

Các handler socket nằm ở server/sockets/vong5.py; file này chỉ chứa logic trò chơi.
"""
import random
import time

from ..broadcast import emit_btc_scores
from ..config import (
    V5_ANSWER_SECONDS,
    V5_BET_SECONDS,
    V5_BETS,
    V5_DEFAULT_BET,
    V5_OPEN_SECONDS,
    V5_QUESTIONS,
    V5_REOPEN_SECONDS,
    V5_REVEAL_SECONDS,
)
from ..data import load_json
from ..extensions import app, db, socketio
from ..models import Score
from ..state import game_state, get_team_name, teams, v5, v5_lock


def set_phase(phase, span):
    """Đổi pha và đặt hạn chót. Gọi khi ĐANG giữ v5_lock."""
    v5["phase"] = phase
    v5["span"] = span
    v5["deadline"] = time.monotonic() + span


def _load_questions():
    """Chọn ngẫu nhiên V5_QUESTIONS câu từ vong_5.json; xáo thứ tự đáp án (trừ câu Đúng/Sai)."""
    pool = load_json("vong_5.json")
    questions = []
    for item in random.sample(pool, min(V5_QUESTIONS, len(pool))):
        order = list(range(len(item["lua_chon"])))
        if len(order) > 2:
            random.shuffle(order)
        questions.append({
            "chu_de": item["chu_de"],
            "cau_hoi": item["cau_hoi"],
            "options": [item["lua_chon"][i] for i in order],
            "dung": order.index(item["dung"]),
            "trang": item.get("trang"),
            "giai_thich": item.get("giai_thich", ""),
        })
    return questions


def snapshot(group=None):
    """Trạng thái vòng 5 để gửi cho client. Truyền group để thêm phần riêng của đội đó:
    mức cược, điểm, và các lựa chọn nếu đội đó đang giữ chuông. Nội dung câu hỏi chỉ có từ pha 'open'."""
    with v5_lock:
        q = v5["q"]
        total = len(v5["questions"])
        snap = {
            "phase": v5["phase"],
            "q": q + 1 if q >= 0 else 0,
            "total": total,
            "seconds": max(0.0, v5["deadline"] - time.monotonic()),
            "span": v5["span"],
            "locked": sorted(v5["locked"]),
            "attempts": [dict(x) for x in v5["attempts"]],
        }
        cur = v5["questions"][q] if 0 <= q < total else None
        buzzer, winner = v5["buzzer"], v5["winner"]
        bet = v5["bets"].get(group, V5_DEFAULT_BET) if group else None
        diem = v5["totals"].get(group, 0) if group else None

    if cur:
        snap["chu_de"] = cur["chu_de"]
        if snap["phase"] == "prep":
            snap["bets"] = list(V5_BETS)
        else:
            snap["cau_hoi"] = cur["cau_hoi"]
        if buzzer:
            snap["buzzer"] = {"group": buzzer, "team_name": get_team_name(buzzer)}
        if snap["phase"] == "reveal":
            snap["dap_an"] = cur["options"][cur["dung"]]
            snap["trang"] = cur["trang"]
            snap["giai_thich"] = cur["giai_thich"]
            if winner:
                snap["winner"] = {"group": winner, "team_name": get_team_name(winner)}
        if group and snap["phase"] == "answering" and buzzer == group:
            snap["options"] = list(cur["options"])
    if group:
        snap["bet"] = bet
        snap["diem"] = diem
    return snap


def broadcast():
    socketio.emit("v5_state", snapshot())


def _add_score(group, delta):
    """Cộng/trừ thẳng vào điểm vòng 5 hiện có (có thể âm). Trả về tổng mới."""
    with app.app_context():
        score = Score.query.filter_by(group=group, vong=5).first()
        if score:
            score.diem += delta
            score.team_name = get_team_name(group)
        else:
            score = Score(group=group, team_name=get_team_name(group), vong=5, diem=delta)
            db.session.add(score)
        db.session.commit()
        total = score.diem
        emit_btc_scores()
    with v5_lock:
        v5["totals"][group] = total
    return total


def _to_reveal(winner):
    """Chuyển sang hiện đáp án. Trả True nếu vừa chuyển (False nếu đã ở pha này rồi)."""
    with v5_lock:
        if v5["phase"] == "reveal":
            return False
        v5["winner"] = winner
        set_phase("reveal", V5_REVEAL_SECONDS)
    return True


# ── Hành động của đội (được socket handler gọi) ─────────────────────
def place_bet(group, bet):
    """Chọn mức cược cho câu hiện tại (chỉ nhận trong pha cược)."""
    with v5_lock:
        if v5["phase"] != "prep":
            return {"ok": False, "bet": v5["bets"].get(group, V5_DEFAULT_BET)}
        v5["bets"][group] = bet
    return {"ok": True, "bet": bet}


def buzz(group):
    """Bấm chuông. Đội đến trước (đổi pha 'open' → 'answering' dưới khóa) được giữ chuông và nhận các lựa chọn."""
    with v5_lock:
        if v5["phase"] != "open" or group in v5["locked"]:
            return {"ok": False}
        v5["buzzer"] = group
        set_phase("answering", V5_ANSWER_SECONDS)
        options = list(v5["questions"][v5["q"]]["options"])
    broadcast()
    return {"ok": True, "options": options}


def submit_answer(group, choice):
    """Đội đang giữ chuông gửi đáp án (chỉ số trong danh sách lựa chọn đã nhận)."""
    with v5_lock:
        q = v5["q"]
        n_options = len(v5["questions"][q]["options"]) if 0 <= q < len(v5["questions"]) else 0
    if not (0 <= choice < n_options):
        return {"ok": False}
    return {"ok": resolve_answer(group, choice)}


def resolve_answer(group, choice):
    """Chấm câu trả lời của đội đang giữ chuông (choice=None: hết giờ, tính là sai).
    Đúng: kết thúc câu. Sai: đội đó mất quyền, mở lại chuông cho các đội còn lại (hết đội thì hiện đáp án).
    Trả về False nếu không còn hợp lệ (đã có luồng khác xử lý trước)."""
    with v5_lock:
        if v5["phase"] != "answering" or v5["buzzer"] != group:
            return False
        cur = v5["questions"][v5["q"]]
        correct = choice is not None and choice == cur["dung"]
        bet = v5["bets"].get(group, V5_DEFAULT_BET)
        delta = bet if correct else -bet
        qn, total = v5["q"] + 1, len(v5["questions"])
        v5["attempts"].append({"group": group, "team_name": get_team_name(group), "correct": correct})
        v5["locked"].add(group)
        v5["buzzer"] = None
        if correct:
            v5["winner"] = group
            set_phase("reveal", V5_REVEAL_SECONDS)
        elif v5["locked"] >= set(teams):
            set_phase("reveal", V5_REVEAL_SECONDS)
        else:
            set_phase("open", V5_REOPEN_SECONDS)

    diem = _add_score(group, delta)
    broadcast()
    # Kết quả riêng gửi vào phòng của đội (các đội khác không thấy điểm); BTC thấy nhật ký
    socketio.emit("v5_result", {"q": qn, "correct": correct, "delta": delta, "diem": diem,
                                "timeout": choice is None}, to="grp:" + group)
    socketio.emit("btc_v5", {"q": qn, "total": total, "group": group, "team_name": get_team_name(group),
                             "correct": correct, "delta": delta, "bet": bet, "timeout": choice is None}, to="btc")
    return True


# ── Vòng lặp chạy nền ───────────────────────────────────────────────
def _alive(run_id, hard_deadline):
    return (game_state["run_id"] == run_id and game_state["status"] == "playing"
            and time.monotonic() < hard_deadline)


def _sleep_until(run_id, hard_deadline, until):
    """Ngủ (nhịp 0.1s) tới mốc `until`. Trả False nếu vòng đã bị huỷ/reset hoặc quá giới hạn thời gian."""
    while time.monotonic() < until:
        if not _alive(run_id, hard_deadline):
            return False
        socketio.sleep(0.1)
    return _alive(run_id, hard_deadline)


def run_quiz(run_id, hard_deadline):
    """Chạy nền: lần lượt từng câu (cược → bấm chuông/trả lời → hiện đáp án). Hết câu thì trả về,
    run_round sẽ kết thúc vòng bằng end_round như các vòng khác."""
    questions = _load_questions()
    with v5_lock:
        v5.update(questions=questions, q=-1, phase="idle", bets={}, locked=set(),
                  buzzer=None, attempts=[], winner=None)

    for qi in range(len(questions)):
        # 1) cược
        with v5_lock:
            v5.update(q=qi, bets={}, locked=set(), buzzer=None, attempts=[], winner=None)
            set_phase("prep", V5_BET_SECONDS)
            until = v5["deadline"]
        broadcast()
        if not _sleep_until(run_id, hard_deadline, until):
            return

        # 2) mở chuông
        with v5_lock:
            set_phase("open", V5_OPEN_SECONDS)
        broadcast()

        # 3) chờ chuông / câu trả lời / hết giờ cho tới khi sang pha hiện đáp án
        while True:
            if not _sleep_until(run_id, hard_deadline, time.monotonic() + 0.1):
                return
            with v5_lock:
                phase, deadline, buzzer = v5["phase"], v5["deadline"], v5["buzzer"]
            if phase == "reveal":
                break
            if time.monotonic() >= deadline:
                if phase == "open":
                    if _to_reveal(None):  # không đội nào bấm / mọi đội còn lại không bấm kịp
                        broadcast()
                elif phase == "answering":
                    resolve_answer(buzzer, None)  # đội giữ chuông hết giờ = sai

        # 4) hiện đáp án
        with v5_lock:
            until = v5["deadline"]
        if not _sleep_until(run_id, hard_deadline, until):
            return
