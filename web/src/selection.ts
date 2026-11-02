export function nextSelection(
  current: string | null,
  requested: string | null,
  onlyIfNoDraft: boolean,
  currentDraft: string,
): string | null {
  if (requested === null) {
    return current
  }

  const hasDraft = currentDraft.trim() !== ''

  return onlyIfNoDraft && hasDraft ? current : requested
}
