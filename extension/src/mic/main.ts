/** Permission only: never record, contact an audio provider, or start a voice session here. */
import { loadSettings } from "../lib/settings";
import { microphoneDisclosure, microphonePurpose } from "../lib/voice/microphone-disclosure";

const statusLine = document.getElementById("status")!;
const description = document.getElementById("description")!;
const destination = document.getElementById("destination")!;
const grant = document.getElementById("grant") as HTMLButtonElement;
const back = document.getElementById("return") as HTMLButtonElement;
back.onclick = () => window.close();

async function initialize() {
  const purpose = microphonePurpose(location.search);
  // Read the route from extension-local settings, not from URL parameters or a web page.
  const settings = purpose === "realtime" ? await loadSettings() : undefined;
  const disclosure = microphoneDisclosure(purpose, settings?.realtime);
  description.textContent = disclosure.description;
  destination.textContent = disclosure.destination;
  statusLine.textContent = disclosure.enabled ? "Microphone off. Press Allow microphone permission to request access." : disclosure.next;
  grant.disabled = !disclosure.enabled;
  grant.onclick = async () => {
    if (grant.disabled) return;
    grant.disabled = true;
    statusLine.textContent = "Waiting for your microphone permission…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      statusLine.textContent = `Microphone permission granted. ${disclosure.next}`;
      back.focus();
    } catch {
      statusLine.textContent = "The microphone was not allowed. You can change it in Settings → Privacy and security → Site settings. No provider connection has started.";
      grant.disabled = false;
    }
  };
}
void initialize().catch(() => { statusLine.textContent = "Could not load the microphone route. Return to Enki and review Settings. Microphone remains off."; });
