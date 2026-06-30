import SwiftUI

struct NotchShellRootView: View {
    @ObservedObject var store: NotchShellStore

    var body: some View {
        if store.snapshot.state.phase == .hidden {
            Color.clear
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            NotchChromeView(
                snapshot: store.snapshot,
                onOpen: {
                    store.openFromAction()
                },
                onClose: {
                    store.dismissExpanded(.action)
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}
