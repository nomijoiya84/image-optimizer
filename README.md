# Image Optimizer

A beautiful, modern web application for optimizing images locally in your browser. Inspired by popular image optimization tools like TinyPNG, Imagify, and ShortPixel.

## Features

- 🖼️ **Drag & Drop Upload** - Easily upload images by dragging and dropping
- 🎨 **Quality Control** - Adjust compression quality (10-100%)
- 📐 **Resize Images** - Set maximum width and height while maintaining aspect ratio
- 🔄 **Format Conversion** - Convert to JPEG, PNG, WebP, AVIF, or JPEG XL
- 🤖 **Smart Recommendations** - Automatically suggests the best codec based on transparency or motion
- 📊 **Before/After Comparison** - See file size reduction and compression statistics
- 💾 **Download Optimized** - Download your optimized images instantly
- 🎯 **Client-Side Processing** - All processing happens in your browser (privacy-friendly)

## How to Run

### Option 1: Using Python (Recommended)

1. Open a terminal/command prompt in this directory
2. Run:
   ```bash
   python server.py
   ```
3. The page will automatically open in your browser at `http://localhost:8080`

### Option 2: Using Node.js

1. Install `http-server` globally (if not already installed):
   ```bash
   npm install -g http-server
   ```
2. Run:
   ```bash
   http-server -p 8080
   ```
3. Open `http://localhost:8080` in your browser

### Option 3: Direct File Opening

Simply double-click `index.html` to open it in your browser. Note: Some features may be limited due to browser security restrictions.

## Usage

1. **Upload Images**: Click the upload area or drag and drop your images
2. **Adjust Settings**: 
   - Set quality (lower = smaller file, higher = better quality)
   - Set maximum width and height
   - Choose an output format (Auto Smart, JPEG, PNG, WebP, AVIF, or JPEG XL)
3. **Optimize**: Click the "Optimize Images" button
4. **Download**: Click "Download Optimized" on each image card

## Browser Compatibility

Works best in modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

## Notes

- All processing is done client-side in your browser
- No images are uploaded to any server
- Original images are not modified
- Next-gen formats (WebP, AVIF, JPEG XL) now bundle WASM encoders (via jSquash) so they work even if your browser lacks native support. The tiny encoder modules load from jsDelivr the first time you choose those formats.

## Inspired By

- TinyPNG/TinyJPG
- Imagify
- ShortPixel
- Smush
- EWWW Image Optimizer

