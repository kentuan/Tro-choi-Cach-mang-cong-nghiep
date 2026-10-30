"""Xuất kết quả ra file Excel cho BTC."""
import io
from datetime import datetime

from flask import jsonify, send_file

from ..excel_export import build_workbook, summarize
from ..extensions import app
from ..models import Score
from ..state import teams


@app.route("/btc/export.xlsx")
def btc_export_excel():
    """BTC tải kết quả (điểm từng vòng + xếp hạng + chi tiết) dưới dạng Excel. Dùng được bất kỳ lúc nào."""
    raw = [(s.id, s.group, s.team_name, s.vong, s.diem) for s in Score.query.order_by(Score.id).all()]
    if not raw:
        return jsonify({"error": "Chưa có điểm nào để xuất."}), 404
    board = summarize(raw, {g: t["team_name"] for g, t in teams.items()})
    try:
        workbook = build_workbook(raw, board)
    except ImportError:
        return jsonify({"error": "Server thiếu thư viện openpyxl. Chạy: pip install openpyxl"}), 500
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer, as_attachment=True, download_name=f"ket_qua_{datetime.now():%Y%m%d_%H%M%S}.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", max_age=0,
    )
