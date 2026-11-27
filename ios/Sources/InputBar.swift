import UIKit

/// The message box on the story screen, built with iPhone's own controls and attached to the top of the
/// keyboard (like Messages and Swerve). Because it is part of the keyboard, dragging down through the chat
/// grabs the keyboard as soon as your finger reaches the top of this box, and it springs back if you let go early.
final class InputBar: UIView, UITextViewDelegate {
    let textView = UITextView()
    private let box = UIView()
    private let placeholder = UILabel()
    private let sendButton = UIButton(type: .custom)
    private var textHeight: NSLayoutConstraint!
    private let maxTextHeight: CGFloat = 140

    var onSend: ((String) -> Void)?
    var onFocus: (() -> Void)?
    var onHeightChange: (() -> Void)?

    /// "continue" (empty box: the story goes on), "go" (send what you typed) or "stop" (a reply is being written).
    var mode = "continue" { didSet { if mode != oldValue { updateButton() } } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        autoresizingMask = .flexibleHeight
        backgroundColor = .black   // the page draws the fade just above this bar

        box.translatesAutoresizingMaskIntoConstraints = false
        box.backgroundColor = UIColor(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255, alpha: 1)
        box.layer.cornerRadius = 22
        box.layer.borderWidth = 1
        box.layer.borderColor = UIColor(red: 0x2C / 255, green: 0x2C / 255, blue: 0x2E / 255, alpha: 1).cgColor
        addSubview(box)

        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.backgroundColor = .clear
        textView.textColor = .white
        textView.tintColor = UIColor(red: 0x3A / 255, green: 0x82 / 255, blue: 0xF7 / 255, alpha: 1)
        textView.font = .systemFont(ofSize: 17)
        textView.keyboardAppearance = .dark
        textView.isScrollEnabled = false
        textView.textContainerInset = UIEdgeInsets(top: 7, left: 0, bottom: 7, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = self
        box.addSubview(textView)

        placeholder.translatesAutoresizingMaskIntoConstraints = false
        placeholder.text = "Message"
        placeholder.font = .systemFont(ofSize: 17)
        placeholder.textColor = UIColor(red: 0x8E / 255, green: 0x8E / 255, blue: 0x93 / 255, alpha: 1)
        box.addSubview(placeholder)

        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.tintColor = .white
        sendButton.layer.cornerRadius = 16
        sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        box.addSubview(sendButton)

        textHeight = textView.heightAnchor.constraint(equalToConstant: 34)
        NSLayoutConstraint.activate([
            box.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            box.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 28),
            box.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -28),
            box.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -8),

            textView.topAnchor.constraint(equalTo: box.topAnchor, constant: 1),
            textView.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -1),
            textView.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 16),
            textView.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -6),
            textHeight,

            placeholder.leadingAnchor.constraint(equalTo: textView.leadingAnchor),
            placeholder.centerYAnchor.constraint(equalTo: textView.centerYAnchor),

            sendButton.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -3),
            sendButton.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -2),
            sendButton.widthAnchor.constraint(equalToConstant: 42),
            sendButton.heightAnchor.constraint(equalToConstant: 32)
        ])
        updateButton()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // Height comes from the constraints above, so the box can grow as you type.
    override var intrinsicContentSize: CGSize { .zero }

    /// Clears the box (after sending).
    func clear() {
        textView.text = ""
        textViewDidChange(textView)
    }

    func textViewDidChange(_ tv: UITextView) {
        placeholder.isHidden = !tv.text.isEmpty
        let fit = tv.sizeThatFits(CGSize(width: tv.bounds.width, height: .greatestFiniteMagnitude)).height
        let h = min(max(fit, 34), maxTextHeight)
        tv.isScrollEnabled = fit > maxTextHeight
        if abs(textHeight.constant - h) > 0.5 {
            textHeight.constant = h
            invalidateIntrinsicContentSize()
            onHeightChange?()
        }
        if mode != "stop" { mode = tv.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "continue" : "go" }
    }

    func textViewDidBeginEditing(_ tv: UITextView) { onFocus?() }

    @objc private func sendTapped() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onSend?(textView.text ?? "")
    }

    private func updateButton() {
        let cfg = UIImage.SymbolConfiguration(pointSize: 15, weight: .bold)
        switch mode {
        case "go":
            sendButton.setImage(UIImage(systemName: "arrow.up", withConfiguration: cfg), for: .normal)
            sendButton.backgroundColor = UIColor(red: 0x3A / 255, green: 0x82 / 255, blue: 0xF7 / 255, alpha: 1)
            sendButton.accessibilityLabel = "Send"
        case "stop":
            sendButton.setImage(UIImage(systemName: "stop.fill", withConfiguration: cfg), for: .normal)
            sendButton.backgroundColor = .clear
            sendButton.accessibilityLabel = "Stop"
        default:
            sendButton.setImage(UIImage(systemName: "forward.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)), for: .normal)
            sendButton.backgroundColor = .clear
            sendButton.accessibilityLabel = "Continue the story"
        }
    }
}
