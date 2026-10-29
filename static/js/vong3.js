/**
 * Vòng 3 – Xếp dòng thời gian (chạy ngay trong trang chủ, dùng chung socket)
 * ─────────────────────────────────────────────────────────
 * Mỗi "câu" là một dãy vài sự kiện bị xáo trộn. Đội kéo thẻ vào các ô đánh số
 * (ô 1 = sớm nhất) hoặc bấm thẻ để tự vào ô trống đầu tiên, rồi bấm Kiểm tra:
 *   ô đúng bị khoá + hiện mốc thời gian + tính điểm, ô sai trả thẻ về khay để xếp lại.
 * Bỏ qua = hiện đáp án của các ô chưa đúng, không thêm điểm.
 * Trong vong_3.json, thứ tự các sự kiện trong mảng "su_kien" chính là thứ tự đúng.
 * Thẻ, ô thả, khay dùng lại class .v2-* (xem vong2.css); trục thời gian là .v3-*.
 *
 * API giống Vong1/Vong2:
 *   Vong3.preload()  Vong3.start({socket, group, teamName, onEnd})  Vong3.forceEnd()  Vong3.stop()
 */
const Vong3 = (() => {
    const $ = (id) => document.getElementById(id);
    const END_SCREEN_MS = 4000;
    const CIRCUMFERENCE = 2 * Math.PI * 45;

    // ── DOM refs ──
    const stepGame = $("step-game-3");
    const timerFill = $("v3-timer-fill");
    const timerText = $("v3-timer-text");
    const scoreValue = $("v3-score");
    const qCurrent = $("v3-q-current");
    const qTotal = $("v3-q-total");
    const promptText = $("v3-prompt");
    const rowsEl = $("v3-rows");
    const pool = $("v3-pool");
    const checkBtn = $("v3-check");
    const skipBtn = $("v3-skip");
    const feedback = $("v3-feedback");
    const endScreen = $("v3-end");
    const finalScore = $("v3-final-score");
    const endIcon = $("v3-end-icon");
    const endTitle = $("v3-end-title");
    const endDetail = $("v3-end-detail");
    timerFill.style.strokeDasharray = CIRCUMFERENCE;

    // ── State ──
    let socket = null, myGroup = "", myTeamName = "", onEnd = null;
    let boards = [], boardIndex = 0;
    let totalSlots = 0, pointsPerSlot = 10;
    let skipPenalty = 5;   // điểm trừ mỗi lần bấm Bỏ qua (server quy định, chỉnh trong .env)
    let score = 0, correctCount = 0, skippedCount = 0;
    let totalTime = parseInt(timerText.textContent, 10) || 180;
    let timeLeft = totalTime;
    let timerInterval = null;
    let gameEnded = false;
    let revealing = false;   // đang hiện kết quả → khoá kéo thả và các nút
    let runId = 0;           // tăng mỗi lần start/stop để huỷ các callback cũ
    let loadPromise = null;
    let drag = null;         // thao tác kéo đang diễn ra

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
    const pageRef = (b) => (b.trang ? ` (sách tr.${b.trang})` : "");

    // ── Tải dữ liệu (cache, gọi sớm trong lúc đếm ngược) ──
    function preload() {
        if (!loadPromise) {
            loadPromise = fetch("/api/vong3/data")
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
            if (myRun === runId) promptText.textContent = "Lỗi tải dữ liệu! Hãy thử tải lại trang.";
            return;
        }
        if (myRun !== runId || gameEnded) return;

        // Mỗi đội một thứ tự câu ngẫu nhiên; idx = vị trí gốc trong vong_2.json (server dùng để chấm)
        boards = shuffle(data.boards.map((b, i) => ({ ...b, idx: i })));
        pointsPerSlot = data.points_per_slot || 10;
        skipPenalty = data.skip_penalty ?? 5;
        totalSlots = boards.reduce((n, b) => n + b.su_kien.length, 0);
        totalTime = data.time || totalTime;
        timeLeft = totalTime;
        qTotal.textContent = boards.length;
        renderBoard();
        startTimer();
    }

    function resetState() {
        runId++;
        clearInterval(timerInterval);
        timerInterval = null;
        cancelDrag();
        gameEnded = false;
        revealing = false;
        onEnd = null;
        score = correctCount = skippedCount = 0;
        boardIndex = 0;
        boards = [];
        totalSlots = 0;
        timeLeft = totalTime;

        stepGame.classList.remove("game-ended");
        endScreen.style.display = "none";
        scoreValue.textContent = "0";
        qCurrent.textContent = "1";
        qTotal.textContent = "?";
        promptText.textContent = "Đang tải câu hỏi...";
        rowsEl.textContent = "";
        pool.textContent = "";
        setFeedback("");
        checkBtn.disabled = true;
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

    // reason: "complete" = xong mọi câu khi còn thời gian | "timeout" = hết giờ
    function endGame(reason) {
        if (gameEnded) return;
        cancelDrag();
        gameEnded = true;
        stepGame.classList.add("game-ended");
        endScreen.style.display = "block";
        finalScore.textContent = score;
        setFeedback("");

        const secondsLeft = Math.max(timeLeft, 0);
        const untouched = Math.max(totalSlots - correctCount - skippedCount, 0);
        const parts = [`${correctCount}/${totalSlots} vị trí đúng`];
        if (skippedCount > 0) parts.push(`${skippedCount} vị trí bỏ qua`);
        if (reason === "complete") {
            endIcon.textContent = "🏁";
            endTitle.textContent = "Hoàn thành tất cả các câu!";
            parts.unshift(`Còn dư ${secondsLeft} giây`);
        } else {
            endIcon.textContent = "⏱️";
            endTitle.textContent = "Hết giờ!";
            if (untouched > 0) parts.push(`${untouched} vị trí chưa làm`);
        }
        endDetail.textContent = parts.join(" · ");

        // Báo server mình đã xong (số vị trí được tính như "câu" ở vòng 1)
        if (socket) {
            socket.emit("round_finished", {
                group: myGroup,
                reason: reason === "complete" ? "complete" : "timeout",
                skipped: skippedCount,
                total: totalSlots,
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

    // ── Dựng câu hỏi ──
    function renderBoard() {
        if (boardIndex >= boards.length) {
            clearInterval(timerInterval);
            timerInterval = null;
            endGame("complete");
            return;
        }
        const b = boards[boardIndex];
        promptText.textContent = b.tieu_de;
        qCurrent.textContent = boardIndex + 1;
        rowsEl.textContent = "";
        pool.textContent = "";
        setFeedback("");
        revealing = false;

        // Ô theo đúng thứ tự 1..n; chỉ xáo thẻ. i là vị trí đúng của thẻ, server dùng để chấm
        b.su_kien.forEach((_, i) => rowsEl.append(buildRow(i)));
        shuffle(b.su_kien.map((_, i) => i)).forEach((i) => pool.append(buildCard(b.su_kien[i], i)));

        skipBtn.disabled = false;
        updateCheck();
        if (boardIndex > 0) window.scrollTo(0, 0);
    }

    function buildRow(pos) {
        const row = el("div", "v3-row");
        const slot = el("div", "v2-slot");
        slot.dataset.pair = pos;
        row.append(el("div", "v3-num", pos + 1), slot);
        return row;
    }

    function buildCard(p, i) {
        const card = el("button", "v2-card", p.de);
        card.dataset.moc = p.moc || "";
        card.type = "button";
        card.dataset.pair = i;
        card.addEventListener("pointerdown", onPointerDown);
        // Bàn phím (Enter/Space) sinh click với detail = 0; click của chuột/cảm ứng đã xử lý ở pointerup
        card.addEventListener("click", (e) => { if (e.detail === 0) handleTap(card); });
        return card;
    }

    // ═══ Kéo thả (chuột + cảm ứng, dùng Pointer Events) ═══
    function onPointerDown(e) {
        if (drag || gameEnded || revealing || e.button !== 0) return;
        const card = e.currentTarget;
        if (card.disabled) return;
        drag = { card, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
        try { card.setPointerCapture(e.pointerId); } catch (_) { /* không bắt buộc */ }
        card.addEventListener("pointermove", onPointerMove);
        card.addEventListener("pointerup", onPointerUp);
        card.addEventListener("pointercancel", cancelDrag);
    }

    function onPointerMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved) {
            if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; // còn là chạm
            drag.moved = true;
            const ghost = drag.card.cloneNode(true);
            ghost.className = "v2-card v2-ghost";
            ghost.style.width = drag.card.offsetWidth + "px";
            document.body.append(ghost);
            drag.ghost = ghost;
            drag.card.classList.add("lifted");
        }
        drag.ghost.style.left = e.clientX + "px";
        drag.ghost.style.top = e.clientY + "px";
        clearHighlights();
        const t = dropTargetAt(e.clientX, e.clientY);
        if (t) t.classList.add("drag-over");
    }

    function onPointerUp(e) {
        const d = endDrag();
        if (!d) return;
        if (!d.moved) { handleTap(d.card); return; }
        const target = dropTargetAt(e.clientX, e.clientY);
        if (target) place(d.card, target);
    }

    // Gỡ listener + thẻ ma, trả về trạng thái kéo vừa kết thúc
    function endDrag() {
        const d = drag;
        if (!d) return null;
        drag = null;
        d.card.removeEventListener("pointermove", onPointerMove);
        d.card.removeEventListener("pointerup", onPointerUp);
        d.card.removeEventListener("pointercancel", cancelDrag);
        d.card.classList.remove("lifted");
        if (d.ghost) d.ghost.remove();
        clearHighlights();
        return d;
    }
    function cancelDrag() { endDrag(); }

    function dropTargetAt(x, y) {
        const hit = document.elementFromPoint(x, y); // thẻ ma có pointer-events: none nên bị bỏ qua
        if (!hit) return null;
        const slot = hit.closest(".v2-slot");
        if (slot && rowsEl.contains(slot)) return slot.classList.contains("locked") ? null : slot;
        return hit.closest(".v2-pool") === pool ? pool : null;
    }

    function clearHighlights() {
        document.querySelectorAll(".v2-slot.drag-over, .v2-pool.drag-over").forEach((n) => n.classList.remove("drag-over"));
    }

    // Đặt thẻ vào ô / khay; ô đã có thẻ thì đổi chỗ
    function place(card, target) {
        const from = card.parentElement;
        if (target === from) return;
        if (target === pool) {
            pool.append(card);
        } else {
            const other = target.querySelector(".v2-card");
            if (other && other !== card) from.append(other); // thẻ cũ về chỗ thẻ mới vừa rời
            target.append(card);
        }
        refreshSlots();
        updateCheck();
    }

    function refreshSlots() {
        rowsEl.querySelectorAll(".v2-slot").forEach((s) => s.classList.toggle("filled", !!s.querySelector(".v2-card")));
    }

    function updateCheck() {
        const slots = [...rowsEl.querySelectorAll(".v2-slot")];
        checkBtn.disabled = revealing || slots.length === 0 || !slots.every((s) => s.querySelector(".v2-card"));
    }

    // ═══ Bấm thẻ: tự chuyển ═══
    // Thẻ ở khay → vào ô trống đầu tiên (duyệt từ trái sang phải, trên xuống dưới)
    // Thẻ đang ở ô → trả về khay
    function handleTap(card) {
        if (gameEnded || revealing || card.disabled) return;
        if (card.closest(".v2-slot")) {
            place(card, pool);
            return;
        }
        const empty = [...rowsEl.querySelectorAll(".v2-slot:not(.locked)")].find((s) => !s.querySelector(".v2-card"));
        if (empty) place(card, empty);
    }

    // ═══ Kiểm tra ═══
    checkBtn.addEventListener("click", () => {
        if (gameEnded || revealing || checkBtn.disabled) return;
        const b = boards[boardIndex];
        const fresh = [];  // vị trí vừa đúng ở lần kiểm tra này
        const wrong = [];

        for (const slot of rowsEl.querySelectorAll(".v2-slot")) {
            if (slot.classList.contains("locked")) continue;
            const card = slot.querySelector(".v2-card");
            if (card.dataset.pair === slot.dataset.pair) {
                slot.classList.add("locked", "correct");
                card.disabled = true;
                showMoc(card);
                fresh.push(+slot.dataset.pair);
            } else {
                slot.classList.add("wrong");
                wrong.push(slot);
            }
        }

        if (fresh.length) {
            const gain = fresh.length * pointsPerSlot;
            score += gain;
            correctCount += fresh.length;
            scoreValue.textContent = score;
            showScorePopup("+" + gain);
            if (socket) socket.emit("vong3_correct", { group: myGroup, team_name: myTeamName, board: b.idx, pairs: fresh });
        }

        revealing = true;
        checkBtn.disabled = true;
        skipBtn.disabled = true;
        const myRun = runId;

        if (wrong.length === 0) {
            setFeedback("✅ Chính xác!" + pageRef(b), "correct");
            setTimeout(() => {
                if (myRun !== runId || gameEnded) return;
                boardIndex++;
                renderBoard();
            }, 900);
        } else {
            setFeedback(`❌ ${wrong.length} vị trí chưa đúng. Hãy đổi lại!`, "wrong");
            setTimeout(() => {
                if (myRun !== runId || gameEnded) return;
                wrong.forEach((slot) => {
                    slot.classList.remove("wrong");
                    pool.append(slot.querySelector(".v2-card"));
                });
                revealing = false;
                skipBtn.disabled = false;
                refreshSlots();
                updateCheck();
            }, 900);
        }
    });

    // ═══ Bỏ qua: hiện đáp án các vị trí chưa đúng, không cộng điểm ═══
    skipBtn.addEventListener("click", () => {
        if (gameEnded || revealing || skipBtn.disabled) return;
        const b = boards[boardIndex];
        revealing = true;
        checkBtn.disabled = true;
        skipBtn.disabled = true;

        const open = [...rowsEl.querySelectorAll(".v2-slot:not(.locked)")];
        skippedCount += open.length;
        applySkipPenalty(b.idx);

        // Gom mọi thẻ chưa khoá (ở khay hoặc ở ô) rồi đưa về đúng ô
        const cards = [...pool.querySelectorAll(".v2-card"), ...open.map((s) => s.querySelector(".v2-card")).filter(Boolean)];
        open.forEach((slot) => {
            const card = cards.find((c) => c.dataset.pair === slot.dataset.pair);
            slot.append(card);
            card.disabled = true;
            showMoc(card);
            slot.classList.remove("wrong");
            slot.classList.add("locked", "revealed");
        });
        refreshSlots();

        setFeedback("💡 Đáp án đã hiện" + pageRef(b) + (skipPenalty > 0 ? ` · −${skipPenalty} điểm` : ""), "skipped");
        const myRun = runId;
        setTimeout(() => {
            if (myRun !== runId || gameEnded) return;
            boardIndex++;
            renderBoard();
        }, 2600);
    });

    function showMoc(card) {
        if (card.dataset.moc && !card.querySelector(".v3-moc")) card.append(el("span", "v3-moc", card.dataset.moc));
    }

    // Bỏ qua bị trừ điểm: trừ ngay ở máy đội và báo server (server là nơi tính điểm thật)
    function applySkipPenalty(item) {
        if (skipPenalty <= 0) return;
        score -= skipPenalty; // điểm có thể âm
        scoreValue.textContent = score;
        showScorePopup("−" + skipPenalty, true);
        if (socket) socket.emit("skip_item", { group: myGroup, vong: 3, item });
    }

    function showScorePopup(text, negative) {
        const popup = el("div", "score-popup" + (negative ? " neg" : ""), text);
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1000);
    }

    return { preload, start, stop, forceEnd };
})();