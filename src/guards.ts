/** A level may only start, resume or be skipped while no overlay owns the screen. */
export function canRunGame(settingsOpen: boolean, contextLost: boolean): boolean {
  return !settingsOpen && !contextLost;
}

/** What pad A does outside driving: click the focused nav button, run the Enter action, or nothing. */
export function padConfirmAction(focusInNavButton: boolean, actionsEnabled: boolean): 'click' | 'enter' | 'none' {
  if (focusInNavButton) return 'click';
  return actionsEnabled ? 'enter' : 'none';
}
