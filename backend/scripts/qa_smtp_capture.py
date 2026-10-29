"""Loopback-only disposable SMTP sink for synthetic QA messages, never a relay."""
from email import policy
from email.parser import BytesParser
import socketserver
from threading import Thread


class SMTPCapture:
    def __init__(self, messages, fail_delivery):
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                self.connection.settimeout(5)
                self.wfile.write(b"220 localhost synthetic QA SMTP capture\r\n")
                while line := self.rfile.readline(65536):
                    command = line.split(b" ", 1)[0].strip().upper()
                    if command in {b"EHLO", b"HELO"}:
                        self.wfile.write(b"250 localhost\r\n")
                    elif command in {b"MAIL", b"RCPT", b"RSET", b"NOOP"}:
                        self.wfile.write(b"250 OK\r\n")
                    elif command == b"DATA":
                        if fail_delivery[0]:
                            self.wfile.write(b"451 Synthetic delivery failure\r\n")
                            continue
                        self.wfile.write(b"354 End with dot\r\n")
                        content = bytearray()
                        while data := self.rfile.readline(65536):
                            if data == b".\r\n": break
                            content.extend(data[1:] if data.startswith(b"..") else data)
                            if len(content) > 1048576: raise ValueError("Synthetic capture message too large")
                        messages.append(BytesParser(policy=policy.default).parsebytes(bytes(content)))
                        self.wfile.write(b"250 Captured locally, not relayed\r\n")
                    elif command == b"QUIT":
                        self.wfile.write(b"221 Bye\r\n"); return
                    else:
                        self.wfile.write(b"502 Command not implemented\r\n")
        self.server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)
