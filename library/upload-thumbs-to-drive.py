#!/usr/bin/env python3
"""
Upload library thumbnails to Google Drive and generate URL mapping.

Prerequisites:
1. pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client
2. Create OAuth credentials at console.cloud.google.com
3. Download credentials.json to this folder

Usage:
    python3 upload-thumbs-to-drive.py
"""

import os
import json
import pickle
from pathlib import Path
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

# Config
THUMBS_DIR = Path(__file__).parent / "thumbs"
MANIFEST_FILE = Path(__file__).parent / "library-manifest.json"
SCOPES = ['https://www.googleapis.com/auth/drive.file']
# Folder inside Google Drive Library folder
DRIVE_FOLDER_NAME = "thumbs"
PARENT_FOLDER_NAME = "Library"  # The existing Library folder in Google Drive

def get_credentials():
    """Get or refresh Google Drive credentials."""
    creds = None
    token_file = Path(__file__).parent / "token.pickle"
    creds_file = Path(__file__).parent / "credentials.json"
    
    if token_file.exists():
        with open(token_file, 'rb') as f:
            creds = pickle.load(f)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_file.exists():
                print("ERROR: credentials.json not found!")
                print("1. Go to console.cloud.google.com")
                print("2. Create OAuth 2.0 credentials (Desktop app)")
                print("3. Download and save as credentials.json")
                return None
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_file), SCOPES)
            creds = flow.run_local_server(port=0)
        
        with open(token_file, 'wb') as f:
            pickle.dump(creds, f)
    
    return creds

def find_folder(service, folder_name, parent_id=None):
    """Find a folder by name, optionally within a parent."""
    q = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        q += f" and '{parent_id}' in parents"

    results = service.files().list(q=q, spaces='drive', fields='files(id, name)').execute()
    files = results.get('files', [])
    return files[0]['id'] if files else None

def get_or_create_folder(service, folder_name, parent_id=None):
    """Get or create a folder in Google Drive."""
    # Check if folder exists
    folder_id = find_folder(service, folder_name, parent_id)
    if folder_id:
        print(f"Using existing folder: {folder_name} ({folder_id})")
        return folder_id

    # Create folder
    file_metadata = {
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.folder'
    }
    if parent_id:
        file_metadata['parents'] = [parent_id]

    folder = service.files().create(body=file_metadata, fields='id').execute()
    folder_id = folder.get('id')
    print(f"Created folder: {folder_name} ({folder_id})")

    # Make folder publicly readable
    service.permissions().create(
        fileId=folder_id,
        body={'type': 'anyone', 'role': 'reader'}
    ).execute()
    print("Folder set to public")

    return folder_id

def upload_thumbnails(service, folder_id):
    """Upload all thumbnails and return URL mapping."""
    url_map = {}
    thumbs = list(THUMBS_DIR.glob("*.webp"))
    total = len(thumbs)
    
    print(f"Uploading {total} thumbnails...")
    
    for i, thumb_path in enumerate(thumbs, 1):
        asset_id = thumb_path.stem  # filename without extension
        
        # Check if already uploaded
        results = service.files().list(
            q=f"name='{thumb_path.name}' and '{folder_id}' in parents and trashed=false",
            spaces='drive',
            fields='files(id)'
        ).execute()
        
        if results.get('files'):
            file_id = results['files'][0]['id']
        else:
            # Upload file
            file_metadata = {
                'name': thumb_path.name,
                'parents': [folder_id]
            }
            media = MediaFileUpload(str(thumb_path), mimetype='image/webp')
            file = service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id'
            ).execute()
            file_id = file.get('id')
        
        # Google Drive direct link format
        url_map[asset_id] = f"https://drive.google.com/uc?export=view&id={file_id}"
        
        if i % 50 == 0 or i == total:
            print(f"  Progress: {i}/{total}")
    
    return url_map

def update_manifest(url_map):
    """Update manifest with Google Drive URLs."""
    with open(MANIFEST_FILE) as f:
        manifest = json.load(f)
    
    updated = 0
    for asset in manifest['assets']:
        asset_id = asset['id']
        if asset_id in url_map:
            asset['thumbUrl'] = url_map[asset_id]
            updated += 1
    
    with open(MANIFEST_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"Updated {updated} assets in manifest")

def main():
    print("=== Library Thumbnail Uploader ===\n")

    creds = get_credentials()
    if not creds:
        return 1

    service = build('drive', 'v3', credentials=creds)

    # Find parent Library folder
    parent_id = find_folder(service, PARENT_FOLDER_NAME)
    if not parent_id:
        print(f"ERROR: '{PARENT_FOLDER_NAME}' folder not found in Google Drive!")
        print("Please create it first or update PARENT_FOLDER_NAME in this script.")
        return 1
    print(f"Found parent folder: {PARENT_FOLDER_NAME} ({parent_id})")

    # Get or create thumbs subfolder
    folder_id = get_or_create_folder(service, DRIVE_FOLDER_NAME, parent_id)
    url_map = upload_thumbnails(service, folder_id)
    update_manifest(url_map)

    print("\nDone! Commit and push the updated manifest.")
    return 0

if __name__ == "__main__":
    exit(main())
