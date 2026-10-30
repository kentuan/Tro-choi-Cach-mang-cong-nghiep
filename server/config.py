"""Cấu hình: đọc file .env và khai báo các hằng số (thời gian, điểm, mức cược...).

Module này chỉ đọc cấu hình, không import module nào khác của dự án.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Thư mục gốc của dự án (chứa app.py, templates/, static/, instance/)
BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("SECRET_KEY", "123456789")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///app.db")
DEBUG = os.getenv("DEBUG", "False").lower() == "true"
PORT = int(os.getenv("PORT", "5000"))

# Các nhóm được phép tham gia
ALLOWED_GROUPS = ["Nhóm 1", "Nhóm 2", "Nhóm 4", "Nhóm 5"]

# ── Cấu hình thời gian ─────────────────────────────────────────────

VONG1_TIME = int(os.getenv("VONG1_TIME", "90"))
VONG2_TIME = int(os.getenv("VONG2_TIME", "180"))
VONG3_TIME = int(os.getenv("VONG3_TIME", "120"))
VONG4_TIME = int(os.getenv("VONG4_TIME", "120"))
# Vòng 5 do server điều khiển từng câu; số này chỉ là giới hạn an toàn cho cả vòng
VONG5_TIME = int(os.getenv("VONG5_TIME", "600"))
# Đếm ngược trước khi mỗi vòng bắt đầu (giây) – đặt COUNTDOWN_TIME trong file .env
COUNTDOWN_TIME = max(0, int(os.getenv("COUNTDOWN_TIME", "3")))
# Thời gian chờ thêm sau khi hết giờ, đề phòng đội mất mạng không báo "đã xong"
ROUND_GRACE = 5

# ── Điểm số vòng 1–4 ───────────────────────────────────────────────

POINTS_PER_CORRECT = int(os.getenv("VONG1_POINTS", "5"))  # Vòng 1: điểm mỗi câu đúng (39 câu nên để thấp)
# Điểm trừ mỗi lần bấm Bỏ qua ở vòng 1–4 (chỉnh trong .env). SKIP_PENALTY áp dụng chung; muốn riêng từng vòng
# thì đặt thêm SKIP_PENALTY_VONG1 … SKIP_PENALTY_VONG4. Đặt 0 để tắt trừ điểm.
SKIP_PENALTY = int(os.getenv("SKIP_PENALTY", "5"))
SKIP_PENALTIES = {v: int(os.getenv(f"SKIP_PENALTY_VONG{v}", SKIP_PENALTY)) for v in (1, 2, 3, 4)}
POINTS_PER_PAIR = 10     # Vòng 2: điểm mỗi cặp ghép đúng
POINTS_PER_SLOT = 10     # Vòng 3: điểm mỗi vị trí xếp đúng trên dòng thời gian
POINTS_V4_RIGHT = 10     # Vòng 4: điểm mỗi thẻ phân loại đúng
POINTS_V4_WRONG = 5      # Vòng 4: điểm trừ mỗi thẻ phân loại sai (tổng điểm vòng có thể âm)

# ── Vòng 5 (nhanh tay & cược điểm): số câu mỗi ván, mức cược, thời lượng từng pha (giây) ──

V5_QUESTIONS = int(os.getenv("V5_QUESTIONS", "7"))
V5_BETS = (10, 20, 30)
V5_DEFAULT_BET = V5_BETS[0]
V5_BET_SECONDS = int(os.getenv("V5_BET_SECONDS", "5"))
V5_OPEN_SECONDS = int(os.getenv("V5_OPEN_SECONDS", "10"))
V5_REOPEN_SECONDS = 8    # mở lại chuông sau khi một đội trả lời sai
V5_ANSWER_SECONDS = int(os.getenv("V5_ANSWER_SECONDS", "8"))
V5_REVEAL_SECONDS = int(os.getenv("V5_REVEAL_SECONDS", "4"))

# ── Vòng 6 (poker kiến thức) ──

V6_QUESTIONS = int(os.getenv("V6_QUESTIONS", "5"))
V6_TIME = int(os.getenv("V6_TIME", "360"))
V6_BETS = (10, 20, 30, 50)
V6_RULES_SECONDS = int(os.getenv("V6_RULES_SECONDS", "30"))
V6_OPEN_SECONDS = int(os.getenv("V6_OPEN_SECONDS", "8"))
V6_DECIDE_SECONDS = int(os.getenv("V6_DECIDE_SECONDS", "8"))
V6_CALL_SECONDS = int(os.getenv("V6_CALL_SECONDS", "6"))
V6_ANSWER_SECONDS = int(os.getenv("V6_ANSWER_SECONDS", "15"))
V6_REVEAL_SECONDS = int(os.getenv("V6_REVEAL_SECONDS", "4"))

# Thời lượng từng vòng. Vòng nào có trong dict này thì BTC mới bắt đầu được.
# Thêm vòng mới: thêm vào đây, rồi thêm giao diện chơi tương ứng ở client.
ROUND_TIME = {1: VONG1_TIME, 2: VONG2_TIME, 3: VONG3_TIME, 4: VONG4_TIME, 5: VONG5_TIME, 6: V6_TIME}
