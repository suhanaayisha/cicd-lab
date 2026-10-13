// Renders each page of the menu PDF to a JPEG for the homepage.
// Usage: swift scripts/pdf-to-menu.swift <input.pdf> <output-dir>  (macOS only)
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: pdf-to-menu.swift <input.pdf> <output-dir>\n".data(using: .utf8)!)
  exit(1)
}
let outDir = URL(fileURLWithPath: args[2])
let targetWidth: CGFloat = 1600

// Clear old pages so a shorter menu doesn't leave stale images behind.
let fileManager = FileManager.default
try fileManager.createDirectory(at: outDir, withIntermediateDirectories: true)
for name in try fileManager.contentsOfDirectory(atPath: outDir.path) where name.hasPrefix("page-") && name.hasSuffix(".jpg") {
  try fileManager.removeItem(at: outDir.appendingPathComponent(name))
}

for i in 0..<doc.pageCount {
  let page = doc.page(at: i)!
  let bounds = page.bounds(for: .mediaBox)
  let scale = targetWidth / bounds.width
  let size = NSSize(width: targetWidth, height: (bounds.height * scale).rounded())
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  ctx.cgContext.setFillColor(NSColor.white.cgColor)
  ctx.cgContext.fill(CGRect(origin: .zero, size: size))
  ctx.cgContext.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx.cgContext)
  NSGraphicsContext.restoreGraphicsState()
  let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82])!
  try data.write(to: outDir.appendingPathComponent("page-\(i + 1).jpg"))
}
print("Rendered \(doc.pageCount) pages to \(outDir.path)")
