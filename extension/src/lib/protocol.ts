/** Messages exchanged between the side panel (executor) and the content script. */

export type ScrollDirection = "up" | "down" | "left" | "right";

export type ContentRequest =
  | { type: "enki:ping" }
  | { type: "enki:page_info" }
  | { type: "enki:snapshot"; filter: "interactive" | "all"; maxChars?: number }
  | { type: "enki:find"; query: string }
  | { type: "enki:text"; maxChars?: number }
  | { type: "enki:locate"; ref: string }
  | { type: "enki:describe_point"; x: number; y: number }
  | { type: "enki:focus"; ref: string; clear: boolean }
  | { type: "enki:dom_click"; ref: string }
  | { type: "enki:set_value"; ref: string; text: string }
  | { type: "enki:scroll"; direction: ScrollDirection; amount: number; ref?: string }
  | { type: "enki:flash"; x: number; y: number }
  | { type: "enki:set_active"; active: boolean; label?: string };

export type PageInfo = {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number; maxY: number };
  dpr: number;
};

export type LocatedElement = {
  x: number;
  y: number;
  tag: string;
  role: string;
  name: string;
  /** Looks like an irreversible / outward-facing action (send, buy, delete...). */
  sensitive: boolean;
  /** Whether this element is a password or credential input field. */
  isPassword?: boolean;
};

export type ContentResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Heuristic for actions that deserve a confirmation card. English + Portuguese + Spanish. */
export const SENSITIVE_ACTION =
  /\b(buy|purchase|pay(ment)?|check ?out|place order|order now|confirm|submit|send|post|publish|share|delete|remove|unsubscribe|sign ?out|log ?out|transfer|apply|book|reserve|comprar|pagar|finalizar|confirmar|enviar|publicar|postar|compartilhar|excluir|apagar|remover|deletar|transferir|reservar|sair|encerrar|realizar pedido|enviar mensagem|eliminar|borrar|reservar)\b/i;
