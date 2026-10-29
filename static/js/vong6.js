const Vong6 = (() => {
  const $ = (id) => document.getElementById(id);
  const root = $("step-game-6"), matches = $("v6-matches"), timerFill = $("v6-timer-fill"), timerText = $("v6-timer-text");
  const C = 2 * Math.PI * 45;
  let socket, group, onEnd, snap, ended = false, timer, tickTimer, endTimer, run = 0;
  timerFill.style.strokeDasharray = C;
  const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = value; return n; };
  function action(data) { if (!ended) socket.emit("v6_action", { group, ...data }); }
  function sync() { if (socket && !ended) socket.emit("v6_sync", { group }, s => s && render(s)); }
  function renderTimer(s) {
    const left = Math.max(0, Number(s.seconds) || 0); timerText.textContent = Math.ceil(left);
    timerFill.style.strokeDashoffset = C * (1 - left / Math.max(1, s.span || 1));
    timerFill.classList.toggle("danger", left <= 3); timerFill.classList.toggle("warning", left > 3 && left <= 5);
  }
  function render(s) {
    if (ended || !s) return;
    snap = s; $("v6-q").textContent = s.q > 0 ? s.q : "–"; $("v6-total").textContent = s.total;
    renderTimer(s);
    const labels = {rules:"Đọc luật chơi · chuẩn bị cặp đấu", bet:"Đội mở cược", decide:"Chọn Theo, Tố hoặc Bỏ", call:"Đội mở quyết định Theo hoặc Bỏ", answer:"Cả hai đội trả lời", reveal:"Đáp án"};
    $("v6-status").textContent = labels[s.phase] || "Chung kết đối đầu · hai trận diễn ra song song";
    const m = s.matches[s.mine]; matches.textContent = "";
    if (s.mine == null || !m) { matches.append(el("article", "v6-match", "Nhóm của bạn không có cặp đấu vòng 6; điểm vòng này giữ nguyên.")); return; }
    $("v6-score").textContent = m.scores[group] ?? 0;
    const card = el("article", "v6-match");
    card.append(el("h3", "", `${m.names[0]} đấu với ${m.names[1]}`));
    card.append(el("p", "", `Chênh lệch trong trận: ${m.scores[group] >= 0 ? "+" : ""}${m.scores[group]} điểm`));
    const meOpen = m.opener === group, amAnswerer = !meOpen;
    const topic = m.chu_de;
    if (topic) card.append(el("p", "v6-topic", topic));
    if (s.phase === "bet") {
      card.append(el("p", "", meOpen ? "Chọn mức cược khi chỉ biết chủ đề." : `${m.names[0]} đang mở cược.`));
      if (meOpen) {
        card.append(buttons((s.bets || [10,20,30,50]).slice(0, 3).map(n => [`Cược ${n}`, {bet:n}, n]), m.bet));
        card.append(el("p", "v6-result", `Mức cược hiện tại: ${m.bet} điểm (nếu không bấm, hệ thống giữ mức này).`));
      } else card.append(el("p", "v6-result", `Mức cược hiện tại: ${m.bet} điểm`));
    } else if (s.phase === "decide") {
      card.append(el("p", "", `${m.names[0]} cược ${m.bet} điểm.`));
      if (amAnswerer) {
        card.append(buttons([["Theo",{action:"follow"},"follow"],["Tố",{action:"raise"},"raise"],["Bỏ (−10)",{action:"fold"},"fold"]], m.choice));
        const said = {follow:"Theo", raise:`Tố lên ${m.bet}`, fold:"Bỏ"}[m.choice];
        card.append(el("p", "v6-result", said ? `Bạn đã chọn: ${said}` : "Bạn chưa chọn."));
      } else card.append(el("p", "v6-result", m.choice ? "Đối thủ đã chọn." : "Đang chờ đối thủ chọn…"));
    } else if (s.phase === "call") {
      card.append(el("p", "", `Đối thủ đã ${m.choice === "raise" ? "tố lên" : "theo"} mức ${m.bet}.`));
      if (meOpen && m.choice === "raise") {
        card.append(buttons([["Theo",{action:"follow"},"follow"],["Bỏ (−10)",{action:"fold"},"fold"]], m.call));
        card.append(el("p", "v6-result", m.call ? `Bạn đã chọn: ${m.call === "fold" ? "Bỏ" : "Theo"}` : "Bạn chưa chọn."));
      }
    } else if (s.phase === "answer") {
      card.append(el("p", "v6-question", m.cau_hoi || "Câu hỏi đang tải…"));
      if (m.tiebreak_skip) card.append(el("p", "", "Trận này đã phân định; không cần câu phụ."));
      else if (m.choice === "fold" || m.call === "fold") card.append(el("p", "", "Một đội đã bỏ cược; câu hỏi không tính điểm đáp án."));
      else if (s.options) {
        const already = !!s.my_answered;
        const choices = el("div", "v6-options");
        s.options.forEach((text, i) => { const mine = s.my_choice === i; const b = el("button", mine ? "selected" : "", `${mine ? "✓ " : ""}${"ABCD"[i] || i+1}. ${text}`); b.disabled = already; b.onclick = () => action({action:"answer", choice:i}); choices.append(b); });
        card.append(choices, el("p", "v6-result", already ? `Bạn đã chọn ${"ABCD"[s.my_choice] || s.my_choice + 1}. Đã khoá đáp án · ${m.answered || 0}/2 đội đã trả lời` : `${m.answered || 0}/2 đội đã trả lời`));
      }
    } else if (s.phase === "reveal") {
      card.append(el("p", "v6-question", m.cau_hoi || ""));
      card.append(el("p", "v6-result", `Đáp án: ${m.dap_an}${m.giai_thich ? "\n"+m.giai_thich : ""}${m.trang ? `\nSách tr. ${m.trang}` : ""}`));
      const answerText = g => { const r = m.results && m.results[g]; return r == null ? "không trả lời" : (r ? "đúng" : "sai"); };
      card.append(el("p", "", `${m.names[0]}: ${answerText(m.groups[0])} · ${m.names[1]}: ${answerText(m.groups[1])}`));
    }
    matches.append(card);
  }
  // items: [nhãn, dữ liệu gửi, khoá]; nút có khoá trùng "current" được đánh dấu là đã chọn
  function buttons(items, current) { const box=el("div","v6-actions"); items.forEach(([label,data,key])=>{const on = key !== undefined && key === current; const b=el("button", on ? "selected" : "", on ? `✓ ${label}` : label); b.onclick=()=>action(data); box.append(b);}); return box; }
  function onState(s) { render(s); }
  function bind() { socket.on("v6_state", onState); }
  function unbind() { socket?.off("v6_state", onState); }
  function start(opts) { reset(); socket=opts.socket; group=opts.group; onEnd=opts.onEnd; bind(); tickTimer=setInterval(()=>{ if(snap){ snap={...snap,seconds:Math.max(0,snap.seconds-.2)}; renderTimer(snap); } },200); sync(); }
  function reset() { run++; unbind(); clearInterval(tickTimer); clearTimeout(endTimer); ended=false; snap=null; matches.textContent=""; root.classList.remove("game-ended"); $("v6-end").style.display="none"; $("v6-final-score").textContent="0"; $("v6-q").textContent="–"; }
  function stop() { reset(); }
  function forceEnd() { if(ended)return; ended=true; unbind(); clearInterval(tickTimer); const mine=snap?.matches?.[snap.mine]; const score=mine?.scores?.[group] ?? 0; $("v6-final-score").textContent=score; root.classList.add("game-ended"); $("v6-end").style.display="block"; const id=run; endTimer=setTimeout(()=>{if(id===run&&onEnd)onEnd(score);},3000); }
  return { preload:()=>Promise.resolve(), start, stop, forceEnd };
})();