"""Bảng điểm, xếp hạng và ghép cặp vòng 6 (chỉ đọc từ database + trạng thái đội)."""
from .config import ALLOWED_GROUPS
from .models import Score
from .state import teams


def scoreboard(vong):
    """Bảng điểm một vòng: mọi đội đang tham gia, điểm cao xếp trước."""
    rows = {s.group: s.diem for s in Score.query.filter_by(vong=vong).all()}
    board = [
        {"group": g, "team_name": teams[g]["team_name"], "diem": rows.get(g, 0)}
        for g in ALLOWED_GROUPS
        if g in teams
    ]
    board.sort(key=lambda r: -r["diem"])
    return board


def final_board():
    """Xếp hạng chung cuộc: tổng điểm sáu vòng; bằng điểm thì so vòng 6, vòng 5 rồi vòng 4."""
    rows = []
    for g, team in teams.items():
        rounds = {}
        for v in range(1, 7):
            score = Score.query.filter_by(group=g, vong=v).first()
            rounds[v] = score.diem if score else 0
        rows.append({"group": g, "team_name": team["team_name"], "diem": sum(rounds.values()), "rounds": rounds})
    rows.sort(key=lambda r: (-r["diem"], -r["rounds"][6], -r["rounds"][5], -r["rounds"][4]))
    return rows


def v6_order():
    """Thứ tự các đội trước vòng 6: tổng điểm vòng 1–5, hoà thì so vòng 5, 4, 3."""
    def key(g):
        pts = {v: (Score.query.filter_by(group=g, vong=v).first() or Score(diem=0)).diem for v in range(1, 6)}
        return (-sum(pts.values()), -pts[5], -pts[4], -pts[3])
    return sorted(teams, key=key)


def v6_pairings():
    """Ghép cặp vòng 6: [[hạng 2, hạng 1], [hạng 4, hạng 3]]."""
    order = v6_order()
    return [[order[i + 1], order[i]] for i in range(0, len(order) - 1, 2)]
