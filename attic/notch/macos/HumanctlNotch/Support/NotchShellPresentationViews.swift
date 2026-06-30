import SwiftUI

struct NotchChromeView: View {
    let snapshot: NotchShellSnapshot
    let onOpen: () -> Void
    let onClose: () -> Void

    var body: some View {
        GeometryReader { proxy in
            let chrome = NotchChromeLayout(phase: snapshot.state.phase, containerSize: proxy.size)

            VStack(spacing: 0) {
                shellContainer(chrome: chrome, containerWidth: proxy.size.width)

                if chrome.chinHeight > 0 {
                    Rectangle()
                        .fill(Color.black.opacity(0.01))
                        .frame(width: proxy.size.width, height: chrome.chinHeight)
                }
            }
            .padding(.bottom, chrome.isExpanded ? NotchShellMetrics.expandedOuterBottomPadding : 0)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
            .contentShape(Rectangle())
            .onTapGesture {
                guard snapshot.state.phase == .ambient else {
                    return
                }
                onOpen()
            }
            .compositingGroup()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    @ViewBuilder
    private func shellContainer(chrome: NotchChromeLayout, containerWidth: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            if chrome.isExpanded {
                VStack(alignment: .leading, spacing: chrome.contentSpacing) {
                    ChromeHeaderRow(
                        snapshot: snapshot,
                        isExpanded: true,
                        height: chrome.headerHeight
                    )

                    if let model = snapshot.peekModel {
                        PeekBodyContent(model: model, onClose: onClose)
                    }
                }
                .padding(.horizontal, chrome.horizontalInset)
                .padding(.horizontal, NotchShellMetrics.expandedHorizontalEdgeInset)
                .padding(.bottom, NotchShellMetrics.expandedBottomContentPadding)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                ChromeHeaderRow(
                    snapshot: snapshot,
                    isExpanded: false,
                    height: chrome.headerHeight
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, chrome.horizontalInset)
                .offset(y: NotchShellMetrics.ambientHeaderOpticalOffset)
            }
        }
        .frame(width: containerWidth, height: chrome.shellHeight, alignment: .top)
        .background(Color.black)
        .clipShape(
            NotchShellShape(
                topCornerRadius: chrome.topCornerRadius,
                bottomCornerRadius: chrome.bottomCornerRadius
            )
        )
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.black)
                .frame(height: 1)
                .padding(.horizontal, chrome.topCornerRadius)
        }
        .shadow(
            color: chrome.isExpanded ? Color.black.opacity(0.7) : .clear,
            radius: chrome.isExpanded ? 4 : 0
        )
    }

    private var accessibilityLabel: String {
        switch snapshot.state.phase {
        case .hidden:
            return "humanctl hidden"
        case .ambient:
            guard let model = snapshot.ambientModel else {
                return "humanctl ambient"
            }
            return "\(model.sourceLabel), \(model.queueCountLabel) waiting, \(model.urgencyLabel)"
        case .expanded:
            guard let model = snapshot.peekModel else {
                return "humanctl peek"
            }
            return "\(model.sourceLabel), \(model.title), \(model.queueCountLabel)"
        }
    }
}

private struct ChromeHeaderRow: View {
    let snapshot: NotchShellSnapshot
    let isExpanded: Bool
    let height: CGFloat

    var body: some View {
        GeometryReader { proxy in
            if let ambient = snapshot.ambientModel {
                let contentWidth = max(0, proxy.size.width)
                let centerGutterWidth = max(
                    0,
                    contentWidth - NotchShellMetrics.ambientTotalShoulderWidth
                )
                let shoulderLaneWidth = max(44, (contentWidth - centerGutterWidth) / 2)

                HStack(spacing: 0) {
                    HStack(spacing: NotchShellMetrics.ambientShoulderSpacing) {
                        ShoulderBadge(
                            symbol: ambient.harnessSymbolName,
                            fill: Color.white.opacity(0.9),
                            size: 10
                        )

                        if let sourceCountLabel = ambient.sourceCountLabel {
                            TinyCountGlyph(label: sourceCountLabel)
                        }
                    }
                    .frame(width: shoulderLaneWidth, alignment: .leading)

                    Color.clear
                        .frame(width: centerGutterWidth)

                    HStack(spacing: NotchShellMetrics.ambientShoulderSpacing) {
                        CountBadge(
                            queueCount: isExpanded ? (snapshot.peekModel?.queueCountLabel ?? ambient.queueCountLabel) : ambient.queueCountLabel,
                            urgency: ambient.urgency
                        )
                    }
                    .frame(width: shoulderLaneWidth, alignment: .trailing)
                }
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
            }
        }
        .frame(height: height)
    }
}

private struct PeekBodyContent: View {
    let model: NotchPeekModel
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.sourceLabel)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.9))

            PeekRow(
                title: model.title,
                subtitle: model.summary
            )

            HStack(spacing: 10) {
                PeekActionChip(title: model.recommendation, emphasized: true)
                PeekActionChip(title: model.alternate, emphasized: false)
                Spacer(minLength: 12)
                Button("Close") {
                    onClose()
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.68))
            }

            Text(model.workspaceTitle)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
        }
    }
}

private struct NotchChromeLayout {
    let phase: NotchShellPhase
    let containerSize: CGSize

    var isExpanded: Bool {
        phase == .expanded
    }

    var topCornerRadius: CGFloat {
        isExpanded ? NotchShellMetrics.openTopCornerRadius : NotchShellMetrics.closedTopCornerRadius
    }

    var bottomCornerRadius: CGFloat {
        isExpanded ? NotchShellMetrics.openBottomCornerRadius : NotchShellMetrics.closedBottomCornerRadius
    }

    var chinHeight: CGFloat {
        guard !isExpanded else {
            return 0
        }
        return min(
            NotchShellMetrics.ambientInteractionChinHeight,
            max(0, containerSize.height - 24)
        )
    }

    var shellHeight: CGFloat {
        if isExpanded {
            return NotchShellMetrics.expandedVisibleHeight
        }
        return max(24, containerSize.height - chinHeight)
    }

    var horizontalInset: CGFloat {
        isExpanded ? max(topCornerRadius, bottomCornerRadius) : max(bottomCornerRadius, NotchShellMetrics.ambientShoulderInset)
    }

    var contentSpacing: CGFloat {
        isExpanded ? 12 : 0
    }

    var headerHeight: CGFloat {
        isExpanded ? 22 : max(18, shellHeight - 2)
    }
}

private struct ShoulderBadge: View {
    let symbol: String
    let fill: Color
    let size: CGFloat

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(fill)
            .frame(width: 18, height: 18)
    }
}

private struct CountBadge: View {
    let queueCount: String
    let urgency: NotchUrgency

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(urgencyColor)
                .frame(width: 5, height: 5)

            Text(queueCount)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Color.white.opacity(0.08), in: Capsule(style: .continuous))
    }

    private var urgencyColor: Color {
        switch urgency {
        case .active:
            Color.white.opacity(0.92)
        case .blocked:
            Color.yellow.opacity(0.96)
        case .quiet:
            Color.white.opacity(0.42)
        }
    }
}

private struct TinyCountGlyph: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(.white.opacity(0.9))
            .lineLimit(1)
            .fixedSize()
    }
}

private struct PeekRow: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
                .lineLimit(2)

            Text(subtitle)
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.76))
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
}

private struct PeekActionChip: View {
    let title: String
    let emphasized: Bool

    var body: some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(emphasized ? Color.white.opacity(0.16) : Color.white.opacity(0.08))
            .clipShape(Capsule(style: .continuous))
    }
}
