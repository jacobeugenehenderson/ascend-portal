#!/usr/bin/env python3
"""
Generate WebP thumbnails from source files.
Uses psd-tools for proper PSD composite extraction.
Uses PyMuPDF for AI files (they're PDF-based).
Uses cairosvg for SVG rasterization.
"""

import os
import sys
import hashlib
import subprocess
import tempfile
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage
import fitz  # PyMuPDF
try:
    import cairosvg
    HAS_CAIROSVG = True
except ImportError:
    HAS_CAIROSVG = False
    print("Warning: cairosvg not installed, SVG thumbnails will be skipped")

# Allow large images (some PSDs are huge)
Image.MAX_IMAGE_PIXELS = 400_000_000

# Configuration
LIBRARY_PATH = Path("/Volumes/Today/Nordson/LIBRARY")
PUBLICATIONS_PATH = Path("/Volumes/Today/Nordson/PUBLICATIONS")
THUMBS_PATH = Path("/Volumes/Today/ascend-portal/library/thumbs")
THUMBS_LG_PATH = Path("/Volumes/Today/ascend-portal/library/thumbs-lg")
MAX_SIZE = 400       # Small thumbnails for grid cards
MAX_SIZE_LG = 1200   # Large thumbnails for modal preview
WEBP_QUALITY = 82

def get_thumb_id(rel_path: str) -> str:
    """Generate consistent ID from relative path."""
    return hashlib.md5(rel_path.encode()).hexdigest()[:12]

def save_both_sizes(img: Image.Image, thumb_id: str, force: bool = False) -> tuple:
    """Save image at both small and large sizes. Returns (small_saved, large_saved)."""
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    small_saved = False
    large_saved = False

    # Convert color mode - preserve RGBA for transparency, convert others to RGB
    if img.mode == 'RGBA':
        pass  # Keep RGBA for transparency support in WebP
    elif img.mode == 'CMYK':
        img = img.convert('RGB')
    elif img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')

    width, height = img.size

    # Save large version first (from original)
    if force or not large_path.exists():
        if width > height:
            new_width = MAX_SIZE_LG
            new_height = int(height * (MAX_SIZE_LG / width))
        else:
            new_height = MAX_SIZE_LG
            new_width = int(width * (MAX_SIZE_LG / height))

        if width > MAX_SIZE_LG or height > MAX_SIZE_LG:
            img_lg = img.resize((new_width, new_height), Image.LANCZOS)
        else:
            img_lg = img
        img_lg.save(large_path, 'WebP', quality=WEBP_QUALITY)
        large_saved = True

    # Save small version
    if force or not small_path.exists():
        if width > height:
            new_width = MAX_SIZE
            new_height = int(height * (MAX_SIZE / width))
        else:
            new_height = MAX_SIZE
            new_width = int(width * (MAX_SIZE / height))

        img_sm = img.resize((new_width, new_height), Image.LANCZOS)
        img_sm.save(small_path, 'WebP', quality=WEBP_QUALITY)
        small_saved = True

    return (small_saved, large_saved)

def generate_psd_thumbnail(src_path: Path, rel_path: str) -> bool:
    """Generate WebP thumbnails (small + large) from PSD file using psd-tools."""
    thumb_id = get_thumb_id(rel_path)
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    # Skip if both already exist
    if small_path.exists() and large_path.exists():
        return True

    try:
        # Use psd-tools for proper composite extraction
        psd = PSDImage.open(src_path)
        img = psd.composite()

        if img is None:
            raise ValueError("No composite image in PSD")

        # Save both sizes
        save_both_sizes(img, thumb_id)
        return True

    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False

def generate_ai_thumbnail(src_path: Path, rel_path: str) -> bool:
    """Generate WebP thumbnails (small + large) from AI file using PyMuPDF."""
    thumb_id = get_thumb_id(rel_path)
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    # Skip if both already exist
    if small_path.exists() and large_path.exists():
        return True

    try:
        # Open AI file (PDF-based format)
        doc = fitz.open(src_path)
        page = doc[0]  # First page

        # Calculate zoom factor to get high-res render for large thumbnail
        rect = page.rect
        width, height = rect.width, rect.height

        # Render at scale for MAX_SIZE_LG (we'll downscale for small)
        if width > height:
            scale = MAX_SIZE_LG / width
        else:
            scale = MAX_SIZE_LG / height

        # Render at calculated scale (minimum 2x for quality)
        zoom = max(scale, 2.0)
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)

        # Convert to PIL Image
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        doc.close()

        # Save both sizes
        save_both_sizes(img, thumb_id)
        return True

    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False

def auto_crop_whitespace(img: Image.Image, padding: int = 10) -> Image.Image:
    """Crop to content bounding box, preserving alpha channel.

    Args:
        img: PIL Image to crop (preserves RGBA if present)
        padding: Pixels of padding to keep around content
    """
    # Ensure RGBA mode for consistent alpha handling
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Use alpha channel to find content (non-transparent pixels)
    alpha = img.split()[3]
    bbox = alpha.getbbox()

    if bbox is None:
        # Fully transparent, return as-is
        return img

    # Add padding
    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(img.width, x2 + padding)
    y2 = min(img.height, y2 + padding)

    return img.crop((x1, y1, x2, y2))

def create_checkerboard(size: int, square_size: int = 10) -> Image.Image:
    """Create a checkerboard pattern for transparency visualization."""
    img = Image.new('RGB', (size, size))
    pixels = img.load()
    light = (240, 240, 240)
    dark = (200, 200, 200)

    for y in range(size):
        for x in range(size):
            if ((x // square_size) + (y // square_size)) % 2 == 0:
                pixels[x, y] = light
            else:
                pixels[x, y] = dark
    return img

def center_on_canvas(img: Image.Image, canvas_size: int, padding_pct: float = 0.1,
                     transparent: bool = False, checkerboard: bool = False) -> Image.Image:
    """Center image on a square canvas with padding.

    Args:
        img: Source image
        canvas_size: Output canvas size (square)
        padding_pct: Padding as percentage of canvas size
        transparent: If True, use transparent background (RGBA)
        checkerboard: If True, use checkerboard pattern background
    """
    # Ensure we have alpha channel for transparency detection
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Calculate size to fit within canvas with padding
    max_content_size = int(canvas_size * (1 - padding_pct * 2))

    # Scale image to fit
    w, h = img.size
    if w > h:
        new_w = max_content_size
        new_h = int(h * (max_content_size / w))
    else:
        new_h = max_content_size
        new_w = int(w * (max_content_size / h))

    # Resize if needed
    if new_w != w or new_h != h:
        img = img.resize((new_w, new_h), Image.LANCZOS)

    # Calculate centered position
    x = (canvas_size - img.width) // 2
    y = (canvas_size - img.height) // 2

    if transparent:
        # Transparent canvas
        canvas = Image.new('RGBA', (canvas_size, canvas_size), (255, 255, 255, 0))
        canvas.paste(img, (x, y), img)
    elif checkerboard:
        # Checkerboard background
        canvas = create_checkerboard(canvas_size)
        canvas.paste(img, (x, y), img)
    else:
        # White background
        canvas = Image.new('RGB', (canvas_size, canvas_size), (255, 255, 255))
        canvas.paste(img, (x, y), img if img.mode == 'RGBA' else None)

    return canvas

def generate_eps_thumbnail(src_path: Path, rel_path: str) -> bool:
    """Generate WebP thumbnails (small + large) from EPS file using Ghostscript directly."""
    thumb_id = get_thumb_id(rel_path)
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    # Skip if both already exist
    if small_path.exists() and large_path.exists():
        return True

    try:
        # Use Ghostscript directly (much faster than Pillow's EPS handler)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_png = Path(tmp_dir) / "render.png"

            # Render at 300 DPI with EPS crop and transparency
            # -dEPSCrop crops to the EPS bounding box
            # pngalpha device preserves transparency
            result = subprocess.run([
                "gs", "-dNOPAUSE", "-dBATCH", "-dSAFER",
                "-sDEVICE=pngalpha", "-r300", "-dEPSCrop",
                "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
                f"-sOutputFile={tmp_png}", str(src_path)
            ], capture_output=True, timeout=30)

            if not tmp_png.exists():
                raise ValueError(f"Ghostscript failed: {result.stderr.decode()[:100]}")

            with Image.open(tmp_png) as img:
                # Auto-crop any remaining whitespace from the render
                img = auto_crop_whitespace(img)

                # Large thumbnail: transparent background for modal preview
                img_lg = center_on_canvas(img, MAX_SIZE_LG, padding_pct=0.05, transparent=True)
                img_lg.save(large_path, 'WebP', quality=WEBP_QUALITY)

                # Small thumbnail: checkerboard background for grid visibility
                img_sm = center_on_canvas(img, MAX_SIZE, padding_pct=0.05, checkerboard=True)
                img_sm.save(small_path, 'WebP', quality=WEBP_QUALITY)

        return True

    except subprocess.TimeoutExpired:
        print(f"  ERROR: Timeout", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False

def generate_raster_thumbnail(src_path: Path, rel_path: str) -> bool:
    """Generate WebP thumbnails from raster images (PNG, JPG, GIF, WebP)."""
    thumb_id = get_thumb_id(rel_path)
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    # Skip if both already exist
    if small_path.exists() and large_path.exists():
        return True

    try:
        with Image.open(src_path) as img:
            save_both_sizes(img, thumb_id)
        return True
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False

def generate_svg_thumbnail(src_path: Path, rel_path: str) -> bool:
    """Generate WebP thumbnails from SVG files using cairosvg."""
    if not HAS_CAIROSVG:
        return False

    thumb_id = get_thumb_id(rel_path)
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    # Skip if both already exist
    if small_path.exists() and large_path.exists():
        return True

    try:
        # Render SVG to PNG at high resolution for quality
        png_data = cairosvg.svg2png(url=str(src_path), output_width=MAX_SIZE_LG)

        # Load into PIL
        from io import BytesIO
        img = Image.open(BytesIO(png_data))

        save_both_sizes(img, thumb_id)
        return True
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False

def find_files(extensions: list, label: str) -> list:
    """Find files with given extensions from both sources."""
    files = []

    for ext in extensions:
        # Library files
        for file_path in list(LIBRARY_PATH.rglob(f"*.{ext}")) + list(LIBRARY_PATH.rglob(f"*.{ext.upper()}")):
            if not file_path.name.startswith("._"):
                rel_path = str(file_path.relative_to(LIBRARY_PATH))
                full_path = f"library/{rel_path}"
                files.append((file_path, full_path))

        # Publications files
        if PUBLICATIONS_PATH.exists():
            for file_path in list(PUBLICATIONS_PATH.rglob(f"*.{ext}")) + list(PUBLICATIONS_PATH.rglob(f"*.{ext.upper()}")):
                if not file_path.name.startswith("._"):
                    rel_path = str(file_path.relative_to(PUBLICATIONS_PATH))
                    full_path = f"publications/{rel_path}"
                    files.append((file_path, full_path))

    return files

def process_files(files: list, generator_func, label: str):
    """Process files with the given generator function."""
    print(f"Found {len(files)} {label} files")

    success = 0
    failed = 0
    skipped = 0

    for i, (file_path, full_path) in enumerate(files, 1):
        thumb_id = get_thumb_id(full_path)
        small_path = THUMBS_PATH / f"{thumb_id}.webp"
        large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

        # Progress
        print(f"[{i}/{len(files)}] {file_path.name[:50]}...", end=" ", flush=True)

        # Skip only if BOTH sizes exist
        if small_path.exists() and large_path.exists():
            print("SKIP (exists)")
            skipped += 1
            continue

        if generator_func(file_path, full_path):
            print("OK")
            success += 1
        else:
            print("FAILED")
            failed += 1

    print(f"\n{label} Done: {success} generated, {skipped} skipped, {failed} failed")

def main():
    THUMBS_PATH.mkdir(exist_ok=True)
    THUMBS_LG_PATH.mkdir(exist_ok=True)

    # Parse command line args
    file_type = sys.argv[1] if len(sys.argv) > 1 else "psd"

    if file_type == "psd":
        files = find_files(["psd"], "PSD")
        process_files(files, generate_psd_thumbnail, "PSD")
    elif file_type == "ai":
        files = find_files(["ai"], "AI")
        process_files(files, generate_ai_thumbnail, "AI")
    elif file_type == "eps":
        files = find_files(["eps"], "EPS")
        process_files(files, generate_eps_thumbnail, "EPS")
    elif file_type == "raster":
        files = find_files(["png", "jpg", "jpeg", "gif", "webp"], "Raster")
        process_files(files, generate_raster_thumbnail, "Raster")
    elif file_type == "svg":
        if not HAS_CAIROSVG:
            print("ERROR: cairosvg required for SVG thumbnails. Install with: pip install cairosvg")
            sys.exit(1)
        files = find_files(["svg"], "SVG")
        process_files(files, generate_svg_thumbnail, "SVG")
    elif file_type == "all":
        # Process all types
        psd_files = find_files(["psd"], "PSD")
        process_files(psd_files, generate_psd_thumbnail, "PSD")
        print()
        ai_files = find_files(["ai"], "AI")
        process_files(ai_files, generate_ai_thumbnail, "AI")
        print()
        eps_files = find_files(["eps"], "EPS")
        process_files(eps_files, generate_eps_thumbnail, "EPS")
        print()
        raster_files = find_files(["png", "jpg", "jpeg", "gif", "webp"], "Raster")
        process_files(raster_files, generate_raster_thumbnail, "Raster")
        print()
        if HAS_CAIROSVG:
            svg_files = find_files(["svg"], "SVG")
            process_files(svg_files, generate_svg_thumbnail, "SVG")
        else:
            print("Skipping SVG (cairosvg not installed)")
    else:
        print(f"Usage: {sys.argv[0]} [psd|ai|eps|raster|svg|all]")
        print("  psd    - Generate thumbnails for PSD files (default)")
        print("  ai     - Generate thumbnails for AI files")
        print("  eps    - Generate thumbnails for EPS files")
        print("  raster - Generate thumbnails for PNG, JPG, GIF, WebP files")
        print("  svg    - Generate thumbnails for SVG files (requires cairosvg)")
        print("  all    - Generate thumbnails for all supported types")
        print()
        print("Note: INDD files are source files shown with a badge, not thumbnailed.")
        sys.exit(1)

if __name__ == "__main__":
    main()
