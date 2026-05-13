from http.server import BaseHTTPRequestHandler, HTTPServer
import json

PC_IP = "10.91.94.45"

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8", errors="ignore")

        print("\nPOST", self.path)
        print(body)

        payload = {
            "ok": True,
            "device_id": "resq-node-01",
            "mqtt_host": PC_IP,
            "mqtt_port": 1883
        }

        data = json.dumps(payload).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        data = b"ResQ mock registration server OK"

        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

print("ResQ mock registration server running on http://0.0.0.0:18080")
print(f"Returning MQTT host: {PC_IP}:1883")

HTTPServer(("0.0.0.0", 18080), Handler).serve_forever()
