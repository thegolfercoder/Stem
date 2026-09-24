/* Questions about the golfer's own swings, answered by the local model.
 * The conversation lives in the page; each question sends it whole, with the
 * swing history the server adds, because the model remembers nothing between
 * calls. */
(function () {
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const meta = document.getElementById("chat-meta");
  const suggest = document.getElementById("chat-suggest");
  const setup = document.getElementById("ai-setup");
  const turns = [];

  const bubble = (role, text) => {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  const check = () => fetch("/api/ai").then((r) => r.json()).then((ai) => {
    const ready = Boolean(ai.chat_model);
    setup.hidden = ready;
    send.disabled = !ready;
    if (!ready) document.getElementById("ai-setup-text").textContent = ai.advice;
    else meta.textContent = `Answering with ${ai.chat_model}, on this computer.`;
  });
  check();
  document.getElementById("ai-recheck").addEventListener("click", check);

  suggest.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    input.value = chip.textContent;
    form.requestSubmit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || send.disabled) return;
    suggest.hidden = true;
    input.value = "";
    bubble("user", question);
    turns.push({ role: "user", content: question });
    const reply = bubble("assistant", "Thinking…");
    reply.classList.add("pending");
    send.disabled = true;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: turns }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        reply.textContent = body.error || `No answer (${response.status}).`;
        turns.pop();
        return;
      }
      const text = await window.readStream(response, (t) => {
        if (t) { reply.classList.remove("pending"); window.renderLite(reply, t); log.scrollTop = log.scrollHeight; }
      });
      turns.push({ role: "assistant", content: text });
    } catch (error) {
      reply.textContent = `The coach stopped: ${error.message || error}`;
      turns.pop();
    } finally {
      reply.classList.remove("pending");
      send.disabled = false;
      input.focus();
    }
  });
})();
