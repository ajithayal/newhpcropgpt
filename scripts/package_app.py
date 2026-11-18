import os
import shutil
import zipfile
import hashlib
from pathlib import Path

WORKSPACE = Path(r"D:\HPC Web application\layahpc")
STAGING_DIR = WORKSPACE / "ajicorehpc"
ZIP_PATH = WORKSPACE / "ajicorehpc.zip"
CHECKSUM_FILE = WORKSPACE / "checksums.txt"

FORBIDDEN_NAMES = {
    ".venv", "node_modules", ".git", "__pycache__", ".pytest_cache",
    "vendor_private_key.pem", ".env", "ajicorehpc.db", "ajicorehpc.db-shm",
    "ajicorehpc.db-wal", "ayalhpc.db", "ayalhpc.db-shm", "ayalhpc.db-wal",
    "layahpc.db", "layahpc.db-shm", "layahpc.db-wal"
}

FORBIDDEN_EXTENSIONS = {".pyc", ".pyo", ".pyd"}

def should_exclude(path: Path) -> bool:
    for part in path.parts:
        if part in FORBIDDEN_NAMES:
            return True
        if part.startswith(".env") and part != ".env.example":
            return True
        if ".db" in part:
            return True
    if path.suffix in FORBIDDEN_EXTENSIONS:
        return True
    if path.name == "vendor_private_key.pem":
        return True
    return False

def copy_tree(src: Path, dst: Path):
    if not src.exists():
        return
    for root, dirs, files in os.walk(src):
        rel_root = Path(root).relative_to(src)
        # Filter directories in-place to avoid traversing forbidden dirs
        dirs[:] = [d for d in dirs if not should_exclude(Path(root) / d)]
        target_dir = dst / rel_root
        target_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            file_path = Path(root) / f
            if not should_exclude(file_path):
                shutil.copy2(file_path, target_dir / f)

def sha256_file(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def main():
    print("[1/5] Cleaning previous staging and artifacts...")
    if STAGING_DIR.exists():
        shutil.rmtree(STAGING_DIR)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    if CHECKSUM_FILE.exists():
        CHECKSUM_FILE.unlink()

    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    print("[2/5] Staging files into ajicorehpc/...")
    # Copy root deploy.sh, README.md, and TECH_STACK.md
    for root_file in ["deploy.sh", "README.md", "TECH_STACK.md"]:
        src = WORKSPACE / root_file
        if src.exists():
            shutil.copy2(src, STAGING_DIR / root_file)
            print(f"  Copied {root_file}")

    # Copy directories
    directories_to_stage = ["backend", "frontend", "config", "deploy", "docs", "scripts"]
    for dir_name in directories_to_stage:
        src = WORKSPACE / dir_name
        dst = STAGING_DIR / dir_name
        if src.exists():
            copy_tree(src, dst)
            print(f"  Copied tree: {dir_name}/")

    print("[3/5] Computing SHA-256 checksums for all files in ajicorehpc/...")
    checksum_lines = []
    file_count = 0
    for root, _, files in os.walk(STAGING_DIR):
        for f in sorted(files):
            full_path = Path(root) / f
            rel_path = full_path.relative_to(WORKSPACE)
            h = sha256_file(full_path)
            checksum_lines.append(f"{h}  {rel_path.as_posix()}\n")
            file_count += 1

    with open(CHECKSUM_FILE, "w", encoding="utf-8") as f:
        f.writelines(checksum_lines)
    print(f"  Generated checksums for {file_count} files in checksums.txt")

    print("[4/5] Creating ajicorehpc.zip (with single top-level ajicorehpc/ directory)...")
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, _, files in os.walk(STAGING_DIR):
            for f in sorted(files):
                full_path = Path(root) / f
                arcname = full_path.relative_to(WORKSPACE).as_posix()
                zf.write(full_path, arcname)

    zip_size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)
    zip_sha = sha256_file(ZIP_PATH)
    print(f"  Created ajicorehpc.zip ({zip_size_mb:.2f} MB)")
    print(f"  SHA-256(ajicorehpc.zip) = {zip_sha}")

    # Append ajicorehpc.zip checksum to checksums.txt
    with open(CHECKSUM_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n# Deployment Archive Checksum:\n{zip_sha}  ajicorehpc.zip\n")

    print("[5/5] Verifying zip archive structure and exclusion integrity...")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        namelist = zf.namelist()
        for name in namelist:
            # 1. Must start with ajicorehpc/
            if not name.startswith("ajicorehpc/"):
                raise ValueError(f"CRITICAL: Found file not starting with 'ajicorehpc/': {name}")
            # 2. Must not contain forbidden names
            parts = Path(name).parts
            for part in parts:
                if part == ".env" or (part.startswith(".env.") and part != ".env.example"):
                    raise ValueError(f"CRITICAL: Live .env file leaked into zip: {name}")
                if ".db" in part:
                    raise ValueError(f"CRITICAL: Database file leaked into zip: {name}")
                for forbidden in FORBIDDEN_NAMES:
                    if forbidden in [".env", "ajicorehpc.db", "ajicorehpc.db-shm", "ajicorehpc.db-wal", "ayalhpc.db", "ayalhpc.db-shm", "ayalhpc.db-wal", "layahpc.db", "layahpc.db-shm", "layahpc.db-wal"]:
                        continue
                    if forbidden in part:
                        raise ValueError(f"CRITICAL: Forbidden item '{forbidden}' leaked into zip: {name}")

    print("ALL VERIFICATIONS PASSED! ajicorehpc.zip is clean, complete, and production-ready.")

if __name__ == "__main__":
    main()
