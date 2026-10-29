(() => {
    const socket = io();
    const $ = (id) => document.getElementById(id);
    const main = $("tv-main");
    let snapshot = null;
    let deadline = 0;

    function make(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function render(data) {
        if (!data) return;
        snapshot = data;
        deadline = performance.now() + Math.max(0, Number(data.seconds) || 0) * 1000;
        $("tv-round").textContent = data.view === "welcome" ? "" : (data.round === "total" ? "TỔNG KẾT" : `VÒNG ${data.round}`);
        main.textContent = "";

        if (data.view === "welcome") {
            const welcome = make("div", "tv-welcome");
            welcome.append(make("div", "tv-mark", "⚙"), make("h1", "", data.title), make("p", "", data.body));
            main.append(welcome);
        } else if (data.view === "rules" || data.view === "guide") {
            const content = make("section", "tv-text-slide");
            content.append(make("h1", "tv-title", data.title), make("p", "tv-copy", data.body));
            main.append(content);
        } else if (data.view === "time") {
            const clock = make("section", "tv-time-slide");
            clock.append(make("h1", "tv-title", data.title));
            const value = make("div", "tv-clock", "00:00");
            value.id = "tv-clock";
            const status = data.active ? "Đang diễn ra" : data.countdown ? "Sắp bắt đầu" : data.game_status === "waiting" && data.active_round === data.round && data.active_round > 0 ? "Đã kết thúc" : "Thời lượng vòng";
            const statusEl = make("p", "tv-time-status", status);
            statusEl.id = "tv-time-status";
            clock.append(value, statusEl);
            main.append(clock);
            updateClock();
        } else if (data.view === "scores") {
            main.append(make("h1", "tv-title", data.title));
            const hidden = Number(data.hidden_count) || 0;
            if (!data.scoreboard || data.scoreboard.length === 0) {
                main.append(make("p", "tv-empty", "Chờ Ban Tổ Chức công bố điểm…"));
                return;
            }
            const list = make("section", "tv-scoreboard");
            data.scoreboard.forEach((team, index) => {
                const row = make("div", "tv-score-row" + (index === 0 ? " top" : ""));
                row.append(make("div", "tv-rank", `${index + 1}.`));
                const name = make("div", "tv-team");
                name.append(document.createTextNode(team.team_name));
                name.append(make("span", "tv-group", team.group));
                row.append(name, make("div", "tv-points", String(team.diem)));
                list.append(row);
            });
            main.append(list);
            // Xếp hạng chỉ tính trong các đội đã hiện; báo cho khán giả biết còn đội chưa công bố
            if (hidden > 0) main.append(make("p", "tv-pending", `Còn ${hidden} đội chưa công bố điểm`));
        }
    }

    function updateClock() {
        if (!snapshot || snapshot.view !== "time") return;
        const node = $("tv-clock");
        if (!node) return;
        const remaining = snapshot.active || snapshot.countdown ? Math.max(0, (deadline - performance.now()) / 1000) : Number(snapshot.seconds) || 0;
        const total = Math.ceil(remaining);
        node.textContent = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }

    socket.on("connect", () => {
        $("tv-connection").textContent = "Đã kết nối";
        socket.emit("tv_get_state");
    });
    socket.on("disconnect", () => { $("tv-connection").textContent = "Mất kết nối · đang thử lại"; });
    socket.on("tv_update", render);
    $("tv-fullscreen").addEventListener("click", async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
        } catch (_) { /* Fullscreen may be unavailable in embedded browsers. */ }
    });
    document.addEventListener("fullscreenchange", () => {
        const enabled = !!document.fullscreenElement;
        $("tv-fullscreen").textContent = enabled ? "Thoát toàn màn hình" : "Toàn màn hình ⛶";
        $("tv-fullscreen").setAttribute("aria-label", enabled ? "Thoát toàn màn hình" : "Bật toàn màn hình");
    });
    setInterval(updateClock, 200);
})();