/**
 * Lobby – phần giao diện dùng chung cho trang đội chơi và trang BTC
 * ─────────────────────────────────────────────────────────
 *   Lobby.summarize(data)               gom số liệu từ state_update
 *   Lobby.renderTeams(data, mine?)      badge trạng thái, đếm đội, 4 thẻ đội
 *   Lobby.renderScoreboards(el, data, mine?)   bảng điểm các vòng đã được BTC công bố
 *   Lobby.renderRows(rows, mine?)       danh sách xếp hạng (BTC dùng lại)
 *   Lobby.el(tag, cls?, text?)          tạo phần tử (luôn dùng textContent, tránh XSS từ tên đội)
 */
const Lobby = (() => {
    const GROUPS = {
        "Nhóm 1": "nhom-1",
        "Nhóm 2": "nhom-2",
        "Nhóm 4": "nhom-4",
        "Nhóm 5": "nhom-5",
    };

    const $ = (id) => document.getElementById(id);

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function summarize(data) {
        const teams = data.teams || {};
        const confirmed = data.confirmed || {};
        const joined = Object.keys(teams);
        const pending = joined.filter((g) => !confirmed[g]);
        return {
            teams,
            confirmed,
            joined,
            pending,
            status: data.game_status,
            round: data.round || 0,
            finished: new Set(data.finished || []),
            allConfirmed: joined.length > 0 && pending.length === 0,
        };
    }

    function renderBadge(s) {
        let kind, text;
        if (s.status === "countdown") {
            kind = "started";
            text = `⏱️ Vòng ${s.round} sắp bắt đầu`;
        } else if (s.status === "playing") {
            kind = "started";
            text = `🟢 Vòng ${s.round} đang diễn ra`;
        } else if (s.round > 0) {
            kind = "ready";
            text = `✅ Vòng ${s.round} đã kết thúc`;
        } else if (s.allConfirmed) {
            kind = "ready";
            text = "✅ Tất cả đội đã sẵn sàng";
        } else if (s.pending.length > 0) {
            kind = "waiting";
            text = "⏳ Đang chờ các đội xác nhận tên";
        } else {
            kind = "waiting";
            text = "⏳ Đang chờ các đội tham gia";
        }
        const badge = $("status-badge");
        badge.className = "status-badge status-" + kind;
        badge.textContent = text;
    }

    function renderTeams(data, mine) {
        const s = summarize(data);
        renderBadge(s);
        $("team-count").textContent = s.joined.length;

        for (const [group, slug] of Object.entries(GROUPS)) {
            const card = $("card-" + slug);
            const nameEl = $("name-" + slug);
            const chip = $("chip-" + slug);

            card.classList.remove("typing", "confirmed");
            card.classList.toggle("mine", group === mine);
            chip.className = "chip";

            if (!s.teams[group]) {
                nameEl.textContent = "Chưa có đội";
                nameEl.className = "team-name empty";
                chip.textContent = "Chưa vào";
            } else if (!s.confirmed[group]) {
                card.classList.add("typing");
                nameEl.textContent = s.teams[group];
                nameEl.className = "team-name";
                chip.classList.add("warn");
                chip.textContent = "Đang nhập tên";
            } else {
                card.classList.add("confirmed");
                nameEl.textContent = s.teams[group];
                nameEl.className = "team-name";
                if (s.status === "playing") {
                    const done = s.finished.has(group);
                    chip.classList.add(done ? "ok" : "warn");
                    chip.textContent = done ? "Đã hoàn thành" : "Đang chơi";
                } else {
                    chip.classList.add("ok");
                    chip.textContent = s.status === "countdown" || s.round > 0 ? "Sẵn sàng" : "Đã xác nhận";
                }
            }
        }
        return s;
    }

    // Xếp hạng đồng điểm cùng hạng
    function renderRows(rows, mine) {
        const list = el("ol", "board-list");
        if (!rows || rows.length === 0) {
            list.append(el("li", "board-empty", "Chưa có điểm."));
            return list;
        }
        let rank = 0;
        rows.forEach((r, i) => {
            if (i === 0 || r.diem !== rows[i - 1].diem) rank = i + 1;
            const li = el("li", "board-row" + (rank === 1 ? " top" : "") + (r.group === mine ? " mine" : ""));
            const who = el("div", "who");
            who.append(el("div", "n", r.team_name), el("div", "g", r.group));
            li.append(el("span", "rank", rank), who, el("span", "pts", r.diem));
            list.append(li);
        });
        return list;
    }

    function renderFinalScores(container, rows, mine) {
        container.textContent = "";
        container.append(renderRows(rows || [], mine));
    }

    function renderScoreboards(container, data, mine) {
        const round = data.round || 0;
        // Vòng đang chạy thì chưa có bảng điểm để hiện
        const done = data.game_status === "waiting" ? round : round - 1;
        const revealed = data.revealed || {};

        container.textContent = "";
        container.hidden = done < 1;

        for (let v = 1; v <= done; v++) {
            const rows = revealed[v];
            const box = el("div", "board" + (rows ? " open" : ""));
            const head = el("div", "board-head");
            head.append(
                el("h3", "", `Điểm vòng ${v}`),
                el("span", "chip" + (rows ? " ok" : ""), rows ? "Đã công bố" : "Chưa công bố")
            );
            box.append(head);
            if (rows) {
                box.append(renderRows(rows, mine));
            } else {
                box.append(el("p", "board-locked", "Ban tổ chức sẽ công bố điểm vòng này sau."));
            }
            container.append(box);
        }
    }

    return { summarize, renderTeams, renderScoreboards, renderFinalScores, renderRows, el };
})();
