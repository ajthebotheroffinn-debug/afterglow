import Foundation

/// Keeps every story, character, persona and memory as a JSON file on the phone.
/// Files live in the app's Documents folder, which shows up in the Files app
/// (On My iPhone › Afterglow), together with automatic daily backups.
final class Store {
    static let shared = Store()

    private let fm = FileManager.default
    private let queue = DispatchQueue(label: "store")
    let documents: URL
    let dataDir: URL
    let backupDir: URL
    let configURL: URL
    private var dirtySinceBackup = false

    private init() {
        documents = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dataDir = documents.appendingPathComponent("Data", isDirectory: true)
        backupDir = documents.appendingPathComponent("Backups", isDirectory: true)
        configURL = documents.appendingPathComponent("Data/model-settings.json")
        try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try? fm.createDirectory(at: backupDir, withIntermediateDirectories: true)
    }

    private func fileURL(for id: String) -> URL {
        let safe = id.map { ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") ? String($0) : "_" }.joined()
        return dataDir.appendingPathComponent(safe + ".json")
    }

    /// All documents as one JSON object string, for handing to the page at launch.
    /// Waits for pending writes first, so a reload always sees the latest data.
    func snapshotJSON() -> String { queue.sync { readAll() } }

    private func readAll() -> String {
        var parts: [String] = []
        let files = (try? fm.contentsOfDirectory(at: dataDir, includingPropertiesForKeys: nil)) ?? []
        for url in files where url.pathExtension == "json" && url.lastPathComponent != "model-settings.json" {
            guard let data = try? Data(contentsOf: url),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = obj["id"] as? String,
                  let value = obj["value"],
                  let valueData = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
                  let valueString = String(data: valueData, encoding: .utf8),
                  let keyData = try? JSONSerialization.data(withJSONObject: id, options: [.fragmentsAllowed]),
                  let keyString = String(data: keyData, encoding: .utf8) else { continue }
            parts.append(keyString + ":" + valueString)
        }
        return "{" + parts.joined(separator: ",") + "}"
    }

    func put(id: String, json: String) {
        queue.async {
            guard let valueData = json.data(using: .utf8),
                  let value = try? JSONSerialization.jsonObject(with: valueData, options: [.fragmentsAllowed]),
                  let data = try? JSONSerialization.data(withJSONObject: ["id": id, "value": value]) else { return }
            try? data.write(to: self.fileURL(for: id), options: .atomic)
            self.dirtySinceBackup = true
        }
    }

    func delete(id: String) {
        queue.async {
            try? self.fm.removeItem(at: self.fileURL(for: id))
            self.dirtySinceBackup = true
        }
    }

    func saveConfig(_ json: String) {
        queue.async {
            try? json.data(using: .utf8)?.write(to: self.configURL, options: .atomic)
            self.dirtySinceBackup = true
        }
    }

    func configJSON() -> String? {
        guard let data = try? Data(contentsOf: configURL) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// One full backup file per day (the newest 14 are kept), in the same format the
    /// app's Import button reads.
    func writeDailyBackup() {
        queue.async {
            guard self.dirtySinceBackup else { return }
            self.dirtySinceBackup = false
            // Model profiles go in too, but never API keys.
            var models = ""
            if let cfg = self.configJSON(), let data = cfg.data(using: .utf8),
               var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let profiles = obj["profiles"] as? [[String: Any]] {
                obj["profiles"] = profiles.map { p -> [String: Any] in var q = p; q.removeValue(forKey: "apiKey"); return q }
                if let out = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: out, encoding: .utf8) { models = ",\"models\":" + s }
            }
            let body = "{\"app\":\"afterglow\",\"version\":1,\"exportedAt\":\"\(ISO8601DateFormatter().string(from: Date()))\",\"docs\":" + self.readAll() + models + "}"
            let day = DateFormatter()
            day.dateFormat = "yyyy-MM-dd"
            let url = self.backupDir.appendingPathComponent("afterglow-backup-\(day.string(from: Date())).json")
            try? body.data(using: .utf8)?.write(to: url, options: .atomic)
            let old = ((try? self.fm.contentsOfDirectory(at: self.backupDir, includingPropertiesForKeys: nil)) ?? [])
                .filter { $0.pathExtension == "json" }
                .sorted { $0.lastPathComponent > $1.lastPathComponent }
            for url in old.dropFirst(14) { try? self.fm.removeItem(at: url) }
        }
    }
}
