import ExpoModulesCore
import Network

/// Finds IPP printers on the local network (Bonjour service types _ipp._tcp and _ipps._tcp)
/// with NWBrowser. scan(timeoutMs) resolves with one record per service:
///   { name, type: "ipp" | "ipps", port, addresses: [String], txt: [String: String] }
///
/// Needs NSLocalNetworkUsageDescription and NSBonjourServices in Info.plist (set in app.json).
public final class PrinterDiscoveryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PrinterDiscovery")

    AsyncFunction("scan") { (timeoutMs: Int, promise: Promise) in
      let scan = Scan(timeout: Double(max(1000, min(timeoutMs, 15000))) / 1000.0) { results in
        promise.resolve(results)
      }
      scan.start()
    }

    AsyncFunction("probePrinter") { (_: String, promise: Promise) in
      promise.reject("UNSUPPORTED", "probePrinter is Android-specific; iOS uses AirPrint")
    }

    AsyncFunction("sendIpp") { (_: String, _: String, promise: Promise) in
      promise.reject("UNSUPPORTED", "sendIpp is Android-specific")
    }

    AsyncFunction("printRaster") { (_: String, _: String, _: [String: Any], promise: Promise) in
      promise.reject("UNSUPPORTED", "printRaster is Android-specific; iOS uses AirPrint")
    }

    AsyncFunction("getJobStatus") { (_: String, _: Int, promise: Promise) in
      promise.reject("UNSUPPORTED", "getJobStatus is Android-specific")
    }

    AsyncFunction("startStationService") { (_: String, _: String, promise: Promise) in
      promise.resolve(false)
    }

    AsyncFunction("stopStationService") { (promise: Promise) in
      promise.resolve(false)
    }

    AsyncFunction("isStationServiceRunning") { (promise: Promise) in
      promise.resolve(false)
    }

    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      promise.resolve(true)
    }
  }
}

private final class Scan {
  private let timeout: TimeInterval
  private let done: ([[String: Any]]) -> Void
  private let queue = DispatchQueue(label: "funprinting.printer-discovery")
  private var browsers: [NWBrowser] = []
  private var connections: [NWConnection] = []
  private var results: [String: [String: Any]] = [:]
  private var finished = false

  init(timeout: TimeInterval, done: @escaping ([[String: Any]]) -> Void) {
    self.timeout = timeout
    self.done = done
  }

  func start() {
    for (serviceType, label) in [("_ipp._tcp", "ipp"), ("_ipps._tcp", "ipps")] {
      let browser = NWBrowser(for: .bonjourWithTXTRecord(type: serviceType, domain: nil), using: NWParameters())
      browser.browseResultsChangedHandler = { [weak self] found, _ in
        for result in found { self?.resolve(result, label: label) }
      }
      browser.start(queue: queue)
      browsers.append(browser)
    }
    queue.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.finish() }
  }

  /// Opening a connection is how NWBrowser results become an address and port.
  private func resolve(_ result: NWBrowser.Result, label: String) {
    guard case let .service(name, _, _, _) = result.endpoint else { return }
    var txt: [String: String] = [:]
    if case let .bonjour(record) = result.metadata { txt = record.dictionary }
    let key = "\(label)|\(name)"
    if results[key] != nil { return }
    results[key] = ["name": name, "type": label, "port": 631, "addresses": [String](), "txt": txt]

    let connection = NWConnection(to: result.endpoint, using: .tcp)
    connections.append(connection)
    connection.stateUpdateHandler = { [weak self, weak connection] state in
      guard let self = self, let connection = connection else { return }
      if case .ready = state, let remote = connection.currentPath?.remoteEndpoint, case let .hostPort(host, port) = remote {
        var address = "\(host)"
        if let percent = address.firstIndex(of: "%") { address = String(address[..<percent]) }
        if !address.hasPrefix("fe80:") && !address.hasPrefix("169.254.") {
          self.results[key]?["addresses"] = [address]
        }
        self.results[key]?["port"] = Int(port.rawValue)
        connection.cancel()
      }
    }
    connection.start(queue: queue)
  }

  private func finish() {
    if finished { return }
    finished = true
    browsers.forEach { $0.cancel() }
    connections.forEach { $0.cancel() }
    done(Array(results.values))
  }
}
