public enum ToggleAction: Equatable, Sendable {
    case show
    case hide
}

public func toggleAction(isVisible: Bool) -> ToggleAction {
    isVisible ? .hide : .show
}
