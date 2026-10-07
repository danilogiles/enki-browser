/**
 * Asks for the microphone once, in a tab: the side panel cannot show Chromium's prompt. Granted
 * here, the permission belongs to the extension, so the panel can record afterwards.
 */
const statusLine = document.getElementById("status")!;

navigator.mediaDevices.getUserMedia({ audio: true }).then(
  (stream) => {
    stream.getTracks().forEach((t) => t.stop());
    statusLine.textContent = "Done. Go back to Enki and press the microphone again.";
    setTimeout(() => window.close(), 2500);
  },
  () => {
    statusLine.textContent = "The microphone was not allowed. You can change it in Settings → Privacy and security → Site settings.";
  },
);
export {};
