#!/usr/bin/env python3
"""
Find duplicate images in the library.

Usage:
    python3 find-duplicates.py                    # Report only
    python3 find-duplicates.py --move             # Move dupes to review folder
    python3 find-duplicates.py --perceptual       # Use perceptual hashing (slower, finds resized dupes)
"""

import os
import sys
import hashlib
from pathlib import Path
from collections import defaultdict
from datetime import datetime
import shutil

# Configuration - only dedupe LIBRARY, not Publications
LIBRARY_PATHS = [
    "/Volumes/Today/Nordson/LIBRARY",
]
DUPES_FOLDER = "/Volumes/Today/Nordson/_DUPLICATES_REVIEW"
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.tiff', '.tif', '.webp', '.bmp'}

def get_file_hash(filepath: Path, quick: bool = False) -> str:
    """Calculate MD5 hash of file content."""
    hasher = hashlib.md5()
    try:
        with open(filepath, 'rb') as f:
            if quick:
                # Quick mode: just hash first 64KB + file size
                hasher.update(f.read(65536))
                hasher.update(str(filepath.stat().st_size).encode())
            else:
                # Full file hash
                for chunk in iter(lambda: f.read(65536), b''):
                    hasher.update(chunk)
        return hasher.hexdigest()
    except Exception as e:
        print(f"  Error hashing {filepath}: {e}")
        return None


def get_perceptual_hash(filepath: Path):
    """Calculate perceptual hash (requires imagehash + PIL)."""
    try:
        from PIL import Image
        import imagehash
        img = Image.open(filepath)
        return imagehash.average_hash(img)
    except ImportError:
        print("Install imagehash: pip install imagehash Pillow")
        sys.exit(1)
    except Exception as e:
        print(f"  Error processing {filepath}: {e}")
        return None


def scan_images(paths: list[str]) -> list[Path]:
    """Find all image files in paths."""
    images = []
    for base in paths:
        base_path = Path(base)
        if not base_path.exists():
            continue
        for root, dirs, files in os.walk(base_path):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.startswith('.'):
                    continue
                filepath = Path(root) / f
                if filepath.suffix.lower() in IMAGE_EXTENSIONS:
                    images.append(filepath)
    return images


def find_exact_duplicates(images: list[Path]) -> dict[str, list[Path]]:
    """Find files with identical content."""
    print(f"Scanning {len(images)} images for exact duplicates...")

    # First pass: group by file size (quick filter)
    by_size = defaultdict(list)
    for img in images:
        try:
            size = img.stat().st_size
            by_size[size].append(img)
        except:
            pass

    # Only check files with same size
    candidates = [files for files in by_size.values() if len(files) > 1]
    to_hash = sum(len(f) for f in candidates)
    print(f"  {to_hash} files share sizes with others, hashing...")

    # Second pass: hash files with matching sizes
    by_hash = defaultdict(list)
    count = 0
    for group in candidates:
        for img in group:
            h = get_file_hash(img)
            if h:
                by_hash[h].append(img)
            count += 1
            if count % 100 == 0:
                print(f"  Hashed {count}/{to_hash}...")

    # Return only groups with duplicates
    return {h: files for h, files in by_hash.items() if len(files) > 1}


def find_perceptual_duplicates(images: list[Path], threshold: int = 5) -> list[list[Path]]:
    """Find visually similar images using perceptual hashing."""
    print(f"Calculating perceptual hashes for {len(images)} images...")

    hashes = []
    for i, img in enumerate(images):
        if i % 50 == 0:
            print(f"  Processing {i}/{len(images)}...")
        h = get_perceptual_hash(img)
        if h is not None:
            hashes.append((img, h))

    print(f"  Comparing {len(hashes)} hashes...")

    # Find similar pairs
    duplicates = []
    used = set()

    for i, (path1, hash1) in enumerate(hashes):
        if path1 in used:
            continue
        group = [path1]
        for j, (path2, hash2) in enumerate(hashes[i+1:], i+1):
            if path2 in used:
                continue
            # Hamming distance - lower = more similar
            if hash1 - hash2 <= threshold:
                group.append(path2)
                used.add(path2)
        if len(group) > 1:
            duplicates.append(group)
            used.add(path1)

    return duplicates


def choose_keeper(files: list[Path]) -> Path:
    """Choose which file to keep (largest, or shortest path as tiebreaker)."""
    # Prefer: largest file, then shortest path
    return max(files, key=lambda f: (f.stat().st_size, -len(str(f))))


def report_duplicates(groups: list[list[Path]], move: bool = False):
    """Print duplicate report and optionally move duplicates."""
    if not groups:
        print("\nNo duplicates found!")
        return

    total_dupes = sum(len(g) - 1 for g in groups)
    total_size = sum(
        sum(f.stat().st_size for f in g[1:])  # Size of all but keeper
        for g in groups
    )

    print(f"\n{'='*60}")
    print(f"Found {len(groups)} duplicate groups ({total_dupes} duplicate files)")
    print(f"Potential space savings: {total_size / 1024 / 1024:.1f} MB")
    print(f"{'='*60}\n")

    dupes_path = Path(DUPES_FOLDER)
    if move:
        dupes_path.mkdir(parents=True, exist_ok=True)
        print(f"Moving duplicates to: {DUPES_FOLDER}\n")

    for i, group in enumerate(groups[:50], 1):  # Show first 50
        keeper = choose_keeper(group)
        dupes = [f for f in group if f != keeper]

        print(f"Group {i}: {len(group)} files")
        print(f"  KEEP: {keeper}")
        for dupe in dupes:
            size = dupe.stat().st_size / 1024
            print(f"  DUPE: {dupe} ({size:.0f} KB)")

            if move:
                # Preserve folder structure in dupes folder
                # Find which base path this file is under
                for base in LIBRARY_PATHS:
                    try:
                        rel = dupe.relative_to(base)
                        dest = dupes_path / Path(base).name / rel
                        break
                    except ValueError:
                        continue
                else:
                    dest = dupes_path / dupe.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.move(str(dupe), str(dest))
                    print(f"       → Moved")
                except Exception as e:
                    print(f"       → Error: {e}")
        print()

    if len(groups) > 50:
        print(f"... and {len(groups) - 50} more groups\n")


def main():
    args = set(sys.argv[1:])
    use_perceptual = "--perceptual" in args
    do_move = "--move" in args

    print("Duplicate Image Finder")
    print("-" * 40)

    images = scan_images(LIBRARY_PATHS)
    print(f"Found {len(images)} images to check\n")

    if not images:
        print("No images found!")
        return

    if use_perceptual:
        groups = find_perceptual_duplicates(images)
    else:
        duplicates = find_exact_duplicates(images)
        groups = list(duplicates.values())

    report_duplicates(groups, move=do_move)

    if not do_move and groups:
        print("Run with --move to move duplicates to review folder")


if __name__ == "__main__":
    main()
