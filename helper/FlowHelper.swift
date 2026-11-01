// Whisperline native helper.
//
// Speaks newline-delimited JSON over stdio with the Electron main process:
//   stdout events:  {"type":"ready"} {"type":"modifier","key":"fn","down":true}
//                   {"type":"escape"} {"type":"permissions",...} {"type":"reply","id":N,...}
//   stdin commands: {"id":N,"cmd":"paste"|"frontmostApp"|"permissions"|"requestAccessibility"|"requestInputMonitoring"}
//
// A listen-only CGEventTap observes modifier keys (incl. Fn/Globe, which
// Electron's globalShortcut cannot see) and Escape. Paste is a synthetic Cmd+V.

import Cocoa
import ApplicationServices

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

// Virtual key codes of the modifiers we report.
let modifierNames: [Int64: String] = [
    63: "fn", 179: "fn",
    61: "rightOption", 58: "leftOption",
    54: "rightCommand", 55: "leftCommand",
    62: "rightControl", 59: "leftControl",
]
let escapeKeyCode: Int64 = 53
let vKeyCode: CGKeyCode = 9

func flag(for name: String) -> CGEventFlags {
    switch name {
    case "fn": return .maskSecondaryFn
    case "rightOption", "leftOption": return .maskAlternate
    case "rightCommand", "leftCommand": return .maskCommand
    case "rightControl", "leftControl": return .maskControl
    default: return []
    }
}

var heldModifiers = Set<String>()
var eventTap: CFMachPort?

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    if type == .flagsChanged, let name = modifierNames[keyCode] {
        let isOn = event.flags.contains(flag(for: name))
        if !heldModifiers.contains(name) && isOn {
            heldModifiers.insert(name)
            emit(["type": "modifier", "key": name, "down": true])
        } else if heldModifiers.contains(name) {
            heldModifiers.remove(name)
            emit(["type": "modifier", "key": name, "down": false])
        }
    } else if type == .keyDown && keyCode == escapeKeyCode {
        emit(["type": "escape"])
    }
    return Unmanaged.passUnretained(event)
}

func installTap() -> Bool {
    // A listen-only tap can be created without Input Monitoring but then never
    // receives events, so only install it once access is actually granted.
    guard CGPreflightListenEventAccess() else { return false }
    let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: CGEventMask(mask),
        callback: tapCallback,
        userInfo: nil
    ) else { return false }
    eventTap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
}

func permissions() -> [String: Any] {
    return [
        "accessibility": AXIsProcessTrusted(),
        "inputMonitoring": CGPreflightListenEventAccess(),
        "keyTap": eventTap != nil,
    ]
}

func pasteViaCommandV() {
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

func handle(command: String, id: Any?) {
    var reply: [String: Any] = ["type": "reply", "id": id ?? NSNull()]
    switch command {
    case "paste":
        if AXIsProcessTrusted() {
            pasteViaCommandV()
            reply["ok"] = true
        } else {
            reply["ok"] = false
            reply["error"] = "accessibility_not_granted"
        }
    case "frontmostApp":
        let app = NSWorkspace.shared.frontmostApplication
        reply["name"] = app?.localizedName ?? NSNull()
        reply["bundleId"] = app?.bundleIdentifier ?? NSNull()
    case "permissions":
        reply.merge(permissions()) { _, new in new }
    case "requestAccessibility":
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        reply["granted"] = AXIsProcessTrustedWithOptions(options)
    case "requestInputMonitoring":
        reply["granted"] = CGRequestListenEventAccess()
    default:
        reply["error"] = "unknown_command"
    }
    emit(reply)
}

// Commands arrive on stdin; the parent closing the pipe ends the helper.
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let command = obj["cmd"] as? String else { continue }
        let id = obj["id"]
        DispatchQueue.main.async { handle(command: command, id: id) }
    }
    exit(0)
}

// Until Input Monitoring is granted the tap cannot be created; keep retrying.
if !installTap() {
    emit(["type": "permissions"].merging(permissions()) { _, new in new })
    Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { timer in
        if installTap() {
            timer.invalidate()
            emit(["type": "permissions"].merging(permissions()) { _, new in new })
        }
    }
}
emit(["type": "ready"].merging(permissions()) { _, new in new })
RunLoop.main.run()
