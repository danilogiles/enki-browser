export type ToolStatus = "running" | "awaiting" | "done" | "error" | "declined";

export type Segment =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      label: string;
      status: ToolStatus;
      sensitive: boolean;
      output?: string;
    };

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  /** User text. */
  text?: string;
  /** Data URL thumbnail of the screenshot attached to a user message. */
  screenshot?: string;
  /** Assistant content, interleaving text and tool calls in order. */
  segments?: Segment[];
  thinking?: string;
  error?: string;
  note?: string;
  streaming?: boolean;
};

export type TabInfo = { id: number; title: string; url: string; favIconUrl?: string };

let counter = 0;
export function uid(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
