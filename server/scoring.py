"""Ghi điểm vào database (vòng 1–4) và thống kê đúng/sai của một đội."""
from .extensions import db
from .models import Score
from .state import awarded_items, teams, v4_results


def round_stats(vong, group):
    """(số đúng, số sai) của một đội ở vòng đang chơi – tính từ dữ liệu server, không tin số client báo."""
    if vong == 4:
        mine = [ok for (g, _), ok in v4_results.items() if g == group]
        return sum(mine), len(mine) - sum(mine)
    return sum(1 for k in awarded_items if k[0] == vong and k[1] == group), 0


def add_round_score(vong, group, delta):
    """Cộng/trừ thẳng vào điểm hiện có của đội ở vòng `vong` (có thể âm). Trả về tổng mới."""
    team_name = teams[group]["team_name"]
    score = Score.query.filter_by(group=group, vong=vong).first()
    if score:
        score.diem += delta
        score.team_name = team_name
    else:
        score = Score(group=group, team_name=team_name, vong=vong, diem=delta)
        db.session.add(score)
    db.session.commit()
    return score.diem
