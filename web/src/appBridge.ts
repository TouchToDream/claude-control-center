type BridgeHandlers = {
  onShow(sessionId: string | null, onlyIfNoDraft: boolean): void
  onShown(isShown: boolean): void
}

type AppWindow = Window & {
  webkit?: { messageHandlers?: { ccc?: { postMessage(message: unknown): void } } }
  cccApp?: {
    show(sessionId: string | null, onlyIfNoDraft: boolean): void
    setShown(isShown: boolean): void
  }
}

export function isInApp(): boolean {
  return (window as AppWindow).webkit?.messageHandlers?.ccc !== undefined
}

export function installAppBridge(handlers: BridgeHandlers): () => void {
  const target = window as AppWindow
  const channel = target.webkit?.messageHandlers?.ccc

  if (channel === undefined) {
    return () => {}
  }

  target.cccApp = {
    show: (sessionId, onlyIfNoDraft) => handlers.onShow(sessionId, onlyIfNoDraft === true),
    setShown: isShown => handlers.onShown(isShown === true),
  }
  channel.postMessage({ type: 'ready' })

  return () => {
    delete target.cccApp
  }
}
