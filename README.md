# SnapLens 🔍

> **Instant, 100% client-side Marvel Snap deck screenshot scanner powered by WebAssembly + SIMD128.**

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Demo-emerald?style=flat-square&logo=github)](https://floatypotato123.github.io/snaplens/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-SIMD128-654FF0?style=flat-square&logo=webassembly)](https://webassembly.org/)
[![Accuracy](https://img.shields.io/badge/Benchmark%20Accuracy-100%25-gold?style=flat-square)](https://github.com/FloatyPotato123/snaplens)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-blue?style=flat-square)](https://github.com/FloatyPotato123/snaplens)

SnapLens transforms screenshots of Marvel Snap decks into official in-game export codes in sub-second time. It runs entirely inside your web browser—no uploads, no servers, and zero latency.

---

## ✨ Features

- ⚡ **Sub-Second Recognition**: Custom WebAssembly engine utilizing 128-bit SIMD vectorization across parallel browser Web Workers.
- 🎯 **Variant-Proof Accuracy**: 100% benchmark accuracy across all card finishes and variants (Pixel, Dan Hipp, Inked, Gold, 3D, Custom Splits, and Animated foils).
- 🔒 **100% Private & Offline-Capable**: Image data never leaves your device. All computer vision and template matching run locally in your browser.
- 📱 **Universal Aspect Ratio Support**: Automatically detects and extracts 6×2, 4×3, and 3×4 layouts across PC, mobile, deck trackers, and livestream captures.
- 📋 **Instant Deck Code Export**: Generates official Marvel Snap deck strings formatted and ready to paste directly into the game client.
- ✏️ **Interactive Card Editor**: Easily review detected cards, inspect match confidence, and swap cards using an instant search picker across the complete Marvel Snap card catalog.

---

## 🛠️ How It Works

```
Screenshot ──▶ Layout & Lattice Slicing ──▶ Parallel Web Workers ──▶ SIMD128 Logo Matcher ──▶ Export Deck Code
                • Aspect auto-detection     • 12 parallel threads     • Multi-scale pyramid    • One-click clipboard
                • Gradient projection       • Zero main-thread lag    • Sub-millisecond ZNCC   • In-game pasteable
```

1. **Lattice & Grid Detection**: Analyzes luminance gradient projection profiles across the screenshot to isolate the deck container and partition it into 12 clean card crops regardless of screen resolution or aspect ratio.
2. **Variant-Invariant Logo Extraction**: Card artwork varies wildly with card variants (Dan Hipp, Pixel, Inked, etc.), but card title logo silhouettes remain structurally invariant. The scanner isolates the logo region at the base of each card.
3. **WebAssembly SIMD128 Acceleration**: Sliced logo contours are evaluated against the database using a coarse-to-fine multi-scale matching pyramid running directly in WebAssembly vector registers.
4. **Deck Code Serialization**: Identified cards are mapped to their official Marvel Snap `cardDefId` tokens and packed into base64 deck export payloads.

---

## 🚀 Getting Started

### Live In-Browser
Visit the live deployment at **[https://floatypotato123.github.io/snaplens/](https://floatypotato123.github.io/snaplens/)**.

### Running Locally
SnapLens requires no heavy build step to run in development:

1. Clone the repository:
   ```bash
   git clone https://github.com/FloatyPotato123/snaplens.git
   cd snaplens
   ```

2. Start a local static file server (for example with Node or Python):
   ```bash
   node serve.js
   # or: npx serve .
   # or: python3 -m http.server 8080
   ```

3. Open `http://localhost:8080` in any modern web browser.

---

## 🔧 Building WebAssembly from Source

The WebAssembly engine source is written in AssemblyScript in `src/wasm/matcher.ts` and compiles into a tiny 3 KB native binary.

To recompile the WASM binary locally:

```bash
npm install
npm run build:wasm
```

*(Note: The GitHub Actions deployment workflow automatically compiles the latest WASM binary on every push to `main`.)*

---

## 🧪 Running Benchmarks

Run the parallel benchmark suite across real-world deck screenshots:

```bash
npm test
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
