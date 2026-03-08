export const IME_ENTER_GUARD_MS = 120;

type NativeImeKeyboardEvent = {
  isComposing?: boolean;
  keyCode?: number;
};

export function isImeCommitRecentlyEnded(
  lastCompositionEndAt: number,
  guardMs = IME_ENTER_GUARD_MS
): boolean {
  return lastCompositionEndAt > 0 && Date.now() - lastCompositionEndAt < guardMs;
}

export function shouldIgnoreEnterForIme(params: {
  nativeEvent?: NativeImeKeyboardEvent | null;
  composing: boolean;
  lastCompositionEndAt: number;
}): boolean {
  const nativeEvent = params.nativeEvent;
  if (params.composing) return true;
  if (nativeEvent?.isComposing) return true;
  if (nativeEvent?.keyCode === 229) return true;
  return isImeCommitRecentlyEnded(params.lastCompositionEndAt);
}
