/**
 * Voice search — audio in, transcribed text out. The actual cloud
 * speech-to-text call is isolated in one function (transcribeAudio), the
 * exact same pattern already used for OTP SMS: swapping providers later
 * only ever means editing that one function.
 *
 * Wire into index.js:
 *   const speechRoutes = require("./speechRoutes");
 *   speechRoutes(app, { auth, upload });
 */

/**
 * Default provider: OpenAI's Whisper API — simple REST endpoint, a single
 * multipart request, well-documented. Deepgram or AssemblyAI are worth
 * considering later specifically for Bengali accuracy if this default
 * doesn't perform well enough in practice; swapping only means rewriting
 * this one function.
 */
async function transcribeAudio(audioBuffer, mimeType, lang) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Voice search isn't configured yet — set OPENAI_API_KEY on the server");
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), "audio.m4a");
  formData.append("model", "whisper-1");
  // Hinting the language measurably improves accuracy over letting the
  // model guess — matches whichever language the app's UI is currently in.
  formData.append("language", lang === "en" ? "en" : "bn");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Speech-to-text request failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.text || "";
}

module.exports = function speechRoutes(app, deps) {
  const { auth, upload } = deps;

  /** POST /api/speech/transcribe — body: multipart { audio: <file> }, query: ?lang=bn|en */
  app.post("/api/speech/transcribe", auth, upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No audio file provided" });
      const lang = req.query.lang === "en" ? "en" : "bn";
      const text = await transcribeAudio(req.file.buffer, req.file.mimetype, lang);
      res.json({ text: text.trim() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};