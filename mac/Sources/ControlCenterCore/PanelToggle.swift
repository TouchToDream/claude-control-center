public enum ToggleAction: Equatable, Sendable {
    case show
    case hide
    case focus(moveToMouseScreen: Bool)
}

public func toggleAction(isVisible: Bool, isKey: Bool, isOnMouseScreen: Bool) -> ToggleAction {
    if !isVisible {
        return .show
    }

    return isKey ? .hide : .focus(moveToMouseScreen: !isOnMouseScreen)
}
