// Loại bỏ alpha khỏi AppIcon; giữ logo hiện tại và đặt trên nền trắng.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let directory = URL(fileURLWithPath: CommandLine.arguments.count > 1
  ? CommandLine.arguments[1] : "ios/Runner/Assets.xcassets/AppIcon.appiconset")
for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
where url.pathExtension.lowercased() == "png" {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let original = CGImageSourceCreateImageAtIndex(source, 0, nil),
        let context = CGContext(data: nil, width: original.width, height: original.height,
          bitsPerComponent: 8, bytesPerRow: original.width * 4,
          space: CGColorSpace(name: CGColorSpace.sRGB)!,
          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Không đọc được icon: \(url.lastPathComponent)")
  }
  let rect = CGRect(x: 0, y: 0, width: original.width, height: original.height)
  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(rect)
  context.draw(original, in: rect)
  let temp = url.appendingPathExtension("tmp")
  guard let image = context.makeImage(),
        let destination = CGImageDestinationCreateWithURL(temp as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Không ghi được icon")
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Không xuất được PNG") }
  _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
  print("Opaque PNG: \(url.lastPathComponent)")
}
