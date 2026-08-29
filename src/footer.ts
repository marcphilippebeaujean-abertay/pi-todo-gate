import { hyperlink, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { githubPrUrl } from "./pr-detection.ts";

export interface FooterState {
  prUrl?: string;
  taskUrl?: string;
  branch?: string | null;
}

export interface FooterTheme {
  fg(color: string, text: string): string;
}

export interface FooterData {
  getExtensionStatuses(): ReadonlyMap<string, string>;
  onBranchChange(listener: () => void): () => void;
}

export interface FooterTui {
  requestRender(): void;
}

export interface FooterComponent {
  dispose(): void;
  invalidate(): void;
  render(width: number): string[];
}

export type FooterFactory = (tui: FooterTui, theme: FooterTheme, footerData: FooterData) => FooterComponent;

function prLabel(url: string | undefined): string {
  const normalized = url ? githubPrUrl(url) : null;
  const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
  if (!number) return "PR: none";
  const boundedNumber = number.length > 6 ? `${number.slice(0, 5)}…` : number;
  return hyperlink(`PR #${boundedNumber}`, normalized);
}

function taskLabel(url: string | undefined): string {
  return url ? hyperlink("Task", url) : "Task: none";
}

export function renderFooterLine(
  state: FooterState,
  width: number,
  theme: FooterTheme,
  statuses: ReadonlyMap<string, string>,
): string {
  if (width <= 0) return "";
  const parts = [prLabel(state.prUrl), taskLabel(state.taskUrl)];
  if (state.branch) parts.push(`branch: ${state.branch}`);
  for (const status of statuses.values()) {
    if (status) parts.push(status);
  }
  const line = theme.fg("dim", parts.join(" | "));
  if (visibleWidth(line) <= width) return line;
  return truncateToWidth(line, width, "", false);
}

export function createFooterFactory(state: () => FooterState): FooterFactory {
  return (tui, theme, footerData) => {
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
    return {
      dispose: unsubscribe,
      invalidate() {},
      render(width: number): string[] {
        return [renderFooterLine(state(), width, theme, footerData.getExtensionStatuses())];
      },
    };
  };
}
