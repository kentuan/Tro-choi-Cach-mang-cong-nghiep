"""Trạng thái trò chơi lưu trong RAM (mất khi tắt server) và các hàm đọc/xoá trạng thái này.

Các biến dưới đây là dict/set dùng chung cho nhiều module: luôn sửa TẠI CHỖ
(.update, .clear, .add, ...) chứ không gán lại biến, nếu không các module khác sẽ giữ bản cũ.
"""
import threading

from .config import ALLOWED_GROUPS, ROUND_TIME

# Thông tin đội đã tham gia:
# { "Nhóm 1": {"team_name": "...", "sid": "...", "confirmed": False}, ... }
teams = {}
btc_sids = set()

# status:
#   "waiting"   : chưa có vòng nào chạy (trước vòng 1 hoặc giữa các vòng)
#   "countdown" : đang đếm ngược trước khi vào vòng
#   "playing"   : vòng đang diễn ra
# round : số của vòng gần nhất đã bắt đầu (0 = chưa có vòng nào)
# run_id: tăng mỗi khi vòng kết thúc / reset để huỷ các bộ đếm giờ cũ
game_state = {"status": "waiting", "round": 0, "run_id": 0, "round_deadline": 0.0, "countdown_deadline": 0.0}

# BTC manually selects what the projector displays.
tv_control = {"view": "welcome", "round": 1}

# Điểm trên TV chỉ hiện sau khi BTC cho phép, theo từng đội:
# { vong (int) hoặc "total": {"Nhóm 1", ...} } – những đội đã được phép hiện điểm trên TV.
# Tách riêng với revealed_rounds (công bố điểm cho thiết bị của các đội chơi).
tv_revealed = {}

# Các nhóm đã báo hoàn thành vòng hiện tại
finished_groups = set()

# Các vòng mà BTC đã công bố điểm cho đội chơi (mỗi vòng công bố riêng)
revealed_rounds = set()

# Vòng 1–3: các câu/cặp/vị trí đã được tính điểm, dạng (vòng, nhóm, số thứ tự câu, số thứ tự cặp/vị trí)
# – để mỗi mục chỉ tính một lần dù client gửi lặp
awarded_items = set()

# Vòng 1–4: các lần Bỏ qua đã bị trừ điểm, dạng (vòng, nhóm, số thứ tự câu/bảng/thẻ) – mỗi mục chỉ trừ một lần
skipped_items = set()

# Vòng 4: kết quả lần trả lời đầu tiên của mỗi thẻ, dạng {(nhóm, số thứ tự thẻ): đúng/sai}
v4_results = {}

# Vòng 5: trạng thái câu hỏi đang chạy. Các handler socket và tác vụ nền cùng đọc/ghi nên mọi thay đổi
# đi qua v5_lock (chỉ giữ khóa cho thao tác dict ngắn; không gửi tin, không ghi DB, không sleep khi đang giữ).
v5_lock = threading.Lock()
v5 = {
    "questions": [],   # các câu của ván này: {chu_de, cau_hoi, options, dung, trang, giai_thich}
    "q": -1,           # chỉ số câu hiện tại
    "phase": "idle",   # idle | prep | open | answering | reveal
    "span": 1,         # độ dài pha hiện tại (giây), để client vẽ vòng đếm giờ
    "deadline": 0.0,   # hạn chót pha hiện tại (time.monotonic)
    "bets": {},        # {nhóm: mức cược của câu hiện tại}
    "totals": {},      # {nhóm: tổng điểm vòng 5}
    "locked": set(),   # các đội đã trả lời ở câu hiện tại (hết quyền)
    "buzzer": None,    # đội đang giữ chuông
    "attempts": [],    # các lượt trả lời của câu hiện tại
    "winner": None,    # đội trả lời đúng ở câu hiện tại
}

# Vòng 6 chạy hai trận cùng nhịp; mọi thao tác và điểm đều được xác nhận ở server.
v6_lock = threading.Lock()
v6 = {"matches": [], "questions": [], "q": -1, "phase": "idle", "span": 1,
      "deadline": 0.0, "final_revealed": False}


# ── Hàm đọc trạng thái ───────────────────────────────────────────────
def get_team_name(group):
    """Tên đội của một nhóm (chưa có đội thì trả về chính tên nhóm)."""
    return teams.get(group, {}).get("team_name", group)


def game_locked():
    """Đã bắt đầu chơi (kể cả giữa các vòng): không cho vào/ra nhóm nữa."""
    return game_state["status"] != "waiting" or game_state["round"] > 0


def next_round():
    """Vòng tiếp theo BTC có thể bắt đầu, hoặc None."""
    if game_state["status"] != "waiting":
        return None
    nxt = game_state["round"] + 1
    return nxt if nxt in ROUND_TIME else None


def pending_groups():
    """Các nhóm đã vào nhưng chưa xác nhận tên (theo thứ tự nhóm)."""
    return [g for g in ALLOWED_GROUPS if g in teams and not teams[g]["confirmed"]]


# ── Hàm xoá trạng thái ───────────────────────────────────────────────
def reset_v5():
    with v5_lock:
        v5.update(questions=[], q=-1, phase="idle", span=1, deadline=0.0, bets={}, totals={},
                  locked=set(), buzzer=None, attempts=[], winner=None)


def reset_v6():
    v6.update(matches=[], questions=[], q=-1, phase="idle", final_revealed=False)


def reset_round_progress():
    """Xoá tiến độ của vòng đang chơi (đội đã xong, mục đã tính điểm, trạng thái vòng 5...)."""
    finished_groups.clear()
    awarded_items.clear()
    skipped_items.clear()
    v4_results.clear()
    reset_v5()


def reset_game_state():
    """Reset toàn bộ trò chơi trong RAM (đội, vòng, công bố điểm). Điểm trong DB do handler xoá."""
    game_state["status"] = "waiting"
    game_state["round"] = 0
    game_state["round_deadline"] = 0.0
    game_state["countdown_deadline"] = 0.0
    game_state["run_id"] += 1  # huỷ đếm ngược / bộ đếm giờ đang chạy
    teams.clear()
    revealed_rounds.clear()
    tv_revealed.clear()
    reset_round_progress()
    reset_v6()
