#!/usr/bin/env python3
"""
Tiny helper server for Reveal in Finder and PDF viewing functionality.
Run alongside the main HTTP server on port 8081.

Usage: python3 reveal-server.py
"""

import subprocess
import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, unquote

PORT = 8081

class RevealHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/pdf':
            # Serve PDF files for iframe viewing
            params = parse_qs(parsed.query)
            path = params.get('path', [None])[0]

            if path:
                path = unquote(path)
                if os.path.isfile(path) and path.lower().endswith('.pdf'):
                    try:
                        with open(path, 'rb') as f:
                            pdf_data = f.read()
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/pdf')
                        self.send_header('Content-Length', str(len(pdf_data)))
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(pdf_data)
                    except Exception as e:
                        self.send_response(500)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({'error': str(e)}).encode())
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'File not found or not a PDF'}).encode())
            else:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Missing path parameter'}).encode())

        elif parsed.path == '/reveal':
            params = parse_qs(parsed.query)
            path = params.get('path', [None])[0]

            if path:
                # Use 'open -R' to reveal file in Finder
                try:
                    subprocess.run(['open', '-R', path], check=True)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': True}).encode())
                except subprocess.CalledProcessError as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': str(e)}).encode())
            else:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Missing path parameter'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress logging

if __name__ == '__main__':
    print(f'Reveal server running on http://localhost:{PORT}')
    HTTPServer(('localhost', PORT), RevealHandler).serve_forever()
