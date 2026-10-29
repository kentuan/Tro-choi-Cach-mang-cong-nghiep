const socket = io();
const $ = (id) => document.getElementById(id);

// Lưu trạng thái trước để chỉ ghi log khi có thay đổi thật sự
let prev = { teams: {}, confirmed: {}, finished: [], revealed: [], status: null, round: 0 };
let lastState = null;   // state_update mới nhất
let lastScores = [];    // btc_scores mới nhất: [{vong, revealed, scores}]
let lastFinal = [];
let tvSelection = { view: "welcome", round: 1 };
let tvRevealed = {};      // {"1": ["Nhóm 1", ...], "total": [...]}: đội đang được hiện điểm trên TV
let lastLiveFinal = [];   // tổng điểm trực tiếp (BTC luôn thấy)

// Chế độ DEBUG (do server bật khi DEBUG=True): BTC chọn vòng bất kỳ để test nhanh
const DEBUG = window.BTC_DEBUG === true;
let debugPicked = false;   // BTC đã tự chọn vòng; nếu chưa, ô chọn tự theo "vòng tiếp theo"
if (DEBUG) {
    const sel = $("debug-round");
    for (const v of window.BTC_ROUNDS || []) sel.append(new Option(`Vòng ${v}`, v));
    $("debug-box").hidden = false;
    sel.addEventListener("change", () => {
        debugPicked = true;
        if (lastState) renderControls(lastState, Lobby.summarize(lastState));
    });
}

// ── Kết nối ──
socket.on("connect", () => {
    $("conn-banner").classList.remove("show");
    addLog("Đã kết nối server");
    socket.emit("btc_get_state");
});

socket.on("disconnect", () => {
    $("conn-banner").classList.add("show");
    addLog("Mất kết nối server");
});

// ── Cập nhật trạng thái ──
socket.on("state_update", (data) => {
    lastState = data;
    const s = Lobby.renderTeams(data);
    const teamCount = s.joined.length;

    renderControls(data, s);
    renderScores();
    renderTvReveal();
    logChanges(data, s);

    prev = {
        teams: { ...s.teams },
        confirmed: { ...s.confirmed },
        finished: [...(data.finished || [])],
        revealed: Object.keys(data.revealed || {}),
        status: data.game_status,
        round: s.round,
    };
});

socket.on("tv_control", (data) => {
    if (!data) return;
    tvSelection = data;
    tvRevealed = data.revealed || {};
    $("tv-round-select").value = String(data.round);
    document.querySelectorAll("[data-tv-view]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tvView === data.view);
    });
    const names = { welcome: "Chào mừng", rules: "Luật chơi", guide: "Hướng dẫn", time: "Thời gian", scores: "Điểm" };
    const round = data.round === "total" ? "Tổng điểm" : `Vòng ${data.round}`;
    $("tv-control-status").textContent = `Đang chiếu: ${names[data.view] || data.view} · ${round}`;
    renderTvReveal();
});

// ── Hiện điểm trên TV: tất cả hoặc từng đội ──
function tvRevealReady(key) {
    if (!lastState) return false;
    const status = lastState.game_status;
    const round = lastState.round || 0;
    if (key === "total") return status === "waiting" && round >= 6;
    const v = Number(key);
    return v >= 1 && v <= round && !(status !== "waiting" && v === round);
}

function renderTvReveal() {
    const key = $("tv-round-select").value;
    const label = key === "total" ? "Tổng điểm" : `Vòng ${key}`;
    const shown = new Set(tvRevealed[key] || []);
    const ready = tvRevealReady(key);
    const rows = key === "total"
        ? lastLiveFinal
        : ((lastScores.find((r) => String(r.vong) === key) || {}).scores || []);
    const list = $("tv-reveal-list");
    list.textContent = "";
    $("tv-reveal-title").textContent = `Hiện điểm trên TV · ${label}`;

    let note;
    if (ready) note = `Đang hiện ${shown.size}/${rows.length} đội trên TV. TV chỉ xếp hạng các đội đã hiện; ở đây bạn luôn thấy đủ.`;
    else if (key === "total") note = "Chỉ hiện được tổng điểm sau khi vòng 6 kết thúc.";
    else if (Number(key) > (lastState?.round || 0)) note = `${label} chưa diễn ra.`;
    else note = `${label} đang diễn ra, chờ vòng kết thúc mới hiện điểm được.`;
    $("tv-reveal-note").textContent = note;

    let rank = 0;
    rows.forEach((r, i) => {
        // Vòng 1–6: đồng điểm cùng hạng; tổng điểm đã có luật phân hạng riêng nên theo thứ tự
        if (key === "total" || i === 0 || r.diem !== rows[i - 1].diem) rank = i + 1;
        const on = shown.has(r.group);
        const li = Lobby.el("li", "tv-reveal-row" + (on ? " shown" : ""));
        const who = Lobby.el("div", "who");
        who.append(Lobby.el("div", "n", r.team_name), Lobby.el("div", "g", r.group));
        const chip = Lobby.el("span", "chip" + (on ? " ok" : ""), on ? "Đang hiện" : "Đang ẩn");
        const btn = Lobby.el("button", "btn btn-ghost", on ? "Ẩn" : "Hiện");
        btn.type = "button";
        btn.disabled = !on && !ready;
        btn.addEventListener("click", () => tvReveal([r.group], !on));
        li.append(Lobby.el("span", "rank", rank), who, Lobby.el("span", "pts", r.diem), chip, btn);
        list.append(li);
    });

    $("tv-reveal-all").disabled = !ready || rows.length === 0 || shown.size >= rows.length;
    $("tv-hide-all").disabled = shown.size === 0;
    // Gợi ý chuyển TV sang đúng bảng điểm nếu TV đang chiếu nội dung khác
    $("tv-show-board").hidden = !ready || (tvSelection.view === "scores" && String(tvSelection.round) === key);
}

function tvReveal(groups, show) {
    const key = $("tv-round-select").value;
    $("error-btc").textContent = "";
    socket.emit("btc_tv_reveal", { round: key === "total" ? "total" : Number(key), groups, show });
    const label = key === "total" ? "tổng điểm" : `vòng ${key}`;
    addLog(`${show ? "Cho phép hiện" : "Ẩn"} điểm ${label} trên TV: ${groups === "all" ? "tất cả đội" : groups.join(", ")}`);
}

$("tv-reveal-all").addEventListener("click", () => tvReveal("all", true));
$("tv-hide-all").addEventListener("click", () => tvReveal("all", false));
$("tv-show-board").addEventListener("click", () => setTvView("scores"));

function setTvView(view) {
    let round = $("tv-round-select").value;
    if (view !== "scores" && round === "total") {
        round = "1";
        $("tv-round-select").value = round;
    }
    socket.emit("btc_tv_change", { view, round });
}

document.querySelectorAll("[data-tv-view]").forEach((button) => {
    button.addEventListener("click", () => setTvView(button.dataset.tvView));
});
$("tv-round-select").addEventListener("change", () => {
    renderTvReveal();
    if ($("tv-round-select").value === "total" && tvSelection.view !== "scores") return;
    setTvView(tvSelection.view);
});

// Nút bắt đầu + dòng gợi ý
function renderControls(data, s) {
    const btnStart = $("btn-start");
    const hint = $("start-hint");
    const teamCount = s.joined.length;
    const setHint = (t) => { hint.textContent = t; };

    // DEBUG: ô chọn vòng theo "vòng tiếp theo" cho tới khi BTC tự chọn; khoá khi đang có vòng chạy
    const pick = DEBUG ? $("debug-round") : null;
    if (pick) {
        pick.disabled = s.status !== "waiting";
        if (!debugPicked && data.next_round !== null) pick.value = String(data.next_round);
    }
    const target = pick ? Number(pick.value) : data.next_round;

    if (s.status === "countdown") {
        btnStart.disabled = true;
        btnStart.textContent = "⏱️ Đang đếm ngược...";
        setHint(`Vòng ${s.round} sắp bắt đầu.`);
    } else if (s.status === "playing") {
        btnStart.disabled = true;
        btnStart.textContent = `🟢 Vòng ${s.round} đang diễn ra`;
        setHint(`${s.finished.size}/${teamCount} đội đã hoàn thành.`);
    } else if (!pick && data.next_round === null) {
        // Giữa các vòng nhưng không còn vòng nào để chơi
        btnStart.disabled = true;
        btnStart.textContent = "Hết vòng";
        setHint("Chưa có vòng tiếp theo. Bấm Reset để chơi lại từ đầu.");
    } else {
        btnStart.textContent = `▶ Bắt đầu vòng ${target}`;
        btnStart.disabled = !s.allConfirmed;
        if (teamCount === 0) {
            setHint("Chưa có đội nào tham gia.");
        } else if (s.pending.length > 0) {
            hint.textContent = "";
            hint.append("Đang chờ xác nhận tên: ");
            const strong = document.createElement("strong");
            strong.textContent = s.pending.join(", ");
            hint.append(strong);
        } else if (s.round > 0) {
            setHint(`Vòng ${s.round} đã kết thúc. Có thể công bố điểm hoặc bắt đầu vòng ${target}.`);
        } else {
            setHint(`Đã có ${teamCount} đội xác nhận tên. Có thể bắt đầu!`);
        }
    }
}

function logChanges(data, s) {
    const teams = s.teams;
    const confirmed = s.confirmed;

    for (const g of Object.keys(teams)) {
        if (!(g in prev.teams)) addLog(`${g} đã vào`);
        else if (confirmed[g] && !prev.confirmed[g]) addLog(`${g} xác nhận tên: ${teams[g]}`);
    }
    for (const g of Object.keys(prev.teams)) {
        if (!(g in teams)) addLog(`${g} đã rời đi`);
    }

    for (const v of Object.keys(data.revealed || {})) {
        if (!prev.revealed.includes(v)) addLog(`Đã công bố điểm vòng ${v}`);
    }

    if (prev.status !== null && s.status !== prev.status) {
        if (s.status === "countdown") addLog(`Đếm ngược vòng ${s.round}`);
        else if (s.status === "playing") addLog(`Vòng ${s.round} bắt đầu`);
        else if (s.round === 0 && prev.round > 0) addLog("Trò chơi đã được reset");
        else addLog(`Vòng ${prev.round} kết thúc`);
    }
}

// ── Một đội chơi xong (kèm số liệu) ──
socket.on("btc_round_finish", (d) => {
    const who = `${d.group} (${d.team_name})`;
    const wrong = d.wrong || 0; // chỉ vòng có tính sai (vòng 4) mới > 0
    const wrongTxt = wrong > 0 ? ` / ${wrong} sai` : "";
    if (d.reason === "complete") {
        addLog(`${who} hoàn thành sớm: còn ${d.time_left} giây, ${d.correct} đúng${wrongTxt} / ${d.skipped} bỏ qua`);
    } else {
        const untouched = Math.max(d.total - d.correct - wrong - d.skipped, 0);
        addLog(`${who} hết giờ: ${d.correct} đúng${wrongTxt} / ${d.skipped} bỏ qua` + (untouched > 0 ? ` / ${untouched} chưa làm` : ""));
    }
});

// ── Vòng 5: nhật ký từng câu (server điều khiển, BTC chỉ theo dõi) ──
let lastV5Key = "";
let lastV6Key = "";
socket.on("v5_state", (s) => {
    if (!s || !s.q) return;
    const key = `${s.q}-${s.phase}`;
    if (key === lastV5Key) return; // chỉ ghi khi đổi pha, không ghi lặp mỗi lần mở chuông lại
    if (s.phase === "prep") {
        addLog(`Vòng 5 · câu ${s.q}/${s.total} (${s.chu_de}): các đội đang chọn cược`);
    } else if (s.phase === "reveal") {
        addLog(`Đáp án câu ${s.q}: ${s.dap_an}` + (s.winner ? ` · ${s.winner.team_name} giành điểm` : " · không đội nào đúng"));
    } else {
        return;
    }
    lastV5Key = key;
});

socket.on("btc_v5", (d) => {
    const sign = d.delta > 0 ? "+" : "";
    const what = d.timeout ? "hết giờ" : d.correct ? "đúng" : "sai";
    addLog(`Câu ${d.q}: ${d.group} (${d.team_name}) ${what}, cược ${d.bet} → ${sign}${d.delta}`);
});

socket.on("v6_state", (s) => {
    if (!s || s.phase !== "reveal") return;
    const key = `${s.q}-reveal`;
    if (key === lastV6Key) return;
    (s.matches || []).forEach((m) => {
        const pts = `${m.names[0]} ${m.scores[m.groups[0]]} · ${m.names[1]} ${m.scores[m.groups[1]]}`;
        addLog(`Vòng 6 · câu ${s.q}: ${m.names[0]} đấu ${m.names[1]} · đáp án ${m.dap_an} · ${pts}`);
    });
    lastV6Key = key;
});

// ── Điểm số theo vòng ──
socket.on("btc_scores", (data) => {
    lastScores = data.rounds || [];
    lastFinal = data.final || [];
    lastLiveFinal = data.live_final || [];
    if (lastState) lastState.final_revealed = data.final_revealed;
    const preview = $("v6-pairings-preview");
    if (data.v6_pairings?.length) {
        preview.textContent = "Vòng 6 · cặp dự kiến: " + data.v6_pairings.map((pair, i) =>
            `${i === 0 ? "Chung kết" : "Tranh hạng ba"}: ${(lastState?.teams?.[pair[0]] || pair[0])} – ${(lastState?.teams?.[pair[1]] || pair[1])}`
        ).join(" · ") + ". Bấm Bắt đầu vòng 6 để xác nhận.";
    } else preview.textContent = "";
    renderScores();
    renderTvReveal();
});

function renderScores() {
    const panel = $("scores-panel");
    const box = $("rounds-scores");
    panel.hidden = lastScores.length === 0;
    box.textContent = "";

    const status = lastState ? lastState.game_status : "waiting";
    const currentRound = lastState ? lastState.round : 0;
    const finalPanel = $("final-panel");
    const finalRevealed = lastState?.final_revealed || false;
    finalPanel.hidden = currentRound < 6;
    $("btn-final").hidden = currentRound < 6 || finalRevealed || status !== "waiting";
    if (finalRevealed) Lobby.renderFinalScores($("final-scores"), lastState?.final_scores || lastFinal);

    for (const r of lastScores) {
        const inProgress = status !== "waiting" && r.vong === currentRound;

        const card = Lobby.el("div", "board" + (r.revealed ? " open" : ""));
        const head = Lobby.el("div", "board-head");
        head.append(Lobby.el("h3", "", `Vòng ${r.vong}`));

        const actions = Lobby.el("div", "round-actions");
        if (r.revealed) {
            actions.append(Lobby.el("span", "chip ok", "Đã công bố"));
        } else if (inProgress) {
            actions.append(Lobby.el("span", "chip warn", "Đang diễn ra"));
        } else {
            actions.append(Lobby.el("span", "chip", "Chưa công bố"));
            const btn = Lobby.el("button", "btn btn-primary", `Công bố điểm vòng ${r.vong}`);
            btn.addEventListener("click", () => revealRound(r.vong));
            actions.append(btn);
        }
        head.append(actions);

        card.append(head, Lobby.renderRows(r.scores));
        box.append(card);
    }
}

$("btn-final").addEventListener("click", () => {
    if (confirm("Công bố bảng tổng điểm và xếp hạng chung cuộc?")) socket.emit("btc_reveal_final");
});

function revealRound(vong) {
    if (!confirm(`Công bố điểm vòng ${vong} cho tất cả các đội?`)) return;
    $("error-btc").textContent = "";
    socket.emit("btc_reveal_scores", { vong });
    addLog(`Đã gửi lệnh công bố điểm vòng ${vong}`);
}

// ── Nút bắt đầu ──
$("btn-start").addEventListener("click", () => {
    $("error-btc").textContent = "";
    if (DEBUG) {
        const vong = Number($("debug-round").value);
        socket.emit("btc_start_game", { vong });
        debugPicked = false;
        addLog(`Đã gửi lệnh bắt đầu vòng ${vong} (DEBUG)`);
    } else {
        socket.emit("btc_start_game");
        addLog("Đã gửi lệnh bắt đầu");
    }
});

// ── Nút reset ──
$("btn-reset").addEventListener("click", () => {
    if (confirm("Bạn có chắc muốn reset trò chơi? Toàn bộ đội và điểm sẽ bị xoá.")) {
        $("error-btc").textContent = "";
        socket.emit("btc_reset_game");
        debugPicked = false;
        lastV5Key = "";
        lastV6Key = "";
        addLog("Đã gửi lệnh reset");
    }
});

// ── Lỗi ──
socket.on("error_message", (data) => {
    $("error-btc").textContent = data.message;
    addLog("Lỗi: " + data.message);
});

// ── Nhật ký ──
function addLog(msg) {
    const logSection = $("log-section");
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = "[" + new Date().toLocaleTimeString("vi-VN") + "]";

    entry.append(time, document.createTextNode(msg));
    logSection.appendChild(entry);
    logSection.scrollTop = logSection.scrollHeight;
}

// ── Tải kết quả Excel ──
$("btn-export").addEventListener("click", async () => {
    const btn = $("btn-export");
    const msg = $("export-msg");
    msg.textContent = "";
    btn.disabled = true;
    try {
        const res = await fetch("/btc/export.xlsx", { cache: "no-store" });
        if (!res.ok) {
            let reason = "Không tải được file.";
            try { reason = (await res.json()).error || reason; } catch (e) { /* giữ thông báo mặc định */ }
            throw new Error(reason);
        }
        // Tên file do server đặt (ket_qua_ngày_giờ.xlsx)
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
        const name = match ? decodeURIComponent(match[1]) : "ket_qua.xlsx";
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        addLog(`Đã tải file kết quả: ${name}`);
    } catch (err) {
        msg.textContent = err.message;
    } finally {
        btn.disabled = false;
    }
});