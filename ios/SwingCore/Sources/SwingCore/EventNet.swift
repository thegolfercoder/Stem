import Foundation

/// The trained dilated temporal convolutional network: per-frame scores over the
/// eight swing events and background. A port of webapp/model.js, channels-first
/// like PyTorch so the exported weights are used exactly as laid out.
public final class EventNet {
    let arch: ModelPayload.Architecture
    private var tensors: [String: [Float]] = [:]

    public init(architecture: ModelPayload.Architecture, tensors manifest: [ModelPayload.Tensor],
                weightsBase64: String) throws {
        arch = architecture
        guard let data = Data(base64Encoded: weightsBase64) else {
            throw SwingError.badWeights("not base64")
        }
        let floats: [Float] = data.withUnsafeBytes { raw in
            Array(raw.bindMemory(to: Float.self))
        }
        for t in manifest {
            guard t.offset + t.count <= floats.count else {
                throw SwingError.badWeights("\(t.name) runs past the end of the weights")
            }
            tensors[t.name] = Array(floats[t.offset..<(t.offset + t.count)])
        }
    }

    private func tensor(_ name: String) -> [Float] { tensors[name] ?? [] }

    /// A 1-D convolution over time; input is (channelsIn x n) row-major.
    private func conv1d(_ input: [Float], _ channelsIn: Int, _ channelsOut: Int, _ n: Int,
                        _ weight: [Float], _ bias: [Float], _ kernel: Int, _ dilation: Int) -> [Float] {
        var out = [Float](repeating: 0, count: channelsOut * n)
        let pad = dilation * (kernel - 1) / 2
        let replicate = arch.paddingMode == "replicate"
        input.withUnsafeBufferPointer { x in
            out.withUnsafeMutableBufferPointer { o in
                for co in 0..<channelsOut {
                    let base = co * n
                    for t in 0..<n { o[base + t] = bias[co] }
                    for ci in 0..<channelsIn {
                        let inBase = ci * n
                        for k in 0..<kernel {
                            let w = weight[(co * channelsIn + ci) * kernel + k]
                            if w == 0 { continue }
                            let shift = k * dilation - pad
                            let from = max(0, -shift)
                            let to = min(n, n - shift)
                            if from < to {
                                for t in from..<to { o[base + t] += w * x[inBase + t + shift] }
                            }
                            if !replicate { continue }
                            // Beyond the clip, the nearest real frame.
                            let head = min(max(from, 0), n), tail = min(max(to, 0), n)
                            let first = x[inBase], last = x[inBase + n - 1]
                            for t in 0..<head { o[base + t] += w * first }
                            for t in tail..<n { o[base + t] += w * last }
                        }
                    }
                }
            }
        }
        return out
    }

    private func groupNorm(_ x: inout [Float], _ channels: Int, _ n: Int,
                           _ weight: [Float], _ bias: [Float], _ groups: Int) {
        let perGroup = channels / groups
        for g in 0..<groups {
            let start = g * perGroup
            var sum = 0.0, squares = 0.0
            let count = Double(perGroup * n)
            for c in start..<(start + perGroup) {
                for t in 0..<n { let v = Double(x[c * n + t]); sum += v; squares += v * v }
            }
            let mean = sum / count
            let inverse = 1 / (squares / count - mean * mean + 1e-5).squareRoot()
            for c in start..<(start + perGroup) {
                let w = Double(weight[c]), b = Double(bias[c])
                for t in 0..<n { x[c * n + t] = Float((Double(x[c * n + t]) - mean) * inverse * w + b) }
            }
        }
    }

    /// The exact erf-based GELU, as the network was trained with.
    private func gelu(_ x: inout [Float]) {
        for i in 0..<x.count {
            let v = Double(x[i])
            x[i] = Float(0.5 * v * (1 + erf(v / 2.0.squareRoot())))
        }
    }

    /// (n x width) features in, (n x classes) logits out.
    public func forward(_ features: [Float], n: Int, width: Int) -> [Float] {
        let channels = arch.channels, kernel = arch.kernelSize
        var input = [Float](repeating: 0, count: width * n)
        for t in 0..<n { for f in 0..<width { input[f * n + t] = features[t * width + f] } }

        var x = conv1d(input, width, channels, n, tensor("input_projection.weight"),
                       tensor("input_projection.bias"), 1, 1)
        groupNorm(&x, channels, n, tensor("input_norm.weight"), tensor("input_norm.bias"), arch.groups)
        gelu(&x)
        for (index, dilation) in arch.dilations.enumerated() {
            let residual = x
            var h = conv1d(x, channels, channels, n, tensor("blocks.\(index).conv1.weight"),
                           tensor("blocks.\(index).conv1.bias"), kernel, dilation)
            groupNorm(&h, channels, n, tensor("blocks.\(index).norm1.weight"),
                      tensor("blocks.\(index).norm1.bias"), arch.groups)
            gelu(&h)
            h = conv1d(h, channels, channels, n, tensor("blocks.\(index).conv2.weight"),
                       tensor("blocks.\(index).conv2.bias"), kernel, dilation)
            groupNorm(&h, channels, n, tensor("blocks.\(index).norm2.weight"),
                      tensor("blocks.\(index).norm2.bias"), arch.groups)
            gelu(&h)
            for i in 0..<h.count { h[i] += residual[i] }
            x = h
        }
        let head = conv1d(x, channels, arch.classes, n, tensor("head.weight"), tensor("head.bias"), 1, 1)
        var logits = [Float](repeating: 0, count: n * arch.classes)
        for t in 0..<n { for c in 0..<arch.classes { logits[t * arch.classes + c] = head[c * n + t] } }
        return logits
    }
}

/// One network or several at several speeds, averaged in probability space, as
/// swingml.model.ensemble and the browser's SwingEventModel do. A single network
/// at one speed returns its own logits untouched.
public final class EventModel {
    public let nets: [EventNet]
    public let warps: [Double]
    public let classes: Int
    private let perSecond: [[Int]]

    public init(payload: ModelPayload) throws {
        var nets = [try EventNet(architecture: payload.architecture, tensors: payload.tensors,
                                 weightsBase64: payload.weightsBase64)]
        if let members = payload.members, !members.isEmpty {
            nets = try members.map {
                try EventNet(architecture: payload.architecture, tensors: $0.tensors,
                             weightsBase64: $0.weightsBase64)
            }
        }
        self.nets = nets
        let warps = payload.timeWarps ?? [1.0]
        self.warps = warps.isEmpty ? [1.0] : warps
        classes = payload.architecture.classes
        let layout = payload.features.layout
        perSecond = [layout.velocities, layout.speeds, layout.handVelocity, layout.handSpeed]
    }

    private func warp(_ features: [Float], n: Int, width: Int, factor: Double) -> ([Float], Int) {
        let target = max(16, Int((Double(n) * factor).rounded()))
        var out = [Float](repeating: 0, count: target * width)
        for i in 0..<target {
            let source = target == 1 ? 0 : Double(i) * Double(n - 1) / Double(target - 1)
            let lower = Int(source.rounded(.down)), upper = min(lower + 1, n - 1)
            let blend = Float(source - Double(lower))
            for f in 0..<width {
                out[i * width + f] = features[lower * width + f] * (1 - blend) + features[upper * width + f] * blend
            }
        }
        for span in perSecond {
            for i in 0..<target { for f in span[0]..<span[1] { out[i * width + f] /= Float(factor) } }
        }
        return (out, target)
    }

    public func forward(_ features: [Float], n: Int, width: Int) -> [Float] {
        if nets.count == 1 && warps == [1.0] { return nets[0].forward(features, n: n, width: width) }
        let C = classes
        var sum = [Double](repeating: 0, count: n * C)
        var count = 0
        for factor in warps {
            let (view, target) = factor == 1.0 ? (features, n) : warp(features, n: n, width: width, factor: factor)
            for net in nets {
                let probs = softmaxRows(net.forward(view, n: target, width: width), target, C)
                for t in 0..<n {
                    let source = n == 1 ? 0 : Double(t) * Double(target - 1) / Double(n - 1)
                    let lower = Int(source.rounded(.down)), upper = min(lower + 1, target - 1)
                    let blend = source - Double(lower)
                    for c in 0..<C {
                        sum[t * C + c] += probs[lower * C + c] * (1 - blend) + probs[upper * C + c] * blend
                    }
                }
                count += 1
            }
        }
        return sum.map { Float(log(max($0 / Double(count), 1e-12))) }
    }
}

func softmaxRows(_ logits: [Float], _ n: Int, _ C: Int) -> [Double] {
    var out = [Double](repeating: 0, count: n * C)
    for t in 0..<n {
        var biggest = -Double.infinity
        for c in 0..<C { biggest = max(biggest, Double(logits[t * C + c])) }
        var total = 0.0
        for c in 0..<C { let e = exp(Double(logits[t * C + c]) - biggest); out[t * C + c] = e; total += e }
        for c in 0..<C { out[t * C + c] /= total }
    }
    return out
}
