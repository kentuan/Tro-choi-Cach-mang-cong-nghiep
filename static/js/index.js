const socket = io();
const $ = (id) => document.getElementById(id);

let selectedGroup = null;
let teamName = null;
let currentStep = "select-group";
let everConnected = false;

let lastState = null;     // state_update mới nhất (để vẽ lại màn hình chờ khi quay về)
let gameLocked = false;   // server đã khoá đội (vòng 1 đã bắt đầu)
let lastRound = 0;        // vòng gần nhất mà đội này đã vào chơi
let countdownTimer = null;

const STEP_ORDER = ["select-group", "enter-name", "waiting", "game"];

// Mỗi vòng một "bộ chơi". Thêm vòng 2, 3... ở đây khi đã viết xong giao diện của vòng đó.
// Mỗi bộ cần có: preload(), start({socket, group, teamName, onEnd}), stop(), forceEnd()
const ROUNDS = { 1: Vong1, 2: Vong2, 3: Vong3, 4: Vong4, 5: Vong5, 6: Vong6 };

// Vòng 1 dùng #step-game, các vòng sau dùng #step-game-<số vòng> (vd. #step-game-2)
const gameStepId = (round) => (round === 1 ? "game" : "game-" + round);
const isGameStep = (id) => id === "game" || id.startsWith("game-");

// ── Helpers ──
function showStep(stepId) {
    document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
    $("step-" + stepId).classList.add("active");
    currentStep = stepId;
    document.body.classList.toggle("in-game", isGameStep(stepId));
    updateProgress();
}

function updateProgress() {
    // 3 chấm: chọn nhóm → đặt tên → chờ/bắt đầu
    const idx = Math.min(STEP_ORDER.indexOf(currentStep), 2);
    const allDone = isGameStep(currentStep);
    for (let i = 0; i < 3; i++) {
        const dot = $("dot-" + (i + 1));
        dot.className = "dot" + (allDone || i < idx ? " done" : i === idx ? " active" : "");
    }
}

function clearErrors() {
    document.querySelectorAll(".error-msg").forEach(e => e.textContent = "");
}

// ── Màn hình chờ (giống BTC, chỉ xem) ──
function renderLobby(data) {
    const s = Lobby.renderTeams(data, selectedGroup);
    Lobby.renderScoreboards($("scoreboards"), data, selectedGroup);
    const finalBox = $("team-final-board");
    finalBox.hidden = !data.final_revealed;
    if (data.final_revealed) Lobby.renderFinalScores($("team-final-rows"), data.final_scores, selectedGroup);

    const text = $("waiting-text");
    const sub = $("waiting-sub");

    if (s.status === "countdown") {
        text.textContent = `Vòng ${s.round} sắp bắt đầu...`;
        sub.textContent = "";
    } else if (s.status === "playing") {
        const left = s.joined.length - s.finished.size;
        text.textContent = `Vòng ${s.round} đang diễn ra`;
        sub.textContent = left > 0 ? `Còn ${left} đội đang chơi...` : "";
    } else if (s.round > 0) {
        if (data.next_round) {
            text.textContent = `Đang chờ BTC bắt đầu vòng ${data.next_round}...`;
            sub.textContent = "Điểm từng vòng sẽ hiện khi BTC công bố.";
        } else {
            // Hết vòng cuối thì trò chơi kết thúc, không có vòng kế tiếp
            text.textContent = "Trò chơi đã kết thúc";
            sub.textContent = "Điểm sẽ hiện khi BTC công bố.";
        }
    } else {
        text.textContent = "Đang chờ BTC bắt đầu trò chơi...";
        sub.textContent = s.pending.length > 0
            ? `Còn ${s.pending.length} đội đang nhập tên...`
            : "Tất cả các đội đã sẵn sàng.";
    }
}

// ── Đếm ngược ──
function showCountdown(round, seconds) {
    hideCountdown();
    const overlay = $("countdown-overlay");
    const num = $("countdown-number");
    $("countdown-round").textContent = `Vòng ${round}`;

    let left = seconds;
    const show = (value, isGo) => {
        num.textContent = value;
        num.classList.toggle("go", !!isGo);
        num.classList.remove("tick");
        void num.offsetWidth; // chạy lại animation cho mỗi nhịp
        num.classList.add("tick");
    };

    overlay.hidden = false;
    if (left > 0) show(left); else show("Bắt đầu!", true);

    countdownTimer = setInterval(() => {
        left--;
        if (left > 0) {
            show(left);
        } else {
            // Hết đếm ngược: giữ chữ này tới khi server báo game_started
            clearInterval(countdownTimer);
            countdownTimer = null;
            show("Bắt đầu!", true);
        }
    }, 1000);
}

function hideCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    $("countdown-overlay").hidden = true;
}

// ── Vào / ra màn chơi ──
function startGame(round) {
    const game = ROUNDS[round];
    if (!game || isGameStep(currentStep) || !selectedGroup || !teamName) return;
    lastRound = round;
    showStep(gameStepId(round));
    game.start({ socket, group: selectedGroup, teamName, onEnd: returnToLobby });
}

// Chơi xong → quay về màn hình chờ, chuẩn bị cho vòng sau
function returnToLobby() {
    if (!isGameStep(currentStep)) return;
    ROUNDS[lastRound]?.stop();
    showStep("waiting");
    if (lastState) renderLobby(lastState);
    socket.emit("get_state");
}

function resetToStart() {
    hideCountdown();
    Object.values(ROUNDS).forEach(g => g.stop());
    selectedGroup = null;
    teamName = null;
    lastRound = 0;
    lastState = null;
    gameLocked = false;
    showStep("select-group");
    socket.emit("get_state");
}

// ── Kết nối ──
socket.on("connect", () => {
    $("conn-banner").classList.remove("show");

    // Đã vào chơi (server khoá đội từ lúc vòng 1 bắt đầu): server giữ nguyên đội, cứ chơi tiếp
    if (everConnected && selectedGroup && gameLocked) {
        socket.emit("get_state");
    }
    // Kết nối lại trước khi game bắt đầu: server đã giải phóng nhóm cũ nên phải chọn lại
    else if (everConnected && selectedGroup) {
        resetToStart();
        $("error-select").textContent =
            "Bị mất kết nối nên nhóm cũ đã được giải phóng. Vui lòng chọn lại.";
    } else {
        socket.emit("get_state");
    }
    everConnected = true;
});

socket.on("disconnect", () => {
    $("conn-banner").classList.add("show");
});

// ── Nhận trạng thái ──
socket.on("state_update", (data) => {
    lastState = data;
    gameLocked = data.game_status !== "waiting" || (data.round || 0) > 0;
    const takenGroups = data.taken_groups || [];

    // Bước chọn nhóm: khóa những nhóm đã có đội
    if (currentStep === "select-group") {
        document.querySelectorAll(".group-btn").forEach(btn => {
            const taken = takenGroups.includes(btn.dataset.group);
            btn.disabled = taken || gameLocked;
            btn.querySelector(".state").textContent = taken ? "Đã có đội" : "";
        });
    }

    // Màn hình chờ: cập nhật danh sách đội, trạng thái, bảng điểm
    if (currentStep === "waiting") {
        renderLobby(data);
    }

    // Lưới an toàn: vòng đã chạy mà mình lỡ mất sự kiện game_started (vừa kết nối lại)
    if (data.game_status === "playing" && currentStep === "waiting" && data.round !== lastRound) {
        hideCountdown();
        startGame(data.round);
    }
});

// ── Chọn nhóm ──
document.querySelectorAll(".group-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        clearErrors();
        socket.emit("select_group", { group: btn.dataset.group });
    });
});

socket.on("group_selected", (data) => {
    selectedGroup = data.group;
    $("selected-group-label").textContent = "Bạn đã chọn " + data.group;

    const input = $("team-name-input");
    input.value = data.default_name;
    input.placeholder = data.default_name;
    $("name-count").textContent = input.value.length;

    showStep("enter-name");
    input.focus();
    input.select();
});

// ── Nhập tên đội ──
const nameInput = $("team-name-input");

nameInput.addEventListener("input", () => {
    $("name-count").textContent = nameInput.value.length;
});

$("confirm-name-btn").addEventListener("click", () => {
    clearErrors();
    const finalName = nameInput.value.trim() || selectedGroup;
    socket.emit("set_team_name", { group: selectedGroup, team_name: finalName });
});

// Enter để xác nhận
nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        $("confirm-name-btn").click();
    }
});

socket.on("name_confirmed", (data) => {
    teamName = data.team_name;
    $("display-team-name").textContent = data.team_name;
    $("display-group").textContent = data.group;

    showStep("waiting");
    if (lastState) renderLobby(lastState);
    ROUNDS[1].preload().catch(() => {}); // tải sẵn câu hỏi để BTC bấm là vào chơi ngay
    socket.emit("get_state");
});

// ── BTC bấm bắt đầu: đếm ngược (server giữ đồng hồ, bắt đầu cùng lúc cho mọi đội) ──
socket.on("game_countdown", (data) => {
    if (!selectedGroup || !teamName) return; // chỉ đội đã xác nhận tên mới tham gia
    // Nếu còn đang ở màn kết thúc của vòng trước thì quay về màn chờ trước
    if (isGameStep(currentStep)) returnToLobby();
    if (currentStep !== "waiting") return;
    ROUNDS[data.round]?.preload().catch(() => {});
    showCountdown(data.round, data.seconds);
});

// ── Vòng bắt đầu ──
socket.on("game_started", (data) => {
    hideCountdown();
    // Chỉ đội đã xác nhận tên mới vào màn hình chơi
    if (currentStep === "waiting") startGame(data.round);
});

// ── Vòng kết thúc (tất cả đã xong hoặc server hết giờ) ──
socket.on("round_ended", () => {
    // Đội nào chưa kịp tự kết thúc thì kết thúc luôn, rồi tự quay về màn chờ
    if (isGameStep(currentStep)) ROUNDS[lastRound]?.forceEnd();
});

// ── Game reset ──
socket.on("game_reset", () => {
    resetToStart();
});

// ── Lỗi ──
socket.on("error_message", (data) => {
    if (currentStep === "select-group") {
        $("error-select").textContent = data.message;
    } else if (currentStep === "enter-name") {
        $("error-name").textContent = data.message;
    }
});

updateProgress();