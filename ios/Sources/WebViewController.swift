import UIKit
import WebKit
import ObjectiveC

/// Hosts the DreamScapes page. The page itself lives online (GitHub Pages), so every change
/// shows up the next time the app opens; a copy bundled in the app is used when offline.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let net = NetClient()
    private var usingFallback = false
    private var scrollTimer: Timer?

    private var remoteURL: URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "TKRemoteURL") as? String,
              !s.isEmpty, !s.contains("$(") else { return nil }
        return URL(string: s)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(WeakHandler(self), name: "tk")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // The story page scrolls with iPhone's own scrolling. Dragging down through the chat pulls the
        // keyboard down with your finger; let go early and it springs back up, like Messages.
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(webView)

        // The page ends where the keyboard begins, and follows it as you drag it down.
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])

        net.deliver = { [weak self] js in self?.webView.evaluateJavaScript(js, completionHandler: nil) }
        hideInputAccessoryBar()
        loadApp()

        // Chat lists scroll inside the page; let a downward drag there pull the keyboard down too.
        scrollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let root = self?.webView else { return }
            Self.forEachScrollView(in: root) { $0.keyboardDismissMode = .interactive }
        }
    }

    private static func forEachScrollView(in v: UIView, _ body: (UIScrollView) -> Void) {
        if let s = v as? UIScrollView { body(s) }
        for sub in v.subviews { forEachScrollView(in: sub, body) }
    }

    // MARK: loading

    private func installBootScript() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        let docs = Store.shared.snapshotJSON()
        let cfg = Store.shared.configJSON() ?? "null"
        let src = "window.TK_BOOT = \(docs); window.TK_CONFIG = \(cfg.isEmpty ? "null" : cfg); window.TK_NATIVE_SCROLL = true;"
        ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func loadApp() {
        installBootScript()
        if let url = remoteURL {
            usingFallback = false
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 10))
        } else {
            loadBundled()
        }
    }

    private func loadBundled() {
        usingFallback = true
        installBootScript()
        guard let file = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else { return }
        webView.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !usingFallback { loadBundled() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if !usingFallback && webView.url == nil { loadBundled() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadApp()
    }

    // Open normal links in Safari instead of inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let url = action.request.url, url.scheme?.hasPrefix("http") == true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // Let the page's file picker (Import backup) work.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // MARK: messages from the page

    fileprivate func handle(_ body: Any) {
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "put":
            if let id = msg["id"] as? String, let json = msg["json"] as? String { Store.shared.put(id: id, json: json) }
        case "del":
            if let id = msg["id"] as? String { Store.shared.delete(id: id) }
        case "config":
            if let json = msg["json"] as? String { Store.shared.saveConfig(json) }
        case "net":
            net.start(msg)
        case "netCancel":
            if let id = msg["id"] as? String { net.cancel(id) }
        case "share":
            share(filename: msg["filename"] as? String ?? "dreamscapes-backup.json", text: msg["data"] as? String ?? "")
        case "composer":
            // Start pulling the keyboard down as soon as the finger reaches the top of the message box.
            if #available(iOS 17.0, *), let h = (msg["h"] as? NSNumber)?.doubleValue {
                webView.scrollView.keyboardDismissPadding = CGFloat(h)
            }
        case "haptic":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "reload":
            Store.shared.writeDailyBackup()
            loadApp()
        default:
            break
        }
    }

    private func share(filename: String, text: String) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? text.data(using: .utf8)?.write(to: url, options: .atomic)
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(sheet, animated: true)
    }

    // MARK: no "< > Done" bar above the keyboard

    private func hideInputAccessoryBar() {
        guard let content = webView.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
        let baseClass: AnyClass = type(of: content)
        let name = "\(NSStringFromClass(baseClass))_NoAccessory"
        var newClass: AnyClass? = NSClassFromString(name)
        if newClass == nil {
            newClass = objc_allocateClassPair(baseClass, name, 0)
            guard let cls = newClass else { return }
            let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            let imp = imp_implementationWithBlock(block)
            let sel = #selector(getter: UIResponder.inputAccessoryView)
            class_addMethod(cls, sel, imp, "@@:")
            objc_registerClassPair(cls)
        }
        if let cls = newClass { object_setClass(content, cls) }
    }
}

/// Breaks the retain cycle between WKUserContentController and the view controller.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WebViewController?
    init(_ target: WebViewController) { self.target = target }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handle(message.body)
    }
}

/// Makes the model requests for the page using the phone's own networking: streaming,
/// no browser CORS rules, and plain http allowed for a computer on your Wi-Fi.
final class NetClient: NSObject, URLSessionDataDelegate {
    var deliver: ((String) -> Void)?
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 120
        cfg.timeoutIntervalForResource = 600
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()
    private var ids: [Int: String] = [:]
    private var tasks: [String: URLSessionDataTask] = [:]
    private var statuses: [String: Int] = [:]
    private let lock = NSLock()

    func start(_ msg: [String: Any]) {
        guard let id = msg["id"] as? String, let urlString = msg["url"] as? String, let url = URL(string: urlString) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = msg["method"] as? String ?? "POST"
        for (k, v) in (msg["headers"] as? [String: String]) ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        if let body = msg["body"] as? String, !body.isEmpty { req.httpBody = body.data(using: .utf8) }
        let task = session.dataTask(with: req)
        lock.lock(); ids[task.taskIdentifier] = id; tasks[id] = task; lock.unlock()
        task.resume()
    }

    func cancel(_ id: String) {
        lock.lock(); let t = tasks.removeValue(forKey: id); lock.unlock()
        t?.cancel()
    }

    private func id(for task: URLSessionTask) -> String? {
        lock.lock(); defer { lock.unlock() }
        return ids[task.taskIdentifier]
    }

    private func send(_ id: String, _ kind: String, _ payload: String = "", _ status: Int = 0) {
        let js = "window.__tkNet && window.__tkNet(\(quote(id)), \(quote(kind)), \(quote(payload)), \(status));"
        DispatchQueue.main.async { self.deliver?(js) }
    }

    private func quote(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed]),
              let q = String(data: d, encoding: .utf8) else { return "\"\"" }
        return q
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let id = id(for: dataTask) {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            lock.lock(); statuses[id] = status; lock.unlock()
            send(id, "head", "", status)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if let id = id(for: dataTask) { send(id, "chunk", data.base64EncodedString()) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = id(for: task) else { return }
        lock.lock()
        ids.removeValue(forKey: task.taskIdentifier); tasks.removeValue(forKey: id)
        let status = statuses.removeValue(forKey: id) ?? 0
        lock.unlock()
        if let error = error as NSError? {
            if error.code == NSURLErrorCancelled { return }
            send(id, "error", error.localizedDescription)
        } else {
            send(id, "done", "", status)
        }
    }
}
