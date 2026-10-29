/**
 * Vòng 1 – Sắp xếp chữ cái (chạy ngay trong trang chủ, dùng chung socket)
 * ─────────────────────────────────────────────────────────
 * API:
 *   Vong1.preload()                       tải sẵn câu hỏi trong lúc chờ BTC
 *   Vong1.start({socket, group, teamName, onEnd})  vào chơi ngay lập tức;
 *                                         onEnd() được gọi sau khi hết vòng + vài giây hiện điểm
 *   Vong1.forceEnd()                      kết thúc ngay (khi server báo hết vòng)
 *   Vong1.stop()                          dừng + dọn sạch (khi reset / quay về màn chờ)
 */
const Vong1 = (() => {
    const $ = (id) => document.getElementById(id);

    // ── DOM refs ──
    const stepGame = $("step-game");
    const timerFill = $("timer-fill");
    const timerText = $("timer-text");
    const scoreValue = $("score-value");
    const qCurrent = $("q-current");
    const qTotal = $("q-total");
    const questionText = $("question-text");
    const tilesPool = $("tiles-pool");
    const answerSlots = $("answer-slots");
    const checkBtn = $("check-btn");
    const skipBtn = $("skip-btn");
    const feedback = $("feedback");
    const endScreen = $("end-screen");
    const finalScore = $("final-score");
    const endIcon = $("end-icon");
    const endTitle = $("end-title");
    const endDetail = $("end-detail");

    const END_SCREEN_MS = 4000; // hiện điểm cuối bao lâu thì quay về màn chờ
    const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45
    timerFill.style.strokeDasharray = CIRCUMFERENCE;

    // ── State ──
    let socket = null;
    let myGroup = "";
    let myTeamName = "";
    let onEnd = null;
    let questions = [];
    let currentIndex = 0;
    let score = 0;
    let totalTime = parseInt(timerText.textContent, 10) || 90;
    let timeLeft = totalTime;
    let timerInterval = null;
    let gameEnded = false;
    let correctCount = 0;   // số câu trả lời đúng
    let skippedCount = 0;   // số câu bỏ qua
    let pointsPerCorrect = 5, skipPenalty = 5; // do server quy định (chỉnh trong .env)
    let revealing = false;  // đang hiện kết quả (đúng / bỏ qua) → khoá kéo thả và các nút
    let runId = 0;          // tăng mỗi lần start/stop để huỷ các callback cũ
    let loadPromise = null;

    // ── Tải câu hỏi (cache, gọi sớm trong lúc chờ) ──
    function preload() {
        if (!loadPromise) {
            loadPromise = fetch("/api/vong1/data")
                .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
                .catch((err) => { loadPromise = null; throw err; });
        }
        return loadPromise;
    }

    async function start(opts) {
        stop();
        const myRun = ++runId;
        socket = opts.socket;
        myGroup = opts.group || "";
        myTeamName = opts.teamName || myGroup;
        onEnd = opts.onEnd || null;

        let data;
        try {
            data = await preload();
        } catch (err) {
            if (myRun === runId) questionText.textContent = "Lỗi tải dữ liệu! Hãy thử tải lại trang.";
            return;
        }
        if (myRun !== runId || gameEnded) return; // đã bị reset / bị kết thúc trong lúc tải

        // idx = số thứ tự gốc của câu trong vong_1.json (server dùng để chống tính trùng)
        questions = shuffleArray(data.questions.map((q, i) => ({ ...q, idx: i })));
        pointsPerCorrect = data.points_per_correct ?? 5;
        skipPenalty = data.skip_penalty ?? 5;
        totalTime = data.time || totalTime;
        timeLeft = totalTime;
        qTotal.textContent = questions.length;
        renderQuestion();
        startTimer();
    }

    function stop() {
        runId++;
        clearInterval(timerInterval);
        timerInterval = null;
        cancelDrag();
        gameEnded = false;
        revealing = false;
        onEnd = null;
        score = 0;
        correctCount = 0;
        skippedCount = 0;
        currentIndex = 0;
        questions = [];
        loadPromise = null;
        timeLeft = totalTime;

        stepGame.classList.remove("game-ended");
        endScreen.style.display = "none";
        scoreValue.textContent = "0";
        qCurrent.textContent = "1";
        qTotal.textContent = "?";
        questionText.textContent = "Đang tải câu hỏi...";
        tilesPool.innerHTML = "";
        answerSlots.innerHTML = "";
        feedback.textContent = "";
        feedback.className = "feedback";
        checkBtn.disabled = true;
        skipBtn.disabled = true;
        updateTimerDisplay();
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
        timerText.textContent = Math.max(timeLeft, 0);

        const fraction = Math.max(timeLeft, 0) / totalTime;
        timerFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - fraction);

        timerFill.classList.remove("warning", "danger");
        if (timeLeft <= 10) {
            timerFill.classList.add("danger");
        } else if (timeLeft <= 30) {
            timerFill.classList.add("warning");
        }
    }

    // reason: "complete" = đi hết danh sách câu hỏi khi còn thời gian | "timeout" = hết giờ
    function endGame(reason) {
        if (gameEnded) return;
        cancelDrag();
        gameEnded = true;
        stepGame.classList.add("game-ended");
        endScreen.style.display = "block";
        finalScore.textContent = score;
        feedback.textContent = "";

        const secondsLeft = Math.max(timeLeft, 0);
        const total = questions.length;
        const untouched = Math.max(total - correctCount - skippedCount, 0);

        // Màn kết thúc: phân biệt "xong sớm" với "hết giờ"
        const parts = [`${correctCount} câu đúng`, `${skippedCount} câu bỏ qua`];
        if (reason === "complete") {
            endIcon.textContent = "🏁";
            endTitle.textContent = "Hoàn thành tất cả câu hỏi!";
            parts.unshift(`Còn dư ${secondsLeft} giây`);
        } else {
            endIcon.textContent = "⏱️";
            endTitle.textContent = "Hết giờ!";
            if (untouched > 0) parts.push(`${untouched} câu chưa làm`);
        }
        endDetail.textContent = parts.join(" · ");

        // Báo server mình đã xong kèm số liệu (khi cả 4 đội xong, server kết thúc vòng sớm)
        if (socket) {
            socket.emit("round_finished", {
                group: myGroup,
                reason: reason === "complete" ? "complete" : "timeout",
                skipped: skippedCount,
                total,
                time_left: secondsLeft,
            });
        }

        // Hiện điểm vài giây rồi quay về màn chờ
        const myRun = runId;
        setTimeout(() => {
            if (myRun === runId && onEnd) onEnd(score);
        }, END_SCREEN_MS);
    }

    // Server báo hết vòng mà mình chưa kết thúc → kết thúc ngay
    function forceEnd() {
        if (gameEnded) return;
        clearInterval(timerInterval);
        timerInterval = null;
        endGame("timeout");
    }

    // ── Render current question ──
    function renderQuestion() {
        if (currentIndex >= questions.length) {
            clearInterval(timerInterval);
            endGame("complete");
            return;
        }

        const q = questions[currentIndex];
        questionText.textContent = q.cau_hoi;
        qCurrent.textContent = currentIndex + 1;

        const chars = q.tu_dung.split("").filter((c) => c !== " ");
        const shuffled = shuffleArray([...chars]);

        tilesPool.innerHTML = "";
        answerSlots.innerHTML = "";
        feedback.textContent = "";
        feedback.className = "feedback";
        checkBtn.disabled = true;
        skipBtn.disabled = false;
        revealing = false;

        shuffled.forEach((char, idx) => tilesPool.appendChild(createTile(char, idx)));

        chars.forEach((_, idx) => {
            const slot = document.createElement("div");
            slot.className = "answer-slot";
            slot.dataset.index = idx;
            answerSlots.appendChild(slot);
        });

        updateCheckButton();
    }

    function createTile(char, id) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.textContent = char;
        tile.dataset.tileId = id;
        tile.setAttribute("role", "button");
        tile.setAttribute("tabindex", "0");
        tile.setAttribute("aria-label", `Chữ cái ${char}`);
        tile.addEventListener("mousedown", onDragStart);
        tile.addEventListener("touchstart", onDragStart, { passive: false });
        tile.addEventListener("keydown", (e) => {
            if ((e.key === "Enter" || e.key === " ") && tile.parentElement === tilesPool) {
                e.preventDefault();
                placeTileInNextEmptySlot(tile);
            }
        });
        return tile;
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ═══════════════════════════════════════════════════════════
    // DRAG AND DROP ENGINE (Mouse + Touch)
    // ═══════════════════════════════════════════════════════════
    let dragState = null;

    function onDragStart(e) {
        if (gameEnded || revealing) return;
        e.preventDefault();

        const tile = e.currentTarget;
        const isTouch = e.type === "touchstart";
        const point = isTouch ? e.touches[0] : e;

        const rect = tile.getBoundingClientRect();

        // Remember where tile came from
        const parent = tile.parentElement;
        const fromSlot = parent.classList.contains("answer-slot") ? parent : null;
        const fromPool = parent.id === "tiles-pool" ? parent : null;

        dragState = {
            tile,
            fromSlot,
            fromPool,
            offsetX: point.clientX - rect.left,
            offsetY: point.clientY - rect.top,
            startX: rect.left,
            startY: rect.top,
            pointerStartX: point.clientX,
            pointerStartY: point.clientY,
            isTouch,
        };

        // Make tile float
        tile.classList.add("dragging");
        tile.style.position = "fixed";
        tile.style.left = rect.left + "px";
        tile.style.top = rect.top + "px";
        tile.style.width = rect.width + "px";
        tile.style.height = rect.height + "px";
        tile.style.margin = "0";
        tile.style.zIndex = "1000";
        document.body.appendChild(tile);

        if (isTouch) {
            document.addEventListener("touchmove", onDragMove, { passive: false });
            document.addEventListener("touchend", onDragEnd);
            document.addEventListener("touchcancel", onDragEnd);
        } else {
            document.addEventListener("mousemove", onDragMove);
            document.addEventListener("mouseup", onDragEnd);
        }
    }

    function onDragMove(e) {
        if (!dragState) return;
        e.preventDefault();

        const point = dragState.isTouch ? e.touches[0] : e;
        dragState.tile.style.left = (point.clientX - dragState.offsetX) + "px";
        dragState.tile.style.top = (point.clientY - dragState.offsetY) + "px";

        // Highlight drop targets
        highlightDropTarget(point.clientX, point.clientY);
    }

    function onDragEnd(e) {
        if (!dragState) return;

        const point = dragState.isTouch
            ? (e.changedTouches ? e.changedTouches[0] : null)
            : e;
        const wasTap = point && Math.hypot(
            point.clientX - dragState.pointerStartX,
            point.clientY - dragState.pointerStartY
        ) < 8;

        // Remove event listeners
        if (dragState.isTouch) {
            document.removeEventListener("touchmove", onDragMove);
            document.removeEventListener("touchend", onDragEnd);
            document.removeEventListener("touchcancel", onDragEnd);
        } else {
            document.removeEventListener("mousemove", onDragMove);
            document.removeEventListener("mouseup", onDragEnd);
        }

        // Find drop target
        const target = point ? findDropTarget(point.clientX, point.clientY) : null;

        clearHighlights();

        const { tile, fromSlot, fromPool } = dragState;

        // Reset tile styles
        tile.classList.remove("dragging");
        tile.style.position = "";
        tile.style.left = "";
        tile.style.top = "";
        tile.style.width = "";
        tile.style.height = "";
        tile.style.margin = "";
        tile.style.zIndex = "";

        if (wasTap) {
            returnToOrigin(tile, fromSlot, fromPool);
            dragState = null;
            if (fromPool) placeTileInNextEmptySlot(tile);
            updateSlotStates();
            updateCheckButton();
            return;
        }

        if (target) {
            if (target.classList.contains("answer-slot")) {
                // Dropping into an answer slot
                const existingTile = target.querySelector(".tile");

                if (existingTile && existingTile !== tile) {
                    // Swap: move existing tile to where dragged tile came from
                    if (fromSlot) {
                        // Both are in slots → swap
                        animateTileToElement(existingTile, fromSlot);
                    } else {
                        // Dragged from pool → send existing to pool
                        animateTileToElement(existingTile, tilesPool);
                    }
                }

                // Place tile in target slot
                target.appendChild(tile);
                target.classList.add("filled");

            } else if (target.id === "tiles-pool" || target === tilesPool) {
                // Dropping back to pool
                tilesPool.appendChild(tile);
                if (fromSlot) {
                    fromSlot.classList.remove("filled");
                }
            } else {
                // Invalid target → return to origin
                returnToOrigin(tile, fromSlot, fromPool);
            }
        } else {
            // No target → return to origin
            returnToOrigin(tile, fromSlot, fromPool);
        }

        // Clean up slot states
        updateSlotStates();
        updateCheckButton();

        dragState = null;
    }

    function placeTileInNextEmptySlot(tile) {
        if (gameEnded || revealing || !tile || tile.parentElement !== tilesPool) return;
        const target = Array.from(answerSlots.querySelectorAll(".answer-slot"))
            .find((slot) => !slot.querySelector(".tile"));
        if (!target) return;
        target.appendChild(tile);
        target.classList.add("filled");
        updateSlotStates();
        updateCheckButton();
    }

    function returnToOrigin(tile, fromSlot, fromPool) {
        if (fromSlot) {
            fromSlot.appendChild(tile);
        } else if (fromPool) {
            fromPool.appendChild(tile);
        } else {
            tilesPool.appendChild(tile);
        }
    }

    // ── Animate tile movement ──
    function animateTileToElement(tile, targetEl) {
        const tileRect = tile.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        // Temporarily position fixed
        const clone = tile;
        clone.style.position = "fixed";
        clone.style.left = tileRect.left + "px";
        clone.style.top = tileRect.top + "px";
        clone.style.width = tileRect.width + "px";
        clone.style.height = tileRect.height + "px";
        clone.style.zIndex = "999";
        clone.style.margin = "0";
        document.body.appendChild(clone);

        // Calculate target position
        let targetLeft, targetTop;

        if (targetEl.classList && targetEl.classList.contains("answer-slot")) {
            targetLeft = targetRect.left + (targetRect.width - tileRect.width) / 2;
            targetTop = targetRect.top + (targetRect.height - tileRect.height) / 2;
        } else {
            // Pool: just append (centered roughly)
            targetLeft = targetRect.left + targetRect.width / 2 - tileRect.width / 2;
            targetTop = targetRect.top + targetRect.height / 2 - tileRect.height / 2;
        }

        clone.classList.add("animating");

        requestAnimationFrame(() => {
            clone.style.left = targetLeft + "px";
            clone.style.top = targetTop + "px";
        });

        setTimeout(() => {
            clone.classList.remove("animating");
            clone.style.position = "";
            clone.style.left = "";
            clone.style.top = "";
            clone.style.width = "";
            clone.style.height = "";
            clone.style.zIndex = "";
            clone.style.margin = "";

            // Thẻ đã bị chỗ khác xếp đi (vd. bấm Bỏ qua / reset trong lúc bay) → không đặt lại nữa
            if (clone.parentElement !== document.body) return;

            targetEl.appendChild(clone);

            if (targetEl.classList && targetEl.classList.contains("answer-slot")) {
                targetEl.classList.add("filled");
            }

            // Thẻ vừa hạ cánh → cập nhật ô và nút Kiểm tra (lúc thả thẻ ô này còn trống nên nút đang bị khoá)
            updateSlotStates();
            updateCheckButton();
        }, 350);
    }

    // ── Drop target detection ──
    function findDropTarget(x, y) {
        // Check answer slots first
        const slots = answerSlots.querySelectorAll(".answer-slot");
        for (const slot of slots) {
            const rect = slot.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return slot;
            }
        }

        // Check pool
        const poolRect = tilesPool.getBoundingClientRect();
        if (x >= poolRect.left && x <= poolRect.right && y >= poolRect.top && y <= poolRect.bottom) {
            return tilesPool;
        }

        return null;
    }

    function highlightDropTarget(x, y) {
        clearHighlights();
        const target = findDropTarget(x, y);
        if (target) {
            target.classList.add("drag-over");
        }
    }

    function clearHighlights() {
        document.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    }

    function updateSlotStates() {
        answerSlots.querySelectorAll(".answer-slot").forEach(slot => {
            const hasTile = slot.querySelector(".tile") !== null;
            slot.classList.toggle("filled", hasTile);
        });
    }

    // Huỷ thao tác kéo đang dở (khi hết giờ / reset)
    function cancelDrag() {
        if (!dragState) return;
        document.removeEventListener("touchmove", onDragMove);
        document.removeEventListener("touchend", onDragEnd);
        document.removeEventListener("touchcancel", onDragEnd);
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        dragState.tile.remove();
        dragState = null;
        clearHighlights();
    }

    // ── Check button state ──
    function updateCheckButton() {
        const slots = answerSlots.querySelectorAll(".answer-slot");
        checkBtn.disabled = !Array.from(slots).every((slot) => slot.querySelector(".tile"));
    }

    // ── Check answer ──
    checkBtn.addEventListener("click", () => {
        if (gameEnded || currentIndex >= questions.length) return;

        const q = questions[currentIndex];
        const correctChars = q.tu_dung.split("").filter((c) => c !== " ");

        const slots = answerSlots.querySelectorAll(".answer-slot");
        const userChars = Array.from(slots).map((slot) => {
            const tile = slot.querySelector(".tile");
            return tile ? tile.textContent : "";
        });

        const isCorrect = userChars.every((char, i) => char === correctChars[i]);

        if (isCorrect) {
            feedback.textContent = "✅ Chính xác!";
            feedback.className = "feedback correct";

            slots.forEach((slot) => {
                slot.classList.remove("wrong");
                slot.classList.add("correct");
            });

            score += pointsPerCorrect;
            correctCount++;
            scoreValue.textContent = score;
            showScorePopup("+" + pointsPerCorrect);

            if (socket) {
                socket.emit("vong1_correct", { group: myGroup, team_name: myTeamName, idx: q.idx });
            }

            checkBtn.disabled = true;
            skipBtn.disabled = true;
            revealing = true;
            const myRun = runId;
            setTimeout(() => {
                if (myRun !== runId || gameEnded) return;
                currentIndex++;
                renderQuestion();
            }, 800);
        } else {
            feedback.textContent = "❌ Sai rồi! Hãy thử lại.";
            feedback.className = "feedback wrong";

            slots.forEach((slot, i) => {
                const tile = slot.querySelector(".tile");
                slot.classList.remove("correct", "wrong");
                if (tile && tile.textContent !== correctChars[i]) {
                    slot.classList.add("wrong");
                } else if (tile) {
                    slot.classList.add("correct");
                }
            });
        }
    });

    // ── Bỏ qua: hiện đáp án đúng vào các ô, bị trừ điểm (skipPenalty), rồi sang câu sau ──
    skipBtn.addEventListener("click", () => {
        if (gameEnded || revealing || currentIndex >= questions.length) return;

        revealing = true;
        skippedCount++;
        checkBtn.disabled = true;
        skipBtn.disabled = true;

        const q = questions[currentIndex];
        if (skipPenalty > 0) {
            score -= skipPenalty; // điểm có thể âm
            scoreValue.textContent = score;
            showScorePopup("−" + skipPenalty, true);
            if (socket) socket.emit("skip_item", { group: myGroup, vong: 1, item: q.idx });
        }
        const correctChars = q.tu_dung.split("").filter((c) => c !== " ");
        const slots = answerSlots.querySelectorAll(".answer-slot");

        // Gom mọi thẻ (đang ở khay hoặc ở ô) rồi xếp lại đúng thứ tự đáp án
        const pool = Array.from(document.querySelectorAll("#tiles-pool .tile, #answer-slots .tile, body > .tile.animating"));
        slots.forEach((slot, i) => {
            const k = pool.findIndex((t) => t.textContent === correctChars[i]);
            if (k !== -1) slot.appendChild(pool.splice(k, 1)[0]);
            slot.classList.remove("wrong");
            slot.classList.add("correct");
        });
        updateSlotStates();

        feedback.textContent = "💡 Đáp án: " + q.tu_dung + (skipPenalty > 0 ? ` (−${skipPenalty} điểm)` : "");
        feedback.className = "feedback skipped";

        const myRun = runId;
        setTimeout(() => {
            if (myRun !== runId || gameEnded) return;
            currentIndex++;
            renderQuestion();
        }, 1800);
    });

    // ── Score popup ──
    function showScorePopup(text, negative) {
        const popup = document.createElement("div");
        popup.className = "score-popup" + (negative ? " neg" : "");
        popup.textContent = text;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 1000);
    }

    return { preload, start, stop, forceEnd };
})();
