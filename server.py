#!/usr/bin/env python3
"""
Simple HTTP server to run the image optimization page locally
"""
import http.server
import socketserver
import webbrowser
import os
import sys
import socket
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

import mimetypes

# Ensure explicit MIME types are registered
mimetypes.init()
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('text/css', '.css')

PORT = 8080

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Cache WASM files for 1 hour - they're large and rarely change
        if self.path.endswith('.wasm'):
            self.send_header('Cache-Control', 'public, max-age=3600')
        else:
            # DISABLE CACHING for other files intentionally for development
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            
        # Headers required for SharedArrayBuffer (needed for WASM image encoders)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def log_message(self, format, *args):
        # Override to use our logger instead of standard stderr
        logger.info("%s - - [%s] %s" % (self.client_address[0], self.log_date_time_string(), format%args))

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

def main():
    try:
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
    except Exception as e:
        logger.error(f"Failed to change directory: {e}")
        sys.exit(1)
    
    # Check if port is already in use and find an available one
    port = PORT
    attempt = 0
    max_attempts = 10
    while attempt < max_attempts:
        if is_port_in_use(port):
            logger.warning(f"Port {port} is already in use. Trying next port...")
            port += 1
            attempt += 1
        else:
            break
    
    if attempt == max_attempts:
        logger.error(f"Could not find an available port after {max_attempts} attempts.")
        sys.exit(1)
    
    # Allow address reuse to prevent "Address already in use" errors on restart
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        # Use the possibly updated PORT
        with socketserver.TCPServer(("", port), MyHTTPRequestHandler) as httpd:
            url = f"http://localhost:{port}/"
            logger.info("=========================================")
            logger.info(f"Image Optimizer Server Started")
            logger.info(f"URL: {url}")
            logger.info(f"Directory: {os.getcwd()}")
            logger.info("=========================================")
            logger.info("Press Ctrl+C to stop the server")
            
            # Try to open browser automatically
            # try:
            #     logger.info("Opening browser...")
            #     if not webbrowser.open(url):
            #         logger.warning("Could not open browser automatically. Please open the URL manually.")
            # except Exception as e:
            #     logger.error(f"Error opening browser: {e}")
            
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                logger.info("\nShutdown signal received (Ctrl+C).")
            except Exception as e:
                logger.error(f"Server error: {e}")
            finally:
                logger.info("Server stopped.")
                httpd.server_close()
                
    except PermissionError:
        logger.error(f"Permission denied to bind to port {PORT}. Try a different port or run as admin.")
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
