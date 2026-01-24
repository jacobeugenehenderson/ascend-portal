#!/usr/bin/env python3
"""
Library Manifest Generator
Scans the library folder and produces library-manifest.json
Generates thumbnails for non-web formats using Quick Look.

Usage:
    python3 generate-manifest.py           # Full scan with thumbnails
    python3 generate-manifest.py --no-thumbs   # Skip thumbnail generation
    python3 generate-manifest.py --thumbs-only # Only generate missing thumbnails
"""

import os
import sys
import json
import hashlib
import subprocess
import shutil
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

# Configuration
LIBRARY_PATH = "/Volumes/Today/Nordson/LIBRARY"
PUBLICATIONS_PATH = "/Volumes/Today/Nordson/PUBLICATIONS"
STOCK_FOLDER = "STOCK"
OUTPUT_FILE = "library-manifest.json"
THUMBS_DIR = "thumbs"
THUMB_SIZE = 400  # pixels

# File extensions
WEB_DISPLAYABLE = {'.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'}
NEEDS_CONVERSION = {'.pdf', '.ai', '.psd', '.eps'}  # Need special handling (Quick Look or PyMuPDF)
PROJECT_FILE_EXTENSIONS = {'.indd'}  # Track these but don't list them
ALL_EXTENSIONS = WEB_DISPLAYABLE | NEEDS_CONVERSION | PROJECT_FILE_EXTENSIONS
# All displayable files need thumbnails for GitHub Pages hosting
NEEDS_THUMBNAIL = WEB_DISPLAYABLE | NEEDS_CONVERSION


def generate_asset_id(path: str) -> str:
    """Generate a stable ID from the file path."""
    return hashlib.md5(path.encode()).hexdigest()[:12]


def get_image_dimensions(filepath: Path, ext: str) -> dict:
    """Extract width, height, and DPI from an image file."""
    result = {}
    try:
        with Image.open(filepath) as img:
            result["width"] = img.width
            result["height"] = img.height
            # Get DPI if available
            dpi = img.info.get("dpi")
            if dpi:
                # DPI can be tuple (x_dpi, y_dpi) or single value
                if isinstance(dpi, tuple):
                    result["dpi"] = round(dpi[0])  # Use horizontal DPI
                else:
                    result["dpi"] = round(dpi)
    except Exception:
        pass  # Silently skip files we can't read
    return result


def get_file_info(filepath: Path, base_path: Path, source: str) -> dict | None:
    """Extract file information for the manifest.

    source: 'library' or 'publications' - which root folder this came from
    """
    try:
        stat = filepath.stat()
        ext = filepath.suffix.lower()

        if ext not in ALL_EXTENSIONS:
            return None

        # Relative path from source root
        rel_path = filepath.relative_to(base_path)
        parts = rel_path.parts

        # Determine collection: everything in LIBRARY is "stock", PUBLICATIONS is "publications"
        if source == "library":
            collection = "stock"
            folder_parts = parts[:-1]  # All folders except filename
            full_path = f"library/{rel_path}"
        else:  # publications
            collection = "publications"
            folder_parts = parts[:-1]
            full_path = f"publications/{rel_path}"

        folder = "/".join(folder_parts) if folder_parts else ""
        asset_id = generate_asset_id(full_path)

        asset = {
            "id": asset_id,
            "name": filepath.stem,
            "filename": filepath.name,
            "path": full_path,
            "folder": folder,
            "ext": ext[1:],
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "collection": collection,
            "isImage": ext in WEB_DISPLAYABLE,
            "needsThumb": ext in NEEDS_THUMBNAIL
        }

        # Extract dimensions and DPI for images and PSDs
        if ext in WEB_DISPLAYABLE or ext == '.psd':
            dims = get_image_dimensions(filepath, ext)
            if dims:
                asset.update(dims)

        return asset
    except Exception as e:
        print(f"  Warning: Could not process {filepath}: {e}")
        return None


def scan_directory(base_path: Path, source: str) -> list[dict]:
    """Recursively scan directory for assets.

    source: 'library' or 'publications'
    """
    assets = []

    for root, dirs, files in os.walk(base_path):
        dirs[:] = [d for d in dirs if not d.startswith('.')]

        root_path = Path(root)
        for filename in files:
            if filename.startswith('.'):
                continue

            filepath = root_path / filename
            asset = get_file_info(filepath, base_path, source)
            if asset:
                assets.append(asset)

    return assets


def generate_pdf_thumbnail(source_path: Path, thumb_path: Path) -> bool:
    """Generate thumbnail for PDF using PyMuPDF (fitz)."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(source_path)
        page = doc[0]  # First page

        # Render at higher resolution then scale down for quality
        zoom = THUMB_SIZE / max(page.rect.width, page.rect.height) * 2
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)

        # Convert to PIL and save as WebP
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Scale down to target size
        if img.width > THUMB_SIZE or img.height > THUMB_SIZE:
            scale = THUMB_SIZE / max(img.width, img.height)
            new_width = int(img.width * scale)
            new_height = int(img.height * scale)
            img = img.resize((new_width, new_height), Image.LANCZOS)

        img.save(thumb_path, "WEBP", quality=85)
        doc.close()
        return True
    except Exception as e:
        print(f"  PDF thumbnail error: {e}")
        return False


def get_dominant_color(img_path: Path) -> str:
    """Extract dominant color from an image, return as hex string."""
    try:
        with Image.open(img_path) as img:
            # Resize to tiny size for fast color averaging
            small = img.convert('RGB').resize((50, 50), Image.LANCZOS)
            pixels = list(small.getdata())

            # Calculate average color
            r = sum(p[0] for p in pixels) // len(pixels)
            g = sum(p[1] for p in pixels) // len(pixels)
            b = sum(p[2] for p in pixels) // len(pixels)

            return f"#{r:02x}{g:02x}{b:02x}"
    except:
        return "#e2e8f0"  # Default gray


def generate_image_thumbnail(source_path: Path, thumb_path: Path, ext: str) -> bool:
    """Generate thumbnail for regular images (jpg, png, gif, webp) or copy SVG."""
    try:
        # SVG: just copy the file (they're vector, no resizing needed)
        if ext == 'svg':
            svg_thumb = thumb_path.with_suffix('.svg')
            shutil.copy2(source_path, svg_thumb)
            return True

        with Image.open(source_path) as img:
            # Convert to RGB if necessary (for PNG with alpha, etc.)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            # Scale down to target size
            if img.width > THUMB_SIZE or img.height > THUMB_SIZE:
                scale = THUMB_SIZE / max(img.width, img.height)
                new_width = int(img.width * scale)
                new_height = int(img.height * scale)
                img = img.resize((new_width, new_height), Image.LANCZOS)

            img.save(thumb_path, "WEBP", quality=85)
        return True
    except Exception as e:
        print(f"  Image thumbnail error: {e}")
        return False


def generate_thumbnail(asset: dict, library_path: Path, thumbs_path: Path) -> bool:
    """Generate thumbnail for a single asset."""
    # Determine source path (strip the library/ or publications/ prefix)
    path_parts = asset["path"].split("/", 1)
    if len(path_parts) == 2:
        source_prefix, rel_path = path_parts
        if source_prefix == "library":
            source_path = Path(LIBRARY_PATH) / rel_path
        elif source_prefix == "publications":
            source_path = Path(PUBLICATIONS_PATH) / rel_path
        else:
            source_path = library_path / asset["path"]
    else:
        source_path = library_path / asset["path"]

    thumb_filename = f"{asset['id']}.webp"
    thumb_path = thumbs_path / thumb_filename

    # Skip if thumbnail already exists and is newer than source
    if thumb_path.exists():
        try:
            source_mtime = source_path.stat().st_mtime
            thumb_mtime = thumb_path.stat().st_mtime
            if thumb_mtime >= source_mtime:
                asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
                asset["thumbColor"] = get_dominant_color(thumb_path)
                return True
        except:
            pass

    ext = asset.get("ext", "").lower()

    # Use PyMuPDF for PDFs
    if ext == "pdf":
        if generate_pdf_thumbnail(source_path, thumb_path):
            asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
            asset["thumbColor"] = get_dominant_color(thumb_path)
            return True
        return False

    # Use PIL for regular images (jpg, png, gif, webp) or copy SVG
    if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'):
        if generate_image_thumbnail(source_path, thumb_path, ext):
            # SVG keeps its extension, others become .webp
            if ext == 'svg':
                asset["thumbUrl"] = f"{THUMBS_DIR}/{asset['id']}.svg"
                asset["thumbColor"] = "#e2e8f0"  # Default for SVG
            else:
                asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
                asset["thumbColor"] = get_dominant_color(thumb_path)
            return True
        return False

    # Use Quick Look for other formats (AI, PSD, EPS)
    try:
        result = subprocess.run(
            ["qlmanage", "-t", "-s", str(THUMB_SIZE), "-o", str(thumbs_path), str(source_path)],
            capture_output=True,
            timeout=30
        )

        # qlmanage creates file with .png suffix added to original name
        ql_output = thumbs_path / f"{source_path.name}.png"

        if ql_output.exists():
            shutil.move(str(ql_output), str(thumb_path))
            asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
            asset["thumbColor"] = get_dominant_color(thumb_path)
            return True
        else:
            return False

    except subprocess.TimeoutExpired:
        print(f"  Timeout generating thumbnail for {asset['name']}")
        return False
    except Exception as e:
        print(f"  Error generating thumbnail for {asset['name']}: {e}")
        return False


def generate_thumbnails(assets: list[dict], library_path: Path, thumbs_path: Path) -> int:
    """Generate thumbnails for all assets that need them."""
    needs_thumb = [a for a in assets if a.get("needsThumb")]

    if not needs_thumb:
        print("No assets need thumbnails.")
        return 0

    print(f"Generating thumbnails for {len(needs_thumb)} assets...")
    thumbs_path.mkdir(exist_ok=True)

    success_count = 0
    failed = []

    # Process in parallel for speed
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(generate_thumbnail, asset, library_path, thumbs_path): asset
            for asset in needs_thumb
        }

        for i, future in enumerate(as_completed(futures), 1):
            asset = futures[future]
            try:
                if future.result():
                    success_count += 1
                else:
                    failed.append(asset["name"])
            except Exception as e:
                failed.append(asset["name"])

            # Progress indicator
            if i % 50 == 0 or i == len(needs_thumb):
                print(f"  Progress: {i}/{len(needs_thumb)} ({success_count} succeeded)")

    if failed and len(failed) <= 10:
        print(f"  Failed: {', '.join(failed)}")
    elif failed:
        print(f"  Failed: {len(failed)} files (check source files)")

    return success_count


def link_project_files(assets: list[dict]) -> tuple[list[dict], int]:
    """
    Find INDD files and link them to matching assets (same folder + base name).
    Returns filtered assets (without INDD) and count of linked project files.
    """
    # Build map of folder+basename -> list of assets
    by_location = {}
    for asset in assets:
        key = (asset["folder"], asset["name"])  # name is stem (without extension)
        if key not in by_location:
            by_location[key] = []
        by_location[key].append(asset)

    # Find project files and link them
    linked_count = 0
    project_files = set()  # IDs of project files to exclude

    for (folder, name), group in by_location.items():
        # Separate project files from display files
        projects = [a for a in group if f".{a['ext']}" in PROJECT_FILE_EXTENSIONS]
        displays = [a for a in group if f".{a['ext']}" not in PROJECT_FILE_EXTENSIONS]

        if projects and displays:
            # Link project files to display files
            project_info = [{
                "ext": p["ext"],
                "size": p["size"],
                "path": p["path"]
            } for p in projects]

            for display in displays:
                display["projectFiles"] = project_info

            linked_count += len(projects)

        # Mark all project files for exclusion
        for p in projects:
            project_files.add(p["id"])

    # Filter out project files
    filtered = [a for a in assets if a["id"] not in project_files]

    return filtered, linked_count


def main():
    # Parse arguments
    args = set(sys.argv[1:])
    skip_thumbs = "--no-thumbs" in args
    thumbs_only = "--thumbs-only" in args

    library_path = Path(LIBRARY_PATH)
    publications_path = Path(PUBLICATIONS_PATH)
    script_dir = Path(__file__).parent
    thumbs_path = script_dir / THUMBS_DIR
    manifest_path = script_dir / OUTPUT_FILE

    # Check paths exist
    if not library_path.exists():
        print(f"Error: Library path does not exist: {LIBRARY_PATH}")
        print("Make sure the volume is mounted.")
        return 1

    # For thumbs-only mode, load existing manifest
    if thumbs_only and manifest_path.exists():
        print("Loading existing manifest for thumbnail generation...")
        with open(manifest_path) as f:
            manifest = json.load(f)
        assets = manifest["assets"]
    else:
        assets = []

        # Scan Library folder (contains Stock and other library assets)
        print(f"Scanning library: {LIBRARY_PATH}")
        library_assets = scan_directory(library_path, "library")
        assets.extend(library_assets)
        print(f"  Found {len(library_assets)} assets in Library")

        # Scan Publications folder
        if publications_path.exists():
            print(f"Scanning publications: {PUBLICATIONS_PATH}")
            pub_assets = scan_directory(publications_path, "publications")
            assets.extend(pub_assets)
            print(f"  Found {len(pub_assets)} assets in Publications")
        else:
            print(f"Note: Publications path not found: {PUBLICATIONS_PATH}")

        print("-" * 50)

        # Link project files (INDD) to display files and filter them out
        assets, linked_count = link_project_files(assets)
        if linked_count > 0:
            print(f"Linked {linked_count} project files to their deliverables")

    # Count by collection
    stock_count = sum(1 for a in assets if a["collection"] == "stock")
    pub_count = sum(1 for a in assets if a["collection"] == "publications")

    print(f"Total: {len(assets)} assets")
    print(f"  Stock: {stock_count}")
    print(f"  Publications: {pub_count}")

    # Generate thumbnails
    if not skip_thumbs:
        print("-" * 50)
        thumb_count = generate_thumbnails(assets, library_path, thumbs_path)
        print(f"Thumbnails generated: {thumb_count}")

    # Always link existing thumbnails (even if we skipped generation)
    linked_thumbs = 0
    for asset in assets:
        if not asset.get("thumbUrl"):
            thumb_file = thumbs_path / f"{asset['id']}.webp"
            if thumb_file.exists():
                asset["thumbUrl"] = f"{THUMBS_DIR}/{asset['id']}.webp"
                linked_thumbs += 1
    if linked_thumbs > 0:
        print(f"Linked {linked_thumbs} existing thumbnails")

    # Clean up temporary fields
    for asset in assets:
        asset.pop("needsThumb", None)

    # Extract unique folders
    folders = sorted(set(a["folder"] for a in assets if a["folder"]))

    # Build manifest
    manifest = {
        "generated": datetime.now().isoformat(),
        "sources": {
            "library": LIBRARY_PATH,
            "publications": PUBLICATIONS_PATH
        },
        "stockFolder": STOCK_FOLDER,
        "totalAssets": len(assets),
        "collections": {
            "stock": stock_count,
            "publications": pub_count
        },
        "folders": folders,
        "assets": assets
    }

    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print("-" * 50)
    print(f"Manifest written to: {manifest_path}")
    print(f"Unique folders: {len(folders)}")

    return 0


if __name__ == "__main__":
    exit(main())
