import SwiftUI

struct NotchShellRootView: View {
    @ObservedObject var store: NotchShellStore

    var body: some View {
        ZStack(alignment: .top) {
            switch store.snapshot.state.phase {
            case .hidden:
                Color.clear

            case .ambient:
                compactShell

            case .expanded:
                expandedShell
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var compactShell: some View {
        let shape = NotchShellShape(topCornerRadius: 6, bottomCornerRadius: 14)

        return shape
            .fill(Color.black)
            .overlay(alignment: .bottom) {
                Circle()
                    .fill(Color.white.opacity(0.72))
                    .frame(width: 5, height: 5)
                    .padding(.bottom, 7)
            }
            .contentShape(shape)
            .onTapGesture {
                store.openFromAction()
            }
            .onHover { isHovering in
                store.handleAmbientHover(isHovering)
            }
    }

    private var expandedShell: some View {
        let shape = NotchShellShape(topCornerRadius: 6, bottomCornerRadius: 22)

        return shape
            .fill(Color.black)
            .overlay(alignment: .top) {
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(0.28))
                    .frame(width: 34, height: 4)
                    .padding(.top, 14)
            }
            .contentShape(shape)
            .onHover { isHovering in
                store.handleExpandedHover(isHovering)
            }
            .onTapGesture { }
    }
}
