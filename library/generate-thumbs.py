#!/usr/bin/env python3
"""
Generate WebP thumbnails from source files.
Uses psd-tools for proper PSD composite extraction.
Uses PyMuPDF for AI files (they're PDF-based).
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

    # Convert to RGB if necessary
    if img.mode == 'RGBA':
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode == 'CMYK':
        img = img.convert('RGB')
    elif img.mode != 'RGB':
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

            # Render at 150 DPI - gives good quality for most EPS files
            result = subprocess.run([
                "gs", "-dNOPAUSE", "-dBATCH", "-dSAFER",
                "-sDEVICE=png16m", "-r150",
                "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
                f"-sOutputFile={tmp_png}", str(src_path)
            ], capture_output=True, timeout=30)

            if not tmp_png.exists():
                raise ValueError(f"Ghostscript failed: {result.stderr.decode()[:100]}")

            # Convert to WebP at both sizes
            with Image.open(tmp_png) as img:
                save_both_sizes(img, thumb_id)

        return True

    except subprocess.TimeoutExpired:
        print(f"  ERROR: Timeout", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return False

def generate_indd_thumbnail(src_path: Path, rel_path: str) -> bool:
    """Generate WebP thumbnails (small + large) from InDesign file using Quick Look."""
    thumb_id = get_thumb_id(rel_path)
    small_path = THUMBS_PATH / f"{thumb_id}.webp"
    large_path = THUMBS_LG_PATH / f"{thumb_id}.webp"

    # Skip if both already exist
    if small_path.exists() and large_path.exists():
        return True

    try:
        # Use Quick Look to generate preview at large size
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)

            # qlmanage generates a PNG preview
            result = subprocess.run(
                ["qlmanage", "-t", "-s", str(MAX_SIZE_LG), "-o", str(tmp_path), str(src_path)],
                capture_output=True,
                timeout=60
            )

            # qlmanage creates file with .png suffix added to original name
            ql_output = tmp_path / f"{src_path.name}.png"

            if not ql_output.exists():
                raise ValueError("Quick Look failed to generate preview")

            # Convert to WebP at both sizes
            with Image.open(ql_output) as img:
                save_both_sizes(img, thumb_id)

        return True

    except subprocess.TimeoutExpired:
        print(f"  ERROR: Timeout", file=sys.stderr)
        return False
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
    elif file_type == "indd":
        files = find_files(["indd"], "INDD")
        process_files(files, generate_indd_thumbnail, "INDD")
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
        indd_files = find_files(["indd"], "INDD")
        process_files(indd_files, generate_indd_thumbnail, "INDD")
    else:
        print(f"Usage: {sys.argv[0]} [psd|ai|eps|indd|all]")
        print("  psd  - Generate thumbnails for PSD files (default)")
        print("  ai   - Generate thumbnails for AI files")
        print("  eps  - Generate thumbnails for EPS files")
        print("  indd - Generate thumbnails for InDesign files")
        print("  all  - Generate thumbnails for all supported types")
        sys.exit(1)

if __name__ == "__main__":
    main()
