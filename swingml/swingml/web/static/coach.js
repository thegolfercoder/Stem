/* A coach's read for one swing, from the local model, streamed as it is written. */
(function () {
  const section = document.getElementById("coach");
  if (!section || !window.SWING_ID) return;
  const ask = document.getElementById("coach-ask");
  const status = document.getElementById("coach-status");
  const out = document.getElementById("coach-text");
  const meta = document.getElementById("coach-meta");
  const when = (iso) => new Date(iso).toLocaleString();

  section.hidden = false;
  fetch(`/api/swings/${window.SWING_ID}/coach`).then((r) => r.json()).then((saved) => {
    if (saved && saved.text) {
      window.renderLite(out, saved.text);
      meta.textContent = `${saved.model}, ${saved.saw_pictures ? "from the pictures and the numbers" : "from the numbers only"}, ${when(saved.at)}`;
      ask.textContent = "Ask again";
    }
  });
  window.swingAI.then((ai) => {
    if (!ai.chat_model) {
      ask.disabled = true;
      status.textContent = ai.advice;
    } else if (!ai.vision_model) {
      status.textContent = `${ai.chat_model} cannot see pictures, so it reads the numbers only. ${ai.coach_advice}`;
    }
  });

  ask.addEventListener("click", async () => {
    ask.disabled = true;
    out.textContent = "";
    meta.textContent = "";
    status.textContent = "Thinking… a local model can take a minute on a laptop.";
    const started = performance.now();
    try {
      const response = await fetch(`/api/swings/${window.SWING_ID}/coach`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        status.textContent = body.error || `The coach could not run (${response.status}).`;
        return;
      }
      const model = response.headers.get("X-Model");
      const saw = response.headers.get("X-Saw-Pictures") === "yes";
      await window.readStream(response, (text) => {
        if (text) status.textContent = "";
        window.renderLite(out, text);
      });
      meta.textContent = `${model}, ${saw ? "from the pictures and the numbers" : "from the numbers only"}, ` +
        `${((performance.now() - started) / 1000).toFixed(0)} s`;
      ask.textContent = "Ask again";
    } catch (error) {
      status.textContent = `The coach stopped: ${error.message || error}`;
    } finally {
      ask.disabled = false;
    }
  });
})();
