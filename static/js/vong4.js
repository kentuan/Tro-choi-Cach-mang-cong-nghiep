/**
 * Vòng 4 – Phân loại vào 4 cuộc cách mạng công nghiệp (chạy ngay trong trang chủ, dùng chung socket)
 * ─────────────────────────────────────────────────────────
 * Hiện lần lượt từng thẻ từ khoá. Đội chọn ô cách mạng công nghiệp bằng cách bấm ô,
 * kéo thẻ vào ô, hoặc bấm phím 1–4. Mỗi thẻ chỉ có MỘT lần trả lời:
 *   đúng = +điểm, sai = −điểm nhẹ (tổng điểm vòng có thể âm), cả hai đều hiện đáp án đúng rồi sang thẻ sau.
 *   Bỏ qua = hiện đáp án và bị trừ điểm (mức do server quy định, chỉnh trong .env).
 * Server tự chấm theo vong_4.json (client chỉ gửi thẻ nào, chọn ô nào) và chỉ tính lần đầu của mỗi thẻ.
 *
 * API giống Vong1/2/3:
 *   Vong4.preload()  Vong4.start({socket, group, teamName, onEnd})  Vong4.forceEnd()  Vong4.stop()
 */
const Vong4 = (() => {
    const $ = (id) => document.getElementById(id);
    const END_SCREEN_MS = 4000;
    const NEXT_RIGHT_MS = 800;    // đúng: sang thẻ sau gần như ngay
    const NEXT_REVEAL_MS = 1800;  // sai / bỏ qua: chừa thời gian đọc đáp án
    const CIRCUMFERENCE = 2 * Math.PI * 45;

    // ── DOM refs ──
    const stepGame = $("step-game-4");
    const timerFill = $("v4-timer-fill");
    const timerText = $("v4-timer-text");
    const scoreValue = $("v4-score");
    const qCurrent = $("v4-q-current");
    const qTotal = $("v4-q-total");
    const cardEl = $("v4-card");
    const binsEl = $("v4-bins");
    const skipBtn = $("v4-skip");
    const feedback = $("v4-feedback");
    const endScreen = $("v4-end");
    const finalScore = $("v4-final-score");
    const endIcon = $("v4-end-icon");
    const endTitle = $("v4-end-title");
    const endDetail = $("v4-end-detail");
    timerFill.style.strokeDasharray = CIRCUMFERENCE;

    // ── State ──
    let socket = null, myGroup = "", myTeamName = "", onEnd = null;
    let cards = [], binNames = [], cardIndex = 0;
    let pointsRight = 10, pointsWrong = 5, skipPenalty = 5;
    let score = 0, correctCount = 0, wrongCount = 0, skippedCount = 0;
    let totalTime = parseInt(timerText.textContent, 10) || 120;
    let timeLeft = totalTime;
    let timerInterval = null;
    let gameEnded = false;
    let locked = true;     // đang hiện đáp án / chưa có thẻ → không nhận trả lời
    let runId = 0;         // tăng mỗi lần start/stop để huỷ các callback cũ
    let loadPromise = null;
    let drag = null;

    // ── Helpers ──
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
    function setFeedback(text, cls) {
        feedback.textContent = text;
        feedback.className = "feedback" + (cls ? " " + cls : "");
    }
    const pageRef = (c) => (c.trang ? ` (sách tr.${c.trang})` : "");
    const lopName = (i) => "cách mạng công nghiệp " + binNames[i].toLowerCase();

    // ── Tải dữ liệu (cache, gọi sớm trong lúc đếm ngược) ──
    function preload() {
        if (!loadPromise) {
            loadPromise = fetch("/api/vong4/data")
                .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
                .catch((err) => { loadPromise = null; throw err; });
        }
        return loadPromise;
    }

    async function start(opts) {
        resetState();
        const myRun = ++runId;
        socket = opts.socket;
        myGroup = opts.group || "";
        myTeamName = opts.teamName || myGroup;
        onEnd = opts.onEnd || null;

        let data;
        try {
            data = await preload();
        } catch (err) {
            if (myRun === runId) cardEl.textContent = "Lỗi tải dữ liệu! Hãy thử tải lại trang.";
            return;
        }
        if (myRun !== runId || gameEnded) return;

        binNames = data.ten_lop;
        // Mỗi đội một thứ tự thẻ ngẫu nhiên; idx = vị trí gốc trong vong_4.json (server dùng để chấm)
        cards = shuffle(data.the.map((c, i) => ({ ...c, idx: i })));
        pointsRight = data.points_right ?? 10;
        pointsWrong = data.points_wrong ?? 5;
        skipPenalty = data.skip_penalty ?? 5;
        totalTime = data.time || totalTime;
        timeLeft = totalTime;
        qTotal.textContent = cards.length;

        buildBins();
        showCard();
        startTimer();
        document.addEventListener("keydown", onKey);
    }

    function resetState() {
        runId++;
        clearInterval(timerInterval);
        timerInterval = null;
        document.removeEventListener("keydown", onKey);
        drag = null;
        gameEnded = false;
        locked = true;
        onEnd = null;
        score = correctCount = wrongCount = skippedCount = 0;
        cardIndex = 0;
        cards = [];
        timeLeft = totalTime;

        stepGame.classList.remove("game-ended");
        endScreen.style.display = "none";
        scoreValue.textContent = "0";
        qCurrent.textContent = "1";
        qTotal.textContent = "?";
        cardEl.className = "v4-card";
        cardEl.style.transform = "";
        cardEl.textContent = "Đang tải câu hỏi...";
        binsEl.textContent = "";
        setFeedback("");
        skipBtn.disabled = true;
        updateTimerDisplay();
    }

    function stop() {
        resetState();
        loadPromise = null;
    }

    // ── Timer ──
    function startTimer() {
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            timeLeft--;
            updateTimerDisplay();
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                endGame("timeout");
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        const t = Math.max(timeLeft, 0);
        timerText.textContent = t;
        timerFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - t / totalTime);
        timerFill.classList.remove("warning", "danger");
        if (timeLeft <= 10) timerFill.classList.add("danger");
        else if (timeLeft <= 30) timerFill.classList.add("warning");
    }

    // reason: "complete" = xong mọi thẻ khi còn thời gian | "timeout" = hết giờ
    function endGame(reason) {
        if (gameEnded) return;
        gameEnded = true;
        locked = true;
        drag = null;
        document.removeEventListener("keydown", onKey);
        stepGame.classList.add("game-ended");
        endScreen.style.display = "block";
        finalScore.textContent = score;
        setFeedback("");

        const secondsLeft = Math.max(timeLeft, 0);
        const total = cards.length;
        const untouched = Math.max(total - correctCount - wrongCount - skippedCount, 0);
        const parts = [`${correctCount}/${total} thẻ đúng`];
        if (wrongCount > 0) parts.push(`${wrongCount} sai`);
        if (skippedCount > 0) parts.push(`${skippedCount} bỏ qua`);
        if (reason === "complete") {
            endIcon.textContent = "🏁";
            endTitle.textContent = "Hoàn thành tất cả các thẻ!";
            parts.unshift(`Còn dư ${secondsLeft} giây`);
        } else {
            endIcon.textContent = "⏱️";
            endTitle.textContent = "Hết giờ!";
            if (untouched > 0) parts.push(`${untouched} thẻ chưa làm`);
        }
        endDetail.textContent = parts.join(" · ");

        // Báo server mình đã xong (số đúng/sai server tự đếm từ các câu trả lời đã nhận)
        if (socket) {
            socket.emit("round_finished", {
                group: myGroup,
                reason: reason === "complete" ? "complete" : "timeout",
                skipped: skippedCount,
                total,
                time_left: secondsLeft,
            });
        }

        const myRun = runId;
        setTimeout(() => { if (myRun === runId && onEnd) onEnd(score); }, END_SCREEN_MS);
    }

    function forceEnd() {
        if (gameEnded) return;
        clearInterval(timerInterval);
        timerInterval = null;
        endGame("timeout");
    }

    // ── Dựng giao diện ──
    function buildBins() {
        binsEl.textContent = "";
        binNames.forEach((name, i) => {
            const b = el("button", "v4-bin");
            b.type = "button";
            b.dataset.bin = i;
            b.append(el("span", "v4-bin-num", i + 1), el("span", "v4-bin-label", name));
            b.addEventListener("click", () => answer(i));
            binsEl.append(b);
        });
    }

    function showCard() {
        if (cardIndex >= cards.length) {
            clearInterval(timerInterval);
            timerInterval = null;
            endGame("complete");
            return;
        }
        const c = cards[cardIndex];
        qCurrent.textContent = cardIndex + 1;
        [...binsEl.children].forEach((b) => b.classList.remove("correct", "wrong", "revealed", "drag-over"));
        cardEl.className = "v4-card";
        cardEl.style.transform = "";
        cardEl.textContent = c.tu;
        void cardEl.offsetWidth; // chạy lại animation xuất hiện cho mỗi thẻ
        cardEl.classList.add("enter");
        setFeedback("");
        locked = false;
        skipBtn.disabled = false;
    }

    function next(ms) {
        const myRun = runId;
        setTimeout(() => {
            if (myRun !== runId || gameEnded) return;
            cardIndex++;
            showCard();
        }, ms);
    }

    // ── Trả lời / bỏ qua ──
    function answer(binIdx) {
        if (gameEnded || locked || !cards[cardIndex]) return;
        const c = cards[cardIndex];
        const right = binIdx === c.lop;
        locked = true;
        skipBtn.disabled = true;

        binsEl.children[c.lop].classList.add("correct");
        cardEl.classList.remove("enter");

        if (right) {
            score += pointsRight;
            correctCount++;
            showScorePopup("+" + pointsRight);
            cardEl.classList.add("ok");
            setFeedback("✅ Chính xác!" + pageRef(c), "correct");
        } else {
            binsEl.children[binIdx].classList.add("wrong");
            score -= pointsWrong; // server tính giống vậy, điểm có thể âm
            wrongCount++;
            showScorePopup("−" + pointsWrong, true);
            cardEl.classList.add("bad");
            setFeedback(`❌ Chưa đúng: thuộc ${lopName(c.lop)}` + pageRef(c), "wrong");
        }
        scoreValue.textContent = score;

        if (socket) {
            const myRun = runId;
            socket.emit("vong4_answer", { group: myGroup, team_name: myTeamName, card: c.idx, bin: binIdx }, (res) => {
                // Đối chiếu với tổng điểm server vừa tính từ điểm hiện tại (kể cả khi đang âm: -20 + 10 = -10)
                if (myRun !== runId || !res || typeof res.diem !== "number") return;
                score = res.diem;
                scoreValue.textContent = score;
                finalScore.textContent = score;
            });
        }
        next(right ? NEXT_RIGHT_MS : NEXT_REVEAL_MS);
    }

    skipBtn.addEventListener("click", () => {
        if (gameEnded || locked || skipBtn.disabled || !cards[cardIndex]) return;
        const c = cards[cardIndex];
        locked = true;
        skipBtn.disabled = true;
        skippedCount++;
        if (skipPenalty > 0) {
            score -= skipPenalty; // điểm có thể âm
            scoreValue.textContent = score;
            showScorePopup("−" + skipPenalty, true);
            if (socket) {
                const myRun = runId;
                socket.emit("skip_item", { group: myGroup, vong: 4, item: c.idx }, (res) => {
                    // Đối chiếu với tổng điểm server vừa tính
                    if (myRun !== runId || !res || typeof res.diem !== "number") return;
                    score = res.diem;
                    scoreValue.textContent = score;
                    finalScore.textContent = score;
                });
            }
        }
        binsEl.children[c.lop].classList.add("revealed");
        cardEl.classList.remove("enter");
        cardEl.classList.add("skipped");
        setFeedback(`💡 Đáp án: ${lopName(c.lop)}` + pageRef(c) + (skipPenalty > 0 ? ` · −${skipPenalty} điểm` : ""), "skipped");
        next(NEXT_REVEAL_MS);
    });

    // Phím 1–4 chọn ô tương ứng
    function onKey(e) {
        if (gameEnded || locked || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!stepGame.classList.contains("active")) return;
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= binNames.length) answer(n - 1);
    }

    // ═══ Kéo thẻ vào ô (chuột + cảm ứng, dùng Pointer Events) ═══
    function binAt(x, y) {
        // Thẻ đang nằm dưới con trỏ nên dùng elementsFromPoint để tìm ô phía dưới
        for (const n of document.elementsFromPoint(x, y)) {
            const b = n.closest && n.closest(".v4-bin");
            if (b && binsEl.contains(b)) return b;
        }
        return null;
    }
    function highlight(bin) {
        [...binsEl.children].forEach((b) => b.classList.toggle("drag-over", b === bin));
    }

    cardEl.addEventListener("pointerdown", (e) => {
        if (drag || gameEnded || locked || e.button !== 0) return;
        drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
        try { cardEl.setPointerCapture(e.pointerId); } catch (_) { /* không bắt buộc */ }
    });
    cardEl.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x0;
        const dy = e.clientY - drag.y0;
        if (!drag.moved) {
            if (Math.hypot(dx, dy) < 6) return; // còn là chạm
            drag.moved = true;
            cardEl.classList.remove("enter");
            cardEl.classList.add("dragging");
        }
        cardEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
        highlight(binAt(e.clientX, e.clientY));
    });
    function finishDrag(e, cancelled) {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        cardEl.classList.remove("dragging");
        highlight(null);
        if (!d.moved) return;
        const bin = cancelled ? null : binAt(e.clientX, e.clientY);
        cardEl.style.transform = ""; // thả ngoài ô → thẻ trượt về chỗ cũ
        if (bin) answer(+bin.dataset.bin);
    }
    cardEl.addEventListener("pointerup", (e) => finishDrag(e, false));
    cardEl.addEventListener("pointercancel", (e) => finishDrag(e, true));

    function showScorePopup(text, negative) {
        const popup = el("div", "score-popup" + (negative ? " neg" : ""), text);
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1000);
    }

    return { preload, start, stop, forceEnd };
})();