/* Whether the local coach is available, shown in the top bar on every page.
 * Everything that talks to the model checks the same endpoint, so the pill and
 * the buttons never disagree about what is installed. */
(function () {
  const pill = document.getElementById("ai-pill");
  window.swingAI = fetch("/api/ai")
    .then((r) => r.json())
    .catch(() => ({ running: false, models: [], advice: "The app could not ask for Ollama." }));
  window.swingAI.then((ai) => {
    if (!pill) return;
    const model = ai.vision_model || ai.chat_model;
    pill.classList.toggle("on", Boolean(model));
    pill.querySelector("span").textContent = model ? model : "AI off";
    pill.title = model
      ? `Local AI through Ollama: ${model}${ai.vision_model ? " (can see pictures)" : ""}`
      : ai.advice || "Ollama is not running";
  });
})();

/* Read a streamed text reply, handing over the text so far as it arrives. */
window.readStream = async function (response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  text += decoder.decode();
  onText(text);
  return text;
};

/* The little Markdown small models like to write - bold, bullets - shown as
 * such. Everything is escaped first, so nothing the model writes can become
 * markup of its own. */
window.renderLite = function (element, text) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  element.innerHTML = escaped
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^(\s*)[*-]\s+/gm, "$1\u2022 ");
};
