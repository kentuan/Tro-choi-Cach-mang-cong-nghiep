"""Vòng 6 – Poker kiến thức: hai trận đối đầu chạy song song; mọi thao tác và điểm đều xác nhận ở server.

Các handler socket nằm ở server/sockets/vong6.py; file này chỉ chứa logic trò chơi.
"""
import random
import time

from ..broadcast import emit_btc_scores
from ..config import (
    V6_ANSWER_SECONDS,
    V6_BETS,
    V6_CALL_SECONDS,
    V6_DECIDE_SECONDS,
    V6_OPEN_SECONDS,
    V6_QUESTIONS,
    V6_REVEAL_SECONDS,
    V6_RULES_SECONDS,
)
from ..data import load_json
from ..extensions import db, socketio
from ..lifecycle import end_round
from ..models import Score
from ..ranking import v6_order, v6_pairings
from ..state import game_state, get_team_name, v6, v6_lock


# ── Câu hỏi và bộ đáp án riêng của từng đội ─────────────────────────
def _load_questions():
    pool = load_json("vong_6.json")
    normal = [item for item in pool if item.get("kind") not in ("final", "tiebreak")]
    final = [item for item in pool if item.get("kind") == "final"]
    tie = [item for item in pool if item.get("kind") == "tiebreak"]
    picked = random.sample(normal, min(V6_QUESTIONS, len(normal))) + final[:1] + tie[:1]
    out = []
    for item in picked:
        correct = item["lua_chon"][item["dung"]]
        # Đáp án sai gốc + đáp án sai bổ sung (không bắt buộc): mỗi đội sẽ được rút bộ riêng
        wrong_pool = list(dict.fromkeys(w for w in item["lua_chon"] + item.get("lua_chon_sai", []) if w != correct))
        out.append({"chu_de": item["chu_de"], "cau_hoi": item["cau_hoi"],
                    "correct": correct, "wrong_pool": wrong_pool, "n_options": len(item["lua_chon"]),
                    "options": list(item["lua_chon"]), "dung": item["dung"],
                    "trang": item.get("trang"), "giai_thich": item.get("giai_thich", ""),
                    "kind": item.get("kind", "normal")})
    return out


def _variant(question, avoid=None):
    """Bộ đáp án riêng của một đội: cùng câu hỏi và đáp án đúng, nhưng thứ tự và các đáp án sai khác nhau."""
    wrong_count = min(question["n_options"] - 1, len(question["wrong_pool"]))
    for _ in range(10):
        options = [question["correct"]] + random.sample(question["wrong_pool"], wrong_count)
        random.shuffle(options)
        if options != avoid:
            break
    return {"options": options, "dung": options.index(question["correct"])}


def _make_variants(match, question):
    """Mỗi đội trong trận một bộ đáp án; cố gắng không trùng với đội kia."""
    a, b = match["groups"]
    va = _variant(question)
    return {a: va, b: _variant(question, avoid=va["options"])}


def _is_correct(match, group):
    variant = match.get("variants", {}).get(group)
    answer = match["answers"].get(group)
    return answer is not None and variant is not None and answer == variant["dung"]


# ── Gửi trạng thái cho client ───────────────────────────────────────
def snapshot(group=None):
    with v6_lock:
        q, phase = v6["q"], v6["phase"]
        result = {"q": q + 1, "total": max(V6_QUESTIONS + 1, q + 1), "phase": phase,
                  "seconds": max(0, v6["deadline"] - time.monotonic()), "span": v6["span"], "matches": []}
        question = v6["questions"][q] if 0 <= q < len(v6["questions"]) else None
        for m in v6["matches"]:
            row = {"groups": m["groups"], "names": [get_team_name(g) for g in m["groups"]],
                   "scores": dict(m["scores"]), "opener": m["opener"], "bet": m["bet"],
                   "choice": m["choice"], "call": m.get("call"), "answered": len(m["answers"]), "winner": m.get("winner"),
                   "folded": m.get("folded"), "tie": m.get("tie", False), "tiebreak_skip": m.get("tiebreak_skip", False)}
            if question:
                row["chu_de"] = question["chu_de"]
                if phase in ("answer", "reveal"):
                    row["cau_hoi"] = question["cau_hoi"]
                if phase == "reveal":
                    row.update(dap_an=question["correct"], trang=question["trang"], giai_thich=question["giai_thich"],
                               answers=dict(m["answers"]),
                               # kết quả từng đội tính theo bộ đáp án riêng của đội đó
                               results={g: (None if m["answers"].get(g) is None else _is_correct(m, g)) for g in m["groups"]})
            result["matches"].append(row)
        if group:
            result["mine"] = next((i for i, m in enumerate(v6["matches"]) if group in m["groups"]), None)
            result["group"] = group
            result["bets"] = [20, 40, 60, 100] if q == V6_QUESTIONS else list(V6_BETS)
            if result["mine"] is not None and phase == "answer":
                mine = v6["matches"][result["mine"]]
                answers = mine["answers"]
                result["options"] = list(mine["variants"][group]["options"])
                result["my_answered"] = group in answers
                result["my_choice"] = answers.get(group)  # để client đánh dấu đáp án đã chọn
        return result


def broadcast():
    for m in v6["matches"]:
        for g in m["groups"]:
            socketio.emit("v6_state", snapshot(g), to="grp:" + g)
    socketio.emit("v6_state", snapshot(), to="btc")


def set_phase(phase, seconds):
    with v6_lock:
        v6["phase"] = phase
        v6["span"] = seconds
        v6["deadline"] = time.monotonic() + seconds


# ── Thao tác của đội (được socket handler gọi) ──────────────────────
def apply_action(group, action, data):
    """Áp dụng một thao tác (cược / theo / tố / bỏ / trả lời) của đội cho pha hiện tại.
    Trả về True nếu hợp lệ; handler sẽ phát trạng thái mới sau đó."""
    with v6_lock:
        m = next((m for m in v6["matches"] if group in m["groups"]), None)
        if not m:
            return False
        phase = v6["phase"]
        if phase == "bet" and group == m["opener"]:
            bet = data.get("bet")
            allowed = (20, 40, 60) if v6["q"] == V6_QUESTIONS else V6_BETS[:3]
            if not isinstance(bet, int) or isinstance(bet, bool) or bet not in allowed:
                return False
            m["bet"] = bet
        elif phase == "decide" and group != m["opener"] and action in ("follow", "raise", "fold"):
            # Luôn tính từ mức cược gốc của đội mở: bấm Tố nhiều lần hay đổi ý không làm mức cược leo thêm
            base = m.get("base_bet") or m["bet"]
            m["base_bet"] = base
            m["bet"] = base
            if action == "raise":
                ladder = (20, 40, 60, 100) if v6["q"] == V6_QUESTIONS else V6_BETS
                idx = ladder.index(base)
                if idx + 1 >= len(ladder):
                    action = "follow"
                else:
                    m["bet"] = ladder[idx + 1]
            m["choice"] = action
            m["call"] = "fold" if action == "fold" else None
        elif phase == "call" and group == m["opener"] and m["choice"] == "raise" and action in ("follow", "fold"):
            m["call"] = "fold" if action == "fold" else "follow"
        elif phase == "answer" and action == "answer":
            choice = data.get("choice")
            if not isinstance(choice, int) or isinstance(choice, bool):
                return False
            if not 0 <= choice < len(m["variants"][group]["options"]):
                return False
            if group in m["answers"]:
                return False
            m["answers"][group] = choice
            m["speed"][group] = time.monotonic()
        else:
            return False
    return True


# ── Chấm điểm một câu ───────────────────────────────────────────────
def _award(group, delta):
    score = Score.query.filter_by(group=group, vong=6).first()
    if score is None:
        score = Score(group=group, team_name=get_team_name(group), vong=6, diem=0)
        db.session.add(score)
    score.diem += delta
    db.session.commit()
    emit_btc_scores()


def resolve():
    """Tính điểm chênh lệch trong từng trận cho câu hiện tại rồi ghi phần thay đổi vào database."""
    for m in v6["matches"]:
        if m.get("tiebreak_skip"):
            continue
        a, b = m["groups"]
        if m.get("choice") == "fold" or m.get("call") == "fold":
            # Có đội bỏ: đội bỏ −10, đối thủ +10. Đội trả lời bỏ → đội mở thắng; đội mở bỏ sau khi bị tố → đội trả lời thắng
            if m.get("choice") == "fold":
                winner = m["opener"]
            else:
                winner = b if m["opener"] == a else a
            loser = b if winner == a else a
            m["scores"][winner] += 10
            m["scores"][loser] -= 10
            m["winner"] = winner
            continue
        correct = {g: _is_correct(m, g) for g in (a, b)}
        stake = m["bet"]
        if correct[a] and not correct[b]:
            m["scores"][a] += stake
            m["scores"][b] -= stake
        elif correct[b] and not correct[a]:
            m["scores"][b] += stake
            m["scores"][a] -= stake
        elif correct[a] and correct[b]:
            speed = m.get("speed", {})
            if speed:
                fastest = min(speed, key=speed.get)
                m["scores"][fastest] += 5
        m["winner"] = a if correct[a] and not correct[b] else b if correct[b] and not correct[a] else None
    for m in v6["matches"]:
        for g, delta in m["scores"].items():
            # scores are cumulative; persist only this question's difference via per-question ledger
            prev = m.setdefault("persisted", {}).get(g, 0)
            _award(g, delta - prev)
            m["persisted"][g] = delta


# ── Vòng lặp chạy nền ───────────────────────────────────────────────
def _run_phase(phase, seconds):
    set_phase(phase, seconds)
    broadcast()
    socketio.sleep(seconds)


def run_v6(run_id, hard_deadline):
    """Chạy nền toàn bộ vòng 6 (gọi trong app context). Kết thúc vòng bằng end_round()."""
    questions = _load_questions()
    with v6_lock:
        v6.update(questions=questions, q=-1, phase="idle", final_revealed=False, span=1, deadline=0)
        v6["matches"] = [{"groups": pair, "scores": {g: 0 for g in pair}, "opener": pair[0], "bet": 10,
                           "choice": None, "answers": {}, "speed": {}, "persisted": {g: 0 for g in pair}}
                          for pair in v6_pairings()]
    _run_phase("rules", V6_RULES_SECONDS)
    for qi in range(min(V6_QUESTIONS + 1, len(questions))):
        with v6_lock:
            v6["q"] = qi
            for m in v6["matches"]:
                m.update(choice=None, answers={}, speed={}, call=None, folded=None, winner=None, tie=False, base_bet=None,
                         variants=_make_variants(m, v6["questions"][qi]))
                if qi == V6_QUESTIONS:
                    a, b = m["groups"]
                    m["opener"] = min((a, b), key=lambda g: (m["scores"][g], -v6_order().index(g)))
                    m["bet"] = 20
                else:
                    m["opener"] = m["groups"][qi % 2] if qi else m["groups"][0]
                    m["bet"] = 10
        _run_phase("bet", V6_OPEN_SECONDS)
        _run_phase("decide", V6_DECIDE_SECONDS)
        with v6_lock:
            needs_call = any(m.get("choice") == "raise" for m in v6["matches"])
        if needs_call:
            _run_phase("call", V6_CALL_SECONDS)
        with v6_lock:
            needs_answer = any(m.get("choice") != "fold" and m.get("call") != "fold" for m in v6["matches"])
        if needs_answer:
            _run_phase("answer", V6_ANSWER_SECONDS)
        resolve()
        _run_phase("reveal", V6_REVEAL_SECONDS)
        if game_state["run_id"] != run_id or time.monotonic() >= hard_deadline:
            return
    ties = [m for m in v6["matches"] if m["scores"][m["groups"][0]] == m["scores"][m["groups"][1]]]
    if ties and len(questions) > V6_QUESTIONS + 1:
        with v6_lock:
            v6["q"] = V6_QUESTIONS + 1
            for m in v6["matches"]:
                m.update(choice="follow", call="follow", bet=20, answers={}, speed={}, tiebreak_skip=m not in ties)
        _run_phase("answer", V6_ANSWER_SECONDS)
        resolve()
        _run_phase("reveal", V6_REVEAL_SECONDS)
    end_round()
