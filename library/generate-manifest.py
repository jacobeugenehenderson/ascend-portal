#!/usr/bin/env python3
"""
Library Manifest Generator
Scans the library folder and produces library-manifest.json
Generates thumbnails for non-web formats using Quick Look.

Uses incremental scanning by default - only processes new/changed files
based on a fingerprint cache (.library-fingerprint.json).

Usage:
    python3 generate-manifest.py              # Incremental scan (fast)
    python3 generate-manifest.py --full       # Force full rescan
    python3 generate-manifest.py --no-thumbs  # Skip thumbnail generation
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
FINGERPRINT_FILE = ".library-fingerprint.json"  # Cache of file mtimes for incremental updates
THUMBS_DIR = "thumbs"           # Small thumbnails for grid (400px)
THUMBS_LG_DIR = "thumbs-lg"     # Large thumbnails for modal (1200px)
THUMB_SIZE_SM = 400   # Small thumbnails for grid cards
THUMB_SIZE_LG = 1200  # Large thumbnails for modal preview
WEBP_QUALITY = 95  # Maximum practical quality
PNG_COMPRESS = 6   # PNG compression level (0-9, 6 is default balance)

# File extensions
WEB_DISPLAYABLE = {'.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'}
NEEDS_CONVERSION = {'.pdf', '.ai', '.psd', '.eps'}  # Need special handling (Quick Look or PyMuPDF)
PROJECT_FILE_EXTENSIONS = {'.indd'}  # Track these but don't list them
ALL_EXTENSIONS = WEB_DISPLAYABLE | NEEDS_CONVERSION | PROJECT_FILE_EXTENSIONS
# All displayable files need thumbnails for GitHub Pages hosting
NEEDS_THUMBNAIL = WEB_DISPLAYABLE | NEEDS_CONVERSION


def load_fingerprint(script_dir: Path) -> dict:
    """Load the fingerprint cache of file mtimes/sizes."""
    fp_path = script_dir / FINGERPRINT_FILE
    if fp_path.exists():
        try:
            with open(fp_path) as f:
                return json.load(f)
        except:
            pass
    return {}


def save_fingerprint(script_dir: Path, fingerprint: dict):
    """Save the fingerprint cache."""
    fp_path = script_dir / FINGERPRINT_FILE
    with open(fp_path, 'w') as f:
        json.dump(fingerprint, f)


def get_file_fingerprint(filepath: Path) -> tuple:
    """Get (mtime, size) tuple for a file - fast stat only."""
    try:
        stat = filepath.stat()
        return (stat.st_mtime, stat.st_size)
    except:
        return None


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


def scan_directory_incremental(base_path: Path, source: str, fingerprint: dict, existing_assets: dict) -> tuple[list[dict], dict, dict]:
    """Incrementally scan directory, only processing changed files.

    The fingerprint stores both mtime/size AND cached asset data, so even files
    that get filtered out of the manifest (enlargements, project files) can be
    reused on subsequent runs.

    Returns: (assets, new_fingerprint, stats)
    - assets: list of asset dicts
    - new_fingerprint: updated fingerprint dict (includes cached asset data)
    - stats: {"new": N, "changed": N, "unchanged": N}
    """
    assets = []
    new_fingerprint = {}
    stats = {"new": 0, "changed": 0, "unchanged": 0}

    for root, dirs, files in os.walk(base_path):
        dirs[:] = [d for d in dirs if not d.startswith('.')]

        root_path = Path(root)
        for filename in files:
            if filename.startswith('.'):
                continue

            filepath = root_path / filename
            ext = filepath.suffix.lower()
            if ext not in ALL_EXTENSIONS:
                continue

            # Build the path key (same format as asset["path"])
            rel_path = filepath.relative_to(base_path)
            if source == "library":
                full_path = f"library/{rel_path}"
            else:
                full_path = f"publications/{rel_path}"

            # Get current file fingerprint
            fp = get_file_fingerprint(filepath)
            if fp is None:
                continue

            mtime, size = fp

            # Check if file is unchanged (compare mtime and size)
            old_fp = fingerprint.get(full_path)
            if old_fp and old_fp.get("mtime") == mtime and old_fp.get("size") == size:
                # File unchanged - reuse cached asset data
                # First try the fingerprint's cached asset, then existing_assets
                cached_asset = old_fp.get("asset")
                if cached_asset:
                    assets.append(cached_asset)
                    new_fingerprint[full_path] = old_fp  # Keep the cached data
                    stats["unchanged"] += 1
                    continue
                elif full_path in existing_assets:
                    asset = existing_assets[full_path]
                    assets.append(asset)
                    new_fingerprint[full_path] = {"mtime": mtime, "size": size, "asset": asset}
                    stats["unchanged"] += 1
                    continue

            # File is new or changed - process it fully
            asset = get_file_info(filepath, base_path, source)
            if asset:
                assets.append(asset)
                # Cache the asset data in the fingerprint for future runs
                new_fingerprint[full_path] = {"mtime": mtime, "size": size, "asset": asset}
                if old_fp:
                    stats["changed"] += 1
                else:
                    stats["new"] += 1

    return assets, new_fingerprint, stats


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

        img.save(thumb_path, "WEBP", quality=WEBP_QUALITY)
        doc.close()
        return True
    except Exception as e:
        print(f"  PDF thumbnail error: {e}")
        return False


def generate_image_thumbnail(source_path: Path, thumb_path: Path, ext: str) -> bool:
    """Generate thumbnail for regular images (jpg, png, gif, webp) or copy SVG.

    PNGs with actual transparency (alpha < 255) are saved as PNG.
    PNGs without transparency and other formats are saved as high-quality WebP.
    """
    try:
        # SVG: just copy the file (they're vector, no resizing needed)
        if ext == 'svg':
            svg_thumb = thumb_path.with_suffix('.svg')
            shutil.copy2(source_path, svg_thumb)
            return True

        with Image.open(source_path) as img:
            # Animated GIF: copy as-is to preserve animation
            if ext == 'gif' and getattr(img, 'n_frames', 1) > 1:
                gif_thumb = thumb_path.with_suffix('.gif')
                # For animated GIFs, resize all frames
                frames = []
                durations = []
                for frame_num in range(img.n_frames):
                    img.seek(frame_num)
                    frame = img.copy()
                    if frame.width > THUMB_SIZE or frame.height > THUMB_SIZE:
                        scale = THUMB_SIZE / max(frame.width, frame.height)
                        new_width = int(frame.width * scale)
                        new_height = int(frame.height * scale)
                        frame = frame.resize((new_width, new_height), Image.LANCZOS)
                    frames.append(frame)
                    durations.append(img.info.get('duration', 100))
                frames[0].save(
                    gif_thumb,
                    save_all=True,
                    append_images=frames[1:],
                    duration=durations,
                    loop=img.info.get('loop', 0)
                )
                return True

            # Preserve transparency: convert palette mode to RGBA if it has transparency
            if img.mode == 'P':
                if 'transparency' in img.info:
                    img = img.convert('RGBA')
                else:
                    img = img.convert('RGB')
            # Keep RGBA as-is for transparency
            elif img.mode == 'LA':
                img = img.convert('RGBA')
            elif img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGB')

            # Scale down to target size
            if img.width > THUMB_SIZE or img.height > THUMB_SIZE:
                scale = THUMB_SIZE / max(img.width, img.height)
                new_width = int(img.width * scale)
                new_height = int(img.height * scale)
                img = img.resize((new_width, new_height), Image.LANCZOS)

            # PNG with actual transparency: save as PNG to preserve RGBA
            # PNG without transparency: convert to WebP for better compression
            if ext == 'png' and img.mode == 'RGBA':
                # Check if alpha channel is actually used (not all 255)
                alpha = img.getchannel('A')
                if alpha.getextrema()[0] < 255:  # Has actual transparency
                    png_path = thumb_path.with_suffix('.png')
                    img.save(png_path, "PNG", compress_level=PNG_COMPRESS)
                else:
                    # No transparency used, convert to WebP
                    img = img.convert('RGB')
                    img.save(thumb_path, "WEBP", quality=WEBP_QUALITY)
            else:
                # JPG, GIF, WebP, or PNG without alpha: save as high-quality WebP
                if img.mode == 'RGBA':
                    img = img.convert('RGB')
                img.save(thumb_path, "WEBP", quality=WEBP_QUALITY)
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
                return True
        except:
            pass

    ext = asset.get("ext", "").lower()

    # Use PyMuPDF for PDFs
    if ext == "pdf":
        if generate_pdf_thumbnail(source_path, thumb_path):
            asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
            return True
        return False

    # Use PIL for regular images (jpg, png, gif, webp) or copy SVG
    if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'):
        if generate_image_thumbnail(source_path, thumb_path, ext):
            # SVG keeps .svg, animated GIF keeps .gif, PNG may be .png or .webp
            if ext == 'svg':
                asset["thumbUrl"] = f"{THUMBS_DIR}/{asset['id']}.svg"
            elif ext == 'gif':
                # Check if animated GIF was preserved
                gif_path = thumb_path.with_suffix('.gif')
                if gif_path.exists():
                    asset["thumbUrl"] = f"{THUMBS_DIR}/{asset['id']}.gif"
                else:
                    asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
            elif ext == 'png':
                # Check which format was actually created
                png_path = thumb_path.with_suffix('.png')
                if png_path.exists():
                    asset["thumbUrl"] = f"{THUMBS_DIR}/{asset['id']}.png"
                else:
                    asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
            else:
                asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_filename}"
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


import re

# Pattern to detect enlargements: LG_ or LG- prefix
# Example: LG-MyImage_1568x1179-topaz.psd -> base name is MyImage_1568x1179-topaz
ENLARGEMENT_PREFIX_PATTERN = re.compile(r'^LG[_-](.+)$', re.IGNORECASE)


def link_enlargements(assets: list[dict]) -> tuple[list[dict], int]:
    """
    Find enlargement files and link them to their base assets.
    Enlargements are detected by LG_ or LG- prefix.
    Returns filtered assets (without enlargements) and count of linked enlargements.
    """
    # Build map of folder+basename -> asset (for finding base files)
    by_location = {}
    for asset in assets:
        key = (asset["folder"], asset["name"].lower())
        if key not in by_location:
            by_location[key] = []
        by_location[key].append(asset)

    linked_count = 0
    enlargement_ids = set()

    for asset in assets:
        match = ENLARGEMENT_PREFIX_PATTERN.match(asset["name"])
        if not match:
            continue

        # Extract base name (everything after LG- or LG_)
        base_name_full = match.group(1)

        # Strip any Topaz suffixes or dimension info to find the original
        # e.g., "MyImage_1568x1179-topaz" -> try "MyImage_1568x1179-topaz", "MyImage"
        # We'll try progressively shorter versions to find a match
        base_candidates = [base_name_full]

        # Strip -topaz suffix if present
        if '-topaz' in base_name_full.lower():
            base_candidates.append(re.sub(r'-topaz$', '', base_name_full, flags=re.IGNORECASE))

        # Strip trailing dimension patterns like _1568x1179 or -1568x1179
        stripped = re.sub(r'[_-]\d+x\d+(-topaz)?$', '', base_name_full, flags=re.IGNORECASE)
        if stripped != base_name_full:
            base_candidates.append(stripped)

        # Try each candidate to find the base file
        base_file = None
        for base_name in base_candidates:
            key = (asset["folder"], base_name.lower())
            candidates = by_location.get(key, [])

            # Prefer same extension, but allow cross-extension matching
            for c in candidates:
                if c["id"] != asset["id"]:  # Don't match self
                    if c["ext"] == asset["ext"]:
                        base_file = c
                        break
                    elif not base_file:
                        base_file = c

            if base_file:
                break  # Found a match, stop searching

        if base_file:
            # Link enlargement to base file
            if "enlargements" not in base_file:
                base_file["enlargements"] = []

            base_file["enlargements"].append({
                "size": "LG",
                "ext": asset["ext"],
                "path": asset["path"],
                "fileSize": asset["size"],
                "width": asset.get("width"),
                "height": asset.get("height")
            })

            enlargement_ids.add(asset["id"])
            linked_count += 1

    # Filter out enlargements from main list
    filtered = [a for a in assets if a["id"] not in enlargement_ids]

    return filtered, linked_count


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
    full_scan = "--full" in args  # Force full rescan, ignore fingerprint cache

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

        # Load fingerprint cache and existing manifest for incremental scanning
        fingerprint = {} if full_scan else load_fingerprint(script_dir)
        existing_assets = {}
        if not full_scan and manifest_path.exists():
            try:
                with open(manifest_path) as f:
                    old_manifest = json.load(f)
                # Build path -> asset lookup for reuse
                existing_assets = {a["path"]: a for a in old_manifest.get("assets", [])}
            except:
                pass

        new_fingerprint = {}
        total_stats = {"new": 0, "changed": 0, "unchanged": 0}

        # Scan Library folder (contains Stock and other library assets)
        print(f"Scanning library: {LIBRARY_PATH}")
        if fingerprint or existing_assets:
            library_assets, lib_fp, lib_stats = scan_directory_incremental(
                library_path, "library", fingerprint, existing_assets
            )
            new_fingerprint.update(lib_fp)
            for k, v in lib_stats.items():
                total_stats[k] += v
            print(f"  Found {len(library_assets)} assets ({lib_stats['new']} new, {lib_stats['changed']} changed, {lib_stats['unchanged']} unchanged)")
        else:
            library_assets = scan_directory(library_path, "library")
            # Build fingerprint from full scan (include cached asset data)
            for asset in library_assets:
                fp = get_file_fingerprint(Path(LIBRARY_PATH) / asset["path"].split("/", 1)[1])
                if fp:
                    new_fingerprint[asset["path"]] = {"mtime": fp[0], "size": fp[1], "asset": asset}
            print(f"  Found {len(library_assets)} assets in Library")
        assets.extend(library_assets)

        # Scan Publications folder
        if publications_path.exists():
            print(f"Scanning publications: {PUBLICATIONS_PATH}")
            if fingerprint or existing_assets:
                pub_assets, pub_fp, pub_stats = scan_directory_incremental(
                    publications_path, "publications", fingerprint, existing_assets
                )
                new_fingerprint.update(pub_fp)
                for k, v in pub_stats.items():
                    total_stats[k] += v
                print(f"  Found {len(pub_assets)} assets ({pub_stats['new']} new, {pub_stats['changed']} changed, {pub_stats['unchanged']} unchanged)")
            else:
                pub_assets = scan_directory(publications_path, "publications")
                for asset in pub_assets:
                    fp = get_file_fingerprint(Path(PUBLICATIONS_PATH) / asset["path"].split("/", 1)[1])
                    if fp:
                        new_fingerprint[asset["path"]] = {"mtime": fp[0], "size": fp[1], "asset": asset}
                print(f"  Found {len(pub_assets)} assets in Publications")
            assets.extend(pub_assets)
        else:
            print(f"Note: Publications path not found: {PUBLICATIONS_PATH}")

        # Save updated fingerprint
        save_fingerprint(script_dir, new_fingerprint)

        print("-" * 50)

        # Link project files (INDD) to display files and filter them out
        assets, linked_count = link_project_files(assets)
        if linked_count > 0:
            print(f"Linked {linked_count} project files to their deliverables")

        # Link enlargements to their base files and filter them out
        assets, enlargement_count = link_enlargements(assets)
        if enlargement_count > 0:
            print(f"Linked {enlargement_count} enlargements to their base files")

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
            # SVG keeps .svg, animated GIF keeps .gif, PNG can be .png or .webp
            ext = asset.get("ext", "").lower()
            if ext == "svg":
                thumb_file = thumbs_path / f"{asset['id']}.svg"
            elif ext == "gif":
                # Animated GIFs stay .gif, static GIFs become .webp
                gif_file = thumbs_path / f"{asset['id']}.gif"
                webp_file = thumbs_path / f"{asset['id']}.webp"
                thumb_file = gif_file if gif_file.exists() else webp_file
            elif ext == "png":
                # PNG thumbnails may be .png (with alpha) or .webp (without)
                png_file = thumbs_path / f"{asset['id']}.png"
                webp_file = thumbs_path / f"{asset['id']}.webp"
                thumb_file = png_file if png_file.exists() else webp_file
            else:
                thumb_file = thumbs_path / f"{asset['id']}.webp"
            if thumb_file.exists():
                asset["thumbUrl"] = f"{THUMBS_DIR}/{thumb_file.name}"
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
