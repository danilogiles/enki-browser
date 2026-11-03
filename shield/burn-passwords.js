// Burn's one movable row (post-0.8.15, Ink's 0.8.15-burn-optional, Helm v1): Passwords.
// Off by default: every confirm opens with Passwords under Kept, and the choice lasts for that
// burn only (nothing is saved). The arrow is the control: "Delete →" moves the row to Deletes,
// "← Keep" moves it back. Either way the focus goes back to Cancel: moving Passwords never makes
// Burn the default. burn.js deletes browsingData.passwords only when the message says
// {passwords: true}, so Deletes lists Passwords only when that is what Burn will send.
// Used by the settings page (options.js) and the Shields panel (popup.js), the same way.
import { t } from "./i18n.js";

const QUESTION = "Close every tab and delete history, cookies and site data, cache, download history, autofill (saved addresses and cards), and Enki Allowed sites? Kept: passwords, bookmarks, and Enki chats, settings, and API keys, plus Shields settings. This cannot be undone.";
const QUESTION_PW = "Close every tab and delete history, cookies and site data, cache, download history, autofill (saved addresses and cards), Enki Allowed sites, and saved passwords? Kept: bookmarks, Enki chats, settings, and API keys, plus Shields settings. This cannot be undone.";

/**
 * Wires the Passwords row. `row` is the movable element (its icon is `i`, its button `button`),
 * `del`/`keep` the containers it moves between, `note` the line under the lists, `question` the
 * dialog's plain-text description, `cancel` the Cancel button.
 * Returns { reset(), passwords() }: reset() puts Passwords back under Kept (call it on every open);
 * passwords() is what this burn sends.
 */
export function movablePasswords({ row, del, keep, note, question, cancel, popup = false }) {
  const button = row.querySelector("button");
  const icon = row.querySelector("i");
  let on = false;
  const render = () => {
    if (on) del.append(row); // last in Deletes
    else { const head = keep.querySelector(":scope > h3"); if (head) head.after(row); else keep.prepend(row); } // first in Kept
    row.dataset.moved = String(on);
    icon.textContent = on ? "🔥" : "✓";
    button.textContent = on ? t("pwKeep", "← Keep") : t("pwMove", "Delete →");
    button.setAttribute("aria-label", on ? t("pwKeepAria", "Keep Passwords") : t("pwMoveAria", "Move Passwords to Deletes"));
    if (on) {
      note.replaceChildren(t("pwNoteOnLead", "Passwords will be deleted in this burn. "),
        Object.assign(document.createElement("b"), { textContent: t("pwKeep", "← Keep") }), t("pwNoteOnTail", " moves them back."));
    } else {
      note.textContent = popup ? t("pwNoteOffPopup", "Only Passwords can move — this burn only.") : t("pwNoteOff", "Only Passwords can move — off by default, this burn only.");
    }
    question.textContent = on ? t("burnQuestionPw", QUESTION_PW) : t("burnQuestion", QUESTION);
  };
  button.addEventListener("click", (e) => {
    e.preventDefault();
    if (button.disabled || cancel.disabled) return; // burning already
    on = !on;
    render();
    cancel.focus(); // Cancel stays the default after a move
  });
  render();
  return {
    reset() { on = false; render(); },
    passwords: () => on,
    lock(locked) { button.disabled = locked; },
  };
}
