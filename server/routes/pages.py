"""Các trang HTML: trang đội chơi, trang BTC, màn hình TV, và địa chỉ IP trong mạng LAN."""
import subprocess

from flask import jsonify, render_template

from ..config import DEBUG, ROUND_TIME, VONG1_TIME, VONG2_TIME, VONG3_TIME, VONG4_TIME
from ..extensions import app


# ── Trang cho đội chơi ──────────────────────────────────────────────
@app.route("/")
def index():
    # Toàn bộ luồng chơi (chọn nhóm → đặt tên → chờ → Vòng 1) nằm trong một trang
    return render_template("index.html", vong1_time=VONG1_TIME, vong2_time=VONG2_TIME, vong3_time=VONG3_TIME, vong4_time=VONG4_TIME)


# ── Trang cho BTC ───────────────────────────────────────────────────
@app.route("/btc")
def btc_dashboard():
    return render_template("btc.html", debug=DEBUG, rounds=sorted(ROUND_TIME))


# ── Màn hình trình chiếu ────────────────────────────────────────────
@app.route("/tv")
def tv_display():
    return render_template("tv.html")


# ── Địa chỉ IP trong mạng LAN của máy chủ (để các đội biết đường vào) ──
@app.route("/network-info")
def network_info():
    try:
        result = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", "scope", "global"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True
        )

        ips = []
        for line in result.stdout.splitlines():
            parts = line.split()
            interface = parts[1]
            ip_cidr = parts[3]
            ip = ip_cidr.split("/")[0]

            if interface != "tailscale0" and not ip.startswith("100."):
                ips.append(ip)

        return jsonify({"lan_ips": ips})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
