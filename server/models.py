"""Các bảng trong database."""
from .extensions import db


class Score(db.Model):
    __tablename__ = "scores"
    id = db.Column(db.Integer, primary_key=True)
    group = db.Column(db.String(30), nullable=False)
    team_name = db.Column(db.String(30), nullable=False)
    vong = db.Column(db.Integer, nullable=False, default=1)
    diem = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "group": self.group,
            "team_name": self.team_name,
            "vong": self.vong,
            "diem": self.diem,
        }
