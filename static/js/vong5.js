/**
 * Vòng 5 – Nhanh tay & cược điểm (chạy ngay trong trang chủ, dùng chung socket)
 * ─────────────────────────────────────────────────────────
 * Khác vòng 1–4: câu hỏi chạy ĐỒNG BỘ cho cả bốn đội và do SERVER điều khiển.
 * Mỗi câu có 3 pha:
 *   1. prep      – chỉ biết chủ đề, mỗi đội chọn mức cược (mặc định thấp nhất).
 *   2. open      – câu hỏi hiện ra; đội bấm chuông trước được trả lời (server phân xử).
 *                  Trả lời sai/hết giờ → mất quyền ở câu này, các đội còn lại được bấm tiếp.
 *   3. reveal    – hiện đáp án + số trang rồi sang câu sau.
 * Đúng = +cược, sai/hết giờ = −cược (điểm có thể âm). Chỉ đội giữ chuông mới nhận được các lựa chọn.
 *
 * Client chỉ vẽ lại theo trạng thái server gửi (v5_state) nên vào muộn / mất mạng rồi nối lại vẫn khớp
 * (gọi v5_sync). Điểm của đội do server tính và gửi riêng cho đội qua v5_result.
 *
 * API giống Vong1–4:
 *   Vong5.preload()  Vong5.start({socket, group, teamName, onEnd})  Vong5.forceEnd()  Vong5.stop()
 */
const Vong5 = (() => {
    const $ = (id) => document.getElementById(id);
    const END_SCREEN_MS = 4000;
    const CIRCUMFERENCE = 2 * Math.PI * 45;
    const KEYS = ["A", "B", "C", "D"];

    // ── DOM refs ──
    const stepGame = $("step-game-5");
    const timerFill = $("v5-timer-fill");
    const timerText = $("v5-timer-text");
    const scoreValue = $("v5-score");
    const qCurrent = $("v5-q-current");
    const qTotal = $("v5-q-total");
    const statusEl = $("v5-status");
    const prepBox = $("v5-prep");
    const topicEl = $("v5-topic");
    const betsEl = $("v5-bets");
    const questionBox = $("v5-question");
    const questionTopic = $("v5-question-topic");
    const questionText = $("v5-question-text");
    const buzzBox = $("v5-buzz");
    const buzzBtn = $("v5-buzz-btn");
    const buzzInfo = $("v5-buzz-info");
    const optionsEl = $("v5-options");
    const revealBox = $("v5-reveal");
    const revealTitle = $("v5-reveal-title");
    const revealText = $("v5-reveal-text");
    const attemptsEl = $("v5-attempts");
    const feedback = $("v5-feedback");
    const endScreen = $("v5-end");
    const finalScore = $("v5-final-score");
    timerFill.style.strokeDasharray = CIRCUMFERENCE;

    // ── State ──
    let socket = null, myGroup = "", myTeamName = "", onEnd = null, bound = false;
    let snap = null;          // v5_state mới nhất
    let curQ = 0;             // câu đang hiển thị (1-based)
    let myBet = 10;
    let myOptions = null;     // các lựa chọn, chỉ có khi mình đang giữ chuông
    let answeredQ = 0;        // câu mình đã gửi đáp án
    let buzzPending = false;
    let score = 0;
    let gameEnded = false;
    let runId = 0;
    let phaseEnd = 0, phaseSpan = 1, tickTimer = null;

    // ── Helpers ──
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function setFeedback(text, cls) {
        feedback.textContent = text;
        feedback.className = "feedback" + (cls ? " " + cls : "");
    }
    function setScore(v) {
        score = v;
        scoreValue.textContent = v;
        finalScore.textContent = v;
    }
    const iAmBuzzer = () => !!snap && !!snap.buzzer && snap.buzzer.group === myGroup;
    const iAmLocked = () => !!snap && (snap.locked || []).includes(myGroup);

    // ── Đồng hồ đếm ngược của pha hiện tại (server giữ giờ thật, đây chỉ để hiển thị) ──
    function setCountdown(seconds, span) {
        phaseEnd = performance.now() + (seconds || 0) * 1000;
        phaseSpan = Math.max(span || 1, 1);
        tick();
    }
    function tick() {
        const left = Math.max(0, (phaseEnd - performance.now()) / 1000);
        timerText.textContent = snap ? Math.ceil(left) : "–";
        timerFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - left / phaseSpan);
        timerFill.classList.remove("warning", "danger");
        if (left <= 3) timerFill.classList.add("danger");
        else if (left <= 5) timerFill.classList.add("warning");
    }

    // ═══ Vẽ giao diện theo trạng thái server ═══
    function render(s) {
        if (gameEnded || !s) return;
        snap = s;
        if (s.q) {
            qCurrent.textContent = s.q;
            qTotal.textContent = s.total;
        }
        if (typeof s.diem === "number") setScore(s.diem); // chỉ có trong bản đồng bộ riêng của đội

        if (s.q !== curQ) { // sang câu mới
            curQ = s.q;
            myOptions = null;
            myBet = s.bet || (s.bets ? s.bets[0] : 10);
            setFeedback("");
        } else if (s.bet) {
            myBet = s.bet;
        }
        if (s.phase === "answering" && s.options && iAmBuzzer()) myOptions = s.options;

        setCountdown(s.seconds, s.span);
        [prepBox, questionBox, buzzBox, optionsEl, revealBox].forEach((n) => { n.hidden = true; });

        if (s.phase === "prep") {
            statusEl.textContent = `Câu ${s.q}/${s.total}: chọn mức cược`;
            topicEl.textContent = "Chủ đề: " + s.chu_de;
            renderBets(s.bets || [10, 20, 30]);
            prepBox.hidden = false;
        } else if (s.phase === "open" || s.phase === "answering" || s.phase === "reveal") {
            questionTopic.textContent = s.chu_de;
            questionText.textContent = s.cau_hoi;
            questionBox.hidden = false;

            if (s.phase === "open") {
                statusEl.textContent = iAmLocked()
                    ? "Bạn đã mất quyền trả lời câu này"
                    : s.attempts && s.attempts.length
                        ? "Đội trước trả lời sai, bấm chuông để giành quyền!"
                        : "Bấm chuông để giành quyền trả lời!";
                buzzBtn.disabled = iAmLocked() || buzzPending;
                buzzInfo.textContent = `Cược của bạn: ${myBet} điểm (phím cách để bấm chuông)`;
                buzzBox.hidden = false;
            } else if (s.phase === "answering") {
                if (iAmBuzzer()) {
                    statusEl.textContent = "Đến lượt bạn! Chọn đáp án (phím 1–4)";
                    renderOptions();
                } else {
                    statusEl.textContent = `${s.buzzer ? s.buzzer.team_name : "Một đội"} đang trả lời...`;
                }
            } else {
                const w = s.winner;
                statusEl.textContent = w ? `${w.team_name} trả lời đúng!` : "Không đội nào trả lời đúng";
                revealBox.classList.toggle("none", !w);
                revealTitle.textContent = w ? "✅ Đáp án" : "💡 Đáp án";
                revealText.textContent = [
                    s.dap_an,
                    s.giai_thich,
                    s.trang ? `(sách tr.${s.trang})` : "",
                ].filter(Boolean).join("\n");
                revealBox.hidden = false;
            }
        } else {
            statusEl.textContent = "Chuẩn bị câu hỏi đầu tiên...";
        }
        renderAttempts(s.attempts || []);
    }

    function renderBets(list) {
        betsEl.textContent = "";
        list.forEach((n) => {
            const b = el("button", "v5-bet" + (n === myBet ? " selected" : ""));
            b.type = "button";
            b.append(el("span", "num", n), el("span", "sub", `+${n} / −${n}`));
            b.addEventListener("click", () => pickBet(n));
            betsEl.append(b);
        });
    }

    function renderOptions() {
        optionsEl.textContent = "";
        const done = answeredQ === curQ;
        (myOptions || []).forEach((text, i) => {
            const b = el("button", "v5-option");
            b.type = "button";
            b.disabled = done;
            b.append(el("span", "key", KEYS[i] || i + 1), el("span", "", text));
            b.addEventListener("click", () => answer(i));
            optionsEl.append(b);
        });
        optionsEl.hidden = !myOptions;
    }

    function renderAttempts(list) {
        attemptsEl.textContent = "";
        list.forEach((a) => attemptsEl.append(el("li", a.correct ? "ok" : "bad", `${a.team_name} trả lời ${a.correct ? "đúng" : "sai"}`)));
    }

    // ═══ Hành động của đội ═══
    function pickBet(n) {
        if (gameEnded || !snap || snap.phase !== "prep") return;
        myBet = n;
        renderBets(snap.bets || [10, 20, 30]);
        socket.emit("v5_bet", { group: myGroup, bet: n }, (res) => {
            if (res && res.bet && res.bet !== myBet) { myBet = res.bet; renderBets(snap.bets || [10, 20, 30]); }
        });
    }

    function buzz() {
        if (gameEnded || !snap || snap.phase !== "open" || buzzPending || iAmLocked()) return;
        buzzPending = true;
        buzzBtn.disabled = true;
        socket.emit("v5_buzz", { group: myGroup }, (res) => {
            buzzPending = false;
            if (res && res.ok) {
                myOptions = res.options;
                if (iAmBuzzer()) renderOptions(); // bản tin trạng thái có thể đến trước hoặc sau
            } else {
                setFeedback("Chậm một nhịp — đội khác đã bấm chuông trước!", "wrong");
                if (snap && snap.phase === "open") buzzBtn.disabled = iAmLocked();
            }
        });
    }
    buzzBtn.addEventListener("click", buzz);

    function answer(i) {
        if (gameEnded || !snap || snap.phase !== "answering" || !iAmBuzzer() || !myOptions || answeredQ === curQ) return;
        answeredQ = curQ;
        [...optionsEl.children].forEach((b) => { b.disabled = true; });
        socket.emit("v5_answer", { group: myGroup, choice: i });
    }

    // Kết quả riêng của đội mình (server gửi qua phòng riêng của nhóm)
    function onResult(r) {
        if (gameEnded || !r) return;
        setScore(r.diem);
        const pts = Math.abs(r.delta);
        if (r.correct) {
            setFeedback(`✅ Chính xác! +${pts} điểm`, "correct");
            showScorePopup("+" + pts);
        } else {
            setFeedback(`${r.timeout ? "⏱️ Hết giờ!" : "❌ Chưa đúng!"} −${pts} điểm`, "wrong");
            showScorePopup("−" + pts, true);
        }
    }

    function onKey(e) {
        if (gameEnded || !snap || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!stepGame.classList.contains("active")) return;
        if (e.code === "Space") {
            if (snap.phase === "open") { e.preventDefault(); buzz(); }
            return;
        }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4 && snap.phase === "answering") answer(n - 1);
    }

    function sync() {
        if (!socket || gameEnded) return;
        socket.emit("v5_sync", { group: myGroup }, (s) => { if (s) render(s); });
    }

    // ── Gắn / gỡ listener ──
    function bind() {
        if (bound || !socket) return;
        socket.on("v5_state", render);
        socket.on("v5_result", onResult);
        socket.on("connect", sync); // nối lại sau khi mất mạng → đồng bộ lại và vào lại phòng riêng
        document.addEventListener("keydown", onKey);
        bound = true;
    }
    function unbind() {
        if (!bound) return;
        socket.off("v5_state", render);
        socket.off("v5_result", onResult);
        socket.off("connect", sync);
        document.removeEventListener("keydown", onKey);
        bound = false;
    }

    // ── Vòng đời (cùng giao diện với các vòng khác) ──
    function preload() {
        return Promise.resolve(); // câu hỏi do server gửi theo từng pha, không có gì để tải trước
    }

    function resetState() {
        runId++;
        unbind();
        clearInterval(tickTimer);
        tickTimer = null;
        snap = null;
        curQ = 0;
        myBet = 10;
        myOptions = null;
        answeredQ = 0;
        buzzPending = false;
        gameEnded = false;
        onEnd = null;
        setScore(0);

        stepGame.classList.remove("game-ended");
        endScreen.style.display = "none";
        qCurrent.textContent = "–";
        qTotal.textContent = "?";
        statusEl.textContent = "Chuẩn bị câu hỏi đầu tiên...";
        [prepBox, questionBox, buzzBox, optionsEl, revealBox].forEach((n) => { n.hidden = true; });
        attemptsEl.textContent = "";
        setFeedback("");
        phaseEnd = 0;
        tick();
    }

    function start(opts) {
        resetState();
        socket = opts.socket;
        myGroup = opts.group || "";
        myTeamName = opts.teamName || myGroup;
        onEnd = opts.onEnd || null;
        bind();
        tickTimer = setInterval(tick, 200);
        sync();
        return Promise.resolve();
    }

    function stop() {
        resetState();
    }

    // Server tự kết thúc vòng (hết câu hỏi hoặc quá giới hạn thời gian) → round_ended → forceEnd
    function endGame() {
        if (gameEnded) return;
        gameEnded = true;
        unbind();
        clearInterval(tickTimer);
        tickTimer = null;
        stepGame.classList.add("game-ended");
        endScreen.style.display = "block";
        finalScore.textContent = score;
        const myRun = runId;
        setTimeout(() => { if (myRun === runId && onEnd) onEnd(score); }, END_SCREEN_MS);
    }
    const forceEnd = endGame;

    function showScorePopup(text, negative) {
        const popup = el("div", "score-popup" + (negative ? " neg" : ""), text);
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1000);
    }

    return { preload, start, stop, forceEnd };
})();